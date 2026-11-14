// Leaky confined aquifer, Hantush and Jacob (1955): a well pumping at a constant rate
// from an aquifer that takes water through an aquitard whose own storage is neglected.
//   s = Q / (4 pi T) W(u, r/B),  u = r^2 S / (4 T t),  B = sqrt(T c)
// fitted by least squares to drawdown against time at one observation well, as in
// Walton's (1962) type curve method done by computer. Metres and days throughout.
import { fitTheis, logBins, wellFunction } from './pumping.js';
import { GL_W, GL_X, isNum } from './numeric.js';
import * as libm from './libm.js';

// Beyond exp(-CUT) the integrand adds nothing that a double can hold.
const CUT = 46;
const PANEL = 0.1; // width of each panel, in ln y

// Search range for r/B. Below the lowest the curve is Theis; above the highest the
// drawdown is steady from the first minutes.
export const RB_MIN = 1e-3;
export const RB_MAX = 10;

/**
 * Hantush (1956) leaky well function, from its defining integral
 *   W(u, b) = integral from u to infinity of (1/y) exp(-y - b^2 / (4y)) dy,  b = r/B,
 * taken in x = ln y, where the integrand is smooth, by Gauss-Legendre panels.
 * b = 0 is the Theis W(u). u = 0 gives the steady value 2 K0(b).
 */
export function leakyWellFunction(u, b) {
  if (!(b > 0)) return wellFunction(u);
  if (!(u >= 0)) return NaN;
  const q = (b * b) / 4;
  const lo = libm.log(Math.max(u, q / CUT)), hi = libm.log(Math.max(u, 0) + CUT);
  if (!(hi > lo)) return 0;
  const n = Math.ceil((hi - lo) / PANEL), h = (hi - lo) / n;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const mid = lo + (k + 0.5) * h;
    for (let j = 0; j < 4; j++) {
      const d = GL_X[j] * h / 2, y1 = libm.exp(mid - d), y2 = libm.exp(mid + d);
      sum += GL_W[j] * (libm.exp(-y1 - q / y1) + libm.exp(-y2 - q / y2));
    }
  }
  return sum * h / 2;
}

// For given u-scale a = r^2 S / 4T and b = r/B, the best Q/4piT is a plain ratio.
function sse(t, s, a, b) {
  let sw = 0, ww = 0, ss = 0;
  for (let i = 0; i < t.length; i++) {
    const w = leakyWellFunction(a / t[i], b);
    sw += s[i] * w; ww += w * w; ss += s[i] * s[i];
  }
  return { c: sw / ww, e: ss - sw * sw / ww };
}

// Nelder and Mead (1965) simplex on two parameters.
function simplex(f, start, step) {
  let pts = [start, [start[0] + step[0], start[1]], [start[0], start[1] + step[1]]].map((p) => ({ p, v: f(p) }));
  for (let it = 0; it < 400; it++) {
    pts.sort((x, y) => x.v - y.v);
    const [best, mid, worst] = pts;
    if (Math.abs(worst.v - best.v) <= 1e-14 * (Math.abs(best.v) + 1e-30) && it > 20) break;
    const c = [(best.p[0] + mid.p[0]) / 2, (best.p[1] + mid.p[1]) / 2];
    const at = (k) => { const p = [c[0] + k * (worst.p[0] - c[0]), c[1] + k * (worst.p[1] - c[1])]; return { p, v: f(p) }; };
    const r = at(-1);
    if (r.v < best.v) { const e = at(-2); pts[2] = e.v < r.v ? e : r; continue; }
    if (r.v < mid.v) { pts[2] = r; continue; }
    const k = at(r.v < worst.v ? -0.5 : 0.5);
    if (k.v < Math.min(r.v, worst.v)) { pts[2] = k; continue; }
    // Shrink the other two points halfway towards the best.
    pts = pts.map((x, i) => {
      if (i === 0) return x;
      const p = [(x.p[0] + best.p[0]) / 2, (x.p[1] + best.p[1]) / 2];
      return { p, v: f(p) };
    });
  }
  pts.sort((x, y) => x.v - y.v);
  return pts[0].p;
}

/**
 * Least squares fit of the Hantush and Jacob curve to drawdown at one observation well.
 * t: days, s: drawdown in m, Q: m3/d, r: m. Returns T (m2/d), S, B (m), c (d) = B^2/T,
 * rB = r/B, rmse (m), and edge 'low' or 'high' when r/B ends at the end of its range.
 */
export function fitLeaky(t, s, Q, r) {
  if (!(Q > 0) || !(r > 0)) throw new Error('The pumping rate and distance must be above zero.');
  const tMin = Math.min(...t), tMax = Math.max(...t);
  const la0 = libm.log(tMin * 1e-4), la1 = libm.log(tMax * 1e4);
  const lb0 = libm.log(RB_MIN), lb1 = libm.log(RB_MAX);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const f = ([la, lb]) => sse(t, s, libm.exp(clamp(la, la0, la1)), libm.exp(clamp(lb, lb0, lb1))).e;
  let best = [la0, lb0], bestE = Infinity;
  const NA = 36, NB = 25;
  for (let i = 0; i <= NA; i++) {
    for (let j = 0; j <= NB; j++) {
      const p = [la0 + (la1 - la0) * i / NA, lb0 + (lb1 - lb0) * j / NB], e = f(p);
      if (e < bestE) { bestE = e; best = p; }
    }
  }
  const p = simplex(f, best, [(la1 - la0) / NA / 2, (lb1 - lb0) / NB / 2]);
  const a = libm.exp(clamp(p[0], la0, la1)), rB = libm.exp(clamp(p[1], lb0, lb1));
  const { c, e } = sse(t, s, a, rB);
  const T = Q / (4 * Math.PI * c), S = 4 * T * a / (r * r), B = r / rB;
  const edge = rB <= RB_MIN * 1.0001 ? 'low' : rB >= RB_MAX * 0.9999 ? 'high' : null;
  return { T, S, B, c: B * B / T, rB, a, scale: c, rmse: Math.sqrt(Math.max(e, 0) / t.length), rows: t.length, edge };
}

/** Hantush and Jacob drawdown, from a fit. */
export const leakyCurve = (fit, t) => t.map((x) => fit.scale * leakyWellFunction(fit.a / x, fit.rB));

/**
 * The whole analysis: readings averaged into equal widths of log time, then the leaky
 * fit and, for comparison, the Theis fit on the same points.
 * t: days since pumping began, s: drawdown in m, Q: m3/d, r: m. from/to in days, optional.
 */
export function analyzeLeaky({ t, s, Q, r, from, to }) {
  const keep = t.map((_, i) => i).filter((i) => isNum(t[i]) && isNum(s[i]) && t[i] > 0 && s[i] > 0
    && (!isNum(from) || t[i] >= from) && (!isNum(to) || t[i] <= to));
  const bins = logBins(keep.map((i) => t[i]), keep.map((i) => s[i]));
  if (bins.t.length < 4) {
    const where = isNum(from) || isNum(to) ? ' inside the fit window' : '';
    throw new Error(`Only ${bins.t.length} point${bins.t.length === 1 ? '' : 's'} with time and drawdown above zero${where} after averaging, and the fit needs at least four.`);
  }
  return { bins, used: keep.length, leaky: fitLeaky(bins.t, bins.y, Q, r), theis: fitTheis(bins.t, bins.y, Q, r) };
}
