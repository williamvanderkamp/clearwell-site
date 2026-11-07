// Small numeric helpers shared by the engine.

export const HOUR = 3600000;
export const DAY = 24 * HOUR;

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// The Euler-Mascheroni constant.
export const EULER = 0.5772156649015329;

export function median(arr) {
  const a = Array.from(arr).filter(isNum).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Median absolute deviation, scaled to match a standard deviation.
export function mad(a) {
  const m = median(a);
  return 1.4826 * median(Array.from(a, (x) => Math.abs(x - m)));
}

export function mean(a) {
  let s = 0, n = 0;
  for (const x of a) if (isNum(x)) { s += x; n++; }
  return n ? s / n : NaN;
}

export function rms(a) {
  let s = 0, n = 0;
  for (const x of a) if (isNum(x)) { s += x * x; n++; }
  return n ? Math.sqrt(s / n) : NaN;
}

/** Ordinary least squares, y = slope x + intercept. slope is NaN when every x is the same. */
export function fitLine(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  return { slope, intercept: my - slope * mx, rss: Math.max(0, syy - slope * sxy), rows: n };
}

/** Where f is least between lo and hi, by golden-section search. f must have one minimum there. */
export function goldenMin(f, lo, hi, iterations) {
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < iterations; i++) {
    const x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
    if (f(x1) < f(x2)) hi = x2; else lo = x1;
  }
  return (lo + hi) / 2;
}

/** n times spaced evenly in log time, from first to last. */
export function logTimes(first, last, n) {
  return Array.from({ length: n }, (_, i) => first * (last / first) ** (i / (n - 1)));
}

// Changes over `lag` steps. Pairs with a blank on either side are skipped.
export function diffs(a, lag = 1) {
  const out = [];
  for (let i = lag; i < a.length; i++) if (isNum(a[i]) && isNum(a[i - lag])) out.push(a[i] - a[i - lag]);
  return out;
}

// Solves A x = b for a flat symmetric p x p matrix, by Cholesky. Rows are scaled
// to unit diagonal first, so regressors in different units share one tiny ridge,
// which only matters when two columns are almost identical.
export function solveSPD(A, b, p) {
  const scale = new Float64Array(p);
  for (let i = 0; i < p; i++) scale[i] = Math.sqrt(A[i * p + i]) || 1;
  const L = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) L[i * p + j] = A[i * p + j] / (scale[i] * scale[j]);
    L[i * p + i] += 1e-10;
  }
  for (let j = 0; j < p; j++) {
    let d = L[j * p + j];
    for (let k = 0; k < j; k++) d -= L[j * p + k] * L[j * p + k];
    d = Math.sqrt(Math.max(d, 1e-300));
    L[j * p + j] = d;
    for (let i = j + 1; i < p; i++) {
      let s = L[i * p + j];
      for (let k = 0; k < j; k++) s -= L[i * p + k] * L[j * p + k];
      L[i * p + j] = s / d;
    }
  }
  const x = new Array(p);
  for (let i = 0; i < p; i++) x[i] = b[i] / scale[i];
  for (let i = 0; i < p; i++) {
    let s = x[i];
    for (let k = 0; k < i; k++) s -= L[i * p + k] * x[k];
    x[i] = s / L[i * p + i];
  }
  for (let i = p - 1; i >= 0; i--) {
    let s = x[i];
    for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k];
    x[i] = s / L[i * p + i];
  }
  return x.map((v, i) => v / scale[i]);
}
