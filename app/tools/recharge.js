// Estimate recharge from a hydrograph: the water-table fluctuation method, with the
// recession extrapolated by a master recession curve or by a straight line.
import { DAY, estimateRecharge } from '../../engine/recharge.js';
import { detectDayFirst, parseStamp } from '../read-file.js';
import { chart, columnSpec, columnValues, done, downloads, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, methodPanel, notes, panel, sig, table } from '../kit.js';
import { fixed, listed } from '../../engine/format.js';
import { oregonCsv, syntheticCsv } from './recharge-example.js';

const REFS = [
  'Delin, G.N., Healy, R.W., Lorenz, D.L., and Nimmo, J.R. (2007) Comparison of local- to regional-scale estimates of ground-water recharge in Minnesota, USA. Journal of Hydrology 334(1-2), 231-249.',
  'Healy, R.W., and Cook, P.G. (2002) Using groundwater levels to estimate recharge. Hydrogeology Journal 10(1), 91-109.',
  'Heppner, C.S., and Nimmo, J.R. (2005) A computer program for predicting recharge with a master recession curve. U.S. Geological Survey Scientific Investigations Report 2005-5172.',
];

const EXAMPLES = [
  {
    label: 'Example with a known answer', name: 'recharge-example.csv', csv: syntheticCsv(),
    values: { kind: 'depth', unit: 'm', stepDays: 1, method: 'line', windowDays: 10, sy: 0.05, yearType: 'water' },
    note: 'Invented daily record with a known answer. The water table falls by a known recession curve, and rises of 0.30, 0.30, 0.08, 0.37, 0.18 and 0.12 m were added (1.35 m in all: 0.68 m in water year 2024 and 0.67 m in 2025). At Sy 0.05 the true recharge is 67.5 mm: 34.0 mm and 33.5 mm. The answer is stated for Sy 0.05, and it is checked with the straight-line recession and a 10-day window, so those are filled in. That rule finds each rise to within 1 percent.',
  },
  {
    label: 'Real well (Oregon)', name: 'usgs-420318121312201-oregon.csv', csv: oregonCsv(),
    values: { kind: 'depth', unit: 'ft', stepDays: 1 },
    note: 'Real record: USGS well 420318121312201 in Oregon, depth to water in ft, the reading at midnight of each day, so the time step is 1 day. The USGS gives no specific yield, and the recession and the totals are choices to make, so those fields are empty: fill them in below, then Run. With the master recession curve, also choose what to do with steps that fall below the curve. The true recharge is unknown. The water is about 300 ft down. The record has no readings from 13 June to 7 July 2026. Across that gap the depth went from 301.7 ft (12 June) to 309.0 ft (8 July), and it kept falling to 318.2 ft on 8 August, about 16.5 ft in all. It then rose about 9.3 ft, to 308.9 ft on 31 October. That looks like pumping, not recharge, and the method counts every rise, so the numbers are not a recharge estimate for this well. The example only shows the tool on real data.',
  },
];

const KIND = [['depth', 'Depth to water (down is larger)'], ['height', 'Elevation or height (up is larger)']];
const METHOD = [['mrc', 'Master recession curve'], ['line', 'Straight-line recession']];

const stamp = (ms, stepDays, gap = ' ') => new Date(ms).toISOString().slice(0, stepDays < 1 ? 16 : 10).replace('T', gap);
// The most decimals in the level column, 1 to 4. Depths such as 305.40 ft change by
// hundredths, so levels are shown to the decimals they were read to, not to 4 figures.
const decimalsOf = (values) => Math.min(4, Math.max(1, ...values.filter(Number.isFinite).slice(0, 2000).map((x) => (String(x).split('.')[1] || '').length)));
const SHOWN_RISES = 20;
// With more run ends than this, the hydrograph marks none, so they do not bury the line.
const MARKED_RUNS = 40;
// Recharge to a fixed count of decimals, so a column lines up: 0.35, 1.49, 14.57 in, or
// 14.9 and 33.9 mm. A value that rounds away is written < 0.01, not 0.00 or 3.471 × 10⁻⁴.
const fixedText = (x, places) => {
  const tiny = (10 ** -places).toFixed(places);
  if (Number.isFinite(x) && x !== 0 && Number(x.toFixed(places)) === 0) return x > 0 ? `< ${tiny}` : `> −${tiny}`;
  return fixed(x, places);
};
// A date that does not break at its hyphens.
const keep = (d) => d.replace(/-/g, '\u2011');
// The length unit a heading names, as a whole word.
const unitWord = (heading) => {
  if (/(^|[^a-z])(ft|feet)([^a-z]|$)/i.test(heading)) return 'ft';
  if (/(^|[^a-z])(m|meters?|metres?)([^a-z]|$)/i.test(heading)) return 'm';
  return undefined;
};

export default {
  id: 'recharge',
  group: 'levels',
  title: 'Estimate recharge from a hydrograph',
  blurb: 'You have water levels from a shallow unconfined aquifer. Estimate recharge from each rise by the water-table fluctuation method.',
  lede: 'Recharge is specific yield times the rise of the water table above the level it would have fallen to without the rise (Healy and Cook 2002).',
  mount(host) {
    let data = null, ambiguous = false, fileName = '', about = null;
    const out = el('div', { class: 'stack' });
    const showError = (msg) => { out.textContent = ''; out.append(errorBox(msg)); };
    const { status } = fileDrop(host, {
      text: 'A spreadsheet or CSV of water levels with a date and time column.',
      examples: EXAMPLES,
      onTable: take,
    });
    columnSpec(host, {
      columns: [
        { name: 'Date and time', need: 'Required', what: 'When each level was read. A date alone is fine for daily readings.', headings: ['Date and time', 'Date'] },
        { name: 'Water level', need: 'Required', what: 'Depth to water or water level elevation, in m or ft. You say which below.', headings: ['Depth to water (m)', 'Water level elevation (ft)'] },
      ],
      notes: [
        'Use readings from a well in a shallow unconfined aquifer, at daily or closer intervals over at least several recharge events.',
        'Remove pumping, sensor resets and other rises that are not recharge first: the method counts every rise.',
      ],
      examples: [{
        label: EXAMPLES[0].label, name: 'recharge-example.xlsx', header: ['Date', 'Depth to water (m)'],
        rows: EXAMPLES[0].csv.split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v]; }),
      }],
    });
    const f = form(host, {
      fields: [
        { id: 'time', label: 'Date and time column', type: 'column', required: true },
        { id: 'level', label: 'Water level column', type: 'column', required: true },
        { id: 'kind', label: 'The level column holds', type: 'select', options: KIND, required: true },
        { id: 'unit', label: 'Level unit', type: 'select', options: [['m', 'm'], ['ft', 'ft']], required: true },
        { id: 'dateOrder', label: 'Date order', type: 'select', options: [['dmy', 'Day first (31/12/2026)'], ['mdy', 'Month first (12/31/2026)']], required: () => ambiguous, show: () => ambiguous, hint: 'Every date in the file could be read either way.' },
        { id: 'stepDays', label: 'Time step, days', type: 'number', required: true, hint: 'Readings are averaged over each step. Delin et al. (2007) used daily values, a step of 1.' },
        { id: 'method', label: 'Recession', type: 'select', options: METHOD, required: true, hint: 'The curve of Heppner and Nimmo (2005), or a straight line through the decline before each rise.' },
        { id: 'windowDays', label: 'Days before each rise to take the slope from', type: 'number', required: (v) => v.method === 'line', show: (v) => v.method === 'line' },
        { id: 'negatives', label: 'Steps that fall below the curve', type: 'select', options: [['zero', 'Leave them out'], ['keep', 'Count them against the totals']], required: (v) => v.method === 'mrc', show: (v) => v.method === 'mrc', hint: 'Heppner and Nimmo (2005) offer both. Delin et al. (2007) left them out.' },
        { id: 'sy', label: 'Specific yield (Sy)', type: 'number', required: true, hint: 'There is no default. Recharge is in direct proportion to it.' },
        { id: 'yearType', label: 'Totals by', type: 'select', options: [['water', 'Water year (Oct to Sep)'], ['calendar', 'Calendar year']], required: true },
        { id: 'minRise', label: 'Leave out rises smaller than, in the level unit', type: 'number', show: (v) => v.method === 'line' || v.negatives === 'zero' },
      ],
      onRun: run,
    });
    host.append(out);

    // Everything from an earlier file or example goes: the form, the results and errors.
    function take({ name, table: tbl, example: x }) {
      data = tbl;
      fileName = name;
      about = x ? x.note : null;
      out.textContent = '';
      delete host.dataset.done;
      delete host.dataset.stale;
      f.reset();
      f.setColumns(tbl.header);
      const time = findColumn(tbl.header, /date|time/i);
      const level = findColumn(tbl.header, /depth|level|elev|water/i);
      if (time !== undefined) f.set('time', time);
      if (level !== undefined) {
        f.set('level', level);
        const h = tbl.header[level];
        if (/depth|dtw|below/i.test(h)) f.set('kind', 'depth');
        else if (/elev|altitude/i.test(h)) f.set('kind', 'height');
        if (unitWord(h)) f.set('unit', unitWord(h));
      }
      ambiguous = time !== undefined && detectDayFirst(tbl.rows.map((r) => r[time])) === null;
      if (x) Object.entries(x.values).forEach(([k, v]) => f.set(k, v));
      // The date order field depends on ambiguous, which changed after the last set().
      f.check();
      status(`${name}: ${tbl.rows.length} rows.${x ? ` ${x.note}` : ''}`);
    }

    function run(v) {
      out.textContent = '';
      try {
        if (!data) throw new Error('Add a file first.');
        const dayFirst = ambiguous ? v.dateOrder === 'dmy' : detectDayFirst(data.rows.map((r) => r[v.time])) === true;
        const t = data.rows.map((r) => parseStamp(r[v.time], dayFirst));
        const level = columnValues(data, v.level);
        const r = estimateRecharge({
          t, level, depth: v.kind === 'depth', stepDays: v.stepDays, method: v.method, sy: v.sy,
          windowDays: v.windowDays, negatives: v.negatives, minRise: v.minRise, yearType: v.yearType,
        });
        show(v, r, decimalsOf(level));
        done(host);
      } catch (e) {
        showError(e.message);
      }
    }

    function show(v, r, dp) {
      const u = v.unit, [small, mult] = u === 'ft' ? ['in', 12] : ['mm', 1000];
      // Inches to hundredths and millimetres to tenths; feet and metres to the same depth.
      const rs = (x) => fixedText(x * mult, u === 'ft' ? 2 : 1), rl = (x) => fixedText(x, u === 'ft' ? 3 : 4);
      const dhp = Math.min(4, Math.max(dp, 3));
      const shown = (z) => (v.kind === 'depth' ? -z : z);
      const lv = (z) => fixed(shown(z), dp);
      // A hyphen for the minus sign, unlike fixed(): the summed Δh in the text below the
      // heading and in the method has always been written so.
      const dh = (x) => (Number.isFinite(x) ? x.toFixed(dhp) : 'n/a');
      const s = r.steps, counted = r.events.filter((e) => Number.isFinite(e.dh));
      const flagged = r.events.length - counted.length, gaps = s.k.filter((k, i) => i > 0 && k !== s.k[i - 1] + 1).length;
      const line = v.method === 'line', depthData = v.kind === 'depth';
      const water = v.yearType === 'water';
      const yearStart = (y) => (water ? Date.UTC(y - 1, 9, 1) : Date.UTC(y, 0, 1));
      const yearDays = (y) => Math.round((yearStart(y + 1) - yearStart(y)) / DAY);
      const partial = r.years.filter((y) => y.days < yearDays(y.year));
      const warn = [
        'The water-table fluctuation method applies to unconfined aquifers with a shallow water table, where a rise means water has reached the water table. It does not apply to confined aquifers, and it counts as recharge any rise from pumping stopping, barometric pressure, earth tides or entrapped air.',
      ];
      if (r.totalDh !== 0) warn.push(`The answer is in direct proportion to Sy, which is seldom known closely. Each 0.01 of Sy adds or takes away ${sig(0.01 * r.totalDh * mult, 3)} ${small} of the total, so half your Sy gives half the recharge.`);
      if (flagged) warn.push(`${flagged} rise${flagged > 1 ? 's' : ''} had no falling level in the window before ${flagged > 1 ? 'them' : 'it'}, so no recession could be extended and ${flagged > 1 ? 'they are' : 'it is'} not counted. A shorter window, or the master recession curve, may help.`);
      if (r.dropped) warn.push(`${r.dropped} rise${r.dropped > 1 ? 's' : ''} smaller than ${v.minRise} ${u} left out.`);
      if (r.mrc && !(r.mrc.a > 0)) warn.push('The fitted fall rate does not increase with the level, so a master recession curve does not describe this record well.');
      if (partial.length) {
        const names = listed(partial.map((y) => String(y.year)));
        warn.push(`${water ? 'Water' : 'Calendar'} year${partial.length > 1 ? 's' : ''} ${names} ${partial.length > 1 ? 'are' : 'is'} only partly covered by the record, so ${partial.length > 1 ? 'their totals are' : 'its total is'} not a full year of recharge.`);
      }
      if (gaps) warn.push(`The record has ${gaps} gap${gaps > 1 ? 's' : ''} of a step or more. Nothing is counted across a gap.`);
      if (r.mrc) warn.push(`${r.rows.filter((row) => row.diff > 0).length} of ${r.rows.length} steps sit above the curve.${v.negatives === 'zero' ? ' With steps below the curve left out, noise in the readings adds to the total; a longer time step or a smallest rise reduces this.' : ''}`);
      if (r.mrc && v.negatives === 'zero') warn.push('Each run above the curve is counted in the year of its last step, so a run that starts before 1 ' + (water ? 'October' : 'January') + ' and ends after it is counted wholly in the later year.');

      // When nothing is counted, say why rather than leave a bare 0.
      let why = '';
      if (!(r.recharge > 0)) {
        const across = gaps ? ` Nothing is counted across the ${gaps} gap${gaps > 1 ? 's' : ''} in the record.` : '';
        if (!r.events.length && !r.dropped) why = (line ? 'No step is higher than the step before it, so the record has no rise.' : 'No step sits above the level the curve predicts from the step before, so the record has no rise.') + across;
        else if (!counted.length && r.dropped && !flagged) why = `Every rise is smaller than ${v.minRise} ${u}, the smallest rise you chose to keep.`;
        else if (!counted.length && flagged && !r.dropped) why = `Every rise had no falling level in the ${v.windowDays} days before it, so no recession could be extended.`;
        else if (!counted.length) why = `Of the rises found, ${r.dropped} ${r.dropped === 1 ? 'is' : 'are'} smaller than the ${v.minRise} ${u} you chose to keep, and ${flagged} had no falling level before ${flagged === 1 ? 'it' : 'them'}.`;
        else if (r.totalDh <= 0) why = 'The steps below the curve, counted against the totals as you chose, outweigh the steps above it.';
        if (why) why = `Why the result is ${r.totalDh < 0 ? 'below zero' : 'zero'}: ${why}`;
      }

      // The answer first, so it is on screen on a phone.
      const years = r.years.map((y) => [String(y.year), rs(y.recharge), rl(y.recharge), y.events, dh(y.dh), y.days]);
      const yearHead = [water ? 'Water year' : 'Year', `Recharge (${small})`, `Recharge (${u})`, 'Rises', `Summed Δh (${u})`, 'Days with readings'];
      const D = depthData ? 'Depth' : 'Level';
      const ends = [line ? 'Start' : 'Run starts', line ? 'Peak' : 'Run ends'];
      const evTail = [`Recharge (${small})`, `Δh (${u})`, `${D} at start (${u})`, `${D} at ${line ? 'peak' : 'end'} (${u})`, ...(line ? [`Extended recession at peak (${u})`] : [])];
      const evHead = [...ends, ...evTail];
      // On the page the two dates share the first column, so the recharge is on screen on a phone.
      const evPageHead = [line ? 'Start to peak' : 'Run, start to end', ...evTail];
      const evRows = r.events.map((e) => [
        `${stamp(e.tStart, v.stepDays, '\u00a0')} to ${stamp(e.tPeak, v.stepDays, '\u00a0')}`,
        Number.isFinite(e.dh) ? rs(e.recharge) : 'n/a', dh(e.dh), lv(e.zStart), lv(e.zPeak), ...(line ? [lv(e.extrap)] : []),
      ]);
      const evSheet = r.events.map((e) => [
        stamp(e.tStart, v.stepDays), stamp(e.tPeak, v.stepDays), e.recharge * mult, e.dh, shown(e.zStart), shown(e.zPeak),
        ...(line ? [Number.isFinite(e.extrap) ? shown(e.extrap) : NaN] : []),
      ]);

      const x = (ms) => (ms - s.t0) / DAY;
      const levelLabel = depthData ? `Depth to water (${u})` : `Water level (${u})`;
      const hydroLine = { label: `${depthData ? 'Depth to water' : 'Water level'} (step mean)`, x: s.t.map(x), y: s.z.map(shown) };
      const days = `Days since ${stamp(s.t0, 1)}`;
      let hydro, excess = null;
      if (line) {
        const ext = { x: [], y: [] };
        for (const e of counted) {
          for (let i = e.start; i <= e.peak; i++) {
            ext.x.push(x(s.t[i]));
            ext.y.push(shown(s.z[e.start] + e.slope * (s.t[i] - s.t[e.start]) / DAY));
          }
        }
        hydro = chart({
          title: 'Hydrograph, recessions and rises', xLabel: days, yLabel: levelLabel, invertY: depthData,
          series: [hydroLine,
            { label: 'Recession extended to the peak', x: ext.x, y: ext.y, line: false, size: 5 },
            { label: 'Peak of each rise', x: counted.map((e) => x(e.tPeak)), y: counted.map((e) => shown(e.zPeak)), line: false, size: counted.length > 30 ? 5 : 8 }],
        });
      } else {
        // The curve's prediction sits within a step of the hydrograph, so drawn on it, it
        // hides the line. The amount each step sits above the curve has its own chart.
        const marked = counted.length <= MARKED_RUNS;
        hydro = el('div', { class: 'stack' }, chart({
          title: 'Hydrograph and the runs above the curve', xLabel: days, yLabel: levelLabel, invertY: depthData,
          series: [hydroLine, ...(marked ? [{ label: 'End of each run above the curve', x: counted.map((e) => x(e.tPeak)), y: counted.map((e) => shown(e.zPeak)), line: false, size: 8 }] : [])],
        }), marked ? null : el('p', { class: 'chart-sub' }, `The ends of the ${counted.length} runs above the curve are not marked, so they do not hide the hydrograph. The next chart shows how far each step sits above the curve.`));
        excess = chart({
          title: 'Rise above the curve at each step', xLabel: days, yLabel: `Measured minus predicted (${u})`,
          series: [{ label: 'Measured minus predicted level', x: r.rows.map((row) => x(row.t)), y: r.rows.map((row) => row.diff) }],
        });
      }

      // The workbook carries the example's note and the page's warnings.
      const text = { ...methodText(v, r, gaps, dh), notes: [...(about ? [about] : []), ...(why ? [why] : []), ...warn] };
      const sheets = [
        { name: 'Rises', header: evHead, rows: evSheet },
        { name: 'Years', header: yearHead, rows: r.years.map((y) => [y.year, y.recharge * mult, y.recharge, y.events, y.dh, y.days]) },
        {
          name: 'Steps',
          header: ['Time (step middle)', levelLabel, ...(line ? [] : [`Predicted (${u})`, `Measured minus predicted (${u})`])],
          rows: line
            ? s.t.map((ms, i) => [stamp(ms, v.stepDays), shown(s.z[i])])
            : r.rows.map((row) => [stamp(row.t, v.stepDays), shown(row.z), shown(row.pred), row.diff]),
        },
      ];
      if (r.mrc) {
        sheets.push({
          name: 'Curve points',
          header: [`Mean ${depthData ? 'depth' : 'level'} of pair (${u})`, `Fall rate (${u}/d)`],
          rows: r.mrc.points.map((p) => [shown(p.z), p.rate]),
        });
      }

      const span = r.span, book = `${fileName.replace(/\.[^.]+$/, '') || 'levels'}-recharge.xlsx`;
      // One table, so the columns line up; the rows after the first 20 are shown on request.
      const evTable = r.events.length ? table(evPageHead, evRows) : el('p', {}, 'No rise was found.');
      let more = null;
      if (r.events.length > SHOWN_RISES) {
        const extra = [...evTable.querySelectorAll('tbody tr')].slice(SHOWN_RISES);
        extra.forEach((tr) => { tr.hidden = true; });
        const n = extra.length;
        more = el('button', { class: 'btn quiet', type: 'button', 'aria-expanded': 'false', onclick: () => {
          const open = more.getAttribute('aria-expanded') !== 'true';
          extra.forEach((tr) => { tr.hidden = !open; });
          more.setAttribute('aria-expanded', String(open));
          more.textContent = open ? `Hide the other ${n} rises` : `Show the other ${n} rises`;
        } }, `Show the other ${n} rises`);
      }
      const rises = el('div', { class: 'stack' },
        el('h2', {}, 'Each rise'),
        evTable,
        more,
        r.events.length > SHOWN_RISES ? el('p', { class: 'hint' }, `All ${r.events.length} rises are in the download, on the Rises sheet.`) : null,
        line ? null : el('p', { class: 'hint' }, 'With the master recession curve, a rise is a run of steps above the curve, and its Δh is the sum of the amounts each step sits above it. It is not the end less the start.'));
      out.append(panel(
        el('h2', {}, 'Recharge'),
        el('p', { class: 'chart-sub' }, `${sig(r.recharge * mult, 3, true)} ${small} (${sig(r.recharge, 3, true)} ${u}) over ${sig(span.days, 4)} days of record, ${keep(stamp(span.first, 1))} to ${keep(stamp(span.last, 1))}, from ${counted.length} rise${counted.length === 1 ? '' : 's'}, at Sy ${v.sy}. Recharge is Sy times the summed Δh of ${dh(r.totalDh)} ${u}.`),
        why ? el('p', {}, why) : null,
        table(yearHead, years),
        notes(warn),
        downloads(() => downloadWorkbook(book, sheets, text))),
      panel(hydro),
      ...(excess ? [panel(excess)] : []), // a plain append would write null as text
      panel(rises),
      ...(r.mrc ? [panel(curveChart(r.mrc, levelLabel, u, shown))] : []),
      methodPanel(text));
    }
  },
};

// The falling pairs and the line fitted through them, from the lowest level to the highest.
function curveChart(mrc, levelLabel, u, shown) {
  const zs = mrc.points.map((p) => p.z), ends = [Math.min(...zs), Math.max(...zs)];
  return chart({
    title: 'Master recession curve', xLabel: levelLabel, yLabel: `Fall rate (${u}/d)`,
    series: [
      { label: 'Falling pairs', x: mrc.points.map((p) => shown(p.z)), y: mrc.points.map((p) => p.rate), line: false, size: 5 },
      { label: 'Fitted line', x: ends.map(shown), y: ends.map((z) => mrc.a * z + mrc.b) },
    ],
  });
}

function methodText(v, r, gaps, dh) {
  const u = v.unit, s = r.steps;
  const steps = [{
    title: 'Time steps',
    lines: [`The readings were averaged over steps of ${v.stepDays} day${v.stepDays === 1 ? '' : 's'}, starting at midnight of the first day as the times are written in the file.${v.kind === 'depth' ? ' Depths were turned into heights (h = −depth) so that a rise is positive.' : ''}`],
    numbers: [['Record (days)', sig(r.span.days, 4)], ['Usual time between readings (days)', sig(r.span.interval, 3)], ['Steps with readings', String(s.t.length)], ['Gaps', String(gaps)]],
  }];
  if (v.method === 'mrc') {
    steps.push({
      title: 'Master recession curve (Heppner and Nimmo 2005)',
      lines: ['For each pair of successive steps the fall rate and the mean level of the pair were found, after dropping any step equal to the one before it, as in Heppner and Nimmo (2005). The falling pairs were fitted by least squares with their linear curve. Delin et al. (2007) wrote the same curve as ln(h − d) falling at a constant rate, where d = −b/a is the level the water table tends to.'],
      formula: 'fall rate = a h + b',
      numbers: [['a (per day)', sig(r.mrc.a, 4)], [`b (${u}/d)`, sig(r.mrc.b, 4)], ['Falling pairs', String(r.mrc.points.length)], [`d = −b/a (${u}, as height)`, sig(-r.mrc.b / r.mrc.a, 4)]],
    }, {
      title: 'Rise above the curve at each step',
      lines: [
        'Each step\'s level was predicted from the step before with the curve and compared with the measured level, as in Heppner and Nimmo (2005); Delin et al. (2007) applied the curve to every daily level in the same way. A rise is a run of steps above the prediction, and its Δh is the sum over the run.',
        v.negatives === 'zero' ? 'Steps below the prediction were left out (set to zero), as Delin et al. (2007) did.' : 'Steps below the prediction were added to the totals as negative values, the other option Heppner and Nimmo (2005) offer.',
      ],
      formula: 'h_pred(i+1) = h(i) − (a h(i) + b) dt\nΔh(i+1) = h(i+1) − h_pred(i+1)',
      numbers: [['dt (days)', String(v.stepDays)]],
    });
  } else {
    steps.push({
      title: 'Rises and the straight-line recession',
      lines: [
        'A rise is a run of steps each higher than the one before, from its low to its peak. Δh is the peak less the level the antecedent recession would have reached at the time of the peak (Healy and Cook 2002; Delin et al. 2007).',
        `Healy and Cook (2002) extend the recession by eye. Here it is done by a fixed rule: a straight line through the low, with the least-squares slope of the steps in the ${v.windowDays} days up to and including the low. A rise with no fall in that window is listed but not counted.`,
      ],
      formula: 'h_ext(t_peak) = h(t_low) + slope (t_peak − t_low)\nΔh = h(t_peak) − h_ext(t_peak)',
      numbers: [['Window (days)', String(v.windowDays)]],
    });
  }
  steps.push({
    title: 'Recharge',
    lines: [`Recharge is specific yield times Δh (Healy and Cook 2002). Totals are by ${v.yearType === 'water' ? 'water year (1 October to 30 September, named by the year it ends in)' : 'calendar year'}. ${v.method === 'line' ? 'Each rise is counted in the year of its peak.' : v.negatives === 'keep' ? 'Each step\'s amount above or below the curve is counted in the year of that step.' : 'A run above the curve has no peak of its own, so each run is counted in the year of its last step.'}${v.minRise > 0 ? ` Rises with Δh under ${v.minRise} ${u} were left out, as you chose.` : ''}`],
    formula: 'R = Sy Δh',
    numbers: [['Sy', String(v.sy)], [`Summed Δh (${u})`, dh(r.totalDh)], [`Recharge (${u})`, sig(r.recharge, 4, true)]],
  });
  return { steps, references: REFS };
}
