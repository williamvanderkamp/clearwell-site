// Gringarten and Witherspoon (1972): a well that intersects a single plane, vertical
// fracture of half-length xf, fully penetrating a confined, homogeneous, isotropic
// aquifer. Water enters the fracture at the same rate per unit area along its length
// (uniform flux), and the fracture stores no water. As Kruseman and de Ridder (1994,
// equations 18.1 to 18.8) give it:
//   s = Q / (4 pi T) F(u_vf, x', y'),  u_vf = T t / (S xf^2),  x' = x/xf, y' = y/xf
// with x along the fracture and y across it, both measured from the pumped well.
//
// F is the Theis drawdown of a uniform line of sinks from -xf to xf, which is what
// Kruseman and de Ridder's time integrals (18.4 to 18.6) add up to:
//   F = (1/2) integral from -1 to 1 of E1(((x' - e)^2 + y'^2) / (4 u)) de
// On the fracture's line (y' = 0) this has a closed form, found by integrating by parts:
//   F = sum over a in {1 + x', 1 - x'} of [ sqrt(pi u) erf(a / (2 sqrt u)) + (a/2) E1(a^2 / (4u)) ]
// which for x' = 0 is Kruseman and de Ridder's equation 18.8 for the pumped well.

import { erf } from '../numeric.js';
import { wellFunction } from '../pumping.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, undeterminedOf } from './bounds.js';
import * as libm from '../libm.js';
import { KRUSEMAN_DE_RIDDER_1994 } from '../refs.js';

// 32-point Gauss-Legendre nodes and weights on (-1, 1), by Newton's method on P_32.
const GL = (() => {
  const n = 32, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = libm.cos((Math.PI * (i - 0.25)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
})();

function gauss(f, lo, hi) {
  const m = (lo + hi) / 2, h = (hi - lo) / 2;
  let sum = 0;
  for (let i = 0; i < GL.x.length; i++) sum += GL.w[i] * f(m + h * GL.x[i]);
  return sum * h;
}

// E1 past an argument of 60 is below 1e-28 and is taken as zero.
const E1_CUT = 60;
const E1 = (x) => (x > E1_CUT ? 0 : wellFunction(x));

/** F(u, x', y'), the drawdown function, for u = T t / (S xf^2). */
export function fractureF(u, xd, yd) {
  if (!(u > 0)) return 0;
  const x = Math.abs(xd), y = Math.abs(yd);
  if (y === 0) {
    let F = 0;
    for (const a of [1 + x, 1 - x]) {
      if (a === 0) continue;
      F += Math.sqrt(Math.PI * u) * erf(a / (2 * Math.sqrt(u))) + (a / 2) * E1((a * a) / (4 * u));
    }
    return F;
  }
  // Off the line, substitute e - x' = y' sinh z, which spreads the peak at e = x' over
  // z near 0. Only the part where the E1 argument is below the cut-off is integrated.
  const zLo = libm.asinh((-1 - x) / y), zHi = libm.asinh((1 - x) / y);
  const coshMax = Math.sqrt(4 * u * E1_CUT) / y;
  if (coshMax <= 1) return 0;
  const zCut = libm.acosh(coshMax);
  const a = Math.max(zLo, -zCut), b = Math.min(zHi, zCut);
  if (!(b > a)) return 0;
  const g = (z) => { const c = libm.cosh(z); return E1((y * y * c * c) / (4 * u)) * y * c; };
  let total = 0;
  // Split at the peak, z = 0, when it lies inside, and halve long ranges.
  const edges = [a];
  if (a < 0 && b > 0) edges.push(0);
  edges.push(b);
  for (let i = 0; i + 1 < edges.length; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const pieces = Math.max(1, Math.ceil((hi - lo) / 4));
    for (let k = 0; k < pieces; k++) total += gauss(g, lo + ((hi - lo) * k) / pieces, lo + ((hi - lo) * (k + 1)) / pieces);
  }
  return total / 2;
}

function need(g) {
  for (const k of ['x', 'y']) {
    if (!(typeof g[k] === 'number' && Number.isFinite(g[k]))) throw new Error(`Gringarten and Witherspoon (1972) need ${k}, the distance from the pumped well along (x) and across (y) the fracture.`);
  }
}

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  { id: 'xf', symbol: 'xf', label: 'Fracture half-length xf', kind: 'L' },
];

export default {
  id: 'gringarten-witherspoon',
  name: 'Gringarten and Witherspoon (1972)',
  family: 'fractured',
  summary: 'A well in a single vertical fracture of finite length, with uniform flux into the fracture: linear flow at first, then pseudo-radial.',
  params: PARAMS,
  // The observation point's place relative to the fracture, not just its distance:
  // x along the fracture and y across it, from the pumped well (0, 0 for the pumped well).
  geometry: ['x', 'y'],
  images: false,
  imagesOff: 'Boundaries are off for this solution: its drawdown depends on where the observation point lies relative to the fracture, not only on its distance from the well, so image wells cannot stand in for them.',
  drawdown(p, g, t, Q) {
    need(g);
    const c = Q / (4 * Math.PI * p.T), xd = g.x / p.xf, yd = g.y / p.xf;
    return t.map((x) => (x > 0 ? c * fractureF((p.T * x) / (p.S * p.xf * p.xf), xd, yd) : 0));
  },
  references: [
    'Gringarten, A.C., and Witherspoon, P.A. (1972) A method of analyzing pump test data from fractured aquifers. In: International Society for Rock Mechanics and International Association of Engineering Geology, Proceedings of the Symposium on Rock Mechanics, Stuttgart, volume 3-B, 1-9.',
    KRUSEMAN_DE_RIDDER_1994,
  ],
  method(p, g, ctx) {
    const pumped = g.x === 0 && g.y === 0;
    return {
      lines: [
        `Drawdown ${pumped ? 'in the pumped well (x = y = 0; Kruseman and de Ridder 1994, equation 18.8)' : `at x = ${sig(g.x, 4)} m along the fracture and y = ${sig(g.y, 4)} m across it, from the pumped well`}, from Gringarten and Witherspoon's (1972) uniform-flux vertical fracture, as Kruseman and de Ridder (1994, chapter 18) give it; the 1972 paper itself could not be obtained for this work. Its assumptions: a confined, homogeneous, isotropic aquifer of uniform thickness and infinite extent; a single plane vertical fracture of half-length xf through the pumped well, over the full thickness; water enters the fracture at the same rate per unit area along its length, and the fracture stores no water; the rate is constant from the start.`,
        'Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, t the time, xf the fracture half-length, x and y the distances from the pumped well along and across the fracture, u_vf = Tt/(Sxf²), E1 the exponential integral (the Theis well function W) and e the position along the fracture in half-lengths. F is the Theis drawdown of a uniform line of sinks along the fracture: in closed form on the fracture line, and by 32-point Gauss-Legendre quadrature off it.',
        `With these values, ${derived(ctx, PARAMS, ['xf'], 'xf', `xf = ${sig(p.xf, 4)} m`)}. In metres and days throughout.`,
      ],
      formula: 's = Q/(4πT) · F(u_vf, x/xf, y/xf),  u_vf = Tt / (S xf²)\nF = ½ ∫ from −1 to 1 of E1(((x/xf − e)² + (y/xf)²) / (4 u_vf)) de',
    };
  },
  check(p, g, ctx) {
    const out = [];
    const r = libm.hypot(g.x, g.y) / p.xf;
    const dist = libm.hypot(g.x, g.y);
    // With xf not determined, r/xf is not either, but the reason the method gives still holds.
    if (undeterminedOf(ctx, ['xf']).length) {
      if (dist > 0) out.push(`Beyond about 5 half-lengths from the well the curves cannot be told from Theis (Kruseman and de Ridder 1994, pp. 268-269), so a fracture shorter than about ${sig(dist / 5)} m on each side cannot be resolved from an observation point ${sig(dist)} m away.`);
    } else if (r > 5) out.push(`The observation point is ${sig(r)} half-lengths from the well; beyond 5 the curves cannot be told from Theis, so xf is not resolved (Kruseman and de Ridder 1994, pp. 268-269).`);
    // In the pumped well F depends on u_vf = Tt/(S xf²) alone, so S and xf enter only as S xf².
    if (g.x === 0 && g.y === 0) out.push('In the pumped well the drawdown depends on S and xf only through S xf², so the two cannot be told apart from these readings: hold one of them, or use an observation point off the well.');
    return out;
  },
};
