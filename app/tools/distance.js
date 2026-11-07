// Several observation wells: the Cooper and Jacob distance-drawdown line at one time,
// and one Theis curve fitted to all the wells at once on drawdown against t/r².
import { RATE_UNITS, TIME_UNITS, UNITS } from '../../engine/index.js';
import { compositeCurve, compositeTheis, distanceDrawdown, groupWells } from '../../engine/distance.js';
import { STRAIGHT_LINE_U, wellFunction } from '../../engine/pumping.js';
import { timeUnitIn, unitInLabel } from '../columns.js';
import { toCsv, together } from '../format.js';
import { chart, columnSpec, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table, TIME_OPTIONS, unit, unitOptions } from '../kit.js';

const LENGTH = ['m', 'ft'];
const DRAWDOWN = ['m', 'cm', 'ft'];
const RATES = unitOptions(Object.keys(RATE_UNITS));
const LAYOUTS = [['long', 'One row per reading'], ['wide', 'One column per well']];

// Kruseman and de Ridder (1994), Table 3.1, after Wit (1963): minutes and metres.
const OUDE_KORENDIJK = {
  H30: [30, '0.1 0.04 0.25 0.08 0.5 0.13 0.7 0.18 1 0.23 1.4 0.28 1.9 0.33 2.33 0.36 2.8 0.39 3.36 0.42 4 0.45 5.35 0.5 6.8 0.54 8.3 0.57 8.7 0.58 10 0.6 13.1 0.64 18 0.68 27 0.742 33 0.753 41 0.779 48 0.793 59 0.819 80 0.855 95 0.873 139 0.915 181 0.935 245 0.966 300 0.99 360 1.007 480 1.05 600 1.053 728 1.072 830 1.088'],
  H90: [90, '1.5 0.015 2 0.021 2.16 0.023 2.66 0.044 3 0.054 3.5 0.075 4 0.09 4.33 0.104 5.5 0.133 6 0.153 7.5 0.178 9 0.206 13 0.25 15 0.275 18 0.305 25 0.348 30 0.364 40 0.404 53 0.429 60 0.444 75 0.467 90 0.494 105 0.507 120 0.528 150 0.55 180 0.569 248 0.593 301 0.614 363 0.636 422 0.657 542 0.679 602 0.688 680 0.701 785 0.718 845 0.716'],
  H215: [215, '66 0.089 127 0.138 185 0.165 251 0.186 305 0.196 366 0.207 430 0.214 606 0.227 780 0.25'],
};
const okHeader = ['Well', 'Distance (m)', 'Time (min)', 'Drawdown (m)'];
const okRows = Object.entries(OUDE_KORENDIJK).flatMap(([name, [r, text]]) => {
  const v = text.split(' ').map(Number);
  return v.filter((_, i) => i % 2 === 0).map((t, i) => [name, r, t, v[2 * i + 1]]);
});

// Invented: Theis drawdown for T 250 m2/d, S 0.0001 and 500 m3/d at 15, 50 and 120 m,
// rounded to the millimetre.
const INVENTED = { T: 250, S: 1e-4, Q: 500, r: [15, 50, 120] };
const inventedHeader = ['Time (min)', 'W15', 'W50', 'W120'];
const invented = (r, minutes) => {
  const { T, S, Q } = INVENTED;
  return Math.round(1000 * (Q / (4 * Math.PI * T)) * wellFunction((r * r * S) / (4 * T * (minutes / 1440)))) / 1000;
};
const inventedRows = [1, 2, 3, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 720, 960, 1200, 1440]
  .map((m) => [m, ...INVENTED.r.map((r) => invented(r, m))]);

const EXAMPLES = [
  { label: 'Oude Korendijk (one row per reading)', name: 'oude-korendijk.csv', csv: toCsv(okHeader, okRows), source: 'wit',
    fill: { layout: 'long', timeUnit: 'min', sUnit: 'm', rUnit: 'm', Q: 788, qUnit: 'm3/d', tAt: 140, leaveOut: 'H215' },
    note: together(`Real data: the Oude Korendijk test, 788 m³/d, piezometers at 30, 90 and 215 m (Kruseman and de Ridder 1994, Table 3.1, after Wit 1963). The rate, the 140 minute time and leaving out H215 are the book's choices in its Example 3.5, filled in below. From its line the book gets 0.78 m per log cycle, r0 = 450 m, T = 370 m²/d and S = ${sig(4.1e-4, 2, true)}. On H30 and H90 together, TTim and AQTESOLV fit Theis with a hydraulic conductivity K of 66.1 m/d over a 7 m thick aquifer, which is T = 463 m²/d.`) },
  { label: 'Invented (one column per well)', name: 'invented-three-wells.csv', csv: toCsv(inventedHeader, inventedRows),
    fill: { layout: 'wide', timeUnit: 'min', sUnit: 'm', rUnit: 'm', Q: 500, qUnit: 'm3/d', tAt: 600, distances: '15, 50, 120' },
    note: together(`Invented data, not a real test: Theis drawdown computed for T = 250 m²/d and S = ${sig(1e-4, 3, true)} at 500 m³/d, at 15, 50 and 120 m, rounded to the millimetre. Both analyses should come back close to T = 250 m²/d and S = ${sig(1e-4, 3, true)}. The values below are filled in to match.`) },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const plural = (list, one, many) => `${list.join(', ')} ${list.length === 1 ? one : many}`;
const nameIn = (cell) => (cell === null || cell === undefined ? '' : String(cell).trim());
const columnName = (header, i) => header[i] || `Column ${i + 1}`;

/** Rows of { name, r, t, s } in the user's units, from either layout. */
function readRows(tab, v, wideCols) {
  const rows = [];
  if (v.layout === 'long') {
    for (const row of tab.rows) rows.push({ name: nameIn(row[v.wellCol]), r: num(row[v.distCol]), t: num(row[v.timeCol]), s: num(row[v.sCol]) });
    return rows;
  }
  const typed = v.distances.split(/[,;\s]+/).filter(Boolean);
  const r = typed.map(Number);
  const names = wideCols.map((i) => columnName(tab.header, i));
  const notNumbers = typed.filter((x) => !Number.isFinite(Number(x)));
  if (r.length !== wideCols.length || notNumbers.length) {
    const bad = notNumbers.length ? `, and ${notNumbers.join(', ')} is not a number` : '';
    throw new Error(`Enter one distance for each drawdown column, in order: ${names.join(', ')}. ${r.length} given${bad}.`);
  }
  const below = names.filter((_, k) => r[k] < 0);
  if (below.length) throw new Error(`Each distance in "Distance to each well" must be zero or above: ${below.map((n) => `${n} is ${r[names.indexOf(n)]} ${v.rUnit}`).join(', ')}.`);
  wideCols.forEach((c, k) => { for (const row of tab.rows) rows.push({ name: names[k], r: r[k], t: num(row[v.timeCol]), s: num(row[c]) }); });
  return rows;
}

function attempt(f) {
  try { return { value: f() }; } catch (e) { return { error: e.message }; }
}

export default {
  id: 'distance',
  title: 'Analyze several observation wells',
  blurb: 'You watched a pumping test in several observation wells. Fit a distance-drawdown line and one Theis curve to all the wells together.',
  lede: 'Two standard analyses for a constant-rate test watched at several distances: the Cooper and Jacob distance-drawdown line at one time, and one Theis curve fitted to every well at once on drawdown against t/r².',
  mount(host) {
    let data = null;
    const out = el('div', { class: 'stack' });
    const showError = (message) => out.append(errorBox(message));
    const isLong = (v) => v.layout === 'long', isWide = (v) => v.layout === 'wide';
    const wideCols = () => {
      const v = f.values();
      if (!data || v.timeCol === undefined) return [];
      const { header, rows } = data.table;
      return header.map((_, i) => i).filter((i) => i !== v.timeCol && rows.some((r) => typeof r[i] === 'number'));
    };
    // One format on every tool: the file and its rows, then for an example its note.
    // With one column per well, the drawdown columns come between, in the order the
    // distances must be typed, so the line changes with the layout.
    const describe = () => {
      if (!data) { drop.status(''); return; }
      const v = f.values(), cols = wideCols();
      drop.status(`${data.name}: ${data.table.rows.length} rows.`
        + (isWide(v) && cols.length ? ` Drawdown columns, in order: ${cols.map((i) => columnName(data.table.header, i)).join(', ')}.` : '')
        + (data.example ? ` ${data.example.note}` : ''));
    };
    const drop = fileDrop(host, {
      text: 'A table of drawdown in several observation wells: one row per reading, or one column per well.',
      examples: EXAMPLES,
      onTable(loaded) {
        const { header } = loaded.table;
        data = loaded;
        out.textContent = '';
        f.reset();
        f.setColumns(header);
        const cols = {
          wellCol: findColumn(header, /^\s*(well|piezometer|observation)/i),
          distCol: findColumn(header, /\b(distance|radius)\b/i),
          timeCol: findColumn(header, /\b(time|elapsed)\b/i),
          sCol: findColumn(header, /\bdrawdown\b/i),
        };
        for (const [k, i] of Object.entries(cols)) f.set(k, i);
        if (cols.wellCol !== undefined && cols.distCol !== undefined && cols.sCol !== undefined) f.set('layout', 'long');
        if (cols.timeCol !== undefined) f.set('timeUnit', timeUnitIn(header[cols.timeCol]));
        if (cols.sCol !== undefined) f.set('sUnit', unitInLabel(header[cols.sCol], DRAWDOWN));
        if (cols.distCol !== undefined) f.set('rUnit', unitInLabel(header[cols.distCol], LENGTH));
        if (loaded.example) for (const [k, val] of Object.entries(loaded.example.fill)) f.set(k, val);
        describe();
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Well', need: 'Required', what: 'The name of the observation well. Only with one row per reading.', headings: ['Well'] },
        { name: 'Distance', need: 'Required', what: 'Distance from the pumped well to this well, the same on every row of a well. Only with one row per reading.', headings: ['Distance (m)', 'Distance (ft)'] },
        { name: 'Elapsed time', need: 'Required', what: 'Time since pumping began.', headings: ['Time (min)', 'Time (h)', 'Time (d)'] },
        { name: 'Drawdown', need: 'Required', what: 'Drawdown, positive downward. With one column per well, each column is a well and its heading is the well name.', headings: ['Drawdown (m)', 'Drawdown (ft)', 'H30'] },
      ],
      notes: ['The pumping rate must be constant for the whole test.', 'With one column per well, enter the distances in the form, in column order.', 'Units are never assumed. A unit in brackets at the end of a heading is read; anything else is chosen below.'],
      examples: [
        { label: EXAMPLES[0].label, name: 'several-wells-one-row-per-reading.xlsx', header: okHeader, rows: okRows },
        { label: EXAMPLES[1].label, name: 'several-wells-one-column-per-well.xlsx', header: inventedHeader, rows: inventedRows },
      ],
    });
    const f = form(host, {
      fields: [
        { id: 'layout', label: 'How the table is laid out', type: 'select', options: LAYOUTS, required: true, hint: 'One row per reading: well, distance, time and drawdown on each row. One column per well: a time column, then a drawdown column for each well.' },
        { id: 'wellCol', label: 'Well name column', type: 'column', required: isLong, show: isLong },
        { id: 'distCol', label: 'Distance column', type: 'column', required: isLong, show: isLong },
        { id: 'timeCol', label: 'Elapsed time column', type: 'column', required: true },
        { id: 'sCol', label: 'Drawdown column', type: 'column', required: isLong, show: isLong },
        { id: 'distances', label: 'Distance to each well, in column order', type: 'text', required: isWide, show: isWide, placeholder: 'e.g. 15, 50, 120', hint: 'The drawdown columns are listed under the drop box once a file is loaded.' },
        { id: 'timeUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'sUnit', label: 'Drawdown unit', type: 'select', options: unitOptions(DRAWDOWN), required: true },
        { id: 'rUnit', label: 'Distance unit', type: 'select', options: unitOptions(LENGTH), required: true },
        { id: 'Q', label: 'Pumping rate', type: 'number', required: true },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'tAt', label: 'Time for the line', type: 'number', required: true, hint: 'The time of the distance-drawdown line, in the time unit above. Drawdown at this time is read from each well\'s own readings.' },
        { id: 'leaveOut', label: 'Wells to leave out, separated by commas', type: 'text', placeholder: 'e.g. H215' },
      ],
      onRun(v) {
        out.textContent = '';
        delete host.dataset.done;
        try {
          if (!data) throw new Error('Add a file first.');
          show(out, run(data, v, wideCols()), v);
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });
    f.element.addEventListener('change', describe);
    host.append(out);
  },
};

function run(data, v, cols) {
  const TU = TIME_UNITS[v.timeUnit], SU = UNITS[v.sUnit], RU = UNITS[v.rUnit], Q = v.Q * RATE_UNITS[v.qUnit];
  if (!(Q > 0)) throw new Error('The pumping rate must be above zero.');
  if (!(v.tAt > 0)) throw new Error('The time for the distance-drawdown line must be above zero.');
  const chosen = v.layout === 'long' ? [v.wellCol, v.distCol, v.timeCol, v.sCol] : [v.timeCol];
  if (new Set(chosen).size < chosen.length) throw new Error('The same column is chosen twice. Choose a different column for the well name, distance, time and drawdown.');
  const read = readRows(data.table, v, cols);
  const below = [...new Set(read.filter((p) => p.r < 0).map((p) => p.name))];
  if (below.length) throw new Error(`Distances must be zero or above. In the distance column, ${below.map((n) => `${n} is at ${read.find((p) => p.name === n).r} ${v.rUnit}`).join(', ')}.`);
  const complete = read.filter((p) => p.name !== '' && Number.isFinite(p.r) && Number.isFinite(p.t) && Number.isFinite(p.s));
  const early = complete.filter((p) => p.t < 0);
  if (early.length) throw new Error(`Elapsed times must be zero or above. ${early.length} ${early.length === 1 ? 'reading has' : 'readings have'} a time below zero, the first at ${early[0].name}, ${early[0].t} ${v.timeUnit}.`);
  const all = groupWells(complete.map((p) => ({ name: p.name, r: p.r * RU, t: p.t * TU, s: p.s * SU })));
  if (!all.length) throw new Error('No readings with a well, a distance, a time and a drawdown were found.');
  const leave = (v.leaveOut || '').split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = leave.filter((n) => !all.some((w) => w.name === n));
  if (unknown.length) throw new Error(`No well called ${unknown.join(', ')}. The wells are ${all.map((w) => w.name).join(', ')}.`);
  const atWell = all.filter((w) => w.r === 0).map((w) => w.name);
  const wells = all.filter((w) => !leave.includes(w.name) && w.r > 0);
  if (!wells.length) throw new Error('No wells are left to analyze.');
  const tAt = v.tAt * TU;
  const line = attempt(() => distanceDrawdown(wells, tAt, Q));
  const theis = attempt(() => compositeTheis(wells, Q));
  if (line.error && theis.error) throw new Error(`${line.error} ${theis.error}`);
  return { wells, leave, atWell, skipped: read.length - complete.length, tAt, Q, line, theis, TU, SU, RU, example: data.example };
}

/**
 * Every number shown, formatted once, so the results, the notes under them and the
 * method text agree. Lengths are in the user's units, T in their distance unit squared
 * per day.
 */
function formats(res, v) {
  const { line: { value: L }, theis: { value: C }, SU, RU } = res;
  const metric = v.rUnit === 'm';
  // Trailing zeros are kept, so 1.00 × 10⁻⁴ is not shortened to 1 × 10⁻⁴.
  const T = (x) => sig(x / RU ** 2, 4, true), TSI = (x) => sig(x, 4, true), S = (x) => sig(x, 4, true);
  return {
    metric, tUnit: unit(`${v.rUnit}2/d`), T, TSI, S,
    ds: L ? sig(L.ds / SU, 3, true) : '', r0: L ? sig(L.r0 / RU, 3, true) : '', rms: C ? sig(C.rmse / SU, 3, true) : '',
    // The headline: the same values to 3 significant figures.
    head: { T: (x) => sig(x / RU ** 2, 3, true), S: (x) => sig(x, 3, true) },
  };
}

function warnings(res) {
  const L = res.line.value;
  const list = [];
  if (res.leave.length) list.push(`Left out of both analyses, as asked: ${res.leave.join(', ')}.`);
  if (res.atWell.length) list.push(`${plural(res.atWell, 'is', 'are')} at distance zero, the pumped well, and not used.`);
  if (res.skipped) list.push(`${res.skipped} ${res.skipped === 1 ? 'reading has' : 'readings have'} no well name, distance, time or drawdown and ${res.skipped === 1 ? 'was' : 'were'} left out.`);
  if (res.line.error) list.push(`No distance-drawdown line. ${res.line.error}`);
  if (res.theis.error) list.push(`No composite Theis fit. ${res.theis.error}`);
  if (L) {
    if (L.rows < 3) list.push(`Only ${L.rows} wells are on the distance-drawdown line. Kruseman and de Ridder (1994) ask for at least three for a reliable result.`);
    list.push('Kruseman and de Ridder (1994) advise repeating the distance-drawdown line at several times. The values of T and S should agree closely.');
  }
  return list;
}

// Where the straight line stands in for Theis at one well.
function lineCheck(res, v, w) {
  const at = `${v.tAt} ${v.timeUnit}`;
  if (!w.used) return `No readings either side of ${at}, so this well is not on the distance-drawdown line. Readings are never extended.`;
  if (w.uClass === 'strict') return 'u is below 0.01, so the straight line is within 1% of the Theis curve.';
  if (w.uClass === 'practical') return `u is between 0.01 and ${STRAIGHT_LINE_U}, so the straight line is within about 5% of the Theis curve.`;
  return `u is above ${STRAIGHT_LINE_U} at ${at}, so the straight line does not hold here. With these T and S it holds from about ${sig(w.validFrom / res.TU)} ${v.timeUnit}.`;
}

// A two-column table with any lines under it. Blocks sit side by side on a wide screen
// and one under another on a phone, so no table is wider than the page.
const block = (title, rows, lines = []) => el('div', { class: 'stack' },
  table([title, 'Value'], rows),
  lines.length ? notes(lines.map(together)) : null);

function show(out, res, v) {
  const { line: { value: L }, theis: { value: C }, TU, SU, RU } = res;
  const F = formats(res, v);
  const tRows = (T) => (F.metric ? [[`T (${F.tUnit})`, F.T(T)]] : [[`T (${F.tUnit})`, F.T(T)], ['T (m²/d)', F.TSI(T)]]);
  const label = {
    strict: 'holds, u below 0.01', practical: `holds, u 0.01 to ${STRAIGHT_LINE_U}`,
    fails: `does not hold, u above ${STRAIGHT_LINE_U}`, unknown: 'not on the line',
  };
  const perWell = res.wells.map((w) => {
    const p = L ? L.wells.find((x) => x.name === w.name) : null, m = C ? C.perWell.find((x) => x.name === w.name) : null;
    return { w, p, m, used: Boolean(p && p.used) };
  });
  const atHead = `Drawdown at ${v.tAt} ${v.timeUnit} (${v.sUnit})`, fromHead = `Straight line holds from (${v.timeUnit})`;
  const misfitHead = `Theis misfit, RMS (${v.sUnit})`, trHead = `t/r² (${v.timeUnit}/${unit(`${v.rUnit}2`)})`;
  const lineTitle = `Distance-drawdown line at ${v.tAt} ${v.timeUnit}`, compositeTitle = 'Composite Theis, wells used together';
  const text = methodText(res, v, F);
  const n = (x) => (Number.isFinite(x) ? x : null);
  // T in m²/d gets its own column only when the user's unit is not metres.
  const siColumn = (x) => (F.metric ? [] : [x]);
  const sheets = [
    { name: 'Results',
      header: ['Analysis', `T (${F.tUnit})`, ...siColumn('T (m²/d)'), 'S', `Fall per log cycle of distance (${v.sUnit})`,
        `Distance of zero drawdown r0 (${v.rUnit})`, `RMS misfit (${v.sUnit})`, 'Readings'],
      rows: [
        ...(L ? [[lineTitle, L.T / RU ** 2, ...siColumn(L.T), L.S, L.ds / SU, L.r0 / RU, null, L.rows]] : []),
        ...(C ? [[compositeTitle, C.T / RU ** 2, ...siColumn(C.T), C.S, null, null, C.rmse / SU, C.rows]] : []),
      ] },
    { name: 'Wells',
      header: ['Well', `Distance (${v.rUnit})`, 'Readings', atHead, 'u at that time', 'Straight line', fromHead, misfitHead],
      rows: perWell.map(({ w, p, m, used }) => [
        w.name, w.r / RU, w.t.length, n(p ? p.s / SU : NaN), n(used ? p.u : NaN),
        used ? label[p.uClass] : 'not on the line', n(p ? p.validFrom / TU : NaN), n(m ? m.rms / SU : NaN),
      ]) },
  ];
  if (C) {
    sheets.push({
      name: 'Composite', header: ['Well', trHead, `Drawdown (${v.sUnit})`, `Theis (${v.sUnit})`],
      rows: C.points.map((p) => [p.name, p.x * RU * RU / TU, p.s / SU, compositeCurve(C, [p.x])[0] / SU]),
    });
  }
  const analyses = [];
  if (L) {
    analyses.push(block(lineTitle, [
      ...tRows(L.T), ['S', F.S(L.S)], [`Fall per log cycle of distance, Δs (${v.sUnit})`, F.ds],
      [`Distance of zero drawdown, r0 (${v.rUnit})`, F.r0], ['Wells on the line', L.rows],
    ]));
  }
  if (C) analyses.push(block(compositeTitle, [...tRows(C.T), ['S', F.S(C.S)], [`RMS misfit (${v.sUnit})`, F.rms], ['Readings', C.rows]]));
  const wells = perWell.map(({ w, p, m, used }) => block(w.name, [
    [`Distance (${v.rUnit})`, w.r / RU],
    ...(p ? [[atHead, used ? p.s / SU : 'none'], ['u at that time', used ? p.u : 'none'], [fromHead, p.validFrom / TU]] : []),
    ...(m ? [[misfitHead, m.rms / SU], ['Readings in the composite fit', m.rows]] : []),
  ], p ? [lineCheck(res, v, p)] : []));
  const said = warnings(res);
  const ideal = 'Both methods assume an ideal confined aquifer: uniform, infinite, fully penetrated, with no leakage or boundaries.';
  // The spreadsheet carries the same caveats as the page.
  text.notes = [ideal, ...said];
  out.append(panel(
    el('h2', {}, 'Several-well fit'),
    el('p', { class: 'chart-sub' }, together([
      L ? `Distance-drawdown line: T = ${F.head.T(L.T)} ${F.tUnit}, S = ${F.head.S(L.S)}.` : '',
      C ? `Composite Theis: T = ${F.head.T(C.T)} ${F.tUnit}, S = ${F.head.S(C.S)}.` : '',
      `${res.wells.length} wells at ${v.Q} ${unit(v.qUnit)}. ${ideal}`,
    ].filter(Boolean).join(' '))),
    el('div', { class: 'two' }, analyses),
    said.length ? notes(said.map(together)) : null,
    el('h3', {}, 'Each well'),
    el('div', { class: 'two' }, wells),
    el('div', { class: 'downloads' },
      el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('several-wells.xlsx', sheets, text) }, 'Download spreadsheet'))));
  if (L) {
    const used = L.wells.filter((w) => w.used);
    const rMin = Math.min(...used.map((w) => w.r));
    out.append(panel(chart({
      title: `Drawdown at ${v.tAt} ${v.timeUnit} against distance`, xLabel: `Distance (${v.rUnit})`, yLabel: `Drawdown (${v.sUnit})`,
      logX: true, invertY: true,
      series: [
        { label: 'Wells', x: used.map((w) => w.r / RU), y: used.map((w) => w.s / SU), line: false },
        { label: 'Straight line', x: [rMin / RU, L.r0 / RU], y: [(L.intercept + L.slope * Math.log10(rMin)) / SU, 0] },
      ],
    })));
  }
  if (C) {
    const xs = C.points.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
    const grid = Array.from({ length: 80 }, (_, i) => lo * (hi / lo) ** (i / 79));
    const scale = RU * RU / TU;
    out.append(panel(chart({
      title: 'Composite plot: drawdown against t/r²', xLabel: trHead, yLabel: `Drawdown (${v.sUnit})`, logX: true, logY: true,
      series: [
        ...res.wells.map((w) => {
          const mine = C.points.filter((p) => p.name === w.name);
          return { label: w.name, x: mine.map((p) => p.x * scale), y: mine.map((p) => p.s / SU), line: false };
        }),
        { label: 'Theis fit', x: grid.map((x) => x * scale), y: compositeCurve(C, grid).map((s) => s / SU) },
      ],
    })));
  }
  out.append(panel(el('h2', {}, 'Exactly what was done'), method(text)));
}

function methodText(res, v, F) {
  const { line: { value: L }, theis: { value: C }, TU, SU, RU } = res;
  // A value as the user gave or sees it, then in metres and days when that differs.
  const both = (shown, u, si, siUnit) => (unit(u) === siUnit ? `${shown} ${siUnit}` : `${shown} ${unit(u)} = ${si} ${siUnit}`);
  const steps = [];
  const units = 'Converted to metres and days for the calculation. Each number below is given in the units you chose, then in metres and days where those differ.';
  if (L) {
    steps.push({
      title: `Drawdown at ${v.tAt} ${v.timeUnit} in each well`,
      lines: ['Read from each well\'s own readings, along a straight line in log time between the reading before and the reading after. A well with no reading on both sides is not used: readings are never extended.'],
      numbers: L.wells.map((w) => [`${w.name}, ${sig(w.r / RU, 4)} ${v.rUnit}`, w.used ? `${sig(w.s / SU, 4, true)} ${v.sUnit}` : 'no reading either side']),
    });
    steps.push({
      title: 'Cooper and Jacob distance-drawdown line',
      lines: [
        'A least squares straight line through drawdown against log10 distance, the distance-drawdown form of the Cooper and Jacob (1946) line (Kruseman and de Ridder 1994, Procedure 3.5). Its fall per log cycle of distance gives T, and the distance where it reaches zero drawdown gives S.',
        'Here s is the drawdown at time t, Q the pumping rate, r the distance from the pumped well, T the transmissivity and S the storativity. Δs is the fall in drawdown over one log cycle of distance, and r0 the distance at which the line reaches zero drawdown.',
        units,
      ],
      formula: 's = 2.303 Q / (2πT) log10(r0 / r)\nT = 2.303 Q / (2π Δs)\nS = 2.25 T t / r0²',
      numbers: [
        ['Q', both(sig(v.Q, 4), v.qUnit, sig(res.Q, 4), 'm³/d')],
        ['t', both(sig(v.tAt, 4), v.timeUnit, sig(res.tAt, 4), 'd')],
        ['Δs, per log cycle of distance', both(F.ds, v.sUnit, sig(L.ds, 3), 'm')],
        ['r0', both(F.r0, v.rUnit, sig(L.r0, 3), 'm')],
        ['T', both(F.T(L.T), F.tUnit, F.TSI(L.T), 'm²/d')],
        ['S', F.S(L.S)],
      ],
    });
    steps.push({
      title: 'Straight-line condition at each well',
      lines: [`The straight line stands in for the Theis curve only where u, the argument of the Theis well function, is small. Below 0.01 the error is under 1%. Kruseman and de Ridder (1994) take u below ${STRAIGHT_LINE_U} as the practical limit, where the error is under 5%. u is worked out from the T and S of the line.`],
      formula: 'u = r²S / (4Tt)',
      numbers: L.wells.filter((w) => w.used).map((w) => [w.name, `u = ${sig(w.u, 2)}, holds from ${sig(w.validFrom / TU)} ${v.timeUnit}`]),
    });
  }
  if (C) {
    steps.push({
      title: 'Theis curve fitted to all wells at once',
      lines: [
        'Every reading above zero from every well is put on one plot of drawdown against t/r², the time since pumping began divided by the square of the distance. One Theis (1935) curve is fitted to all of them by least squares, each reading counting the same (Kruseman and de Ridder 1994, Procedure 3.3, done by least squares as in AQTESOLV and TTim instead of by eye). A well with more readings counts for more. W(u) is the Theis well function.',
        ...(L ? [] : [units]),
      ],
      formula: 's = Q / (4πT) · W(u),  u = S / (4T (t/r²))',
      numbers: [['Readings', String(C.rows)], ['T', both(F.T(C.T), F.tUnit, F.TSI(C.T), 'm²/d')], ['S', F.S(C.S)], ['RMS misfit', `${F.rms} ${v.sUnit}`]],
    });
  }
  return {
    steps,
    references: [
      ...(L ? ['Cooper, H.H., Jr., and Jacob, C.E. (1946) A generalized graphical method for evaluating formation constants and summarizing well-field history. Transactions, American Geophysical Union 27(4), 526-534.'] : []),
      'Kruseman, G.P., and de Ridder, N.A. (1994) Analysis and Evaluation of Pumping Test Data, 2nd edition. Publication 47, International Institute for Land Reclamation and Improvement, Wageningen.',
      ...(C ? ['Theis, C.V. (1935) The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions, American Geophysical Union 16(2), 519-524.'] : []),
      ...(res.example && res.example.source === 'wit' ? ['Wit, K.E. (1963) The hydraulic characteristics of the Oude Korendijk polder, calculated from pumping test data and laboratory measurements of core samples (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 190.'] : []),
    ],
  };
}
