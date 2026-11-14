// van der Kamp (1976): the damped cosine fitted to the whole record, the method text and
// the results. Its notes are vdkWarnings in text.js, free of the page so that they are
// tested in Node.
import { UNITS } from '../../../engine/index.js';
import { TIME_S } from '../../../engine/slug.js';
import { fixed, six } from '../../../engine/format.js';
import { chart, downloads, downloadWorkbook, el, methodPanel, notes, panel, sig, table, unit } from '../../kit.js';
import { LENGTH_OF_LEVEL } from './practice.js';
import { given, kTable, NAMES, normalizedStep, outOfDate, STATS_PLAIN, withPractice } from './results.js';
import { four, interval, vdkCorrelated, vdkWarnings } from './text.js';

// The geometry the engine needs, in metres, and the initial displacement in metres when the
// level column's heading names a unit of length, for the paper's check (52).
export function vdkSetup(v, n, levelUnit) {
  const L = UNITS[v.lUnit], m = (x) => (x === undefined ? undefined : x * L);
  const headUnit = LENGTH_OF_LEVEL[levelUnit];
  return {
    rc: m(v.rc), rf: m(v.rw), S: v.S, nu: v.nu, D: m(v.bAq),
    Lc: m(v.lAbove), Lf: m(v.Le),
    w0: headUnit ? Math.abs(n.h0) * headUnit : undefined,
  };
}

const VDK_SYMBOLS = 'γ is the damping and ω the angular frequency of the oscillation; Lc the effective length of the water column (van der Kamp writes L); d the damping as a share of the undamped frequency (g/Lc)^½; rc the casing radius, where the level moves; rw the radius of the filter or open hole (van der Kamp writes rf); S the storativity; T the transmissivity.';

function vdkMethodText(v, n, r, geo, levelUnit) {
  const ts = TIME_S[v.tUnit], L = UNITS[v.lUnit], f = r.fit;
  const len = (x) => `${sig(x / L, 4)} ${v.lUnit}`;
  const T2 = (x) => `${four(x * 86400 / (L * L))} ${unit(`${v.lUnit}2/d`)}`;
  const from = n.t[r.used[0]], to = n.t[r.used[r.used.length - 1]];
  const before = n.t.filter((x) => x < from).length;
  const steps = [normalizedStep(v, n, levelUnit)];
  steps.push({
    title: 'The damped cosine fitted to the record',
    lines: [
      'van der Kamp (1976, eq. 7) describes the level after the first maximum or minimum as an exponentially damped cosine about the static level. The page fits that curve to every reading from there on, not to two peaks read off a chart: its damping γ, its angular frequency ω, its amplitude and phase (the paper\'s initial displacement w0 and the time t0 at which its cosine starts), and the level c the record oscillates about, measured from the static level, so that a static level a little off does not bias γ.',
      v.from === undefined ? `The fit starts at ${sig(from / ts, 4)} ${v.tUnit}, the reading furthest from static (the last of them, were several equally far): the first maximum or minimum, where the paper starts its reading (p. 74). The paper's model is a damped spring (eqs. 20 and 44), whose swings only shrink, so no later reading is further from static than the displacement that set the level going, and where the level was set moving from static, the largest is its first crest. Readings at static before the slug, as in the paper's own tests, where the level was let settle before the slug was hoisted out (p. 74), are left out however many there are${before ? `: here ${before} reading${before === 1 ? '' : 's'}` : ''}. Set the start yourself where that is not so, as where the level was held at its displacement before release.` : `The fit starts at ${sig(from / ts, 4)} ${v.tUnit}, from the time you set.`,
      `${f.n} readings, to ${sig(to / ts, 4)} ${v.tUnit}, by the Levenberg-Marquardt method (Levenberg 1944, Marquardt 1963) with the exact slopes of the curve, from the best of a grid of 80 frequencies (from a quarter of a cycle over the record to the Nyquist rate of the median reading interval) by 24 values of d from 0.01 to 0.95, the amplitude, phase and level solved for each.`,
      `Standard errors from the residual variance, the sum of squared misfits divided by n − k (k = 5), times the diagonal of (JᵀJ)⁻¹; 95% intervals from Student's t with ${f.dof} degrees of freedom (t = ${four(f.tCrit)}). Those of Lc, d and T are carried from γ and ω, with their correlation, to first order; T's interval is T times or divided by exp(t SE of ln T).`,
      f.converged ? `The fit settled after ${f.iterations} steps.` : `The fit stopped after ${f.iterations} steps without settling; treat the result with care.`,
      'The analysis runs in a Web Worker, off the page, so a long record does not hold the page up and can be cancelled.',
    ],
    formula: 'H/H0 = c + w0 e^(−γ (t − t0)) cos ω (t − t0)',
    numbers: [['γ (1/s)', four(f.values.gamma)], ['ω (1/s)', four(f.values.omega)], ['w0, H/H0', four(f.w0)], [`t0 (${v.tUnit})`, four(f.t0 / ts)], ['c, H/H0', four(f.values.c)], ['RMS misfit in H/H0', four(f.rms)]],
  });
  steps.push({
    title: 'Water column and damping: van der Kamp (1976), eqs. 36 and 37',
    lines: [
      'ω² + γ² = g/Lc (34) gives the effective length of the water column, and d = γ / (g/Lc)^½. The paper puts critical damping at d = 0.7 and does not apply the method there (p. 74).',
      geo.Lc !== undefined && geo.Lf !== undefined ? `From the well's dimensions, the paper's eq. 1 (after Cooper et al. 1965) gives Lc = l + (3/8) Le = ${len(r.predictedL)}, with l = ${len(geo.Lc)} of water in the casing above the screen and the screen length Le = ${len(geo.Lf)}; van der Kamp compares the two in his Table 3.` : 'Give the water column above the screen and the screen length to compare Lc with the paper\'s eq. 1, Lc = l + (3/8) Le.',
      VDK_SYMBOLS,
    ],
    formula: 'Lc = g / (ω² + γ²)\nd = γ / (g/Lc)^½',
    numbers: [['g (m/s²)', '9.80665'], ['Lc', len(r.L)], ['d', four(r.d)]],
  });
  steps.push({
    title: 'Transmissivity: van der Kamp (1976), eqs. 38 to 40',
    lines: [
      `T solves T = b + a ln T, found by the paper's iteration from T0 = b, carried on until it settles${r.settled ? ` (here after ${r.steps.length - 1} steps)` : `; here it had not settled after ${r.steps.length - 1} steps, T solving eq. 38 to ${sig(r.residual, 2)} of itself`}. b needs rw and S: the method cannot find S, and T depends on it only weakly (p. 75). Here a factor of 10 in S moves T by a factor of ${sig(10 ** r.dlnTdlnS, 3)} (dlnT/dlnS = −a/(T − a) = ${four(r.dlnTdlnS)}).`,
      `α (eq. 27) must be much less than 0.1 (eq. 28) for the paper's approximation of K0 (eqs. 24 and 29); the paper reads that as |ln α| above 4.6 beside the π/2 it leaves out (p. 73), α below 0.01.`,
      r.full ? `The paper notes that its approximation (29) "is not essential to the analysis". Without it, eqs. 20 to 22 with the complex Bessel functions K0 and K1 give T = ${T2(r.full.T)} and Lc = ${len(r.full.L)}: the values for which p = −γ + iω is exactly the root of eq. 22.` : 'Without the approximation (29), eqs. 20 to 22 gave no real Lc near this T.',
      'Lengths are converted to metres and times to seconds for the calculation.',
    ],
    formula: 'a = rc² (g/Lc)^½ / (8 d)\nb = −a ln[0.79 rw² S (g/Lc)^½]\nT(n) = b + a ln T(n−1),  T(0) = b\nα = 0.89 (S/T)^½ (g/Lc)^¼ rw',
    numbers: [['rc', len(geo.rc)], ['rw', len(geo.rf)], ['S', given(v.S)], ['a (m²/s)', four(r.a)], ['b (m²/s)', four(r.b)], ['T (m²/s)', four(r.T)], ['α', four(r.alpha)], ...(r.K !== undefined ? [['K = T / D (m/s)', four(r.K)]] : [])],
  });
  steps.push({
    title: 'Checks of the record against the method',
    lines: [
      'The paper\'s own reading, from successive maxima or minima n and n + 2 (Kruseman and de Ridder 1994, eqs. 16.9 and 16.10, procedure 16.2, which repeats it for each pair), is shown beside the fit: γ = ln(wn / wn+2) / τ and ω = 2π / τ, τ the time between them. A crossing of static counts only past the scatter, and a pair only while its second peak stands above it. Taking the highest reading at each peak carries the scatter with it, more so at the smaller, later peak, so these readings run to a smaller γ and a larger T than the fit as the oscillation dies away.',
      'The runs test of Hill (1998) on the signs of the misfits, judged against those of the same fit on random readings, and their correlation ρ from one reading to the next. Misfits in long runs of one sign mean the record is not the single damped cosine of eq. 7 to within its scatter; the intervals then are too narrow, since they assume independent misfits.',
      r.serial ? `As a second opinion the curve is fitted again allowing for misfits correlated from one reading to the next, by the iterated method of Cochrane and Orcutt (1949): the differences v(i) − ρ v(i − 1) of readings and curve are fitted, ρ being re-estimated until it settles (here ${fixed(r.serial.rho, 3)}), with one more degree of freedom taken for ρ. Its T and interval are shown beside the plain fit's. Where the misfits are the curve's own departure from the record rather than noise, the two differ, and by how much is part of the uncertainty in T.` : 'The misfits do not correlate positively from one reading to the next, so no second fit allowing for that is made.',
      `One γ and one ω for the whole record is what the paper's model, being linear, says. The record is cut at the middle crest that stands above the scatter, and the two parts fitted, each with its own damped cosine (10 values), and again with γ, then ω, the same in both (9 values). The rise in the sum of squared misfits from that one constraint is the extra-sum-of-squares F test of nested nonlinear fits (Bates and Watts 1988): F = (SSE9 − SSE10) / (SSE10 / (m − 10)), m the readings fitted, and z = ±√F against Student's t${r.split && !r.split.error ? ` (${four(r.split.zLimit)} for ${r.split.dof} degrees of freedom)` : ''}. It does not rest on the two parts' standard errors, which understate the scatter of the later part, where little of the oscillation is left.${r.serial ? ` Since the misfits correlate, both fits are made to the differences v(i) − ρ v(i − 1) of each part, the first reading of each kept times (1 − ρ²)^½ (Prais and Winsten 1954), with the whole record's ρ of ${fixed(r.serial.rho, 3)}, which more readings fix than either part's.` : ''} A γ larger early, while the water moves fast, is what friction that grows with its speed does (the paper's appendix, eqs. 50 to 52).`,
      `Friction in the well, from the paper's appendix: laminar (49), 4ν/rc² ≪ γ, ${geo.nu !== undefined ? 'with the viscosity you gave' : 'made only when the viscosity is given, as it was not here'}; turbulent (52), 0.005 (w0/rc) ≪ γ/ω, with H0 as w0, made only where the level heading names its unit. "Much less" is taken as a tenth, as the paper reads its (28).`,
      'Butler and Garnett (2000, after Butler et al. 1996) advise repeating a test with different initial displacements: the normalized records should coincide, as they do only where the response is linear. With a test column the page draws the tests together; fit each in turn and compare γ and ω.',
    ],
    numbers: [],
  });
  steps.push({
    title: 'What the method assumes',
    lines: ['A confined aquifer, homogeneous and of wide extent, a fully penetrating well with flow to the filter horizontal (van der Kamp\'s filter is a short section at depth Lc, Butler and Garnett 2000 note the method is for fully penetrating wells), a water column that moves as one body, friction in the well negligible, and linear flow. The damped cosine holds after the first maximum or minimum and not near critical damping (d near 0.7). The paper expects T to within a factor of 2 or better (p. 76). The exact form of the same model, with aquifer storage from the start, is Butler and Zhan (2004) with the screen through the whole aquifer (Kipp 1985), which this page also fits.'],
    numbers: [],
  });
  return steps;
}

export function vdkResults(v, n, r, geo, ctx) {
  const ts = TIME_S[v.tUnit], L = UNITS[v.lUnit], f = r.fit, correlated = vdkCorrelated(r);
  const { warn, text, block, sheets: checkSheets, series } = withPractice(v, n, ctx, { K: r.K, warnings: vdkWarnings(v, r, geo, ctx.skipped, ctx.dropped), steps: vdkMethodText(v, n, r, geo, ctx.levelUnit) });
  const perDay = 86400 / (L * L), tUnit = unit(`${v.lUnit}2/d`);
  const T = (x) => four(x * perDay);
  const rows = [
    ['Damping γ (1/s)', four(f.values.gamma), four(f.se.gamma), interval(...f.ci.gamma)],
    ['Angular frequency ω (1/s)', four(f.values.omega), four(f.se.omega), interval(...f.ci.omega)],
    [`Water column length Lc (${v.lUnit})`, four(r.L / L), four(r.sd.L / L), interval(r.intervals.L[0] / L, r.intervals.L[1] / L)],
    ['Damping ratio d', four(r.d), four(r.sd.d), interval(...r.intervals.d)],
    [`Transmissivity T (${tUnit})`, T(r.T), T(r.T * r.sd.lnT), `${interval(r.intervals.T[0] * perDay, r.intervals.T[1] * perDay)}${correlated ? ', too narrow: the misfits correlate' : ''}`],
  ];
  // Where the misfits correlate, the interval that allows for it, beneath the plain one.
  if (correlated && r.serial) rows.push([`T allowing for correlated misfits, Cochrane and Orcutt (${tUnit})`, T(r.serial.T), T(r.serial.T * r.serial.sdLnT), interval(r.serial.interval[0] * perDay, r.serial.interval[1] * perDay)]);
  if (r.K !== undefined) rows.push(['K = T / D (m/s)', four(r.K), four(r.K * r.sd.lnT), interval(r.intervals.T[0] / geo.D, r.intervals.T[1] / geo.D)]);
  const other = [['T (m²/s)', four(r.T)], ['α, eq. 27', four(r.alpha)], ['dlnT / dlnS', four(r.dlnTdlnS)]];
  if (r.serial && !correlated) other.push([`T allowing for correlated misfits, Cochrane and Orcutt (${tUnit})`, `${T(r.serial.T)} (${interval(r.serial.interval[0] * perDay, r.serial.interval[1] * perDay)}), ρ = ${fixed(r.serial.rho, 2)}`]);
  if (r.full) other.push([`T without approximation (29) (${tUnit})`, T(r.full.T)], [`Lc without approximation (29) (${v.lUnit})`, four(r.full.L / L)]);
  if (r.predictedL !== undefined) other.push([`Lc from the well, eq. 1 (${v.lUnit})`, four(r.predictedL / L)]);
  const checks = [
    ['d below 0.7 (p. 74)', `${four(r.d)}: ${r.d >= 0.7 ? 'no' : r.d >= 0.4 ? 'yes, but above 0.4 (p. 74)' : 'yes'}`],
    ['α ≪ 0.1, eq. 28', `${four(r.alpha)}: ${r.alpha <= 0.01 ? 'yes' : r.alpha < 0.1 ? 'above 0.01' : 'no'}`],
    ['Crests above the scatter', String(r.crests.length)],
    ['Runs of one sign in the misfits', f.runs ? `${f.runs.runs} (random: about ${Math.round(f.runs.mean)})` : ''],
    ['Correlation of successive misfits', fixed(f.lag1, 2)],
  ];
  if (r.split && r.split.error) checks.push(['γ and ω early, late', 'not compared (see the notes)']);
  else if (r.split) checks.push(['γ early, late (1/s)', `${four(r.split.gamma.early)}, ${four(r.split.gamma.late)} (z = ${fixed(r.split.gamma.z, 1)})`], ['ω early, late (1/s)', `${four(r.split.omega.early)}, ${four(r.split.omega.late)} (z = ${fixed(r.split.omega.z, 1)})`]);
  if (r.friction.laminar) checks.push(['Laminar friction, eq. 49: 4ν/rc² against γ', `${sig(r.friction.laminar.left, 3)} against ${sig(r.friction.laminar.right, 3)}: ${r.friction.laminar.met ? 'negligible' : 'may matter'}`]);
  if (r.friction.turbulent) checks.push(['Turbulent friction, eq. 52: 0.005 w0/rc against γ/ω', `${sig(r.friction.turbulent.left, 3)} against ${sig(r.friction.turbulent.right, 3)}: ${r.friction.turbulent.met ? 'negligible' : 'may matter'}`]);
  const peaks = r.readings.map((q) => [sig(q.from / ts, 4), sig(q.to / ts, 4), four(q.gamma), four(q.omega), q.T ? T(q.T) : '']);
  const used = new Set(r.used);
  const inFit = n.t.map((_, i) => i).filter((i) => used.has(i)), outFit = n.t.map((_, i) => i).filter((i) => !used.has(i));
  const t0 = n.t[r.used[0]], t9 = n.t[r.used[r.used.length - 1]];
  const { fitted, curve: { t: grid, y: curve } } = r;
  const dot = (count) => (count > 200 ? { size: 2 } : count > 60 ? { size: 3 } : {});
  const sheets = [{
    name: 'Readings',
    header: [`Time (${v.tUnit})`, 'H/H0', 'Used in fit', 'Fitted H/H0', 'Residual'],
    rows: n.t.map((s, i) => [Number((s / ts).toPrecision(12)), six(n.ratio[i]), used.has(i) ? 'yes' : 'no', used.has(i) ? six(fitted[i]) : '', used.has(i) ? six(n.ratio[i] - fitted[i]) : '']),
  }, {
    name: 'Result',
    header: ['Quantity', 'Value', 'Standard error', '95% interval low', '95% interval high'],
    rows: [
      ['Method', NAMES.vanDerKamp, '', '', ''],
      ['gamma (1/s)', six(f.values.gamma), six(f.se.gamma), six(f.ci.gamma[0]), six(f.ci.gamma[1])],
      ['omega (1/s)', six(f.values.omega), six(f.se.omega), six(f.ci.omega[0]), six(f.ci.omega[1])],
      [`Lc (${v.lUnit})`, six(r.L / L), six(r.sd.L / L), six(r.intervals.L[0] / L), six(r.intervals.L[1] / L)],
      ['d', six(r.d), six(r.sd.d), six(r.intervals.d[0]), six(r.intervals.d[1])],
      ['T (m2/s)', six(r.T), six(r.T * r.sd.lnT), six(r.intervals.T[0]), six(r.intervals.T[1])],
      ...(r.serial ? [['T allowing for correlated misfits, Cochrane and Orcutt (m2/s)', six(r.serial.T), six(r.serial.T * r.serial.sdLnT), six(r.serial.interval[0]), six(r.serial.interval[1])]] : []),
      ['alpha', six(r.alpha), '', '', ''],
      ...(r.full ? [['T without (29) (m2/s)', six(r.full.T), '', '', ''], [`Lc without (29) (${v.lUnit})`, six(r.full.L / L), '', '', '']] : []),
      ['RMS misfit, H/H0', six(f.rms), '', '', ''], ['Readings fitted, n', f.n, '', '', ''], ['Degrees of freedom, n - k', f.dof, '', '', ''],
      ...(ctx.tests ? [['Test', ctx.tests[ctx.chosen].label, '', '', '']] : []),
    ],
  }, {
    name: 'Peaks',
    header: [`From (${v.tUnit})`, `To (${v.tUnit})`, 'gamma (1/s)', 'omega (1/s)', 'T (m2/s)'],
    rows: r.readings.map((q) => [six(q.from / ts), six(q.to / ts), six(q.gamma), six(q.omega), q.T ? six(q.T) : '']),
  }, ...checkSheets];
  const head = `T = ${sig(r.T * perDay, 3, true)} ${tUnit} (${sig(r.T, 3, true)} m²/s)`;
  // Where the misfits correlate, the sentence under the heading says which interval holds.
  const held = correlated ? (r.serial
    ? ` The misfits correlate from one reading to the next, so the plain 95% interval of T is too narrow; allowing for that (Cochrane and Orcutt 1949), T is ${sig(r.serial.T * perDay, 3, true)} ${tUnit}, ${interval(r.serial.interval[0] * perDay, r.serial.interval[1] * perDay)}.`
    : ' The misfits correlate from one reading to the next, so the 95% intervals are too narrow.') : '';
  return [
    panel(el('h2', {}, head),
      el('p', { class: 'chart-sub' }, `van der Kamp (1976), the damped cosine fitted to ${f.n} readings from ${sig(t0 / ts, 4)} to ${sig(t9 / ts, 4)} ${v.tUnit}. Lc = ${sig(r.L / L, 3)} ${v.lUnit}, d = ${sig(r.d, 3)}, RMS misfit ${sig(f.rms, 3)} in H/H0.${held}`), outOfDate(ctx),
      table(['Fitted or derived', 'Value', 'Standard error', '95% interval'], rows),
      el('p', { class: 'hint' }, STATS_PLAIN),
      table(['Also', 'Value'], other),
      r.K !== undefined ? kTable(r.K, 'K = T / D') : null,
      table(['Check', 'Value'], checks),
      peaks.length ? table([`Peaks from (${v.tUnit})`, `to (${v.tUnit})`, 'γ (1/s)', 'ω (1/s)', `T (${tUnit})`], peaks) : null,
      peaks.length ? el('p', { class: 'hint' }, 'The paper\'s reading of two successive peaks of one sign, for each pair in turn. The first row is the record read as the paper read its own; it runs to a larger T than the fit, the more so the noisier or denser the record, and the notes say where it falls outside the fit\'s interval.') : null,
      ...block,
      notes(warn),
      downloads(() => downloadWorkbook('slug-test.xlsx', sheets, text))),
    panel(chart({
      title: 'Normalized head against time', xLabel: `Time (${v.tUnit})`, yLabel: 'H/H0 (ratio)',
      series: [
        { label: 'Readings used', x: inFit.map((i) => n.t[i] / ts), y: inFit.map((i) => n.ratio[i]), line: false, ...dot(inFit.length) },
        { label: 'Fitted damped cosine', x: grid.map((s) => s / ts), y: curve },
        ...(outFit.length ? [{ label: 'Readings not used', x: outFit.map((i) => n.t[i] / ts), y: outFit.map((i) => n.ratio[i]), line: false, ...dot(outFit.length) }] : []),
      ],
    }), el('p', { class: 'chart-sub' }, 'Linear scales, so the oscillation shows as it was recorded.')),
    panel(chart({
      title: 'Misfit against time', xLabel: `Time (${v.tUnit})`, yLabel: 'Reading − fitted, H/H0',
      series: [{ label: 'Misfit', x: inFit.map((i) => n.t[i] / ts), y: inFit.map((i) => n.ratio[i] - fitted[i]), line: false, ...dot(inFit.length) }],
    }), el('p', { class: 'chart-sub' }, 'Scattered about zero with no pattern if the damped cosine describes the record; a wave or a drift shows where it does not.')),
    series,
    methodPanel(text, outOfDate(ctx)),
  ];
}
