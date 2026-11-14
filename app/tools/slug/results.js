// What the results of every method share: the methods' names, the first step of the
// method text, what K rests on by Butler's practice, K in the units people use, and the
// line saying the results are those of entries since changed (line.js, curve.js, vdk.js).
import { UNITS } from '../../../engine/index.js';
import { TIME_S } from '../../../engine/slug.js';
import { chart, el, notes, panel, sig, table } from '../../kit.js';
import { citesIn, practice, practiceSheets } from './practice.js';
import { referencesFor } from './refs.js';
import { four } from './text.js';

export const NAMES = {
  hvorslev: 'Hvorslev (1951)',
  bouwerRice: 'Bouwer and Rice (1976)',
  cbp: 'Cooper, Bredehoeft and Papadopulos (1967)',
  kgs: 'KGS model (Hyder et al. 1994)',
  highKHvorslev: 'high-K Hvorslev (Butler 1998)',
  springerGelhar: 'Springer and Gelhar (1991)',
  butlerZhan: 'Butler and Zhan (2004)',
  vanDerKamp: 'van der Kamp (1976)',
};
export const OSCILLATING = new Set(['highKHvorslev', 'springerGelhar', 'butlerZhan', 'vanDerKamp']);

// What the standard errors and intervals mean, in plain words, under every fitted table.
export const STATS_PLAIN = 'How to read these: the standard error is the typical error in a fitted value that the scatter of the readings about the fitted curve implies. If the model is right for this well and the misfits are independent, with the same spread throughout, the true value lies inside its 95% interval in about 19 tests out of 20. The interval leaves out errors in the well sizes and in the choice of model, so the real uncertainty is larger, more so when two values are strongly correlated or there are few readings. A correlation near 1 or −1 means two values trade off against each other: the readings fix a combination of them better than either alone.';

// A value the user typed, as typed: up to 6 figures, never in e-notation.
export const given = (x) => sig(x, 6);

// K in the unit people use alongside m/s for the length unit of the well sizes.
export const OTHER_K = { m: ['m/d', 86400], cm: ['cm/s', 100], ft: ['ft/d', 86400 / UNITS.ft], in: ['ft/d', 86400 / UNITS.ft] };
// K in m/s in the four units people use.
export const kTable = (K, head) => table(['Unit', head], [['m/s', K], ['cm/s', K * 100], ['m/d', K * 86400], ['ft/d', (K * 86400) / UNITS.ft]]);

// The first method step, shared by every method.
export function normalizedStep(v, n, levelUnit) {
  // The level column's own unit where its heading names one; H/H0 does not depend on it.
  const inLevel = levelUnit ? ` ${levelUnit}` : ', in the unit of the level column';
  return {
    title: 'Normalized head',
    lines: [
      v.kind === 'level' ? `Each reading minus the static level, ${given(v.static)}${inLevel}, gives the displacement H, which is divided by the initial displacement H0.` : 'Each displacement H is divided by the initial displacement H0.',
      v.h0 === undefined ? 'H0 is the reading at time zero.' : 'H0 is the value you entered.',
      'H/H0 is a ratio, so the unit of the level column cancels.',
    ],
    formula: 'H/H0 = displacement / H0',
    numbers: [[levelUnit ? `H0 (${levelUnit})` : 'H0 (same unit as the level column)', four(n.h0)], ['Readings', String(n.t.length)]],
  };
}

// What K rests on, in plain words; the checks made; and those that could not be made.
function practiceBlock(p) {
  return [
    el('h3', {}, 'What this result rests on'),
    notes(p.summary),
    p.rows.length ? table(['Check', 'Result'], p.rows) : null,
    ...p.hints.map((h) => el('p', { class: 'hint' }, h)),
    p.notMade.length ? el('p', { class: 'hint' }, `Not checked: ${p.notMade.join('; ')}.`) : null,
  ];
}

// A file of several tests: their normalized responses drawn together, as Butler, McElwee
// and Liu (1996) advise, on log time for an overdamped response and linear time for one
// that oscillates; and each test's H0, H0/H0* and, for the straight lines, K.
function seriesPanel(v, tests, chosen, p) {
  const ts = TIME_S[v.tUnit], s = p.series, oscillating = OSCILLATING.has(v.method);
  const head = ['Test', 'H0', 'H0/H0*', ...(s.K ? ['Readings in window', 'K (m/s)', 'K (m/d)'] : [])];
  const rows = tests.map((g, i) => [`${g.label}${i === chosen ? ' (analysed)' : ''}`, four(g.n.h0), s.ratio[i] === undefined ? '' : four(s.ratio[i]),
    ...(s.K ? (s.lines[i].error ? ['no line', '', ''] : [s.lines[i].n, sig(s.K[i], 4, true), sig(s.K[i] * 86400, 4, true)]) : [])]);
  const keep = (g) => g.n.t.map((_, i) => i).filter((i) => !oscillating ? g.n.t[i] > 0 && g.n.ratio[i] > 0 : true);
  return panel(el('h2', {}, `${tests.length} tests at this well`),
    chart({
      title: 'Normalized head of each test', xLabel: `Time since each test began (${v.tUnit})`, yLabel: 'H/H0 (ratio)', logX: !oscillating,
      series: tests.map((g) => { const i = keep(g); return { label: `Test ${g.label}`, x: i.map((j) => g.n.t[j] / ts), y: i.map((j) => g.n.ratio[j]) }; }),
    }),
    el('p', { class: 'chart-sub' }, `Each test's displacement over its own H0, the reading at its time zero, ${oscillating ? 'on linear scales' : 'against log time'}. Under conventional theory the tests coincide whatever their H0, and whether the level was raised or lowered (Butler, McElwee and Liu 1996).`),
    table(head, rows));
}

/**
 * Butler's practice for one analysis, and what each method's results take from it: the
 * warnings, the method's own first; the method text, ending with how the checks were made,
 * with the works its steps and the checks cite; what K rests on, for the page; the checks
 * as workbook sheets; and, for a file of several tests, the panel of them side by side.
 * ctx: the file's tests, the analysed one and its H0*, the level heading's unit, the
 * example, and the rows left out (onRun).
 */
export function withPractice(v, n, ctx, { K, line, warnings, steps }) {
  const p = practice({ ...ctx, v, n, K, line });
  const warn = [...warnings, ...ctx.extra, ...p.notes];
  const cites = [...p.cites, ...citesIn(steps.flatMap((s) => s.lines).join(' '))];
  // The workbook carries the example's note and the warnings, as the page shows them.
  const text = { steps: [...steps, p.step], references: referencesFor(v.method, ctx.example, cites), notes: [...(ctx.example ? [ctx.example.source] : []), ...warn] };
  return { warn, text, block: practiceBlock(p), sheets: practiceSheets(p, v, ctx.tests), series: p.series ? seriesPanel(v, ctx.tests, ctx.chosen, p) : null };
}

const EDITED_DURING = 'An entry was changed while this fit ran. These results, and the entries listed under Exactly what was done, are those of the fit as it began, not the entries as they are now. Press Run to fit the entries as they are now.';
// Said at the top and again over the method text, whose entries are those of the fit.
export const outOfDate = (ctx) => (ctx.editedDuring ? el('p', { class: 'hint', role: 'status' }, EDITED_DURING) : null);
