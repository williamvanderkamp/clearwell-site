// Test for a trend: the Mann-Kendall test, Sen's slope and the seasonal Mann-Kendall
// test, as used for groundwater monitoring. The math is in engine/trend.js.
import { median } from '../../engine/numeric.js';
import { EXACT_MAX_N, mannKendall, seasonalMannKendall } from '../../engine/trend.js';
import { chart, columnSpec, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table } from '../kit.js';
import { minus } from '../format.js';
import { detectDayFirst, parseStamp } from '../read-file.js';
import { EXAMPLES, SPEC_EXAMPLES } from './trend-examples.js';

// Decimal years count each calendar year in its own days, 365 or 366, so 1983-01-01 is
// 1983.0000, not 1982.9993 as a 365.25-day year from 1970 would make it.
const decimalYear = (ms) => {
  const y = new Date(ms).getUTCFullYear(), start = Date.UTC(y, 0, 1);
  return y + (ms - start) / (Date.UTC(y + 1, 0, 1) - start);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// option: the short text in the select; label: the full text in the method.
const SEASONS = {
  months: { option: '12 months', label: '12 months', of: (m) => m + 1, name: (s) => MONTHS[s - 1] },
  quarters: { option: '4 quarters', label: '4 quarters: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec', of: (m) => Math.floor(m / 3) + 1, name: (s) => `Q${s}` },
  halves: { option: '2 halves', label: '2 halves: Jan-Jun, Jul-Dec', of: (m) => (m < 6 ? 1 : 2), name: (s) => (s === 1 ? 'Jan-Jun' : 'Jul-Dec') },
};
const DIRECTIONS = [['two', 'Up or down (two-sided)'], ['up', 'Increasing (one-sided)'], ['down', 'Decreasing (one-sided)']];
const DIRECTION_TEXT = { two: 'a trend up or down (two-sided)', up: 'an increasing trend (one-sided)', down: 'a decreasing trend (one-sided)' };
const ALPHAS = [['0.01', '0.01 (99% confidence)'], ['0.05', '0.05 (95% confidence)'], ['0.1', '0.10 (90% confidence)']];

// In order by author. Hirsch, Slack and Smith (1982) is cited only by the seasonal test.
const HIRSCH = 'Hirsch, R.M., Slack, J.R., and Smith, R.A. (1982) Techniques of trend analysis for monthly water quality data. Water Resources Research 18(1), 107-121.';
const REFERENCES = [
  'Gilbert, R.O. (1987) Statistical Methods for Environmental Pollution Monitoring. Van Nostrand Reinhold, New York. Chapters 16 and 17.',
  HIRSCH,
  'Kendall, M.G. (1975) Rank Correlation Methods, 4th edition. Charles Griffin, London.',
  'Mann, H.B. (1945) Nonparametric tests against trend. Econometrica 13(3), 245-259.',
  'Sen, P.K. (1968) Estimates of the regression coefficient based on Kendall\'s tau. Journal of the American Statistical Association 63(324), 1379-1389.',
  'USEPA (2009) Statistical Analysis of Groundwater Monitoring Data at RCRA Facilities: Unified Guidance. EPA 530/R-09-007. Office of Resource Conservation and Recovery, Washington, DC. Sections 14.3.4, 17.3.2 and 17.3.3, and Table 17-5.',
];

// The page, the table and the method write p and Z the same way, with trailing zeros.
const pText = (p) => sig(p, 3, true);
const zText = (z) => sig(z, 4, true);

// Var(S) keeps every whole digit: 214375, not 214400. A whole number stays whole (43,
// not 43.00), so the table and the method agree.
const varText = (v) => {
  const w = Math.round(v);
  if (Math.abs(v - w) < 1e-9 * Math.max(1, Math.abs(v))) return minus(String(w));
  return Math.abs(v) >= 1e4 && Math.abs(v) < 1e9 ? minus(String(w)) : sig(v, 4, true);
};

// The slope and its interval to the same decimal places, set by 4 significant figures
// of the largest of the three, so 0.06000, 0.05277 and 0.08000, not 0.06, 0.05277 and 0.08.
// NaN where there is no value, which the table shows as n/a.
function slopeTexts(r) {
  const vals = [r.slope, r.lower, r.upper];
  const big = Math.max(0, ...vals.filter(Number.isFinite).map(Math.abs));
  const plain = big >= 1e-3 && big < 1e6;
  const dp = plain ? Math.max(0, 3 - Math.floor(Math.log10(big))) : 0;
  return vals.map((v) => {
    if (!Number.isFinite(v)) return NaN;
    if (!plain) return sig(v, 4);
    const t = v.toFixed(dp);
    return minus(/^-0\.?0*$/.test(t) ? t.slice(1) : t);
  });
}
const shown = (x) => (typeof x === 'number' ? 'n/a' : x);

// The unit in a heading such as "Sulfate (mg/L)", or '' when it names none.
const unitOf = (name) => { const m = String(name).match(/\(([^()]+)\)\s*$/); return m ? m[1] : ''; };
const withUnit = (label, name) => (unitOf(name) ? `${label} (${unitOf(name)})` : label);

// A cell as a detected value, a non-detect written "<RL", or nothing usable.
function readCell(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return { value: c };
  const m = typeof c === 'string' && c.trim().match(/^<\s*(\d+\.?\d*|\.\d+)$/);
  return m ? { rl: parseFloat(m[1]) } : null;
}

// Times in years and the values for the test and for the slope (USEPA 2009, 17.3.2 and 17.3.3).
function series(table, dateCol, col, dayFirst) {
  const points = [];
  let skipped = 0;
  for (const r of table.rows) {
    const ms = parseStamp(r[dateCol], dayFirst, false), cell = readCell(r[col]);
    if (!Number.isFinite(ms) || !cell) { skipped++; continue; }
    points.push({ ms, ...cell });
  }
  points.sort((a, b) => a.ms - b.ms);
  const detects = points.filter((p) => p.value !== undefined).map((p) => p.value);
  const nd = points.length - detects.length;
  if (nd && !detects.length) throw new Error(`${table.header[col]}: every value is a non-detect, so there is no trend to test.`);
  const below = Math.min(...detects) - 1;
  return {
    points, skipped, nd,
    ndAbove: points.some((p) => p.rl !== undefined && p.rl >= Math.min(...detects)),
    t: points.map((p) => decimalYear(p.ms)),
    x: points.map((p) => (p.value !== undefined ? p.value : below)),
    senX: points.map((p) => (p.value !== undefined ? p.value : p.rl / 2)),
  };
}

function runColumn(table, v, col, dayFirst) {
  const s = series(table, v.date, col, dayFirst);
  const opts = { alpha: +v.alpha, direction: v.direction };
  if (v.test === 'mk') return { s, r: mannKendall({ t: s.t, x: s.x, senX: s.senX, ...opts }) };
  const season = SEASONS[v.seasons];
  const rows = s.points.map((p, i) => {
    const d = new Date(p.ms);
    const k = season.of(d.getUTCMonth());
    return { season: k, label: season.name(k), year: d.getUTCFullYear(), x: s.x[i], senX: s.senX[i], t: s.t[i] };
  });
  return { s, r: seasonalMannKendall({ rows, ...opts }) };
}

const isDepth = (name) => /depth|below/i.test(name);
const confidence = (v) => `${Math.round((1 - v.alpha) * 100)}%`;

function columnNotes(name, { s, r }, v) {
  // The exact table is used only for the plain test on a few values with no ties.
  const exactRange = v.test === 'mk' && r.n <= EXACT_MAX_N;
  const out = [];
  if (s.skipped) out.push(`${name}: ${s.skipped} ${s.skipped === 1 ? 'row' : 'rows'} left out because the date or the value could not be read. Text such as ND without a reporting limit counts as unreadable.`);
  if (s.nd === 1) out.push(`${name}: 1 non-detect. For the test it takes a value below every detected value; for the slope it is half its reporting limit (USEPA 2009, 17.3.2 and 17.3.3).`);
  if (s.nd > 1) out.push(`${name}: ${s.nd} non-detects. For the test they share one value below every detected value, so they tie with each other; for the slope each is half its reporting limit (USEPA 2009, 17.3.2 and 17.3.3).`);
  if (s.ndAbove) out.push(`${name}: some reporting limits are at or above detected values. The guidance calls treating every non-detect as tied an imperfect remedy in that case.`);
  if (r.pMethod === 'normal' && exactRange) out.push(`${name}: ${r.n} values with ties. The exact table assumes no ties, so the p-value is from the normal approximation, which is rough at this size.`);
  if (r.pMethod === 'normal' && !exactRange) out.push(`${name}: the p-value is from the standard normal distribution of Z.`);
  if (r.pMethod === 'exact') out.push(`${name}: ${r.n} values and no ties, so the p-value is exact, from the distribution of S under no trend (Gilbert 1987; USEPA 2009 Table 17-5).`);
  if (r.skipped && r.skipped.length) out.push(`${name}: seasons with fewer than 3 values were left out, as the guidance requires: ${r.skipped.map((k) => `${k.label} (${k.n})`).join(', ')}.`);
  if (v.test === 'smk' && r.n < 10) out.push(`${name}: only ${r.n} values in the seasonal test. The guidance says the normal approximation needs about 10 or more.`);
  if (!Number.isFinite(r.lower) || !Number.isFinite(r.upper)) out.push(`${name}: too few pairs for a ${confidence(v)} interval on the slope.`);
  if (isDepth(name)) out.push(`${name}: for depth to water, an increasing trend means the water level is falling.`);
  return out;
}

// The slope and its interval as the method states them, in the column's own unit.
function slopeLine(name, r, v) {
  const [b, lo, hi] = slopeTexts(r).map(shown);
  return `${b} ${unitOf(name) || 'column unit'} per year, ${confidence(v)} interval ${lo} to ${hi}`;
}

function methodText(v, results) {
  const seasonal = v.test === 'smk';
  // One line for each tested column.
  const each = (f) => results.map(({ name, r }) => [name, f(r, name)]);
  const steps = [
    {
      title: 'Values used',
      lines: [
        'Each column was ordered by date. A cell written as < followed by a number is a non-detect with that reporting limit. Other text and blank cells were left out.',
        seasonal
          ? `The seasonal test used ${SEASONS[v.seasons].label}, with at most one value per season each year.`
          : 'Time is in decimal years, each year counted in its own days, 365 or 366, so 1 January is a whole year; the chart counts from the first sample.',
      ],
      numbers: each((r) => `${r.n} values`),
    },
    seasonal
      ? {
        title: 'Seasonal Mann-Kendall statistic',
        lines: ['The Mann-Kendall S (Mann 1945) is found for each season across years, then summed. The variances add because the seasons are taken as independent (Hirsch, Slack and Smith 1982; USEPA 2009, eqs. 14.24 to 14.26).'],
        formula: 'S = sum over seasons of S_i,  Var(S) = sum of Var(S_i)',
        numbers: each((r) => `S = ${r.S}, Var(S) = ${varText(r.V)}`),
      }
      : {
        title: 'Mann-Kendall statistic',
        lines: ['Every earlier value is compared with every later one: +1 if the later is higher, −1 if lower, 0 if equal (Mann 1945; USEPA 2009, eqs. 17.30 and 17.31).'],
        formula: 'S = sum over i < j of sgn(x_j − x_i)',
        numbers: each((r) => `S = ${r.S}`),
      },
    {
      title: 'Variance and Z',
      lines: [
        'The variance of S under no trend, corrected for tied values (Kendall 1975; USEPA 2009, eq. 17.27). Z uses the continuity correction (eq. 17.29).',
        'Here n is the number of values and t is the size of each group of equal values. When samples share a date, the terms for tied times in Kendall (1975) are added too.',
      ],
      formula: 'Var(S) = [n(n − 1)(2n + 5) − sum t(t − 1)(2t + 5)] / 18\nZ = (S − 1) / √Var(S) if S > 0,  (S + 1) / √Var(S) if S < 0,  0 if S = 0',
      numbers: each((r) => `Var(S) = ${varText(r.V)}, Z = ${zText(r.Z)}`),
    },
    {
      title: 'p-value and result',
      lines: [
        `For ${EXACT_MAX_N} or fewer values with no ties the p-value is exact, from the distribution of S (Kendall 1975; tabled in Gilbert 1987 and USEPA 2009 Table 17-5). Otherwise it is from the standard normal distribution of Z.`,
        `Test for ${DIRECTION_TEXT[v.direction]}, at a significance level of ${v.alpha}. A trend is reported when p is below that level.`,
      ],
      numbers: each((r) => `p = ${pText(r.p)} (${r.pMethod}): ${r.verdict}`),
    },
    {
      title: seasonal ? 'Seasonal Sen slope' : 'Sen slope',
      lines: [
        seasonal
          ? 'The slope is the median of every within-season slope (x_k − x_j) / (year_k − year_j), the seasonal form of the Sen (1968) slope (Hirsch, Slack and Smith 1982).'
          : 'The slope is the median of every pairwise slope (x_j − x_i) / (t_j − t_i), pairs with the same time left out (Sen 1968; USEPA 2009, eqs. 17.32 and 17.33).',
        `The ${confidence(v)} interval follows Gilbert (1987, pp. 218-219): with N' slopes in order, the limits are at ranks M1 and M2 + 1, interpolated between neighbours when they are not whole numbers. Here α is the significance level and z(1 − α/2) the standard normal value with that share of the distribution below it.`,
        'The line on the chart passes through the median time and median value (USEPA 2009, eq. 17.35).',
      ],
      formula: "C = z(1 − α/2) √Var(S),  M1 = (N' − C) / 2,  M2 = (N' + C) / 2",
      numbers: each((r, name) => slopeLine(name, r, v)),
    },
  ];
  return { steps, references: seasonal ? REFERENCES : REFERENCES.filter((r) => r !== HIRSCH) };
}

// Through the median time and median value (USEPA 2009, eq. 17.35).
function senLine(r, s) {
  const t0 = s.t[0], t1 = s.t[s.t.length - 1];
  const b = median(s.senX) - r.slope * median(s.t);
  return { label: 'Sen slope line', x: [t0, t1], y: [b + r.slope * t0, b + r.slope * t1] };
}

function columnChart(name, { s, r }) {
  const t0 = s.t[0], since = (t) => t - t0;
  const det = s.points.map((p, i) => [p, since(s.t[i])]).filter(([p]) => p.value !== undefined);
  const nds = s.points.map((p, i) => [p, since(s.t[i])]).filter(([p]) => p.rl !== undefined);
  // The Sen line always takes the second colour, so it is the same on every chart;
  // non-detects come after it.
  const series = [{ label: name, x: det.map((d) => d[1]), y: det.map((d) => d[0].value), line: false }];
  const line = Number.isFinite(r.slope) ? senLine(r, s) : { label: 'Sen slope line (no slope)', x: [], y: [] };
  series.push({ ...line, x: line.x.map(since) });
  if (nds.length) series.push({ label: 'Non-detect, at its reporting limit', x: nds.map((d) => d[1]), y: nds.map((d) => d[0].rl), line: false });
  const start = new Date(s.points[0].ms).toISOString().slice(0, 10);
  // Depth to water points down, as on the record tool, so a falling level plots lower.
  return chart({ title: name, xLabel: `Years since ${start}`, yLabel: name, series, invertY: isDepth(name) });
}

// The download keeps every number in its own column.
const resultHeader = (v) => ['Column', 'Values', 'S', 'Var(S)', 'Z', 'p', 'p from', `Result at ${v.alpha}`, 'Sen slope (column unit per year)', `${confidence(v)} lower`, `${confidence(v)} upper`];
// On the page the interval is one column and how p was found is a note, so the table
// fits a laptop screen, and the answer comes first, so it is in view on a narrow one.
// The slope is in the unit of each tested column, per year.
function pageHeader(v, results) {
  const units = [...new Set(results.map(({ name }) => unitOf(name)))];
  const per = units.length === 1 && units[0] ? `${units[0]} per year` : 'per year, column unit';
  return ['Column', `Result at ${v.alpha}`, `Sen slope (${per})`, `${confidence(v)} interval`, 'p', 'Z', 'S', 'Var(S)', 'Values'];
}
// No-break spaces, so an interval never splits across lines.
const interval = (lo, hi) => (typeof lo === 'string' && typeof hi === 'string' ? `${lo}\u00a0to\u00a0${hi}` : 'n/a');

// Excel sheet names cannot hold / and a few other marks, so mg/L becomes mg per L.
const sheetName = (s, i) => `${i + 1} ${s}`.replace(/\//g, ' per ').replace(/[[\]:*?\\]/g, ' ').slice(0, 31);

function download(v, results, text) {
  const sheets = [{
    name: 'Results', header: resultHeader(v),
    rows: results.map(({ name, r }) => [name, r.n, r.S, r.V, r.Z, r.p, r.pMethod, r.verdict, r.slope, r.lower, r.upper]),
  }];
  // Dates go in as year-month-day text, which the workbook writes as real Excel dates.
  results.forEach(({ name, s }, i) => sheets.push({
    name: sheetName(name, i),
    header: ['Date', 'Decimal year', name, ...['Non-detect limit', 'Value in test', 'Value for slope'].map((h) => withUnit(h, name))],
    rows: s.points.map((p, k) => [new Date(p.ms).toISOString().slice(0, 10), s.t[k], p.value ?? null, p.rl ?? null, s.x[k], s.senX[k]]),
  }));
  downloadWorkbook('trend-test.xlsx', sheets, text);
}

export default {
  id: 'trend',
  title: 'Test for a trend',
  blurb: 'Is a water level or concentration rising or falling? Test it with Mann-Kendall and Sen\'s slope, with a seasonal option.',
  lede: 'The Mann-Kendall test for a trend and Sen\'s slope with its confidence interval, the nonparametric trend statistics used for groundwater monitoring. The seasonal Mann-Kendall test is an option.',
  mount(host) {
    let data = null, example = null;
    const ambiguous = new Map();
    const isAmbiguous = (col) => {
      if (!data || col === undefined) return false;
      if (!ambiguous.has(col)) ambiguous.set(col, detectDayFirst(data.rows.map((r) => r[col])) === null);
      return ambiguous.get(col);
    };
    const out = el('div', { class: 'stack' });
    const { status } = fileDrop(host, {
      text: 'A spreadsheet or CSV with a date column and one or more value columns.',
      examples: EXAMPLES,
      onTable: load,
    });
    columnSpec(host, {
      columns: [
        { name: 'Date', need: 'Required', what: 'The date of each sample, or date and time. One row per sample.', headings: ['Date', 'Date and time'] },
        { name: 'Values', need: 'Required', what: 'One or more columns of water levels or concentrations, each tested on its own. Name the unit in the heading.', headings: ['Depth to water (ft)', 'Sulfate (mg/L)'] },
      ],
      notes: ['Write a non-detect as < and its reporting limit, for example <0.5. Other text, such as ND with no limit, is left out.', 'For the seasonal test, give at most one value per season in each year.'],
      examples: SPEC_EXAMPLES,
    });
    const f = form(host, {
      fields: [
        { id: 'date', label: 'Date column', type: 'column', required: true },
        {
          id: 'order', label: 'Date order', type: 'select', options: [['dmy', 'Day first (31/12/2026)'], ['mdy', 'Month first (12/31/2026)']],
          required: (v) => isAmbiguous(v.date), show: (v) => isAmbiguous(v.date), hint: 'Every date in this column could be read either way.',
        },
        { id: 'cols', label: 'Columns to test', type: 'text', required: true, hint: 'Tick one or more.' },
        { id: 'test', label: 'Test', type: 'select', options: [['mk', 'Mann-Kendall'], ['smk', 'Seasonal Mann-Kendall']], required: true },
        {
          id: 'seasons', label: 'Seasons', type: 'select', options: Object.entries(SEASONS).map(([k, s]) => [k, s.option]),
          required: (v) => v.test === 'smk', show: (v) => v.test === 'smk', hint: 'Quarters start in January; halves are January to June and July to December.',
        },
        { id: 'direction', label: 'Trend to test for', type: 'select', options: DIRECTIONS, required: true },
        { id: 'alpha', label: 'Significance level', type: 'select', options: ALPHAS, required: true, hint: 'Also sets the confidence level of the slope interval.' },
      ],
      onRun: run,
    });
    // The column checkboxes stand in for the hidden text field that holds their indices.
    const colsInput = f.element.querySelector('#x-cols');
    const colsLabel = f.element.querySelector('label[for="x-cols"]');
    colsLabel.id = 'x-cols-label';
    colsLabel.removeAttribute('for');
    const picks = el('div', { class: 'group', role: 'group', 'aria-labelledby': 'x-cols-label' });
    colsInput.hidden = true;
    colsInput.after(picks);
    const pickCols = (list) => f.set('cols', list.join(','));
    const ticked = () => [...picks.querySelectorAll('input:checked')].map((c) => c.value);
    // Every column but the date column, keeping the ticks that are still offered.
    function listColumns() {
      const date = f.values().date;
      const kept = new Set((f.values().cols || '').split(',').filter((c) => c !== '' && +c !== date && data && +c >= 0 && +c < data.header.length));
      picks.textContent = '';
      if (!data) { picks.append(el('span', { class: 'hint' }, 'The columns appear here once a file is loaded.')); return; }
      data.header.forEach((h, i) => {
        if (i === date) return;
        const box = el('input', { type: 'checkbox', value: String(i), checked: kept.has(String(i)), onchange: () => pickCols(ticked()) });
        picks.append(el('label', { class: 'check' }, box, h || `Column ${i + 1}`));
      });
      pickCols([...kept]);
    }
    f.element.querySelector('#x-date').addEventListener('change', listColumns);
    listColumns();
    host.append(out);

    // Everything from an earlier file or example is cleared first. An example sets only
    // what its source gives; its note says which choices are left to the user.
    function load(t) {
      f.reset();
      data = t.table;
      example = t.example || null;
      ambiguous.clear();
      out.textContent = '';
      f.setColumns(data.header);
      f.set('date', findColumn(data.header, /date|time/i));
      const c = example && example.choices;
      if (c) {
        for (const k of ['test', 'seasons', 'direction', 'alpha']) if (c[k]) f.set(k, c[k]);
        f.set('cols', c.cols.map((name) => String(data.header.indexOf(name))).join(','));
      }
      listColumns();
      // An example's word on what is left to choose is on the same line, in bold.
      status(example ? example.about : `${t.name}: ${data.rows.length} rows, ${data.header.length} columns.`, ...(example && example.needs ? [' ', el('strong', {}, example.needs)] : []));
    }

    function run(v) {
      out.textContent = '';
      try {
        if (!data) throw new Error('Add a file or choose an example first.');
        const about = example ? example.about : null;
        const dayFirst = isAmbiguous(v.date) ? v.order === 'dmy' : detectDayFirst(data.rows.map((r) => r[v.date]));
        const cols = v.cols.split(',').map(Number).filter((c) => c !== v.date);
        if (!cols.length) throw new Error('Tick at least one column other than the date column.');
        const results = cols.map((col) => {
          const name = data.header[col] || `Column ${col + 1}`;
          try { return { name, ...runColumn(data, v, col, dayFirst) }; } catch (e) { throw new Error(`${name}: ${e.message}`); }
        });
        const list = results.flatMap((x) => columnNotes(x.name, x, v));
        list.push('The test assumes the values are independent of each other. Closely spaced readings, such as daily water levels, usually are not, which makes a trend look more certain than it is (USEPA 2009, 17.3.3).');
        // The workbook carries the example's note and the page's notes.
        const text = { ...methodText(v, results), notes: [...(about ? [about] : []), ...list] };
        const rows = results.map(({ name, r }) => {
          const [b, lo, hi] = slopeTexts(r);
          return [name, r.verdict, b, interval(lo, hi), pText(r.p), zText(r.Z), r.S, varText(r.V), r.n];
        });
        out.append(
          panel(
            el('h2', {}, v.test === 'smk' ? 'Seasonal Mann-Kendall test' : 'Mann-Kendall test'),
            about ? el('p', { class: 'chart-sub' }, about) : null,
            el('p', { class: 'chart-sub' }, `At a significance level of ${v.alpha}: ${results.map(({ name, r }) => `${name}, ${r.verdict.toLowerCase()}`).join('; ')}. Slopes are per year in each column's own units, with a ${confidence(v)} interval.`),
            table(pageHeader(v, results), rows),
            notes(list),
            el('div', { class: 'downloads' }, el('button', { class: 'btn', type: 'button', onclick: () => download(v, results, text) }, 'Download spreadsheet'))),
          ...results.map((x) => panel(columnChart(x.name, x))),
          panel(el('h2', {}, 'Exactly what was done'), method(text)));
        done(host);
      } catch (e) {
        out.append(errorBox(e.message));
      }
    }
  },
};
