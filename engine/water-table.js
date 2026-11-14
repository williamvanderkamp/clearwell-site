// Critical comments on the results of a pumping test in a water table aquifer, judged from
// the user's own readings and fit. Each is given only when the readings or the fitted
// values call for it, quotes them, and names its source. Each threshold is a number from
// its source or the fit's own misfit, never one chosen here. The unconfined aquifer tool
// (src/engine/unconfined.js) and the
// unconfined solutions of the fitting tool (solutions/neuman.js, solutions/moench-1997.js)
// both give them. docs/tools/unconfined.md sets out each one: what sets it off, the
// threshold and where the threshold comes from.
// Metres and days throughout; `show` writes a number as the page shows it.
import { corrText, sig } from './format.js';
import { readingsOf, timeText } from './solutions/bounds.js';
import * as libm from './libm.js';
import { COOPER_JACOB_1946, HILL_1998_LOWER_CASE, KRUSEMAN_DE_RIDDER_1994, MOENCH_1995, MOENCH_1997, NEUMAN_1975, VAN_DER_KAMP_1985_CAPITAL_V } from './refs.js';

const KDR_NAME = 'Kruseman and de Ridder', KDR = `${KDR_NAME} 1994`;

// Representative specific yields of gravels and of fine to coarse sands, Johnson (1967) as
// Kruseman and de Ridder (1994, Table 1.3, p. 24) print them: coarse gravel 0.23, medium
// gravel 0.24, fine gravel 0.25, coarse sand 0.27, medium sand 0.28, fine sand 0.23. Dune
// sand is 0.38 there, silt 0.08 and clay 0.03; their range for Sy is 0.01 to 0.30 (p. 23).
export const SY_SAND_GRAVEL = [0.23, 0.28];

// Cooper and Jacob's (1946) straight line holds for u below 0.01 (Kruseman and de Ridder
// 1994, p. 65).
export const JACOB_U = 0.01;

const METRIC = { dd: (m) => `${sig(m)} m`, len: (m) => `${sig(m)} m`, time: (d) => `${sig(d)} d` };

/**
 * All the comments, in this order: a drawdown large for the thickness; readings that end
 * before the late segment; Sy below the representative values of sands and gravels;
 * partial penetration; Sy correlated with Kz/Kr; what the values mean for long-term
 * pumping; a water table that moved for other reasons.
 * test: {
 *   t, s: the readings fitted, time since pumping began (d) and drawdown (m), in time order;
 *   Q: the pumping rate (m³/d), or null when it changed during the test;
 *   T, S, Sy, kzkr: the fitted values; r, b: the distance and saturated thickness (m);
 *   rms: the root mean square misfit of the fit (m);
 *   undetermined: a Set of the ids the fit did not determine, or none;
 *   late: { gap, at, reach, limit } from lateReach() for Neuman's curve, or null;
 *   bounded: true when the fit has boundaries, so the late Theis curve is not the curve's
 *     own late part and the comments on it are not given;
 *   fully: true when the pumped well is taken as screened over the whole saturated thickness;
 *   pumped: true when the readings are from the pumped well itself;
 *   gradual: true when the fit includes gradual drainage from above, with α₁ fitted
 *     (Moench 1995);
 *   misfit: the runs test of the misfits, { poor, runs, mean }, or null;
 *   correlation: the correlation of the fitted Sy with Kz/Kr, where the page has none of
 *     its own, or null;
 *   intervals: { T, Sy } as [lower, upper] 95% intervals, or none;
 *   show: { dd, len, time } for drawdowns, lengths and times, or metres and days.
 * }
 */
export function waterTableComments(test) {
  return [jacobNote, lateNote, specificYieldNote, penetrationNote, correlationNote, longTermNote, trendNote].flatMap((note) => note(test));
}

const known = (test, ...ids) => !ids.some((id) => test.undetermined?.has(id));
const shown = (test) => ({ ...METRIC, ...test.show });
// 2.30 Q / (4 pi T), the rise in drawdown for each tenfold increase in time on a Theis
// curve once u is small (Kruseman and de Ridder 1994, equations 3.7 and 3.9).
const perCycle = (Q, T) => (2.30 * Q) / (4 * Math.PI * T);
const cycleText = (test, show) => (test.Q > 0
  ? `2.30Q/(4πT) = ${show.dd(perCycle(test.Q, test.T))}`
  : `2.30Q/(4πT), ${sig(perCycle(1, test.T))} d/m² times the pumping rate Q`);
// The time from which u = r² storage / (4Tt) is below 0.01, so the Theis curve with that
// storage is on Cooper and Jacob's straight line (Kruseman and de Ridder 1994, p. 65).
const jacobTime = (test, storage) => (test.r * test.r * storage) / (4 * test.T * JACOB_U);
const where = (test) => (test.pumped ? 'in the pumped well' : 'at the observation well');
// The readings run past the end of pumping when the rate changed (recovery), so the span
// of the readings is called the record, not the test.
const record = (test) => (test.Q > 0 ? 'test' : 'record');
const lateGapShown = (test) => test.late && !test.bounded && Math.abs(test.late.gap) > test.rms;

/**
 * Jacob's (1944) correction s' = s - s²/(2b) for the thinning of the saturated thickness,
 * when at the largest drawdown it is more than the root mean square misfit, so the readings
 * can show it. Kruseman and de Ridder (1994, p. 101) give no size of drawdown from which it
 * is needed, only "large compared with" the thickness; neither do the other sources read.
 * Not for readings in the pumped well, whose drawdown holds the losses at the screen too.
 */
export function jacobNote(test) {
  if (!test.s?.length || !(test.rms > 0) || test.pumped) return [];
  const peak = Math.max(...test.s), cut = (peak * peak) / (2 * test.b), show = shown(test);
  if (!(cut > test.rms)) return [];
  const early = lateGapShown(test) ? ' No reading here is yet on that curve (below), so none is strictly one the correction is for.' : '';
  return [`The largest drawdown, ${show.dd(peak)}, is ${sig(100 * peak / test.b, 2)}% of the saturated thickness, ${show.len(test.b)}. Jacob's (1944) correction for the thinning of the saturated thickness, s′ = s − s²/(2b) (${KDR}, p. 101), lowers it by ${show.dd(cut)}, more than the root mean square misfit of the fit, ${show.dd(test.rms)}, so the thinning is large enough to show in these readings. The fit used the drawdowns as measured. The method assumes a saturated thickness that stays the same, which is not met when the drawdown is large compared with it (${KDR}, p. 101), and according to Neuman (1975) the correction is strictly applicable only to the late drawdowns, those on the Theis curve (${KDR}, p. 102).${early}`];
}

/**
 * The readings end before the late segment: at the last reading the fitted curve is
 * further from the late Theis curve (with S + Sy) than the root mean square misfit, so the
 * readings could tell the two apart. late.gap is the fitted curve less the late Theis curve
 * at the last reading (m), late.reach the time (d) from which they are within the misfit,
 * or Infinity. For Neuman's curve, which takes drainage as instantaneous.
 */
export function lateNote(test) {
  const { late } = test;
  if (!late || test.bounded || !test.t?.length || !(test.rms > 0) || !known(test, 'T', 'S', 'Sy', 'Kz/Kr')) return [];
  if (!(Math.abs(late.gap) > test.rms)) return [];
  const show = shown(test), end = test.t[test.t.length - 1];
  const reach = Number.isFinite(late.reach)
    ? `With the fitted values the curve comes within that misfit of the late Theis curve only from ${show.time(late.reach)}, ${sig(late.reach / end, 2)} times as long as the ${record(test)}.`
    : `With the fitted values the curve is not within that misfit of the late Theis curve even at ${show.time(late.limit)}.`;
  return [`At the last reading, ${show.time(end)}, the fitted curve is still ${show.dd(Math.abs(late.gap))} (${sig(100 * Math.abs(late.gap) / late.at, 2)}%) ${late.gap > 0 ? 'above' : 'below'} the late Theis curve with S + Sy, more than the root mean square misfit of ${show.dd(test.rms)}: the readings end before the late segment, where the drawdown follows that curve and Sy shows directly (${KDR}, p. 100-101). ${reach} So Sy rests on the intermediate segment, and on the model's account of the drainage there. Fits that take in as many intermediate readings as they can, without weight on the late ones, can explain the small Sy often reported (Moench et al. 2000, p. 30): at Cape Cod, with instantaneous drainage, Sy was 0.287 from the readings between about 2000 and 4300 minutes of a 72-hour test (Moench et al. 2000, table 4, p. 29-30), and 0.183 when only the first 10 minutes were left out (Heidari and Moench 1997, table 5, as reported there, p. 30). With instantaneous drainage, as in this fit, Moench et al. (2000, p. 55-56) found late readings in piezometers at depth near the pumped well enough for Sy, given a test long enough: 72 hours there. Only with gradual drainage in the model did 8 hours serve for some groups of piezometers and 16 for others (p. 51-52 and 56-57). ${KDR_NAME} (1994, p. 43-44), from experience of when the drawdown becomes steady, suggest pumping an unconfined aquifer for about 3 days.`];
}

/**
 * Sy below the representative specific yields Johnson (1967) gives for gravels and for
 * fine to coarse sands (Kruseman and de Ridder 1994, Table 1.3), with why tests give low
 * values, the dispute over which Sy governs drawdown from pumping, and how much Sy = 0.23
 * would move the late drawdown.
 */
export function specificYieldNote(test) {
  if (!known(test, 'Sy') || !(test.Sy < SY_SAND_GRAVEL[0])) return [];
  const show = shown(test), [lo, hi] = SY_SAND_GRAVEL;
  const why = test.gradual
    ? 'This fit includes gradual drainage from above the water table, with α₁ fitted (Moench 1995), which Moench et al. (2000, p. 3) found necessary for Sy not to be significantly underestimated; the duration of the test and the place of the observation well still limit what the readings show of it.'
    : `Causes given in the literature: flow in the capillary fringe above the water table, which Neuman's model leaves out (${KDR}, p. 100-101, after van der Kamp 1985); gradual drainage from the unsaturated zone, without which Moench et al. (2000, p. 3) found Sy significantly underestimated even at deep piezometers; and readings that do not reach far enough into the late segment (Moench et al. 2000, p. 30 and 55-56).`;
  const pumped = test.pumped ? ` These readings are from the pumped well, and Moench et al. (2000, p. 55) found pumped-well readings by themselves not useful for most unconfined aquifer parameters, giving mainly an approximate T.` : '';
  const dispute = `Which Sy governs drawdown from pumping is disputed. Neuman (1987, abstract) holds that the rate at which water levels fall in response to pumping is controlled by the smaller Sy from time-drawdown analyses, and that the larger values from drainage describe the reserves recoverable over long periods. Moench et al. (2000, p. 3 and 30) hold the small values to come from fitting with instantaneous drainage.`;
  // How much the late drawdown would move, where both late curves are on the straight line.
  let effect = '';
  if (known(test, 'T', 'S') && !test.bounded) {
    const from = jacobTime(test, test.S + lo), shift = test.Q > 0 ? ` = ${show.dd(perCycle(test.Q, test.T) * libm.log10((test.S + lo) / (test.S + test.Sy)))}` : '';
    effect = ` If Sy were ${sig(lo)}, the late drawdown ${where(test)} would be lower, once u < ${JACOB_U} on both late Theis curves, here from ${show.time(from)}, by ${cycleText(test, show)} times log₁₀((S + ${sig(lo)})/(S + ${sig(test.Sy)}))${shift} at any one time (Cooper and Jacob 1946; ${KDR}, equation 3.7).`;
  }
  return [`Sy = ${sig(test.Sy)} is below ${sig(lo)} to ${sig(hi)}, the representative specific yields Johnson (1967) gives for gravels and for fine to coarse sands (${KDR}, Table 1.3, p. 24, which gives dune sand 0.38, silt 0.08 and clay 0.03; their range for Sy is 0.01 to 0.30, p. 23). Specific yields from pumping tests often come out low: type curve analyses usually give 0.03 to 0.13 for sand and gravel aquifers, where 0.2 to 0.3 is expected (Chapuis 2009, p. 2, citing Nwankwor et al. 1984, 1992). ${why}${pumped} ${dispute}${effect}`];
}

/**
 * Partial penetration of the pumped well: it is taken as screened over the whole thickness,
 * and the observation well is closer than 2b √(Kr/Kz), within which the vertical flow a
 * partially penetrating well causes is not negligible (Kruseman and de Ridder 1994, p. 159,
 * for an aquifer anisotropic in the vertical plane; 1.5 to 2 times b where it is isotropic).
 */
export function penetrationNote(test) {
  if (!test.fully || !known(test, 'Kz/Kr') || !(test.kzkr > 0)) return [];
  const reach = 2 * test.b * Math.sqrt(1 / test.kzkr), show = shown(test);
  if (!(test.r < reach)) return [];
  return [`The pumped well is taken to be screened over the whole saturated thickness; at least 80% of it counts (${KDR}, p. 34-35). If it is screened over less, the vertical flow that causes is not negligible closer to it than 2b√(Kr/Kz) (${KDR}, p. 159; 1.5 to 2 times b in an isotropic aquifer); with the fitted Kz/Kr = ${sig(test.kzkr)} that is ${show.len(reach)}, and the observation well is ${show.len(test.r)} away. With partial penetration each arrangement of screens has its own type curves (Neuman 1975; ${KDR}, p. 172), so Kz/Kr and Sy fitted with the curves for full screens may be wrong. The observation well matters too: one screened over the whole thickness short-circuits vertical flow, so its level is not always the average over the thickness that the method assumes (Rushton and Howard 1982, as cited by ${KDR}, p. 103); a piezometer with a short screen serves if its drawdowns stand for that average (van der Kamp 1985, as cited there). For screens over part of the thickness, fit Moench (1997) with the screen depths on the "Fit a pumping test solution" page.`];
}

// Hill (1998, p. 39 and figure 16, p. 63): values are estimated uniquely when all their
// correlation coefficients are below about 0.95 in absolute value.
export const CORRELATION_LIMIT = 0.95;

/**
 * Sy and Kz/Kr strongly correlated in the fit: the readings fix a combination of the two
 * better than either. Given where the page reports no correlations of its own (the
 * unconfined aquifer tool; the fitting tool reports every pair).
 */
export function correlationNote(test) {
  const c = test.correlation;
  if (!(Math.abs(c) > CORRELATION_LIMIT)) return [];
  return [`Sy and Kz/Kr are strongly correlated in this fit: correlation ${corrText(c)}, from the slopes of the fitted curve at the fit. The readings fix a combination of the two better than either alone; Hill (1998, figure 16, p. 63) takes a value to be estimated uniquely when its correlations are below about ${CORRELATION_LIMIT} in absolute value. On the "Fit a pumping test solution" page, Sy can be held at a value known from elsewhere, such as another test, and Kz/Kr fitted; a value from drainage or a water balance is disputed for this use (Neuman 1987, abstract).`];
}

/**
 * What the fitted values mean for long-term pumping: the late Theis curve with T and
 * S + Sy, on which the drawdown rises 2.30 Q/(4 pi T) for each tenfold increase in time.
 * Not given when T is not determined or with a boundary; when Sy is not determined, says
 * that the readings cannot predict long-term drawdown.
 */
export function longTermNote(test) {
  if (!known(test, 'T') || test.bounded) return [];
  const show = shown(test), cycle = cycleText(test, show);
  if (!known(test, 'Sy')) return [`Sy is not determined, so these readings cannot predict long-term drawdown. That follows the late Theis curve with S + Sy, and S from the early readings cannot be used to predict it (${KDR}, p. 101). T alone fixes how fast the drawdown rises once on that curve, ${cycle} for each tenfold increase in pumping time (Cooper and Jacob 1946; ${KDR}, equation 3.9), but not when the curve is reached nor the level from which it rises.`];
  const parts = [`For long-term pumping, the late Theis curve with T and S + Sy sets the drawdown; S from the early readings cannot be used to predict long-term drawdowns (${KDR}, p. 101).`];
  if (!test.fully) parts.push(`Near a pumped well screened over part of the thickness, at a piezometer, or in the pumped well with its skin, the late drawdown lies a constant above or below that curve, which then rises at the same rate (${KDR}, p. 159).`);
  const from = known(test, 'S') ? jacobTime(test, test.S + test.Sy) : NaN;
  const start = Number.isFinite(from) ? `, here from ${show.time(from)} ${where(test)} (${KDR}, p. 65)` : '';
  parts.push(`On that curve, once u = r²(S + Sy)/(4Tt) is below ${JACOB_U}${start}, the drawdown rises by ${cycle} for each tenfold increase in pumping time. T alone sets that rise; Sy enters only through the logarithm (Cooper and Jacob 1946; ${KDR}, equations 3.7 and 3.9).`);
  if (Number.isFinite(from) && lateGapShown(test) && Number.isFinite(test.late.reach) && test.late.reach > from) parts.push(`The fitted curve itself joins that curve only from ${show.time(test.late.reach)}, as said above.`);
  const iv = test.intervals || {};
  if (iv.T && test.Q > 0) parts.push(`The 95% interval of T, ${sig(iv.T[0])} to ${sig(iv.T[1])} m²/d, gives ${show.dd(perCycle(test.Q, iv.T[1]))} to ${show.dd(perCycle(test.Q, iv.T[0]))} for each log cycle.`);
  if (iv.Sy && test.Q > 0 && known(test, 'S')) parts.push(`The 95% interval of Sy, ${sig(iv.Sy[0])} to ${sig(iv.Sy[1])}, moves the late drawdown at any one time, once u < ${JACOB_U} for both ends, by ${show.dd(perCycle(test.Q, test.T) * libm.log10((test.S + iv.Sy[1]) / (test.S + iv.Sy[0])))} from one end to the other.`);
  const end = test.t?.length ? test.t[test.t.length - 1] : NaN;
  parts.push(`The prediction keeps the aquifer as the method takes it, of seemingly infinite extent, homogeneous and of uniform thickness (${KDR}, p. 101), with no recharge and no boundary beyond what the test reached. In fact the cone of depression goes on spreading until recharge equals the pumping rate (${KDR}, p. 43)${Number.isFinite(end) ? `, which a ${record(test)} of ${show.time(end)} cannot show` : ''}.`);
  return [parts.join(' ')];
}

/**
 * The misfits run in long stretches of one sign (the runs test after Hill 1998, as the fit
 * reports it): besides a model that does not fit, a water table that moved for reasons
 * other than the pumping does this (Kruseman and de Ridder 1994, section 2.8.2).
 */
export function trendNote(test) {
  if (!test.misfit?.poor) return [];
  const show = shown(test), parts = [];
  parts.push(`The misfits run in long stretches of one sign: ${test.misfit.runs} runs, where random misfits through the same fit give about ${Math.round(test.misfit.mean)} (the runs test after Hill 1998, p. 22, judged against random readings passed through the same fit). Besides a model that does not suit the test, a water level that moved for reasons other than the pumping does this (${KDR}, section 2.8.2, p. 44-47): a rise or fall from recharge or natural discharge, and daily swings from evapotranspiration where the water table is near the surface (p. 45), which are corrected with the water levels measured before and after the test and in a piezometer outside the reach of the pumping (p. 36-37 and 44); changes in atmospheric pressure, which they describe for confined and leaky aquifers (p. 46-47); and heavy rain or a sudden change in a nearby river, after which, they hold, the test generally cannot be corrected and has to be repeated, unless a control piezometer allows for it (p. 47).`);
  const end = test.t?.length ? test.t[test.t.length - 1] : NaN;
  const from = test.Q > 0 ? test.t.findIndex((x) => x >= end / 10) : -1;
  if (from >= 0 && from < test.t.length - 1) parts.push(`Over the last log cycle of the readings, from ${show.time(test.t[from])} to ${show.time(end)}, the drawdown rose by ${show.dd(test.s[test.s.length - 1] - test.s[from])}. The late readings give Sy, and with the early ones T (${KDR}, p. 101), so a natural change of a similar size during the test would change them.`);
  parts.push(`At Cape Cod a regional decline of the water table, measured outside the reach of the pumping, was taken off the late drawdowns (Moench et al. 2000, p. 23-24). Where a logger record shows a response to atmospheric pressure, the "Clean a well record" page removes it, with earth tide effects.`);
  return [parts.join(' ')];
}

/**
 * The comments for an unconfined solution of the fitting tool, from what its check() is
 * told (ctx, docs/design/solutions.md): the readings, the rates, the misfit and its runs
 * test, the 95% intervals and the values not determined. None without the readings, as in
 * the tests of the formulas alone. The rate is used only when it was constant. Numbers are
 * in metres and days, as in the page's method text, with times also in the readings' unit.
 * opts: { late(Q, tLast, rms), giving lateReach() for the solution's own curve, or none;
 * fully; gradual }, as for waterTableComments.
 */
export function fitComments(p, g, ctx, opts = {}) {
  const R = readingsOf(ctx);
  if (!R || !g) return [];
  const Q = ctx.rates?.length === 1 && ctx.rates[0][1] > 0 ? ctx.rates[0][1] : null;
  const bounded = Boolean(ctx.lines?.length), tLast = R.t[R.t.length - 1];
  return waterTableComments({
    t: R.t, s: R.s || [], Q, T: p.T, S: p.S, Sy: p.Sy, kzkr: p['Kz/Kr'], r: g.r, b: g.b, rms: ctx.rms,
    undetermined: ctx.undetermined, bounded, pumped: Boolean(ctx.pumped), misfit: ctx.misfit, intervals: ctx.intervals,
    late: Q && !bounded && ctx.rms > 0 && opts.late ? opts.late(Q, tLast, ctx.rms) : null,
    fully: opts.fully, gradual: opts.gradual, show: { time: (d) => timeText(d, ctx) },
  });
}

// Neuman's curve and the late Theis curve with S + Sy, at the last reading and beyond.
/**
 * How far a fitted Neuman curve still is from its late Theis curve at the last reading, and
 * from when the two are within `rms`. curves(t) gives [neuman, late] at time t (d), in m.
 * Returns { gap, at, reach, limit }: gap the Neuman curve less the late one at tLast, and
 * at the late one there; reach the
 * first time they are within rms, found by steps of a quarter of a log cycle out to limit,
 * 10⁶ times tLast, then by halving in log time; Infinity if not by limit.
 */
export function lateReach(curves, tLast, rms) {
  const apart = (t) => { const [n, l] = curves(t); return n - l; };
  const [n0, l0] = curves(tLast), gap = n0 - l0, at = l0, limit = 1e6 * tLast;
  if (!(Math.abs(gap) > rms)) return { gap, at, reach: tLast, limit };
  let lo = tLast, hi = tLast;
  while (Math.abs(apart(hi)) > rms) {
    lo = hi;
    hi *= libm.pow(10, 0.25);
    if (hi > limit) return { gap, at, reach: Infinity, limit };
  }
  for (let i = 0; i < 30; i++) {
    const mid = Math.sqrt(lo * hi);
    if (Math.abs(apart(mid)) > rms) lo = mid; else hi = mid;
  }
  return { gap, at, reach: hi, limit };
}

// The sources the comments cite, each with what marks its citation in a comment's text.
// Those other files cite too come from refs.js, with how much of them was read added.
const SOURCES = [
  [/Chapuis 2009/, 'Chapuis, R.P. (2009) Pumping a large diameter well in an unconfined aquifer: finding the hydraulic parameters. GeoHalifax 2009, 62nd Canadian Geotechnical Conference, Halifax.'],
  [/Cooper and Jacob 1946/, `${COOPER_JACOB_1946} As cited by Kruseman and de Ridder (1994); not read here.`],
  [/Heidari and Moench 1997/, 'Heidari, M., and Moench, A.F. (1997) Evaluation of unconfined-aquifer parameters from pumping test data by nonlinear least squares. Journal of Hydrology 192, 300-313. As reported by Moench et al. (2000); not read here.'],
  [/Hill \(?1998/, HILL_1998_LOWER_CASE],
  [/Jacob's \(1944\)/, 'Jacob, C.E. (1944) Notes on determining permeability by pumping tests under watertable conditions. U.S. Geological Survey open-file report. As cited by Kruseman and de Ridder (1994); not read here.'],
  [/Johnson \(1967\)/, 'Johnson, A.I. (1967) Specific yield: compilation of specific yields for various materials. U.S. Geological Survey Water-Supply Paper 1662-D. As printed by Kruseman and de Ridder (1994, Table 1.3).'],
  [/Kruseman and de Ridder/, KRUSEMAN_DE_RIDDER_1994],
  [/Moench 1995/, `${MOENCH_1995} Not read here.`],
  [/Moench \(1997\)/, `${MOENCH_1997} The solution of that name on the fitting page follows Barlow and Moench (1999).`],
  [/Moench et al\. \(?2000/, 'Moench, A.F., Garabedian, S.P., and LeBlanc, D.R. (2000) Estimation of hydraulic parameters from an unconfined aquifer test conducted in a glacial outwash deposit, Cape Cod, Massachusetts. U.S. Geological Survey Open-File Report 00-485.'],
  [/Neuman \(?1975/, `${NEUMAN_1975} Its abstract, and as cited by Kruseman and de Ridder (1994).`],
  [/Neuman \(?1987/, 'Neuman, S.P. (1987) On methods of determining specific yield. Ground Water 25(6), 679-684. Its abstract only.'],
  [/Nwankwor et al\. 1984/, 'Nwankwor, G.I., Cherry, J.A., and Gillham, R.W. (1984) A comparative study of specific yield determinations for a shallow sand aquifer. Ground Water 22(6), 764-772. As cited by Chapuis (2009); not read here.'],
  [/Nwankwor et al\. 1984, 1992/, 'Nwankwor, G.I., Gillham, R.W., van der Kamp, G., and Akindunni, F.F. (1992) Unsaturated and saturated flow in response to pumping of an unconfined aquifer: field evidence of delayed drainage. Ground Water 30(5), 690-700. As cited by Chapuis (2009); not read here.'],
  [/Rushton and Howard 1982/, 'Rushton, K.R., and Howard, K.W.F. (1982) The unreliability of open observation boreholes in unconfined aquifer pumping tests. Ground Water 20(5), 546-550. As cited by Kruseman and de Ridder (1994); not read here.'],
  [/van der Kamp 1985/, `${VAN_DER_KAMP_1985_CAPITAL_V} As cited by Kruseman and de Ridder (1994); not read here.`],
];

/** The references for these comments: each source one of them cites, once. */
export const commentReferences = (comments) => SOURCES.filter(([mark]) => comments.some((c) => mark.test(c))).map(([, ref]) => ref);

/**
 * A list of references with those for the comments added, in alphabetical order. Where the
 * list already has a source (the same authors and year), the comments' entry takes its
 * place, since it says how much of the source was read.
 */
export function withCommentReferences(references, comments) {
  const key = (ref) => ref.slice(0, ref.indexOf(')') + 1);
  const ours = new Map(commentReferences(comments).map((ref) => [key(ref), ref]));
  const kept = references.filter((ref) => !ours.has(key(ref)));
  return [...kept, ...ours.values()].sort((a, b) => a.localeCompare(b));
}
