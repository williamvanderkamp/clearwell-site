// Recharge from a water table hydrograph by the water-table fluctuation (WTF) method:
// R = Sy * delta-h (Healy and Cook 2002). Two published ways to get delta-h:
//  - the master recession curve (MRC) of Heppner and Nimmo (2005), as Delin et al.
//    (2007) applied it: predict each step's level from the step before, and count the
//    amount the measured level is above the prediction;
//  - a straight-line extrapolation of the antecedent recession to the time of the
//    peak (the graphical approach of Healy and Cook 2002, done by a fixed rule).
// Levels here are heights, larger is higher. Depths are turned into heights first.
// Times are ms; rates are per day.

import { DAY, fitLine } from './numeric.js';

export { DAY };

/** Means of the readings in each step of stepDays, from midnight of the first day. */
export function toSteps(t, z, stepDays) {
  if (!(stepDays > 0)) throw new Error('The time step must be above zero.');
  const pairs = t.map((x, i) => [x, z[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .sort((p, q) => p[0] - q[0]);
  if (pairs.length < 3) throw new Error('At least three readings with a time and a level are needed.');
  const step = stepDays * DAY, t0 = Math.floor(pairs[0][0] / DAY) * DAY;
  const bins = new Map();
  for (const [x, y] of pairs) {
    const k = Math.floor((x - t0) / step);
    const b = bins.get(k) || bins.set(k, { sum: 0, n: 0 }).get(k);
    b.sum += y; b.n += 1;
  }
  const k = [...bins.keys()].sort((p, q) => p - q);
  if (k.length < 3) throw new Error(`The time step of ${stepDays} days leaves ${k.length} step${k.length === 1 ? '' : 's'} with readings. At least three are needed to find a rise, so use a shorter time step.`);
  return { stepDays, t0, k, t: k.map((i) => t0 + (i + 0.5) * step), z: k.map((i) => bins.get(i).sum / bins.get(i).n) };
}

/**
 * Heppner and Nimmo (2005) linear MRC: decline rate = a z + b, fitted by least squares
 * to the declining pairs of successive points, after dropping points equal to the one
 * before ("reduced" data). Pairs are not taken across a gap in the steps.
 */
export function fitMrc(steps) {
  const pts = [];
  let prev = null;
  steps.k.forEach((k, i) => {
    const z = steps.z[i];
    if (prev && k === prev.lastK + 1 && z === prev.z) {
      prev.lastK = k;
      return;
    }
    if (prev && k === prev.lastK + 1) {
      const rate = (z - prev.z) / ((k - prev.k) * steps.stepDays);
      if (rate < 0) pts.push({ z: (z + prev.z) / 2, rate: -rate });
    }
    prev = { k, lastK: k, z };
  });
  if (pts.length < 2) throw new Error('The record has fewer than two falling steps, so no master recession curve can be fitted.');
  const line = fitLine(pts.map((p) => p.z), pts.map((p) => p.rate));
  if (!Number.isFinite(line.slope)) throw new Error('Every falling step is at the same level, so no master recession curve can be fitted.');
  return { a: line.slope, b: line.intercept, points: pts };
}

/**
 * Each step: predicted = z(i) - (a z(i) + b) dt, difference = z(i+1) - predicted.
 * Events are runs of steps with a positive difference; delta-h of an event is the sum.
 */
export function mrcSteps(steps, { a, b }) {
  const rows = [];
  for (let i = 1; i < steps.k.length; i++) {
    if (steps.k[i] !== steps.k[i - 1] + 1) continue;
    const pred = steps.z[i - 1] - (a * steps.z[i - 1] + b) * steps.stepDays;
    rows.push({ i, t: steps.t[i], z: steps.z[i], pred, diff: steps.z[i] - pred });
  }
  const events = [];
  let ev = null;
  for (const r of rows) {
    if (r.diff > 0 && ev && r.i === ev.peak + 1) {
      ev.peak = r.i;
      ev.dh += r.diff;
      ev.rows.push(r);
      continue;
    }
    if (ev) { events.push(ev); ev = null; }
    if (r.diff > 0) ev = { start: r.i - 1, peak: r.i, dh: r.diff, rows: [r] };
  }
  if (ev) events.push(ev);
  return { rows, events };
}

/**
 * A rise is a run of steps each higher than the one before, from its low (start) to its
 * high (peak). The antecedent recession is the least-squares slope of the steps in the
 * windowDays up to and including the start, extended from the start to the peak time.
 * A window that is not falling or flat gives no extrapolation, and the rise is flagged.
 */
export function lineEvents(steps, { windowDays }) {
  if (!(windowDays > 0)) throw new Error('The recession window must be above zero.');
  const events = [];
  for (let i = 1; i < steps.k.length; i++) {
    if (!(steps.k[i] === steps.k[i - 1] + 1 && steps.z[i] > steps.z[i - 1])) continue;
    const start = i - 1;
    let peak = i;
    while (peak + 1 < steps.k.length && steps.k[peak + 1] === steps.k[peak] + 1 && steps.z[peak + 1] > steps.z[peak]) peak++;
    const xs = [], ys = [];
    for (let j = start; j >= 0 && steps.t[start] - steps.t[j] <= windowDays * DAY + 1; j--) {
      if (j < start && steps.k[j] !== steps.k[j + 1] - 1) break;
      xs.push(steps.t[j] / DAY); ys.push(steps.z[j]);
    }
    const slope = xs.length >= 2 ? fitLine(xs, ys).slope : NaN;
    const ok = Number.isFinite(slope) && slope <= 0;
    const extrap = ok ? steps.z[start] + slope * (steps.t[peak] - steps.t[start]) / DAY : NaN;
    events.push({ start, peak, slope, extrap, dh: ok ? steps.z[peak] - extrap : NaN, flagged: !ok, windowSteps: xs.length });
    i = peak;
  }
  return { events };
}

// A number of days for a message: 1 day, 0.25 days.
const days = (x) => { const v = Number(x.toPrecision(3)); return `${v} day${v === 1 ? '' : 's'}`; };

/**
 * The span of the record and the usual time between readings, in days. Each reading
 * stands for one interval, so daily readings from 1 January to 31 December are 365 days.
 * days[year]: the number of calendar days with a reading in each year.
 */
export function recordSpan(t, level, yearType) {
  const ts = t.filter((x, i) => Number.isFinite(x) && Number.isFinite(level[i])).sort((p, q) => p - q);
  const gaps = ts.slice(1).map((x, i) => x - ts[i]).filter((d) => d > 0).sort((p, q) => p - q);
  const interval = gaps.length ? gaps[gaps.length >> 1] / DAY : 0;
  const perYear = new Map();
  for (const x of ts) {
    const y = yearOf(x, yearType);
    (perYear.get(y) || perYear.set(y, new Set()).get(y)).add(Math.floor(x / DAY));
  }
  return {
    first: ts[0], last: ts[ts.length - 1], interval,
    days: ts.length ? (ts[ts.length - 1] - ts[0]) / DAY + interval : 0,
    daysByYear: new Map([...perYear].map(([y, set]) => [y, set.size])),
  };
}

/** 'water': USGS water year, 1 October to 30 September, named by the year it ends in. */
export function yearOf(ms, kind) {
  const d = new Date(ms), y = d.getUTCFullYear();
  return kind === 'water' ? (d.getUTCMonth() >= 9 ? y + 1 : y) : y;
}

/**
 * The whole calculation. level: heights or depths (depth: true). method 'mrc' or 'line'.
 * negatives (mrc): 'zero' leaves out steps below the curve, 'keep' adds them to the totals.
 * minRise drops events with a smaller delta-h. a, b: a given linear MRC instead of a fit.
 */
export function estimateRecharge({ t, level, depth, stepDays, method, sy, windowDays, negatives, minRise, yearType, a, b }) {
  if (!(sy > 0 && sy < 1)) throw new Error('Specific yield must be above 0 and below 1.');
  if (method !== 'mrc' && method !== 'line') throw new Error('Choose how to extrapolate the recession.');
  if (method === 'mrc' && negatives !== 'zero' && negatives !== 'keep') throw new Error('Choose what to do with steps below the curve.');
  if (yearType !== 'water' && yearType !== 'calendar') throw new Error('Choose water years or calendar years.');
  if (minRise < 0) throw new Error('The smallest rise to keep must be zero or above.');
  const span = recordSpan(t, level, yearType);
  // A step shorter than the time between readings leaves every step cut off from the
  // next by an empty one, so nothing could ever be counted.
  if (stepDays > 0 && span.interval > 0 && stepDays < span.interval * (1 - 1e-9)) {
    throw new Error(`The time step (${days(stepDays)}) is shorter than the time between readings (${days(span.interval)}), so no step joins the next and no rise can be found. Use a step of at least ${days(span.interval)}.`);
  }
  const z = level.map((v) => (depth ? -v : v));
  const steps = toSteps(t, z, stepDays);
  const keepAll = method === 'mrc' && negatives === 'keep';
  const small = (dh) => !keepAll && minRise > 0 && dh < minRise;
  let mrc = null, rows = [], events;
  if (method === 'mrc') {
    mrc = Number.isFinite(a) && Number.isFinite(b) ? { a, b, points: [], given: true } : fitMrc(steps);
    ({ rows, events } = mrcSteps(steps, mrc));
  } else {
    ({ events } = lineEvents(steps, { windowDays }));
  }
  const dropped = events.filter((e) => Number.isFinite(e.dh) && small(e.dh)).length;
  events = events.filter((e) => !(Number.isFinite(e.dh) && small(e.dh)));
  const years = new Map();
  const year = (ms) => {
    const y = yearOf(ms, yearType);
    return years.get(y) || years.set(y, { year: y, steps: 0, events: 0, dh: 0 }).get(y);
  };
  steps.t.forEach((ms) => { year(ms).steps += 1; });
  for (const e of events.filter((x) => Number.isFinite(x.dh))) {
    const y = year(steps.t[e.peak]);
    y.events += 1;
    if (!keepAll) y.dh += e.dh;
  }
  if (keepAll) rows.forEach((r) => { year(r.t).dh += r.diff; });
  // A long step's middle can fall in a year with no readings; such a year is listed only
  // if something was counted in it.
  const yearList = [...years.values()].sort((p, q) => p.year - q.year)
    .map((y) => ({ ...y, days: span.daysByYear.get(y.year) || 0, recharge: sy * y.dh }))
    .filter((y) => y.days > 0 || y.events > 0 || y.dh !== 0);
  const totalDh = yearList.reduce((s, y) => s + y.dh, 0);
  return {
    steps, span, mrc, rows, dropped, years: yearList, totalDh, recharge: sy * totalDh,
    events: events.map((e) => ({
      ...e, tStart: steps.t[e.start], tPeak: steps.t[e.peak], zStart: steps.z[e.start], zPeak: steps.z[e.peak], recharge: sy * e.dh,
    })),
  };
}

/**
 * A test hydrograph that follows a linear MRC exactly, step by step:
 * z(i+1) = z(i) - (a z(i) + b) dt + pulse(i+1). pulses: { stepIndex: rise }.
 */
export function simulateHydrograph({ start, n, stepDays, a, b, z0, pulses = {} }) {
  const t = [], z = [];
  let level = z0;
  for (let i = 0; i < n; i++) {
    if (i > 0) level = level - (a * level + b) * stepDays + (pulses[i] || 0);
    t.push(start + (i + 0.5) * stepDays * DAY);
    z.push(level);
  }
  return { t, z };
}
