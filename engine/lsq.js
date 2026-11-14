// Nonlinear least squares for the pumping test solutions in src/engine/solutions/, by the
// Levenberg (1944) and Marquardt (1963) method, with the statistics a hydrogeologist
// reports beside each fitted value: its standard error, a 95% interval from the t
// distribution (linearized in leastSquares, from the profile of the misfit in
// fitSolution: profileIntervals), and the correlation between the fitted values.
//
// Every value is fitted on the log of itself, so it stays above zero, except skin, which
// may be negative and is fitted as it is. The Jacobian is taken by finite differences, so
// a solution needs only its drawdown() function. Metres and days throughout.
import { isNum } from './numeric.js';
import { tQuantile } from './tdist.js';
import { covarianceFactor, invertSPD } from './linalg.js';
import { runsCalibrated } from './runs.js';
import * as libm from './libm.js';

// In a refit along a profile, how many times its first reach a value's step may grow to
// (leastSquares, predicted).
const REACH_GROWTH = 16;

// Solves (A + lambda diag A) x = g, the Marquardt step, by the same Cholesky.
function marquardtStep(A, g, k, lambda) {
  const D = A.slice();
  for (let i = 0; i < k; i++) D[i * k + i] = A[i * k + i] * (1 + lambda) + 1e-300;
  const { inv } = invertSPD(D, k);
  if (!inv) return null;
  return Array.from({ length: k }, (_, i) => g.reduce((sum, v, j) => sum + inv[i * k + j] * v, 0));
}

// ---------------------------------------------------------------------------------------
// The fit itself.

/** Is this kind of value fitted on a log scale? All are except skin. */
export const logScale = (kind) => kind !== 'skin';
export const toFit = (kind, v) => (logScale(kind) ? libm.log(v) : v);
export const fromFit = (kind, x) => (logScale(kind) ? libm.exp(x) : x);

const STORAGE = ['S', 'Sy'];

/** Is v inside the limits the solution states for value p, and below 1 for a storage? */
export const withinBounds = (p, v) => (!isNum(p.min) || v >= p.min) && (!isNum(p.max) || v <= p.max) && (!STORAGE.includes(p.kind) || v < 1);

// A value is reported as not determined when its 95% interval spans more than a factor
// of WIDE (three orders of magnitude), or for skin, which is fitted as it is, when the
// interval is wider than plus or minus WIDE_SKIN: either way it says nothing useful.
export const WIDE = 1000;
export const WIDE_SKIN = 10;

// Bounds on the fit scale, [lo, hi], where the published method gives them. Storativity
// and specific yield are volumes of water per unit volume of aquifer per metre of head, so
// neither can exceed 1, whatever the solution says.
export function fitBounds(p) {
  const lo = isNum(p.min) ? toFit(p.kind, logScale(p.kind) ? Math.max(p.min, 1e-300) : p.min) : -Infinity;
  const cap = STORAGE.includes(p.kind) ? 1 : Infinity;
  return [lo, toFit(p.kind, isNum(p.max) ? Math.min(p.max, cap) : cap)];
}

export const sumSq = (r) => { let e = 0; for (const v of r) e += v * v; return Number.isFinite(e) ? e : Infinity; };

/**
 * Least squares fit of model(values) to y.
 *   params: [{ id, kind, min?, max? }]: what model() takes, in order.
 *   start:  { id: value } for every parameter, where the search begins.
 *   fixed:  { id: true } for those held at their start value.
 *   model:  (values) => predicted y, one per observation.
 *   counts: optional, the number of readings averaged into each y. Each y is then a mean,
 *           with variance sigma^2 / count, and the statistics allow for it (below).
 *   pure:   optional, { ss, df }: the readings' scatter inside the averaging widths
 *           (binReadings), pooled into sigma^2 with the residuals.
 *   stop:   optional, () => true to end the search early (a time limit). It is asked
 *           before every call of model() during the search.
 *   statistics: false to skip the standard errors (a search whose end is only compared).
 *   differences: 'central' (the default) or 'forward', for the slopes of the statistics:
 *           forward needs k + 1 calls of model() in place of 4k + 1.
 *   runs:   true to add misfit, the runs test calibrated for this fit (runsCalibrated).
 *   tolerance: the search has settled when a step lowers the sum of squares by less than
 *           this share of it (1e-12; a profile needs less, profileIntervals).
 *   predicted: true for steps kept whole in direction (shortened as one, values held at a
 *           bound they would cross), damped rather than cut at the factor-of-10 cap, and
 *           settling when the straight-line model of the curve promises less than the
 *           tolerance for the next step, without trying it (profileIntervals, where each
 *           try is a call of a slow solution).
 *   broyden: with predicted, true to update the slopes from each try (Broyden 1965) in
 *           place of working them out afresh at each step; the refit settles only on
 *           fresh slopes.
 *   jacobian: with broyden, the slopes to start from, one array for each free value (the
 *           J a refit returned, or a statistics result's J without the value held).
 * Returns the fitted values and, for the free ones, the standard error and 95% interval
 * from the t distribution with n - k degrees of freedom, using the residual variance and
 * (J'J)^-1, mapped back from the log scale; and their correlation matrix. A value whose
 * interval says nothing has undetermined set: 'singular' (some combination of it with
 * other values leaves the computed drawdown unchanged: covarianceFactor), 'limit' (it
 * ended at a bound) or 'wide' (see WIDE). Only the values such a combination touches are
 * 'singular'; the others keep their statistics. An interval that runs past a bound, such
 * as S above 1, is cut at the bound, with clipped set. Each free value also has seFit,
 * its standard error on the fit scale, and edgeRise, the rise in the sum of squares at
 * the ends of its interval along its profile (t² σ² for equal weights), with which
 * another end of the search is compared (fitSolution).
 */
export function leastSquares({ params, start, fixed = {}, model, y, maxIterations = 100, counts = null, pure = null, stop = null, statistics = true, differences = 'central', runs = false, tolerance = 1e-12, predicted = false, broyden = false, jacobian: jacobianStart = null }) {
  const n = y.length;
  const free = params.filter((p) => !fixed[p.id]);
  const k = free.length;
  for (const p of params) {
    const v = start[p.id];
    if (!isNum(v) || (logScale(p.kind) && !(v > 0))) throw new Error(`The starting value of ${p.id} must be a number${logScale(p.kind) ? ' above zero' : ''}.`);
  }
  const lo = free.map((p) => fitBounds(p)[0]), hi = free.map((p) => fitBounds(p)[1]);
  const clamp = (x) => x.map((v, j) => Math.min(hi[j], Math.max(lo[j], v)));
  const values = (x) => {
    const out = {};
    for (const p of params) out[p.id] = start[p.id];
    free.forEach((p, j) => { out[p.id] = fromFit(p.kind, x[j]); });
    return out;
  };
  // During the search every call of the model first asks stop().
  let searching = false;
  const STOP = {};
  const call = (x) => {
    if (searching && stop && stop()) throw STOP;
    return model(values(x));
  };
  const evaluate = (x) => {
    const f = call(x);
    const r = y.map((v, i) => v - f[i]);
    return { x, f, r, e: sumSq(r) };
  };
  // A drawdown from a Laplace inversion carries a scatter of about 1e-6 of itself (the
  // Stehfest sum magnifies rounding), so the steps are large beside that: 1e-3 of the value.
  // The search uses forward differences. The statistics use central differences at h and
  // h/2, combined by Richardson extrapolation, which is exact to h^4 on a smooth curve.
  const H = 1e-3;
  const shifted = (cur, j, d) => { const x = cur.x.slice(); x[j] += d; return call(x); };
  // At a bound, the differences are taken on the inside only: a solution may refuse a
  // value past its limit, such as a skin below zero. One-sided, the statistics use the
  // three-point rule (-3 f0 + 4 f(h) - f(2h)) / 2h, also exact to h^2.
  const jacobian = (cur, central) => free.map((p, j) => {
    const h = logScale(p.kind) ? H : H * Math.max(1, Math.abs(cur.x[j]));
    const up = cur.x[j] + 2 * h <= hi[j], down = cur.x[j] - 2 * h >= lo[j];
    const side = up ? 1 : -1;
    if (!central) return shifted(cur, j, side * h).map((v, i) => (v - cur.f[i]) / (side * h));
    if (!(up && down)) {
      const a = shifted(cur, j, side * h), b = shifted(cur, j, 2 * side * h);
      return a.map((v, i) => (-3 * cur.f[i] + 4 * v - b[i]) / (2 * side * h));
    }
    const d = (step) => { const u = shifted(cur, j, step), w = shifted(cur, j, -step); return u.map((v, i) => (v - w[i]) / (2 * step)); };
    const big = d(2 * h), small = d(h);
    return small.map((v, i) => (4 * v - big[i]) / 3);
  });
  const normal = (J, r) => {
    const A = new Float64Array(k * k), g = new Array(k).fill(0);
    for (let a = 0; a < k; a++) {
      for (let b = 0; b <= a; b++) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += J[a][i] * J[b][i];
        A[a * k + b] = sum; A[b * k + a] = sum;
      }
      for (let i = 0; i < n; i++) g[a] += J[a][i] * r[i];
    }
    return { A, g };
  };

  let cur = evaluate(clamp(free.map((p) => toFit(p.kind, start[p.id]))));
  if (!Number.isFinite(cur.e)) throw new Error('The solution gave no drawdown at the starting values. Try other starting values.');
  let lambda = 1e-3, iterations = 0, converged = k === 0, stopped = false, lastJ = null;
  searching = true;
  try {
  if (predicted) {
    // A refit along a profile (profileIntervals), where each try is a call of a slow
    // solution. Three changes from the search below:
    // - The step is kept whole in direction: values at a bound that it would push past
    //   are held there, and it is shortened as one to the nearest bound. Then the fall
    //   that the straight-line model of the curve promises, 2 g'd - d'Ad, only shrinks as
    //   lambda grows, and below the tolerance no step can gain enough to be worth a call.
    // - A step past a value's reach is damped, lambda raised until it fits, as a trust
    //   region (More 1978), not cut: cutting it would shrink the steps the readings fix
    //   along with a long one in a direction they barely fix. Each value's reach starts at
    //   the search's factor of 10 (or 10 in skin), and doubles, up to REACH_GROWTH times,
    //   while steps that use it fall as the straight-line model promised; a step that
    //   falls by less than a quarter of that halves it again.
    // - With broyden, the slopes are not worked out again by finite differences at each
    //   step, but updated by Broyden's (1965) rank-one formula from each try, J += (df -
    //   J h) h' / h'h, starting from jacobian when given. Before the refit is taken as
    //   settled, they are worked out afresh, and it settles only on fresh slopes.
    let J = broyden && Array.isArray(jacobianStart) && jacobianStart.length === k ? jacobianStart.map((c) => Float64Array.from(c)) : jacobian(cur, false);
    let fresh = !(broyden && Array.isArray(jacobianStart) && jacobianStart.length === k), missed = 0;
    const reach = free.map((p) => (logScale(p.kind) ? Math.LN10 : 10)), grown = free.map(() => 1);
    const update = (from, to) => {
      const h = to.x.map((v, j) => v - from.x[j]), hh = h.reduce((sum, v) => sum + v * v, 0);
      if (!(hh > 0)) return;
      for (let i = 0; i < n; i++) {
        let u = to.f[i] - from.f[i];
        for (let a = 0; a < k; a++) u -= J[a][i] * h[a];
        for (let a = 0; a < k; a++) if (h[a]) J[a][i] += (u * h[a]) / hh;
      }
      fresh = false;
    };
    for (; iterations < maxIterations && !converged; iterations++) {
      lastJ = J;
      const { A, g } = normal(J, cur.r);
      let moved = false, tried = false;
      const onFresh = fresh;
      while (lambda < 1e12) {
        const held = new Set();
        let d = null;
        for (let pass = 0; pass <= k && !d; pass++) {
          const Ar = A.slice(), gr = g.slice();
          for (const j of held) { for (let m = 0; m < k; m++) { Ar[j * k + m] = 0; Ar[m * k + j] = 0; } Ar[j * k + j] = 1; gr[j] = 0; }
          const st = marquardtStep(Ar, gr, k, lambda);
          if (!st) break;
          const out = st.map((v, j) => !held.has(j) && ((v < 0 && cur.x[j] <= lo[j]) || (v > 0 && cur.x[j] >= hi[j])));
          if (out.some(Boolean)) out.forEach((o, j) => { if (o) held.add(j); });
          else d = st.map((v, j) => (held.has(j) ? 0 : v));
        }
        if (!d) break;
        if (d.some((v, j) => Math.abs(v) > reach[j] * grown[j])) { lambda *= 4; continue; }
        let c = 1;
        d.forEach((v, j) => { const room = v > 0 ? hi[j] - cur.x[j] : cur.x[j] - lo[j]; if (Math.abs(v) > 0) c = Math.min(c, room / Math.abs(v)); });
        d = d.map((v) => v * c);
        let fall = 0;
        for (let a = 0; a < k; a++) { let ad = 0; for (let b = 0; b < k; b++) ad += A[a * k + b] * d[b]; fall += d[a] * (2 * g[a] - ad); }
        if (!(fall >= tolerance * cur.e)) break;
        const step = d;
        const next = evaluate(clamp(cur.x.map((v, j) => v + step[j])));
        tried = true;
        const rho = (cur.e - next.e) / fall;
        if (rho > 0.75) step.forEach((v, j) => { if (Math.abs(v) > 0.25 * reach[j] * grown[j]) grown[j] = Math.min(REACH_GROWTH, grown[j] * 2); });
        else if (rho < 0.25) grown.forEach((v, j) => { grown[j] = Math.max(1, v / 2); });
        const from = cur;
        if (next.e < cur.e) {
          const gain = (cur.e - next.e) / cur.e;
          cur = next; lambda = Math.max(lambda / 3, 1e-12); moved = true; missed = 0;
          if (gain < tolerance) converged = true;
        } else { lambda *= 4; missed++; }
        if (broyden) update(from, next);
        // With updated slopes the normal equations are formed again; without, a step
        // that does not lower the misfit is tried again with a larger lambda.
        if (moved || broyden) break;
      }
      if (!broyden) {
        // Fresh slopes at each step, as in the search.
        if (!moved) converged = true;
        else if (!converged) J = jacobian(cur, false);
        continue;
      }
      // A step from fresh slopes that gained less than the tolerance has settled, as in
      // the search.
      if (moved && (!converged || onFresh)) continue;
      // A try that did not lower the misfit is tried again with the updated slopes.
      if (!moved && tried && missed < 2) continue;
      // Settled, or no step worth a call: on fresh slopes that is the minimum, to the
      // precision of the drawdown; on updated ones, the slopes are worked out afresh
      // first. So are they after two tries in a row that did not lower the misfit.
      if (fresh) { converged = true; continue; }
      J = jacobian(cur, false); fresh = true; converged = false; missed = 0;
    }
    lastJ = J;
  } else {
  for (; iterations < maxIterations && !converged; iterations++) {
    const J = jacobian(cur, false);
    lastJ = J;
    const { A, g } = normal(J, cur.r);
    let moved = false;
    while (lambda < 1e12) {
      const step = marquardtStep(A, g, k, lambda);
      // No step moves a value more than a factor of 10 (or skin by 10): far from the
      // minimum a Gauss-Newton step can leap many decades onto a flat, slow part of a curve.
      const capped = step && step.map((v, j) => { const m = logScale(free[j].kind) ? Math.LN10 : 10; return Math.max(-m, Math.min(m, v)); });
      const next = capped ? evaluate(clamp(cur.x.map((v, j) => v + capped[j]))) : null;
      if (next && next.e < cur.e) {
        const gain = (cur.e - next.e) / cur.e, size = Math.max(...next.x.map((v, j) => Math.abs(v - cur.x[j])));
        cur = next; lambda = Math.max(lambda / 3, 1e-12); moved = true;
        if (gain < tolerance || size < 1e-10) converged = true;
        break;
      }
      lambda *= 4;
    }
    // No step lowers the misfit: this is the minimum, to the precision of the drawdown.
    if (!moved) converged = true;
  }
  }
  } catch (e) {
    if (e !== STOP) throw e;
    stopped = true;
  }
  searching = false;
  if (!statistics) {
    // The last slopes, at the end or one step before it, for a runs test of the end.
    return { values: values(cur.x), sse: cur.e, rms: Math.sqrt(cur.e / n), n, iterations, converged, stopped, fittedY: cur.f, residuals: cur.r, J: lastJ };
  }

  // Statistics at the minimum, from a central difference Jacobian.
  // With counts, y_i is the mean of n_i readings, each with variance sigma^2. The fit gives
  // every mean the same weight (so a logger's thousands of late readings do not outvote
  // the first minutes), and the covariance is then the sandwich
  //   (J'J)^-1 (J' diag(1/n_i) J) (J'J)^-1 sigma^2,
  // with sigma^2 = sum n_i r_i^2 / E, where E is that sum's expected value over sigma^2
  // for a model linear near the minimum: with H = J (J'J)^-1 J', the hat matrix of the fit
  // and N = diag(n_i), E = tr(N (I - H) N^-1 (I - H)) = n - 2k + sum_ij (n_i / n_j) H_ij^2,
  // and the readings' scatter inside the widths (pure) pooled in.
  // With every n_i = 1, E = n - k and this is (J'J)^-1 SSE / (n - k).
  const df = n - k, sse = cur.e;
  const weighted = Array.isArray(counts) && counts.length === n && counts.some((c) => c !== 1);
  const J = k ? jacobian(cur, differences !== 'forward') : [];
  const { A } = normal(J, cur.r);
  // (J'J)^-1, or where it has none, the pseudo-inverse over what the readings fix.
  const { inv, weak, rank, nulls } = k ? covarianceFactor(A, k) : { inv: new Float64Array(0), weak: [], rank: 0, nulls: [] };
  const weakSet = new Set(weak);
  let variance = df > 0 ? sse / df : NaN;
  if (weighted && df > 0) {
    let expected = n - 2 * rank;
    {
      // Row i of J (J'J)^-1, then H_ij = (J inv)_i . J_j.
      const P = Array.from({ length: n }, (_, i) => Array.from({ length: k }, (__, a) => { let sum = 0; for (let b = 0; b < k; b++) sum += J[b][i] * inv[b * k + a]; return sum; }));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let h = 0;
        for (let a = 0; a < k; a++) h += P[i][a] * J[a][j];
        expected += (counts[i] / counts[j]) * h * h;
      }
    }
    // The scatter inside the widths adds its own sum of squares and degrees of freedom.
    // Without it, a logger's few widths of a thousand readings each set sigma alone, and
    // it then rose and fell with the fit's own error, so the intervals held the truth in
    // 99% of runs, not 95%.
    const ss = pure && pure.df > 0 ? pure.ss : 0, dfPure = pure && pure.df > 0 ? pure.df : 0;
    variance = (cur.r.reduce((sum, v, i) => sum + counts[i] * v * v, 0) + ss) / Math.max(expected + dfPure, 1);
  }
  let cov = inv;
  if (weighted && k) {
    const M = new Float64Array(k * k);
    for (let a = 0; a < k; a++) for (let b = 0; b <= a; b++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += J[a][i] * J[b][i] / counts[i];
      M[a * k + b] = sum; M[b * k + a] = sum;
    }
    const mul = (X, Y) => { const Z = new Float64Array(k * k); for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { let sum = 0; for (let m = 0; m < k; m++) sum += X[a * k + m] * Y[m * k + b]; Z[a * k + b] = sum; } return Z; };
    cov = mul(mul(inv, M), inv);
  }
  const tq = df > 0 ? tQuantile(0.975, df) : NaN;
  const fitted = values(cur.x);
  const result = {};
  params.forEach((p) => {
    const j = free.indexOf(p);
    const v = fitted[p.id];
    if (j < 0) { result[p.id] = { value: v, fixed: true }; return; }
    const seFit = !weakSet.has(j) && df > 0 ? Math.sqrt(Math.max(0, variance * cov[j * k + j])) : NaN;
    const atLimit = Math.abs(cur.x[j] - lo[j]) < 1e-9 || Math.abs(cur.x[j] - hi[j]) < 1e-9;
    const x = cur.x[j];
    const r = logScale(p.kind)
      // The delta method gives the standard error in the value's own units; the interval
      // is symmetric on the log scale, so it never reaches zero.
      ? { value: v, se: v * seFit, seLog: seFit, lower: libm.exp(x - tq * seFit), upper: libm.exp(x + tq * seFit), atLimit }
      : { value: v, se: seFit, lower: v - tq * seFit, upper: v + tq * seFit, atLimit };
    // On the fit scale the interval is x +- t SE; it must stay inside the bounds there.
    const half = tq * seFit;
    r.seFit = seFit;
    r.edgeRise = Number.isFinite(half) && inv[j * k + j] > 0 ? (half * half) / inv[j * k + j] : NaN;
    r.undetermined = weakSet.has(j) || !Number.isFinite(half) ? 'singular'
      : atLimit ? 'limit'
        : (logScale(p.kind) ? 2 * half > libm.log(WIDE) : half > WIDE_SKIN) ? 'wide' : null;
    // An interval that runs past a bound, such as S above 1 or a skin below 0, is cut
    // there: no value outside the bound is possible.
    if (!r.undetermined && x - half < lo[j]) { r.lower = fromFit(p.kind, lo[j]); r.clipped = 'lower'; }
    if (!r.undetermined && x + half > hi[j]) { r.upper = fromFit(p.kind, hi[j]); r.clipped = 'upper'; }
    result[p.id] = r;
  });
  const corr = free.map((_, a) => free.map((__, b) => (weakSet.has(a) || weakSet.has(b) ? NaN : cov[a * k + b] / Math.sqrt(cov[a * k + a] * cov[b * k + b]))));
  return {
    values: fitted, params: result, free: free.map((p) => p.id), corr, weak: weak.map((j) => free[j].id),
    // Each combination that leaves the drawdown unchanged: { id: share on the fit scale }.
    nulls: nulls.map((u) => Object.fromEntries(Object.entries(u).map(([j, x]) => [free[j].id, x]))),
    sse, rms: Math.sqrt(sse / n), n, df, t975: tq, variance, iterations, converged, stopped, fittedY: cur.f, residuals: cur.r,
    // (J'J)^-1 on the fit scale, k x k over the free values, flat: how the others follow a
    // value held away from the best fit, to first order (profileIntervals).
    factor: Array.from(inv),
    // The slopes at the best fit, d(predicted y)/d(value on the fit scale), one array for
    // each free value: where the refits along a profile begin (profileIntervals).
    J: J.map((c) => Array.from(c)),
    ...(runs ? { misfit: runsCalibrated(cur.r, J, inv, weighted ? counts : null) } : {}),
  };
}
