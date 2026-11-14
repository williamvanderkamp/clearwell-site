// Superposition: the drawdown of a solution for things the solution itself leaves out.
//   In time, for a schedule of pumping rates: each change of rate starts a new well
//   pumping the change, from the time of the change.
//   In space, for several pumping wells and for straight boundaries, by image wells
//   (Ferris et al. 1962; Kruseman and de Ridder 1994, chapter 6): a constant head
//   boundary is an image well injecting, a no-flow boundary an image well pumping.
// Both rest on the flow equation being linear. Space needs a solution whose drawdown
// depends on position only through r (images: true). Metres and days throughout.
import { isNum } from './numeric.js';
import * as libm from './libm.js';

/**
 * Checks a schedule of rates, [[t, Q], ...] with t in days and Q in m3/d, each rate held
 * from its time until the next. Times must rise; a rate of 0 is a pause or recovery.
 */
export function checkRates(rates) {
  if (!Array.isArray(rates) || !rates.length) throw new Error('No pumping rate was given.');
  rates.forEach(([t, Q], i) => {
    if (!isNum(t) || !isNum(Q)) throw new Error(`Rate change ${i + 1} needs a time and a rate, both numbers.`);
    if (Q < 0) throw new Error(`Rate change ${i + 1} has a rate below zero. Injection is not handled here.`);
    if (i > 0 && !(t > rates[i - 1][0])) throw new Error(`The times of the rate changes must rise: change ${i + 1} is not after change ${i}.`);
  });
  return rates;
}

/** The changes of rate, [[t, dQ], ...], with the steps that change nothing left out. */
export function rateSteps(rates) {
  const out = [];
  rates.forEach(([t, Q], i) => {
    const dQ = Q - (i ? rates[i - 1][1] : 0);
    if (dQ !== 0) out.push([t, dQ]);
  });
  return out;
}

// One source, at the solution's own geometry g, pumping the rate schedule: the sum over
// the steps of each change of rate, from its time on. drawdown() is called with the size
// of the change and its sign applied after, so no solution is asked for a negative Q.
// pointwise is for a solution that computes each time on its own, as Theis's, Hantush and
// Jacob's and De Glee's do: then each time since a change of each size is computed once,
// since a schedule repeated year by year comes to the same times since a change again.
function scheduled(solution, p, g, t, steps, pointwise = false) {
  const s = new Array(t.length).fill(0);
  if (t.length === 1) {
    for (const [t0, dQ] of steps) if (t[0] > t0) s[0] += Math.sign(dQ) * solution.drawdown(p, g, [t[0] - t0], Math.abs(dQ))[0];
    return s;
  }
  if (pointwise) {
    // The drawdown for each size of change, at each time since a change of that size.
    const bySize = new Map();
    for (const [t0, dQ] of steps) {
      const Q = Math.abs(dQ);
      if (!bySize.has(Q)) bySize.set(Q, new Map());
      const at = bySize.get(Q);
      for (const x of t) if (x > t0) at.set(x - t0, 0);
    }
    for (const [Q, at] of bySize) {
      const dt = [...at.keys()], part = solution.drawdown(p, g, dt, Q);
      dt.forEach((x, i) => at.set(x, part[i]));
    }
    for (const [t0, dQ] of steps) {
      const at = bySize.get(Math.abs(dQ)), sign = Math.sign(dQ);
      t.forEach((x, i) => { if (x > t0) s[i] += sign * at.get(x - t0); });
    }
    return s;
  }
  for (const [t0, dQ] of steps) {
    const idx = [], dt = [];
    t.forEach((x, i) => { if (x > t0) { idx.push(i); dt.push(x - t0); } });
    if (!idx.length) continue;
    const part = solution.drawdown(p, g, dt, Math.abs(dQ));
    idx.forEach((i, j) => { s[i] += Math.sign(dQ) * part[j]; });
  }
  return s;
}

/** Drawdown at times t from one well pumping a schedule of rates, at the geometry g. */
export const rateDrawdown = (solution, p, g, t, rates) => scheduled(solution, p, g, t, rateSteps(checkRates(rates)));

// ---------------------------------------------------------------------------------------
// Image wells.

// A boundary is a straight line, x = at or y = at, with type 'head' (constant head, the
// image injects: sign -1) or 'noflow' (the image pumps: sign +1).
const SIGN = { head: -1, noflow: 1 };
const reflect = (w, line) => (line.axis === 'x'
  ? { x: 2 * line.at - w.x, y: w.y, sign: w.sign * SIGN[line.type] }
  : { x: w.x, y: 2 * line.at - w.y, sign: w.sign * SIGN[line.type] });

/** Throws unless lines are at most two boundaries, as imageRings takes them, and two parallel ones apart. */
export function checkLines(lines) {
  if (lines.length > 2) throw new Error('At most two boundaries can be handled.');
  for (const l of lines) {
    if (!(l.axis === 'x' || l.axis === 'y') || !isNum(l.at)) throw new Error('A boundary needs its line, x = a or y = a.');
    if (!SIGN[l.type]) throw new Error('A boundary must be constant head or no flow.');
  }
  if (lines.length === 2 && lines[0].axis === lines[1].axis && lines[0].at === lines[1].at) throw new Error('Two parallel boundaries must be apart.');
}

/**
 * The number of boundaries in an arrangement as the forms give it, 'one', 'parallel' or
 * 'right', once it and the type of each boundary ('head' or 'noflow') are checked.
 * place(i), where given, checks boundary i's position in the form's own terms, after its
 * type, so the first thing missing is the one named.
 */
export function checkArrangement({ arrangement, types }, place = () => {}) {
  if (!['one', 'parallel', 'right'].includes(arrangement)) throw new Error('Choose how the boundaries are arranged.');
  const count = arrangement === 'one' ? 1 : 2;
  for (let i = 0; i < count; i++) {
    if (!SIGN[types[i]]) throw new Error(`Choose the type of boundary ${i + 1}.`);
    place(i);
  }
  return count;
}

/**
 * The image wells of a well at { x, y } for one or two straight boundaries, in rings:
 * ring n holds the images made by n reflections. One boundary, or two at right angles,
 * have a finite set (one ring, or two). Two parallel boundaries have an endless series,
 * so ring(n) gives each ring on request.
 */
export function imageRings(well, lines) {
  checkLines(lines);
  const w0 = { x: well.x, y: well.y, sign: 1 };
  if (lines.length === 0) return { finite: true, ring: () => [] , count: 0 };
  if (lines.length === 1) return { finite: true, count: 1, ring: (n) => (n === 1 ? [reflect(w0, lines[0])] : []) };
  const [a, b] = lines;
  if (a.axis !== b.axis) {
    // At right angles: one image across each line, and one across both.
    const ia = reflect(w0, a), ib = reflect(w0, b);
    return { finite: true, count: 2, ring: (n) => (n === 1 ? [ia, ib] : n === 2 ? [reflect(ia, b)] : []) };
  }
  // Parallel: two chains of reflections, one starting at each line, alternating.
  const chains = [[w0], [w0]];
  return {
    finite: false,
    ring(n) {
      return [0, 1].map((c) => {
        const chain = chains[c];
        while (chain.length <= n) chain.push(reflect(chain[chain.length - 1], (chain.length + c) % 2 === 1 ? a : b));
        return chain[n];
      });
    },
  };
}

// Past this many rings of a parallel series, the sum is not converging.
const MAX_RINGS = 2000;
// A ring is the last needed once it adds less than this share of the drawdown so far.
export const RING_TOL = 1e-10;
// A drawdown from a Laplace inversion carries a scatter of about 10⁻⁶ of the drawdown
// (fit.js), which does not shrink with distance, so a far ring of such a solution never
// falls below RING_TOL. A true ring is farther away than the one before, so it adds less;
// a ring that is below NOISE_TOL of the drawdown and adds no less than the one before is
// at that noise floor, and the series has converged as far as the solution can tell.
export const NOISE_TOL = 1e-5;

/**
 * Drawdown at the observation point obs = { x, y } at times t, from wells
 * [{ x, y, rates }] and straight boundaries (see imageRings). Each well and image is
 * the solution with g.r set to its distance from obs. Requires images: true, except for
 * one well and no boundaries, which is the solution as it is. pointwise: true for a
 * solution that computes each time on its own (see scheduled).
 */
export function wellsDrawdown(solution, p, g, t, { wells, obs, lines = [], pointwise = false }) {
  if (!(wells.length === 1 && !lines.length) && !solution.images) {
    throw new Error(`${solution.name} cannot be superposed in space, so boundaries and several pumping wells cannot be used with it.`);
  }
  const total = new Array(t.length).fill(0);
  // When the observation is the pumped well itself, each image is read where that well
  // sees it: over the pumped screen (d to l), with no observation-well lag.
  const inWell = isNum(g.rw) && isNum(g.r) && !(g.r > g.rw);
  const away = inWell ? { ...g, ...(isNum(g.d) && isNum(g.l) ? { z1: g.d, z2: g.l } : {}), rcObs: 0 } : g;
  const add = (src, steps) => {
    let r = libm.hypot(src.x - obs.x, src.y - obs.y);
    // The pumped well's own distance is g.r exactly, so a solution that tests r === rw
    // still finds its own well after rounding in the layout.
    const own = Math.abs(r - g.r) <= 1e-9 * Math.max(1, g.r);
    if (own) r = g.r;
    const part = scheduled(solution, p, own ? g : { ...away, r }, t, steps, pointwise);
    part.forEach((v, i) => { total[i] += src.sign * v; });
    return part;
  };
  // Each well's changes of rate, once for the well and all its images.
  const steps = wells.map((w) => rateSteps(checkRates(w.rates)));
  wells.forEach((w, k) => add({ x: w.x, y: w.y, sign: 1 }, steps[k]));
  wells.forEach((w, k) => {
    const rings = imageRings(w, lines);
    if (rings.finite) {
      for (let n = 1; n <= rings.count; n++) rings.ring(n).forEach((src) => add(src, steps[k]));
      return;
    }
    // A parallel series: add rings until one changes the drawdown by less than RING_TOL,
    // or sits at the solution's noise floor (NOISE_TOL).
    let n = 1, before = Infinity;
    for (; n <= MAX_RINGS; n++) {
      let biggest = 0;
      for (const src of rings.ring(n)) {
        const part = add(src, steps[k]);
        for (const v of part) biggest = Math.max(biggest, Math.abs(v));
      }
      let scale = -Infinity;
      for (const v of total) scale = Math.max(scale, Math.abs(v));
      if (biggest <= RING_TOL * scale || (biggest <= NOISE_TOL * scale && biggest >= before)) break;
      before = biggest;
    }
    if (n > MAX_RINGS) throw new Error('The image well series for the two parallel boundaries did not converge.');
  });
  return total;
}

/**
 * Where the observation point and boundaries sit, from distances a hydrogeologist
 * measures on a map. The pumped well is at the origin; boundary 1 is the line x = a1.
 *   arrangement: 'one', 'parallel' (boundary 2 at x = -a2, the well between them) or
 *     'right' (boundary 2 the line y = a2, at right angles to the first).
 *   types: ['head' | 'noflow', ...]; a: distances from the pumped well to each boundary;
 *   d: distances from the observation point to each boundary (d[1] only for 'right').
 *   r: distance from the pumped well to the observation point.
 * Returns { obs, lines }, or throws with what does not fit.
 */
export function boundaryLayout({ arrangement, types, a, d }, r) {
  checkArrangement({ arrangement, types }, (i) => {
    if (!(a[i] > 0)) throw new Error(`The distance from the pumped well to boundary ${i + 1} must be above zero.`);
  });
  if (!(d[0] > 0)) throw new Error('The distance from the observation point to boundary 1 must be above zero.');
  const x = a[0] - d[0];
  const lines = [{ axis: 'x', at: a[0], type: types[0] }];
  if (arrangement === 'parallel') {
    lines.push({ axis: 'x', at: -a[1], type: types[1] });
    if (!(x > -a[1])) throw new Error('The observation point must lie between the two parallel boundaries.');
  }
  if (arrangement === 'right') {
    if (!(d[1] > 0)) throw new Error('The distance from the observation point to boundary 2 must be above zero.');
    lines.push({ axis: 'y', at: a[1], type: types[1] });
    const y = a[1] - d[1], implied = libm.hypot(x, y);
    // r is given twice over here: by itself, and by the distances to the two boundaries.
    if (Math.abs(implied - r) > 0.01 * r + 1e-9) {
      throw new Error(`The distances to the two boundaries put the observation point ${Number(implied.toPrecision(4))} m from the pumped well, but its distance is given as ${Number(r.toPrecision(4))} m. Check the distances.`);
    }
    return { obs: { x: x * r / implied || 0, y: y * r / implied || 0 }, lines };
  }
  if (Math.abs(x) > r * (1 + 1e-9)) {
    throw new Error(`An observation point ${Number(r.toPrecision(4))} m from the pumped well cannot be ${Number(d[0].toPrecision(4))} m from boundary 1 when the well is ${Number(a[0].toPrecision(4))} m from it. Check the distances.`);
  }
  return { obs: { x, y: Math.sqrt(Math.max(0, r * r - x * x)) }, lines };
}

/**
 * The drawdown the fit uses: the solution at its geometry g, at times t, pumping the
 * rate schedule rates = [[t, Q], ...], with optional boundaries as boundaryLayout()
 * takes them. Without boundaries, only superposition in time is used, so any solution
 * works; with them, the solution must have images: true.
 */
export function drawdownAt(solution, p, g, t, { rates, boundaries = null }) {
  if (!boundaries) return rateDrawdown(solution, p, g, t, rates);
  const { obs, lines } = boundaryLayout(boundaries, g.r);
  return wellsDrawdown(solution, p, g, t, { wells: [{ x: 0, y: 0, rates }], obs, lines });
}

/**
 * Agarwal (1980) equivalent time for recovery after pumping at a constant rate for tp:
 * te = tp dt / (tp + dt), with dt the time since pumping stopped. The rise in water
 * level since shut-off, plotted against te, follows the drawdown curve where the
 * Cooper and Jacob straight line holds, so drawdown type curves can be used on it.
 */
export function agarwalTime(tp, dt) {
  if (!(tp > 0)) throw new Error('The pumping time must be above zero.');
  return dt.map((x) => (x > 0 ? (tp * x) / (tp + x) : NaN));
}
