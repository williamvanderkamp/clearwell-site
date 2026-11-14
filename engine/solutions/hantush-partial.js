// Hantush (1961): a well of small diameter screened over part of a confined, anisotropic
// aquifer, pumping at a constant rate. The time-domain series, as given by Reed (1980,
// p. 8-9, equations 6, 7, 10 and 11, after Hantush 1961a, p. 85 and 90, and 1964, p. 353):
//   s = Q / (4 pi T) [W(u) + f],  u = r^2 S / 4Tt,  a = sqrt(Kz/Kr)
//   piezometer at depth z:
//     f = 2b / (pi (l - d)) sum n>=1 of (1/n) [sin(n pi l/b) - sin(n pi d/b)] cos(n pi z/b) W(u, n pi a r/b)
//   observation well screened from z1 to z2:
//     f = 2b^2 / (pi^2 (l - d)(z2 - z1)) sum (1/n^2) [sin(n pi l/b) - sin(n pi d/b)] [sin(n pi z2/b) - sin(n pi z1/b)] W(u, n pi a r/b)
// W(u, beta) is the leaky well function. Written as one integral,
//   f = integral from u to infinity of (e^-y / y) Theta(y) dy,  Theta(y) = sum f_n exp(-n^2 tau),  tau = (pi a r / 2b)^2 / y
// and Theta is summed directly where tau is large; where tau is small, the slowly converging
// sums over n are taken in closed form by Poisson summation, which brings in the image
// wells of Hantush's alternate form (Reed 1980, p. 8, equations 8 and 9) as erfc terms.
import { erfc, GL_W, GL_X } from '../numeric.js';
import { wellFunction } from '../pumping.js';
import { sig } from '../format.js';
import { becauseNot, derived, FRACTION_MAX, undeterminedOf } from './bounds.js';
import * as libm from '../libm.js';
import { DOUGHERTY_BABU_1984, HANTUSH_1961A, HANTUSH_1964, KRUSEMAN_DE_RIDDER_1994, REED_1980, WEEKS_1969 } from '../refs.js';

// Beyond y = CUT, e^-y adds nothing a double can hold.
const CUT = 46;
// Width of each panel, in ln y. The integrand changes on a scale of about 1 in ln y.
const PANEL = 0.25;
// Above TAU_SPLIT the series in n falls below e^-40 within 13 terms; below it, the closed
// form needs only the images within 4 pi, as erfc(pi / sqrt(TAU_SPLIT)) < 1e-17.
const TAU_SPLIT = 0.25;
const TWO_PI = 2 * Math.PI, SQRT_PI = Math.sqrt(Math.PI);

// True when the observation is the pumped well itself.
const inPumped = (g) => g.rw !== undefined && !(g.r > g.rw);

const wrap = (t) => ((t % TWO_PI) + TWO_PI) % TWO_PI;

/** sum n>=1 of sin(n theta) exp(-n^2 tau) / n, for tau <= TAU_SPLIT, by Poisson summation. */
export function sinSum(theta, tau) {
  const t = wrap(theta);
  if (t === 0) return 0;
  const w = 2 * Math.sqrt(tau);
  let images = 0;
  for (let m = -1; m <= 2; m++) {
    const phi = t - TWO_PI * m;
    images += Math.sign(phi) * erfc(Math.abs(phi) / w);
  }
  return (Math.PI - t) / 2 - (Math.PI / 2) * images;
}

/** sum n>=1 of cos(n theta) exp(-n^2 tau) / n^2, for tau <= TAU_SPLIT, by Poisson summation. */
export function cosSum(theta, tau) {
  const t = wrap(theta), st = Math.sqrt(tau), w = 2 * st;
  let images = 0;
  for (let m = -1; m <= 2; m++) {
    const phi = Math.abs(t - TWO_PI * m);
    images += 2 * st * libm.exp(-(phi * phi) / (4 * tau)) - SQRT_PI * phi * erfc(phi / w);
  }
  return (Math.PI * Math.PI) / 6 - (Math.PI * t) / 2 + (t * t) / 4 + tau / 2 - (SQRT_PI / 2) * images;
}

// Theta(y) as a function of tau, for one observation point: its series coefficients f_n
// for the direct sum, and the angles and signs of its closed form.
function theta(g) {
  const { b, d, l } = g, L = l - d, A = (Math.PI * l) / b, B = (Math.PI * d) / b;
  const inWell = inPumped(g);
  // The pumped well is read as the average over its own screen.
  const z1 = inWell ? d : g.z1, z2 = inWell ? l : g.z2;
  const piezo = z1 === z2;
  const coef = (n) => {
    const s = libm.sin(n * A) - libm.sin(n * B);
    if (piezo) return ((2 * b) / (Math.PI * L * n)) * s * libm.cos((n * Math.PI * z1) / b);
    return ((2 * b * b) / (Math.PI * Math.PI * L * (z2 - z1) * n * n)) * s * (libm.sin((n * Math.PI * z2) / b) - libm.sin((n * Math.PI * z1) / b));
  };
  const f = Array.from({ length: 14 }, (_, n) => (n ? coef(n) : 0));
  let closed;
  if (piezo) {
    // sin nX cos nZ = [sin n(X+Z) + sin n(X-Z)] / 2.
    const Z = (Math.PI * z1) / b, c = b / (Math.PI * L);
    const parts = [[A + Z, 1], [A - Z, 1], [B + Z, -1], [B - Z, -1]];
    closed = (tau) => c * parts.reduce((sum, [th, sign]) => sum + sign * sinSum(th, tau), 0);
  } else {
    // sin nX sin nY = [cos n(X-Y) - cos n(X+Y)] / 2.
    const Z1 = (Math.PI * z1) / b, Z2 = (Math.PI * z2) / b, c = (b * b) / (Math.PI * Math.PI * L * (z2 - z1));
    const parts = [[A - Z2, 1], [A + Z2, -1], [A - Z1, -1], [A + Z1, 1], [B - Z2, -1], [B + Z2, 1], [B - Z1, 1], [B + Z1, -1]];
    closed = (tau) => c * parts.reduce((sum, [th, sign]) => sum + sign * cosSum(th, tau), 0);
  }
  return (tau) => {
    if (tau <= TAU_SPLIT) return closed(tau);
    let sum = 0;
    for (let n = 1; n < f.length && n * n * tau < 42; n++) sum += f[n] * libm.exp(-n * n * tau);
    return sum;
  };
}

/** The correction f at each u, the integral from u to CUT of (e^-y / y) Theta(y) dy. */
function correction(us, Theta, gamma) {
  const integrand = (x) => { const y = libm.exp(x); return libm.exp(-y) * Theta(gamma / y); };
  const panel = (lo, hi) => {
    const mid = (lo + hi) / 2, half = (hi - lo) / 2;
    let s = 0;
    for (let j = 0; j < 4; j++) s += GL_W[j] * (integrand(mid - GL_X[j] * half) + integrand(mid + GL_X[j] * half));
    return s * half;
  };
  const top = libm.log(CUT), uMin = Math.min(...us.filter((u) => u > 0 && u < CUT));
  if (!Number.isFinite(uMin)) return us.map(() => 0);
  const lo = libm.log(uMin), n = Math.max(1, Math.ceil((top - lo) / PANEL)), h = (top - lo) / n;
  // above[k]: the integral from panel k's lower edge to the top.
  const above = new Float64Array(n + 1);
  for (let k = n - 1; k >= 0; k--) above[k] = above[k + 1] + panel(lo + k * h, lo + (k + 1) * h);
  return us.map((u) => {
    if (!(u < CUT)) return 0;
    const x = libm.log(u), k = Math.min(n - 1, Math.floor((x - lo) / h));
    return panel(x, lo + (k + 1) * h) + above[k + 1];
  });
}

/** Drawdown (m) at each t (d) for a constant rate Q (m3/d). */
export function hantushPartial(p, g, t, Q) {
  const r = Math.max(g.r, g.rw || 0), a = Math.sqrt(p['Kz/Kr']);
  const full = g.d <= 0 && g.l >= g.b;
  const us = t.map((x) => (x > 0 ? (r * r * p.S) / (4 * p.T * x) : Infinity));
  const gamma = libm.pow((Math.PI * a * r) / (2 * g.b), 2);
  const f = full ? us.map(() => 0) : correction(us, theta({ ...g, r }), gamma);
  const c = Q / (4 * Math.PI * p.T);
  return us.map((u, i) => (Number.isFinite(u) ? c * (wellFunction(u) + f[i]) : 0));
}

const HANTUSH_1961B = 'Hantush, M.S. (1961b) Aquifer tests on partially penetrating wells. Journal of the Hydraulics Division, Proceedings of the American Society of Civil Engineers 87(HY5), 171-195.';

// Times that bound the simpler forms, from the published conditions. Late: the correction
// is steady after t > b^2 S / (2 a^2 T) (Reed 1980, p. 9; Hantush 1961a, p. 92). Early:
// the aquifer acts as if it had no bottom before t < (2b - l - z)^2 S / (20 T) (Reed 1980,
// p. 10; Hantush 1961b, p. 172), taking z at the deepest point of the observation.
function regimes(p, g) {
  const zDeep = inPumped(g) ? g.l : Math.max(g.z1, g.z2);
  return {
    late: (g.b * g.b * p.S) / (2 * p['Kz/Kr'] * p.T),
    early: (libm.pow(2 * g.b - g.l - zDeep, 2) * p.S) / (20 * p.T),
  };
}

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  { id: 'Kz/Kr', symbol: 'Kz/Kr', label: 'Anisotropy Kz/Kr', kind: 'ratio' },
];

export default {
  id: 'hantush-partial',
  name: 'Hantush (1961), partial penetration',
  family: 'confined',
  summary: 'A confined, anisotropic aquifer pumped by a well of small diameter screened over part of its thickness. Drawdown at a piezometer or an observation well.',
  params: PARAMS,
  // rw only marks the pumped well (r = rw); the solution treats the well as a line.
  geometry: ['r', 'rw', 'b', 'd', 'l', 'z1', 'z2'],
  // Drawdown depends on depth as well as r, but an image well screened over the same
  // depths superposes exactly in a uniform layer.
  images: true,
  drawdown: hantushPartial,
  references: [DOUGHERTY_BABU_1984, HANTUSH_1961A, HANTUSH_1961B, HANTUSH_1964, KRUSEMAN_DE_RIDDER_1994, REED_1980, WEEKS_1969],
  method(p, g, ctx) {
    const { late, early } = regimes(p, g), Kr = p.T / g.b;
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const lateWhy = becauseNot(ctx, PARAMS, ['T', 'S', 'Kz/Kr']), earlyWhy = becauseNot(ctx, PARAMS, ['T', 'S']);
    const timesWhy = earlyWhy ? `Neither time is determined, ${lateWhy}. ` : lateWhy ? `The first of these times is not determined, ${lateWhy}. ` : '';
    const obs = inPumped(g) ? 'the pumped well, read as the average over its screen'
      : g.z1 === g.z2 ? `a piezometer ${sig(g.r)} m away at ${sig(g.z1)} m below the top of the aquifer`
        : `an observation well ${sig(g.r)} m away, screened ${sig(g.z1)} to ${sig(g.z2)} m below the top of the aquifer`;
    return {
      lines: [
        `Drawdown at ${obs}, from a well screened ${sig(g.d)} to ${sig(g.l)} m below the top of a confined aquifer ${sig(g.b)} m thick, pumping at a constant rate: the solution of Hantush (1961a, 1961b; with anisotropy, Hantush 1964), with its equations as Reed (1980, p. 8-9) gives them. The aquifer is uniform, of infinite extent, not leaky, and anisotropic in the vertical plane, Kz/Kr; the well has an infinitesimal diameter, so its storage is neglected, and water enters the screen at the same rate at every depth (Reed 1980, p. 8); Dougherty and Babu (1984) count the storage and skin of a well of finite diameter. Hantush's papers could not be obtained for this work.`,
        'Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, b the aquifer thickness, Kr = T/b and Kz the horizontal and vertical hydraulic conductivity, a = √(Kz/Kr), r the distance from the pumped well, t the time, u = r²S/(4Tt), d and l the depths to the top and bottom of its screen, z (or z1 to z2) the depth of the observation, W(u) the Theis well function, W(u, β) the leaky well function and f the correction for partial penetration. The series in n is summed inside one integral over y; where it converges slowly, its sum is taken in closed form by Poisson summation, which is the same as Hantush\'s alternate form with image wells (Reed 1980, equations 8 and 9).',
        `From the fitted values: ${d(['T'], 'Kr', `Kr = ${sig(Kr)} m/d`)}; ${d(['T', 'Kz/Kr'], 'Kz', `Kz = ${sig(Kr * p['Kz/Kr'])} m/d`)}. The correction f is steady, as tabulated by Weeks (1969) and Kruseman and de Ridder (1994, Annex 8.1), after t = b²S/(2T Kz/Kr)${lateWhy ? '' : ` = ${sig(late)} d`}; before t = (2b − l − z)²S/(20T)${earlyWhy ? '' : ` = ${sig(early)} d`} the aquifer acts as if it had no bottom (Hantush 1961b, p. 172, as quoted by Reed 1980, p. 10). ${timesWhy}The series itself holds at all times. In metres and days throughout.`,
      ],
      formula: 's = Q / (4πT) · [W(u) + f],  u = r²S / (4Tt),  a = √(Kz/Kr)\nf = 2b / (π(l − d)) Σ (1/n) [sin(nπl/b) − sin(nπd/b)] cos(nπz/b) W(u, nπar/b)   at a piezometer\nf = 2b² / (π²(l − d)(z2 − z1)) Σ (1/n²) [sin(nπl/b) − sin(nπd/b)] [sin(nπz2/b) − sin(nπz1/b)] W(u, nπar/b)   in an observation well\nW(u, β) = integral from u to infinity of (1/y) exp(−y − β²/4y) dy',
    };
  },
  check(p, g, ctx) {
    const out = [];
    if (!(g.b > 0) || !(g.d >= 0) || !(g.l > g.d) || !(g.l <= g.b)) out.push('The screen must lie inside the aquifer: 0 ≤ d < l ≤ b.');
    if (!inPumped(g) && !(g.z1 >= 0 && g.z2 >= g.z1 && g.z2 <= g.b)) out.push('Give the depth of the observation point: z1 = z2 for a piezometer, or the top and bottom of the observation screen, inside the aquifer.');
    if (inPumped(g)) out.push('The observation is the pumped well. Hantush (1961a) treats the well as a line with no storage and no well loss; for drawdown in the pumped well, Dougherty and Babu (1984) accounts for both.');
    const reach = (1.5 * g.b) / Math.sqrt(p['Kz/Kr']);
    const kzKnown = !undeterminedOf(ctx, ['Kz/Kr']).length;
    if (g.d <= 0 && g.l >= g.b) out.push('The well penetrates the whole aquifer, so this is the Theis solution and Kz/Kr cannot be fitted; hold it fixed.');
    // An observation screen over the whole thickness averages every cos(nπz/b) to zero, so
    // f vanishes and the drawdown is Theis's whatever Kz/Kr is.
    else if (!inPumped(g) && g.z1 <= 0 && g.z2 >= g.b) out.push('The observation well is screened over the whole aquifer, which averages out the vertical flow near the pumped screen: its drawdown is exactly the Theis solution, whatever Kz/Kr is, so Kz/Kr cannot be fitted from it; hold it fixed.');
    // Reed (1980, p. 9): partial penetration must be considered for a r / b < 1.5;
    // Kruseman and de Ridder (1994, p. 159) give 2 b sqrt(Kr/Kz).
    else if (kzKnown && g.r > reach) out.push(`The observation point is farther than 1.5 b √(Kr/Kz) = ${sig(reach)} m from the well, beyond which Reed (1980, p. 9) treats partial penetration as negligible (Kruseman and de Ridder 1994, p. 159, give 2 b √(Kr/Kz)). The drawdown is nearly Theis there, so Kz/Kr is poorly determined.`);
    return out;
  },
};
