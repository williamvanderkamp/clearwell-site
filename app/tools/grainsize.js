// Estimate K from grain size: the HydrogeoSieveXL 2.1 (Devlin 2015) methods, reimplemented
// in the browser. A sieve analysis goes in; the curve, d10 to d60, and K by 15 published
// formulas come out.
import { grainSizeK, SIZE_UNITS } from '../../engine/grainsize.js';
import { chart, columnSpec, columnValues, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table, tenTo } from '../kit.js';
import { fixed, toCsv } from '../format.js';

const SIZE_UNIT_OPTIONS = [['mm', 'mm'], ['um', 'micrometres (µm)'], ['in', 'inches']];
const KINDS = [['passing', 'Percent passing'], ['mass', 'Mass retained']];
// Seconds in a day, for K in m/d from m/s.
const DAY = 86400;

const VUKOVIC = [[2, 100], [0.82, 80], [0.55, 60], [0.42, 40], [0.28, 20], [0.15, 10], [0.045, 0]];
const ODONG = [[10, 85.23], [4.75, 79.57], [2.36, 66.73], [1.18, 49.99], [0.6, 30.75], [0.425, 17.55], [0.3, 6.28], [0.15, 2.84], [0.075, 0]];
const HEADER = ['Sieve opening (mm)', 'Percent passing'];

const EXAMPLES = [
  { label: 'Vuković and Soro example', name: 'vukovic-soro-example-1.csv', csv: toCsv(HEADER, VUKOVIC), rows: VUKOVIC, T: 20,
    note: 'Example values. The sieve data are Example 1, Case 1 of Vuković and Soro (1992), as given in the Examples sheet of HydrogeoSieveXL (Devlin 2015). The temperature, 20 °C, is the one HydrogeoSieveXL 2.3.11 is saved with for this sample; the Examples sheet labels the case 15 °C.' },
  { label: 'Odong sample 1', name: 'odong-sample-1.csv', csv: toCsv(HEADER, ODONG), rows: ODONG, T: 20, cites: 'odong',
    note: 'Example values. Sample 1 of Odong (2007, Table 1), at the water temperature of 20 °C the paper uses, as given in the Examples sheet of HydrogeoSieveXL (Devlin 2015). The paper\'s table stops at the 0.150 mm sieve; the 0.075 mm sieve passing 0% is as in that sheet. Devlin (2015) cites the paper as Odong (2013) in the International Journal of Agriculture and Environment, a record that could not be found; the sieve data match Odong (2007).' },
];

// In order by author. Odong (2007) is listed only with its sample loaded, as only that
// example's note cites it. Issues, years and DOIs of Devlin, Chapuis and Krumbein and
// Monk are as Crossref gives them.
const ODONG_REF = 'Odong, J. (2007) Evaluation of empirical formulae for determination of hydraulic conductivity based on grain-size analysis. Journal of American Science 3(3), 54-60.';
const REFERENCES = [
  'Alyamani, M.S., and Sen, Z. (1993) Determination of hydraulic conductivity from complete grain-size distribution curves. Ground Water 31(4), 551-555.',
  'Barr, D.W. (2001) Coefficient of permeability determined by measurable parameters. Ground Water 39(3), 356-361.',
  'Beyer, W. (1964) Zur Bestimmung der Wasserdurchlässigkeit von Kiesen und Sanden aus der Kornverteilungskurve. Wasserwirtschaft-Wassertechnik 14(6), 165-168.',
  'Białas, Z. (1966) O usrednianiu wspolczynnikow filtracji z zastosowaniem elektronicznej cyfrowej maszyny matematycznej. Przedsiebiorstwo Geologiczne we Wroclawiu, 47-50.',
  'Chapuis, R.P. (2004) Predicting the saturated hydraulic conductivity of sand and gravel using effective diameter and void ratio. Canadian Geotechnical Journal 41(5), 787-795. doi:10.1139/t04-022.',
  'Devlin, J.F. (2015) HydrogeoSieveXL: an Excel-based tool to estimate hydraulic conductivity from grain-size analysis. Hydrogeology Journal 23(4), 837-844. doi:10.1007/s10040-015-1255-0.',
  'Freeze, R.A., and Cherry, J.A. (1979) Groundwater. Prentice-Hall, Englewood Cliffs, New Jersey, 604 p.',
  'Hazen, A. (1892) Some physical properties of sands and gravels, with special reference to their use in filtration. Massachusetts State Board of Health, 24th annual report, 539-556.',
  'Kozeny, J. (1953) Das Wasser im Boden. Grundwasserbewegung. Hydraulik, Springer, 380-445.',
  'Krüger, E. (1919) Die Grundwasserbewegung. Internationale Mitteilungen für Bodenkunde 8, 105-122.',
  'Krumbein, W.C., and Monk, G.D. (1943) Permeability as a function of the size parameters of unconsolidated sand. Transactions of the AIME 151(1), 153-163. doi:10.2118/943153-G.',
  ODONG_REF,
  'Slichter, C.S. (1898) Theoretical investigations of the motion of ground waters. U.S. Geological Survey 19th Annual Report, 295-384.',
  'Terzaghi, K. (1925) Principles of soil mechanics. Engineering News-Record 95, 832.',
  'Vuković, M., and Soro, A. (1992) Determination of hydraulic conductivity of porous media from grain-size composition. Water Resources Publications, Littleton, Colorado.',
  'Zamarin, J.A. (1928) Calculation of ground-water flow (in Russian). Trudey I.V.H. Taskeni.',
  'Zunker, F. (1930) Das Verhalten des Wassers zum Boden. Zeitschrift für Pflanzenernährung, Düngung und Bodenkunde A25(1), 7.',
];

// K is an order-of-magnitude estimate, so 3 significant figures. In m/s every value is
// written as a power of ten, 1.29 × 10⁻³ beside 3.54 × 10⁻⁴, so a column reads at a glance
// and never splits across lines as 1.29e- over 3. In m/d it is a plain number with its
// trailing zeros (22.0, not 22). A K that could not be computed shows a dash; the verdict
// and the note above the table say why.
function kSci(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v))), m = (v / 10 ** e).toFixed(2);
  if (Math.abs(+m) >= 10) { e += 1; m = (v / 10 ** e).toFixed(2); }
  // No-break spaces, so 9.20 × 10⁻⁴ stays on one line in a sentence too.
  return `${m}\u00a0×\u00a0${tenTo(e)}`;
}
function kPlain(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return String(Math.round(v));
  return a >= 1e-3 ? v.toPrecision(3) : kSci(v);
}

// The sizes each derived quantity is read from, so a missing one can be named.
const NEEDS = { dgm: ['d16', 'd50', 'd84'], sigma: ['d5', 'd16', 'd84', 'd95'], I0: ['d10', 'd50'] };
const joinList = (xs, word) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}` : String(xs[0]));
const orList = (xs) => joinList(xs, 'or');
// Quantities with no length unit: the uniformity coefficient, porosity and sorting.
const PLAIN = new Set(['U', 'n', 'sigma']);
const SIZES = ['d10', 'd17', 'd20', 'd50', 'd60', 'kruger', 'kozeny', 'zunker', 'zamarin', 'dgm', 'I0'];
/**
 * Decimals for every size in mm: 3, or more for a fine sample, so the smallest size
 * still has 3 figures. One count for the whole table, so 0.150 sits beside 0.241.
 */
const sizePlaces = (g) => {
  // I0 is a difference of sizes and can be near zero, so it does not set the decimals.
  const small = Math.min(...SIZES.filter((k) => k !== 'I0').map((k) => Math.abs(g[k])).filter((x) => Number.isFinite(x) && x > 0));
  return Number.isFinite(small) ? Math.min(6, Math.max(3, 2 - Math.floor(Math.log10(small)))) : 3;
};
/**
 * A grain size in mm to the sample's decimals, U, n and σ to 3 decimals, or "not found".
 * why: also say which sizes the curve does not reach (the method text); the table leaves
 * that to the note above it, so its column stays a column of numbers.
 */
function sizeText(g, k, why = true) {
  if (Number.isFinite(g[k])) return fixed(g[k], PLAIN.has(k) ? 3 : sizePlaces(g));
  const missing = (NEEDS[k] || [k]).filter((d) => !Number.isFinite(g[d]));
  return why && missing.length ? `not found: the curve does not reach ${orList(missing)}` : 'not found';
}

function verdict(m) {
  if (!Number.isFinite(m.K)) return 'Could not compute; see the note above';
  if (m.never) return 'Not tested; not counted';
  if (m.always) return 'No range stated; counted';
  return m.counted ? 'Yes; counted' : 'No; not counted';
}

function sizeUnitOf(heading) {
  const h = String(heading);
  if (/µm|\bum\b|micron/i.test(h)) return 'um';
  if (/\bmm\b/i.test(h)) return 'mm';
  if (/\binch|\(in\)/i.test(h)) return 'in';
  return undefined;
}

// Constants are copied from the program as 3.1e-8. The page writes them as sig() does:
// a plain decimal from 0.001 up (2.102e-2 is 0.02102), and 3.1 × 10⁻⁸ below it.
const powers = (t) => t.replace(/\b(\d+(?:\.\d+)?)e-(\d+)\b/g, (_, m, e) => {
  const x = Number(`${m}e-${e}`);
  return x >= 1e-3 ? String(x) : `${m} × ${tenTo(-Number(e))}`;
});

// Typeset minus signs in the method text, after powers() has read constants such as 6e-4:
// a - b, (1-n) and -0.6435 become a − b, (1 − n) and −0.6435.
const minusSigns = (t) => t.replace(/ - /g, ' − ').replace(/\(1-n\)/g, '(1 − n)').replace(/(^|[\s(=^])-(?=[\d.])/gm, '$1−');

const leftOut = (rows) => (rows.length === 1
  ? `Data row ${joinList(rows, 'and')} was left out, as it does not hold a number in both columns.`
  : `Data rows ${joinList(rows, 'and')} were left out, as they do not hold a number in both columns.`);

function methodText(r, v, unitLabel, skipped, example) {
  const g = r.g, w = r.water, size = (k) => sizeText(g, k);
  const steps = [
    { title: 'Sieve curve', lines: [
      `${r.ps.length} sieves read, ${v.sizeUnit === 'mm' ? 'sizes in mm' : `sizes converted from ${unitLabel} to mm`}.${skipped.length ? ` ${leftOut(skipped)}` : ''}`,
      v.kind === 'mass' ? 'Percent passing was worked out from the masses retained, as HydrogeoSieveXL does: each sieve passes the mass on all finer sieves divided by the total of all masses given, and the finest sieve is taken to pass 0%.' : 'Percent passing as given.',
    ], numbers: [] },
    { title: 'Grain sizes from the curve', lines: ['Each size is read by a straight line in millimetres between the two sieves either side of that percent passing, as HydrogeoSieveXL 2.1 does. Its optional spline smoothing is not offered here. A size the curve does not reach is not estimated.'],
      formula: 'dP = d(i+1) + (d(i) - d(i+1)) (P - p(i+1)) / (p(i) - p(i+1))',
      numbers: [['d10 (mm)', size('d10')], ['d17 (mm)', size('d17')], ['d20 (mm)', size('d20')], ['d50 (mm)', size('d50')], ['d60 (mm)', size('d60')], ['U = d60/d10', size('U')]] },
    { title: 'Porosity', lines: ['No porosity is asked for. Every formula that needs one uses the empirical porosity from the uniformity coefficient that Vuković and Soro (1992) give and HydrogeoSieveXL uses.'],
      formula: 'n = 0.255 (1 + 0.83^U)', numbers: [['n', size('n')]] },
    { title: 'Water', lines: ['The water density ρ, its dynamic viscosity μ and Sauerbrei\'s temperature term τ, from the polynomials in HydrogeoSieveXL (Devlin 2015), at the water temperature T you entered. g = 980 cm/s² is the acceleration of gravity.'],
      formula: 'ρ = 3.1e-8 T³ - 7.0e-6 T² + 4.19e-5 T + 0.99985   (g/cm³)\nμ = -7.0e-8 T³ + 1.002e-5 T² - 5.7e-4 T + 0.0178   (g/cm s)\nτ = 1.093e-4 T² + 2.102e-2 T + 0.5889',
      numbers: [['Water temperature T (°C)', String(v.T)], ['ρ (g/cm³)', sig(w.rho, 4, true)], ['μ (g/cm s)', sig(w.mu, 4, true)], ['τ', sig(w.tau, 4, true)]] },
    { title: 'Effective diameters', lines: ['Krüger, Kozeny-Carman, Zunker and Zamarin use an effective diameter summed over the fraction dw between each pair of sieves, largest opening dg and smallest dd. Kozeny-Carman, Zunker and Zamarin add 1.5 dw / 0.0025 mm for the fines below the finest sieve only when that sieve is finer than 0.0025 mm, as in HydrogeoSieveXL.'],
      formula: 'Krüger:  1/de = sum dw 2 / (dg + dd)\nKozeny:  1/de = sum dw (dg + dd) / (2 dg dd)\nZunker:  1/de = sum dw (dg - dd) / (dg dd ln(dg/dd))\nZamarin: 1/de = sum dw ln(dg/dd) / (dg - dd)',
      numbers: [['de Krüger (mm)', size('kruger')], ['de Kozeny (mm)', size('kozeny')], ['de Zunker (mm)', size('zunker')], ['de Zamarin (mm)', size('zamarin')]] },
    { title: 'The formulas', lines: [
      'Most follow K = (ρg / μ) N φ(n) de², with de in cm and K in cm/s (Devlin 2015). Here N is the constant of each formula, φ(n) its porosity function, and de the grain size it uses (d10, d17, d20 or an effective diameter). Constants are those coded in HydrogeoSieveXL 2.1. Sauerbrei\'s 1932 formula is as Vuković and Soro (1992) give it.',
      'Krumbein and Monk use φ sizes, φ = log2(d in mm) as HydrogeoSieveXL computes it, of d16, d50 and d84 for the geometric mean diameter dgm, and the sorting σ = (φ84 - φ16)/4 + (φ95 - φ5)/6.6.',
      'Zunker is computed as the program computes it, with N = 1.55e-3 and φ(n) = (n/(1-n))². The table of equations in the HydrogeoSieveXL workbook prints φ(n) = n/(1-n) and N from 7e-4 to 2.4e-3 by grain type.',
    ], formula: [
      'Hazen:            6e-4 (1 + 10 (n - 0.26)) d10²',
      'Hazen simplified: K (cm/s) = d10 (mm)²',
      'Slichter:         1e-2 n^3.287 d10²',
      'Terzaghi:         8.4e-3 ((n - 0.13) / ∛(1 - n))² d10²',
      'Beyer:            5.2e-4 log10(500/U) d10²',
      'Sauerbrei:        3.75e-3 τ n³/(1-n)² d17²',
      'Krüger:           4.35e-4 n/(1-n)² de²',
      'Kozeny-Carman:    8.3e-3 n³/(1-n)² de²',
      'Zunker:           1.55e-3 (n/(1-n))² de²',
      'Zamarin:          8.65e-3 n³/(1-n)² (1.275 - 1.5 n)² de²',
      'USBR:             4.8e-4 10^0.3 d20^2.3',
      'Barr:             4.02e-3 n³/(1-n)² d10²',
      'Alyamani and Sen: K (m/d) = 1300 (I0 + 0.025 (d50 - d10))², d in mm, I0 = d10 - (d50 - d10)/4',
      'Chapuis:          K (cm/s) = 10^(1.291 e - 0.6435) d10(mm)^(10^(0.5504 - 0.2937 e)), e = n/(1-n)',
      'Krumbein and Monk: k (darcy) = 760 dgm(mm)² exp(-1.31 σ), K = k ρg / μ',
    ].join('\n'), numbers: [['ρg / μ (1/cm s)', sig(w.gRhoMu, 4, true)], ['I0 (mm)', size('I0')], ['dgm (mm)', size('dgm')], ['Sorting σ (φ)', size('sigma')]] },
    { title: 'Which results are counted', lines: [
      'Each method is tested against the range HydrogeoSieveXL 2.1 codes for it, shown in the table. Results outside their range are shown but not counted. Barr and Alyamani and Sen have no stated range and are always counted; the simplified Hazen formula is never tested and never counted, as in the program.',
      `The geometric mean is of the counted methods, as HydrogeoSieveXL reports it. ${r.count} ${r.count === 1 ? 'was' : 'were'} counted. Each K is converted from cm/s to m/s and m/d for the tables.`,
    ], numbers: r.count ? [['Geometric mean (m/s)', kSci(r.geomean / 100)], ['Arithmetic mean (m/s)', kSci(r.mean / 100)]] : [['Counted methods', 'none, so there is no mean']] },
  ];
  return {
    steps: steps.map((st) => ({ ...st, lines: st.lines.map((l) => minusSigns(powers(l))), formula: st.formula && minusSigns(powers(st.formula)) })),
    references: example && example.cites === 'odong' ? REFERENCES : REFERENCES.filter((x) => x !== ODONG_REF),
  };
}

function warnings(r, skipped) {
  const g = r.g, list = [];
  if (skipped.length) list.push(leftOut(skipped));
  const missing = ['d5', 'd16', 'd17', 'd20', 'd50', 'd84', 'd95'].filter((k) => !Number.isFinite(g[k]));
  if (missing.length) list.push(`The curve does not reach ${orList(missing)}, so methods that need ${missing.length > 1 ? 'these sizes' : 'it'} could not be computed or could not have their range tested.`);
  if (g.I0 <= 0) list.push(`I0 for Alyamani and Sen is ${sig(g.I0, 4, true)} mm, at or below zero. HydrogeoSieveXL 2.1 uses it as it is; later versions set it to zero.`);
  if (!r.count) list.push('No method was within its stated range, so there is no mean.');
  return list;
}

// K in cm/s, m/s and m/d, as the workbook gives it.
const inUnits = (K) => [K, K / 100, K / 100 * DAY];

function render(out, host, r, v, unitLabel, skipped, example) {
  const warn = warnings(r, skipped);
  // The workbook carries the example's note and the page's notes.
  const text = { ...methodText(r, v, unitLabel, skipped, example), notes: [...(example ? [example.note] : []), ...warn] };
  const rows = r.methods.map((m) => [m.name, kSci(m.K / 100), kPlain(m.K / 100 * DAY), verdict(m), m.size, m.range]);
  const sizes = [
    ['d10 (mm)', 'd10'], ['d17 (mm)', 'd17'], ['d20 (mm)', 'd20'], ['d50 (mm)', 'd50'], ['d60 (mm)', 'd60'],
    ['Uniformity coefficient U', 'U'], ['Porosity n', 'n'],
    ['de Krüger (mm)', 'kruger'], ['de Kozeny (mm)', 'kozeny'], ['de Zunker (mm)', 'zunker'], ['de Zamarin (mm)', 'zamarin'],
    ['Geometric mean diameter dgm (mm)', 'dgm'], ['Sorting σ (φ)', 'sigma'], ['I0 (mm)', 'I0'],
  ];
  const sheets = [
    {
      name: 'K by method', header: ['Method', 'K (cm/s)', 'K (m/s)', 'K (m/d)', 'Within stated range', 'Grain size used', 'Range tested'],
      rows: [
        ...r.methods.map((m) => [m.name, ...inUnits(m.K), verdict(m), m.size, m.range]),
        ['Geometric mean of counted methods', ...inUnits(r.geomean)],
        ['Arithmetic mean of counted methods', ...inUnits(r.mean)],
      ],
    },
    { name: 'Grain sizes', header: ['Quantity', 'Value'], rows: sizes.map(([label, k]) => [label, r.g[k]]) },
    { name: 'Sieve curve', header: ['Sieve opening (mm)', 'Percent passing'], rows: r.ps.map((d, i) => [d, r.pp[i]]) },
  ];
  out.append(panel(
    el('h2', {}, 'Hydraulic conductivity'),
    el('p', { class: 'chart-sub' }, r.count ? `Geometric mean of the ${r.count} counted ${r.count === 1 ? 'method' : 'methods'} (within ${r.count === 1 ? 'its' : 'their'} stated range, or with no range stated): ${kSci(r.geomean / 100)} m/s (${kPlain(r.geomean / 100 * DAY)} m/d), at ${v.T} °C.` : 'No method was within its stated range, so there is no mean. The results are shown for reference.'),
    notes(warn),
    table(['Method', 'K (m/s)', 'K (m/d)', 'Within stated range', 'Grain size used', 'Range tested'], rows),
    el('div', { class: 'downloads' }, el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('grain-size-K.xlsx', sheets, text) }, 'Download spreadsheet'))),
  panel(
    chart({ title: 'Grain size distribution', xLabel: 'Sieve opening (mm)', yLabel: 'Percent passing', logX: true, series: [{ label: 'Percent passing', x: r.ps, y: r.pp, points: true }] }),
    table(['Quantity', 'Value'], sizes.map(([label, k]) => [label, sizeText(r.g, k, false)]))),
  panel(el('h2', {}, 'Exactly what was done'), method(text)));
  done(host);
}

export default {
  id: 'grainsize',
  title: 'Estimate K from grain size',
  blurb: 'You have a sieve analysis. See the grain size curve, d10 to d60, and hydraulic conductivity K by 15 published formulas.',
  lede: 'The HydrogeoSieveXL (Devlin 2015) methods, reimplemented in your browser: percent passing or mass retained on each sieve goes in, and hydraulic conductivity K comes out by each formula, flagged where the sample is outside the range the formula was made for.',
  mount(host) {
    let data = null, example = null;
    const out = el('div', { class: 'stack' });
    const { status } = fileDrop(host, {
      text: 'A sieve analysis: one row per sieve, with the opening size and either percent passing or mass retained.',
      examples: EXAMPLES,
      onTable: load,
    });
    columnSpec(host, {
      columns: [
        { name: 'Sieve opening', need: 'Required', what: 'The opening of each sieve, one row per sieve, in mm, micrometres or inches. Say the unit in the heading or choose it below.', headings: ['Sieve opening (mm)'] },
        { name: 'Percent passing', need: 'One of these two', what: 'Percent of the sample by mass passing each sieve, 0 to 100.', headings: ['Percent passing'] },
        { name: 'Mass retained', need: 'One of these two', what: 'Mass caught on each sieve, in any one unit. The finest sieve is taken to pass nothing, as in HydrogeoSieveXL.', headings: ['Mass retained'] },
      ],
      notes: ['The water temperature is asked for on the page. It sets the viscosity, and there is no default.', 'Rows can be in any order; they are sorted from coarsest to finest.'],
      examples: EXAMPLES.map((x) => ({ label: x.label, name: x.name.replace('.csv', '.xlsx'), header: HEADER, rows: x.rows })),
    });
    const f = form(host, {
      fields: [
        { id: 'size', label: 'Sieve opening column', type: 'column', required: true },
        { id: 'sizeUnit', label: 'Sieve opening unit', type: 'select', options: SIZE_UNIT_OPTIONS, required: true },
        { id: 'kind', label: 'The other column holds', type: 'select', options: KINDS, required: true },
        { id: 'amount', label: 'Percent passing or mass retained column', type: 'column', required: true },
        { id: 'T', label: 'Water temperature (°C)', type: 'number', required: true, hint: 'Sets the water viscosity and density.' },
      ],
      onRun: run,
    });
    host.append(out);

    // Everything from an earlier file or example is cleared first; then the columns
    // the headings name, and only the temperature an example's source gives.
    function load(t) {
      f.reset();
      data = t.table;
      example = t.example || null;
      out.textContent = '';
      const h = data.header;
      f.setColumns(h);
      const size = findColumn(h, /sieve|opening|size|diameter/i);
      const pass = findColumn(h, /passing|finer/i), kept = findColumn(h, /retained/i);
      f.set('size', size);
      f.set('sizeUnit', size === undefined ? undefined : sizeUnitOf(h[size]));
      f.set('kind', pass !== undefined ? 'passing' : kept !== undefined ? 'mass' : undefined);
      f.set('amount', pass !== undefined ? pass : kept);
      f.set('T', example ? example.T : undefined);
      status(example ? example.note : `${t.name}: ${data.rows.length} ${data.rows.length === 1 ? 'row' : 'rows'}.`);
    }

    function run(v) {
      out.textContent = '';
      try {
        if (!data) throw new Error('Drop a sieve analysis first, or use an example.');
        if (v.size === v.amount) throw new Error('The sieve opening column and the percent passing or mass retained column must be different columns.');
        const scale = SIZE_UNITS[v.sizeUnit];
        const sizes = columnValues(data, v.size).map((d) => d * scale);
        const amount = columnValues(data, v.amount);
        const skipped = sizes.map((d, i) => (Number.isFinite(d) && Number.isFinite(amount[i]) ? 0 : i + 1)).filter(Boolean);
        const r = grainSizeK({ sizes, amount, mass: v.kind === 'mass', T: v.T });
        render(out, host, r, v, SIZE_UNIT_OPTIONS.find(([k]) => k === v.sizeUnit)[1], skipped, example);
      } catch (e) {
        out.append(errorBox(e.message));
      }
    }
  },
};
