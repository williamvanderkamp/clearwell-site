// Fitting a pumping test solution from src/engine/solutions/ to the drawdown at one
// observation point: fitSolution. The least squares it runs is lsq.js's, with the t
// distribution of tdist.js, the matrices of linalg.js, the profile intervals of
// profile.js and the runs test of runs.js; fit.js gives their names too, as it always has.
import { fitLeaky } from './leaky.js';
import { fitTheis, logBins } from './pumping.js';
import { isNum, logTimes } from './numeric.js';
import { drawdownAt } from './superpose.js';
import { normalQuantile } from './trend.js';
import * as libm from './libm.js';
import { tQuantile } from './tdist.js';
import { covarianceFactor } from './linalg.js';
import { leastSquares, logScale, sumSq, WIDE, WIDE_SKIN, withinBounds } from './lsq.js';
import { profileIntervals } from './profile.js';
import { runsCalibrated, RUNS_LEVEL, runsTest } from './runs.js';

export { tCdf, tQuantile, tTwoSided } from './tdist.js';
export { covarianceFactor, invertSPD, symmetricEigen } from './linalg.js';
export { leastSquares, logScale, WIDE, WIDE_SKIN } from './lsq.js';
export { PROFILE_BETTER, PROFILE_CALLS, profileIntervals } from './profile.js';
export { runsCalibrated, RUNS_LEVEL, RUNS_SIMULATIONS, runsTest } from './runs.js';

// ---------------------------------------------------------------------------------------
// Fitting a solution from src/engine/solutions/ to drawdown at one observation point.

/**
 * Readings averaged into widths of log time, 20 to each log cycle, within each period of
 * constant rate, in log of the time since that period began. So no width spans a change
 * of rate, and recovery keeps 20 widths to each log cycle of time since the pump stopped.
 * Period i holds the readings after its own start and up to the next one's, since a
 * change of rate acts only after its time. Returns { t, y, n, period }: each width's time
 * (its period's start plus the geometric mean of the times since it), mean reading and
 * count. With one rate it is logBins from pumping.js.
 */
export function binReadings(t, y, rates, perDecade = 20) {
  const out = { t: [], y: [], n: [], period: [], pure: { ss: 0, df: 0 } };
  rates.forEach(([t0], i) => {
    const t1 = i + 1 < rates.length ? rates[i + 1][0] : Infinity;
    const idx = t.map((_, j) => j).filter((j) => t[j] > t0 && t[j] <= t1);
    const dt = idx.map((j) => t[j] - t0), yy = idx.map((j) => y[j]);
    const b = logBins(dt, yy, perDecade);
    b.t.forEach((x, m) => { out.t.push(t0 + x); out.y.push(b.y[m]); out.n.push(b.n[m]); out.period.push(i); });
    // The scatter of the readings inside each width about a straight line in log time,
    // which no solution enters: pooled, it is the variance of one reading, with
    // n_i - 2 degrees of freedom from each width of 3 or more readings.
    const groups = new Map();
    dt.forEach((x, j) => {
      const key = Math.floor(libm.log10(x) * perDecade + 1e-9);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([libm.log(x), yy[j]]);
    });
    for (const g of groups.values()) {
      if (g.length < 3) continue;
      const mx = g.reduce((a, [x]) => a + x, 0) / g.length, my = g.reduce((a, [, v]) => a + v, 0) / g.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const [x, v] of g) { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (v - my); syy += (v - my) * (v - my); }
      out.pure.ss += sxx > 0 ? syy - (sxy * sxy) / sxx : syy;
      out.pure.df += g.length - 2;
    }
  });
  return out;
}

// Where the search looks for a value the readings say nothing direct about, by kind, in
// metres and days, when the solution gives no min and max of its own, nor a grid of its
// own (candidates). These are search ranges, not answers: the fit moves on from the best
// of them.
const GRID = {
  S: [1e-5, 1e-4, 1e-3, 1e-2],
  Ss: [1e-7, 1e-6, 1e-5, 1e-4],
  Sy: [0.01, 0.03, 0.1, 0.3],
  ratio: [1e-4, 1e-3, 1e-2, 0.1, 1, 10],
  skin: [-2, 0, 3, 10],
  other: [1e-3, 3e-2, 1, 30, 1e3],
};
// Where a solution gives both a min and a max, this many values spread evenly between
// them (in log for a value fitted as its log) replace the grid above.
const SPREAD = 6;
// Starting points are compared on at most this many readings, spread through the record.
// Every combination of the grid is compared, thinned evenly to at most GRID_COMBOS: a
// fixed number, never one set by how fast the computer is, so the same readings always
// give the same answer, on any computer, however busy.
export const COMPARE_ON = 12;
export const GRID_COMBOS = 600;
const REFINE = 3;
const REFINE_PASSES = 3;
// The fit runs a short search from each of the best STARTS different starting points,
// then carries on from the best of those to the end.
const STARTS = 4;
export const SHORT = 12;
// In the extra rounds after a poor fit, each check search runs this many iterations: only
// the best of them is carried on, so a check needs only to show where it is heading.
const SHORT_CHECK = 6;
const FULL = 100;
// When the best fit misses the readings in a pattern, up to this many more rounds: the
// first from the best 2 STARTS different points of a profile over the grid (below), the
// next from the next STARTS best different starting points and STARTS more spread out.
const EXTRA_ROUNDS = 2;
// A fit stops within this many ms, statistics and curve included, and says so.
export const TIME_LIMIT = 180e3;
// The shares of the time limit by which comparing starts, and starting a new search, must
// be done. Only a fit far slower than usual reaches them; it is then reported as stopped.
const GRID_SHARE = 1 / 3;
const ROUNDS_SHARE = 0.6;
// The time one call of the solution takes is allowed this margin in the time budget.
const MARGIN = 1.5;
// The fitted curve is drawn on this many times, or on CURVE_FEW when time is short.
const CURVE_TIMES = 160;
const CURVE_FEW = 40;
// A profile that finds a better fit than the best starts the profiles again from it, until
// none does, at most this many times (fitSolution); then once more taking a closer fit as
// no rise, with restartsCut set. Until round 9 it was 2, and whether the profiles of the
// last pass could still find a closer fit then turned on how many had been found before,
// itself a matter of rounding (Vennebulten, Moench 1997, times as minutes / 1440 or as
// minutes × 60 / 86400: two restarts or one). This many is not met on any record tested.
export const PROFILE_RESTARTS = 10;

// The distance a Theis fit can take S from: r, or the well radius, or the distance
// from (x, y). Without one, T still comes from the fit, but S is searched for.
const distanceOf = (g) => [g.r, g.rw, libm.hypot(g.x, g.y)].find((v) => v > 0);

/**
 * What the record itself says, before any solution: Theis fits (fitTheis) to the readings
 * before the first change of rate, to the earliest 40% of their span in log time and to
 * the latest 40%, and, for a solution with a leakage factor or an aquitard resistance, a
 * Hantush and Jacob fit (fitLeaky). On a delayed-drainage curve, for example, the early
 * segment gives T and S and the late one T and Sy.
 */
export function segmentFits(pts, rates, g, solution) {
  const Q = rates[0][1], r = distanceOf(g);
  let idx = pts.t.map((_, i) => i).filter((i) => pts.period[i] === 0 && pts.y[i] > 0);
  if (idx.length < 4) idx = pts.t.map((_, i) => i).filter((i) => pts.y[i] > 0);
  const theis = (ids) => {
    if (ids.length < 3) return null;
    try {
      const f = fitTheis(ids.map((i) => pts.t[i]), ids.map((i) => pts.y[i]), Q, r);
      return f.T > 0 && Number.isFinite(f.T) ? { T: f.T, S: f.S > 0 ? f.S : undefined, rms: f.rmse, from: pts.t[ids[0]], to: pts.t[ids[ids.length - 1]] } : null;
    } catch {
      return null;
    }
  };
  const lt = idx.map((i) => libm.log(pts.t[i]));
  const lo = Math.min(...lt), hi = Math.max(...lt), span = hi - lo;
  const part = (inside) => {
    const ids = idx.filter((_, j) => inside(lt[j]));
    return ids.length >= 4 ? ids : null;
  };
  const early = part((x) => x <= lo + 0.4 * span) || idx.slice(0, 4);
  const late = part((x) => x >= hi - 0.4 * span) || idx.slice(-4);
  const out = { all: theis(idx), early: theis(early), late: theis(late), leaky: null };
  if (solution.params.some((p) => p.kind === 'L' || p.kind === 'c') && r > 0 && idx.length >= 4) {
    try {
      const f = fitLeaky(idx.map((i) => pts.t[i]), idx.map((i) => pts.y[i]), Q, r);
      if (f.T > 0 && Number.isFinite(f.B)) out.leaky = { T: f.T, S: f.S, B: f.B, c: f.c };
    } catch { /* no leaky start then */ }
  }
  return out;
}

// A leakage factor B, or c = B²/T, is searched for at these multiples of the distance r.
const DISTANCES = [0.3, 1, 3, 10, 30, 100, 300, 1000, 3000];

// n values from a to b, evenly in log if log is true.
const spread = (a, b, n, log) => Array.from({ length: n }, (_, i) => (log ? libm.exp(libm.log(a) + (libm.log(b) - libm.log(a)) * i / (n - 1)) : a + (b - a) * i / (n - 1)));

// Values to try for one parameter that the straight-line fits say nothing about: between
// the solution's own min and max where it gives both, or the grid for its kind.
function gridFor(p, around) {
  const log = logScale(p.kind);
  if (isNum(p.min) && isNum(p.max) && (!log || p.min > 0)) return spread(p.min, p.max, SPREAD, log);
  if (p.kind === 'L' || p.kind === 'c') return around;
  return GRID[p.kind] || GRID.other;
}

/**
 * Starting sets from the straight-line fits: { T, S, Sy, B } from the whole record, from
 * the early segment, from the late T with the early S (as on a delayed-drainage curve),
 * and from the Hantush and Jacob fit. Near-duplicates are dropped.
 */
function startingSets(seg) {
  const sets = [];
  const add = (x) => {
    if (!(x.T > 0)) return;
    const same = (a, b) => (a === undefined && b === undefined) || (a > 0 && b > 0 && Math.abs(libm.log(a / b)) < 0.05);
    if (!sets.some((y) => same(x.T, y.T) && same(x.S, y.S) && same(x.Sy, y.Sy) && same(x.B, y.B))) sets.push(x);
  };
  const Sy = seg.late && seg.late.S < 1 ? seg.late.S : undefined;
  if (seg.all) add({ T: seg.all.T, S: seg.all.S, Sy });
  if (seg.early) add({ T: seg.early.T, S: seg.early.S, Sy });
  if (seg.late && seg.early) add({ T: seg.late.T, S: seg.early.S, Sy });
  if (seg.leaky) add({ T: seg.leaky.T, S: seg.leaky.S, Sy, B: seg.leaky.B });
  return sets;
}

// The values to try for each parameter from one starting set: the user's own start, or
// one from the set, or a range to search. A parameter may give its own (grid: (set, g,
// span) => values, span the first and last times fitted), where its solution says at what
// values it changes the drawdown within the record; null leaves the grid for its kind.
function candidates(solution, set, g, given, span) {
  const seen = {};
  const hasB = isNum(g.b) && g.b > 0, r = distanceOf(g) || 1;
  const { T } = set, S = set.S;
  return solution.params.map((p) => {
    const nth = (seen[p.kind] = (seen[p.kind] || 0) + 1);
    const own = typeof p.grid === 'function' && !isNum(given[p.id]) ? p.grid(set, g, span) : null;
    let list;
    if (isNum(given[p.id])) list = [given[p.id]];
    else if (Array.isArray(own) && own.length) list = own;
    else if (p.kind === 'T') list = nth === 1 ? [T] : [T / 10, T, T * 10];
    else if (p.kind === 'S') list = !(S > 0) ? gridFor(p) : nth === 1 ? [S] : [S / 100, S / 10, S, S * 10, S * 100];
    // The late segment's S is at most Sy: the record may stop before drainage is complete.
    else if (p.kind === 'Sy') list = set.Sy > 0 && !(set.Sy <= S) ? [set.Sy, set.Sy * 3, set.Sy * 10] : gridFor(p);
    else if (p.kind === 'Ss') list = S > 0 && hasB ? (nth === 1 ? [S / g.b] : [S / g.b / 100, S / g.b, S / g.b * 100]) : gridFor(p);
    else if (p.kind === 'K') list = hasB && nth === 1 ? [T / g.b] : [T, T / 10, T / 100, T / 1000].map((v) => (hasB ? v * 10 / g.b : v));
    else if (p.kind === 'L') list = set.B ? [set.B] : gridFor(p, DISTANCES.map((m) => m * r));
    else if (p.kind === 'c') list = set.B ? [(set.B * set.B) / T] : gridFor(p, DISTANCES.map((m) => (m * r) * (m * r) / T));
    else list = gridFor(p);
    const within = list.filter((v) => withinBounds(p, v));
    if (within.length) return within;
    // Every value tried is outside the published limits: start inside them.
    if (isNum(p.min) && isNum(p.max)) return [logScale(p.kind) && p.min > 0 ? Math.sqrt(p.min * p.max) : (p.min + p.max) / 2];
    return [isNum(p.min) ? (logScale(p.kind) ? p.min * 10 : p.min) : p.max];
  });
}

// Every combination, thinned evenly until there are at most max: the longest list is
// halved each time, skin lists first (down to two values), since skin changes mostly
// the early drawdown, which the grid's few readings see least.
function combinations(lists, max, kinds = []) {
  const l = lists.map((x) => x.slice());
  const count = () => l.reduce((m, x) => m * x.length, 1);
  while (count() > max) {
    const skin = l.findIndex((x, j) => kinds[j] === 'skin' && x.length > 2);
    const i = skin >= 0 ? skin : l.reduce((b, x, j) => (x.length > l[b].length ? j : b), 0);
    if (l[i].length < 2) break;
    // Keep both ends of an odd list, and the first and last of an even one.
    const n = l[i].length;
    l[i] = l[i].filter((_, j) => j % 2 === 0 || j === n - 1);
    if (l[i].length === n) l[i] = [l[i][0], l[i][n - 1]];
  }
  let out = [[]];
  for (const x of l) out = out.flatMap((c) => x.map((v) => [...c, v]));
  return out;
}

/**
 * The same curve k times as high, where a solution's drawdown is Q/T times a function of
 * dimensionless groups only: T and K divided by k, and S, Sy and Ss with them so that
 * T/S, the diffusivity, and every ratio of storages stay as they were; c times k, so
 * that B² = Tc stays; lengths, ratios, skin and other values unchanged. This holds
 * exactly for Theis, Hantush and Jacob, Hantush (1960) and Neuman, and nearly where
 * casing storage enters, so it is used only to choose starting points. Values the user
 * gave stay as given: then nothing is scaled. Null where a scaled value leaves its limits.
 */
function scaledFor(solution, given) {
  const SCALE = { T: -1, K: -1, S: -1, Sy: -1, Ss: -1, c: 1 };
  const moves = solution.params.filter((p) => SCALE[p.kind]);
  if (moves.some((p) => isNum(given[p.id]))) return () => null;
  return (p, k) => {
    const q = { ...p };
    for (const x of moves) {
      const v = p[x.id] * libm.pow(k, SCALE[x.kind]);
      if (!withinBounds(x, v)) return null;
      q[x.id] = v;
    }
    return q;
  };
}

/**
 * Fits a solution to drawdown at one observation point.
 *   t, s:     elapsed time (d) and drawdown (m), as read.
 *   rates:    [[t, Q], ...] in days and m3/d, each rate from its time on; first at t = 0.
 *   g:        the solution's geometry and options, in metres.
 *   boundaries: optional, as superpose.js's drawdownAt() takes them.
 *   start:    { id: value } starting values; fixed: { id: true } for values held there.
 *   average:  true to average the readings (binReadings).
 *   from, to: optional fit window, in days.
 *   progress: optional, called with { stage: 'grid', done, of } while starting points are
 *             compared, { stage: 'search', step, of } as each search ends, { stage:
 *             'statistics' }, { stage: 'intervals' } and { stage: 'curve' } at those
 *             stages, and once with
 *             { stage: 'slow', seconds, limit } when one evaluation takes over 0.5 s.
 *   timeLimit: ms within which the whole fit ends, statistics and curve included
 *             (TIME_LIMIT).
 *   curve:    true to add the fitted curve (fitWithCurve).
 * The search does the same work whatever the computer: a fixed grid, fixed numbers of
 * starts and iterations. Only the time limit depends on the clock, and a fit that meets it
 * says so (stopped), since its answer then depends on how fast the computer was.
 * Returns leastSquares' result, and:
 *   points:   what was fitted, { t, y, n, period };
 *   kept:     the indices in t and s of the readings fitted, in time order, before any
 *             averaging; used, how many;
 *   segments: the straight-line fits the starts came from (segmentFits);
 *   misfit:   the runs test on the residuals, calibrated for this fit (runsCalibrated);
 *   ends:     where each search from a different start ended, best first;
 *   intervals: 'profile' when every 95% interval is a profile interval (profileIntervals),
 *             'partial' or 'linearized' when the time limit, a profile's budget of calls
 *             (PROFILE_CALLS) or a failed call left some or all of them linearized (each
 *             value's interval says which and why), 'none' with no statistics;
 *   profileCalls: the calls of the solution the profiles made, restarts included;
 *   restarts: how many times a profile found a closer fit and the fit was carried on from
 *             it; restartsCut: true when that reached PROFILE_RESTARTS, and the last
 *             profiles took a closer fit as no rise;
 *   improved: null, or the search's own fit { sse, rms, values } when a profile found a
 *             closer one, from which the fit was carried on;
 *   rivals:   other ends that fit the readings as well as the best, within what the 95%
 *             interval of some value allows, but lie outside that interval, in another
 *             valley of the misfit: each { values, rms, ids }, where ids are the values it
 *             lies outside. The interval of each such value is widened to take them in
 *             (widened, with spread the range of the fits as good), and past WIDE it is
 *             not determined ('ends');
 *   statistics: 'central', or 'forward' or 'none' when the time limit left too little time;
 *   stopped:  true when the time limit cut the search, statistics, intervals or curve short.
 */
export function fitSolution({ solution, t, s, rates, g, boundaries = null, start = {}, fixed = {}, average = true, from, to, progress, timeLimit = TIME_LIMIT, curve = false }) {
  for (const p of solution.params) if (fixed[p.id] && !isNum(start[p.id])) throw new Error(`${p.label} is held fixed, so it needs a value.`);
  const keep = t.map((_, i) => i).filter((i) => isNum(t[i]) && isNum(s[i]) && t[i] > 0
    && (!isNum(from) || t[i] >= from) && (!isNum(to) || t[i] <= to));
  const windowed = isNum(from) || isNum(to);
  if (!keep.length) throw new Error(windowed ? 'No readings fall inside the fit window.' : 'No reading has a time above zero and a drawdown.');
  const order = keep.sort((a, b) => t[a] - t[b]);
  const tt = order.map((i) => t[i]), ss = order.map((i) => s[i]);
  const periodOf = (x) => rates.reduce((k, [t0], i) => (x > t0 ? i : k), 0);
  const pts = average ? binReadings(tt, ss, rates) : { t: tt, y: ss, n: tt.map(() => 1), period: tt.map(periodOf), pure: { ss: 0, df: 0 } };
  const k = solution.params.filter((p) => !fixed[p.id]).length;
  if (pts.t.length < k + 2) {
    const where = windowed ? ' inside the fit window' : '';
    throw new Error(`Only ${pts.t.length} point${pts.t.length === 1 ? '' : 's'}${where}${average ? ' after averaging' : ''}, and fitting ${k} value${k === 1 ? '' : 's'} with a measure of uncertainty needs at least ${k + 2}.`);
  }
  const opts = { rates, boundaries };
  const m = pts.t.length;
  // The time each call of the solution on every point takes, for the time budget only.
  let callMs = 0, calls = 0, estimate = 0;
  const model = (p) => {
    const a = performance.now();
    try { return drawdownAt(solution, p, g, pts.t, opts); } finally { callMs += performance.now() - a; calls++; }
  };
  const perCall = () => (calls ? callMs / calls : estimate);
  const began = Date.now();
  const deadline = began + timeLimit;
  const left = () => deadline - Date.now();
  // Time kept back for the statistics (4k + 2 calls) and the curve (CURVE_TIMES times).
  const reserve = () => MARGIN * perCall() * (4 * k + 2 + (curve ? CURVE_TIMES / m : 0));
  const late = () => left() < reserve();
  // A stage cut short by the clock: the answer then depends on the computer's speed.
  let cut = false;
  const pastShare = (share) => Date.now() - began > share * timeLimit;

  const segments = segmentFits(pts, rates, g, solution);
  const sets = startingSets(segments);
  const needsData = solution.params.some((p) => ['T', 'K', 'c'].includes(p.kind) && !isNum(start[p.id]));
  if (needsData && !sets.length) throw new Error('No starting values could be found from the readings. Give starting values for the parameters.');
  // With every T-like value given, one set stands for the user's own values.
  if (!sets.length) sets.push({ T: 1 });

  // Every starting point is compared on a few readings spread through the record.
  const few = Math.min(m, COMPARE_ON);
  const pick = Array.from({ length: few }, (_, i) => Math.round(i * (m - 1) / Math.max(1, few - 1)));
  const tFew = pick.map((i) => pts.t[i]), yFew = pick.map((i) => pts.y[i]);
  const misfitFew = (p) => {
    try { const f = drawdownAt(solution, p, g, tFew, opts); return sumSq(yFew.map((v, j) => v - f[j])); } catch { return Infinity; }
  };
  const lists = sets.map((set) => candidates(solution, set, g, start, [pts.t[0], pts.t[m - 1]]));
  const combos = lists.flatMap((l) => combinations(l, Math.max(1, Math.floor(GRID_COMBOS / sets.length)), solution.params.map((p) => p.kind)));
  const tried = [];
  const scaled = scaledFor(solution, start);
  let quickest = Infinity;
  for (const [i, c] of combos.entries()) {
    // Comparing starts may use a share of the time; the searches need the rest.
    if (tried.length && pastShare(GRID_SHARE)) { cut = true; break; }
    const p = Object.fromEntries(solution.params.map((q, j) => [q.id, c[j]]));
    // A start the solution cannot compute is skipped.
    let f;
    const a = performance.now();
    try { f = drawdownAt(solution, p, g, tFew, opts); } catch { continue; }
    // The first few comparisons say how long one call on every point will take: for the
    // time budget and the page's note on a slow fit only, never for what is searched.
    if (i < 3) {
      quickest = Math.min(quickest, Math.max(performance.now() - a, 0.05));
      if (i === 2 || i === combos.length - 1) {
        estimate = (quickest * m) / few;
        if (progress && estimate > 500) progress({ stage: 'slow', seconds: estimate / 1000, limit: timeLimit / 1000 });
      }
    }
    const e = sumSq(yFew.map((v, j) => v - f[j]));
    if (!Number.isFinite(e)) continue;
    // Each point is also tried at the height that best matches the readings (scaled).
    const fy = f.reduce((sum, v, j) => sum + v * yFew[j], 0), ff = sumSq(f), up = fy / ff;
    const q = up > 0 && Number.isFinite(up) ? scaled(p, up) : null;
    if (q) tried.push({ p: q, e: Math.max(0, sumSq(yFew) - fy * fy / ff), guess: true });
    tried.push({ p, e });
    if (progress && (i % 10 === 9 || i === combos.length - 1)) progress({ stage: 'grid', done: i + 1, of: combos.length });
  }
  if (!tried.length) throw new Error('The solution gave no drawdown at any starting value tried. Give starting values for the parameters.');
  const perEvaluation = estimate / 1000;
  tried.sort((a, b) => a.e - b.e);

  // Starting points that differ by more than a factor of 3 in some fitted value (or by 2
  // in skin) count as different.
  const freeParams = solution.params.filter((p) => !fixed[p.id]);
  const gap = (a, b) => Math.max(0, ...freeParams.map((p) => (logScale(p.kind) ? Math.abs(libm.log(a[p.id] / b[p.id])) / libm.log(3) : Math.abs(a[p.id] - b[p.id]) / 2)));
  const apart = (a, b) => gap(a, b) > 1;
  // The grid is coarse, so the best few different points are each improved by a compass
  // search: each value in turn is moved by a factor of 3 or 10 either way (skin by 1 or
  // 3), keeping any move that lowers the misfit, for up to REFINE_PASSES rounds.
  // The compass search, and every search after the first of a round, stays within a
  // factor of 10 of the values the grid tried (or 3 of skin): beyond them a curve can be
  // slow to compute, as Neuman's is at a tiny Kz/Kr, and a check has nothing to find there.
  const reach = solution.params.map((p, j) => {
    const vals = combos.map((c) => c[j]);
    return logScale(p.kind) ? [Math.min(...vals) / 10, Math.max(...vals) * 10] : [Math.min(...vals) - 3, Math.max(...vals) + 3];
  });
  // The same by id, for the profiles of values not determined (profileIntervals, reach).
  const looked = Object.fromEntries(solution.params.map((p, j) => [p.id, reach[j]]));
  const inside = (p, v) => {
    const [a, b] = reach[solution.params.indexOf(p)];
    return v >= a && v <= b && withinBounds(p, v);
  };
  const compass = (c) => {
    let cur = c;
    for (let pass = 0; pass < REFINE_PASSES; pass++) {
      if (pastShare(GRID_SHARE)) { cut = true; break; }
      let moved = false;
      for (const p of freeParams) {
        for (const f of logScale(p.kind) ? [1 / 10, 1 / 3, 3, 10] : [-3, -1, 1, 3]) {
          const v = logScale(p.kind) ? cur.p[p.id] * f : cur.p[p.id] + f;
          if (!inside(p, v)) continue;
          const trial = { ...cur.p, [p.id]: v }, e = misfitFew(trial);
          if (e < cur.e) { cur = { p: trial, e }; moved = true; }
        }
      }
      if (!moved) break;
    }
    return cur;
  };
  const leaders = [];
  for (const c of tried) {
    if (leaders.length >= REFINE) break;
    // A scaled point's misfit is exact only where the solution scales exactly; check it.
    if (c.guess) { c.e = misfitFew(c.p); c.guess = false; }
    if (leaders.every((u) => apart(u.p, c.p))) leaders.push(c);
  }
  tried.push(...leaders.map(compass));
  tried.sort((a, b) => a.e - b.e);
  const used = [];
  const nextStarts = (count) => {
    const out = [];
    for (const c of tried) {
      if (out.length >= count) break;
      if (used.every((u) => apart(u.p, c.p))) { used.push(c); out.push(c); }
    }
    return out;
  };
  // Further starts, after a poor fit, are taken from the better half of the points tried,
  // each as far as possible from every start already used, so they look somewhere new.
  const spreadStarts = (count) => {
    const pool = tried.slice(0, Math.max(count, Math.ceil(tried.length / 2))).filter((c) => !used.includes(c));
    const out = [];
    while (out.length < count && pool.length) {
      let far = -1, at = -1;
      pool.forEach((c, i) => { const d = Math.min(...used.map((u) => gap(u.p, c.p))); if (d > far) { far = d; at = i; } });
      if (!(far > 1)) break;
      const [c] = pool.splice(at, 1);
      used.push(c); out.push(c);
    }
    return out;
  };
  const counts = average ? pts.n : null, pure = average ? pts.pure : null;
  // The bounds of a check search: the solution's own, narrowed to the reach of the grid.
  const within = solution.params.map((p, j) => {
    const [a, b] = reach[j];
    return { ...p, min: isNum(p.min) ? Math.max(p.min, a) : a, max: isNum(p.max) ? Math.min(p.max, b) : b };
  });
  const search = (p, maxIterations, check = false) => {
    try {
      const res = leastSquares({ params: check ? within : solution.params, start: p, fixed, model, y: pts.y, counts, maxIterations, stop: late, statistics: false });
      if (res.stopped) cut = true;
      return res;
    } catch {
      return null;
    }
  };
  const ends = [];
  let best = null;
  // A short search from each start, then the best of them carried on to the end.
  const round = (starts, short = SHORT) => {
    let lead = null;
    for (const [i, c] of starts.entries()) {
      if (i > 0 && (pastShare(ROUNDS_SHARE) || late())) { cut = true; break; }
      const res = search(c.p, i > 0 ? short : SHORT, i > 0);
      if (res) ends.push(res);
      if (res && (!lead || res.sse < lead.sse)) lead = res;
      if (progress) progress({ stage: 'search', step: i + 1, of: starts.length + 1 });
    }
    if (lead && !lead.converged && !late()) {
      const more = search(lead.values, FULL);
      if (more && more.sse <= lead.sse) { more.iterations += lead.iterations; ends.push(more); lead = more; }
    } else if (lead && !lead.converged) cut = true;
    if (progress) progress({ stage: 'search', step: starts.length + 1, of: starts.length + 1 });
    if (lead && (!best || lead.sse < best.sse)) best = lead;
  };
  round(nextStarts(STARTS));
  if (!best) throw new Error('The fit did not converge from any starting point. Give starting values for the parameters.');
  // A curve that misses the readings in long runs of one sign may be in a false minimum:
  // try the next best different starts before giving up on it. The runs test is judged
  // against random readings passed through the same fit (runsCalibrated).
  const poor = (res) => {
    if (res.J && res.J.length === k && k) {
      const A = new Float64Array(k * k);
      for (let a = 0; a < k; a++) for (let b = 0; b <= a; b++) {
        let sum = 0;
        for (let i = 0; i < m; i++) sum += res.J[a][i] * res.J[b][i];
        A[a * k + b] = sum; A[b * k + a] = sum;
      }
      return runsCalibrated(res.residuals, res.J, covarianceFactor(A, k).inv, counts);
    }
    const test = runsTest(res.residuals);
    return { ...test, poor: test.valid && test.z < normalQuantile(RUNS_LEVEL) };
  };
  // A profile: each grid point's values other than the first T and S held, and those two
  // fitted to the few readings, so each shape of curve is compared at its own best T and S.
  const profile = () => {
    const main = [solution.params.find((p) => p.kind === 'T' || p.kind === 'K'), solution.params.find((p) => p.kind === 'S' || p.kind === 'Ss')]
      .filter((p) => p && !fixed[p.id]);
    const shape = freeParams.filter((p) => !main.includes(p));
    if (!main.length || !shape.length) return [];
    const seenShape = new Set(), out = [];
    const held = { ...fixed, ...Object.fromEntries(shape.map((p) => [p.id, true])) };
    const modelFew = (p) => drawdownAt(solution, p, g, tFew, opts);
    for (const c of tried) {
      if (pastShare(ROUNDS_SHARE) || late()) { cut = true; break; }
      const key = shape.map((p) => c.p[p.id].toPrecision(3)).join();
      if (seenShape.has(key)) continue;
      seenShape.add(key);
      const p0 = { ...best.values, ...Object.fromEntries(shape.map((p) => [p.id, c.p[p.id]])) };
      try {
        const r = leastSquares({ params: solution.params, start: p0, fixed: held, model: modelFew, y: yFew, maxIterations: 8, statistics: false, stop: late });
        if (Number.isFinite(r.sse)) out.push({ p: r.values, e: r.sse });
      } catch { /* skipped */ }
    }
    out.sort((a, b) => a.e - b.e);
    return out;
  };
  let misfit = poor(best);
  for (let extra = 1; extra <= EXTRA_ROUNDS && misfit.poor; extra++) {
    if (pastShare(ROUNDS_SHARE) || late()) { cut = true; break; }
    let more;
    if (extra === 1) {
      more = [];
      for (const c of profile()) {
        if (more.length >= 2 * STARTS) break;
        if (used.every((u) => apart(u.p, c.p))) { used.push(c); more.push(c); }
      }
    } else more = [...nextStarts(STARTS), ...spreadStarts(STARTS)];
    if (!more.length) break;
    round(more, SHORT_CHECK);
    misfit = poor(best);
  }
  ends.sort((a, b) => a.sse - b.sse);

  // The statistics, once, at the best end, in the time that is left: central differences
  // (4k + 1 calls), or forward ones (k + 1) when that is all there is time for, or none.
  if (progress) progress({ stage: 'statistics' });
  const room = left() - (curve ? MARGIN * perCall() * CURVE_FEW / m : 0);
  const statistics = room > MARGIN * perCall() * (4 * k + 2) ? 'central' : room > MARGIN * perCall() * (k + 2) ? 'forward' : 'none';
  let stats;
  if (statistics === 'none') {
    const free = freeParams.map((p) => p.id);
    stats = {
      values: best.values, free, corr: free.map(() => free.map(() => NaN)), weak: [], nulls: [],
      params: Object.fromEntries(solution.params.map((p) => [p.id, fixed[p.id] ? { value: best.values[p.id], fixed: true }
        : { value: best.values[p.id], se: NaN, lower: NaN, upper: NaN, undetermined: 'time' }])),
      sse: best.sse, rms: best.rms, n: m, df: m - k, t975: m - k > 0 ? tQuantile(0.975, m - k) : NaN, variance: NaN,
      fittedY: best.fittedY, residuals: best.residuals, misfit: poor(best),
    };
  } else {
    stats = leastSquares({ params: solution.params, start: best.values, fixed, model, y: pts.y, counts, pure, maxIterations: 0, differences: statistics, runs: true });
  }
  misfit = stats.misfit;

  // Profile intervals (profileIntervals), in the time left but for the curve's. A profile
  // that finds a better fit than the best means the search had not reached the minimum:
  // the fit is carried on from there, its statistics worked out again, and the profiles
  // begun again, until none does, at most PROFILE_RESTARTS times.
  let intervals = statistics === 'none' ? 'none' : 'profile', improved = null, profileCut = false, profileCalls = 0, restarts = 0;
  if (statistics !== 'none') {
    if (progress) progress({ stage: 'intervals' });
    const keepBack = () => MARGIN * perCall() * (1 + (curve ? CURVE_TIMES / m : 0));
    const stopProfile = () => left() < keepBack();
    for (let restart = 0; ; restart++) {
      const prof = stopProfile() ? null : profileIntervals({ params: solution.params, fixed, model, y: pts.y, stats, stop: stopProfile, better: restart < PROFILE_RESTARTS, reach: looked });
      if (prof) profileCalls += prof.calls;
      restarts = restart;
      // No time to carry the fit on from a closer fit: the time limit has cut it short.
      if (prof && prof.better && left() < keepBack() + MARGIN * perCall() * (4 * k + 2)) {
        for (const id of stats.free) if (!stats.params[id].undetermined) stats.params[id].interval = 'linearized';
        profileCut = true;
        break;
      }
      if (prof && prof.better) {
        const moved = search(prof.better.values, FULL);
        const values = moved && moved.sse <= prof.better.sse ? moved.values : prof.better.values;
        if (!improved) improved = { sse: stats.sse, rms: stats.rms, values: stats.values };
        stats = leastSquares({ params: solution.params, start: values, fixed, model, y: pts.y, counts, pure, maxIterations: 0, differences: statistics, runs: true });
        best = { ...best, values: stats.values, sse: stats.sse, rms: stats.rms, iterations: best.iterations + (moved ? moved.iterations : 0), converged: moved ? moved.converged : best.converged };
        ends.unshift({ values: stats.values, sse: stats.sse, rms: stats.rms });
        continue;
      }
      // A value whose linearized interval was 'wide', or that ended at a bound, takes its
      // profile's verdict, when it has one. A null direction of J'J is kept only where the profiles bear it out: one
      // of a single value, only if the misfit along its profile never rises past the
      // allowance, so that the value changes the drawdown nowhere, not just at the point
      // where the search stopped on a plateau of the misfit (Moench 1985 at Dalem, S ended
      // at 10⁻²⁰ or 10⁻¹⁰ by rounding); one of several, only if none of them is determined
      // along its profile, so that the combination holds over WIDE. The values of a
      // direction dropped take their profiles' verdicts; any other value not determined
      // keeps its own.
      const profiledOk = (id) => Boolean(prof && prof.params[id] && prof.params[id].interval === 'profile');
      const exact = (stats.nulls || []).filter((u) => {
        const ids = Object.keys(u);
        return ids.length > 1 ? !ids.some((id) => profiledOk(id) && !prof.params[id].undetermined) : !ids.some((id) => profiledOk(id) && prof.params[id].rises);
      });
      const combined = new Set(exact.flatMap((u) => Object.keys(u)));
      for (const id of stats.free) {
        const r = stats.params[id];
        const takes = (r.undetermined === 'wide' || r.undetermined === 'limit' || (r.undetermined === 'singular' && !combined.has(id))) && profiledOk(id);
        // A value not determined whose profile was cut short keeps its linearized verdict,
        // and says why: its profile's budget of calls, or a failed call.
        if (r.undetermined && !takes) {
          const q = prof && prof.params[id];
          if (q && q.interval === 'linearized' && (q.budget || q.failed)) Object.assign(r, { interval: 'linearized', ...(q.budget ? { budget: true } : {}), ...(q.failed ? { failed: true } : {}), ...(q.calls ? { calls: q.calls } : {}) });
          continue;
        }
        Object.assign(r, prof ? prof.params[id] || {} : { interval: 'linearized' });
        delete r.rises;
      }
      if (exact.length < (stats.nulls || []).length) {
        stats.nulls = exact;
        stats.weak = stats.free.filter((id) => stats.params[id].undetermined === 'singular');
      }
      if (!prof || prof.stopped) profileCut = true;
      break;
    }
    // Cut by the clock (stopped) or by a profile's budget of calls (not: that is the same
    // on any computer).
    if (profileCut || stats.free.some((id) => stats.params[id].interval === 'linearized')) intervals = stats.free.some((id) => stats.params[id].interval === 'profile') ? 'partial' : 'linearized';
    misfit = stats.misfit;
  }

  // Other ends as good as the best. An end whose sum of squares is no more above the best's
  // than the rise at the ends of a value's 95% interval lies inside that value's profile
  // interval. If it lies outside the interval found, it is in another valley of the
  // misfit, as deep, which the profile did not follow from the best fit: the interval is
  // widened to take it in. A linearized interval may be too narrow in the same way.
  const rivals = [];
  if (statistics !== 'none') {
    for (const e of [...ends].sort((a, b) => a.sse - b.sse)) {
      const rise = e.sse - stats.sse;
      const ids = stats.free.filter((id) => {
        const r = stats.params[id];
        if (r.undetermined || !(rise <= r.edgeRise)) return false;
        const v = e.values[id], tol = 1e-9 * Math.max(Math.abs(r.lower), Math.abs(r.upper));
        return v < r.lower - tol || v > r.upper + tol;
      });
      if (!ids.length) continue;
      // One end of each place: a check end carried on to its own end counts once.
      if (rivals.some((x) => gap(x.values, e.values) < 0.2)) continue;
      rivals.push({ values: e.values, rms: e.rms, sse: e.sse, ids });
    }
    // The interval of such a value is widened to take in every fit as good: a least
    // range, since the profile may reach further still. Wider than WIDE (or WIDE_SKIN),
    // the value is not determined.
    for (const r of rivals) for (const id of r.ids) {
      const q = stats.params[id];
      if (!q.spread) q.spread = [q.value, q.value];
      q.spread = [Math.min(q.spread[0], r.values[id]), Math.max(q.spread[1], r.values[id])];
    }
    for (const id of stats.free) {
      const q = stats.params[id];
      if (!q.spread) continue;
      const kind = solution.params.find((p) => p.id === id).kind;
      q.lower = Math.min(q.lower, q.spread[0]);
      q.upper = Math.max(q.upper, q.spread[1]);
      q.widened = true;
      if (logScale(kind) ? q.upper / q.lower > WIDE : q.upper - q.lower > 2 * WIDE_SKIN) q.undetermined = 'ends';
    }
  }
  const out = {
    ...stats, iterations: best.iterations, converged: best.converged, points: pts, kept: order, used: keep.length, theis: segments.all, segments, misfit,
    ends: ends.map((e) => ({ values: e.values, sse: e.sse, rms: e.rms })), rivals: rivals.slice(0, 3), statistics, intervals, improved,
    stopped: cut || best.stopped || statistics !== 'central' || profileCut, searchCut: cut || best.stopped, perEvaluation, timeLimit, profileCalls,
    restarts, restartsCut: restarts >= PROFILE_RESTARTS,
  };
  if (curve) {
    // The fitted curve on CURVE_TIMES times from a quarter of a log cycle before the first
    // point to a quarter after the last, or on CURVE_FEW when time is short, or, with no
    // time left, at the points fitted.
    if (progress) progress({ stage: 'curve' });
    const times = left() > MARGIN * perCall() * CURVE_TIMES / m ? CURVE_TIMES : left() > MARGIN * perCall() * CURVE_FEW / m ? CURVE_FEW : 0;
    if (times) {
      const tc = logTimes(pts.t[0] / libm.pow(10, 0.25), pts.t[m - 1] * libm.pow(10, 0.25), times);
      out.curve = { t: tc, s: drawdownAt(solution, out.values, g, tc, opts) };
    } else out.curve = { t: pts.t.slice(), s: out.fittedY.slice() };
    out.curveTimes = times;
    if (times < CURVE_TIMES) out.stopped = true;
  }
  out.seconds = (Date.now() - began) / 1000;
  return out;
}

/**
 * fitSolution with the fitted curve: on 160 times spread evenly in log time, from a
 * quarter of a log cycle before the first point to a quarter after the last, so a log
 * derivative over 0.2 log cycles either side reaches the ends of the data (fewer when the
 * time limit is near). Everything it returns is plain data, so it can come back from a
 * Web Worker.
 */
export const fitWithCurve = (input) => fitSolution({ ...input, curve: true });
