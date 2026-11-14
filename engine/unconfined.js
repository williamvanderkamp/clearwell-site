// Neuman (1974, 1975) delayed gravity response of an unconfined aquifer to a fully
// penetrating well, with the drawdown averaged over the saturated thickness, as a fully
// penetrating observation well sees it. The well function is computed from its Laplace
// transform and turned back into time by the Stehfest (1970) algorithm.
//
// Laplace form, in dimensionless time ts = T t / (S r^2) with Laplace variable p:
//   W(p) = (2/p) sum_n  2 sin^2(e_n) / (e_n (e_n + sin e_n cos e_n))  K0(sqrt(beta e_n^2 + p))
// where e_n are the roots of e tan e = p / (sigma beta), sigma = S/Sy, beta = r^2 Kz / (b^2 Kr).
// Everything here is metres and days unless a name says otherwise.

import { invertSPD } from './linalg.js';
import { runsCalibrated } from './runs.js';
import { besselK0, stehfest, stehfestWeights } from './laplace.js';
import { isNum, solveSPD } from './numeric.js';
import { logBins, wellFunction } from './pumping.js';
import { RATE_UNITS, TIME_UNITS, UNITS } from './units.js';
import { timeText } from './solutions/bounds.js';
import { lateReach, waterTableComments } from './water-table.js';
import { sig } from './format.js';
import * as libm from './libm.js';
import { SIN_COS } from './libm.js';

// Kept importable from here, where they first lived.
export { besselK0, stehfest, stehfestWeights };

const SERIES_TOL = 1e-14;
const MAX_TERMS = 20000;

// Newton's method for an increasing g on (0, pi/2), kept inside the bracket: a step that
// leaves it is replaced by bisection, as in rtsafe (Press et al. 2007, section 9.4). A
// step that lands on an end of the bracket is kept. Once the root is found to the last
// bit, the next step lands on the point just tried, now an end; refused, as it once was,
// it set off bisection that halved the bracket down to the tolerance, 20 to 50 steps for
// a root Newton had already found (Moench 1997 at instantaneous drainage).
// g is that of tanRoot's branch: (c0 + x) sin x - a cos x with c0 = n pi, or near the top
// of the branch a sin y - (c0 - y) cos y with c0 = n pi + pi/2. It is written out here,
// with sin and cos from one reduction, where it was a function that returned [g, slope]:
// an array at every step, and two reductions. The roots are over a third of a Moench
// (1997) fit (tanRootTwo, below, takes two at a time).
function solveBranch(top, c0, a, x, tol) {
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    libm.sinCos(x);
    const s = SIN_COS[0], c = SIN_COS[1];
    const g = top ? a * s - (c0 - x) * c : (c0 + x) * s - a * c;
    const slope = top ? a * c + c + (c0 - x) * s : s + (c0 + x) * c + a * s;
    if (g > 0) hi = x; else lo = x;
    let next = x - g / slope;
    if (!(next >= lo && next <= hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < tol) return next;
    x = next;
  }
  return x;
}

/**
 * Root n of e tan e = a, a > 0, as x = e - n pi in (0, pi/2), returned with sin x and
 * cos x. Near the top of the branch, when a is large, it is solved for y = pi/2 - x
 * instead. Moench (1997) uses it too.
 */
export function tanRoot(n, a) {
  const base = n * Math.PI, top = base + Math.PI / 2, tol = 1e-14 * top;
  if (a > top) {
    const y = solveBranch(true, top, a, libm.atan((top - libm.atan(top / a)) / a), tol);
    libm.sinCos(y);
    return { e: top - y, sin: SIN_COS[1], cos: SIN_COS[0] };
  }
  const start = n === 0 && a < 1 ? Math.sqrt(a) * (1 - a / 6) : libm.atan(a / (base + Math.PI / 4));
  const x = solveBranch(false, base, a, start, n === 0 ? 1e-14 * start : tol);
  libm.sinCos(x);
  return { e: base + x, sin: SIN_COS[0], cos: SIN_COS[1] };
}

/**
 * Roots n and n + 1 of e tan e = a, as [tanRoot(n, a), tanRoot(n + 1, a)], the same bits.
 * Each Newton step waits on the one before, through a sine, a cosine and a division, so
 * where both roots are on the lower part of their branches their steps are taken side by
 * side, each root's own in its order, which takes little more time than one.
 */
export function tanRootTwo(n, a) {
  const base = n * Math.PI, base2 = (n + 1) * Math.PI;
  if (n === 0 || a > base + Math.PI / 2) return [tanRoot(n, a), tanRoot(n + 1, a)];
  const tol = 1e-14 * (base + Math.PI / 2), tol2 = 1e-14 * (base2 + Math.PI / 2);
  let x = libm.atan(a / (base + Math.PI / 4)), x2 = libm.atan(a / (base2 + Math.PI / 4));
  let lo = 0, hi = Math.PI / 2, lo2 = 0, hi2 = Math.PI / 2, on = true, on2 = true;
  // solveBranch for each, step by step.
  for (let i = 0; i < 60 && (on || on2); i++) {
    if (on) {
      libm.sinCos(x);
      const s = SIN_COS[0], c = SIN_COS[1];
      const g = (base + x) * s - a * c, slope = s + (base + x) * c + a * s;
      if (g > 0) hi = x; else lo = x;
      let next = x - g / slope;
      if (!(next >= lo && next <= hi)) next = (lo + hi) / 2;
      if (Math.abs(next - x) < tol) on = false;
      x = next;
    }
    if (on2) {
      libm.sinCos(x2);
      const s = SIN_COS[0], c = SIN_COS[1];
      const g = (base2 + x2) * s - a * c, slope = s + (base2 + x2) * c + a * s;
      if (g > 0) hi2 = x2; else lo2 = x2;
      let next = x2 - g / slope;
      if (!(next >= lo2 && next <= hi2)) next = (lo2 + hi2) / 2;
      if (Math.abs(next - x2) < tol2) on2 = false;
      x2 = next;
    }
  }
  libm.sinCos(x);
  const r = { e: base + x, sin: SIN_COS[0], cos: SIN_COS[1] };
  libm.sinCos(x2);
  return [r, { e: base2 + x2, sin: SIN_COS[0], cos: SIN_COS[1] }];
}

/** The Laplace transform of W in ts, at p. */
export function neumanLaplace(p, sigma, beta) {
  const a = p / (sigma * beta);
  let sum = 0;
  for (let n = 0; n < MAX_TERMS; n++) {
    const { e, sin, cos } = tanRoot(n, a);
    const coef = e < 1e-8 ? 1 : (2 * sin * sin) / (e * (e + sin * cos));
    const term = coef * besselK0(Math.sqrt(beta * e * e + p));
    sum += term;
    if (n > 0 && term < SERIES_TOL * sum) break;
  }
  return (2 / p) * sum;
}

/** Neuman's W at dimensionless time ts = T t / (S r^2). */
export function neumanAt(ts, sigma, beta) {
  if (!(ts > 0)) return 0;
  return Math.max(0, stehfest((p) => neumanLaplace(p, sigma, beta), ts));
}

/** W(uA, uB, beta), as Neuman (1975) wrote it: uA = r^2 S / 4Tt, uB = r^2 Sy / 4Tt. */
export const neumanW = (uA, uB, beta) => neumanAt(1 / (4 * uA), uA / uB, beta);

// The fit. Drawdown is s = c W(t / 4a, sigma, beta) with c = Q / 4 pi T and
// a = r^2 S / 4T, so T = Q / 4 pi c, S = 4 T a / r^2 and Sy = S / sigma. For any a,
// sigma and beta the best c is a plain ratio, so three numbers are searched for.
const SIGMA_GRID = [1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3];
const BETA_GRID = [1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1, 3];
const LIMITS = { sigma: [1e-6, 1], beta: [1e-4, 100] };
const TABLE_LOG_TS = [-1.5, 7];
const TABLE_PER_DECADE = 6;
const MIN_POINTS = 6;

const bestScale = (s, w) => {
  let sw = 0, ww = 0;
  for (let i = 0; i < s.length; i++) { sw += s[i] * w[i]; ww += w[i] * w[i]; }
  return ww > 0 ? sw / ww : 0;
};
const sse = (s, w, c) => s.reduce((sum, x, i) => sum + (x - c * w[i]) * (x - c * w[i]), 0);

// W on a fixed grid of log ts, for a first look at every sigma and beta.
function typeCurve(sigma, beta) {
  const x = [], w = [];
  for (let k = TABLE_LOG_TS[0] * TABLE_PER_DECADE; k <= TABLE_LOG_TS[1] * TABLE_PER_DECADE; k++) {
    x.push(k / TABLE_PER_DECADE);
    w.push(neumanAt(libm.pow(10, k / TABLE_PER_DECADE), sigma, beta));
  }
  return (lts) => {
    const f = (lts - x[0]) * TABLE_PER_DECADE, i = Math.floor(f);
    if (i < 0) return 0;
    if (i >= x.length - 1) return w[w.length - 1];
    return w[i] + (w[i + 1] - w[i]) * (f - i);
  };
}

// Best log10 a for one type curve, by a scan over every shift the grid allows.
function bestShift(lt, s, curve) {
  const lo = Math.max(...lt) - TABLE_LOG_TS[1] - libm.log10(4), hi = Math.min(...lt) - TABLE_LOG_TS[0] - libm.log10(4);
  let best = { e: Infinity };
  for (let la = lo; la <= Math.max(lo, hi); la += 0.02) {
    const w = lt.map((x) => curve(x - libm.log10(4) - la));
    const c = bestScale(s, w), e = sse(s, w, c);
    if (c > 0 && e < best.e) best = { la, e };
  }
  return best;
}

function startingPoint(t, s) {
  const lt = t.map(libm.log10);
  let best = { e: Infinity };
  for (const sigma of SIGMA_GRID) {
    for (const beta of BETA_GRID) {
      const shift = bestShift(lt, s, typeCurve(sigma, beta));
      if (shift.e < best.e) best = { e: shift.e, x: [shift.la * Math.LN10, libm.log(sigma), libm.log(beta)] };
    }
  }
  return best.x;
}

const clampX = (x) => [x[0],
  Math.min(Math.max(x[1], libm.log(LIMITS.sigma[0])), libm.log(LIMITS.sigma[1])),
  Math.min(Math.max(x[2], libm.log(LIMITS.beta[0])), libm.log(LIMITS.beta[1]))];

function evaluate(t, s, x) {
  const a = libm.exp(x[0]), sigma = libm.exp(x[1]), beta = libm.exp(x[2]);
  const w = t.map((ti) => neumanAt(ti / (4 * a), sigma, beta));
  const c = bestScale(s, w);
  return { x, c, w, r: s.map((v, i) => v - c * w[i]), e: sse(s, w, c) };
}

// Levenberg-Marquardt on log a, log sigma and log beta, with c solved at each step.
function refine(t, s, x0) {
  const H = 1e-3;
  let cur = evaluate(t, s, x0), lambda = 1e-2, iterations = 0;
  for (; iterations < 30; iterations++) {
    const cols = [0, 1, 2].map((j) => {
      const x = cur.x.slice(); x[j] += H;
      const r = evaluate(t, s, x).r;
      return r.map((v, i) => (v - cur.r[i]) / H);
    });
    const A = new Array(9).fill(0), g = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) A[j * 3 + k] = cols[j].reduce((sum, v, i) => sum + v * cols[k][i], 0);
      g[j] = -cols[j].reduce((sum, v, i) => sum + v * cur.r[i], 0);
    }
    let improved = false;
    for (let tries = 0; tries < 10 && !improved; tries++) {
      const D = A.slice();
      for (let j = 0; j < 3; j++) D[j * 3 + j] *= 1 + lambda;
      const step = solveSPD(D, g, 3);
      const next = evaluate(t, s, clampX(cur.x.map((v, j) => v + step[j])));
      if (next.e < cur.e) {
        const gain = (cur.e - next.e) / (cur.e || 1);
        cur = next; lambda = Math.max(lambda / 3, 1e-9); improved = true;
        if (gain < 1e-10) return { ...cur, iterations };
      } else lambda *= 4;
    }
    if (!improved) break;
  }
  return { ...cur, iterations };
}

/**
 * Least squares fit of the Neuman (1975) curve.
 * t: days, s: drawdown in m, Q: m3/d, r: m. Returns T (m2/d), S, Sy, beta.
 */
export function fitNeuman(t, s, Q, r) {
  const bins = logBins(t, s);
  const keep = bins.t.map((_, i) => i).filter((i) => bins.y[i] > 0);
  if (keep.length < MIN_POINTS) throw new Error(`At least ${MIN_POINTS} drawdown readings above zero, spread over time, are needed for this fit.`);
  const tt = keep.map((i) => bins.t[i]), ss = keep.map((i) => bins.y[i]);
  const fit = refine(tt, ss, startingPoint(tt, ss));
  const a = libm.exp(fit.x[0]), sigma = libm.exp(fit.x[1]), beta = libm.exp(fit.x[2]);
  const T = Q / (4 * Math.PI * fit.c), S = (4 * T * a) / (r * r);
  const at = (lim, v) => Math.abs(libm.log(v / lim)) < 1e-6;
  return {
    T, S, Sy: S / sigma, sigma, beta, a, c: fit.c, iterations: fit.iterations,
    rmse: Math.sqrt(fit.e / tt.length), rows: tt.length, from: tt[0], to: tt[tt.length - 1], bins: { t: tt, y: ss, n: keep.map((i) => bins.n[i]) },
    atLimit: { sigma: LIMITS.sigma.some((l) => at(l, sigma)), beta: LIMITS.beta.some((l) => at(l, beta)) },
  };
}

/** The fitted curve and its two Theis asymptotes, at times t in days. */
export function neumanCurves(fit, t) {
  return {
    neuman: t.map((x) => fit.c * neumanAt(x / (4 * fit.a), fit.sigma, fit.beta)),
    early: t.map((x) => fit.c * wellFunction(fit.a / x)),
    late: t.map((x) => fit.c * wellFunction((fit.a * (1 + 1 / fit.sigma)) / x)),
  };
}

// The slopes of the fitted drawdown c W(t / 4a, sigma, beta) in log c, log a, log sigma
// and log beta, at the fit, by forward differences with the search's own step. From them
// the runs test of the misfits, judged against random readings passed through the same
// fit (runsCalibrated, after Hill 1998, p. 22), and the correlation of Sy with Kz/Kr from
// the linearized covariance (J'J)^-1 (Hill 1998, equation 30). The fit itself is unchanged.
const SLOPE_STEP = 1e-3;
export function fitStatistics(fit) {
  const { t, y, n } = fit.bins;
  const x0 = [libm.log(fit.a), libm.log(fit.sigma), libm.log(fit.beta)];
  const curve = (x) => t.map((ti) => fit.c * neumanAt(ti / (4 * libm.exp(x[0])), libm.exp(x[1]), libm.exp(x[2])));
  const w0 = curve(x0);
  const J = [w0];
  for (let j = 0; j < 3; j++) {
    const x = x0.slice(); x[j] += SLOPE_STEP;
    J.push(curve(x).map((v, i) => (v - w0[i]) / SLOPE_STEP));
  }
  const A = new Float64Array(16);
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) A[a * 4 + b] = J[a].reduce((sum, v, i) => sum + v * J[b][i], 0);
  const { inv } = invertSPD(A, 4);
  if (!inv) return { misfit: null, correlation: null };
  // log Sy = log a - log c - log sigma and log Kz/Kr = log beta, each plus a constant.
  const quad = (u, v) => u.reduce((sum, ua, a) => sum + v.reduce((s2, vb, b) => s2 + ua * inv[a * 4 + b] * vb, 0), 0);
  const sy = [-1, 1, -1, 0], kz = [0, 0, 0, 1];
  return {
    misfit: runsCalibrated(y.map((v, i) => v - w0[i]), J, inv, n),
    correlation: quad(sy, kz) / Math.sqrt(quad(sy, sy) * quad(kz, kz)),
  };
}

// Drawdown may be read in cm; distances and thicknesses are in m or ft. Metric first.
export const LENGTH_UNITS = ['m', 'cm', 'ft'];
export const DISTANCE_UNITS = ['m', 'ft'];

/**
 * input: { t: elapsed times, s: drawdowns }, in timeUnit and drawdownUnit.
 * opts: { timeUnit, drawdownUnit, rate, rateUnit, distance, distanceUnit, thickness, thicknessUnit }
 */
export function analyzeUnconfined(input, o) {
  const tu = TIME_UNITS[o.timeUnit], su = UNITS[o.drawdownUnit], qu = RATE_UNITS[o.rateUnit];
  const ru = UNITS[o.distanceUnit], bu = UNITS[o.thicknessUnit];
  if (!tu) throw new Error('Choose the unit of the time column.');
  if (!su || !LENGTH_UNITS.includes(o.drawdownUnit)) throw new Error('Choose the unit of the drawdown column.');
  if (!qu) throw new Error('Choose the unit of the pumping rate.');
  if (!ru || !bu || !DISTANCE_UNITS.includes(o.distanceUnit) || !DISTANCE_UNITS.includes(o.thicknessUnit)) throw new Error('Choose the units of the distance and the thickness.');
  const Q = o.rate * qu, r = o.distance * ru, b = o.thickness * bu;
  if (!(Q > 0)) throw new Error('The pumping rate must be above zero.');
  if (!(r > 0)) throw new Error('The distance from the pumped well must be above zero.');
  if (!(b > 0)) throw new Error('The saturated thickness must be above zero.');
  const rows = input.t.map((_, i) => i).filter((i) => isNum(input.t[i]) && isNum(input.s[i]) && input.t[i] > 0);
  const t = rows.map((i) => input.t[i] * tu), s = rows.map((i) => input.s[i] * su);
  const fit = fitNeuman(t, s, Q, r);
  const ratio = (fit.beta * b * b) / (r * r), Kr = fit.T / b;
  // The readings in time order, for the comments, which quote them.
  const order = t.map((_, i) => i).sort((i, j) => t[i] - t[j]);
  const tt = order.map((i) => t[i]), st = order.map((i) => s[i]);
  const last = tt[tt.length - 1];
  const both = (curves) => [curves.neuman[0], curves.late[0]];
  const end = neumanCurves(fit, [last]);
  const lateShare = end.neuman[0] / end.late[0];
  const warnings = [];
  if (fit.sigma > 0.1) warnings.push(`Sy/S is ${(1 / fit.sigma).toFixed(1)}. Kruseman and de Ridder (1994) list Sy/S above 10 as a condition for this method, so treat the result with caution.`);
  if (fit.atLimit.beta) warnings.push(`β reached the edge of the range searched (${LIMITS.beta.join(' to ')}), so the data do not pin it down.`);
  if (fit.atLimit.sigma) warnings.push(`S/Sy reached the edge of the range searched (${LIMITS.sigma.join(' to ')}), so the data do not pin it down.`);
  if (rows.length < input.t.length) warnings.push(`${input.t.length - rows.length} rows had no time above zero or no drawdown and were left out.`);
  // Critical comments on the results, each quoting the readings and the fit and naming its
  // source (water-table.js), with numbers in the units chosen, then in metres and days.
  const stats = fitStatistics(fit);
  const inUnits = (x, f, u, si) => (f === 1 ? `${sig(x)} ${si}` : `${sig(x / f)} ${u} (${sig(x)} ${si})`);
  const comments = waterTableComments({
    t: tt, s: st, Q, T: fit.T, S: fit.S, Sy: fit.Sy, kzkr: ratio, r, b, rms: fit.rmse,
    late: lateReach((x) => both(neumanCurves(fit, [x])), last, fit.rmse),
    fully: true, misfit: stats.misfit, correlation: stats.correlation,
    show: {
      dd: (m) => inUnits(m, su, o.drawdownUnit, 'm'), len: (m) => inUnits(m, ru, o.distanceUnit, 'm'),
      time: (d) => timeText(d, { readings: { unit: o.timeUnit } }),
    },
  });
  return {
    fit, Q, r, b, Kr, Kz: Kr * ratio, anisotropy: ratio, warnings, comments, t, s,
    lateShare, rowsUsed: rows.length, misfit: stats.misfit, correlation: stats.correlation,
  };
}
