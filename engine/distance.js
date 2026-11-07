// Several observation wells, one constant-rate test. Two standard analyses:
//   1. Cooper and Jacob (1946) distance-drawdown: drawdown at one time against log
//      distance (Kruseman and de Ridder 1994, Procedure 3.5).
//   2. Composite plot: drawdown against t/r2 for every well, with one Theis (1935)
//      curve fitted to all of them at once (Kruseman and de Ridder 1994, Procedure 3.3).
// Everything here is metres and days.
import { fitLine, isNum, mean } from './numeric.js';
import { fitTheis, STRAIGHT_LINE_U, wellFunction } from './pumping.js';

// Below this u the straight line is within 1% of Theis (Cooper and Jacob 1946).
export const STRICT_U = 0.01;

/** Rows of { name, r, t, s } grouped into wells, each sorted by time. */
export function groupWells(rows) {
  const wells = new Map();
  for (const row of rows) {
    if (!isNum(row.r) || !isNum(row.t) || !isNum(row.s)) continue;
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    if (!wells.has(name)) wells.set(name, { name, r: row.r, t: [], s: [] });
    const w = wells.get(name);
    if (w.r !== row.r) throw new Error(`Well ${name} has more than one distance (${w.r} and ${row.r}). Each well needs one distance.`);
    w.t.push(row.t); w.s.push(row.s);
  }
  return [...wells.values()].map((w) => {
    const order = w.t.map((_, i) => i).sort((a, b) => w.t[a] - w.t[b]);
    return { name: w.name, r: w.r, t: order.map((i) => w.t[i]), s: order.map((i) => w.s[i]) };
  });
}

/**
 * Drawdown at time t, read from the well's own readings: linear in log time between
 * the two readings either side. NaN outside the readings, which are never extended.
 */
export function drawdownAt(well, t) {
  const use = well.t.map((_, i) => i).filter((i) => well.t[i] > 0 && isNum(well.s[i]));
  for (let k = 0; k < use.length; k++) {
    const i = use[k];
    if (well.t[i] === t) return well.s[i];
    if (k > 0 && well.t[use[k - 1]] < t && t < well.t[i]) {
      const j = use[k - 1], f = Math.log(t / well.t[j]) / Math.log(well.t[i] / well.t[j]);
      return well.s[j] + f * (well.s[i] - well.s[j]);
    }
  }
  return NaN;
}

/** How u stands against the straight-line condition. */
export const uClass = (u) => (!isNum(u) ? 'unknown' : u < STRICT_U ? 'strict' : u <= STRAIGHT_LINE_U ? 'practical' : 'fails');

/**
 * Cooper and Jacob distance-drawdown at time t (days), Q in m3/d.
 * The line is s = ds log10(r0 / r), so T = 2.30 Q / (2 pi ds) and S = 2.25 T t / r0^2.
 */
export function distanceDrawdown(wells, t, Q) {
  if (!(t > 0)) throw new Error('The time for the distance-drawdown line must be above zero.');
  const at = wells.map((w) => ({ name: w.name, r: w.r, s: drawdownAt(w, t) }));
  const used = at.filter((p) => p.r > 0 && isNum(p.s));
  if (new Set(used.map((p) => p.r)).size < 2) throw new Error('The distance-drawdown line needs readings at that time from at least two wells at different distances.');
  const line = fitLine(used.map((p) => Math.log10(p.r)), used.map((p) => p.s));
  const ds = -line.slope;
  if (!(ds > 0)) throw new Error('At that time drawdown does not fall off with distance, so no line can be drawn.');
  const T = Math.LN10 * Q / (2 * Math.PI * ds);
  const r0 = 10 ** (line.intercept / ds);
  const S = 2.25 * T * t / (r0 * r0);
  const wellsOut = at.map((p) => {
    const u = p.r > 0 ? (p.r * p.r * S) / (4 * T * t) : NaN;
    const validFrom = p.r > 0 ? (p.r * p.r * S) / (4 * T * STRAIGHT_LINE_U) : NaN;
    return { ...p, used: p.r > 0 && isNum(p.s), u, uClass: uClass(u), validFrom };
  });
  return { t, T, S, r0, ds, slope: line.slope, intercept: line.intercept, wells: wellsOut, rows: used.length };
}

/**
 * Theis fitted to every well at once, on drawdown against t/r2: plain least squares on
 * every reading above zero, as AQTESOLV and TTim do. A well with more readings counts
 * for more. With x = t/r2, u = S / (4 T x), so the fit runs with r = 1.
 */
export function compositeTheis(wells, Q) {
  const points = [];
  for (const w of wells) {
    if (!(w.r > 0)) continue;
    w.t.forEach((t, i) => { if (t > 0 && w.s[i] > 0) points.push({ name: w.name, x: t / (w.r * w.r), s: w.s[i] }); });
  }
  if (points.length < 4) throw new Error('The composite fit needs at least four drawdown readings above zero.');
  const fit = fitTheis(points.map((p) => p.x), points.map((p) => p.s), Q, 1);
  const misfit = (p) => p.s - fit.c * wellFunction(fit.a / p.x);
  const perWell = [...new Set(points.map((p) => p.name))].map((name) => {
    const mine = points.filter((p) => p.name === name);
    return { name, rows: mine.length, rms: Math.sqrt(mean(mine.map((p) => misfit(p) ** 2))) };
  });
  return { T: fit.T, S: fit.S, a: fit.a, c: fit.c, rmse: fit.rmse, rows: points.length, points, perWell };
}

/** Theis drawdown on the composite plot, at each t/r2 (d/m2). */
export const compositeCurve = (fit, x) => x.map((v) => fit.c * wellFunction(fit.a / v));
