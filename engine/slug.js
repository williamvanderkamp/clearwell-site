// Slug tests. The straight-line methods for an overdamped response, Hvorslev (1951)
// and Bouwer and Rice (1976), fit a line to the log of normalized head against time
// and turn its slope into hydraulic conductivity; lengths in any one unit, times in any
// one unit, K in that length per that time. The type-curve methods (slug-models.js and
// slug-highk.js) are fitted by least squares further down, in metres and seconds.

import { sig } from './format.js';
import { leastSquares } from './lsq.js';
import { fitLine, logTimes } from './numeric.js';
import { cbpCurve, cbpHead, dampedHead, dampingOf, G, highKHead, highKShape, kgsHead } from './slug-models.js';
import { bzHead, bzWork } from './slug-highk.js';
import * as libm from './libm.js';

// Butler (1998): fit the straight line to normalized heads in these ranges.
export const HEAD_RANGE = { hvorslev: [0.15, 0.25], bouwerRice: [0.2, 0.3] };

export const TIME_S = { s: 1, min: 60, h: 3600, d: 86400 };

/**
 * Readings as normalized head H/H0, sorted by time. d is displacement from static.
 * h0 is the initial displacement; without it, the reading at time zero is used.
 * Readings before time zero, before the test began, are kept apart in before (their
 * displacement, not normalized) and take no part in any fit; the last of them gives the
 * level the test began from (slug-checks.js, startChecks). withoutZero is the advice given
 * where there is neither h0 nor a reading at time zero.
 */
export function normalize(t, d, h0, { withoutZero = 'Enter the initial displacement H0.' } = {}) {
  const all = t.map((x, i) => [x, d[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .sort((a, b) => a[0] - b[0]);
  const early = all.filter(([x]) => x < 0), pairs = all.filter(([x]) => x >= 0);
  if (pairs.length < 3) throw new Error(early.length ? 'Fewer than three readings at or after time zero have both a time and a level.' : 'Fewer than three readings have both a time and a level.');
  let initial = h0;
  if (initial === undefined) {
    const zero = pairs.find(([x]) => x === 0);
    if (!zero) throw new Error(`There is no reading at time zero. ${withoutZero}`);
    initial = zero[1];
  }
  if (!initial) throw new Error('The initial displacement H0 is zero, so heads cannot be normalized.');
  return { t: pairs.map((p) => p[0]), ratio: pairs.map((p) => p[1] / initial), h0: initial, before: { t: early.map((p) => p[0]), d: early.map((p) => p[1]) } };
}

/** Least-squares line through ln(H/H0) against t, using readings with lo <= H/H0 <= hi. */
export function fitWindow(t, ratio, lo, hi) {
  if (!(lo > 0)) throw new Error('The lower H/H0 of the fit window must be above zero.');
  if (!(hi > lo)) throw new Error('The upper H/H0 of the fit window must be above the lower H/H0.');
  const used = ratio.map((r, i) => (r >= lo && r <= hi ? i : -1)).filter((i) => i >= 0);
  const fmt = (x) => sig(x, 3);
  if (used.length < 2 || t[used[0]] === t[used[used.length - 1]]) {
    const fall = used.length === 0 ? 'No readings fall' : used.length === 1 ? 'Only 1 reading falls' : `Only ${used.length} readings fall`;
    throw new Error(`${fall} between H/H0 = ${fmt(lo)} and ${fmt(hi)}, and a line needs two at different times. Widen the fit window.`);
  }
  const x = used.map((i) => t[i]), y = used.map((i) => libm.log(ratio[i]));
  const { slope, intercept } = fitLine(x, y);
  if (!(slope < 0)) throw new Error('The readings in the fit window do not fall toward static with time, so no K can be found from them.');
  return { slope, intercept, used, from: x[0], to: x[x.length - 1] };
}

function checkSizes(sizes) {
  for (const [name, v] of Object.entries(sizes)) if (!(v > 0)) throw new Error(`${name} must be above zero.`);
}

/**
 * Hvorslev (1951) for a screen in a uniform aquifer far from its boundaries, in the
 * form Butler (1998) gives with anisotropy: K = rc^2 ln[a + sqrt(1 + a^2)] / (2 Le T0),
 * a = Le / (2 rw sqrt(Kz/Kr)), T0 = -1 / slope.
 */
export function hvorslev({ rc, rw, Le, anisotropy, slope }) {
  checkSizes({ 'Casing radius': rc, 'Well radius': rw, 'Screen length': Le, 'Kz/Kr': anisotropy });
  const a = Le / (2 * rw * Math.sqrt(anisotropy));
  const shape = libm.log(a + Math.sqrt(1 + a * a));
  const T0 = -1 / slope;
  return { K: (rc * rc * shape) / (2 * Le * T0), T0, shape };
}

// Bouwer and Rice (1976) Figure 3 as polynomials in x = Le/rw, as used in RSAT 0.2.2.
const poly = (c, x) => c.reduce((s, ci, i) => s + ci * libm.pow(x, i), 0);
const A_FIT = [1.4720, 3.537e-2, -8.148e-5, 1.028e-7, -6.484e-11, 1.573e-14];
const B_FIT = [0.2372, 5.151e-3, -2.682e-6, -3.491e-10, 4.738e-13];
const C_FIT = [0.7920, 3.993e-2, -5.743e-5, 3.858e-8, -9.659e-12];
export const coefficients = (x) => ({ A: poly(A_FIT, x), B: poly(B_FIT, x), C: poly(C_FIT, x) });

/**
 * Bouwer and Rice (1976): K = rc^2 ln(Re/rw) / (2 Le) * (1/t) ln(y0/yt), the last term
 * being -slope. Lw is from the water table to the bottom of the screen (Bouwer and Rice
 * call it H), D the saturated thickness, as in Bouwer and Rice. With Kz/Kr other than 1,
 * rw becomes rw sqrt(Kz/Kr) in the ratios (Zlotnik 1994).
 */
export function bouwerRice({ rc, rw, Le, Lw, D, anisotropy, slope }) {
  checkSizes({
    'Casing radius': rc, 'Well radius': rw, 'Screen length': Le,
    'Water table to bottom of screen': Lw, 'Saturated thickness': D, 'Kz/Kr': anisotropy,
  });
  if (Lw < Le) throw new Error('The distance from the water table to the bottom of the screen cannot be less than the screen length. If the screen crosses the water table, enter the length of screen below it.');
  if (Lw > D * (1 + 1e-9)) throw new Error('The bottom of the screen is below the base of the aquifer: the distance from the water table to the bottom of the screen is more than the saturated thickness.');
  const r = rw * Math.sqrt(anisotropy), x = Le / r;
  const { A, B, C } = coefficients(x);
  const full = Lw >= D * (1 - 1e-9);
  let depthTerm = null, capped = false;
  if (!full) {
    depthTerm = libm.log((D - Lw) / r);
    if (depthTerm > 6) { depthTerm = 6; capped = true; }
  }
  const lnRe = 1 / (1.1 / libm.log(Lw / r) + (full ? C : A + B * depthTerm) / x);
  return { K: (rc * rc * lnRe * -slope) / (2 * Le), lnRe, full, A, B, C, x, depthTerm, capped };
}

/**
 * Bouwer (1989): where the level falls within the screen and its filter pack, as in a well
 * screened across the water table, the casing radius corrected for the drainage of the
 * pack, rc* = [(1 - n) rc^2 + n rw^2]^(1/2), n the pack's porosity (as HydroSOLVE gives it).
 */
export function packRadius(rc, rw, n) {
  if (!(n > 0 && n < 1)) throw new Error('The filter pack porosity must be between 0 and 1.');
  return Math.sqrt((1 - n) * rc * rc + n * rw * rw);
}

// ---------------------------------------------------------------------------------
// Least squares for the type-curve methods, through the shared engine in lsq.js
// (Levenberg-Marquardt on the logs of the values, standard errors from the residual
// variance and (J'J)^-1, 95% intervals from Student's t).

// The kind of each slug test parameter, as lsq.js takes them.
const KIND = { T: 'T', S: 'S', K: 'K', Kr: 'K', Kskin: 'K', Ss: 'Ss', Le: 'L', a: 'other', b: 'other', A: 'other', tau: 'other' };

/**
 * Fits model(params) to the readings y. start gives every parameter; free names those
 * fitted, the rest being held at their start value. Returns the fitted parameters, the
 * standard error, 95% interval and correlations of the free ones, the RMS misfit and
 * the counts.
 */
export function fitCurve({ model, y, start, free }) {
  const n = y.length, k = free.length;
  if (n <= k) throw new Error(`A fit of ${k} values needs more than ${k} readings; there are ${n}.`);
  const names = Object.keys(start);
  const params = names.map((id) => ({ id, kind: KIND[id] || 'other' }));
  const fixed = Object.fromEntries(names.filter((id) => !free.includes(id)).map((id) => [id, true]));
  const r = leastSquares({ params, start, fixed, model, y });
  const order = r.free;
  const out = { params: r.values, free: order, n: r.n, dof: r.df, rms: r.rms, sse: r.sse, iterations: r.iterations, converged: r.converged, tCrit: r.t975, se: {}, ci: {}, corr: {}, weak: r.weak, atLimit: [], why: {} };
  order.forEach((id, a) => {
    out.se[id] = r.params[id].se;
    // lsq.js's own verdict on each value, read one value at a time.
    if (r.params[id].undetermined) out.why[id] = r.params[id].undetermined;
    out.ci[id] = [r.params[id].lower, r.params[id].upper];
    if (r.params[id].atLimit) out.atLimit.push(id);
    out.corr[id] = Object.fromEntries(order.map((other, b) => [other, r.corr[a][b]]));
  });
  return out;
}

// A 95% interval wider than this factor, end to end, says the readings do not fix the
// value: the interval is the value times or divided by exp(t SE), so 1000 is a factor
// of about 32 either way.
export const SPAN = 1000;

/**
 * The fitted values that the readings do not determine, each with the reason:
 * 'flat' when the misfit does not change with it, or changes only as another value's
 * does (no standard error), 'limit' when it ended at a physical limit (S at 1), 'wide'
 * when its 95% interval spans more than SPAN. Such values are reported as not
 * determined, never with their interval. Each value is judged on its own, from lsq.js's
 * verdict on it, so a value the readings fix is reported even when another is not.
 */
export function undetermined(fit) {
  const out = {};
  for (const id of fit.free) {
    const se = fit.se[id], [lo, hi] = fit.ci[id] || [], why = fit.why?.[id];
    if (why === 'singular' || (fit.weak || []).includes(id) || !Number.isFinite(se)) out[id] = 'flat';
    else if (why === 'limit' || (fit.atLimit || []).includes(id)) out[id] = 'limit';
    // An interval of many decades can overflow to 0 or to infinity.
    else if (!(lo > 0 && Number.isFinite(hi)) || hi / lo > SPAN) out[id] = 'wide';
  }
  return out;
}

// ---------------------------------------------------------------------------------
// The type-curve methods: models, starting values and the fit. t in s, lengths in m.

const sse = (y, f) => y.reduce((s, v, i) => s + (v - f[i]) * (v - f[i]), 0);

// Linear interpolation in log x of a curve given on a log grid; 1 before it, the last value after.
function onGrid(xs, ys) {
  const l0 = libm.log(xs[0]), dl = libm.log(xs[1] / xs[0]);
  return (x) => {
    if (!(x > xs[0])) return ys[0];
    const u = (libm.log(x) - l0) / dl, i = Math.floor(u);
    if (i >= xs.length - 1) return ys[ys.length - 1];
    return ys[i] + (u - i) * (ys[i + 1] - ys[i]);
  };
}

// The best time scale c for a curve h(c t): a search over c on a log grid.
function bestScale(t, y, curve, cLo, cHi) {
  let best = { c: NaN, s: Infinity };
  for (const c of logTimes(cLo, cHi, 160)) {
    const s = sse(y, t.map((x) => curve(c * x)));
    if (s < best.s) best = { c, s };
  }
  return best;
}

/**
 * The type-curve methods. Each gives its fitted parameters (with kinds for units),
 * the model, and a starting point found by a coarse search, so that nothing about the
 * aquifer has to be assumed to begin the fit.
 * geo (m): rc, rw, and as each method needs: b (screen length), d (top of aquifer or
 * water table to top of screen), B (aquifer thickness), anisotropy, top, rsk, SsSkin,
 * lnRe (unconfined high-K), nu and l (Butler and Zhan friction).
 * hold: values the user fixed, by parameter name.
 */
export const CURVES = {
  cbp: {
    params: ['T', 'S'],
    model: (t, p, geo) => cbpHead(t, p, geo),
    start(t, y, geo, hold) {
      const tMin = Math.min(...t), tMax = Math.max(...t);
      const betas = logTimes(1e-4, 1e4, 65);
      const alphas = hold.S !== undefined ? [(geo.rw * geo.rw * hold.S) / (geo.rc * geo.rc)] : logTimes(1e-10, 0.1, 19);
      let best = { s: Infinity };
      for (const alpha of alphas) {
        const curve = onGrid(betas, cbpCurve(alpha, betas));
        const r = bestScale(t, y, curve, 1e-3 / tMax, 1e3 / tMin);
        if (r.s < best.s) best = { ...r, alpha };
      }
      return { T: best.c * geo.rc * geo.rc, S: (best.alpha * geo.rc * geo.rc) / (geo.rw * geo.rw) };
    },
  },
  kgs: {
    params: (geo) => (geo.rsk ? ['Kr', 'Ss', 'Kskin'] : ['Kr', 'Ss']),
    model: (t, p, geo) => kgsHead(t, p, geo),
    start(t, y, geo, hold, progress) {
      // Without a skin, Kr only stretches time (tau = t b Kr / rc^2), so one curve per
      // Ss serves every Kr. With a skin, the start has the skin as the formation.
      const tMin = Math.min(...t), tMax = Math.max(...t);
      const taus = logTimes(1e-2, 1e4, 49), unit = (geo.rc * geo.rc) / geo.b;
      const list = hold.Ss !== undefined ? [hold.Ss] : logTimes(1e-7, 1e-2, 11);
      let best = { s: Infinity };
      list.forEach((Ss, i) => {
        const h = kgsHead(taus, { Kr: unit, Ss, Kskin: unit, SsSkin: geo.SsSkin }, geo);
        const r = bestScale(t, y, onGrid(taus, h), 1e-3 / tMax, 1e3 / tMin);
        if (r.s < best.s) best = { ...r, Ss };
        progress({ stage: 'start', step: i + 1, of: list.length });
      });
      const Kr = best.c * unit;
      return geo.rsk ? { Kr, Ss: best.Ss, Kskin: Kr } : { Kr, Ss: best.Ss };
    },
  },
  highK: {
    params: ['K', 'Le'],
    model: (t, p, geo) => highKHead(t, p, geo),
    start(t, y, geo) {
      let best = { s: Infinity };
      for (const Le of logTimes(0.05, 2000, 50)) {
        const f = Math.sqrt((geo.g || G) / Le);
        for (const CD of logTimes(0.02, 30, 50)) {
          const s = sse(y, t.map((x) => dampedHead(x * f, CD)));
          if (s < best.s) best = { s, Le, CD };
        }
      }
      // CD = sqrt(g/Le) rc^2 shape / (2 b K), so K follows from CD.
      return { Le: best.Le, K: dampingOf(1, best.Le, geo) / best.CD };
    },
  },
  bz: {
    params: ['Kr', 'Ss', 'Le'],
    model: (t, p, geo) => bzHead(t, p, geo),
    work: (t, p, geo) => bzWork(t, p, geo),
    start(t, y, geo, hold, progress, affordable) {
      const hk = CURVES.highK.start(t, y, { ...geo, shape: highKShape(geo) });
      const list = hold.Ss !== undefined ? [hold.Ss] : logTimes(1e-7, 1e-2, 6);
      let best = { s: Infinity };
      list.forEach((Ss, i) => {
        const p = { Kr: hk.K, Ss, Le: hk.Le };
        // A start too costly to compute is passed over; it would not be a good start.
        if (affordable(p)) {
          const s = sse(y, bzHead(t, p, geo));
          if (s < best.s) best = { s, p };
        }
        progress({ stage: 'start', step: i + 1, of: list.length });
      });
      if (!best.p) throw new Error(tooCostly);
      return best.p;
    },
  },
};

// Limits on the work of a Butler and Zhan fit, in modes summed (bzWork): a few seconds
// for one curve and a few minutes at most for the fit, on a laptop. The published
// oscillating example needs under 6e5 a curve and 2.2e7 in all. Records that do not
// oscillate can need 4e7 a curve, since the inversion follows the water column's
// natural period through the whole test.
const CURVE_WORK = 5e6, FIT_WORK = 1e8;
const tooCostly = 'The Butler and Zhan fit was stopped: these readings span so many periods of the water column\'s natural oscillation that the fit would take many minutes. Check that the response oscillates; for one that does not, the KGS model is the same model without the inertia of the water column. Holding Ss at a smaller value also shortens the work.';

/**
 * Fits a type-curve method to normalized heads y = H/H0 at times t (s). hold names
 * the parameters the user fixed, with their values. Readings at t <= 0 are left out.
 * progress, if given, hears { stage: 'start', step, of } as each starting curve is
 * tried, then { stage: 'fit', curves } as the least squares computes each curve. A
 * Butler and Zhan fit that would take minutes stops with an error.
 */
export function fitSlug(kind, t, y, geo, hold = {}, progress = () => {}) {
  const c = CURVES[kind];
  const names = typeof c.params === 'function' ? c.params(geo) : c.params;
  const keep = t.map((x, i) => (x > 0 && Number.isFinite(y[i]) ? i : -1)).filter((i) => i >= 0);
  const tt = keep.map((i) => t[i]), yy = keep.map((i) => y[i]);
  if (tt.length < names.length + 2) throw new Error(`The fit needs at least ${names.length + 2} readings after time zero; there are ${tt.length}.`);
  // Where a model can say beforehand what a curve will cost, the fit stops rather than
  // run on for minutes: no curve above CURVE_WORK, and no more than FIT_WORK in all.
  let spent = 0;
  const affordable = (p) => !c.work || c.work(tt, p, geo) <= CURVE_WORK;
  const charge = (p) => {
    if (!c.work) return;
    const w = c.work(tt, p, geo);
    spent += w;
    if (w > CURVE_WORK || spent > FIT_WORK) throw new Error(tooCostly);
  };
  const found = { ...c.start(tt, yy, geo, hold, progress, affordable), ...hold };
  // In the method's own order, K or T first: where two values' effects cannot be told
  // apart, lsq.js names the later one weak, and that should be the secondary value
  // (Lc or Ss), not K.
  const start = Object.fromEntries(names.map((id) => [id, found[id]]));
  const free = names.filter((n) => hold[n] === undefined);
  let curves = 0;
  const model = (p) => {
    charge(p);
    const h = c.model(tt, p, geo);
    progress({ stage: 'fit', curves: ++curves });
    return h;
  };
  const fit = fitCurve({ model, y: yy, start, free });
  return { ...fit, start, used: keep, model: (times) => c.model(times, fit.params, geo) };
}
