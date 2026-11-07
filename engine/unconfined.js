// Neuman (1974, 1975) delayed gravity response of an unconfined aquifer to a fully
// penetrating well, with the drawdown averaged over the saturated thickness, as a fully
// penetrating observation well sees it. The well function is computed from its Laplace
// transform and turned back into time by the Stehfest (1970) algorithm.
//
// Laplace form, in dimensionless time ts = T t / (S r^2) with Laplace variable p:
//   W(p) = (2/p) sum_n  2 sin^2(e_n) / (e_n (e_n + sin e_n cos e_n))  K0(sqrt(beta e_n^2 + p))
// where e_n are the roots of e tan e = p / (sigma beta), sigma = S/Sy, beta = r^2 Kz / (b^2 Kr).
// Everything here is metres and days unless a name says otherwise.

import { EULER, isNum, solveSPD } from './numeric.js';
import { logBins, wellFunction } from './pumping.js';
import { RATE_UNITS, TIME_UNITS, UNITS } from './units.js';

const STEHFEST_N = 16;
const SERIES_TOL = 1e-14;
const MAX_TERMS = 20000;

/** Modified Bessel function K0(x), to near machine precision. */
export function besselK0(x) {
  if (!(x > 0)) return Infinity;
  if (x <= 2) {
    const q = (x * x) / 4;
    let term = 1, i0 = 1, sum = 0, harmonic = 0;
    for (let k = 1; k < 30; k++) {
      term *= q / (k * k);
      harmonic += 1 / k;
      i0 += term;
      sum += term * harmonic;
      if (term < 1e-18) break;
    }
    return -(Math.log(x / 2) + EULER) * i0 + sum;
  }
  if (x > 745) return 0;
  // K0(x) = integral from 0 to infinity of exp(-x cosh t) dt. The trapezoid rule
  // converges exponentially on this integrand; a step of 0.25 is good to about 1e-17.
  const h = 0.25;
  let sum = Math.exp(-x) / 2;
  for (let k = 1; k < 400; k++) {
    const v = Math.exp(-x * Math.cosh(k * h));
    sum += v;
    if (v < 1e-18 * sum) break;
  }
  return sum * h;
}

/** Stehfest (1970) weights V_j for an even N. */
export function stehfestWeights(N) {
  const fact = [1];
  for (let i = 1; i <= N; i++) fact[i] = fact[i - 1] * i;
  const half = N / 2;
  const V = [];
  for (let j = 1; j <= N; j++) {
    let sum = 0;
    for (let k = Math.floor((j + 1) / 2); k <= Math.min(j, half); k++) {
      sum += (k ** half * fact[2 * k]) / (fact[half - k] * fact[k] * fact[k - 1] * fact[j - k] * fact[2 * k - j]);
    }
    V.push((-1) ** (j + half) * sum);
  }
  return V;
}
const WEIGHTS = stehfestWeights(STEHFEST_N);

/** Inverse Laplace transform of F at time t, by Stehfest. */
export function stehfest(F, t, V = WEIGHTS) {
  const k = Math.LN2 / t;
  let sum = 0;
  for (let j = 0; j < V.length; j++) sum += V[j] * F((j + 1) * k);
  return k * sum;
}

// Newton's method for an increasing f on (0, pi/2), kept inside the bracket.
function solveBranch(f, x, tol) {
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const [g, slope] = f(x);
    if (g > 0) hi = x; else lo = x;
    let next = x - g / slope;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < tol) return next;
    x = next;
  }
  return x;
}

// Root n of e tan e = a, as x = e - n pi in (0, pi/2), returned with sin x and cos x.
// Near the top of the branch, when a is large, it is solved for y = pi/2 - x instead.
function root(n, a) {
  const base = n * Math.PI, top = base + Math.PI / 2, tol = 1e-14 * top;
  if (a > top) {
    const y = solveBranch((v) => {
      const s = Math.sin(v), c = Math.cos(v);
      return [a * s - (top - v) * c, a * c + c + (top - v) * s];
    }, Math.atan((top - Math.atan(top / a)) / a), tol);
    return { e: top - y, sin: Math.cos(y), cos: Math.sin(y) };
  }
  const start = n === 0 && a < 1 ? Math.sqrt(a) * (1 - a / 6) : Math.atan(a / (base + Math.PI / 4));
  const x = solveBranch((v) => {
    const s = Math.sin(v), c = Math.cos(v);
    return [(base + v) * s - a * c, s + (base + v) * c + a * s];
  }, start, n === 0 ? 1e-14 * start : tol);
  return { e: base + x, sin: Math.sin(x), cos: Math.cos(x) };
}

/** The Laplace transform of W in ts, at p. */
export function neumanLaplace(p, sigma, beta) {
  const a = p / (sigma * beta);
  let sum = 0;
  for (let n = 0; n < MAX_TERMS; n++) {
    const { e, sin, cos } = root(n, a);
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
const sse = (s, w, c) => s.reduce((sum, x, i) => sum + (x - c * w[i]) ** 2, 0);

// W on a fixed grid of log ts, for a first look at every sigma and beta.
function typeCurve(sigma, beta) {
  const x = [], w = [];
  for (let k = TABLE_LOG_TS[0] * TABLE_PER_DECADE; k <= TABLE_LOG_TS[1] * TABLE_PER_DECADE; k++) {
    x.push(k / TABLE_PER_DECADE);
    w.push(neumanAt(10 ** (k / TABLE_PER_DECADE), sigma, beta));
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
  const lo = Math.max(...lt) - TABLE_LOG_TS[1] - Math.log10(4), hi = Math.min(...lt) - TABLE_LOG_TS[0] - Math.log10(4);
  let best = { e: Infinity };
  for (let la = lo; la <= Math.max(lo, hi); la += 0.02) {
    const w = lt.map((x) => curve(x - Math.log10(4) - la));
    const c = bestScale(s, w), e = sse(s, w, c);
    if (c > 0 && e < best.e) best = { la, e };
  }
  return best;
}

function startingPoint(t, s) {
  const lt = t.map(Math.log10);
  let best = { e: Infinity };
  for (const sigma of SIGMA_GRID) {
    for (const beta of BETA_GRID) {
      const shift = bestShift(lt, s, typeCurve(sigma, beta));
      if (shift.e < best.e) best = { e: shift.e, x: [shift.la * Math.LN10, Math.log(sigma), Math.log(beta)] };
    }
  }
  return best.x;
}

const clampX = (x) => [x[0],
  Math.min(Math.max(x[1], Math.log(LIMITS.sigma[0])), Math.log(LIMITS.sigma[1])),
  Math.min(Math.max(x[2], Math.log(LIMITS.beta[0])), Math.log(LIMITS.beta[1]))];

function evaluate(t, s, x) {
  const a = Math.exp(x[0]), sigma = Math.exp(x[1]), beta = Math.exp(x[2]);
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
  const a = Math.exp(fit.x[0]), sigma = Math.exp(fit.x[1]), beta = Math.exp(fit.x[2]);
  const T = Q / (4 * Math.PI * fit.c), S = (4 * T * a) / (r * r);
  const at = (lim, v) => Math.abs(Math.log(v / lim)) < 1e-6;
  return {
    T, S, Sy: S / sigma, sigma, beta, a, c: fit.c, iterations: fit.iterations,
    rmse: Math.sqrt(fit.e / tt.length), rows: tt.length, from: tt[0], to: tt[tt.length - 1], bins: { t: tt, y: ss },
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

// Drawdown may be read in cm; distances and thicknesses are in m or ft. Metric first.
export const LENGTH_UNITS = ['m', 'cm', 'ft'];
export const DISTANCE_UNITS = ['m', 'ft'];

// Further than this from the late Theis curve at the last reading, the test did not
// reach the late part, which is where Sy shows most directly.
const LATE_GAP = 0.05;

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
  const end = neumanCurves(fit, [fit.to]);
  const lateShare = end.neuman[0] / end.late[0];
  const peak = Math.max(...s);
  const warnings = [];
  if (fit.sigma > 0.1) warnings.push(`Sy/S is ${(1 / fit.sigma).toFixed(1)}. Kruseman and de Ridder (1994) list Sy/S above 10 as a condition for this method, so treat the result with caution.`);
  if (fit.atLimit.beta) warnings.push(`β reached the edge of the range searched (${LIMITS.beta.join(' to ')}), so the data do not pin it down.`);
  if (fit.atLimit.sigma) warnings.push(`S/Sy reached the edge of the range searched (${LIMITS.sigma.join(' to ')}), so the data do not pin it down.`);
  if (!(Math.abs(lateShare - 1) <= LATE_GAP)) warnings.push(`At the last reading the fitted curve is still ${(100 * Math.abs(lateShare - 1)).toFixed(0)}% ${lateShare > 1 ? 'above' : 'below'} the late Theis curve, so the test ended before the late part and Sy rests on the middle of the curve. Kruseman and de Ridder (1994) note that Sy found this way is often too low.`);
  if (peak > 0.1 * b) warnings.push(`The largest drawdown is ${(100 * peak / b).toFixed(0)}% of the saturated thickness. Neuman's solution assumes the drawdown is small compared with it.`);
  if (rows.length < input.t.length) warnings.push(`${input.t.length - rows.length} rows had no time above zero or no drawdown and were left out.`);
  return {
    fit, Q, r, b, Kr, Kz: Kr * ratio, anisotropy: ratio, warnings, t, s,
    lateShare, peakShare: peak / b, rowsUsed: rows.length,
  };
}
