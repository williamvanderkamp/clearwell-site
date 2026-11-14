// Barker (1988), the generalized radial flow (GRF) model: radial flow of dimension n
// from a source of radius rw, with storage capacity Cw and skin Sw, into a homogeneous
// fractured medium of conductivity K and specific storage Ss. n need not be a whole
// number; n = 2 is Theis's cylinder and n = 3 a sphere.
//
// Laplace form, Barker (1988) equations 12, 13, 19, 22, 24, 25 and 29, with Q > 0 read
// as drawdown, as Barker says:
//   h(r, p) = (Q/p) ρ^ν K_ν(μρ)/K_ν(μ) / [p Cw (1 + Sw Φ) + K b^(3−n) α_n rw^(n−2) Φ]
//   ν = 1 − n/2,  μ = rw √(p Ss / K),  ρ = r / rw,  Φ = μ K_(ν−1)(μ) / K_ν(μ)
//   α_n = 2 π^(n/2) / Γ(n/2), the area of a unit sphere in n dimensions (equation 1)
// In the source itself (r = rw), equation 23 adds the skin: H = h(rw) (1 + Sw Φ).
// Cw = π rc², as Barker's Figure 1b draws it; Barker writes it Sw, a name kept here for
// the skin, as on the other solutions (Barker's own skin symbol is s_f).
//
// The transform is turned back into time by de Hoog, Knight and Stokes (1982), at
// complex p. Stehfest's method, used before, loses all accuracy where the drawdown is
// small: at u = 15 on the Theis curve its 16-term sum is out by a factor of ten and
// below zero. de Hoog's holds there (see the tests against Barker's equation 32).

import { cadd, cdiv, cexp, cmul, cscale, csqrt, cx, deHoogAt } from '../laplace.js';
import { unitSphereArea } from '../numeric.js';
import { sig } from '../format.js';
import { derived, SKIN_HINT, SKIN_MARGIN, SKIN_MIN, skinAllowed, SS_MAX, skinRefusal, undeterminedOf } from './bounds.js';
import * as libm from '../libm.js';
import { SIN_COS } from '../libm.js';
import { ABRAMOWITZ_STEGUN_1964, BARKER_1988, DE_HOOG_ET_AL_1982, KRUSEMAN_DE_RIDDER_1994 } from '../refs.js';

// Trapezoid nodes t_k = k/8 out to t = 60, with 2 sinh²(t_k/2) = cosh t_k − 1 at each,
// shared by every call with |z| up to 10, where the step is 1/8.
const H0 = 0.125, NODES = 480;
const W0 = Float64Array.from({ length: NODES + 1 }, (_, k) => { const s = libm.sinh((k * H0) / 2); return 2 * s * s; });
/** cosh(ν t_k) at the shared nodes, for one order ν. */
export const coshTable = (nu) => Float64Array.from({ length: NODES + 1 }, (_, k) => libm.cosh(nu * k * H0));

/**
 * [e^z K_a(z), e^z K_b(z)] for real orders a, b and complex z with Re z > 0. Past
 * |z| = 25 by the large-argument series (Abramowitz and Stegun 1964, 9.7.2), whose
 * smallest term is about e^-50 there. Below, from
 *   K_ν(z) = integral from 0 to infinity of exp(−z cosh t) cosh(νt) dt  (9.6.24)
 * by the trapezoid rule, which converges exponentially on it. On the de Hoog contour
 * arg z stays within π/4, so the integrand stays analytic and decaying in a strip π/4
 * wide, and a step of 1/8 is good to about e^-39; the peak narrows as 1/√|z|, so the
 * step shrinks with it beyond |z| = 10. The same rule as kScaled01 in laplace.js, for
 * any real order. ca and cb: coshTable(a) and coshTable(b), when the caller has them.
 */
export function kScaledPairC(a, b, z, ca = null, cb = null) {
  const m = libm.hypot(z.re, z.im);
  if (m > 25) {
    const series = (nu) => {
      const mu = 4 * nu * nu, z8 = cscale(z, 8);
      let term = cx(1), sum = cx(1);
      for (let k = 1; k <= 60; k++) {
        term = cdiv(cscale(term, (mu - (2 * k - 1) * (2 * k - 1)) / k), z8);
        sum = cadd(sum, term);
        if (libm.hypot(term.re, term.im) < 1e-17 * libm.hypot(sum.re, sum.im)) break;
      }
      return sum;
    };
    const root = csqrt(cdiv(cx(Math.PI / 2), z));
    return [cmul(series(a), root), cmul(series(b), root)];
  }
  const top = Math.max(Math.abs(a), Math.abs(b));
  let ar = 0.5, ai = 0, br = 0.5, bi = 0;
  if (m <= 10) {
    const A = ca || coshTable(a), B = cb || coshTable(b);
    for (let k = 1; k <= NODES; k++) {
      const w = W0[k], mag = libm.exp(-z.re * w);
      libm.sinCos(-z.im * w);
      const re = mag * SIN_COS[1], im = mag * SIN_COS[0];
      ar += re * A[k]; ai += im * A[k]; br += re * B[k]; bi += im * B[k];
      if (mag * Math.max(A[k], B[k]) < 1e-17 * Math.min(libm.hypot(ar, ai), libm.hypot(br, bi))) break;
    }
    return [cx(ar * H0, ai * H0), cx(br * H0, bi * H0)];
  }
  const h = H0 / Math.sqrt(m / 10);
  for (let k = 1; k < 20000; k++) {
    const t = k * h, sh = libm.sinh(t / 2), w = 2 * sh * sh;
    const mag = libm.exp(-z.re * w);
    libm.sinCos(-z.im * w);
    const re = mag * SIN_COS[1], im = mag * SIN_COS[0];
    const va = libm.cosh(a * t), vb = libm.cosh(b * t);
    ar += re * va; ai += im * va; br += re * vb; bi += im * vb;
    if (mag * libm.cosh(top * t) < 1e-17 * Math.min(libm.hypot(ar, ai), libm.hypot(br, bi))) break;
  }
  return [cx(ar * h, ai * h), cx(br * h, bi * h)];
}

// cosh(ν t_k) and cosh((ν − 1) t_k) for flow dimension n, made once for each curve.
const tablesFor = (n) => [coshTable(1 - n / 2), coshTable(-n / 2)];

/** The Laplace transform of drawdown at r, at complex p, for a rate Q from t = 0. */
export function barkerLaplace(p, { K, Ss, n, Sw }, { r, rw, rc, b }, Q, tables = tablesFor(n)) {
  const nu = 1 - n / 2;
  const mu = cscale(csqrt(cscale(p, Ss / K)), rw);
  const [kNu, kNu1] = kScaledPairC(nu, nu - 1, mu, tables[0], tables[1]);
  const phi = cdiv(cmul(mu, kNu1), kNu);
  const Cw = Math.PI * rc * rc;
  const flow = cscale(phi, K * libm.pow(b, 3 - n) * unitSphereArea(n) * libm.pow(rw, n - 2));
  const face = cadd(cx(1), cscale(phi, Sw));
  const denom = cmul(p, cadd(cmul(cscale(p, Cw), face), flow));
  if (r <= rw) return cscale(cdiv(face, denom), Q);
  const rho = r / rw;
  const [kr] = kScaledPairC(nu, nu, cscale(mu, rho), tables[0], tables[0]);
  const ratio = cmul(cdiv(kr, kNu), cexp(cscale(mu, -(rho - 1))));
  return cscale(cdiv(ratio, denom), Q * libm.pow(rho, nu));
}

// Barker's flow surfaces are n-dimensional spheres projected through three-dimensional
// space by b^(3−n) (Barker 1988, assumption 3 and section 2.2), so n is above 0 and at
// most 3.
const N_MAX = 3;

function need(p, g) {
  for (const k of ['r', 'rw', 'rc', 'b']) {
    if (!(typeof g[k] === 'number' && g[k] >= 0)) throw new Error(`Barker (1988) needs ${k}.`);
  }
  if (!(g.rw > 0)) throw new Error('Barker (1988) needs the source radius rw above zero.');
  if (!(g.b > 0)) throw new Error('Barker (1988) needs the extent of the flow zone b above zero.');
  if (g.r < g.rw) throw new Error('The distance r cannot be less than the source radius rw.');
  if (!skinAllowed(p.Sw)) throw new Error(skinRefusal('Barker (1988)'));
  // The same margin as the skin's, for the fit's differences at n = 3.
  if (!(p.n > 0 && p.n <= N_MAX + SKIN_MARGIN)) throw new Error(`The flow dimension n must be above 0 and at most 3 (it is ${sig(p.n)}): Barker's flow surfaces are n-dimensional spheres projected through three-dimensional space.`);
}

const PARAMS = [
  { id: 'K', symbol: 'K', label: 'Hydraulic conductivity of the fracture system', kind: 'K' },
  { id: 'Ss', symbol: 'Ss', label: 'Specific storage of the fracture system', kind: 'Ss', max: SS_MAX },
  { id: 'n', symbol: 'n', label: 'Flow dimension n', kind: 'other', max: N_MAX, hint: 'No unit. Above 0 and at most 3.' },
  { id: 'Sw', symbol: 'Sw', label: 'Skin at the source Sw', kind: 'skin', min: SKIN_MIN, hint: SKIN_HINT },
];

export default {
  id: 'barker-grf',
  name: 'Barker (1988)',
  family: 'fractured',
  summary: 'Generalized radial flow: the flow dimension n is fitted, from linear (1) through cylindrical (2) to spherical (3) and between, with storage and skin at the source.',
  params: PARAMS,
  geometry: ['r', 'rw', 'rc', 'b'],
  // Barker's own meaning of r and b, which differ from the page's usual labels.
  geometryLabels: {
    r: ['Distance from the source along the flow paths', 'Measured through the fracture system: the straight-line distance times the tortuosity (Barker 1988, p. 1797). Equal to rw for the pumped interval itself.'],
    b: ['Extent of the flow zone b', 'Barker\'s b: the flow area at distance r is αn b^(3−n) r^(n−1). For n = 2 it is the aquifer thickness; for n = 3 it drops out.'],
    rc: ['Radius of the pumped well casing', 'Sets the storage capacity of the source, π rc². Zero for no storage.'],
  },
  // Barker's r is a distance along the flow paths of a flow system of dimension n, not a
  // distance in a plane, so there is no plane in which to place image wells.
  images: false,
  imagesOff: "Boundaries are off for this solution: Barker's r is a distance along the flow paths of a flow system of dimension n, not a distance in a plane, so there is no plane in which to place image wells.",
  drawdown(p, g, t, Q) {
    need(p, g);
    const tables = tablesFor(p.n);
    return t.map((x) => (x > 0 ? deHoogAt((s) => barkerLaplace(s, p, g, Q, tables), x) : 0));
  },
  references: [
    ABRAMOWITZ_STEGUN_1964,
    BARKER_1988,
    DE_HOOG_ET_AL_1982,
    KRUSEMAN_DE_RIDDER_1994,
  ],
  method(p, g, ctx) {
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const where = g.r <= g.rw ? 'in the source (the pumped interval), with the head lost across the skin' : `at r = ${sig(g.r)} m from the source, measured along the flow paths`;
    return {
      lines: [
        `Drawdown ${where}, from Barker's (1988) generalized radial flow model. Its assumptions (Barker 1988, section 2.1): flow is radial and n-dimensional, from a single source into a homogeneous, isotropic fractured medium of infinite extent; Darcy's law holds; the source is an n-dimensional sphere of radius rw with a storage capacity, and a skin of infinitesimal thickness that impedes the flow; observation points have negligible size and storage; the rate is constant from the start.`,
        'Here s is the drawdown (Barker writes it h) and sw the drawdown in the source, Q the pumping rate, p the Laplace variable, K the hydraulic conductivity and Ss the specific storage of the fracture system, n the flow dimension and ν = 1 − n/2, rw the radius of the source, r the distance from its centre along the flow paths and ρ = r/rw, b the extent of the flow zone, which enters as b^(3−n), Cw = π rc² the storage capacity of the source (rc the casing radius; Barker writes it Sw), Sw the skin, αn = 2π^(n/2)/Γ(n/2) the area of a unit sphere in n dimensions (Γ the gamma function), μ = rw √(p Ss/K) the source radius in Laplace terms, Φ = μ K_(ν−1)(μ)/K_ν(μ), which is −(r ∂s/∂r)/s at the source face, and K_ν the modified Bessel function of the second kind of order ν.',
        `With these values: ${undeterminedOf(ctx, ['n']).length ? 'n is not determined, nor is ν' : `n = ${sig(p.n, 4)}, so ν = ${sig(1 - p.n / 2, 4)}`}; b = ${sig(g.b, 4)} m; rw = ${sig(g.rw, 4)} m; rc = ${sig(g.rc, 4)} m; ${d(['Sw'], 'Sw', `Sw = ${sig(p.Sw, 4)}`)}.`,
        'Drawdown is computed from its Laplace transform (Barker 1988, equations 23 and 25) and turned back into time by the method of de Hoog, Knight and Stokes (1982), with 21 values of the transform for each time. K_ν of complex argument comes from its integral (Abramowitz and Stegun 1964, 9.6.24) by the trapezoid rule, and from the large-argument series (9.7.2) beyond |μ| = 25. In metres and days throughout.',
      ],
      formula: 's(r, p) = (Q/p) ρ^ν K_ν(μρ) / K_ν(μ) / [p Cw (1 + Sw Φ) + K b^(3−n) αn rw^(n−2) Φ]\nν = 1 − n/2,  μ = rw √(p Ss/K),  ρ = r/rw,  Φ = μ K_(ν−1)(μ) / K_ν(μ)\nin the source: sw(p) = s(rw, p) (1 + Sw Φ)',
    };
  },
  check(p, g, ctx) {
    const out = [];
    if (!undeterminedOf(ctx, ['n']).length && p.n < 1) out.push(`The flow dimension n is ${sig(p.n)}, below 1, the lowest Barker (1988, Figure 2) plots.`);
    if (g.r > g.rw && !(g.rc > 0) && p.Sw !== 0) out.push('With no storage at the source (rc = 0), the skin does not change the drawdown away from it, so it cannot be fitted from these readings.');
    // Cooper-Jacob with skin (Kruseman and de Ridder 1994, equation 14.23, p. 215): at late
    // time in the source for n = 2, only Ss e^(-2 Sw) enters.
    if (!(g.r > g.rw)) out.push('In the source itself, the specific storage and the skin act together: at late time, for n = 2, the drawdown fixes only Ss e^(−2Sw) (Kruseman and de Ridder 1994, equation 14.23). Treat Ss as an order of magnitude unless a piezometer gives it too.');
    return out;
  },
};
