// The runs test on the signs of a fit's misfits (Hill 1998): by the normal approximation,
// and against the runs the same fit gives on random readings.
import * as libm from './libm.js';

/**
 * The runs test on the signs of the residuals, in time order: Hill (1998, USGS WRIR
 * 98-4005, p. 22, eq. 21 to 23). Too few runs, long stretches of one sign, means the
 * curve misses the readings in a pattern, not at random. z is the statistic for too few
 * runs; the normal approximation holds when there are more than 10 of each sign.
 */
export function runsTest(residuals) {
  const n1 = residuals.filter((v) => v >= 0).length, n2 = residuals.length - n1, n = n1 + n2;
  let runs = n ? 1 : 0;
  for (let i = 1; i < n; i++) if ((residuals[i] >= 0) !== (residuals[i - 1] >= 0)) runs++;
  const mean = n1 && n2 ? (2 * n1 * n2) / n + 1 : NaN;
  const sd = n1 && n2 ? Math.sqrt((2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / (n * n * (n - 1))) : NaN;
  return { runs, mean, sd, z: (runs - mean + 0.5) / sd, valid: n1 > 10 && n2 > 10 };
}

// A seeded stream of standard normal values (the splitmix32 mix and Box and Muller), so
// the calibrated runs test gives the same answer on every run and every computer.
function normals(seed) {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (((z ^ (z >>> 16)) >>> 0) + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * libm.log(uniform())) * libm.cos(2 * Math.PI * uniform());
}
const countRuns = (r) => { let runs = r.length ? 1 : 0; for (let i = 1; i < r.length; i++) if ((r[i] >= 0) !== (r[i - 1] >= 0)) runs++; return runs; };
export const RUNS_SIMULATIONS = 2000;
export const RUNS_LEVEL = 0.01;

/**
 * The runs test of Hill (1998), with the count of runs judged against the counts the same
 * fit gives on random readings, not against the normal approximation. The misfits of a
 * fitted curve are not independent: r = (I - H) e, with H = J (J'J)^-1 J' the hat matrix,
 * and where each point is a mean of n_i readings, e_i has variance sigma^2 / n_i. On a
 * logger record the late points hold hundreds of readings each, so their misfits are
 * mostly the fitted curve's own small error, smooth in time, and run in long stretches of
 * one sign even when the solution is right: the normal approximation called 5.6% of
 * correct fits poor, not 1%. Here RUNS_SIMULATIONS sets of random e, with those variances,
 * are passed through (I - H), seeded so the answer never changes, and the count of runs
 * in the fit's own misfits is compared with theirs. This also holds for few points, where
 * the normal approximation does not (Hill's n1, n2 > 10).
 * Returns { runs, mean, sd, p, valid, poor }: p is the share of random sets with at most
 * as many runs; poor is p below RUNS_LEVEL; valid is false when even the fewest runs that
 * random readings give are not that rare, so the test cannot tell a pattern from chance.
 */
export function runsCalibrated(residuals, J, inv, counts = null) {
  const n = residuals.length, k = J ? J.length : 0;
  const runs = countRuns(residuals);
  const gauss = normals(19980422);
  const e = new Float64Array(n), r = new Float64Array(n), g = new Float64Array(k), b = new Float64Array(k);
  const scale = Array.from({ length: n }, (_, i) => (counts ? 1 / Math.sqrt(counts[i]) : 1));
  let sum = 0, sum2 = 0, atMost = 0;
  const tally = new Map();
  for (let m = 0; m < RUNS_SIMULATIONS; m++) {
    for (let i = 0; i < n; i++) e[i] = gauss() * scale[i];
    for (let a = 0; a < k; a++) { let v = 0; const Ja = J[a]; for (let i = 0; i < n; i++) v += Ja[i] * e[i]; g[a] = v; }
    for (let a = 0; a < k; a++) { let v = 0; for (let c = 0; c < k; c++) v += inv[a * k + c] * g[c]; b[a] = v; }
    for (let i = 0; i < n; i++) { let v = e[i]; for (let a = 0; a < k; a++) v -= J[a][i] * b[a]; r[i] = v; }
    const u = countRuns(r);
    sum += u; sum2 += u * u;
    if (u <= runs) atMost++;
    tally.set(u, (tally.get(u) || 0) + 1);
  }
  const mean = sum / RUNS_SIMULATIONS, sd = Math.sqrt(Math.max(0, sum2 / RUNS_SIMULATIONS - mean * mean));
  const p = atMost / RUNS_SIMULATIONS;
  const poor = p < RUNS_LEVEL;
  // The share of random sets at the fewest runs any of them had: where that is common, as
  // with a straight line through six points, whose misfits must change sign twice, no
  // count of runs is rare enough to say anything.
  const fewest = Math.min(...tally.keys());
  return { runs, mean, sd, z: sd > 0 ? (runs - mean + 0.5) / sd : NaN, p, valid: poor || tally.get(fewest) / RUNS_SIMULATIONS < RUNS_LEVEL, poor, n };
}
