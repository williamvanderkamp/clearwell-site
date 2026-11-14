// Small numeric helpers shared by the engine.
import * as libm from './libm.js';

export const HOUR = 3600000;
export const DAY = 24 * HOUR;

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// The Euler-Mascheroni constant.
export const EULER = 0.5772156649015329;

// erf x = (2/sqrt pi) e^(-x^2) sum of 2^k x^(2k+1) / (1 3 5 ... (2k+1)), whose terms are
// all positive; used below 3.
function erfSeries(x) {
  let term = x, total = x;
  for (let k = 1; k < 200 && term > 1e-17 * total; k++) { term *= (2 * x * x) / (2 * k + 1); total += term; }
  return (2 / Math.sqrt(Math.PI)) * libm.exp(-x * x) * total;
}
// erfc x = e^(-x^2) / sqrt(pi) / (x + (1/2) / (x + 1 / (x + (3/2) / (x + ...)))), by Lentz;
// used from 3 up.
function erfcFraction(x) {
  let f = x, C = x, D = 0;
  for (let k = 1; k < 300; k++) {
    const a = k / 2;
    D = 1 / (x + a * D);
    C = x + a / C;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return libm.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

/** erf(x), from its series below 3 and 1 - erfc above (Abramowitz and Stegun 1964, ch. 7). */
export function erf(x) {
  if (x < 0) return -erf(-x);
  return x < 3 ? erfSeries(x) : 1 - erfcFraction(x);
}

/** erfc(x), from 1 - erf below 3 and its continued fraction above, good to about 1e-15. */
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  return x < 3 ? 1 - erfSeries(x) : erfcFraction(x);
}

// Eight point Gauss-Legendre rule on [-1, 1]: the four positive nodes and their weights.
export const GL_X = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
export const GL_W = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

const SQRT_2PI_LOG = 0.5 * libm.log(2 * Math.PI);

/** ln Gamma(z) for z > 0: Stirling's series past z = 15, reached by Gamma(z+1) = z Gamma(z). */
export function lnGamma(z) {
  let shift = 0;
  while (z < 15) { shift += libm.log(z); z += 1; }
  const w = 1 / (z * z);
  // Bernoulli terms B2k / (2k (2k-1) z^(2k-1)); the next is about 1e-14 at z = 15.
  const series = (1 / z) * (1 / 12 - w * (1 / 360 - w * (1 / 1260 - w * (1 / 1680 - w / 1188))));
  return (z - 0.5) * libm.log(z) - z + SQRT_2PI_LOG + series - shift;
}

/** The area of a unit sphere in n dimensions, 2 pi^(n/2) / Gamma(n/2) (Barker 1988, equation 1). */
export const unitSphereArea = (n) => 2 * libm.exp((n / 2) * libm.log(Math.PI) - lnGamma(n / 2));

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

/**
 * Ordinary least squares, y = slope x + intercept. slope is NaN when every x is the same.
 * sxx is the sum of squares of x about its mean.
 */
export function fitLine(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) * (x[i] - mx); sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) * (y[i] - my); }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  return { slope, intercept: my - slope * mx, rss: Math.max(0, syy - slope * sxy), rows: n, sxx };
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
  return Array.from({ length: n }, (_, i) => first * libm.pow(last / first, i / (n - 1)));
}

// Changes over `lag` steps. Pairs with a blank on either side are skipped.
export function diffs(a, lag = 1) {
  const out = [];
  for (let i = lag; i < a.length; i++) if (isNum(a[i]) && isNum(a[i - lag])) out.push(a[i] - a[i - lag]);
  return out;
}

// The Cholesky factor of a flat symmetric p x p matrix. Rows are scaled to unit
// diagonal first, so regressors in different units share one tiny ridge, which only
// matters when two columns are almost identical.
function choleskyScaled(A, p) {
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
  return { L, scale, p };
}

// Solves A x = b from the factor of A, by forward and back substitution.
function choleskySolve({ L, scale, p }, b) {
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

// Solves A x = b for a flat symmetric p x p matrix, by Cholesky.
export const solveSPD = (A, b, p) => choleskySolve(choleskyScaled(A, p), b);

/** Columns `cols` of the inverse of a flat symmetric p x p matrix, from one factor. */
export function inverseColumnsSPD(A, p, cols) {
  const f = choleskyScaled(A, p);
  return cols.map((j) => {
    const e = new Float64Array(p);
    e[j] = 1;
    return choleskySolve(f, e);
  });
}
