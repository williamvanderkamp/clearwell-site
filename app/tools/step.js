// Step-drawdown test by the Hantush-Bierschenk method: drawdown over rate against rate
// gives B and C in Jacob's s = BQ + CQ², or B, C and P in Rorabaugh's s = BQ + CQᴾ.
import { RATE_UNITS, UNITS } from '../../engine/index.js';
import { atRate, driscollT, fitJacob, fitRorabaugh, hantushBierschenk } from '../../engine/step.js';
import { chart, columnSpec, columnValues, done, downloads, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, methodPanel, notes, panel, sig, table, TIME_OPTIONS, unit, unitOptions } from '../kit.js';
import { timeUnitIn, unitInLabel } from '../columns.js';
import { clarkCsv, CLARK_RATES, clarkSeries, clarkSteps, clarkTableCsv, sheahanCsv, STEP_HEADER } from './step-data.js';
import { HANTUSH_1964_IN_COLON, KRUSEMAN_DE_RIDDER_1994 } from '../../engine/refs.js';

const LENGTH = ['m', 'ft'];
const RATES = unitOptions(Object.keys(RATE_UNITS));
// Keyed, so each run lists only what its text cites.
const [BIERSCHENK, JACOB, RORABAUGH] = [
  'Bierschenk, W.H. (1963) Determining well efficiency by multiple step-drawdown tests. International Association of Scientific Hydrology Publication 64, 493-507.',
  'Jacob, C.E. (1947) Drawdown test to determine effective radius of artesian well. Transactions of the American Society of Civil Engineers 112, Paper 2321, 1047-1064.',
  'Rorabaugh, M.J. (1953) Graphical and theoretical analysis of step-drawdown test of artesian well. Proceedings of the American Society of Civil Engineers 79, Separate 362.',
];
// The papers the example data come from, listed when an example's note cites them.
const SOURCE_REFS = {
  clark: 'Clark, L. (1977) The analysis and planning of step drawdown tests. Quarterly Journal of Engineering Geology 10(2), 125-143. doi:10.1144/GSL.QJEG.1977.010.02.03.',
  sheahan: 'Sheahan, N.T. (1971) Type-curve solution of step-drawdown test. Ground Water 9(1), 25-29. doi:10.1111/j.1745-6584.1971.tb03528.x.',
};
const DRISCOLL_REFS = [
  'Driscoll, F.G. (1986) Groundwater and Wells, 2nd edition. Johnson Filtration Systems, St. Paul, Minnesota.',
  'Johnson, T. (2005) Specific capacity: a measure of well performance, well problems, and aquifer transmissivity, part 1 of 2. Technical Bulletin 2, Water Replenishment District of Southern California.',
];

// Each example sets only what its source gives. The book draws the lines through the
// Clark readings by eye and gives no time they start from, so that field is left empty.
const EXAMPLES = [
  {
    label: 'Clark (1977) steps', name: 'clark-1977-table-14-2.csv', csv: clarkTableCsv(), cites: 'clark',
    set: { kind: 'steps', rateCol: 1, sCol: 2, sUnit: 'm', qUnit: 'm3/d', model: 'jacob' },
    note: 'Real data: the drawdowns the book read for Clark (1977) at 100 minutes into each step (Kruseman and de Ridder 1994, Table 14.2). Its line gives B = 0.00326 m per m³/d and C = 1.45 × 10⁻⁷ m per (m³/d)². That line runs above step 1; leave out step 1 to compare.',
  },
  {
    label: 'Clark (1977) readings', name: 'clark-1977-well-1.csv', csv: clarkCsv(), cites: 'clark',
    set: {
      kind: 'series', tCol: 0, sCol: 1, sUnit: 'm', qUnit: 'm3/d', tUnit: 'min',
      starts: CLARK_RATES.map((_, n) => n * 180).join(', '), rates: CLARK_RATES.join(', '), dt: 100, model: 'jacob',
    },
    note: 'Real data: Clark (1977), \'Well 1\' in a confined sandstone, six steps of 180 minutes (Kruseman and de Ridder 1994, Table 14.1). The book compares the steps at 100 minutes and, from lines drawn by eye, gets B = 0.00326 m per m³/d and C = 1.45 × 10⁻⁷ m per (m³/d)². It does not say from what time in each step it drew the lines, so enter that below, under "Draw each step\'s line from". The write-up for this page uses 60 minutes.',
  },
  {
    label: 'Sheahan (1971) steps', name: 'sheahan-1971.csv', csv: sheahanCsv(), cites: 'sheahan',
    set: { kind: 'steps', rateCol: 1, sCol: 2, sUnit: 'm', qUnit: 'm3/d', model: 'rorabaugh' },
    note: 'Real data: Sheahan (1971), four steps (Kruseman and de Ridder 1994, Table 14.3). By Rorabaugh\'s method the book tries four values of B and gets B = 0.0010 m per m³/d, P = 2.85 and C = 1.4 × 10⁻¹⁰ m per (m³/d)ᴾ. This page searches B for the straightest line and gets B = 9.70 × 10⁻⁴, P = 2.79 and C = 2.47 × 10⁻¹⁰. C is the line extended four log cycles to Q = 1, so a P 0.06 lower moves it by a factor of about 1.8. Both equations give the four drawdowns to within 1%.',
  },
];

// Table 14.1 as rows of time and drawdown, for the example download.
const clarkReadings = () => {
  const { t, s } = clarkSeries();
  return t.map((x, i) => [x, s[i]]);
};

const isSeries = (v) => v.kind === 'series';
const isSteps = (v) => v.kind === 'steps';
// Unlike format.js fixed(), a hyphen for the minus sign, as the method text and the
// workbook have always written it. In a table(), the minus is typeset anyway.
const decimals = (x, places) => (Number.isFinite(x) ? x.toFixed(places) : 'n/a');
// Drawdowns to the millimetre (or thousandth of a foot), as they are read in the field.
const dd = (x) => decimals(x, 3);
// The most decimals in a column as the file gave it, 1 to 4: drawdowns the book gives
// as 4.25 and 20.00 are shown as 20.00, not 20.000.
const placesOf = (xs) => Math.min(4, Math.max(1, ...xs.filter(Number.isFinite).map((x) => (String(x).split('.')[1] || '').length)));
// One count of decimals for a column, enough for p figures in its largest value:
// 24.5, 23.0 and 21.7, not 24.5, 23 and 21.7; with 4 figures, 0.6200 and 0.7867.
const sigColumn = (xs, p) => {
  const top = Math.max(...xs.map(Math.abs).filter(Number.isFinite));
  const places = Math.min(12, Math.max(0, p - 1 - Math.floor(Math.log10(top))));
  return (x) => decimals(x, places);
};
// Figures with their trailing zeros, so 1.50 × 10⁻⁷ is not written 1.5 × 10⁻⁷.
const sz = (x, p = 3) => sig(x, p, true);
// Rate units hold a slash, which unitInLabel reads as a space, so these are matched as written.
const rateUnitIn = (heading, options) => {
  const m = /\(([^)]+)\)/.exec(String(heading));
  return m && options.find(([u]) => u === m[1].trim()) ? m[1].trim() : undefined;
};

function numberList(text, what) {
  const parts = String(text).split(/[,;\s]+/).filter(Boolean), out = parts.map(Number);
  if (out.some((x) => !Number.isFinite(x))) throw new Error(`The ${what} must be numbers separated by commas.`);
  return out;
}

function detect(f, h) {
  const rate = findColumn(h, /\brate\b|discharge/i), time = findColumn(h, /\btime\b|minutes|elapsed/i), s = findColumn(h, /drawdown/i);
  f.set('sCol', s);
  f.set('rateCol', rate);
  f.set('tCol', time);
  if (rate !== undefined && time === undefined) f.set('kind', 'steps');
  if (time !== undefined && rate === undefined) f.set('kind', 'series');
  const sUnit = s === undefined ? undefined : unitInLabel(h[s], LENGTH);
  const qUnit = rate === undefined ? undefined : rateUnitIn(h[rate], RATES);
  const tUnit = time === undefined ? undefined : timeUnitIn(h[time]);
  if (sUnit) f.set('sUnit', sUnit);
  if (qUnit) f.set('qUnit', qUnit);
  if (tUnit) f.set('tUnit', tUnit);
}

export default {
  id: 'step',
  group: 'tests',
  title: 'Analyze a step-drawdown test',
  blurb: 'You pumped a well at rising rates. Get the linear and nonlinear loss coefficients B and C, the well efficiency and the specific capacity.',
  lede: 'The Hantush-Bierschenk method: drawdown divided by rate, plotted against rate, gives B and C in s = BQ + CQ² (Jacob 1947), or B, C and P in s = BQ + CQᴾ (Rorabaugh 1953).',
  mount(host) {
    let data = null, example = null;
    const out = el('div', { class: 'stack' });
    const showError = (msg) => { out.textContent = ''; out.append(errorBox(msg)); };
    const { status } = fileDrop(host, {
      text: 'One row per step with its rate and drawdown, or drawdown readings over time. CSV or Excel.',
      examples: EXAMPLES,
      onTable({ name, table: tbl, example: x }) {
        data = tbl;
        example = x || null;
        out.textContent = '';
        // Nothing from an earlier file or example carries over: empty every field, then
        // fill in what the headings say, then what the example's source gives.
        f.reset();
        f.setColumns(tbl.header);
        detect(f, tbl.header);
        if (x) Object.entries(x.set).forEach(([k, val]) => f.set(k, val));
        status(`${name}: ${tbl.rows.length} rows.${x ? ` ${x.note}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Rate', need: 'For one row per step', what: 'The pumping rate of each step.', headings: ['Rate (m3/d)'] },
        { name: 'Drawdown', need: 'Required', what: 'Drawdown in the pumped well, below the level before pumping. One row per step: the drawdown for that step. Readings over time: each reading.', headings: ['Drawdown (m)'] },
        { name: 'Time', need: 'For readings over time', what: 'When each reading was taken, on the same clock as the step start times you enter.', headings: ['Time (min)'] },
      ],
      notes: [
        'One row per step: the drawdowns are used as they are. Kruseman and de Ridder (1994) allow this when the drawdown had stopped changing by the end of each step. If it had not, give readings over time instead.',
        'Readings over time: you enter the start time and rate of each step. Nothing is guessed from the record.',
      ],
      examples: [
        { label: 'One row per step', name: 'step-test-one-row-per-step.xlsx', header: STEP_HEADER, rows: clarkSteps() },
        { label: 'Readings over time', name: 'step-test-readings.xlsx', header: ['Time since pumping began (min)', 'Drawdown (m)'], rows: clarkReadings() },
      ],
    });
    const f = form(host, {
      fields: [
        { id: 'kind', label: 'What the file holds', type: 'select', options: [['steps', 'One row per step'], ['series', 'Readings over time']], required: true },
        { id: 'rateCol', label: 'Rate column', type: 'column', required: isSteps, show: isSteps },
        { id: 'tCol', label: 'Time column', type: 'column', required: isSeries, show: isSeries },
        { id: 'sCol', label: 'Drawdown column', type: 'column', required: true },
        { id: 'sUnit', label: 'Drawdown unit', type: 'select', options: unitOptions(LENGTH), required: true },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'tUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: isSeries, show: isSeries },
        { id: 'starts', label: 'Step start times, separated by commas', type: 'text', required: isSeries, show: isSeries, placeholder: 'e.g. 0, 120, 240' },
        { id: 'rates', label: 'Step rates, separated by commas', type: 'text', required: isSeries, show: isSeries, placeholder: 'e.g. 500, 800, 1100' },
        { id: 'dt', label: 'Time into each step to compare', type: 'number', required: isSeries, show: isSeries, hint: 'The same for every step, in the time unit.' },
        { id: 'fitFrom', label: "Draw each step's line from this long after it began", type: 'number', required: isSeries, show: isSeries, hint: 'In the time unit. The line through drawdown against log time that is extended into the next step.' },
        { id: 'model', label: 'Equation', type: 'select', options: [['jacob', 'Jacob: s = BQ + CQ²'], ['rorabaugh', 'Rorabaugh: s = BQ + CQᴾ']], required: true },
        { id: 'leaveOut', label: 'Steps to leave out of the fit, by number', type: 'text', placeholder: 'e.g. 1' },
        { id: 'design', label: 'Design rate, in the rate unit', type: 'number', hint: 'Shows drawdown, efficiency and specific capacity at this rate.' },
        { id: 'aquifer', label: 'Rough T from specific capacity (Driscoll 1986)', type: 'select', options: [['confined', 'Confined aquifer'], ['unconfined', 'Unconfined aquifer']] },
      ],
      onRun(v) {
        out.textContent = '';
        try {
          if (!data) throw new Error('Drop a file or choose an example first.');
          if (v.design !== undefined && !(v.design > 0)) throw new Error('The design rate must be above zero.');
          render(out, analyze(data, v), v, example);
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });
    host.append(out);
  },
};

function analyze(data, v) {
  const L = UNITS[v.sUnit], qf = RATE_UNITS[v.qUnit];
  let rows, readings = null, places = 3;
  const skipped = [];
  if (isSteps(v)) {
    const Q = columnValues(data, v.rateCol), s = columnValues(data, v.sCol);
    rows = [];
    Q.forEach((q, i) => {
      if (Number.isNaN(q) && Number.isNaN(s[i])) { skipped.push(i); return; }
      if (Number.isNaN(q) || Number.isNaN(s[i])) throw new Error(`Row ${i + 1} below the headings has a rate or a drawdown but not both.`);
      rows.push({ n: rows.length + 1, Q: q, sw: s[i] });
    });
    places = placesOf(rows.map((r) => r.sw));
  } else {
    const t = columnValues(data, v.tCol), s = columnValues(data, v.sCol);
    const all = t.map((_, i) => i), both = (i) => Number.isFinite(t[i]) && Number.isFinite(s[i]);
    skipped.push(...all.filter((i) => !both(i)));
    const keep = all.filter(both).sort((a, b) => t[a] - t[b]);
    readings = { t: keep.map((i) => t[i]), s: keep.map((i) => s[i]) };
    const starts = numberList(v.starts, 'step start times'), rates = numberList(v.rates, 'step rates');
    if (rates.some((q) => !(q > 0))) throw new Error('Every step rate must be above zero.');
    rows = hantushBierschenk({ ...readings, starts, rates, dt: v.dt, fitFrom: v.fitFrom });
    readings.starts = starts;
  }
  const leftOut = v.leaveOut ? numberList(v.leaveOut, 'steps to leave out') : [];
  leftOut.forEach((n) => { if (!rows.some((r) => r.n === n)) throw new Error(`There is no step ${n} to leave out.`); });
  const used = rows.filter((r) => !leftOut.includes(r.n));
  const fit = (v.model === 'jacob' ? fitJacob : fitRorabaugh)(used.map((r) => r.Q * qf), used.map((r) => r.sw * L));
  return { rows, used, leftOut, fit, readings, L, qf, skipped, places };
}

// Rows counted from the first one below the headings: 1, 4, 9 and 3 more.
const listRows = (rows) => {
  const shown = rows.slice(0, 8).map((i) => i + 1);
  return rows.length > 8 ? `${shown.join(', ')} and ${rows.length - 8} more` : shown.join(', ');
};

function warnings(r, v) {
  const w = [], { fit, rows, skipped } = r;
  if (skipped.length) {
    const what = isSteps(v) ? 'with neither a rate nor a drawdown' : 'without a number for both time and drawdown';
    const one = skipped.length === 1;
    w.push(`${one ? 'One row' : `${skipped.length} rows`} ${what} ${one ? 'was' : 'were'} left out: row${one ? '' : 's'} ${listRows(skipped)}, counting down from the headings and skipping blank rows.`);
  }
  if (fit.C < 0) w.push('C is below zero: drawdown over rate falls as the rate rises. The test shows no nonlinear well loss, or the drawdowns are not comparable.');
  if (fit.B < 0) w.push('B is below zero, which has no physical meaning. Check the drawdowns and rates.');
  if (rows.some((x, i) => i > 0 && !(x.Q > rows[i - 1].Q))) w.push('The rates do not rise step by step. The method as published assumes each step pumps more than the one before.');
  if (isSteps(v)) w.push('Drawdowns were used as given. This holds when the drawdown had stopped changing by the end of each step, or when they are already the summed increments s_w(n).');
  if (isSeries(v)) {
    const { starts } = r.readings, len = starts.slice(1).map((x, i) => x - starts[i]);
    if (len.some((x) => Math.abs(x - len[0]) > 1e-9 * Math.abs(len[0]))) w.push('The steps are not all the same length. Kruseman and de Ridder (1994) ask for steps of equal length.');
  }
  if (v.model === 'rorabaugh' && r.used.length === 3) w.push('With three steps and three unknowns, some B makes the line exactly straight, so the fit cannot be checked against spare points.');
  if (v.model === 'rorabaugh' && fit.B === 0) w.push('The straightest line came at B = 0, the end of the range searched.');
  if (v.design !== undefined) {
    const q = r.used.map((x) => x.Q);
    if (v.design < Math.min(...q) || v.design > Math.max(...q)) w.push('The design rate is outside the rates tested, so the equation is extended beyond the data.');
  }
  return w;
}

// Units as written on the page: m³/d, not m3/d.
const units = (v) => ({ s: v.sUnit, q: unit(v.qUnit), si: v.sUnit === 'm' && v.qUnit === 'm3/d' });

// B and C in the user's units, and the power Q is raised to in C's unit.
const inUserUnits = ({ fit, L, qf }, v) => ({
  Bu: (fit.B * qf) / L,
  Cu: (fit.C * qf ** fit.P) / L,
  powName: v.model === 'jacob' ? '²' : 'ᴾ',
});

function render(out, r, v, example) {
  const { fit, rows, L, qf } = r, P = fit.P, jacob = v.model === 'jacob', u = units(v);
  const when = isSeries(v) ? `${v.dt} ${v.tUnit} into a step` : 'the time of the drawdowns given';
  const { Bu, Cu, powName } = inUserUnits(r, v);
  const eq = jacob ? `s = ${sz(Bu)} Q + ${sz(Cu)} Q²` : `s = ${sz(Bu)} Q + ${sz(Cu)} Qᴾ with P = ${sz(P)}`;
  const sd = (x) => decimals(x, r.places), cap3 = sigColumn(rows.map((x) => x.Q / x.sw), 3);
  const cap = `${u.q} per ${u.s}`;
  // The answer first, so it is on screen on a phone; the parts of the fit after it.
  const header = [
    'Step', 'Efficiency (%)', `Specific capacity (${cap})`, `s_w(n) (${u.s})`, `Rate (${u.q})`, `Fitted s (${u.s})`,
    `BQ (${u.s})`, `CQ${powName} (${u.s})`, `s_w(n)/Q (${u.s} per ${u.q})`, 'In fit',
  ];
  const raw = rows.map((x) => {
    const a = atRate(fit, x.Q * qf);
    return [x.n, a.efficiency, x.Q / x.sw, x.sw, x.Q, a.s / L, a.aquifer / L, a.well / L, x.sw / x.Q, r.leftOut.includes(x.n) ? 'left out' : 'used'];
  });
  // On the page BQ, CQ² and s_w(n)/Q are left out, and a step left out of the fit is
  // marked in the Step column, so the table fits a laptop screen. The method text and
  // the download have every column. Drawdowns by decimal places, efficiency to a tenth
  // of a percent and specific capacity to 3 figures as in the design rate line. The
  // download keeps every digit.
  const pageHeader = header.slice(0, 6);
  const per = raw.map(([n, efficiency, capacity, sw, Q, fitted, , , , inFit]) => [
    inFit === 'used' ? n : `${n}, left out`, decimals(efficiency, 1), cap3(capacity), sd(sw), Q, sd(fitted),
  ]);
  const coef = [['B', `${sz(Bu, 4)} ${u.s} per ${u.q}`], ['C', `${sz(Cu, 4)} ${u.s} per (${u.q})${powName}`]];
  if (!jacob) coef.push(['P', sz(P, 4)]);
  if (!u.si) coef.push(['B, in m and m³/d', `${sz(fit.B, 4)} m per m³/d`], ['C, in m and m³/d', `${sz(fit.C, 4)} m per (m³/d)${powName}`]);
  const design = v.design === undefined ? null : atRate(fit, v.design * qf);
  const warn = warnings(r, v);
  // The workbook carries the example's note and the warnings, as the page shows them.
  const text = { ...methodText(r, v, example), notes: [...(example ? [example.note] : []), ...warn] };
  const sheets = [{ name: 'Steps', header, rows: raw }];
  if (isSeries(v)) {
    sheets.push({
      name: 'Increments',
      header: ['Step', `Start (${v.tUnit})`, `Rate (${u.q})`, `Observed s at ${v.dt} ${v.tUnit} (${u.s})`, `Previous step's line extended (${u.s})`, `Increment (${u.s})`, `s_w(n) (${u.s})`],
      rows: rows.map((x) => [x.n, x.start, x.Q, x.observed, x.extrapolated, x.increment, x.sw]),
    });
  }
  // A rule of thumb carries two significant figures at most.
  const T = v.aquifer ? rows.map((x) => {
    const t = driscollT((x.Q * qf) / (x.sw * L), v.aquifer);
    return [x.n, x.Q / x.sw, t, t / UNITS.ft ** 2];
  }) : null;
  const tHead = ['Step', `Specific capacity (${cap})`, 'Rough T (m²/d)', 'Rough T (ft²/d)'];
  if (T) sheets.push({ name: 'Rough T', header: tHead, rows: T });
  out.append(...[
    panel(
      el('h2', {}, 'Well loss equation'),
      el('p', { class: 'chart-sub' }, `${eq}, with s in ${u.s} and Q in ${u.q}, at ${when}. B changes with time, so this holds for that time only.`),
      table(['Coefficient', 'Value'], coef),
      design ? el('p', {}, `At the design rate of ${v.design} ${u.q}: drawdown ${sz(design.s / L)} ${u.s}, of which ${sz(design.well / L)} ${u.s} is nonlinear well loss; efficiency ${sz(design.efficiency)}%; specific capacity ${sz(design.capacity * (L / qf))} ${cap}.`) : null,
      table(pageHeader, per),
      notes(warn),
      downloads(() => downloadWorkbook('step-drawdown.xlsx', sheets, text))),
    panel(fitChart(r, v)),
    isSeries(v) ? panel(timeChart(r, v)) : null,
    T ? panel(el('h2', {}, 'Rough transmissivity from specific capacity'),
      el('p', { class: 'chart-sub' }, `Driscoll's (1986) rule of thumb for a ${v.aquifer} aquifer, as quoted by Johnson (2005), from each step's specific capacity. It is a rough guide, not a test result, so it is given to two significant figures. Well loss adds to the drawdown, so a well with large losses gives a low value.`),
      table(tHead, T.map(([n, c, m2, ft2]) => [n, cap3(c), sz(m2, 2), sz(ft2, 2)]))) : null,
    methodPanel(text),
  ].filter(Boolean));
}

function fitChart(r, v) {
  const { fit, rows, used, L, qf } = r, u = units(v);
  const left = rows.filter((x) => r.leftOut.includes(x.n));
  const qs = rows.map((x) => x.Q).concat(v.design === undefined ? [] : [v.design]);
  const lo = Math.min(...qs) * 0.8, hi = Math.max(...qs) * 1.1;
  const x = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40);
  const series = [
    { label: 'Steps in the fit', x: used.map((p) => p.Q), y: used.map((p) => p.sw / p.Q), line: false, size: 10 },
    { label: v.model === 'jacob' ? 'B + CQ' : 'B + CQᴾ⁻¹', x, y: x.map((q) => atRate(fit, q * qf).s / L / q) },
  ];
  if (left.length) series.push({ label: 'Left out', x: left.map((p) => p.Q), y: left.map((p) => p.sw / p.Q), line: false, size: 10 });
  return chart({ title: 'Drawdown over rate against rate', xLabel: `Rate (${u.q})`, yLabel: `s/Q (${u.s} per ${u.q})`, series });
}

function timeChart(r, v) {
  const { t, s, starts } = r.readings, t0 = starts[0], keep = t.map((_, i) => i).filter((i) => t[i] > t0);
  const lines = r.rows.slice(1).map((x, i) => {
    const prev = r.rows[i], from = prev.start + v.fitFrom, to = x.start + v.dt;
    const xs = [Math.max(from, prev.start) - t0, to - t0].filter((d) => d > 0);
    return { label: `Step ${prev.n} line`, x: xs, y: xs.map((d) => x.trend.a + x.trend.b * Math.log10(d)) };
  });
  return el('div', { class: 'stack' },
    chart({
      title: 'Drawdown against time, with each step\'s line extended', xLabel: `Time since step 1 began (${v.tUnit})`, yLabel: `Drawdown (${v.sUnit})`, logX: true, invertY: true,
      series: [{ label: 'Readings', x: keep.map((i) => t[i] - t0), y: keep.map((i) => s[i]), line: false }, ...lines],
    }),
    el('p', { class: 'chart-sub' }, `Each increment is the drawdown ${v.dt} ${v.tUnit} into a step less the previous step's line at that time.`));
}

function methodText(r, v, example) {
  const { fit, used, leftOut, L, qf } = r, jacob = v.model === 'jacob', u = units(v);
  const { Bu, Cu, powName } = inUserUnits(r, v);
  const first = isSeries(v) ? {
    title: 'Drawdown at the same time in each step',
    lines: [
      `For each step, the drawdown ${v.dt} ${v.tUnit} after it began, interpolated between the readings either side. From that is taken the previous step's curve extended to the same time: a least squares line of drawdown against log time since step 1 began, through the previous step's readings from ${v.fitFrom} ${v.tUnit} after it began to its end. The book draws this line by eye on semi-log paper.`,
      'The increments Δs_w are summed to give s_w(n), the drawdown step n would cause on its own at that time (Procedure 14.1 of Kruseman and de Ridder 1994, after Hantush 1964).',
    ],
    formula: 's_w(n) = Δs_w(1) + Δs_w(2) + ... + Δs_w(n)',
    numbers: r.rows.map((x) => [`Step ${x.n}: increment, s_w(n) (${u.s})`, `${dd(x.increment)}, ${dd(x.sw)}`]),
  } : {
    title: 'Drawdown for each step',
    lines: ['The drawdowns in the file were used as they are, as s_w(n), the drawdown in step n. Kruseman and de Ridder (1994) allow this when the drawdown has stopped changing in each step.'],
    numbers: [],
  };
  const fitLines = jacob
    ? ['The equation is Jacob\'s (1947), s = BQ + CQ². Q_n is the rate of step n. A least squares straight line of s_w(n)/Q_n against Q_n. Its slope is C, the nonlinear well loss coefficient, and its value at Q = 0 is B, the linear loss coefficient (Hantush 1964; Bierschenk 1963).']
    : ['The equation is Rorabaugh\'s (1953), s = BQ + CQᴾ. Q_n is the rate of step n. For trial values of B, a least squares line of log(s_w(n)/Q_n − B) against log Q_n (Procedure 14.4 of Kruseman and de Ridder 1994). The B taken is the one with the smallest residual sum of squares, searched from 0 to just below the smallest s_w(n)/Q_n. The slope is P − 1 and the value at Q = 1 is C.'];
  if (!u.si) fitLines.push('Rates were converted to m³/d and drawdowns to metres for the fit. B and C are given in those units and in yours.');
  fitLines.push(`B is in ${u.s} per ${u.q}, and C in ${u.s} per (${u.q})${powName}, so that BQ and CQ${powName} are drawdowns.`);
  const second = jacob
    ? { title: 'Jacob equation by Hantush-Bierschenk', lines: fitLines, formula: 's_w(n) / Q_n = B + C Q_n', numbers: [] }
    : { title: 'Rorabaugh equation, trial B for the straightest line', lines: fitLines, formula: 'log(s_w(n)/Q_n − B) = log C + (P − 1) log Q_n', numbers: [] };
  // s/Q to one count of decimals, so 0.6200 and 0.7867 line up.
  const sq = sigColumn(r.rows.map((x) => x.sw / x.Q), 4);
  second.numbers.push(...r.rows.map((x) => [`Step ${x.n}: s_w(n)/Q_n (${u.s} per ${u.q})`, sq(x.sw / x.Q)]));
  second.numbers.push(['Steps in the fit', used.map((x) => x.n).join(', ')]);
  if (!u.si) second.numbers.push([`B (${u.s} per ${u.q})`, sz(Bu, 4)], [`C (${u.s} per (${u.q})${powName})`, sz(Cu, 4)]);
  second.numbers.push(['B (m per m³/d)', sz(fit.B, 4)], [`C (m per (m³/d)${powName})`, sz(fit.C, 4)]);
  if (!jacob) second.numbers.push(['P (no unit)', sz(fit.P, 4)]);
  if (leftOut.length) second.lines.push(`Left out of the fit at your request: step ${leftOut.join(', ')}.`);
  const steps = [first, second, {
    title: 'Well efficiency and specific capacity',
    lines: ['B holds the linear well loss as well as the aquifer loss, and a step test cannot separate them. So the efficiency E counts only the nonlinear loss, as Kruseman and de Ridder (1994) note, and a well can be less efficient than this shows. Specific capacity is rate over drawdown.'],
    formula: `E = BQ / (BQ + CQ${powName}) × 100%,  specific capacity = Q / s`,
    numbers: r.rows.map((x) => {
      const a = atRate(fit, x.Q * qf);
      return [`Step ${x.n}: BQ, CQ${powName} (${u.s})`, `${decimals(a.aquifer / L, r.places)}, ${decimals(a.well / L, r.places)}`];
    }),
  }];
  const refs = [KRUSEMAN_DE_RIDDER_1994, ...(jacob ? [BIERSCHENK, HANTUSH_1964_IN_COLON, JACOB] : [RORABAUGH]), ...(isSeries(v) && !jacob ? [HANTUSH_1964_IN_COLON] : [])];
  if (example && example.cites) refs.push(SOURCE_REFS[example.cites]);
  if (v.aquifer) {
    steps.push({
      title: 'Rough transmissivity (Driscoll 1986)',
      lines: [
        'A rule of thumb from specific capacity. The factors 2000 and 1500 and their units are as Johnson (2005) quotes them from Driscoll (1986). It ignores well loss, so a well with large losses gives a low value. Treat the result as a rough guide.',
        'Converted from US gallons and feet to m²/d and ft²/d for the table.',
      ],
      formula: 'T = 2000 Q/s (confined) or 1500 Q/s (unconfined)\nT in US gal/d per ft, Q/s in US gal/min per ft',
      numbers: [],
    });
    refs.push(...DRISCOLL_REFS);
  }
  return { steps, references: refs.sort() };
}
