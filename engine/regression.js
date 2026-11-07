// First-difference regression, the core of the Clark, BETCO and KGS BRF methods.
//
// Each regressor is a series in level space. The model is fitted to changes between
// steps, with an intercept for steady drift, so slow signals such as recharge,
// moisture loading and pumping trends are not absorbed:
//
//   h(t) - h(t-1) = a + sum_j c_j [x_j(t) - x_j(t-1)] + e(t)

import { isNum, solveSPD } from './numeric.js';

/**
 * h:       level series on the grid
 * columns: [{ name, series }]
 * include: optional (i) => boolean, limiting the steps used in the fit
 * drop:    optional (residual-based) row filter, for evaluation variants only
 */
export function fitDifferences(h, columns, include, drop) {
  const n = h.length, p = columns.length + 1;
  const series = columns.map((c) => c.series);
  const rows = [];
  for (let i = 1; i < n; i++) {
    if (!isNum(h[i]) || !isNum(h[i - 1]) || (include && !include(i))) continue;
    let ok = true;
    for (const s of series) if (!isNum(s[i]) || !isNum(s[i - 1])) { ok = false; break; }
    if (ok) rows.push(i);
  }
  const solve = (use) => {
    const A = new Float64Array(p * p), b = new Float64Array(p), x = new Float64Array(p);
    for (const i of use) {
      x[0] = 1;
      for (let k = 1; k < p; k++) x[k] = series[k - 1][i] - series[k - 1][i - 1];
      const y = h[i] - h[i - 1];
      for (let a = 0; a < p; a++) {
        b[a] += x[a] * y;
        for (let c = 0; c <= a; c++) A[a * p + c] += x[a] * x[c];
      }
    }
    for (let a = 0; a < p; a++) for (let c = a + 1; c < p; c++) A[a * p + c] = A[c * p + a];
    return solveSPD(A, b, p);
  };
  const residual = (beta, i) => {
    let e = h[i] - h[i - 1] - beta[0];
    for (let k = 1; k < p; k++) e -= beta[k] * (series[k - 1][i] - series[k - 1][i - 1]);
    return e;
  };
  if (rows.length < 3 * p) return { rows: rows.length, enough: false };
  let used = rows;
  let beta = solve(used);
  if (drop) {
    used = drop(rows, rows.map((i) => residual(beta, i)));
    beta = solve(used);
  }
  let sse = 0, sst = 0;
  for (const i of used) {
    const e = residual(beta, i), y = h[i] - h[i - 1];
    sse += e * e; sst += y * y;
  }
  return { enough: true, rows: used.length, intercept: beta[0], coef: beta.slice(1), sse, sst };
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
