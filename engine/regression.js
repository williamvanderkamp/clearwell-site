// First-difference regression, the core of the Clark, BETCO and KGS BRF methods.
//
// Each regressor is a series in level space. The model is fitted to changes between
// steps, with an intercept for steady drift, so slow signals such as recharge,
// moisture loading and pumping trends are not absorbed:
//
//   h(t) - h(t-1) = a + sum_j c_j [x_j(t) - x_j(t-1)] + e(t)

import { inverseColumnsSPD, isNum, solveSPD } from './numeric.js';

// Lag steps in `hours` on a grid `stepH` hours apart, and the lags 0 to m.
export const stepsIn = (hours, stepH) => Math.max(0, Math.round(hours / stepH));
export const lagList = (m) => Array.from({ length: m + 1 }, (_, k) => k);

/**
 * h:       level series on the grid
 * columns: [{ name, series }]
 * include: optional (i) => boolean, limiting the steps used in the fit
 * The result's covariance(covFor), for indexes into coef, gives their covariance
 * matrix, s^2 times those rows and columns of (X'X)^-1 with s^2 = SSE / (rows - p), as
 * ordinary least squares gives it (Draper and Smith 1998, ch. 5), and the lag-1
 * correlation of the residuals of consecutive steps, which says how far the
 * independence it assumes holds.
 */
export function fitDifferences(h, columns, include) {
  const n = h.length, p = columns.length + 1;
  const series = columns.map((c) => c.series);
  const rows = [];
  for (let i = 1; i < n; i++) {
    if (!isNum(h[i]) || !isNum(h[i - 1]) || (include && !include(i))) continue;
    let ok = true;
    for (const s of series) if (!isNum(s[i]) || !isNum(s[i - 1])) { ok = false; break; }
    if (ok) rows.push(i);
  }
  if (rows.length < 3 * p) return { rows: rows.length, enough: false };
  // X'X and X'y. A change of exactly 0, as an amount has on every dry step, adds ±0 to
  // each sum it is in. That leaves the sum as it was, since a sum that starts at +0 is
  // never -0, so a row is summed over its other changes alone. nz lists them, 0 first.
  const A = new Float64Array(p * p), b = new Float64Array(p), x = new Float64Array(p), nz = new Int32Array(p);
  for (const i of rows) {
    x[0] = 1;
    let m = 1;
    for (let k = 1; k < p; k++) {
      x[k] = series[k - 1][i] - series[k - 1][i - 1];
      if (x[k] !== 0) nz[m++] = k;
    }
    const y = h[i] - h[i - 1];
    if (m === p) {
      for (let a = 0; a < p; a++) {
        b[a] += x[a] * y;
        for (let c = 0; c <= a; c++) A[a * p + c] += x[a] * x[c];
      }
      continue;
    }
    for (let u = 0; u < m; u++) {
      const a = nz[u];
      b[a] += x[a] * y;
      for (let v = 0; v <= u; v++) A[a * p + nz[v]] += x[a] * x[nz[v]];
    }
  }
  for (let a = 0; a < p; a++) for (let c = a + 1; c < p; c++) A[a * p + c] = A[c * p + a];
  const beta = solveSPD(A, b, p);
  const residual = (i) => {
    let e = h[i] - h[i - 1] - beta[0];
    for (let k = 1; k < p; k++) e -= beta[k] * (series[k - 1][i] - series[k - 1][i - 1]);
    return e;
  };
  let sse = 0, sst = 0;
  for (const i of rows) {
    const e = residual(i), y = h[i] - h[i - 1];
    sse += e * e; sst += y * y;
  }
  const covariance = (covFor) => {
    const s2 = sse / (rows.length - p);
    const inv = inverseColumnsSPD(A, p, covFor.map((k) => k + 1));
    let lag1 = 0, sq = 0;
    const e = new Map(rows.map((i) => [i, residual(i)]));
    for (const [i, v] of e) { sq += v * v; if (e.has(i - 1)) lag1 += v * e.get(i - 1); }
    return { cov: inv.map((col) => covFor.map((k) => s2 * col[k + 1])), dof: rows.length - p, residualLag1: lag1 / sq };
  };
  return { enough: true, rows: rows.length, used: rows, intercept: beta[0], coef: beta.slice(1), sse, sst, covariance };
}

// Sum of fitted columns in level space. Blank where any column is blank.
export function effectOf(columns, coef) {
  const n = columns.length ? columns[0].series.length : 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < columns.length; k++) {
      const v = columns[k].series[i];
      if (!isNum(v)) { ok = false; break; }
      s += coef[k] * v;
    }
    out[i] = ok ? s : NaN;
  }
  return out;
}

// One column per lag: the barometer delayed by k steps.
export function lagColumns(b, lags) {
  return lags.map((k) => {
    const s = new Float64Array(b.length).fill(NaN);
    for (let i = k; i < b.length; i++) s[i] = b[i - k];
    return { name: `lag${k}`, series: s };
  });
}
