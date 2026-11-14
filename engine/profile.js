// Profile intervals.
import { isNum } from './numeric.js';
import { fitBounds, fromFit, leastSquares, logScale, toFit, WIDE, WIDE_SKIN } from './lsq.js';
import * as libm from './libm.js';

// Each refit along a profile runs at most this many iterations, and has settled when a
// step lowers the sum of squares by less than PROFILE_SETTLE of the allowance: an error in
// sqrt(rise / allowance) of about 0.5% near an end, a tenth of the root search's
// tolerance, where a value the readings barely fix would otherwise keep a refit crawling
// for many iterations. With the slopes updated, an iteration costs one call or so, so 30
// of them cost less than the 20 with fresh slopes did; on Moench (1997) at Vennebulten, 20
// left the refits along α short of the profile's floor.
const PROFILE_ITERATIONS = 30;
const PROFILE_SETTLE = 1e-2;
// At most this many steps of the root search, which stops when sqrt(rise / allowance) is
// within PROFILE_CLOSE of 1: an end then within about 5% of the interval's half-width.
const PROFILE_ROOT = 8;
const PROFILE_CLOSE = 0.05;
// A refit below the best fit's sum of squares by more than this share of the allowance
// is a better fit than the best: the search had not reached the minimum. Less than that
// moves no end of an interval by more than about 2.5% of its half-width, inside the root
// search's own tolerance, and is taken as no rise.
export const PROFILE_BETTER = 0.05;
// Each value's profile may call the solution at most this many times for each free value,
// a fixed number of calls rather than a time, so the answer is the same on any computer.
// One that needs more keeps its linearized interval (budget), and says so. A profile
// takes about four to ten refits, each a few calls with the slopes updated and k to work
// them out afresh before it settles: about 10 to 55 k calls on the records tested, the
// most at Vennebulten with Moench (1997). A budget is a line, and a profile that needs
// about as many calls as it allows is cut or not as the last digits go: at 50 k, as until
// round 9, S and Sy at Vennebulten were cut with the readings' times as minutes × 60 /
// 86400 and not with minutes / 1440, and Sy at 15 m in Node and not in Chrome. So the
// budget is three times the most any of them needs, and is met only where the refits
// crawl along a direction the readings barely fix.
export const PROFILE_CALLS = 150;
// The stations of a profile, fixed in the value, not set from the best fit: whole decades
// on its log scale, a third of WIDE apart, or for skin multiples of a third of 2 WIDE_SKIN.
// Where a value ends on a plateau of the misfit, the part of the plateau the search stopped
// on is a matter of rounding, so steps set from there, and the refits that start from
// them, would make the verdicts depend on rounding too (Vennebulten, Moench 1997: Kz/Kr
// ended anywhere from 0.65 to 2 x 10^6 under changes of 10^-10 in the drawdown).
const station = (kind) => (logScale(kind) ? libm.log(WIDE) / 3 : (2 * WIDE_SKIN) / 3);
// At most this many stations on one side.
const STATIONS_OUT = 40;
// A refit's first guess carries the others on along the line through the last two points
// of the profile at most this many times the last step: from a station just past the best
// fit to the next, a whole station on, the line would otherwise magnify the small moves
// of the first step many times.
const REACH_OUT = 4;
// A refit past the allowance by less than this in sqrt(rise / allowance), four times the
// allowance in the rise, may have stayed in the wrong branch of the valley (retried).
const RETRY_Q = 2;
// Such a refit again runs at most this many iterations: from a fit as good at about the
// value held it settles in a few, and one that does not is not on the other branch.
const RETRY_ITERATIONS = 10;
// A side's first point past the allowance is followed by the next station beyond it only
// where that is at most this many times as far from the best fit (pastRidge): as far as
// a side's own steps grow (stationSide, 1.5 to 4 times as far each step).
const PROBE_REACH = 4;

/**
 * The 95% interval of each free value from its profile (Bates and Watts 1988, chapter 6;
 * Vecchia and Cooley 1987; Hill and Tiedeman 2007): the value is held at a trial value and
 * the others are refitted, and the interval is where that least sum of squares stays
 * within edgeRise of the best fit's (t² s² for equal weights). Where the misfit's valley
 * is straight in the fitted values this is the linearized interval; where it curves, as
 * when S and skin trade off in a pumped well, the profile follows it.
 *   stats:  leastSquares' result at the best fit, with its statistics.
 *   params, fixed, model, y: as leastSquares took them.
 *   stop:   optional, () => true to stop (a time limit). The values not done then keep
 *           their linearized intervals, with interval: 'linearized'.
 *   better: true (the default) to stop at a refit that fits better than the best, and
 *           return it; false to carry on, taking its rise as zero.
 *   budget: the calls of model() each value's profile may make, for each free value
 *           (PROFILE_CALLS). A value whose profile needs more keeps its linearized
 *           interval, with interval: 'linearized' and budget: true.
 *   reach:  optional, { id: [lo, hi] }: the range the search looked in for each value,
 *           in its own units (fitSolution). A side of a profile that finds no end is
 *           followed at least to the end of it.
 * Each value with a linearized interval that is not 'wide' is first held at the ends of
 * it (its opening), the others refitted by Levenberg-Marquardt from the best fit, moved as
 * (J'J)^-1 says they follow it; every such value is held there before any is followed
 * further, the widest first, since that is where a closer fit than the best is most often
 * found. Each refit starts from the slopes of the last on that side and updates them as it
 * goes (leastSquares, broyden). Where the rise there falls short of the allowance, the
 * value is stepped outward, on its log scale, 1.5 to 4 times as far each step but never
 * past the next station (station), until the rise reaches the allowance, or it meets a
 * bound, or it is past the end of reach and the range checked spans WIDE (2 WIDE_SKIN for
 * skin). A root search on sqrt(rise), near straight in the value, then finds the end.
 * A value whose linearized interval is 'wide' is profiled first of all, from the best fit
 * outward at its stations alone, and its verdict is its profile's, not the linearized
 * one's: where it ends on a plateau of the misfit, where on the plateau the search stopped
 * is a matter of rounding, and the stations, fixed in the value, are not. A station below
 * the best fit by more than the refits' own precision (PROFILE_SETTLE of the allowance) is
 * returned as better: so a deeper valley anywhere on the plateau is found, which the
 * steps of a refit, with slopes near zero there, cannot reach. A value not determined has
 * each closed end of its range at the last station as good. A refit just past the
 * allowance is tried again from a fit as good that another profile found at about the
 * value held (retried), and every fit as good found widens the intervals it lies outside.
 * Past a side's first point beyond the allowance, the next station is refitted too
 * (pastRidge), where it is near enough: as good there, the side goes on past the ridge;
 * better, it is returned. A value that ended at a bound ('limit') with a standard error
 * is profiled as the others, on its free side; its interval runs from the bound (clipped).
 * The work is fixed, so the answer is the same on any computer.
 * Returns { params, better, stopped, refits, calls }: params is { id: { lower, upper,
 * interval: 'profile', clipped?, further?, widened?, undetermined, moves?, calls } },
 * undetermined being 'flat' where the readings fit as well over more than WIDE, with
 * lower and upper the range checked, further ('lower', 'upper' or 'both') where it may
 * reach beyond (a side that stopped without closing, or one widened past WIDE by a fit as
 * good, which is a point of the range, not its end), and moves the other values that
 * moved with it, and null otherwise, also for a value whose linearized interval was
 * 'wide' or that ended at a bound; widened where fits as good found along other profiles,
 * or past a ridge, lie beyond the ends the profile would have alone; rises where the
 * misfit rises past the allowance on either side; calls, the calls its profile made. A
 * value whose profile was cut short has { interval: 'linearized' } and budget (its budget
 * of calls) or failed (a call that failed) where that was the cause. better is { values,
 * sse } or null.
 */
export function profileIntervals({ params, fixed = {}, model, y, stats, stop = null, better = true, budget = PROFILE_CALLS, reach = null }) {
  const free = params.filter((p) => !fixed[p.id]);
  const k = free.length;
  // The calls of the solution for the value being profiled, against its budget.
  let spent = 0, overspent = false;
  const counted = (v) => { spent++; return model(v); };
  const ask = () => (stop && stop()) || (overspent = spent >= budget * k);
  const x0 = free.map((p) => toFit(p.kind, stats.values[p.id]));
  const bounds = free.map(fitBounds);
  const inv = stats.factor, base = stats.sse;
  // The values the readings do not fix, and the largest move of each in one step.
  const loose = free.map((p) => Boolean(stats.params[p.id].undetermined));
  const stepCap = free.map((p) => (logScale(p.kind) ? Math.LN10 : 10));
  // The range the search looked in, on the fit scale; without one, the best fit.
  const hasReach = free.map((p) => { const r = reach && reach[p.id]; return Array.isArray(r) && r.length === 2 && r.every(isNum) && r[0] < r[1] && (!logScale(p.kind) || r[0] > 0); });
  const looked = free.map((p, j) => (hasReach[j] ? reach[p.id].map((v) => toFit(p.kind, v)) : [x0[j], x0[j]]));
  // How far a value may move with the readings fitting as well before it is not
  // determined: WIDE on the log scale, 2 WIDE_SKIN for skin.
  const total = (j) => (logScale(free[j].kind) ? libm.log(WIDE) : 2 * WIDE_SKIN);
  const out = {};
  let refits = 0, stopped = false, found = null, calls = 0;
  const HALT = {};
  // Every refit as good as its own allowance, along any profile so far: the valley of the
  // misfit as far as it has been followed.
  const good = [];
  // The least sum of squares with value j held at z, the others starting from guess, in
  // at most iterations.
  const refit = (j, z, guess, allow, seed, iterations = PROFILE_ITERATIONS) => {
    const start = { ...stats.values };
    free.forEach((p, i) => { const [a, b] = bounds[i]; start[p.id] = fromFit(p.kind, Math.min(b, Math.max(a, i === j ? z : guess[i]))); });
    refits++;
    const res = leastSquares({ params, start, fixed: { ...fixed, [free[j].id]: true }, model: counted, y, maxIterations: iterations, tolerance: PROFILE_SETTLE * allow / base, predicted: true, broyden: true, jacobian: seed, stop: ask, statistics: false });
    if (res.stopped) { if (!overspent) stopped = true; throw HALT; }
    return { x: free.map((p) => toFit(p.kind, res.values[p.id])), sse: res.sse, values: res.values, J: res.J };
  };
  // Each refit is a continuation from the nearest point of the profile on the near side
  // of the end, lo (the best fit at first): it starts from lo's slopes, and from where
  // the others follow the held value from there. At the best fit that is as (J'J)^-1
  // says; further out, on the line through lo and the point before it. Neither moves a
  // value the readings do not fix, nor any other by more than the search's own step.
  // A refit past the end may have stopped in another valley of the misfit, so no refit
  // starts from one. With from, a fit as good found before (good), the others start where
  // they were there, in at most RETRY_ITERATIONS. With judged, the caller judges whether
  // the refit fits better than the best (stationSide).
  const atFor = (j, s, allow, judged = false) => {
    const start0 = Array.isArray(stats.J) && stats.J.length === k ? stats.J.filter((_, i) => i !== j) : null;
    return (d, lo, prev, from = null) => {
      const guess = from ? from.x.slice() : (prev ? lo.x.map((v, i) => (v - prev.x[i]) * Math.min(REACH_OUT, (d - lo.d) / (lo.d - prev.d)))
        : x0.map((v, i) => (inv[j * k + j] > 0 ? s * (d - lo.d) * inv[i * k + j] / inv[j * k + j] : 0)))
        .map((u, i) => (i === j || loose[i] ? 0 : Math.max(-stepCap[i], Math.min(stepCap[i], u))) + lo.x[i]);
      const seed = from ? (from.held === j ? from.J : null) : lo.J;
      const pt = refit(j, x0[j] + s * d, guess, allow, seed || start0, from ? RETRY_ITERATIONS : PROFILE_ITERATIONS);
      pt.held = j;
      if (pt.sse <= base + allow) good.push(pt);
      if (!judged && better && pt.sse < base - PROFILE_BETTER * allow) { found = pt; throw HALT; }
      return { ...pt, d, q: Math.sqrt(Math.max(0, pt.sse - base) / allow) };
    };
  };
  const origin = { d: 0, q: 0, x: x0, J: null };
  // A side's first refit past the allowance, by less than RETRY_Q, is tried again from the
  // fit as good (good) nearest in the value held, found along another value's profile, if
  // that is nearer to it than the point it started from, and the lower kept. Where values
  // the readings do not fix trade off with the one held, a refit carried on from the last
  // point can stay in a branch of the valley that rises sooner than another, and which
  // branch it stays in turns on rounding; a fit as good on the other branch at about the
  // value held says so, and lets it cross.
  const retried = (at, j, s, d, lo, pt) => {
    if (!(pt.q >= 1 && pt.q < RETRY_Q)) return pt;
    const z = x0[j] + s * d, allow = (pt.sse - base) / (pt.q * pt.q);
    let near = null;
    for (const c of good) if (c.sse <= base + allow && c.held !== j && (!near || Math.abs(c.x[j] - z) < Math.abs(near.x[j] - z))) near = c;
    if (!near || !(Math.abs(near.x[j] - z) < Math.abs(lo.x[j] - z))) return pt;
    const again = at(d, lo, null, near);
    return again.sse < pt.sse ? again : pt;
  };
  // The root of sqrt(rise / allowance) - 1 between lo (short of the allowance) and hi
  // (past it), by false position with the Illinois change (Dowell and Jarratt 1971): an
  // end kept twice in a row has its value halved. Where the far end is many times further
  // past the allowance than the near end is short of it, the try goes to the geometric
  // mean of the two: false position alone would creep up on a steep wall, where another
  // value meets its bound, and halving alone takes many steps where the linearized
  // interval is many times too wide. Returns { d, lo }.
  const rootSearch = (at, lo, prev, hi) => {
    let fl = lo.q - 1, fh = hi.q - 1, kept = 0;
    const root = () => lo.d + fl / (fl - fh) * (hi.d - lo.d);
    for (let step = 0; step < PROFILE_ROOT && fh > PROFILE_CLOSE && fl < -PROFILE_CLOSE; step++) {
      const w = fh > -4 * fl ? Math.sqrt(0.5 * fl / (fl - fh)) : fl / (fl - fh);
      const pt = at(lo.d + w * (hi.d - lo.d), lo, prev);
      if (pt.q >= 1) { hi = pt; fh = pt.q - 1; if (kept < 0) fl /= 2; kept = kept < 0 ? kept - 1 : -1; }
      else { prev = lo; lo = pt; fl = pt.q - 1; if (kept > 0) fh /= 2; kept = kept > 0 ? kept + 1 : 1; }
    }
    return { d: root(), lo };
  };
  // Past the first point of a side where the rise reaches the allowance (hi), the next
  // station beyond it, refitted carried on from hi, where that is inside the range the
  // search looked in and the bounds, and no more than PROBE_REACH times as far from the
  // best fit as hi, as far as one step of the profile goes (stationSide): a valley of the
  // misfit behind a ridge, as deep as the best fit's or deeper, is found there. Returns
  // that refit when it is as good, null when it is not, and stops at it (found) when it is
  // better than the best fit by more than the refits' own precision. On Hantush (1960), T
  // 100 m²/d, S 10⁻⁴, c 1000 d, S′ 10⁻³, 5 mm of noise, 9 runs in 200 ended at c near
  // 2700 d, behind a ridge 1 Δ high at 2000 d from a valley at the true values 3.6 to 5.3
  // Δ deeper, which no profile reached. Past a narrow interval, the next station is too
  // far to say anything, and a refit there can wander where the solution is slow.
  const pastRidge = (j, s, allow, lo, hi) => {
    const h = station(free[j].kind), fuzz = 1e-9 * h;
    const room = s > 0 ? bounds[j][1] - x0[j] : x0[j] - bounds[j][0];
    if (!hasReach[j] || hi.d >= room) return null;
    const z = x0[j] + s * hi.d, end = s > 0 ? looked[j][1] : looked[j][0];
    const next = (s > 0 ? Math.floor((z + fuzz) / h) + 1 : Math.ceil((z - fuzz) / h) - 1) * h;
    const d = Math.min(room, s * (next - x0[j]));
    if (s * (next - end) > fuzz || d > PROBE_REACH * hi.d) return null;
    const pt = atFor(j, s, allow, true)(d, hi, lo);
    pt.station = true;
    if (better && pt.sse < base - PROFILE_SETTLE * allow) { found = pt; throw HALT; }
    return pt.q < 1 ? pt : null;
  };
  // One side of value j's profile, carried on from state.lo (the best fit, or the opening)
  // to the next station each time: it ends closed at the first point where the rise
  // reaches the allowance (hi), unless the station beyond is as good (pastRidge: the side
  // goes on from there, with ridge set), at a bound, or open, once it is past the end of
  // the range the search looked in and the range checked, from other (on the fit scale)
  // to here, spans WIDE. A station below the best fit by more than the refits' own
  // precision (PROFILE_SETTLE of the allowance) is a better fit; any other refit, by
  // PROFILE_BETTER.
  const stationSide = (j, s, allow, state, other, closing = false) => {
    const at = atFor(j, s, allow, true), h = station(free[j].kind), fuzz = 1e-9 * h;
    const room = s > 0 ? bounds[j][1] - x0[j] : x0[j] - bounds[j][0];
    const end = s > 0 ? looked[j][1] : looked[j][0];
    // Is position z past the end of reach, or toward it from beyond the other end?
    const past = (z) => s * (z - end) >= -fuzz;
    const before = (z) => s * (z - (s > 0 ? looked[j][0] : looked[j][1])) < -fuzz;
    for (let n = 0; n < STATIONS_OUT; n++) {
      const z = x0[j] + s * state.lo.d;
      if (state.lo.d >= room) return { d: room, lo: state.lo, edge: 'bound', ridge: state.ridge };
      if (past(z) && Math.abs(z - other) >= total(j) - fuzz) return { d: state.lo.d, lo: state.lo, edge: 'open', ridge: state.ridge };
      // The next station past z, a hair inside counting as on it.
      let next = (s > 0 ? Math.floor((z + fuzz) / h) + 1 : Math.ceil((z - fuzz) / h) - 1) * h;
      let d = Math.min(room, s * (next - x0[j]));
      // From a point past the best fit, a step 1.5 to 4 times as far from it as that point
      // (by 1.05 / sqrt(rise / allowance)): toward the range from beyond it, where that
      // passes stations, up to the range's end, and only the stations count there; and
      // with closing, where that is short of the next station, so that steps near an end
      // close in on it as the linearized interval says they should.
      if (state.lo.d > 0) {
        const grown = state.lo.d * Math.min(4, Math.max(1.5, 1.05 / Math.max(state.lo.q, 1e-6)));
        const far = s * ((s > 0 ? looked[j][0] : looked[j][1]) - x0[j]);
        if (before(z) ? grown > d : closing && grown < d) { d = Math.min(room, before(z) ? far : Infinity, grown); next = x0[j] + s * d; }
      }
      const pt = retried(at, j, s, d, state.lo, at(d, state.lo, state.prev));
      pt.station = Math.abs(next / h - Math.round(next / h)) < 1e-9 || d >= room;
      if (better && pt.sse < base - (pt.station ? PROFILE_SETTLE : PROFILE_BETTER) * allow) { found = pt; throw HALT; }
      if (pt.q >= 1) {
        const b = pastRidge(j, s, allow, state.lo, pt);
        if (!b) return { d: state.lo.d, lo: state.lo, prev: state.prev, hi: pt, at: atFor(j, s, allow), edge: 'closed', ridge: state.ridge };
        state.prev = pt; state.lo = b; state.ridge = true;
        continue;
      }
      state.prev = state.lo; state.lo = pt;
    }
    return { d: state.lo.d, lo: state.lo, edge: 'steps', ridge: state.ridge };
  };
  // A closed side's end between its last point as good and the first past, by the root
  // search: always while the value may still be determined, and otherwise where that last
  // point is not a station (the best fit, the opening, or a step toward the range).
  const settle = (e, flat) => (e.edge === 'closed' && (!flat || !e.lo.station) ? { ...rootSearch(e.at, e.lo, e.prev, e.hi), edge: 'closed', ridge: e.ridge } : e);
  // Value j's profile, both sides. Each starts from its opening (first), the refit at the
  // end of the linearized interval, where there is one: past the allowance there, the end
  // lies between it and the best fit; short of it, the side is carried on from there at
  // stations. The lower side goes first, to the end of reach; the upper then until the
  // range checked spans WIDE; and the lower further, if it is still short of that. Where
  // the points as good span WIDE, the value is not determined, and each closed side's end
  // is given to the station, the last as good: an end found between stations would turn
  // on how the refits there settle, where values the readings do not fix trade off in more
  // than one way. Otherwise each closed side's end is found by the root search.
  const profile = (j, allow, first = {}) => {
    const begin = (sd) => (first[sd] && first[sd].q < 1 ? { lo: first[sd], prev: origin } : { lo: origin, prev: null });
    // An opening past the allowance closes its side, unless the station beyond it is as
    // good (pastRidge): the side is then carried on from there.
    const shut = (sd, state) => {
      if (!first[sd] || first[sd].q < 1) return null;
      const at = atFor(j, sd, allow), hi = retried(at, j, sd, first[sd].d, origin, first[sd]);
      if (!(hi.q >= 1)) return null;
      const b = pastRidge(j, sd, allow, origin, hi);
      if (!b) return { d: 0, lo: origin, prev: null, hi, at, edge: 'closed' };
      state.lo = b; state.prev = hi; state.ridge = true;
      return null;
    };
    const below = begin(-1), above = begin(1);
    // With an opening, the value is near determined, and the steps close in on an end.
    const closing = first[-1] !== undefined || first[1] !== undefined;
    let dn = shut(-1, below) || stationSide(j, -1, allow, below, hasReach[j] ? Infinity : x0[j], closing);
    const up = shut(1, above) || stationSide(j, 1, allow, above, x0[j] - dn.d, closing);
    if (dn.edge === 'open' && dn.d + up.d < total(j)) dn = stationSide(j, -1, allow, below, x0[j] + up.d, closing);
    const flat = dn.d + up.d >= total(j) - 1e-9;
    return { dn: settle(dn, flat), up: settle(up, flat) };
  };
  // The interval or range from the two sides of a profile, and the verdict.
  const verdict = (j, down, up) => {
    const p = free[j];
    const q = { lower: fromFit(p.kind, x0[j] - down.d), upper: fromFit(p.kind, x0[j] + up.d), interval: 'profile' };
    // A side carried on past a ridge takes in fits as good beyond it (pastRidge).
    if (down.ridge || up.ridge) q.widened = true;
    if (down.edge === 'bound') q.clipped = 'lower';
    if (up.edge === 'bound') q.clipped = 'upper';
    const beyond = (e) => e.edge === 'steps' || e.edge === 'open';
    if (beyond(down) || beyond(up)) q.further = beyond(down) && beyond(up) ? 'both' : beyond(down) ? 'lower' : 'upper';
    q.undetermined = down.d + up.d >= total(j) * (1 - 1e-9) ? 'flat' : null;
    // Whether the misfit rises past the allowance on either side (fitSolution: a value in a
    // null direction of J'J whose misfit rises is not in an exact combination).
    q.rises = down.edge === 'closed' || up.edge === 'closed';
    if (q.undetermined) {
      // The others that moved with it, at the far ends checked, by more than their own
      // linearized half-width and a factor of 2 (or 1 in skin).
      q.moves = free.filter((o, i) => i !== j && [down.lo.x, up.lo.x].some((x) => {
        const h = stats.t975 * stats.params[o.id].seFit;
        return Math.abs(x[i] - x0[i]) > Math.max(Number.isFinite(h) ? h : 0, logScale(o.kind) ? Math.LN2 : 1);
      })).map((o) => o.id);
    }
    return q;
  };
  const usable = (r) => r.edgeRise > 0 && r.seFit > 0;
  // A value in a null direction of J'J has no allowance of its own: it takes the middle of
  // the others' (each t² s² for equal weights), or t² s² where none has one.
  const allowances = free.map((p) => stats.params[p.id].edgeRise).filter((v) => v > 0).sort((a, b) => a - b);
  const common = allowances.length ? allowances[Math.floor(allowances.length / 2)] : stats.t975 * stats.t975 * stats.variance;
  const allowOf = (j) => (usable(stats.params[free[j].id]) ? stats.params[free[j].id].edgeRise : common);
  // A value that ended at a bound ('limit') is profiled on its free side alone, as one
  // determined or one whose linearized interval is wide, by that interval's half on the
  // free side: the misfit is a function of the value on that side of the bound as on any
  // other (Hill and Tiedeman 2007), and the interval runs from the bound to where the rise
  // reaches the allowance, cut at the bound (clipped).
  const wideLinear = (j) => { const half = stats.t975 * stats.params[free[j].id].seFit; return logScale(free[j].kind) ? 2 * half > libm.log(WIDE) : half > WIDE_SKIN; };
  const profiled = free.map((p, j) => j).filter((j) => { const r = stats.params[free[j].id]; return (!r.undetermined || (r.undetermined === 'limit' && !wideLinear(j))) && usable(r); });
  const scanned = free.map((p, j) => j).filter((j) => {
    const r = stats.params[free[j].id];
    return ((r.undetermined === 'wide' || (r.undetermined === 'limit' && wideLinear(j))) && usable(r)) || (r.undetermined === 'singular' && common > 0);
  });
  const failed = (p, e) => {
    if (e !== HALT) out[p.id] = { interval: 'linearized', failed: true };
    else if (overspent) out[p.id] = { interval: 'linearized', budget: true };
    else if (!found) out[p.id] = { interval: 'linearized' };
  };
  // First the values the readings do not fix ('wide', or in a null direction of J'J), each
  // over the whole of its plateau: where the search stopped on one, a deeper valley
  // elsewhere on it is found here, before any other value's profile is begun from the
  // wrong place.
  for (const j of scanned) {
    if (stopped || found) break;
    const p = free[j];
    spent = 0; overspent = false;
    try {
      const { dn, up } = profile(j, allowOf(j));
      out[p.id] = verdict(j, dn, up);
    } catch (e) {
      failed(p, e);
    }
    if (out[p.id]) out[p.id].calls = spent;
    calls += spent;
  }
  // Then every other value is held at both ends of its linearized interval, where a
  // profile most often finds a closer fit than the search, if there is one, before any is
  // followed further: so a fit carried on from a closer one loses little work. The
  // widest intervals first, as a share of WIDE (or of WIDE_SKIN for skin): where the
  // readings fix a value least, the search is likeliest to have stopped short.
  const share = (j) => (stats.t975 * stats.params[free[j].id].seFit) / (logScale(free[j].kind) ? libm.log(WIDE) : 2 * WIDE_SKIN);
  const openings = {}, usedBy = {}, order = [...profiled].sort((a, b) => share(b) - share(a) || a - b);
  for (const j of order) {
    if (stopped || found) break;
    const r = stats.params[free[j].id], h0 = stats.t975 * r.seFit;
    spent = 0; overspent = false;
    openings[j] = {};
    try {
      for (const sd of [-1, 1]) {
        const room = sd > 0 ? bounds[j][1] - x0[j] : x0[j] - bounds[j][0], d = Math.min(h0, room);
        if (d > 0) openings[j][sd] = atFor(j, sd, r.edgeRise)(d, origin, null);
      }
    } catch (e) {
      if (e !== HALT) openings[j].failed = true;
    }
    usedBy[j] = spent; calls += spent;
  }
  for (const j of scanned) if (!out[free[j].id]) out[free[j].id] = { interval: 'linearized' };
  // Then each followed out, in the same order: the fits as good that the widest find are
  // there for the rest (retried).
  for (const j of order) {
    const p = free[j], r = stats.params[p.id];
    if (stopped || found) { out[p.id] = { interval: 'linearized' }; continue; }
    if (openings[j].failed) { out[p.id] = { interval: 'linearized', failed: true }; continue; }
    spent = usedBy[j]; overspent = false;
    try {
      const { dn, up } = profile(j, r.edgeRise, openings[j]);
      out[p.id] = verdict(j, dn, up);
    } catch (e) {
      failed(p, e);
    }
    if (out[p.id]) out[p.id].calls = spent;
    calls += spent - usedBy[j];
  }
  // Every refit as good as a value's own allowance lies inside that value's profile
  // interval, whichever profile found it, since the profile is the least sum of squares
  // over the others: where a profile carried on from the best fit stayed in one branch of
  // the valley and another found fits as good beyond its ends, its interval is widened to
  // take them in. Wider than WIDE then, the value is not determined, and each side so
  // widened may reach further (further): a fit as good is a point of the range, not its end.
  if (!found) free.forEach((p, j) => {
    const q = out[p.id], r = stats.params[p.id];
    if (!q || q.interval !== 'profile' || q.undetermined) return;
    let down = false, up = false;
    for (const c of good) {
      if (!(c.sse <= base + r.edgeRise)) continue;
      const v = c.values[p.id];
      if (v < q.lower) { q.lower = v; q.widened = true; down = true; }
      if (v > q.upper) { q.upper = v; q.widened = true; up = true; }
    }
    if ((down || up) && toFit(p.kind, q.upper) - toFit(p.kind, q.lower) >= total(j)) {
      q.undetermined = 'flat'; q.moves = [];
      const lower = down || q.further === 'lower' || q.further === 'both', upper = up || q.further === 'upper' || q.further === 'both';
      q.further = lower && upper ? 'both' : lower ? 'lower' : 'upper';
    }
  });
  return { params: out, better: found ? { values: found.values, sse: found.sse } : null, stopped, refits, calls };
}
