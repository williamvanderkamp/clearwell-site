// Checks of a slug test against the practice of Butler, McElwee and Liu (1996, the
// guidelines of the Kansas Geological Survey) and the reports that apply it: the start of
// the test (the measured initial displacement H0 against the expected H0*, readings
// beyond H0, the level when the test began), the shape of the log plot that the straight
// line is fitted to, and the comparison of repeat tests at one well. Each limit below is
// the number a source gives, named where it is defined; nothing here is tuned to data.
// The book these guidelines are gathered in, Butler (1998), could not be had, so each
// comes from an open report of the same authors (docs/tools/slug.md says which).

import { tQuantile } from './tdist.js';
import { fitLine, lnGamma } from './numeric.js';
import { fitWindow } from './slug.js';
import * as libm from './libm.js';

// Butler, McElwee and Liu (1996), guideline 3: a difference between the apparent and the
// expected H0, divided by the expected H0, above 10% "should be of concern" (after
// Butler 1996).
export const H0_CONCERN = 0.1;
// Butler and Healey (1999, Table 2, note 4): H0/H0* above about 1.05 comes from sensor
// noise and the way H0 was read from the record; below about 0.95 it may mean a start
// that was not instantaneous relative to the formation's response, or readings that need
// a correction for dynamic pressure.
export const H0_BAND = [0.95, 1.05];
// Butler and Healey (1999), Methodology: "An H0 to H0* ratio less than 0.9 is often an
// indication that the dynamic pressure correction is necessary."
export const H0_DYNAMIC = 0.9;
// Butler, McElwee and Liu (1996), guideline 1: three or more tests at a well; guideline 2:
// two or more initial displacements, varied by "a factor of two or greater".
export const MIN_TESTS = 3;
export const H0_FACTOR = 2;
// Butler (1997, KGS Open-File Report 97-59): a residual deviation from static at the start
// below 20% of H0 has an effect on K that "can be ignored for virtually all practical
// applications"; for a large storage parameter it should be below 5% to keep the error
// under 10%. Incomplete recovery always makes K too low.
export const RECOVERY = 0.2;
export const RECOVERY_LARGE_ALPHA = 0.05;
// Butler, McElwee and Liu (1996), guidelines 2, 4 and 8: formations of "moderate to low
// permeability (K < 10-15 m/d)" and "more permeable systems (K > 10-15 m/d)", in m/s.
export const K_BOUND = [10 / 86400, 15 / 86400];
// The level of the statistical tests here, as for the intervals on the page.
export const LEVEL = 0.05;

// ---------------------------------------------------------------------------------------
// The F distribution, for the comparison of repeat tests.

/**
 * The regularized incomplete beta function I_x(a, b), by its continued fraction
 * (Abramowitz and Stegun 1964, 26.5.8), evaluated by the modified Lentz method, on the
 * side of x where it converges fast (26.5.2: I_x(a, b) = 1 - I_(1-x)(b, a)).
 */
export function betaIncomplete(x, a, b) {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaIncomplete(1 - x, b, a);
  const front = libm.exp(a * libm.log(x) + b * libm.log(1 - x) + lnGamma(a + b) - lnGamma(a) - lnGamma(b)) / a;
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let f = d;
  for (let m = 1; m <= 300; m++) {
    for (const num of [(m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m)), -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))]) {
      d = 1 + num * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      f *= c * d;
    }
    if (Math.abs(c * d - 1) < 1e-15) break;
  }
  return front * f;
}

/** P(F > f) for the F distribution with d1 and d2 degrees of freedom (A&S 26.6.2). */
export const fUpper = (f, d1, d2) => (f > 0 ? betaIncomplete(d2 / (d2 + d1 * f), d2 / 2, d1 / 2) : 1);

// ---------------------------------------------------------------------------------------
// Several tests in one file.

/**
 * Readings split into tests by a label column, in the order each label first appears,
 * which is taken as the order the tests were made. Rows without a label are left out
 * and returned by index.
 */
export function splitTests(t, d, labels, expected = []) {
  const tests = new Map(), unlabelled = [];
  labels.forEach((label, i) => {
    const key = label === undefined || label === null || label === '' || (typeof label === 'number' && !Number.isFinite(label)) ? null : String(label).trim();
    if (!key) { unlabelled.push(i); return; }
    if (!tests.has(key)) tests.set(key, { label: key, t: [], d: [], rows: [], expected: undefined });
    const g = tests.get(key);
    g.t.push(t[i]); g.d.push(d[i]); g.rows.push(i);
    if (g.expected === undefined && Number.isFinite(expected[i])) g.expected = expected[i];
  });
  return { tests: [...tests.values()], unlabelled };
}

// ---------------------------------------------------------------------------------------
// The start of a test.

/**
 * The checks on the start that the record itself allows. n is from normalize(). Gives
 * the readings after time zero further from static than H0 (|H/H0| > 1), the largest of
 * them; and, where there are readings before time zero, the departure from static of the
 * last of them as a share of H0, the residual deviation of Butler (1997) and the "percent
 * recovery" of Butler and Healey (1999), one minus that share.
 */
export function startChecks(n) {
  const beyond = n.t.map((_, i) => i).filter((i) => n.t[i] > 0 && Math.abs(n.ratio[i]) > 1);
  const worst = beyond.reduce((a, i) => (a === null || Math.abs(n.ratio[i]) > Math.abs(n.ratio[a]) ? i : a), null);
  const out = {
    beyond: beyond.length ? { count: beyond.length, ratio: n.ratio[worst], at: n.t[worst], first: n.t[beyond[0]], last: n.t[beyond[beyond.length - 1]] } : null,
    residual: null,
  };
  if (n.before && n.before.t.length) {
    const last = n.before.t.length - 1;
    const share = n.before.d[last] / n.h0;
    out.residual = { at: n.before.t[last], share, count: n.before.t.length, recovery: 1 - Math.abs(share) };
  }
  return out;
}

/**
 * The measured H0 against the expected H0* (from the slug's volume, or the air pressure in
 * a pneumatic test), as magnitudes, since a sign may be entered for one and not the other.
 */
export function h0Check(h0, expected) {
  if (!(Math.abs(expected) > 0)) throw new Error('The expected initial displacement H0* must be other than zero.');
  const ratio = Math.abs(h0) / Math.abs(expected);
  return {
    ratio,
    difference: Math.abs(1 - ratio),
    concern: Math.abs(1 - ratio) > H0_CONCERN,
    band: ratio < H0_BAND[0] ? 'low' : ratio > H0_BAND[1] ? 'high' : null,
    dynamic: ratio < H0_DYNAMIC,
    signs: Math.sign(h0) !== Math.sign(expected),
  };
}

// ---------------------------------------------------------------------------------------
// The shape of the log plot.

/**
 * Whether ln(H/H0) against t curves, over the readings from time zero down to H/H0 = lo
 * (the bottom of the fit window), as the part of the record the straight line stands for:
 * a least-squares quadratic, ln(H/H0) = a + b t + c t², and Student's t test of c at the
 * 5% level, with n - 3 degrees of freedom. shape is 'up' (concave upward: the fall slows),
 * 'down' (concave downward: it quickens) or 'straight' (c not told from zero by the
 * scatter). early and late are the slopes of the quadratic at the first and last reading,
 * so late / early says how far the fall slows or quickens. The t test takes the misfits
 * as independent; where they are not, it finds curvature more readily.
 */
export function curvature(t, ratio, lo) {
  const use = t.map((_, i) => i).filter((i) => t[i] >= 0 && ratio[i] > 0 && ratio[i] >= lo && ratio[i] <= 1);
  if (use.length < 5) return null;
  const x = use.map((i) => t[i]), y = use.map((i) => libm.log(ratio[i]));
  const from = x[0], to = x[x.length - 1];
  if (!(to > from)) return null;
  // Centred and scaled time, so the normal equations are well conditioned.
  const mid = (from + to) / 2, half = (to - from) / 2;
  const u = x.map((v) => (v - mid) / half);
  const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  u.forEach((ui, i) => {
    let p = 1;
    for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * y[i]; p *= ui; }
  });
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const inv = invert3(M);
  if (!inv) return null;
  const beta = inv.map((r) => r[0] * T[0] + r[1] * T[1] + r[2] * T[2]);
  let sse = 0;
  u.forEach((ui, i) => { const r = y[i] - (beta[0] + beta[1] * ui + beta[2] * ui * ui); sse += r * r; });
  const dof = use.length - 3, s2 = sse / dof;
  const se = Math.sqrt(s2 * inv[2][2]);
  const tStat = se > 0 ? beta[2] / se : beta[2] === 0 ? 0 : Infinity * Math.sign(beta[2]);
  const tCrit = tQuantile(1 - LEVEL / 2, dof);
  // Slopes per unit of time at the two ends: d/dt of b u + c u², u = (t - mid) / half.
  const early = (beta[1] - 2 * beta[2]) / half, late = (beta[1] + 2 * beta[2]) / half;
  const shape = Math.abs(tStat) > tCrit ? (beta[2] > 0 ? 'up' : 'down') : 'straight';
  return { n: use.length, from, to, lo, tStat, tCrit, dof, early, late, shape, used: use };
}

function invert3(M) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) > 0)) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

// ---------------------------------------------------------------------------------------
// Repeat tests.

/**
 * The straight line in the window lo to hi fitted to each test, and whether the slopes
 * differ by more than the scatter about the lines allows: the extra-sum-of-squares F test
 * of one slope shared by all tests (each with its own intercept) against a slope for each
 * (Bates and Watts 1988; for straight lines it is exact under independent misfits of one
 * spread), at the 5% level. tests: [{ label, t, ratio, h0 }], t in s. A test whose window
 * holds too few readings gets an error in place of a line and is left out of the test.
 */
export function compareTests(tests, lo, hi) {
  const lines = tests.map((g) => {
    try {
      const fit = fitWindow(g.t, g.ratio, lo, hi);
      const x = fit.used.map((i) => g.t[i]), y = fit.used.map((i) => libm.log(g.ratio[i]));
      const { slope, rss, sxx } = fitLine(x, y);
      return { ...fit, n: x.length, sxx, sxy: slope * sxx, rss, syy: rss + slope * slope * sxx };
    } catch (e) {
      return { error: e.message };
    }
  });
  const ok = lines.filter((l) => !l.error);
  const k = ok.length, N = ok.reduce((s, l) => s + l.n, 0);
  let test = null;
  if (k >= 2 && N - 2 * k >= 1) {
    const separate = ok.reduce((s, l) => s + l.rss, 0);
    const sxx = ok.reduce((s, l) => s + l.sxx, 0), sxy = ok.reduce((s, l) => s + l.sxy, 0), syy = ok.reduce((s, l) => s + l.syy, 0);
    const common = Math.max(separate, syy - (sxy * sxy) / sxx);
    const d1 = k - 1, d2 = N - 2 * k;
    if (separate > 0) {
      const F = ((common - separate) / d1) / (separate / d2);
      const p = fUpper(F, d1, d2);
      test = { F, d1, d2, p, differ: p < LEVEL, slope: sxy / sxx };
    } else test = { F: Infinity, d1, d2, p: 0, differ: common > 0, slope: sxy / sxx, exact: true };
  }
  return { lines, test };
}

/**
 * How values (K of each test) are ordered by a key (|H0|, or the order of the tests):
 * 'falls' if every pair of tests with different keys has the larger value at the smaller
 * key, 'rises' if every such pair has it at the larger key, otherwise null. Pairs with the
 * same key are not compared. null too where no two keys differ.
 */
export function ordering(keys, values) {
  let falls = true, rises = true, pairs = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (!(keys[i] < keys[j])) continue;
      pairs++;
      if (!(values[i] > values[j])) falls = false;
      if (!(values[i] < values[j])) rises = false;
    }
  }
  if (!pairs) return null;
  return falls ? 'falls' : rises ? 'rises' : null;
}
