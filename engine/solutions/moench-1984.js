// Moench (1984): a double-porosity aquifer of fractures and matrix blocks, the blocks
// slab-shaped or sphere-shaped, with transient flow inside the blocks and a skin of low
// conductivity on the block faces (fracture skin). The pumped well fully penetrates the
// fracture system, with wellbore storage and skin. Solved in Laplace space and turned
// back into time by de Hoog, Knight and Stokes (1982).
//
// Laplace form in dimensional p, all lengths in metres and t in days:
//   s(r, p) = (Q/p) K0(λr) / D,  in the pumped well (Q/p) (K0(x) + Sw x K1(x)) / D
//   D = p π rc² (K0(x) + Sw x K1(x)) + 2π K b x K1(x),   x = λ rw
//   λ² = p (Ss + Ss′ B(ξ)) / K,                          ξ = (mb/2) √(p Ss′ / K′)
//   slabs:   B = (tanh ξ / ξ) / (1 + Sf ξ tanh ξ)
//   spheres: B = 3 (ξ coth ξ − 1) / ξ² / (1 + Sf (ξ coth ξ − 1))
// K, Ss are the fracture system's and K′, Ss′ the blocks', each per unit volume of the
// whole aquifer; mb is the slab thickness or sphere diameter, Sf = 2 K′ ds / (Ks mb)
// the dimensionless fracture skin (ds and Ks the thickness and conductivity of the skin
// on the block faces) and Sw the wellbore skin. Moench's paper could not be obtained:
// this is his solution as the ANSDIMAT manual reproduces it, written back in dimensional
// form. Without fracture skin the block terms are Barker's (1988, equations 26 to 28)
// block geometry functions for θ = 1 and 3.
//
// Stehfest's method, used before, loses all accuracy where the drawdown is small (at
// u = 15 on the Theis curve its 16-term sum is out by a factor of ten and below zero);
// de Hoog's holds there, at complex p.

import { cadd, cdiv, cexp, cmul, cscale, csqrt, csub, cx, deHoogAt, kScaled01 } from '../laplace.js';
import { sig } from '../format.js';
import { derived, imageStorageWarning, SKIN_HINT, SKIN_MIN, SS_MAX, skinAllowed, skinRefusal } from './bounds.js';
import * as libm from '../libm.js';
import { BARKER_1988, DE_HOOG_ET_AL_1982, KRUSEMAN_DE_RIDDER_1994, PAPADOPULOS_COOPER_1967 } from '../refs.js';

const cabs = (z) => libm.hypot(z.re, z.im);
const ONE = cx(1);

// tanh ξ / ξ for Re ξ >= 0, through e^-2ξ, which cannot overflow there; by its series
// (1 − ξ²/3 + 2ξ⁴/15 − 17ξ⁶/315) near 0, where the subtraction would lose digits.
function tanhOver(xi) {
  if (cabs(xi) < 1e-3) {
    const q = cmul(xi, xi);
    return csub(ONE, cmul(q, csub(cx(1 / 3), cmul(q, csub(cx(2 / 15), cscale(q, 17 / 315))))));
  }
  const e = cexp(cscale(xi, -2));
  return cdiv(cdiv(csub(ONE, e), cadd(ONE, e)), xi);
}

// ξ coth ξ − 1, by its series where the subtraction would lose digits.
function xiCothM1(xi) {
  if (cabs(xi) < 0.1) {
    const q = cmul(xi, xi);
    return cmul(q, csub(cx(1 / 3), cmul(q, csub(cx(1 / 45), cmul(q, csub(cx(2 / 945), cscale(q, 1 / 4725)))))));
  }
  const e = cexp(cscale(xi, -2));
  return csub(cmul(xi, cdiv(cadd(ONE, e), csub(ONE, e))), ONE);
}

/** The block term B(ξ) with fracture skin Sf, for 'slab' or 'sphere' blocks, at complex ξ (or a real number). */
export function blockFunction(shape, xi, Sf) {
  const z = typeof xi === 'number' ? cx(xi) : xi;
  if (shape === 'slab') {
    const b = tanhOver(z);
    const B = cdiv(b, cadd(ONE, cscale(cmul(cmul(z, z), b), Sf)));
    return typeof xi === 'number' ? B.re : B;
  }
  const c = xiCothM1(z);
  const B = cdiv(cscale(cdiv(c, cmul(z, z)), 3), cadd(ONE, cscale(c, Sf)));
  return typeof xi === 'number' ? B.re : B;
}

/** The Laplace transform of drawdown at r, at complex p, for a rate Q from t = 0. */
export function moenchLaplace(p, { K, Ss, Kb, Ssb, Sw, Sf }, { r, rw, rc, b, mb, shape }, Q) {
  const xi = cscale(csqrt(cscale(p, Ssb / Kb)), mb / 2);
  const store = cadd(cx(Ss), cscale(blockFunction(shape, xi, Sf), Ssb));
  const lambda = csqrt(cscale(cmul(p, store), 1 / K));
  const x = cscale(lambda, rw);
  // e^x K0(x) and e^x K1(x): the scale cancels in the ratios below.
  const [k0, k1] = kScaled01(x);
  const xk1 = cmul(x, k1);
  const face = cadd(k0, cscale(xk1, Sw));
  const D = cmul(p, cadd(cscale(cmul(p, face), Math.PI * rc * rc), cscale(xk1, 2 * Math.PI * K * b)));
  if (r <= rw) return cscale(cdiv(face, D), Q);
  const [k0r] = kScaled01(cscale(lambda, r));
  return cscale(cdiv(cmul(k0r, cexp(cscale(lambda, -(r - rw)))), D), Q);
}

function need(p, g) {
  for (const k of ['r', 'rw', 'rc', 'b', 'mb']) {
    if (!(typeof g[k] === 'number' && g[k] >= 0)) throw new Error(`Moench (1984) needs ${k}.`);
  }
  if (!(g.rw > 0 && g.b > 0 && g.mb > 0)) throw new Error('Moench (1984) needs rw, b and the block size mb above zero.');
  if (g.r < g.rw) throw new Error('The distance r cannot be less than the well radius rw.');
  if (g.shape !== 'slab' && g.shape !== 'sphere') throw new Error('Moench (1984) needs the block shape: slabs or spheres.');
  if (!skinAllowed(p.Sw)) throw new Error(skinRefusal('Moench (1984)'));
  // Moench (1984, abstract): the fracture skin is a thin layer of low-permeability material
  // on the block faces that impedes the exchange, so it is zero or above.
  if (!skinAllowed(p.Sf)) throw new Error('The fracture skin Sf cannot be below zero: Moench (1984) describes it as a thin layer of low-permeability material on the block faces, which can only slow the exchange of water between blocks and fractures. Zero means no fracture skin.');
}

const ANSDIMAT = 'ANSDIMAT help: Conceptual models > Fracture-porous media > Moench\'s solutions. https://ansdimat.com/help/source/fracture-1.htm (consulted 7 November 2026).';

/**
 * Where the fit's search tries K′ (fitSolution, a parameter's grid): at the values that put
 * a block's own time, tb = (mb/2)² Ss′/K′, the time at which ξ = 1 in the block term, at
 * each log cycle from a tenth of the first reading's time to ten times the last, with Ss′
 * at S/b, the middle of the values the search tries for it. Far from ξ = 1 the blocks
 * either keep up with the fractures (ξ small: the aquifer acts as one of storage Ss + Ss′)
 * or are not reached in the record's time at all, and K′ then changes the drawdown little
 * or not at all, so a search started there has nothing to follow toward the readings. A
 * second K tried by its kind, from 10 K down to K/100, put tb before the second minute of
 * the Oude Korendijk record at every point of the grid. Null, for the kind's grid, without
 * an S from the readings.
 */
function blockGrid(set, g, [first, last]) {
  if (!(set.S > 0 && g.b > 0 && g.mb > 0 && first > 0 && last > first)) return null;
  const ss = set.S / g.b, a = first / 10, z = last * 10;
  const n = Math.ceil(libm.log10(z / a)) + 1;
  return Array.from({ length: n }, (_, i) => (libm.pow(g.mb / 2, 2) * ss) / (a * libm.pow(z / a, i / (n - 1))));
}

const PARAMS = [
  { id: 'K', symbol: 'K', label: 'Hydraulic conductivity of the fracture system', kind: 'K' },
  { id: 'Ss', symbol: 'Ss', label: 'Specific storage of the fracture system', kind: 'Ss', max: SS_MAX },
  { id: 'Kb', symbol: 'K′', label: 'Hydraulic conductivity of the matrix blocks K′', kind: 'K', grid: blockGrid },
  { id: 'Ssb', symbol: 'Ss′', label: 'Specific storage of the matrix blocks Ss′', kind: 'Ss', max: SS_MAX },
  { id: 'Sw', symbol: 'Sw', label: 'Wellbore skin Sw', kind: 'skin', min: SKIN_MIN, hint: SKIN_HINT },
  { id: 'Sf', symbol: 'Sf', label: 'Fracture skin Sf', kind: 'skin', min: 0, hint: 'No unit. Zero or above; 0 is no fracture skin.' },
];

export default {
  id: 'moench-1984',
  name: 'Moench (1984)',
  family: 'fractured',
  summary: 'Double porosity: fractures fed by slab or sphere matrix blocks, with transient block flow, fracture skin, and wellbore storage and skin.',
  params: PARAMS,
  // mb is the slab thickness or sphere diameter (ANSDIMAT's notation for Moench's blocks).
  geometry: ['r', 'rw', 'rc', 'b', 'mb'],
  options: [{ id: 'shape', label: 'Block shape', choices: [['slab', 'Slabs'], ['sphere', 'Spheres']] }],
  images: true,
  drawdown(p, g, t, Q) {
    need(p, g);
    return t.map((x) => (x > 0 ? deHoogAt((s) => moenchLaplace(s, p, g, Q), x) : 0));
  },
  references: [
    ANSDIMAT,
    BARKER_1988,
    DE_HOOG_ET_AL_1982,
    KRUSEMAN_DE_RIDDER_1994,
    'Moench, A.F. (1984) Double-porosity models for a fissured groundwater reservoir with fracture skin. Water Resources Research 20(7), 831-846.',
    PAPADOPULOS_COOPER_1967,
  ],
  method(p, g, ctx) {
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const blocks = g.shape === 'slab' ? `slab-shaped blocks ${sig(g.mb, 4)} m thick` : `sphere-shaped blocks ${sig(g.mb, 4)} m across`;
    const where = g.r <= g.rw ? 'in the pumped well, with the head lost across the wellbore skin' : `at r = ${sig(g.r, 4)} m from the pumped well`;
    return {
      lines: [
        `Drawdown ${where}, from Moench's (1984) double-porosity model with ${blocks}. Its assumptions: a confined aquifer of uniform thickness and infinite extent, made of fractures that carry the flow to the well and matrix blocks that store water and release it into them; flow inside the blocks is transient; a thin skin of low conductivity and no storage may coat the block faces; the well fully penetrates the aquifer, is pumped at a constant rate, and has storage in its casing and a thin skin with no storage.`,
        "Here s is the drawdown, Q the pumping rate, p the Laplace variable, r the distance from the pumped well, rw the well's radius and rc its casing's radius, b the aquifer thickness, K and Ss the hydraulic conductivity and specific storage of the fracture system and K′ and Ss′ those of the blocks (each per unit volume of the whole aquifer), mb the slab thickness or sphere diameter, Sw the wellbore skin, Sf = 2K′ds/(Ks mb) the fracture skin (ds and Ks the thickness and conductivity of the skin on the block faces), λ the rate at which drawdown dies away with distance in Laplace space and x = λ rw, ξ the half-size of a block, mb/2, divided by √(K′/(p Ss′)), the depth to which a change of head reaches into a block in Laplace space, B(ξ) the rate at which the blocks give water, and K0 and K1 the modified Bessel functions of the second kind. Flow from the blocks passes the fracture skin; the pseudo-steady model is its limit for a large fracture skin (Kruseman and de Ridder 1994, p. 250).",
        `With these values: b = ${sig(g.b, 4)} m, rw = ${sig(g.rw, 4)} m, rc = ${sig(g.rc, 4)} m (casing storage π rc²); ${d(['Sw'], 'Sw', `Sw = ${sig(p.Sw, 4)}`)}; ${d(['Sf'], 'Sf', `Sf = ${sig(p.Sf, 4)}`)}.`,
        "Moench's paper could not be obtained for this work. The equations are those the ANSDIMAT manual reproduces, rewritten in metres and days, and checked against Barker's (1988, equations 26 to 28) block functions without fracture skin, a finite-volume model of a block with skin, the pseudo-steady limit and Papadopulos and Cooper (1967) without a matrix.",
        'Drawdown is computed from its Laplace transform and turned back into time by the method of de Hoog, Knight and Stokes (1982), with 21 values of the transform for each time. In metres and days throughout.',
      ],
      formula: "s(r, p) = (Q/p) K0(λr) / [p π rc² (K0(x) + Sw x K1(x)) + 2πKb x K1(x)],  x = λ rw\nλ² = p (Ss + Ss′ B(ξ)) / K,  ξ = (mb/2) √(p Ss′/K′)\nslabs: B = (tanh ξ / ξ) / (1 + Sf ξ tanh ξ);  spheres: B = 3(ξ coth ξ − 1)/ξ² / (1 + Sf (ξ coth ξ − 1))",
    };
  },
  check(p, g, ctx) {
    const out = [];
    if (g.r > g.rw && !(g.rc > 0) && p.Sw !== 0) out.push('With no well storage (rc = 0), the wellbore skin does not change the drawdown away from the well, so it cannot be fitted from these readings.');
    if (!(g.r > g.rw)) out.push('In the pumped well, the fracture storage and the wellbore skin act together: at late time the drawdown fixes only Ss e^(−2Sw) (Kruseman and de Ridder 1994, equation 14.23). Treat Ss as an order of magnitude unless an observation well gives it too.');
    out.push(...imageStorageWarning(p.Ss * g.b, g.rc, ctx, 'Ss'));
    return out;
  },
};
