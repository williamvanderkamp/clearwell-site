// Forward Theis (1935): the drawdown a well would cause, from known T and S. The
// inverse of the pumping test analysis, used to plan a test or check interference.
//
// Long-term production pumping, from the values a test gave (docs/tools/predict.md):
//   - three aquifers, each a published solution: confined (Theis 1935), leaky with the
//     aquitard's storage neglected (Hantush and Jacob 1955), and unconfined at long times,
//     Theis with S + Sy for the storativity (Gambolati 1976, as Kruseman and de Ridder
//     1994 give it, p. 104);
//   - schedules of rates and several wells, and straight boundaries by image wells, by
//     superposition (superpose.js; Ferris et al. 1962; Kruseman and de Ridder 1994,
//     chapter 6);
//   - for a leaky aquifer, the steady drawdown the last rate tends to (De Glee 1930;
//     Hantush and Jacob 1955; Kruseman and de Ridder 1994, equation 4.1);
//   - the range of drawdown over the 95% intervals of the values (rangeOverBox);
//   - the distance the test's drawdown reached, r0 = 1.5 √(Tt/S) (Kruseman and de Ridder
//     1994, equation 3.10);
//   - for an unconfined aquifer, Jacob's (1944) correction undone, given the saturated
//     thickness.
// Metres and days throughout.
import { wellFunction } from './pumping.js';
import { besselK0 } from './laplace.js';
import { goldenMin, isNum, logTimes } from './numeric.js';
import { checkArrangement, checkLines, checkRates, wellsDrawdown } from './superpose.js';
import theis from './solutions/theis.js';
import hantushJacob from './solutions/hantush-jacob.js';
import neuman from './solutions/neuman.js';
import * as libm from './libm.js';

/**
 * Drawdown in m at each distance and time. T in m2/d, S dimensionless, Q in m3/d,
 * r in m, t in days. Several wells add by superposition: wells is [{ Q, r }].
 */
export function predictDrawdown({ T, S, wells, t }) {
  if (!(T > 0) || !(S > 0)) throw new Error('Transmissivity and storativity must be above zero.');
  const at = (w, day) => (w.Q / (4 * Math.PI * T)) * wellFunction((w.r * w.r * S) / (4 * T * day));
  // Before pumping starts there is no drawdown.
  return t.map((day) => wells.reduce((sum, w) => (day > 0 ? sum + at(w, day) : sum), 0));
}

/**
 * The distances typed in one box, split at commas, semicolons or spaces. Throws an
 * error naming every entry that is not a number above zero, so none is dropped
 * unseen. A distance listed twice is kept once and named in twice.
 */
export function parseDistances(text) {
  const parts = String(text ?? '').split(/[,;\s]+/).filter(Boolean);
  const bad = parts.filter((p) => !(Number(p) > 0 && Number.isFinite(Number(p))));
  if (bad.length) throw new Error(`Distances: each must be a number above zero, and ${bad.length === 1 ? 'this one is' : 'these are'} not: ${bad.join(', ')}.`);
  if (!parts.length) throw new Error('Distances: enter at least one distance above zero.');
  const all = parts.map(Number), distances = [...new Set(all)];
  const twice = distances.filter((r) => all.indexOf(r) !== all.lastIndexOf(r));
  return { distances, twice };
}

// ---------------------------------------------------------------------------------------
// The aquifers.

// Each aquifer: the values it takes, and the solution of the library with the values it
// is run at. The unconfined aquifer at long times is Theis's with S + Sy in place of S:
// once the delayed drainage is over, elastic storage and drainage add, and the final
// storativity is S + Sy (Gambolati 1976, as Kruseman and de Ridder 1994 give it, p. 104).
// Before that, the drawdown is larger (Neuman 1975).
export const AQUIFERS = {
  confined: { params: ['T', 'S'], solution: theis, values: (p) => ({ T: p.T, S: p.S }) },
  leaky: { params: ['T', 'S', 'B'], solution: hantushJacob, values: (p) => ({ T: p.T, S: p.S, B: p.B }) },
  unconfined: { params: ['T', 'S', 'Sy'], solution: theis, values: (p) => ({ T: p.T, S: p.S + p.Sy }) },
};

const NAMES = { T: 'The transmissivity', S: 'The storativity', B: 'The leakage factor B', Sy: 'The specific yield' };
// Storativity and specific yield are fractions (Kruseman and de Ridder 1994, 1.7.7, 1.7.9).
const FRACTIONS = ['S', 'Sy'];

/**
 * Throws, naming the first value of the aquifer that is missing or out of its range, in
 * the words the predict page gives. Returns the aquifer.
 */
export function checkValues(aquifer, p) {
  const a = AQUIFERS[aquifer];
  if (!a) throw new Error('Choose the kind of aquifer.');
  for (const id of a.params) {
    const x = p[id], fraction = FRACTIONS.includes(id);
    if (!isNum(x) || !(x > 0) || (fraction && !(x < 1))) throw new Error(`${NAMES[id]} must be above zero${fraction ? ' and below 1' : ''}.`);
  }
  return a;
}

/** checkValues, and for an unconfined aquifer S + Sy below 1 as well. */
export function checkAquifer(aquifer, p) {
  const a = checkValues(aquifer, p);
  if (aquifer === 'unconfined' && !(p.S + p.Sy < 1)) throw new Error('The storativity and specific yield together must be below 1.');
  return a;
}

// ---------------------------------------------------------------------------------------
// What the page reads: schedules, wells, points and boundaries.

/**
 * A schedule of rates typed as "0 800; 150 300; 270 0": pairs of time (days since the
 * prediction begins) and rate, each rate held until the next. Rates are as typed, in the
 * user's unit. Throws naming each entry that is not a pair of numbers, a time below zero
 * or a rate below zero, and times that do not rise.
 */
export function parseSchedule(text, what = 'Rate changes') {
  const parts = String(text ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error(`${what}: enter at least one time and rate, such as 0 800.`);
  const bad = [], rates = [];
  for (const part of parts) {
    const xs = part.split(/[,\s]+/).filter(Boolean).map(Number);
    if (xs.length !== 2 || !xs.every(Number.isFinite) || xs[0] < 0 || xs[1] < 0) bad.push(part);
    else rates.push(xs);
  }
  if (bad.length) throw new Error(`${what}: each entry must be a time in days, zero or above, and a rate, zero or above, and ${bad.length === 1 ? 'this one is' : 'these are'} not: ${bad.map((b) => `"${b}"`).join(', ')}.`);
  rates.forEach(([t], i) => {
    if (i > 0 && !(t > rates[i - 1][0])) throw new Error(`${what}: the times must rise, and ${t} d does not come after ${rates[i - 1][0]} d.`);
  });
  return rates;
}

/**
 * The schedule repeated every `period` days until `until`: a seasonal pattern typed once.
 * Its first change must be at 0 and its last before the period ends, so each repetition
 * starts as the first did.
 */
export function repeatSchedule(rates, period, until) {
  if (!(period > 0)) throw new Error('The period to repeat the rates over must be above zero.');
  if (rates[0][0] !== 0) throw new Error('To repeat the rates, the first change must be at 0 d, the start of each repetition.');
  const last = rates[rates.length - 1][0];
  if (!(last < period)) throw new Error(`To repeat the rates every ${period} d, every change must come before ${period} d, and ${last} d does not.`);
  const out = [];
  for (let k = 0; k * period < until; k++) for (const [t, Q] of rates) if (k * period + t < until) out.push([k * period + t, Q]);
  return out;
}

const pairOf = (text) => {
  const xs = String(text).split(/[,\s]+/).filter(Boolean).map(Number);
  return xs.length === 2 && xs.every(Number.isFinite) ? { x: xs[0], y: xs[1] } : null;
};

/**
 * Pumping wells, one to a line: "x y" for a well pumping the rate given for all, or
 * "x y: 0 800; 150 0" for one with rates of its own (as parseSchedule).
 * Returns [{ x, y, rates }] with rates null where the well takes the common rate.
 */
export function parseWells(text) {
  const lines = String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Pumping wells: enter at least one well, as its x and y.');
  return lines.map((line, i) => {
    const [where, own] = line.split(':');
    const at = pairOf(where);
    if (!at) throw new Error(`Pumping wells, line ${i + 1} ("${line}"): start with the well's x and y, two numbers.`);
    if (line.split(':').length > 2) throw new Error(`Pumping wells, line ${i + 1} ("${line}"): only one colon, between the position and the rates.`);
    return { ...at, rates: own === undefined ? null : parseSchedule(own, `Pumping wells, line ${i + 1}`) };
  });
}

/** Points to predict at, "x y" pairs separated by semicolons or new lines. */
export function parsePoints(text) {
  const parts = String(text ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Points: enter at least one point, as its x and y.');
  const bad = parts.filter((p) => !pairOf(p));
  if (bad.length) throw new Error(`Points: each must be an x and a y, two numbers, and ${bad.length === 1 ? 'this one is' : 'these are'} not: ${bad.map((b) => `"${b}"`).join(', ')}.`);
  return parts.map(pairOf);
}

/**
 * Straight boundaries on the map, as imageRings takes them. arrangement: 'one' (the line
 * x = at[0]), 'parallel' (also x = at[1]) or 'right' (also y = at[1]); types: 'head' or
 * 'noflow' for each. Every well must lie inside the aquifer the lines bound, and every
 * point inside it or on a line: the side of each line that the first well is on.
 */
export function mapBoundaries({ arrangement, types, at }, wells, points) {
  const count = checkArrangement({ arrangement, types }, (i) => {
    if (!isNum(at[i])) throw new Error(`Give the position of boundary ${i + 1}.`);
  });
  const lines = Array.from({ length: count }, (_, i) => ({ axis: i === 1 && arrangement === 'right' ? 'y' : 'x', at: at[i], type: types[i] }));
  checkLines(lines);
  if (arrangement === 'parallel' && !(Math.min(...at) < wells[0].x && wells[0].x < Math.max(...at))) {
    throw new Error(`Well 1 (x = ${wells[0].x}) must lie between the two parallel boundaries (x = ${at[0]} and x = ${at[1]}).`);
  }
  lines.forEach((line, i) => {
    const name = `boundary ${i + 1} (${line.axis} = ${line.at})`;
    const side = Math.sign(wells[0][line.axis] - line.at);
    if (side === 0) throw new Error(`Well 1 is on ${name}. A pumping well must lie inside the aquifer.`);
    wells.forEach((w, j) => {
      if (Math.sign(w[line.axis] - line.at) !== side) throw new Error(`Well ${j + 1} is not on the same side of ${name} as well 1. Every well must lie inside the aquifer the boundaries bound.`);
    });
    points.forEach((p, j) => {
      if (Math.sign(p[line.axis] - line.at) === -side) throw new Error(`Point ${j + 1} is on the other side of ${name} from the wells, outside the aquifer.`);
    });
  });
  return lines;
}

// ---------------------------------------------------------------------------------------
// The drawdown.

/** Throws if a point sits on a pumping well, where the line-source solutions are infinite. */
function checkPoints(wells, points) {
  points.forEach((p, j) => wells.forEach((w, i) => {
    if (p.x === w.x && p.y === w.y) throw new Error(`Point ${j + 1} is on well ${i + 1}, where the drawdown of a line source is infinite. To see the aquifer's drawdown at the well face, place the point the well's radius away (well losses are not included).`);
  }));
}

/**
 * Drawdown in m at each point at times t (days), from wells [{ x, y, rates }] with rates
 * [[t, Q], ...] in m3/d, and straight boundaries (mapBoundaries). times may be one array
 * for all points or an array per point. The aquifer is one of AQUIFERS, at the values p.
 */
export function forecast({ aquifer, p, wells, points, lines = [], t }) {
  const a = checkAquifer(aquifer, p);
  checkPoints(wells, points);
  const values = a.values(p);
  // Each aquifer's solution computes each time on its own: pointwise, in superpose.js.
  return points.map((obs, j) => wellsDrawdown(a.solution, values, {}, Array.isArray(t[0]) ? t[j] : t, { wells, obs, lines, pointwise: true }));
}

// De Glee (1930): the steady drawdown in a leaky aquifer, s = Q / (2πT) K0(r/B), as a
// solution of the library's shape, so that superpose.js can sum it over wells and images.
// It is the limit of Hantush and Jacob's (1955) drawdown at long times (Kruseman and de
// Ridder 1994, equation 4.1, p. 76; Hantush and Jacob's own section 4.1.2).
const deGlee = {
  name: 'De Glee (1930)',
  images: true,
  drawdown: (p, g, t, Q) => t.map((x) => (x > 0 ? (Q / (2 * Math.PI * p.T)) * besselK0(g.r / p.B) : 0)),
};

/**
 * The steady drawdown in m at each point of a leaky aquifer, if each well's last rate were
 * held for ever.
 */
export function steadyLeaky({ p, wells, points, lines = [] }) {
  checkAquifer('leaky', p);
  checkPoints(wells, points);
  const after = Math.max(...wells.map((w) => checkRates(w.rates)[w.rates.length - 1][0])) + 1;
  return points.map((obs) => wellsDrawdown(deGlee, { T: p.T, B: p.B }, {}, [after], { wells, obs, lines })[0]);
}

/**
 * The distance at which Cooper and Jacob's (1946) straight line reaches zero drawdown
 * after t days: r0 = √(2.25 T t / S) = 1.5 √(Tt/S) (Kruseman and de Ridder 1994,
 * equation 3.10, p. 66). Theis's drawdown there is not zero: u = 0.5625, and
 * s = Q/(4πT) W(0.5625).
 */
export function lineReach(T, S, t) {
  if (!(T > 0) || !(S > 0) || !(t > 0)) throw new Error('T, S and the time must be above zero.');
  return 1.5 * Math.sqrt((T * t) / S);
}

/**
 * The drawdown of an unconfined aquifer from the drawdown s′ computed as if its saturated
 * thickness D did not change: Jacob's (1944) correction s′ = s − s²/(2D) (Kruseman and de
 * Ridder 1994, p. 101), solved for s: s = D − √(D² − 2Ds′). With s′ above D/2 there is no
 * solution: the aquifer would be drained there, and NaN is returned.
 */
export function undoJacob(sPrime, D) {
  if (!(D > 0)) throw new Error('The saturated thickness must be above zero.');
  if (sPrime > D / 2) return NaN;
  // The same root as D − √(D² − 2Ds′), written so it does not lose digits for small s′.
  return (2 * sPrime) / (1 + Math.sqrt(1 - (2 * sPrime) / D));
}

// The share of the drawdown within which Neuman's (1975) solution is taken to have joined
// Theis with S + Sy: a choice, stated on the page.
export const LONG_TIME_SHARE = 0.01;

/**
 * The time in days after which the drawdown of one well pumping at a constant rate, at
 * distance r (m), in Neuman's (1975) unconfined aquifer (T, S, Sy, Kz/Kr, saturated
 * thickness b), stays within LONG_TIME_SHARE of Theis's with S + Sy. Neuman's drawdown
 * from the solution library is compared with it at 10 times to a log cycle from 10⁻⁵ to
 * 10⁶ days, and the last crossing is narrowed by bisection in log time to 0.1%.
 * Infinity if the two have not come together by 10⁶ days.
 */
export function drainageOver({ T, S, Sy, KzKr, b, r }) {
  if (![T, S, Sy, KzKr, b, r].every((x) => x > 0)) throw new Error('T, S, Sy, Kz/Kr, the thickness and the distance must all be above zero.');
  const out = (t) => {
    const n = neuman.drawdown({ T, S, Sy, 'Kz/Kr': KzKr }, { r, b }, t, 1), w = theis.drawdown({ T, S: S + Sy }, { r }, t, 1);
    return t.map((_, i) => Math.abs(n[i] - w[i]) > LONG_TIME_SHARE * w[i]);
  };
  const t = logTimes(1e-5, 1e6, 111), apart = out(t);
  const last = apart.lastIndexOf(true);
  if (last === t.length - 1) return Infinity;
  if (last < 0) return t[0];
  let lo = libm.log(t[last]), hi = libm.log(t[last + 1]);
  while (hi - lo > 1e-3) {
    const mid = (lo + hi) / 2;
    if (out([libm.exp(mid)])[0]) lo = mid; else hi = mid;
  }
  return libm.exp(hi);
}

// ---------------------------------------------------------------------------------------
// The range of a prediction over the 95% intervals of the values.

// Values of each over its interval, evenly in log, both ends included.
export const RANGE_STEPS = 5;
// Golden-section steps for each refinement along one value, and the sweeps over the values.
export const RANGE_GOLDEN = 14;
export const RANGE_SWEEPS = 2;

/**
 * The least and greatest of each output of f over a box of values: each id of box ranges
 * over [lo, hi], the other values of centre are held. f(values) returns an array of
 * outputs, and f(values, j) the output j alone.
 *
 * Found on a grid of RANGE_STEPS values of each, evenly in log scale, ends included, with
 * the centre added; then each output's least and greatest are refined by golden-section
 * search along each value in turn, between the grid values either side of where it lies,
 * RANGE_SWEEPS times over. A refinement only replaces a value it improves on.
 * Returns { low, high, lowAt, highAt } with the values where each was found.
 */
export function rangeOverBox(f, centre, box) {
  const ids = Object.keys(box);
  for (const id of ids) {
    const [lo, hi] = box[id];
    if (!(lo > 0) || !(hi >= lo)) throw new Error(`The interval of ${id} must run from a value above zero up.`);
  }
  const first = f(centre);
  const low = first.slice(), high = first.slice(), lowAt = first.map(() => centre), highAt = first.map(() => centre);
  if (!ids.length) return { low, high, lowAt, highAt };
  const nodes = ids.map((id) => {
    const [lo, hi] = box[id];
    const ns = logTimes(lo, hi, RANGE_STEPS);
    ns[0] = lo;
    ns[RANGE_STEPS - 1] = hi;
    return ns;
  });
  const take = (out, v) => out.forEach((x, j) => {
    if (x < low[j]) { low[j] = x; lowAt[j] = v; }
    if (x > high[j]) { high[j] = x; highAt[j] = v; }
  });
  const index = new Array(ids.length).fill(0);
  for (;;) {
    const v = { ...centre };
    ids.forEach((id, d) => { v[id] = nodes[d][index[d]]; });
    take(f(v), v);
    let d = 0;
    while (d < ids.length && ++index[d] === RANGE_STEPS) index[d++] = 0;
    if (d === ids.length) break;
  }
  // Refine each extreme along each value in turn, within the grid cells either side. The
  // same values come up more than once, where one search ends and the next begins and in
  // both extremes' searches, so output j is kept for each set of values it is found at
  // (seen): f is not called twice with the same values.
  const refine = (j, sign, at, seen) => {
    const fj = (v) => {
      const key = ids.map((id) => v[id]).join(' ');
      if (!seen.has(key)) seen.set(key, f(v, j));
      return seen.get(key);
    };
    let best = sign * fj(at), v = at;
    for (let sweep = 0; sweep < RANGE_SWEEPS; sweep++) {
      ids.forEach((id, d) => {
        const ns = nodes[d], x = v[id];
        let k = ns.findIndex((n) => n >= x);
        if (k < 0) k = ns.length - 1;
        const lo = ns[Math.max(0, k - 1)], hi = ns[Math.min(ns.length - 1, k + 1)];
        if (!(hi > lo)) return;
        const along = (lx) => sign * fj({ ...v, [id]: libm.exp(lx) });
        const lx = goldenMin(along, libm.log(lo), libm.log(hi), RANGE_GOLDEN);
        const w = { ...v, [id]: Math.min(hi, Math.max(lo, libm.exp(lx))) }, y = sign * fj(w);
        if (y < best) { best = y; v = w; }
      });
    }
    return { value: sign * best, at: v };
  };
  first.forEach((_, j) => {
    const seen = new Map();
    const a = refine(j, 1, lowAt[j], seen), b = refine(j, -1, highAt[j], seen);
    if (a.value < low[j]) { low[j] = a.value; lowAt[j] = a.at; }
    if (b.value > high[j]) { high[j] = b.value; highAt[j] = b.at; }
  });
  return { low, high, lowAt, highAt };
}

/**
 * The share of tests in which the true values all lie in their intervals, at least, when
 * each of k intervals holds its true value in 95% of tests: 1 − 0.05k, by Bonferroni's
 * inequality, whatever the correlation between them. With the model right, the true
 * drawdown then lies in the range over the box at least that often.
 */
export const boxCoverage = (k) => Math.max(0, 1 - 0.05 * k);

