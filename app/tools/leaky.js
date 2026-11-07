// Fit a leaky aquifer: Hantush and Jacob (1955) fitted to drawdown against time at one
// observation well, with the Theis fit beside it for comparison.
import { RATE_UNITS, TIME_NAMES, TIME_UNITS, UNITS } from '../../engine/index.js';
import { analyzeLeaky, leakyCurve } from '../../engine/leaky.js';
import { logBins, theisCurve } from '../../engine/pumping.js';
import { logTimes } from '../../engine/numeric.js';
import { timeUnitIn, unitInLabel } from '../columns.js';
import { toCsv, together } from '../format.js';
import { chart, columnSpec, columnValues, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table, TIME_OPTIONS, unit, unitOptions } from '../kit.js';

const LENGTH = unitOptions(['m', 'ft']);
const DRAWDOWN = unitOptions(['m', 'cm', 'ft']);
const RATES = unitOptions(Object.keys(RATE_UNITS));

// Pumping test 'Dalem', the Netherlands: corrected drawdowns at 14 m depth, 761 m3/d.
// Kruseman and de Ridder (1994), Table 4.2, after De Ridder (1961).
const DALEM = {
  30: [[1.53e-2, 0.138], [1.81e-2, 0.141], [2.29e-2, 0.150], [2.92e-2, 0.156], [3.61e-2, 0.163], [4.58e-2, 0.171], [6.60e-2, 0.180], [8.68e-2, 0.190], [1.25e-1, 0.201], [1.67e-1, 0.210], [2.08e-1, 0.217], [2.50e-1, 0.220], [2.92e-1, 0.224], [3.33e-1, 0.228]],
  60: [[1.88e-2, 0.081], [2.36e-2, 0.089], [2.99e-2, 0.094], [3.68e-2, 0.101], [4.72e-2, 0.109], [6.67e-2, 0.120], [8.82e-2, 0.127], [1.25e-1, 0.137], [1.67e-1, 0.148], [2.08e-1, 0.155], [2.50e-1, 0.158], [2.92e-1, 0.160], [3.33e-1, 0.164]],
  90: [[2.43e-2, 0.069], [3.06e-2, 0.077], [3.75e-2, 0.083], [4.68e-2, 0.091], [6.74e-2, 0.100], [8.96e-2, 0.109], [1.25e-1, 0.120], [1.67e-1, 0.129], [2.08e-1, 0.136], [2.50e-1, 0.141], [2.92e-1, 0.142], [3.33e-1, 0.143]],
  120: [[2.50e-2, 0.057], [3.13e-2, 0.063], [3.82e-2, 0.068], [5.00e-2, 0.075], [6.81e-2, 0.086], [9.03e-2, 0.092], [1.25e-1, 0.105], [1.67e-1, 0.113], [2.08e-1, 0.122], [2.50e-1, 0.125], [2.92e-1, 0.127], [3.33e-1, 0.129]],
};
const HEADER = ['Time (d)', 'Drawdown (m)'];
const M2D = unit('m2/d'), M3D = unit('m3/d');
const SOURCE = `Real data: pumping test 'Dalem', the Netherlands, 761 ${M3D}, corrected drawdowns at 14 m depth (Kruseman and de Ridder 1994, Table 4.2, after De Ridder 1961). The pumping rate and distance are filled in from the book.`;
const ALL = `From all four piezometers, the book's second Hantush inflection point procedure gave T = 1883 ${M2D}, S = 0.0016, B = 1043 m and c = 578 d (Table 4.4).`;
const NOTE = {
  30: `${SOURCE} ${ALL} So close to the well, r/B is small and B is poorly fixed by one piezometer.`,
  60: `${SOURCE} ${ALL}`,
  90: `${SOURCE} This is the piezometer the book works through. From it the book got T = 1731 ${M2D}, S = 0.0019, B = 900 m and c = 468 d with Walton's type curves, and T = 1665 ${M2D}, S = 0.0017, B = 600 m and c = 216 d with the Hantush inflection point (Table 4.4). ${ALL}`,
  120: `${SOURCE} ${ALL}`,
};
const EXAMPLES = [30, 60, 90, 120].map((r) => ({
  label: `Dalem, ${r} m`, name: `dalem-${r}m.csv`, Q: 761, qUnit: 'm3/d', r, rUnit: 'm', note: together(NOTE[r]),
  csv: toCsv(HEADER, DALEM[r]),
}));

// The method text's numbers: 4 significant figures with trailing zeros kept (738.0,
// 0.001340), whole numbers as they are, and every whole digit from 10,000 up.
const four = (v) => {
  if (Math.abs(v) >= 1e4 && Math.abs(v) < 1e9) return String(Math.round(v));
  return Number.isInteger(v) ? String(v) : sig(v, 4, true);
};
// The headline's numbers: 3 significant figures with trailing zeros kept.
const three = (x) => sig(x, 3, true);
// A value in the user's unit, with metres beside it when the user's unit is not metres.
const siFactor = (u, si) => (si === 'm2/d' ? UNITS[u.replace('2/d', '')] ** 2 : UNITS[u]);
const withSI = (x, u, si) => (u === si ? `${three(x)} ${unit(u)}` : `${three(x)} ${unit(u)} (${three(x * siFactor(u, si))} ${unit(si)})`);
// The ends of the fit window, as the user gave them.
const windowEnds = (v, tName) => [v.from === undefined ? 'the start' : `${v.from} ${tName}`, v.to === undefined ? 'the end' : `${v.to} ${tName}`];

// fromBook: the Dalem example is loaded, so De Ridder (1961), its source, is cited.
function methodText(v, a, fromBook) {
  const k = a.leaky, th = a.theis, L = UNITS[v.rUnit], D = UNITS[v.sUnit], T2 = `${v.rUnit}2/d`;
  const tName = TIME_NAMES[v.tUnit], [start, end] = windowEnds(v, tName);
  const windowed = v.from !== undefined || v.to !== undefined ? `, inside the window you set (${start} to ${end})` : '';
  return {
    steps: [
      { title: 'Readings used', lines: [`${a.used} readings with time and drawdown above zero${windowed}. They are averaged into bins of equal width in log time, 20 to each log cycle, as on the pumping test tool, so a logger running for days does not outvote the first minutes. That left ${a.bins.t.length} points.`], numbers: [] },
      { title: 'Hantush and Jacob fit', lines: [
        'The drawdown from a well pumping at a constant rate from a confined aquifer that also takes water through an overlying aquitard, as given by Hantush and Jacob (1955). Its assumptions: the aquifer is uniform, of infinite extent and fully penetrated by the well; flow in the aquifer is horizontal and through the aquitard vertical; the aquitard stores no water (it is incompressible); the head in the layer above the aquitard stays constant; the well is of small diameter.',
        'In the formulas below, s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, t the time since pumping began, B the leakage factor and c the hydraulic resistance of the aquitard. W(u, r/B) is the leaky well function of Hantush (1956), and W(u) the Theis well function.',
        'The curve is fitted to the points by least squares on drawdown, the way the curve is matched by eye on a Walton (1962) type curve sheet. Write a = r²S/(4T), the time at which u = 1. For each pair of a and r/B the best Q/(4πT) is a plain ratio, so a grid search over a and r/B is refined with the simplex method of Nelder and Mead (1965).',
        'W(u, r/B) is the integral below, taken numerically with 8-point Gauss-Legendre panels in ln y. At the 25 values checked, it agrees with the table in Kruseman and de Ridder (1994, Annex 4.2, after Hantush 1956) to the table\'s last printed digit.',
        `Converted to metres and days for the calculation. The results are given back in the units you chose: T in ${unit(T2)}, B in ${v.rUnit}, c in days and drawdown in ${v.sUnit}.`,
      ],
      formula: 's = Q / (4πT) · W(u, r/B),  u = r²S / (4Tt)\nW(u, r/B) = integral from u to infinity of (1/y) exp(-y - r² / (4B²y)) dy\nB = √(Tc),  so  c = B² / T',
      numbers: [
        [`T (${unit(T2)})`, four(k.T / (L * L))],
        ['S', four(k.S)],
        [`B (${v.rUnit})`, k.edge ? 'not found' : four(k.B / L)],
        ['c (d)', k.edge ? 'not found' : four(k.c)],
        ['r/B', k.edge ? 'not found' : four(k.rB)],
        [`RMS misfit (${v.sUnit})`, four(k.rmse / D)],
      ] },
      { title: 'Theis fit, for comparison',
        lines: ['The same points fitted with the Theis (1935) curve, which assumes no leakage. If leakage is real, the Theis curve cannot follow the drawdown levelling off.'],
        formula: 's = Q / (4πT) · W(u)',
        numbers: [[`T (${unit(T2)})`, four(th.T / (L * L))], ['S', four(th.S)], [`RMS misfit (${v.sUnit})`, four(th.rmse / D)]] },
      { title: 'Inputs', lines: [], numbers: [
        ['Pumping rate', `${v.Q} ${unit(v.qUnit)}`], ['Distance from the pumped well', `${v.r} ${v.rUnit}`], ['Time unit', tName], ['Drawdown unit', v.sUnit],
      ] },
    ],
    references: [
      ...(fromBook ? ['De Ridder, N.A. (1961) The hydraulic characteristics of the Tielerwaard calculated from pumping test data (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 83.'] : []),
      'Hantush, M.S. (1956) Analysis of data from pumping tests in leaky aquifers. Transactions, American Geophysical Union 37(6), 702-714.',
      'Hantush, M.S., and Jacob, C.E. (1955) Non-steady radial flow in an infinite leaky aquifer. Transactions, American Geophysical Union 36(1), 95-100.',
      'Kruseman, G.P., and de Ridder, N.A. (1994) Analysis and Evaluation of Pumping Test Data, 2nd edition. Publication 47, International Institute for Land Reclamation and Improvement, Wageningen.',
      'Nelder, J.A., and Mead, R. (1965) A simplex method for function minimization. The Computer Journal 7(4), 308-313.',
      'Theis, C.V. (1935) The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions, American Geophysical Union 16(2), 519-524.',
      'Walton, W.C. (1962) Selected analytical methods for well and aquifer evaluation. Illinois State Water Survey Bulletin 49.',
    ],
  };
}

// The example's note stays in view under the drop box, so on the page it is not repeated
// under the results; the spreadsheet, which has no drop box, gets it (withNote).
function warnings(a, note, withNote) {
  const w = [];
  if (a.leaky.edge === 'low') w.push('No leakage could be measured in this record: the best fit is the Theis curve, with r/B at the bottom of its range (0.001). B and c are not given. A longer test, or a farther observation well, may show it.');
  if (a.leaky.edge === 'high') w.push('The best fit has r/B at the top of its range (10), where the drawdown is steady almost from the start. T, S and B are not reliable from these data.');
  if (a.bins.t.length < 8) w.push(`Only ${a.bins.t.length} points after averaging. A fit with three unknowns needs more than that to be trusted.`);
  return note && withNote ? w.concat(note) : w;
}

// The fit window, checked against the rules and against the readings, in the user's
// own time unit, so a message names the field that caused it.
function checkWindow(v, t, s) {
  const tName = TIME_NAMES[v.tUnit], [start, end] = windowEnds(v, tName);
  if (v.from !== undefined && v.from < 0) throw new Error('"Fit from this time" must be zero or above.');
  if (v.to !== undefined && !(v.to > 0)) throw new Error('"Fit up to this time" must be above zero.');
  if (v.from !== undefined && v.to !== undefined && !(v.from < v.to)) throw new Error(`"Fit from this time" (${v.from} ${tName}) must be earlier than "Fit up to this time" (${v.to} ${tName}).`);
  const ok = t.map((_, i) => i).filter((i) => t[i] > 0 && s[i] > 0);
  if (ok.length === 0) throw new Error('No row has both a time and a drawdown above zero. Check that the right columns are chosen, and that drawdown is positive downwards.');
  if (v.from === undefined && v.to === undefined) return;
  const first = Math.min(...ok.map((i) => t[i])), last = Math.max(...ok.map((i) => t[i]));
  const inside = ok.filter((i) => (v.from === undefined || t[i] >= v.from) && (v.to === undefined || t[i] <= v.to));
  const span = `${start} and ${end}`;
  const range = `The readings run from ${sig(first, 3)} to ${sig(last, 3)} ${tName}.`;
  if (!inside.length) throw new Error(`No readings between ${span}. ${range}`);
  const points = logBins(inside.map((i) => t[i]), inside.map((i) => s[i])).t.length;
  if (points < 4) throw new Error(`Only ${points} point${points === 1 ? '' : 's'} after averaging between ${span}, and the fit needs at least four. Widen the fit window. ${range}`);
}

export default {
  id: 'leaky',
  title: 'Fit a leaky aquifer',
  blurb: 'Your drawdown levels off as the aquitard above leaks. Fit Hantush and Jacob for T, S and the leakage factor B, with Theis beside it.',
  lede: 'The Hantush and Jacob (1955) leaky aquifer curve fitted to drawdown against time at one observation well, as done with Walton type curves. It gives transmissivity T, storativity S, the leakage factor B and the aquitard resistance c.',
  mount(host) {
    let data = null, note = '';
    const out = el('div', { class: 'stack' });
    const showError = (message) => out.append(errorBox(message));
    const drop = fileDrop(host, {
      text: 'A CSV or Excel file with elapsed time and drawdown at one observation well.',
      examples: EXAMPLES,
      onTable(loaded) {
        const { header } = loaded.table, { example } = loaded;
        data = loaded;
        note = example ? example.note : '';
        out.textContent = '';
        f.reset();
        f.setColumns(header);
        const t = findColumn(header, /time|elapsed/i), s = findColumn(header, /draw.?down/i);
        if (t !== undefined) { f.set('tCol', t); f.set('tUnit', timeUnitIn(header[t])); }
        if (s !== undefined) { f.set('sCol', s); f.set('sUnit', unitInLabel(header[s], ['m', 'cm', 'ft']) || undefined); }
        if (example) [['Q', example.Q], ['qUnit', example.qUnit], ['r', example.r], ['rUnit', example.rUnit]].forEach(([k, val]) => f.set(k, val));
        // One format on every tool: the file and its rows, then for an example its note.
        drop.status(`${loaded.name}: ${loaded.table.rows.length} rows.${example ? ` ${example.note}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Elapsed time', need: 'Required', what: 'Time since pumping began, as a number. Seconds, minutes, hours or days: you choose which.', headings: ['Time (min)', 'Time (d)'] },
        { name: 'Drawdown', need: 'Required', what: 'Drop in water level at the observation well since pumping began, positive downwards.', headings: ['Drawdown (m)', 'Drawdown (ft)'] },
      ],
      notes: ['One observation well per file. The pumping rate must have been constant.', 'Drawdown should already be corrected for anything that is not pumping, such as barometric or tidal changes. The well record tool can do that.'],
      examples: [{ label: EXAMPLES[2].label, name: 'leaky-dalem-90m-example.xlsx', header: HEADER, rows: DALEM[90] }],
    });
    const f = form(host, {
      fields: [
        { id: 'tCol', label: 'Elapsed time column', type: 'column', required: true },
        { id: 'tUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'sCol', label: 'Drawdown column', type: 'column', required: true },
        { id: 'sUnit', label: 'Drawdown unit', type: 'select', options: DRAWDOWN, required: true },
        { id: 'Q', label: 'Pumping rate', type: 'number', required: true },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'r', label: 'Distance from the pumped well', type: 'number', required: true },
        { id: 'rUnit', label: 'Distance unit', type: 'select', options: LENGTH, required: true },
        { id: 'from', label: 'Fit from this time', type: 'number', hint: 'In the time unit above.' },
        { id: 'to', label: 'Fit up to this time', type: 'number', hint: 'In the time unit above.' },
      ],
      onRun(v) {
        out.textContent = '';
        try {
          if (!data) throw new Error('Add a file first.');
          if (!(v.Q > 0)) throw new Error('The pumping rate must be above zero.');
          if (!(v.r > 0)) throw new Error('The distance from the pumped well must be above zero.');
          if (v.tCol === v.sCol) throw new Error('The elapsed time column and the drawdown column must be different columns.');
          const tIn = columnValues(data.table, v.tCol), sIn = columnValues(data.table, v.sCol);
          checkWindow(v, tIn, sIn);
          const k = TIME_UNITS[v.tUnit], L = UNITS[v.rUnit], D = UNITS[v.sUnit];
          const a = analyzeLeaky({
            t: tIn.map((x) => x * k), s: sIn.map((x) => x * D), Q: v.Q * RATE_UNITS[v.qUnit], r: v.r * L,
            from: v.from === undefined ? undefined : v.from * k, to: v.to === undefined ? undefined : v.to * k,
          });
          show(v, a, L, D);
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });
    host.append(out);
    function show(v, a, L, D) {
      const lk = a.leaky, th = a.theis, lu = v.rUnit, su = v.sUnit, tu = v.tUnit, T2 = `${lu}2/d`;
      const said = warnings(a, note, false);
      // The spreadsheet carries the same caveats as the page, and the example's source.
      const text = { ...methodText(v, a, Boolean(note)), notes: warnings(a, note, true) };
      const smooth = logTimes(a.bins.t[0], a.bins.t[a.bins.t.length - 1], 120);
      const toTime = (x) => x / TIME_UNITS[tu], toLen = (x) => x / D;
      const inT = (d) => d.map(toTime), inS = (d) => d.map(toLen);
      const leakyS = leakyCurve(lk, smooth), theisS = theisCurve(th, smooth);
      const series = [
        { label: 'Measured', x: inT(a.bins.t), y: inS(a.bins.y), line: false },
        { label: 'Hantush and Jacob', x: inT(smooth), y: inS(leakyS) },
        { label: 'Theis', x: inT(smooth), y: inS(theisS) },
      ];
      // The headline is the table's value to 3 significant figures, with metres beside it in feet.
      const T = withSI(lk.T / (L * L), T2, 'm2/d');
      const lead = lk.edge
        ? `T = ${T} and S = ${three(lk.S)}, but no leakage factor could be found.`
        : `T = ${T}, S = ${three(lk.S)}, leakage factor B = ${withSI(lk.B / L, lu, 'm')}, aquitard resistance c = ${three(lk.c)} d.`;
      const rows = [
        [`Transmissivity T (${unit(T2)})`, lk.T / (L * L), th.T / (L * L)],
        ['Storativity S', lk.S, th.S],
        [`Leakage factor B (${lu})`, lk.edge ? 'not found' : lk.B / L, 'none'],
        ['Aquitard resistance c (d)', lk.edge ? 'not found' : lk.c, 'none'],
        ['r/B', lk.edge ? 'not found' : lk.rB, 'none'],
        [`RMS misfit (${su})`, lk.rmse / D, th.rmse / D],
        ['Points fitted', lk.rows, th.rows],
      ];
      const sheet = {
        name: 'Fit', header: [`Time (${tu})`, `Measured drawdown (${su})`, `Hantush and Jacob (${su})`, `Theis (${su})`],
        rows: a.bins.t.map((x, i) => [toTime(x), toLen(a.bins.y[i]), toLen(leakyCurve(lk, [x])[0]), toLen(theisCurve(th, [x])[0])]),
      };
      const results = {
        name: 'Results', header: ['Quantity', 'Hantush and Jacob', 'Theis'],
        rows: rows.map((r) => r.map((x) => (typeof x === 'number' ? Number(x.toPrecision(6)) : x))),
      };
      out.append(
        panel(
          el('h2', {}, 'Leaky aquifer fit'),
          el('p', { class: 'chart-sub' }, together(lead)),
          table(['Quantity', 'Hantush and Jacob (leaky)', 'Theis (no leakage)'], rows),
          notes(said.map(together)),
          el('div', { class: 'downloads' }, el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('leaky-aquifer-fit.xlsx', [results, sheet], text) }, 'Download spreadsheet'))),
        // Drawdown increases upward on the log-log plot, as on type curves, and downward on the semilog one.
        panel(chart({ title: 'Drawdown against time, log scales', xLabel: `Time since pumping began (${TIME_NAMES[tu]})`, yLabel: `Drawdown (${su})`, logX: true, logY: true, series })),
        panel(chart({ title: 'Drawdown against log time', xLabel: `Time since pumping began (${TIME_NAMES[tu]})`, yLabel: `Drawdown (${su})`, logX: true, invertY: true, series })),
        panel(el('h2', {}, 'Exactly what was done'), method(text)));
    }
  },
};
