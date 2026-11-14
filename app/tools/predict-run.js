// The predict page's run, apart from the page: the form's values checked and read into
// metres and days (readPrediction), and the drawdowns worked out from them
// (runPrediction), which the page leaves to a Web Worker (predict-worker.js), so that it
// stays live while the range over the intervals is found.
import { logTimes } from '../../engine/numeric.js';
import {
  AQUIFERS, checkValues, drainageOver, forecast, mapBoundaries, parseDistances, parsePoints, parseSchedule, parseWells, predictDrawdown, rangeOverBox, repeatSchedule, steadyLeaky,
} from '../../engine/predict.js';
import { RATE_UNITS, UNITS } from '../../engine/units.js';
import { sig } from '../../engine/format.js';

// The shortest pumping time: the first computed time is one minute.
const MINUTE = 1 / 1440;
// Times evenly spread over a schedule, besides each change of rate.
export const SCHEDULE_TIMES = 300;

// A number as the user typed it, without float noise or e+30.
export const asTyped = (x) => sig(x, 6);
export const daysText = (d) => `${asTyped(d)} ${d === 1 ? 'day' : 'days'}`;

/** Rates as typed (parseSchedule), in m3/d, repeated if asked, all inside the prediction. */
function scheduleOf(rates, what, v, q) {
  const late = rates.find(([t]) => t >= v.until);
  if (late) throw new Error(`${what}: the change at ${asTyped(late[0])} d is not before the end of the prediction, ${daysText(v.until)}.`);
  const all = v.repeat === undefined ? rates : repeatSchedule(rates, v.repeat, v.until);
  return all.map(([t, Q]) => [t, Q * q]);
}

/** An interval box for each value given both its ends, in metres and days; throws on half of one. */
function intervalsOf(v, ids, conv) {
  const box = {};
  for (const id of ids) {
    const lo = v[`${id}lo`], hi = v[`${id}hi`];
    if (lo === undefined && hi === undefined) continue;
    if (lo === undefined || hi === undefined) throw new Error(`Give both ends of the 95% interval of ${id}, or neither.`);
    if (!(lo > 0) || !(lo <= v[id] && v[id] <= hi)) throw new Error(`The 95% interval of ${id} must run from above zero, through ${asTyped(v[id])}, upward: ${asTyped(lo)} to ${asTyped(hi)} does not.`);
    if ((id === 'S' || id === 'Sy') && !(hi < 1)) throw new Error(`The upper end of the 95% interval of ${id} must be below 1.`);
    box[id] = [lo * conv[id], hi * conv[id]];
  }
  // Every corner of the box must be an aquifer: S + Sy below 1 at the upper ends too.
  if (ids.includes('Sy') && !((box.S ? box.S[1] : v.S) + (box.Sy ? box.Sy[1] : v.Sy) < 1)) throw new Error('The upper ends of the 95% intervals of S and Sy (or the values, where no interval is given) must together be below 1.');
  return box;
}

/**
 * The predict form's values v, checked and read into metres and days. Throws, naming the
 * first thing wrong, in the order the page has always named them. Returns { v, a, p, ru,
 * L, end, common, wells, points, twice, labels, lines, changing, box, D, t, plain, job }:
 * the values v, the aquifer a and its values p, the distance unit and its length in
 * metres, the end of the prediction in days, the common rates, the wells, points, labels
 * and boundaries, the distances listed twice, whether the rates change, the interval box,
 * the saturated thickness, the times, whether this is the plain Theis page of old, and
 * the job for runPrediction. v holds only the fields the form shows (kit.js form).
 */
export function readPrediction(v) {
  const a = AQUIFERS[v.aquifer];
  const ru = v.rUnit, L = UNITS[ru], q = RATE_UNITS[v.qUnit];
  const tL = v.tUnit === 'ft2/d' ? UNITS.ft ** 2 : 1;
  const conv = { T: tL, S: 1, B: L, Sy: 1 };
  const p = Object.fromEntries(a.params.map((id) => [id, v[id] * conv[id]]));
  checkValues(v.aquifer, p);
  const changing0 = v.rateKind === 'schedule';
  if (!changing0) {
    if (!(v.Q > 0)) throw new Error('The pumping rate must be above zero.');
    if (!(v.days > MINUTE)) throw new Error('The pumping time must be longer than one minute (about 0.0007 days).');
  } else if (!(v.until > 0)) throw new Error('The time to predict to must be above zero.');
  const end = changing0 ? v.until : v.days;
  const common = changing0 ? scheduleOf(parseSchedule(v.schedule, 'Rate changes'), 'Rate changes', { ...v, until: end }, q) : [[0, v.Q * q]];

  // The wells and points, in metres.
  let wells, points, twice = [], labels, lines = [];
  if (v.layout === 'map') {
    const typed = parseWells(v.wells), pts = parsePoints(v.points);
    wells = typed.map((w, i) => ({ x: w.x * L, y: w.y * L, rates: w.rates ? scheduleOf(w.rates, `Pumping wells, line ${i + 1}`, { ...v, until: end }, q) : common, own: Boolean(w.rates) }));
    points = pts.map((pt) => ({ x: pt.x * L, y: pt.y * L }));
    labels = pts.map((pt) => `${asTyped(pt.x)}, ${asTyped(pt.y)}`);
    if (v.bounds) {
      lines = mapBoundaries({ arrangement: v.bounds, types: [v.b1Type, v.b2Type], at: [v.b1At * L, v.b2At * L] }, wells, points);
    }
  } else {
    const parsed = parseDistances(v.r);
    twice = parsed.twice;
    wells = [{ x: 0, y: 0, rates: common, own: false }];
    points = parsed.distances.map((r) => ({ x: r * L, y: 0 }));
    labels = parsed.distances.map((r) => asTyped(r));
  }
  const changing = changing0 || wells.some((w) => w.own);
  if (v.repeat !== undefined && !changing) throw new Error('The rates repeat only where they change: give rate changes, or rates of a well\'s own, or leave the period blank.');
  if (v.testDays !== undefined && !(v.testDays > 0)) throw new Error('The length of the test must be above zero.');
  const box = intervalsOf(v, a.params, conv);
  if (v.D !== undefined && !(v.D > 0)) throw new Error('The saturated thickness must be above zero.');
  const D = v.D === undefined ? undefined : v.D * L;
  if (v.KzKr !== undefined && !(v.KzKr > 0)) throw new Error('Kz/Kr must be above zero.');

  // The times: as before for a constant rate, in log time from a minute; for a schedule,
  // evenly through it and at each change of rate, where a fall in rate starts.
  let t;
  if (!changing) t = logTimes(MINUTE, end, 80);
  else {
    const marks = new Set(Array.from({ length: SCHEDULE_TIMES }, (_, i) => (end * (i + 1)) / SCHEDULE_TIMES));
    wells.forEach((w) => w.rates.forEach(([t0]) => { if (t0 > 0 && t0 <= end) marks.add(t0); }));
    t = [...marks].sort((x, y) => x - y);
  }
  // One well, a constant rate and a confined aquifer is the page as it always was.
  const plain = v.aquifer === 'confined' && v.layout === 'distances' && !changing;
  const job = { aquifer: v.aquifer, p, wells, points, lines, t, end, changing, plain, box, D, KzKr: v.KzKr };
  return { v, a, p, ru, L, end, common, wells, points, twice, labels, lines, changing, box, D, t, plain, job };
}

/**
 * The drawdowns in metres for a job from readPrediction, as the page shows them:
 * { curves, joined, peak, per, range, steady, steadyRange }. curves holds each point's
 * drawdown at the times t; joined, when the delayed drainage is over at each point; peak,
 * the index in t of each point's largest drawdown; range, rangeOverBox's least and
 * greatest over the box, per outputs to each point (the end, and for changing rates the
 * time of the largest); steady and steadyRange, a leaky aquifer's steady drawdown and its
 * range, for a constant rate.
 */
export function runPrediction({ aquifer, p, wells, points, lines, t, end, changing, plain, box, D, KzKr }) {
  // The plain page's one well pumps the common rate.
  const curves = plain
    ? points.map((pt) => predictDrawdown({ T: p.T, S: p.S, wells: [{ Q: wells[0].rates[0][1], r: pt.x }], t }))
    : forecast({ aquifer, p, wells, points, lines, t });
  // When the delayed drainage is over, at each point's distance from its nearest well
  // (forecast has refused a point on a well).
  const nearest = points.map((pt) => Math.min(...wells.map((w) => Math.hypot(pt.x - w.x, pt.y - w.y))));
  const joined = D !== undefined && KzKr > 0 ? nearest.map((r) => drainageOver({ T: p.T, S: p.S, Sy: p.Sy, KzKr, b: D, r })) : null;
  // The first time the drawdown comes within 10⁻⁹ of its largest, so that a level
  // stretch, such as steady leaky drawdown, is reported where it begins.
  const peak = curves.map((c) => { const top = Math.max(...c); return c.findIndex((x) => x >= top * (1 - 1e-9)); });

  // The range over the intervals, at the end and, for changing rates, at each point's largest drawdown.
  const report = points.map((_, i) => (changing ? [end, t[peak[i]]] : [end]));
  const per = report[0].length;
  const at = (vals, j) => {
    if (j === undefined) return forecast({ aquifer, p: vals, wells, points, lines, t: report }).flat();
    const i = Math.floor(j / per);
    return forecast({ aquifer, p: vals, wells, points: [points[i]], lines, t: [[report[i][j % per]]] })[0][0];
  };
  const ranged = Object.keys(box).length > 0;
  const range = ranged ? rangeOverBox(at, p, box) : null;
  const steadyOk = aquifer === 'leaky' && !changing;
  const steady = steadyOk ? steadyLeaky({ p, wells, points, lines }) : null;
  const steadyRange = steadyOk && ranged ? rangeOverBox((vals, j) => (j === undefined
    ? steadyLeaky({ p: vals, wells, points, lines })
    : steadyLeaky({ p: vals, wells, points: [points[j]], lines })[0]), p, box) : null;
  return { curves, joined, peak, per, range, steady, steadyRange };
}
