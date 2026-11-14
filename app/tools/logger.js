// Logger readings to water levels: barometric compensation, pressure to length of
// water, and referencing to manual depth-to-water readings, as logger software does.
import { UNITS } from '../../engine/index.js';
import { convertLogger, G, isPressure, kellDensity, PRESSURE_UNITS } from '../../engine/logger.js';
import { DAY, median } from '../../engine/numeric.js';
import { isMissingCode } from '../../engine/prepare.js';
import { detect, unitInLabel } from '../columns.js';
import { detectDayFirst, parseStamp, timeFraction } from '../read-file.js';
import { chart, columnSpec, columnValues, done, downloads, downloadWorkbook, el, errorBox, findColumn, form, methodPanel, notes, panel, readFile, sig, table, unit, unitOptions } from '../kit.js';
import { state } from '../ui.js';
import { EXAMPLE_TRUTH, exampleRecords } from './logger-example.js';

const READINGS = 8;
const UNIT_OPTIONS = [...PRESSURE_UNITS.map((u) => [u, u]), ['mH2O', 'm of water'], ['cmH2O', 'cm of water'], ['ftH2O', 'ft of water']];
const HEADING_UNITS = ['kPa', 'psi', 'mbar', 'hPa', 'mmHg', 'inHg', 'mH2O', 'cmH2O', 'ftH2O'];
const ORDER = [['dmy', 'Day first (31/12/2026)'], ['mdy', 'Month first (12/31/2026)']];
const LENGTH = unitOptions(['m', 'ft']);
const WHEN = /^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?$/;
// Date and time as read, kept to the second, for the download.
const stamp = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : '');
// To the minute, as manual readings are written. The no-break space keeps it on one line.
const minute = (t, gap = ' ') => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', gap) : '');
// The form fields that belong to each file: time, time of day, pressure, unit, date order.
const FILE_FIELDS = { logger: ['lTime', 'lTime2', 'lP', 'lUnit', 'lOrder'], baro: ['bTime', 'bTime2', 'bP', 'bUnit', 'bOrder'] };
// Lengths to a thousandth, blank when missing. Unlike format.js fixed(), a hyphen for
// the minus sign, as the method text and the workbook have always written it.
const thousandths = (x) => (Number.isFinite(x) ? x.toFixed(3) : '');

// Manual reading k has a date and time or a depth filled in.
const hasReading = (v, k) => v[`w${k}`] !== undefined || v[`d${k}`] !== undefined;

function readingFields() {
  const out = [];
  for (let k = 2; k <= READINGS; k++) {
    const show = (v) => k === 2 || hasReading(v, k - 1) || hasReading(v, k);
    out.push({ id: `w${k}`, label: `Manual reading ${k}, date and time`, type: 'text', placeholder: 'e.g. 2026-08-13 06:00', show },
      { id: `d${k}`, label: `Manual reading ${k}, depth to water`, type: 'number', show });
  }
  return out;
}

const readingCount = (v) => Array.from({ length: READINGS }, (_, i) => i + 1).filter((k) => hasReading(v, k)).length;
const usesPressure = (v) => isPressure(v.lUnit) || isPressure(v.bUnit);

function manualReadings(v) {
  const out = [];
  for (let k = 1; k <= READINGS; k++) {
    const w = v[`w${k}`], d = v[`d${k}`];
    if (w === undefined && d === undefined) continue;
    if (w === undefined || d === undefined) throw new Error(`Manual reading ${k} needs both a date and time and a depth to water.`);
    if (!WHEN.test(w)) throw new Error(`Write the date and time of manual reading ${k} as year-month-day hour:minute, for example 2026-08-13 06:00.`);
    out.push({ t: parseStamp(w, false), depth: d * UNITS[v.dUnit] });
  }
  return out;
}

function densityOf(v) {
  if (!usesPressure(v)) return { rho: undefined, said: 'None: both records are lengths of water as the loggers reported them.' };
  if (v.basis === 'temp') return { rho: kellDensity(v.tempC), said: `Fresh water at ${v.tempC} °C, from Kell (1975)` };
  return { rho: v.rho, said: 'As entered' };
}

// Plain warnings about entries that run but may be wrong.
function entryNotes(v, baro) {
  const out = [];
  for (let k = 1; k <= READINGS; k++) {
    const d = v[`d${k}`];
    if (d < 0) out.push(`Manual reading ${k} has a depth to water below zero (${d} ${v.dUnit}): the water is above the measuring point. That is right only for a flowing well. Otherwise, check the sign.`);
  }
  // Air pressure anywhere people live is between about 50 and 108 kPa. UNITS gives
  // every pressure and water unit in metres of water, so any of them converts to kPa.
  const air = median(baro.p.filter((x) => Number.isFinite(x) && !isMissingCode(x)));
  const kPa = air * UNITS[baro.unit] / UNITS.kPa;
  if (Number.isFinite(kPa) && (kPa < 50 || kPa > 108)) {
    out.push(`The barologger readings have a median of ${sig(air, 4)} ${baro.unit}, which is ${sig(kPa, 3)} kPa. Air pressure is between about 50 and 108 kPa, so check the barologger unit, and the logger unit with it.`);
  }
  return out;
}

// How the offset was carried between manual readings, for the method text.
function driftLine(r) {
  if (r.readings.length === 1) return 'With one manual reading, that offset is used for the whole record.';
  if (r.linear) return 'Linear drift correction: the offset changes in a straight line from one manual reading to the next, so the result matches every manual reading. Before the first reading the first offset is used, and after the last the last offset. Prorating drift linearly in time between field visits follows Wagner et al. (2006).';
  return 'No drift correction: the offset from the first manual reading is used for the whole record. The difference at each later reading is in the manual readings table.';
}

function describe(v, r, rho, files) {
  const u = v.dUnit, L = UNITS[u];
  const steps = [{
    title: 'Barometer on the logger times',
    lines: ['Each logger time gets the barometer interpolated in a straight line between the barologger readings either side of it. Logger times before the first or after the last barologger reading are left blank: the barometer is never extrapolated.', 'Times are read as written in each file, so both loggers must keep the same clock.'],
    numbers: [
      ['Logger file', files.logger.name],
      ['Barologger file', files.baro.name],
      ['Barologger record', `${minute(r.baroSpan[0])} to ${minute(r.baroSpan[1])}`],
      ['Longest step between barometer readings, minutes', String(Math.round(r.longestBaroStepMs / 60e3))],
      ['Logger readings with no barometer', String(r.counts.noBaro)],
    ],
  }, r.pressure ? {
    title: 'Water column above the sensor',
    lines: ['A non-vented logger reads the pressure of the water above it plus the air pressure; how such transducers work is set out by Freeman et al. (2004). The barometer is subtracted from the logger pressure, and the difference is the weight of the water above the sensor. Both are converted to pascals first, then to a height of water h, with ρ the water density and g the acceleration of gravity.'],
    formula: 'h = (P_logger − P_baro) / (ρg)',
    numbers: [
      ['Logger unit', v.lUnit],
      ['Barologger unit', v.bUnit],
      [`Water density, ρ (${unit('kg/m3')})`, rho.rho.toFixed(3)],
      ['Density from', rho.said],
      ['Gravity, g (m/s²)', `${G}, standard gravity (CGPM 1901)`],
    ],
  } : {
    title: 'Water column above the sensor',
    lines: ['A non-vented logger reads the water above it plus the air pressure; how such transducers work is set out by Freeman et al. (2004). Both records are lengths of water, already converted by the loggers. The barometer is subtracted as it is, so the loggers\' own conversion stands and no density is applied here.'],
    formula: 'h = L_logger − L_baro',
    numbers: [['Logger unit', v.lUnit], ['Barologger unit', v.bUnit]],
  }, {
    title: 'Depth to water',
    lines: ['At each manual reading, the water column is interpolated between the logger readings either side of it. The offset is the manual depth plus that water column. Depth to water is the offset less the water column.', driftLine(r)],
    formula: 'offset = manual depth + h at the reading;  depth to water = offset − h',
    numbers: [
      ['Measuring point', v.mp],
      ['Manual readings', String(r.readings.length)],
      ...r.readings.map((x, i) => [`Offset at reading ${i + 1} (${u})`, thousandths(x.offset / L)]),
    ],
  }];
  if (r.elevation) {
    steps.push({
      title: 'Water level elevation',
      lines: ['The measuring point elevation less the depth to water.'],
      formula: 'elevation = measuring point elevation − depth to water',
      numbers: [[`Measuring point elevation (${u})`, String(v.mpElev)]],
    });
  }
  const references = [];
  if (r.pressure && v.basis === 'temp') references.push('Kell, G.S. (1975) Density, thermal expansivity, and compressibility of liquid water from 0 to 150 °C. Journal of Chemical and Engineering Data 20(1), 97-105.');
  if (r.pressure) references.push('CGPM, General Conference on Weights and Measures (1901) Declaration on the unit of mass and on the definition of weight; conventional value of gn. Comptes rendus de la 3e Conférence générale des poids et mesures, 70.');
  references.push('Freeman, L.A., Carpenter, M.C., Rosenberry, D.O., Rousseau, J.P., Unger, R., and McLean, J.S. (2004) Use of submersible pressure transducers in water-resources investigations. U.S. Geological Survey Techniques of Water-Resources Investigations, book 8, chapter A3, 52 p. doi:10.3133/twri08A3.');
  if (r.linear) references.push('Wagner, R.J., Boulger, R.W., Jr., Oblinger, C.J., and Smith, B.A. (2006) Guidelines and standard procedures for continuous water-quality monitors: station operation, record computation, and data reporting. U.S. Geological Survey Techniques and Methods 1-D3.');
  return { steps, references: references.sort() };
}

function fileNotes(r, files, untimed) {
  const out = [];
  if (r.counts.noBaro) out.push(`${r.counts.noBaro} logger readings fall outside the barologger record and are left blank.`);
  if (untimed.logger) out.push(`${untimed.logger} rows of ${files.logger.name} have no date and time that could be read, so they have no result.`);
  if (untimed.baro) out.push(`${untimed.baro} rows of ${files.baro.name} have no date and time that could be read, so they were not used.`);
  if (r.counts.loggerCodes || r.counts.baroCodes) out.push(`Fill codes such as -9999 were read as blanks: ${r.counts.loggerCodes} in the logger file, ${r.counts.baroCodes} in the barologger file.`);
  if (r.counts.negative) out.push(`The water column is below zero at ${r.counts.negative} readings. Check that the logger is non-vented and that both units are right.`);
  return out;
}

export default {
  id: 'logger',
  group: 'levels',
  title: 'Convert logger readings to water levels',
  blurb: 'You have a non-vented logger, a barologger and manual readings. Get depth to water and water level elevation, with any drift shown.',
  lede: 'Subtracts the barologger from a non-vented logger, converts the pressure to a height of water, and ties it to your manual depth-to-water readings, with optional linear drift correction.',
  mount(host) {
    const files = { logger: null, baro: null };
    // True while the form holds the invented example, so a file loaded next clears it all.
    let fromExample = false;
    // The example's note, carried into the workbook with the page's other notes.
    let about = null;
    const out = el('div', { class: 'stack' });
    const showError = (msg) => { out.textContent = ''; out.append(errorBox(msg)); };
    // A file that could not be read, or was dropped outside both boxes, is reported here.
    // Hidden while empty, so it adds no gap under the status line.
    const problem = el('div', { class: 'stack', hidden: true });
    const say = (msg) => {
      problem.textContent = '';
      problem.hidden = !msg;
      if (msg) problem.append(errorBox(msg));
    };
    // What was loaded last, directly under the drop boxes, as on every tool.
    const loadedLine = el('p', { class: 'hint loaded', role: 'status', hidden: true });
    const setLoaded = (text, note = null) => { loadedLine.textContent = text; loadedLine.hidden = !text; about = note; };
    // Whether each file's dates could be read either way, worked out once per column.
    const order = {};
    const ambiguous = (which, col) => {
      if (!files[which] || col === undefined) return false;
      const key = `${which}:${col}`;
      if (!(key in order)) order[key] = detectDayFirst(files[which].table.rows.map((row) => row[col])) === null;
      return order[key];
    };

    const ex = exampleRecords();
    const exButton = el('button', { class: 'btn quiet', type: 'button', 'data-example': '0', 'aria-pressed': 'false', onclick: () => useExample() }, 'Invented example (known answer)');
    // Wrapped, because on a phone .drop-actions is placed in the drop box's second grid
    // column, which would add a column to the page.
    host.append(el('div', {}, el('div', { class: 'drop-actions' }, exButton)));

    const zones = {};
    let target = null;
    for (const [which, title] of [['logger', 'Logger file'], ['baro', 'Barologger file']]) {
      const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.dat,.xlsx,.xls,.xlsm', hidden: true });
      input.addEventListener('change', () => { if (input.files[0]) take(which, input.files[0]); input.value = ''; });
      const name = el('p', { class: 'hint' }, 'No file yet.');
      zones[which] = name;
      host.append(el('section', { class: 'drop', ondrop: () => { target = which; } },
        el('div', { class: 'strata', 'aria-hidden': 'true' }),
        el('div', {}, el('strong', {}, title), el('span', {}, which === 'logger' ? 'The non-vented logger in the well. Drop it on this box.' : 'The barometer at the surface. Drop it on this box.'), name),
        el('div', { class: 'drop-actions' }, input, el('button', { class: 'btn', type: 'button', 'aria-label': which === 'logger' ? 'Choose the logger file' : 'Choose the barologger file', onclick: () => input.click() }, 'Choose a file'))));
    }
    host.append(loadedLine, problem);
    columnSpec(host, {
      columns: [
        { name: 'Date and time', need: 'Required', what: 'When each reading was taken. A date column with a separate time column also works.', headings: ['Date and time', 'Date', 'Time'] },
        { name: 'Pressure', need: 'Required', what: 'The logger\'s absolute (non-vented) reading, or the barologger\'s air pressure, in one unit.', headings: ['Pressure (kPa)', 'Barometric pressure (kPa)'] },
      ],
      notes: [
        'Two files: the logger in the well and the barologger at the surface. Each needs a date and time column and a pressure column.',
        'Times are read as written. Both loggers and your manual readings must keep the same clock.',
        'Other columns, such as temperature, are kept as they are in the download.',
      ],
      examples: [
        { label: 'Example logger file', ...ex.logger, name: 'example-logger.xlsx' },
        { label: 'Example barologger file', ...ex.baro, name: 'example-barologger.xlsx' },
      ],
    });
    state.extraDrop = (file) => {
      const which = target;
      target = null;
      if (which) take(which, file);
      else say('Drop the file on the logger box or the barologger box, so it is clear which one it is.');
    };

    const f = form(host, {
      fields: [
        { id: 'lTime', label: 'Logger date and time column', type: 'column', required: true },
        { id: 'lP', label: 'Logger pressure column', type: 'column', required: true },
        { id: 'lUnit', label: 'Logger pressure unit', type: 'select', options: UNIT_OPTIONS, required: true },
        { id: 'lOrder', label: 'Date order in the logger file', type: 'select', options: ORDER, required: (v) => ambiguous('logger', v.lTime), show: (v) => ambiguous('logger', v.lTime) },
        { id: 'bTime', label: 'Barologger date and time column', type: 'column', required: true },
        { id: 'bP', label: 'Barologger pressure column', type: 'column', required: true },
        { id: 'bUnit', label: 'Barologger pressure unit', type: 'select', options: UNIT_OPTIONS, required: true },
        { id: 'bOrder', label: 'Date order in the barologger file', type: 'select', options: ORDER, required: (v) => ambiguous('baro', v.bTime), show: (v) => ambiguous('baro', v.bTime) },
        { id: 'basis', label: 'Water density', type: 'select', options: [['temp', 'Fresh water, from its temperature'], ['given', 'A density you give']], required: usesPressure, show: usesPressure, hint: 'Pressure is turned into a height of water with this density.' },
        { id: 'tempC', label: `Water temperature (${unit('deg C')})`, type: 'number', required: (v) => usesPressure(v) && v.basis === 'temp', show: (v) => usesPressure(v) && v.basis === 'temp', hint: 'Density of pure water from Kell (1975), 0 to 150 °C.' },
        { id: 'rho', label: `Water density (${unit('kg/m3')})`, type: 'number', required: (v) => usesPressure(v) && v.basis === 'given', show: (v) => usesPressure(v) && v.basis === 'given' },
        { id: 'dUnit', label: 'Unit of the manual depths', type: 'select', options: LENGTH, required: true },
        { id: 'mp', label: 'Measuring point (description)', type: 'text', required: true, placeholder: 'e.g. top of casing' },
        { id: 'w1', label: 'Manual reading 1, date and time', type: 'text', required: true, placeholder: 'e.g. 2026-08-03 10:00', hint: 'Year-month-day hour:minute, on the loggers\' clock.' },
        { id: 'd1', label: 'Manual reading 1, depth to water', type: 'number', required: true, hint: 'Below the measuring point, in the unit above.' },
        { id: 'drift', label: 'With more than one manual reading', type: 'select', options: [['constant', 'Constant offset (first reading)'], ['linear', 'Linear drift correction']], hint: 'Linear: the offset runs in a straight line from one reading to the next.', required: (v) => readingCount(v) > 1, show: (v) => readingCount(v) > 1 },
        { id: 'lTime2', label: 'Logger time of day column, if separate', type: 'column' },
        { id: 'bTime2', label: 'Barologger time of day column, if separate', type: 'column' },
        { id: 'mpElev', label: 'Measuring point elevation, in the unit of the depths', type: 'number', hint: 'Gives water level elevation as well.' },
        ...readingFields(),
      ],
      onRun(v) {
        out.textContent = '';
        say('');
        try {
          if (!files.logger || !files.baro) throw new Error('Add both the logger file and the barologger file.');
          run(v);
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });

    // A column choice offering this file's headings. Only the time of day may be left at None.
    function columnChoice(id, header = []) {
      const sel = f.element.querySelector(`#x-${id}`);
      sel.textContent = '';
      sel.add(new Option(/Time2/.test(id) ? 'None' : 'Choose a column', ''));
      header.forEach((h, i) => sel.add(new Option(h || `Column ${i + 1}`, String(i))));
      return sel;
    }

    function fillColumns(which, header) {
      const [time, time2, p, unitId] = FILE_FIELDS[which];
      const d = detect(header, files[which].table.rows);
      const press = which === 'logger'
        ? findColumn(header, /^(?!.*(baro|atmos|air)).*press/i)
        : findColumn(header, /baro|atmos|air.?press/i) ?? findColumn(header, /press/i);
      const picks = { [time]: d.time, [time2]: d.time2, [p]: press };
      for (const id of [time, time2, p]) columnChoice(id, header).value = picks[id] >= 0 ? String(picks[id]) : '';
      const named = press === undefined ? null : unitInLabel(header[press], HEADING_UNITS);
      f.set(unitId, named || '');
      f.check();
    }

    // Results, errors and the test hook from before a new file or example all go.
    function fresh() {
      out.textContent = '';
      say('');
      delete host.dataset.done;
      delete host.dataset.stale;
      const spec = host.querySelector('details.spec');
      if (spec) spec.open = false;
    }

    // A file replaces what came from its own box. After the example, it replaces the
    // whole example: the other example file and every value the example filled in.
    function load(which, file) {
      if (fromExample) {
        fromExample = false;
        exButton.setAttribute('aria-pressed', 'false');
        f.reset();
        const other = which === 'logger' ? 'baro' : 'logger';
        files[other] = null;
        zones[other].textContent = 'No file yet.';
        FILE_FIELDS[other].slice(0, 3).forEach((id) => columnChoice(id));
      } else {
        FILE_FIELDS[which].forEach((id) => f.set(id, undefined));
      }
      files[which] = file;
      Object.keys(order).forEach((k) => { delete order[k]; });
      zones[which].textContent = `${file.name}: ${file.table.rows.length} rows.`;
      fillColumns(which, file.table.header);
      setLoaded(`${file.name}: ${file.table.rows.length} rows, read as the ${which === 'logger' ? 'logger' : 'barologger'} file.`);
      fresh();
    }

    function useExample() {
      fromExample = false;
      f.reset();
      load('logger', { name: ex.logger.name, table: { header: ex.logger.header, rows: ex.logger.rows } });
      load('baro', { name: ex.baro.name, table: { header: ex.baro.header, rows: ex.baro.rows } });
      const values = {
        lTime2: 1, bTime2: 1, basis: 'temp', tempC: EXAMPLE_TRUTH.tempC, dUnit: 'm', mp: 'top of casing', mpElev: EXAMPLE_TRUTH.mpElevation,
      };
      Object.entries(values).forEach(([k, val]) => f.set(k, val));
      ex.readings.forEach((m, i) => { f.set(`w${i + 1}`, m.when); f.set(`d${i + 1}`, m.depth); });
      f.set('drift', 'linear');
      fromExample = true;
      exButton.setAttribute('aria-pressed', 'true');
      const note = `Invented records, not a real well. The sensor hangs ${EXAMPLE_TRUTH.sensorDepth} m below the top of casing (elevation ${EXAMPLE_TRUTH.mpElevation} m) in water at ${EXAMPLE_TRUTH.tempC} °C, and drifts ${EXAMPLE_TRUTH.driftPerDay * 1000} mm a day. The true answer: the manual readings table shows the logger reading 6 mm and 11 mm shallow at the second and third readings (the planted 6.0 and 11.8 mm, less the rounding of the manual readings to the millimetre), and with linear drift correction the depths match the true ones to within 0.3 mm. The barologger starts an hour late and stops an hour early, so 8 logger readings stay blank.`;
      setLoaded(note, note);
    }

    async function take(which, file) {
      say('');
      try {
        load(which, await readFile(file));
      } catch (e) {
        say(`${file.name} could not be read. ${e.message}`);
      }
    }

    // One file's readings as times in ms, pressures and their unit.
    function series(which, v) {
      const [time, time2, p, pUnit, ord] = FILE_FIELDS[which].map((id) => v[id]);
      const tbl = files[which].table;
      const found = detectDayFirst(tbl.rows.map((row) => row[time]));
      const dayFirst = found === null ? ord === 'dmy' : found;
      const t = tbl.rows.map((row) => {
        const d = parseStamp(row[time], dayFirst);
        return time2 === undefined ? d : d + timeFraction(row[time2]);
      });
      return { t, p: columnValues(tbl, p), unit: pUnit };
    }

    function run(v) {
      const L = UNITS[v.dUnit], u = v.dUnit;
      const logger = series('logger', v), baro = series('baro', v);
      const rho = densityOf(v);
      const r = convertLogger({
        logger, baro, density: rho.rho, readings: manualReadings(v), drift: v.drift,
        mpElevation: v.mpElev === undefined ? undefined : v.mpElev * L,
      });
      const untimed = { logger: logger.t.filter((x) => !Number.isFinite(x)).length, baro: baro.t.filter((x) => !Number.isFinite(x)).length };
      const pageNotes = [...entryNotes(v, baro), ...fileNotes(r, files, untimed)];
      const text = { ...describe(v, r, rho, files), notes: [...(about ? [about] : []), ...pageNotes] };
      const t0 = logger.t.reduce((a, b) => (b < a ? b : a), Infinity);
      const dayOf = (t) => (t - t0) / DAY;
      const x = logger.t.map(dayOf);
      const depth = r.depth.map((d) => d / L), column = r.column.map((c) => c / L);
      // The drift, which is what this table is for, comes right after the manual depth.
      const readingRows = r.readings.map((m, i) => [
        minute(m.t, '\u00a0'), thousandths(m.depth / L), i === 0 ? 'reference' : thousandths(m.loggerMinusManual / L),
        thousandths(m.column / L), thousandths(m.offset / L), String(Math.round(m.nearestMs / 60e3)),
      ]);
      const readingHeader = [
        'Date and time', `Manual depth to water (${u})`, `Logger minus manual, tied at the first reading (${u})`,
        `Water column above sensor (${u})`, `Offset (${u})`, 'Nearest logger reading (minutes away)',
      ];
      const shown = r.depth.filter(Number.isFinite).length;
      // Each file's own columns first, as it gave them, with a name for any blank heading.
      const headings = (which) => files[which].table.header.map((h, i) => h || `Column ${i + 1}`);
      const sheets = [{
        name: 'Water levels',
        header: [
          ...headings('logger'), 'Date and time as read', `Barometer at this time (${v.bUnit})`, `Water column above sensor (${u})`,
          `Offset (${u})`, `Depth to water below ${v.mp} (${u})`, ...(r.elevation ? [`Water level elevation (${u})`] : []),
        ],
        rows: files.logger.table.rows.map((row, i) => [
          ...row, stamp(logger.t[i]), r.baroAt[i], column[i], r.offset[i] / L, depth[i], ...(r.elevation ? [r.elevation[i] / L] : []),
        ]),
      }, {
        name: 'Manual readings',
        header: readingHeader,
        rows: r.readings.map((m, i) => [minute(m.t), m.depth / L, i === 0 ? 'reference' : m.loggerMinusManual / L, m.column / L, m.offset / L, m.nearestMs / 60e3]),
      }, {
        name: 'Barologger',
        header: [...headings('baro'), 'Date and time as read'],
        rows: files.baro.table.rows.map((row, i) => [...row, stamp(baro.t[i])]),
      }];
      const since = `Days since ${minute(t0)}`, book = `${files.logger.name.replace(/\.[^.]+$/, '')}-water-levels.xlsx`;
      // The measuring point can be a long description, so it goes in the caption, not the axis.
      // The manual readings, drawn as points over a line from the logger.
      const atReadings = (label, value) => ({ label, x: r.readings.map((m) => dayOf(m.t)), y: r.readings.map((m) => value(m) / L), line: false, size: 11 });
      const charts = [
        [chart({
          title: 'Depth to water', xLabel: since, yLabel: `Depth to water (${u})`, invertY: true,
          series: [{ label: 'From the logger', x, y: depth }, atReadings('Manual readings', (m) => m.depth)],
        }),
        el('p', { class: 'chart-sub' }, `Depth below the measuring point: ${v.mp}.`)],
        [chart({ title: 'Water column above the sensor', xLabel: since, yLabel: `Water column (${u})`, series: [{ label: 'Water column', x, y: column }] })],
      ];
      if (r.readings.length > 1) {
        charts.push([chart({
          title: 'Offset', xLabel: since, yLabel: `Offset (${u})`,
          series: [{ label: 'Offset used', x, y: r.offset.map((o) => o / L) }, atReadings('Offset at each manual reading', (m) => m.offset)],
        })]);
      }
      const n = r.readings.length;
      let how = `${n} manual readings, with the first reading's offset and no drift correction`;
      if (n === 1) how = 'one manual reading, as a constant offset';
      else if (r.linear) how = `${n} manual readings, with linear drift correction`;
      out.append(panel(
        el('h2', {}, 'Water levels'),
        el('p', { class: 'chart-sub' }, `${shown} of ${logger.t.length} logger readings converted, tied to ${how}.`),
        el('h3', {}, 'Manual readings'),
        table(readingHeader, readingRows),
        notes(pageNotes),
        downloads(() => downloadWorkbook(book, sheets, text))),
      ...charts.map((c) => panel(...c)),
      methodPanel(text));
    }

    host.append(out);
  },
};
