// Trend tests used in groundwater monitoring: the Mann-Kendall test (Mann 1945,
// Kendall 1975), Sen's (1968) slope with the confidence interval in Gilbert (1987,
// ch. 16), and the seasonal Mann-Kendall test (Hirsch, Slack and Smith 1982).
// The steps follow USEPA (2009) Unified Guidance sections 14.3.4, 17.3.2 and 17.3.3.

import { erfc } from './numeric.js';
import * as libm from './libm.js';

export const EXACT_MAX_N = 10;
export const MAX_VALUES = 3000;
export const MIN_SEASON_VALUES = 3;

const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Sizes of the groups of equal values, groups of one left out. */
export function tieGroups(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.values()].filter((c) => c > 1);
}

const sum = (groups, f) => groups.reduce((a, t) => a + f(t), 0);

/** S = sum over pairs of sgn(t_j - t_i) sgn(x_j - x_i). With distinct times this is Mann's S. */
export function mannKendallS(t, x) {
  let S = 0;
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) S += sgn(t[j] - t[i]) * sgn(x[j] - x[i]);
  }
  return S;
}

/**
 * Variance of S under no trend, corrected for ties (Kendall 1975, ch. 4). With no
 * tied times it is the square of USEPA (2009) eq. 17.27.
 */
export function varianceS(t, x) {
  const n = x.length, u = tieGroups(x), v = tieGroups(t);
  const base = (n * (n - 1) * (2 * n + 5) - sum(u, (k) => k * (k - 1) * (2 * k + 5)) - sum(v, (k) => k * (k - 1) * (2 * k + 5))) / 18;
  if (!v.length || !u.length) return base;
  return base
    + (sum(v, (k) => k * (k - 1) * (k - 2)) * sum(u, (k) => k * (k - 1) * (k - 2))) / (9 * n * (n - 1) * (n - 2))
    + (sum(v, (k) => k * (k - 1)) * sum(u, (k) => k * (k - 1))) / (2 * n * (n - 1));
}

/**
 * Exact null distribution of S for n values with no ties: S = N - 2k, where k is the
 * number of inversions of a random order. Returns P(S >= s) as a function of s.
 */
export function exactUpper(n) {
  let counts = [1];
  for (let m = 2; m <= n; m++) {
    const next = new Array(counts.length + m - 1).fill(0);
    counts.forEach((c, k) => { for (let j = 0; j < m; j++) next[k + j] += c; });
    counts = next;
  }
  const total = counts.reduce((a, b) => a + b, 0), N = (n * (n - 1)) / 2;
  return (s) => {
    let p = 0;
    counts.forEach((c, k) => { if (N - 2 * k >= s) p += c; });
    return p / total;
  };
}

/** p-value for the chosen alternative: 'two', 'up' or 'down'. */
function pValue({ S, Z, exact }, direction) {
  if (exact) {
    if (direction === 'up') return exact(S);
    if (direction === 'down') return exact(-S);
    return Math.min(1, 2 * exact(Math.abs(S)));
  }
  if (direction === 'up') return normalUpper(Z);
  if (direction === 'down') return normalUpper(-Z);
  return 2 * normalUpper(Math.abs(Z));
}

/** Verdict at significance level alpha. */
function verdict(S, p, alpha, direction) {
  if (!(p < alpha)) return direction === 'two' ? 'No significant trend' : `No significant ${direction === 'up' ? 'increasing' : 'decreasing'} trend`;
  return S > 0 ? 'Increasing' : 'Decreasing';
}

/** Z with the continuity correction, USEPA (2009) eq. 17.29. */
export const zScore = (S, V) => (V > 0 ? (S - sgn(S)) / Math.sqrt(V) : 0);

const sorted = (a) => Float64Array.from(a).sort();

function medianOf(s) {
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Value at rank r (1-based) of ascending values, interpolating between neighbours.
function atRank(s, r) {
  if (!(r >= 1) || r > s.length) return NaN;
  const i = Math.floor(r), f = r - i;
  return i === s.length ? s[i - 1] : s[i - 1] + f * (s[i] - s[i - 1]);
}

/**
 * Sen's slope is the median of the pairwise slopes. The 100(1-alpha)% interval is
 * Gilbert's (1987, pp. 218-219): C = z(1-alpha/2) sqrt(Var S), M1 = (N' - C)/2,
 * M2 = (N' + C)/2, limits at ranks M1 and M2 + 1, interpolated when not whole.
 */
export function senInterval(slopes, V, alpha) {
  const s = sorted(slopes), N = s.length;
  const C = normalQuantile(1 - alpha / 2) * Math.sqrt(V);
  const M1 = (N - C) / 2, M2 = (N + C) / 2;
  return { slope: medianOf(s), lower: atRank(s, M1), upper: atRank(s, M2 + 1), N, C, M1, M2 };
}

function pairSlopes(t, x) {
  const out = [];
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) if (t[j] !== t[i]) out.push((x[j] - x[i]) / (t[j] - t[i]));
  }
  return out;
}

/**
 * Mann-Kendall test and Sen slope for one series. t in years, x the values used for
 * the test; senX (optional) the values used for the slope, when they differ (non-detects).
 * direction: 'two' | 'up' | 'down'. alpha: the significance level, required.
 */
export function mannKendall({ t, x, senX = x, alpha, direction }) {
  check(alpha, direction);
  const n = x.length;
  if (n < 4) throw new Error(`The test needs at least 4 values; this column has ${n}.`);
  if (n > MAX_VALUES) throw new Error(`The test compares every pair of values, which is too slow above ${MAX_VALUES} values. This column has ${n}. Average to daily or monthly values first.`);
  const S = mannKendallS(t, x), V = varianceS(t, x), Z = zScore(S, V);
  const ties = tieGroups(x).length > 0 || tieGroups(t).length > 0;
  const exact = n <= EXACT_MAX_N && !ties ? exactUpper(n) : null;
  const p = pValue({ S, Z, exact }, direction);
  const sen = senInterval(pairSlopes(t, senX), V, alpha);
  // The line through the median time and median value (USEPA 2009, eq. 17.35).
  const tMedian = medianOf(sorted(t)), xMedian = medianOf(sorted(senX));
  return {
    n, S, V, Z, p, pMethod: exact ? 'exact' : 'normal', ties, verdict: verdict(S, p, alpha, direction),
    ...sen, intercept: xMedian - sen.slope * tMedian, tMedian, xMedian,
  };
}

/**
 * Seasonal Mann-Kendall test (Hirsch, Slack and Smith 1982; USEPA 2009 section 14.3.4).
 * rows: [{ season, year, x, senX?, label? }], at most one row per season and year. S and its
 * variance are summed over seasons; the slope is the median of the within-season
 * slopes (x_k - x_j) / (year_k - year_j). Seasons with fewer than 3 values are left out.
 */
export function seasonalMannKendall({ rows, alpha, direction }) {
  check(alpha, direction);
  if (rows.length > MAX_VALUES) throw new Error(`The test compares every pair of values, which is too slow above ${MAX_VALUES} values. This column has ${rows.length}.`);
  const bySeason = new Map();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season).push(r);
  }
  const seasons = [], skipped = [], slopes = [];
  let S = 0, V = 0, n = 0;
  for (const [season, list] of [...bySeason].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => a.year - b.year);
    const dup = list.find((r, i) => i && r.year === list[i - 1].year);
    if (dup) throw new Error(`Season ${dup.label ?? season} has more than one value in ${dup.year}. The seasonal test takes one value per season each year.`);
    if (list.length < MIN_SEASON_VALUES) { skipped.push({ season, label: list[0].label ?? season, n: list.length }); continue; }
    const years = list.map((r) => r.year), x = list.map((r) => r.x), senX = list.map((r) => (r.senX === undefined ? r.x : r.senX));
    const Si = mannKendallS(years, x), Vi = varianceS(years, x);
    seasons.push({ season, n: list.length, S: Si, V: Vi });
    S += Si; V += Vi; n += list.length;
    slopes.push(...pairSlopes(years, senX));
  }
  if (!seasons.length) throw new Error(`No season has ${MIN_SEASON_VALUES} or more values, so the seasonal test cannot be run.`);
  const Z = zScore(S, V), p = pValue({ S, Z }, direction);
  return { n, S, V, Z, p, pMethod: 'normal', seasons, skipped, verdict: verdict(S, p, alpha, direction), ...senInterval(slopes, V, alpha) };
}

function check(alpha, direction) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Choose a significance level.');
  if (!['two', 'up', 'down'].includes(direction)) throw new Error('Choose which trend to test for.');
}

// Standard normal distribution, from erfc in numeric.js.
export const normalCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);
const normalUpper = (z) => 0.5 * erfc(z / Math.SQRT2);

/** Inverse of normalCdf, by bisection then Newton steps. */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return NaN;
  let lo = -40, hi = 40;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (normalCdf(mid) < p) lo = mid; else hi = mid; }
  let z = (lo + hi) / 2;
  for (let i = 0; i < 3; i++) z -= (normalCdf(z) - p) / (libm.exp(-z * z / 2) / Math.sqrt(2 * Math.PI));
  return z;
}
