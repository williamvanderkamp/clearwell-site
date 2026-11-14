// van der Kamp (1976), "Determining aquifer transmissivity by means of well response
// tests: The underdamped case", Water Resources Research 12(1), 71-77: the transmissivity
// T of a confined aquifer from the damping and frequency of a water level that oscillates
// after a slug test, with the paper's effective water-column length L (its eq. 1), its
// relations (36) to (40), its conditions of validity, and the checks of its appendix on
// friction in the well. Equation numbers below are the paper's.
//
// The paper read the damping gamma and the angular frequency omega off a chart of the
// record, from successive peaks (as Kruseman and de Ridder 1994, section 16.1.2, set out
// the same reading). Here they are also fitted to the whole record by least squares, with
// the paper's own damped cosine (7) as the model, its time origin, amplitude and the
// static level fitted with them, so that T comes with a standard error from the scatter
// of every reading, and the record can be checked against the paper's assumptions.
// Everything here is in metres and seconds: T in m²/s.

import { tQuantile } from './tdist.js';
import { invertSPD } from './linalg.js';
import { runsCalibrated } from './runs.js';
import { cdiv, cmul, cscale, csqrt, csub, cx, ratioK } from './laplace.js';
import { G } from './slug-models.js';
import { normalQuantile } from './trend.js';
import * as libm from './libm.js';

// "Much less than" in (49) and (52) is taken as a factor of 10, as the paper's own
// reading of (28) does.
export const MUCH_LESS = 10;

/** (1): the effective length of the water column, Lc in the casing and Lf of filter. */
export const effectiveLength = (Lc, Lf) => Lc + (3 / 8) * Lf;

function checkPositive(values) {
  for (const [name, v] of Object.entries(values)) if (!(v > 0)) throw new Error(`${name} must be above zero.`);
}

/**
 * T from gamma and omega (1/s) by the paper's relations: L (36), d (37), a and b (39), and
 * T = b + a ln T (38) by the iteration (40) from T0 = b, carried on until it settles
 * (the paper: "within three or four iterations"). rc is the casing radius, rf the filter
 * radius, S the storativity. Also alpha (27), whose condition (28) the result must meet,
 * and dlnT/dlnS = -a/(T - a), how far T moves with S (from (38) and (39b)).
 */
export function vanDerKamp({ gamma, omega, rc, rf, S, g = G }) {
  checkPositive({ 'The damping gamma': gamma, 'The angular frequency omega': omega, 'The casing radius': rc, 'The filter radius': rf, 'The storativity': S });
  const L = g / (omega * omega + gamma * gamma);
  const omega0 = Math.sqrt(g / L);
  const d = gamma / omega0;
  return { L, omega0, d, ...transmissivity({ d, omega0, rc, rf, S }) };
}

/** (38) to (40) for a given d and (g/L)^1/2. */
export function transmissivity({ d, omega0, rc, rf, S }) {
  const a = (rc * rc * omega0) / (8 * d);
  const inner = 0.79 * rf * rf * S * omega0;
  if (!(inner < 1)) throw new Error('0.79 rf² S (g/L)^½ is 1 or more, so b of van der Kamp\'s (39b) is not positive and (38) has no solution. Check the well radius, S and the units.');
  const b = -a * libm.log(inner);
  // (38) has a root above a, where the iteration (40) converges, a/T being the slope of
  // its right side; T0 = b is above it.
  // Near the double root of (38), where its two roots meet (T = a), the iteration slows
  // without end: after 200 steps it is left there, and settled says so.
  const steps = [b];
  let T = b, settled = false;
  for (let n = 1; n < 200 && !settled; n++) {
    const next = b + a * libm.log(T);
    steps.push(next);
    if (!(next > 0)) throw new Error('The iteration (40) of van der Kamp (1976) went below zero, so (38) has no solution for these values.');
    settled = Math.abs(next - T) <= 1e-13 * next;
    T = next;
  }
  const alpha = 0.89 * Math.sqrt(S / T) * Math.sqrt(omega0) * rf;
  // How far T is from solving (38), as a share of T.
  const residual = Math.abs(b + a * libm.log(T) - T) / T;
  return { a, b, T, steps, settled, residual, alpha, dlnTdlnS: -a / (T - a) };
}

/**
 * T and L from the paper's relations before its approximation (29): (20) with W = w0
 * e^{pt}, p = -gamma + i omega, gives p² - (g/L) A p + g/L = 0, that is L = g (A p - 1)/p²,
 * with A from (21), A = rc² K0(q rf) / (2 T q rf K0'(q rf)) = -rc² (K0/K1)(q rf) / (2 T
 * q rf), q = (p S / T)^1/2 (16). L must be real, which fixes T. The paper: "The
 * approximation involved in (29) is not essential to the analysis". Tnear is where the
 * search for T begins (the approximate T). Returns null when no T makes L real nearby.
 */
export function vanDerKampFull({ gamma, omega, rc, rf, S, g = G, Tnear }) {
  checkPositive({ 'The damping gamma': gamma, 'The angular frequency omega': omega, 'The casing radius': rc, 'The filter radius': rf, 'The storativity': S });
  const p = cx(-gamma, omega), p2 = cmul(p, p);
  const lOf = (T) => {
    const z = cscale(csqrt(cscale(p, S / T)), rf);
    const A = cscale(cdiv(ratioK(z), z), -(rc * rc) / (2 * T));
    return cscale(cdiv(csub(cmul(A, p), cx(1)), p2), g);
  };
  const f = (u) => lOf(libm.exp(u)).im;
  // A bracket of the sign change in ln T, out from the approximate T by factors of 2.
  const u0 = libm.log(Tnear);
  let lo = null, hi = null;
  for (let k = 0; k <= 40 && lo === null; k++) {
    for (const s of [-1, 1]) {
      const a = u0 + s * k * Math.LN2 / 2, b = a + s * Math.LN2 / 2;
      if (Math.sign(f(a)) !== Math.sign(f(b))) { [lo, hi] = s > 0 ? [a, b] : [b, a]; break; }
    }
  }
  if (lo === null) return null;
  let flo = f(lo);
  for (let i = 0; i < 200 && hi - lo > 1e-14; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  const T = libm.exp((lo + hi) / 2), L = lOf(T).re;
  if (!(L > 0)) return null;
  return { T, L, d: gamma / Math.sqrt(g / L) };
}

/**
 * The paper's appendix on friction in the well. Laminar (49): 4 nu / rc² << gamma.
 * Turbulent (52): 0.005 (w0 / rc) << gamma / omega, w0 the initial displacement. Each
 * gives its two sides; nu or w0 left out leaves its check out.
 */
export function frictionChecks({ gamma, omega, rc, nu, w0 }) {
  const out = {};
  if (nu !== undefined) out.laminar = { left: (4 * nu) / (rc * rc), right: gamma };
  if (w0 !== undefined) out.turbulent = { left: (0.005 * Math.abs(w0)) / rc, right: gamma / omega };
  for (const c of Object.values(out)) c.met = c.left * MUCH_LESS <= c.right;
  return out;
}

// ---------------------------------------------------------------------------------
// The record: its peaks, and the paper's damped cosine fitted to it.

/**
 * The extremes of a record about a level: between each pair of crossings of the level,
 * the reading furthest from it. A crossing counts only once the record has gone more
 * than band past the level on the other side, so scatter about the level near a crossing
 * does not make extremes of its own. Returns [{ i, t, w }] with w measured from the level.
 */
export function extremes(t, w, level = 0, band = 0) {
  const out = [];
  let best = -1, side = 0;
  for (let i = 0; i < w.length; i++) {
    const v = w[i] - level;
    if (Math.abs(v) <= band || v === 0) continue;
    if (side && Math.sign(v) !== side) { out.push({ i: best, t: t[best], w: w[best] - level }); best = -1; }
    side = Math.sign(v);
    if (best < 0 || Math.abs(v) > Math.abs(w[best] - level)) best = i;
  }
  if (best >= 0) out.push({ i: best, t: t[best], w: w[best] - level });
  return out;
}

/**
 * The paper's reading of a record (p. 74; Kruseman and de Ridder 1994, eqs. 16.9 and 16.10,
 * Procedure 16.2): from two successive maxima, or minima, n and n + 2 of the extremes, the
 * period tau = t(n+2) - t(n) and the log decrement delta = ln(w(n) / w(n+2)) give gamma =
 * delta / tau and omega = 2 pi / tau. One reading for each pair, as Procedure 16.2 says to
 * repeat it for different pairs.
 */
export function peakReadings(ext) {
  const out = [];
  for (let n = 0; n + 2 < ext.length; n++) {
    const a = ext[n], b = ext[n + 2];
    if (Math.sign(a.w) !== Math.sign(b.w) || !(Math.abs(b.w) < Math.abs(a.w))) continue;
    const tau = b.t - a.t, delta = libm.log(a.w / b.w);
    out.push({ from: a.t, to: b.t, tau, delta, gamma: delta / tau, omega: (2 * Math.PI) / tau, amplitude: Math.abs(a.w) });
  }
  return out;
}

// The model, w = e^{-gamma s} (A cos omega s + B sin omega s) + c, s = t - t1, which is
// the paper's (7), w0 e^{-gamma (t - t0)} cos omega (t - t0), with its time origin t0 and
// its initial displacement w0 free, and the static level c about which it oscillates.
const NAMES = ['gamma', 'omega', 'A', 'B', 'c'];
function curve(s, [gamma, omega, A, B, c]) {
  return s.map((x) => libm.exp(-gamma * x) * (A * libm.cos(omega * x) + B * libm.sin(omega * x)) + c);
}
// The slopes of the model in each value, one array for each.
function slopes(s, [gamma, omega, A, B]) {
  const J = NAMES.map(() => new Float64Array(s.length));
  s.forEach((x, i) => {
    const e = libm.exp(-gamma * x), co = libm.cos(omega * x), si = libm.sin(omega * x);
    J[0][i] = -x * e * (A * co + B * si);
    J[1][i] = x * e * (B * co - A * si);
    J[2][i] = e * co;
    J[3][i] = e * si;
    J[4][i] = 1;
  });
  return J;
}
const normalMatrix = (J) => {
  const k = J.length, n = J[0].length, M = new Float64Array(k * k);
  for (let a = 0; a < k; a++) for (let b = 0; b <= a; b++) { let v = 0; for (let i = 0; i < n; i++) v += J[a][i] * J[b][i]; M[a * k + b] = v; M[b * k + a] = v; }
  return M;
};

// Solves the small symmetric system M x = v by Gaussian elimination with pivoting.
function solve(M, v, k) {
  const a = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => M[i * k + j]), v[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (!(Math.abs(a[p][c]) > 0)) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < k; r++) { const m = a[r][c] / a[c][c]; for (let j = c; j <= k; j++) a[r][j] -= m * a[c][j]; }
  }
  const x = new Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) { let s = a[r][k]; for (let j = r + 1; j < k; j++) s -= a[r][j] * x[j]; x[r] = s / a[r][r]; }
  return x;
}

// For given gamma and omega the model is linear in A, B and c: their least-squares values.
function linearPart(s, y, gamma, omega) {
  const J = slopes(s, [gamma, omega, 0, 0]).slice(2);
  const M = normalMatrix(J), v = J.map((col) => col.reduce((acc, x, i) => acc + x * y[i], 0));
  const x = solve(M, v, 3);
  return x ? [gamma, omega, ...x] : null;
}

/**
 * The starting point: the best of a grid, so that nothing about the well is assumed.
 * (g/L)^1/2 at 80 values from a quarter of a cycle over the record to the Nyquist rate of
 * the median reading interval, by d at 24 values from 0.01 to 0.95, with A, B and c
 * solved for each; and, when there are two successive peaks, the paper's reading of them.
 */
function startingPoint(s, y, reading) {
  const span = s[s.length - 1] - s[0];
  const steps = s.slice(1).map((x, i) => x - s[i]).filter((x) => x > 0).sort((a, b) => a - b);
  const dt = steps[Math.floor(steps.length / 2)] || span / s.length;
  const lo = Math.PI / (2 * span), hi = Math.PI / dt;
  const tries = [];
  for (let i = 0; i < 80; i++) {
    const w0 = lo * libm.pow(hi / lo, i / 79);
    for (let j = 0; j < 24; j++) {
      const d = 0.01 + (0.94 * j) / 23;
      tries.push([d * w0, w0 * Math.sqrt(1 - d * d)]);
    }
  }
  if (reading) tries.push([reading.gamma, reading.omega]);
  let best = null;
  for (const [g, w] of tries) {
    const fit = linearMisfit(s, y, g, w);
    if (fit && (!best || fit.e < best.e)) best = fit;
  }
  return best && best.x;
}

// For the grid: what linearPart and the sum of squares of curve give, in two passes over
// the readings, the normal equations of A, B and c summed in the first and the misfits of
// their solution in the second, with no arrays of slopes. The grid is most of the time a
// dense record takes.
function linearMisfit(s, y, gamma, omega) {
  const n = s.length, C = new Float64Array(n), Sn = new Float64Array(n);
  let cc = 0, cs = 0, ss = 0, c1 = 0, s1 = 0, yc = 0, ys = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const e = libm.exp(-gamma * s[i]), a = e * libm.cos(omega * s[i]), b = e * libm.sin(omega * s[i]);
    C[i] = a; Sn[i] = b;
    cc += a * a; cs += a * b; ss += b * b; c1 += a; s1 += b; yc += y[i] * a; ys += y[i] * b; y1 += y[i];
  }
  const x = solve([cc, cs, c1, cs, ss, s1, c1, s1, n], [yc, ys, y1], 3);
  if (!x) return null;
  let e = 0;
  for (let i = 0; i < n; i++) { const d = y[i] - x[0] * C[i] - x[1] * Sn[i] - x[2]; e += d * d; }
  return { x: [gamma, omega, ...x], e };
}

// Levenberg-Marquardt from x on the misfits r(x) = target - model, with jac(x) the slopes
// of the model, one array for each value. gamma and omega, the values at the indices
// positive, stay above zero: the paper's model decays and oscillates.
function marquardt(x, misfits, jac, positive = [0, 1]) {
  const k = x.length;
  let r = misfits(x), e = r.reduce((a, v) => a + v * v, 0), lambda = 1e-3, iterations = 0, converged = false;
  for (; iterations < 200 && !converged; iterations++) {
    const J = jac(x), M = normalMatrix(J), g = J.map((col) => col.reduce((acc, c, i) => acc + c * r[i], 0));
    let moved = false;
    while (lambda < 1e12) {
      const D = M.slice();
      for (let a = 0; a < k; a++) D[a * k + a] += lambda * (M[a * k + a] || 1);
      const step = solve(D, g, k);
      const next = step && x.map((v, j) => v + step[j]);
      if (next && positive.every((j) => next[j] > 0)) {
        const rn = misfits(next), en = rn.reduce((a, v) => a + v * v, 0);
        if (en < e) {
          converged = (e - en) <= 1e-13 * e || Math.max(...step.map((v, j) => Math.abs(v) / (Math.abs(next[j]) + 1e-300))) < 1e-12;
          x = next; r = rn; e = en; lambda = Math.max(lambda / 3, 1e-12); moved = true;
          break;
        }
      }
      lambda *= 4;
    }
    if (!moved) converged = true;
  }
  return { x, e, iterations, converged };
}

// Misfits and slopes taken from one reading to the next as v(i) - rho v(i - 1), for
// i = 2 to n: Cochrane and Orcutt's (1949) transformation for errors correlated with a
// lag-one coefficient rho. rho = 0 leaves them as they are.
const lagged = (v, rho) => (rho ? Array.from({ length: v.length - 1 }, (_, i) => v[i + 1] - rho * v[i]) : Array.from(v));
// Prais and Winsten (1954): the same differences, with the first reading kept, times
// (1 - rho²)^1/2, so that each part keeps every reading. With rho known this is the exact
// generalized least squares of errors correlated with lag-one coefficient rho; the first
// reading of the early part, where the oscillation is largest, is not dropped.
const whiten = (v, rho) => (rho ? [Math.sqrt(1 - rho * rho) * v[0], ...lagged(v, rho)] : Array.from(v));
const lagOne = (r) => { let num = 0, den = 0; for (let i = 1; i < r.length; i++) { num += r[i] * r[i - 1]; den += r[i - 1] * r[i - 1]; } return den > 0 ? num / den : 0; };

/**
 * The paper's damped cosine (7) fitted to readings y at times t (s) by least squares, by
 * the Levenberg (1944) and Marquardt (1963) method with exact slopes. The values fitted
 * are gamma, omega, the amplitude and phase (as A and B) and the level c about which the
 * record oscillates, measured from the static level given. w0 and t0 are the paper's:
 * w = w0 e^{-gamma (t - t0)} cos omega (t - t0), t0 being the crest of the cosine nearest
 * the first reading fitted.
 * Standard errors from the residual variance SSE/(n - 5) and (J'J)^-1, 95% intervals
 * from Student's t with n - 5 degrees of freedom, as on the rest of the page; the runs
 * test of Hill (1998) as calibrated in runs.js, and lag1, the lag-one correlation of the
 * misfits.
 * Misfits that run from one reading to the next, as they do where a dense record departs
 * from the curve in a smooth way, make those standard errors too small. With serial (the
 * default) and lag1 above zero, the fit is also made by the iterated method of Cochrane
 * and Orcutt (1949): rho is the lag-one correlation of the misfits, in the order of the
 * readings, and the curve is fitted to the differences v(i) - rho v(i - 1) of the
 * readings, until rho settles; its values, standard errors (SSE/(n - 1 - 5 - 1), rho being
 * fitted too, times (J'J)^-1 of those differences) and intervals are in serial. They are
 * a second opinion, not the answer: where the misfits are the curve's own departure from
 * the record rather than noise, the two fits differ, and by how much is part of the
 * uncertainty. serial as a number is rho given, as estimated from more readings than
 * these: one fit with it, n - 1 - 5 degrees of freedom. Where that fit fails there is no
 * serial, and serialFailed says why. progress, if given, hears { stage } as the fit goes
 * on: 'grid', 'fit', 'serial' and 'runs'.
 */
export function fitDampedCosine(t, y, { start = null, search = true, runs = true, serial = true, progress = () => {} } = {}) {
  const n = t.length, k = NAMES.length;
  if (n <= k + 3) throw new Error(`The fit of the damped cosine needs more than ${k + 3} readings; there are ${n}.`);
  const t1 = t[0], s = t.map((x) => x - t1);
  // From the grid with start among its points, or (search false) from start alone.
  if (search) progress({ stage: 'grid' });
  let x = search ? startingPoint(s, y, start) : null;
  if (!x && start) x = linearPart(s, y, start.gamma, start.omega);
  if (!x) throw new Error('No starting point could be found for the damped cosine.');
  const fitWith = (from, rho) => {
    const yy = lagged(y, rho);
    return marquardt(from, (v) => { const f = lagged(curve(s, v), rho); return yy.map((w, i) => w - f[i]); }, (v) => slopes(s, v).map((col) => lagged(col, rho)));
  };
  progress({ stage: 'fit' });
  const plain = fitWith(x, 0);
  const statistics = (fit, rho, rhoFitted = true) => {
    const J = slopes(s, fit.x).map((col) => lagged(col, rho)), m = J[0].length;
    const dof = m - k - (rho && rhoFitted ? 1 : 0), s2 = fit.e / dof;
    const { inv, weak } = invertSPD(normalMatrix(J), k);
    if (!inv) throw new Error('The readings do not fix the damped cosine: some combination of its values leaves the curve unchanged, as when the oscillation has died away within the readings fitted.');
    const tCrit = tQuantile(0.975, dof), cov = Array.from(inv, (v) => v * s2);
    const se = {}, ci = {}, values = {}, corr = {};
    NAMES.forEach((id, a) => {
      values[id] = fit.x[a];
      se[id] = Math.sqrt(cov[a * k + a]);
      ci[id] = [fit.x[a] - tCrit * se[id], fit.x[a] + tCrit * se[id]];
      corr[id] = Object.fromEntries(NAMES.map((o, b) => [o, cov[a * k + b] / Math.sqrt(cov[a * k + a] * cov[b * k + b])]));
    });
    return { values, se, ci, corr, cov, dof, tCrit, sigma: Math.sqrt(s2), weak, J, inv, iterations: fit.iterations, converged: fit.converged, x: fit.x };
  };
  const ols = statistics(plain, 0);
  const fitted = curve(s, plain.x), residuals = y.map((v, i) => v - fitted[i]);
  const lag1 = lagOne(residuals);
  // The second opinion can fail where the first did not, as when on part of a record with
  // misfits strongly correlated its curve drifts to a frequency near zero, where the
  // values no longer fix it; then there is none, and serialFailed says why.
  let second = null, serialFailed = null;
  if (typeof serial === 'number') {
    // rho given, as estimated elsewhere: one fit with it, and the degrees of freedom of
    // the plain fit's differences.
    try {
      const fit = fitWith(plain.x, serial), { J, inv, x: _x, ...st } = statistics(fit, serial, false);
      second = { ...st, rho: serial, rounds: 1, given: true };
    } catch (e) {
      serialFailed = e.message;
    }
  } else if (serial && lag1 > 0) {
    progress({ stage: 'serial' });
    try {
      let rho = lag1, fit = plain, rounds = 0;
      for (; rounds < 50; rounds++) {
        fit = fitWith(fit.x, rho);
        const f = curve(s, fit.x), next = lagOne(y.map((v, i) => v - f[i]));
        const settled = Math.abs(next - rho) < 1e-6;
        rho = next;
        if (settled || !(rho > 0 && rho < 1)) break;
      }
      if (rho > 0 && rho < 1) {
        const { J, inv, x: _x, ...st } = statistics(fit, rho);
        second = { ...st, rho, rounds: rounds + 1 };
      }
    } catch (e) {
      serialFailed = e.message;
    }
  }
  const [gamma, omega, A, B] = plain.x;
  // The paper's w0 and t0: A cos + B sin = R cos(omega s - phi).
  const R = libm.hypot(A, B), phi = libm.atan2(B, A);
  const t0 = t1 + phi / omega, w0 = R * libm.exp(-gamma * (phi / omega));
  const { J, inv, x: _x, ...shown } = ols;
  if (runs) progress({ stage: 'runs' });
  return {
    ...shown, names: NAMES, n, k, sse: plain.e, rms: Math.sqrt(plain.e / n), t1, t0, w0,
    fitted, residuals, lag1, serial: second, serialFailed,
    runs: runs ? runsCalibrated(residuals, J, inv) : null,
    at: (times) => curve(times.map((v) => v - t1), plain.x),
  };
}

// The covariance of gamma and omega, and a function of them, to first order.
function propagate(fit, f) {
  const { gamma, omega } = fit.values, k = fit.k, c = fit.cov;
  const h1 = 1e-6 * gamma, h2 = 1e-6 * omega;
  const dg = (f(gamma + h1, omega) - f(gamma - h1, omega)) / (2 * h1);
  const dw = (f(gamma, omega + h2) - f(gamma, omega - h2)) / (2 * h2);
  const v = dg * dg * c[0] + 2 * dg * dw * c[1] + dw * dw * c[k + 1];
  return Math.sqrt(Math.max(v, 0));
}

/**
 * The whole method on one record. t (s) and y, the readings as displacement from static
 * (any unit; H/H0 on the page). geo: rc and rf (m), S, and as given: g, nu (m²/s) for
 * (49), w0 (m, the initial displacement) for (52), Lc and Lf (m) for the L of (1), D (m)
 * for K = T / D. from and to (s) bound the readings fitted; without from, the fit starts at
 * the first extreme of the record, as the paper's reading does (p. 74: "after the first
 * maximum or minimum"), the reading furthest from static (firstExtreme).
 */
export function analyseVanDerKamp(t, y, geo, { from, to, runs = true, serial = true, progress = () => {} } = {}) {
  const g = geo.g ?? G;
  checkPositive({ 'The casing radius': geo.rc, 'The well radius': geo.rf, 'The storativity S': geo.S });
  if (geo.S > 1) throw new Error('The storativity cannot be above 1.');
  const order = t.map((_, i) => i).filter((i) => Number.isFinite(t[i]) && Number.isFinite(y[i])).sort((a, b) => t[a] - t[b]);
  const lo = from ?? t[order[firstExtreme(order.map((i) => y[i]))]], hi = to ?? Infinity;
  const used = order.filter((i) => t[i] >= lo && t[i] <= hi);
  if (used.length < 8) throw new Error(`Only ${used.length} readings fall in the fit; the damped cosine needs at least 8.`);
  const tt = used.map((i) => t[i]), yy = used.map((i) => y[i]);
  const fit = fitDampedCosine(tt, yy, { runs, serial, progress });
  const { gamma, omega } = fit.values;
  const base = { rc: geo.rc, rf: geo.rf, S: geo.S, g };
  const result = vanDerKamp({ gamma, omega, ...base });
  const sd = {
    L: propagate(fit, (a, b) => g / (a * a + b * b)),
    d: propagate(fit, (a, b) => a / Math.sqrt(a * a + b * b)),
    lnT: propagate(fit, (a, b) => libm.log(vanDerKamp({ gamma: a, omega: b, ...base }).T)),
  };
  const z = fit.tCrit;
  const intervals = {
    L: [result.L - z * sd.L, result.L + z * sd.L],
    d: [result.d - z * sd.d, result.d + z * sd.d],
    T: [result.T * libm.exp(-z * sd.lnT), result.T * libm.exp(z * sd.lnT)],
  };
  const full = vanDerKampFull({ gamma, omega, ...base, Tnear: result.T });
  // The same from the fit that allows for misfits correlated from one reading to the next.
  // Its gamma and omega may give no T where the plain fit's do; then it is dropped, and
  // serialFailed says why, as when that fit fails.
  let second = null, serialFailed = fit.serialFailed;
  if (fit.serial) {
    try {
      const q = { ...fit.serial, k: fit.k }, { gamma: g2, omega: w2 } = q.values;
      const r2 = vanDerKamp({ gamma: g2, omega: w2, ...base });
      const lnT = propagate(q, (a, b) => libm.log(vanDerKamp({ gamma: a, omega: b, ...base }).T));
      second = { rho: q.rho, gamma: g2, omega: w2, L: r2.L, d: r2.d, T: r2.T, sdLnT: lnT, interval: [r2.T * libm.exp(-q.tCrit * lnT), r2.T * libm.exp(q.tCrit * lnT)] };
    } catch (e) {
      serialFailed = e.message;
    }
  }
  // The fitted extremes above the scatter: where the fitted envelope at a crest of the
  // cosine is more than t times the residual standard deviation.
  const env = (x) => Math.abs(fit.w0) * libm.exp(-gamma * (x - fit.t0));
  const crests = [];
  for (let m = Math.ceil(((tt[0] - fit.t0) * omega) / Math.PI - 1e-9); ; m++) {
    const at = fit.t0 + (m * Math.PI) / omega;
    if (at > tt[tt.length - 1] || crests.length > 10000) break;
    if (env(at) > fit.tCrit * fit.sigma) crests.push(at); else break;
  }
  // The paper's reading of the record, peak by peak about the static level given, with
  // crossings counted past t times the residual standard deviation of the fit, and only
  // while the later peak of a pair stands above it. The first pair is the paper's reading.
  const band = fit.tCrit * fit.sigma;
  const ext = extremes(tt, yy, 0, band);
  const readings = peakReadings(ext).filter((q) => q.amplitude * libm.exp(-q.delta) > band)
    .map((q) => ({ ...q, ...safe(() => vanDerKamp({ gamma: q.gamma, omega: q.omega, ...base })) }));
  const graphical = readings.length && readings[0].from === ext[0].t ? readings[0] : null;
  progress({ stage: 'split' });
  const split = splitFit(tt, yy, fit, crests);
  return {
    used, fit, ...result, sd, intervals, full, serial: second, serialFailed, readings, graphical, crests, split,
    friction: frictionChecks({ gamma, omega, rc: geo.rc, nu: geo.nu, w0: geo.w0 }),
    predictedL: geo.Lc !== undefined && geo.Lf !== undefined ? effectiveLength(geo.Lc, geo.Lf) : undefined,
    K: geo.D !== undefined ? result.T / geo.D : undefined,
  };
}

/**
 * analyseVanDerKamp with its fitted curve as numbers rather than a function, so that the
 * result can be sent from a Web Worker: fitted, the curve at every t, and curve, at
 * `points` times evenly spaced over the readings fitted.
 */
export function analyseVanDerKampData(t, y, geo, options = {}, points = 600) {
  const r = analyseVanDerKamp(t, y, geo, options);
  const { at, ...fit } = r.fit;
  const t0 = t[r.used[0]], t9 = t[r.used[r.used.length - 1]];
  const grid = Array.from({ length: points }, (_, i) => t0 + ((t9 - t0) * i) / (points - 1));
  return { ...r, fit, fitted: at(t), curve: { t: grid, y: at(grid) } };
}

/**
 * Where the fit starts when no time is given: the reading furthest from static, the last
 * of them if several are equally far. The paper's model is a damped spring (its eq. 20,
 * and (44) with friction), whose energy only falls, so no swing after the start is larger
 * than the displacement that started it, and where the level was set moving from static
 * the largest is its first crest. Either way it is the first maximum or minimum, after
 * which the paper takes (7) to hold (p. 74), and readings at static before the slug
 * (the paper's own tests held the level steady before the slug was hoisted out, p. 74),
 * which scatter about static, are left out however many there are. The record must cross
 * static after it, or it does not oscillate. w is in the order of the readings; returns
 * its index.
 */
export function firstExtreme(w) {
  let first = -1;
  for (let i = 0; i < w.length; i++) if (first < 0 || Math.abs(w[i]) >= Math.abs(w[first])) first = i;
  const side = Math.sign(w[first]);
  if (!side || !w.slice(first + 1).some((v) => Math.sign(v) === -side)) throw new Error('The level does not cross static after its largest displacement, so the record does not oscillate. van der Kamp (1976) is for an underdamped response, one that oscillates; for this record use a method for an overdamped one.');
  return first;
}

function safe(f) {
  try { return f(); } catch (e) { return { error: e.message }; }
}

/**
 * The paper's model has one gamma and one omega for the whole record. The record is cut at
 * its middle crest above the scatter (needs 4 such crests), and each value tested by the
 * extra sum of squares, the F test of nested nonlinear least-squares fits (Bates and
 * Watts 1988, whose profile intervals fit.js uses elsewhere): the two
 * parts fitted each with its own damped cosine, 10 values, against the two fitted with
 * that value in common, 9, F = (SSE9 - SSE10) / (SSE10 / (m - 10)) with 1 and m - 10
 * degrees of freedom, m the readings fitted, or z = ±F^1/2 against Student's t. It does
 * not lean on the standard errors of the two parts, which, where the later part holds
 * little of the oscillation, understate its scatter. Where the misfits of the whole record
 * correlate from one reading to the next, the comparison is made on the differences
 * v(i) - rho v(i - 1) of each part with the whole record's Cochrane and Orcutt rho
 * (fitDampedCosine): the scatter of one record is one process, and the whole record fixes
 * rho better than either part. A gamma that changes as the oscillation dies away is what
 * friction that grows with the speed of the water does (the paper's appendix, (50) to
 * (52)), or a response that is not the single damped cosine of (7). Returns null with
 * fewer than 4 crests, and { mid, error } where a fit of the parts fails, which leaves the
 * rest of the analysis as it is.
 */
export function splitFit(t, y, fit, crests) {
  if (crests.length < 4) return null;
  const mid = crests[Math.floor(crests.length / 2)];
  try {
    return compareParts(t, y, fit, mid);
  } catch (e) {
    return { mid, error: e.message };
  }
}

function compareParts(t, y, fit, mid) {
  const k = NAMES.length, rho = fit.serial ? fit.serial.rho : 0;
  const parts = [(x) => x <= mid, (x) => x > mid].map((keep) => {
    const idx = t.map((_, i) => i).filter((i) => keep(t[i]));
    if (idx.length <= k + 3) throw new Error(`Only ${idx.length} readings fall in one part, too few to fit the damped cosine to each part.`);
    const s = idx.map((i) => t[i] - t[idx[0]]), yy = idx.map((i) => y[i]);
    return { s, y: yy, target: whiten(yy, rho), t1: t[idx[0]] };
  });
  // The whole record's curve, in each part's own time origin, is where each fit starts.
  const [g, w, A, B, c] = NAMES.map((id) => fit.values[id]);
  const from = (p) => {
    const d = p.t1 - fit.t1, e = libm.exp(-g * d), co = libm.cos(w * d), si = libm.sin(w * d);
    return [g, w, e * (A * co + B * si), e * (B * co - A * si), c];
  };
  // Values v of the parts, as [early 5, late 5] or with index `shared` in common.
  const layout = (shared) => {
    const own = [0, 1, 2, 3, 4].filter((j) => j !== shared);
    const unpack = shared === null
      ? (v) => [v.slice(0, 5), v.slice(5)]
      : (v) => [0, 1].map((p) => { const x = new Array(5); x[shared] = v[0]; own.forEach((j, m) => { x[j] = v[1 + 4 * p + m]; }); return x; });
    const pack = shared === null
      ? ([a, b]) => [...a, ...b]
      : ([a, b]) => [(a[shared] + b[shared]) / 2, ...own.map((j) => a[j]), ...own.map((j) => b[j])];
    // Where each part's gamma and omega sit in v, to be kept above zero.
    const positive = shared === null ? [0, 1, 5, 6] : [0, ...[0, 1].flatMap((p) => own.filter((j) => j < 2).map((j) => 1 + 4 * p + own.indexOf(j)))];
    const column = shared === null
      ? (p, j) => 5 * p + j
      : (p, j) => (j === shared ? 0 : 1 + 4 * p + own.indexOf(j));
    return { unpack, pack, positive, column, size: shared === null ? 10 : 9 };
  };
  const target = [...parts[0].target, ...parts[1].target], m = target.length;
  const joint = (shared, start) => {
    const L = layout(shared);
    const misfits = (v) => {
      const x = L.unpack(v), f = parts.flatMap((p, q) => whiten(curve(p.s, x[q]), rho));
      return target.map((u, i) => u - f[i]);
    };
    const jac = (v) => {
      const x = L.unpack(v), cols = Array.from({ length: L.size }, () => new Float64Array(m));
      let at = 0;
      parts.forEach((p, q) => {
        const J = slopes(p.s, x[q]).map((col) => whiten(col, rho));
        J.forEach((col, j) => { const out = cols[L.column(q, j)]; for (let i = 0; i < col.length; i++) out[at + i] += col[i]; });
        at += J[0].length;
      });
      return cols;
    };
    const r = marquardt(L.pack(start), misfits, jac, L.positive);
    return { ...r, x: L.unpack(r.x) };
  };
  const free = joint(null, parts.map(from));
  const dof = m - 2 * k, s2 = free.e / dof, tLimit = tQuantile(0.975, dof);
  // Each part's values and standard errors, shown beside the test, from its own fit within
  // the joint one: the columns of the two parts do not overlap.
  const each = parts.map((p, q) => {
    const J = slopes(p.s, free.x[q]).map((col) => whiten(col, rho)), { inv } = invertSPD(normalMatrix(J), k);
    if (!inv) throw new Error('The readings of one part do not fix the damped cosine.');
    return { values: free.x[q], se: free.x[q].map((_, a) => Math.sqrt(inv[a * k + a] * s2)), n: p.s.length };
  });
  const compare = (id) => {
    const j = NAMES.indexOf(id), tied = joint(j, free.x);
    // The fit with a value in common cannot fit better than the one without; where a
    // search stops a little short, the gain is taken as none.
    const F = Math.max(0, tied.e - free.e) / s2;
    const a = each[0].values[j], b = each[1].values[j], z = Math.sign(a - b) * Math.sqrt(F);
    return { early: a, late: b, seEarly: each[0].se[j], seLate: each[1].se[j], F, z, differs: Math.abs(z) > tLimit, converged: tied.converged };
  };
  return { mid, nEarly: each[0].n, nLate: each[1].n, rho, dof, gamma: compare('gamma'), omega: compare('omega'), zLimit: tLimit, converged: free.converged };
}

/**
 * Tests of one well with different initial displacements. In the paper's model, as in
 * every linear one, gamma and omega do not depend on the initial displacement; the
 * normalized records of such tests should coincide (Butler and Garnett 2000, after Butler
 * et al. 1996). tests: [{ h0, gamma, seGamma, omega, seOmega }]. For gamma and for omega,
 * the weighted least-squares slope against |h0| (weights 1/SE², the SEs taken as known), its
 * standard error and z = slope / SE against the normal 97.5% point.
 */
export function compareTests(tests) {
  if (tests.length < 2) throw new Error('Comparing tests needs at least two.');
  const zLimit = normalQuantile(0.975);
  const slope = (id) => {
    const x = tests.map((r) => Math.abs(r.h0)), y = tests.map((r) => r[id]), w = tests.map((r) => 1 / libm.pow(r[`se${id[0].toUpperCase()}${id.slice(1)}`], 2));
    const W = w.reduce((a, b) => a + b, 0), xm = w.reduce((a, v, i) => a + v * x[i], 0) / W, ym = w.reduce((a, v, i) => a + v * y[i], 0) / W;
    const sxx = w.reduce((a, v, i) => a + v * (x[i] - xm) * (x[i] - xm), 0);
    if (!(sxx > 0)) throw new Error('The tests must have different initial displacements.');
    const b = w.reduce((a, v, i) => a + v * (x[i] - xm) * (y[i] - ym), 0) / sxx, se = 1 / Math.sqrt(sxx);
    return { slope: b, se, z: b / se, depends: Math.abs(b / se) > zLimit, mean: ym };
  };
  return { gamma: slope('gamma'), omega: slope('omega'), zLimit };
}
