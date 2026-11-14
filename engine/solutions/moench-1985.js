// Moench (1985): Hantush's (1960) leaky aquifer with aquitard storage, pumped by a well of
// finite diameter that stores water and has a skin, in Laplace space. Moench's abstract
// gives the model: storage in the pumped well, a linear resistance to flow at the sand
// face (the skin), and Hantush's aquitards. Moench's paper itself could not be reached
// (see docs/tools/solutions/moench-1985.md), so the transform below is derived here from
// those stated conditions, the same way as for Papadopulos and Cooper (1967), and checked
// against their published tables and the Hantush (1960) limits.
//
// The aquifer obeys T(s'' + s'/r) = (S p + q) s in Laplace space, with q the aquitard
// term of hantush-1960.js, so s̄ = A K0(κr). At the well screen, radius rw:
//   rate:  Q/p = 2π rw T (−∂s̄/∂r) + π rc² p s̄w        (inflow plus water taken from the casing)
//   skin:  s̄w = s̄(rw) + Sw rw (−∂s̄/∂r),  Sw = K ds/(Ks rw)   (Moench's skin, as in WTAQ)
// which give, with x = κ rw and w = rc² p / (2T),
//   s̄(r) = Q K0(κr) / (2πT p D),   s̄w = Q [K0(x) + Sw x K1(x)] / (2πT p D)
//   D = x K1(x) + w [K0(x) + Sw x K1(x)].
// Turned back into time by de Hoog et al. (1982), as in hantush-1960.js. Metres and days.
import { cadd, cdiv, cexp, cmul, cscale, deHoogAt, kScaled, kScaled01 } from '../laplace.js';
import { hantushBeta, kappa } from './hantush-1960.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, imageStorageWarning, SKIN_HINT, SKIN_MIN, skinAllowed, skinRefusal, undeterminedOf } from './bounds.js';
import { BARLOW_MOENCH_1998, BARLOW_MOENCH_1999_COLON, DE_HOOG_ET_AL_1982, HANTUSH_1960, KRUSEMAN_DE_RIDDER_1994, PAPADOPULOS_COOPER_1967, REED_1980 } from '../refs.js';

/**
 * Laplace transform of the drawdown per unit rate, at complex p. r <= rw gives the pumped
 * well itself (with its skin); r > rw the aquifer at that distance. layers as in
 * hantush-1960.js. The Bessel functions are scaled by e^z, so the ratio holds where K0
 * and K1 themselves underflow.
 */
export function moenchLaplace(p, { r, rw, rc }, T, S, Sw, layers) {
  const k = kappa(p, T, S, layers), x = cscale(k, rw);
  const [k0, k1] = kScaled01(x), xk1 = cmul(x, k1);
  const face = cadd(k0, cscale(xk1, Sw));
  const D = cadd(xk1, cmul(cscale(p, (rc * rc) / (2 * T)), face));
  const top = r <= rw ? face : cmul(kScaled(0, cscale(k, r)), cexp(cscale(k, -(r - rw))));
  return cdiv(top, cmul(cscale(p, 2 * Math.PI * T), D));
}

/**
 * Drawdown in m at each t (days). The inversion is good to about 10⁻⁹ of the drawdown;
 * where the drawdown is itself below 10⁻¹² of Q/(2πT) its rounding can dip below zero,
 * and only there is it set to zero. A larger negative value is a fault, and is left in
 * view.
 */
export function moenchDrawdown(T, S, Sw, layers, geo, t, Q) {
  if (!skinAllowed(Sw)) throw new Error(skinRefusal('Moench (1985)'));
  const floor = (1e-12 * Q) / (2 * Math.PI * T);
  return t.map((ti) => {
    if (!(ti > 0)) return 0;
    const v = Q * deHoogAt((p) => moenchLaplace(p, geo, T, S, Sw, layers), ti);
    return v < 0 && v > -floor ? 0 : v;
  });
}

const atWell = (g) => !(g.r > g.rw);

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  { id: 'c', symbol: 'c', label: 'Aquitard resistance c = b′/K′', kind: 'c' },
  { id: 'Sa', symbol: 'S′', label: 'Aquitard storativity S′', kind: 'S', max: FRACTION_MAX },
  { id: 'Sw', symbol: 'Sw', label: 'Wellbore skin Sw', kind: 'skin', min: SKIN_MIN, hint: SKIN_HINT },
];

export default {
  id: 'moench-1985',
  name: 'Moench (1985)',
  family: 'leaky',
  summary: 'A leaky aquifer under an aquitard that stores water, pumped by a large-diameter well with storage and skin.',
  params: PARAMS,
  geometry: ['r', 'rw', 'rc'],
  images: true,
  drawdown(p, g, t, Q) {
    return moenchDrawdown(p.T, p.S, p.Sw, [{ c: p.c, Sa: p.Sa, base: 'head' }], g, t, Q);
  },
  references: [
    BARLOW_MOENCH_1998,
    BARLOW_MOENCH_1999_COLON,
    DE_HOOG_ET_AL_1982,
    HANTUSH_1960,
    KRUSEMAN_DE_RIDDER_1994,
    'Moench, A.F. (1985) Transient flow to a large-diameter well in an aquifer with storative semiconfining layers. Water Resources Research 21(8), 1121-1131.',
    PAPADOPULOS_COOPER_1967,
    REED_1980,
  ],
  method(p, g, ctx) {
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const where = atWell(g)
      ? 'This is the drawdown in the pumped well itself, which includes the head lost across the skin.'
      : `This is the drawdown in the aquifer ${sig(g.r, 3)} m from the pumped well. The skin there matters only through the well's storage: without storage it changes the pumped well's level but not the aquifer's (Barlow and Moench 1999, p. 11).`;
    return {
      lines: [
        "The drawdown from a well pumping at a constant rate from a confined aquifer that takes water through an overlying aquitard, with the aquitard's storage counted as in Hantush (1960), and with the water stored in the pumped well's casing and a thin skin at its screen counted as in Moench (1985). Its assumptions: the aquifer and aquitard are uniform and of infinite extent; flow in the aquifer is horizontal and in the aquitard vertical; the head above the aquitard stays constant; the well fully penetrates the aquifer; the skin stores no water and its head loss is proportional to the flow through it.",
        "Computed from its Laplace transform and turned back into time by the method of de Hoog, Knight and Stokes (1982), with 21 values of the transform for each time. Moench's paper could not be reached, so the transform was derived here from the conditions his abstract states, with the aquitard term of Barlow and Moench (1998, equation A1.27a). It reduces to Papadopulos and Cooper (1967) with no leakage and no skin, checked against their table as Reed (1980, table 8.1) reprints it, and to Hantush (1960) for a well of small diameter.",
        "In the formulas, s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, rw the screen's radius, rc the casing's radius where the water level moves, p the Laplace variable, κ the aquifer's decay rate in Laplace space and x = κ rw, c = b′/K′ the aquitard's resistance (b′ its thickness and K′ its vertical hydraulic conductivity), S′ its storativity, q the water it gives per unit drawdown, K0 and K1 the modified Bessel functions of the second kind, and Sw the skin, K ds/(Ks rw) for a skin ds thick with conductivity Ks (Barlow and Moench 1999, p. 11).",
        where,
        "Moench (1985, abstract) found that storage in a large-diameter well can hide the leakage from the aquitards' storage altogether, so early readings in such a well may say little about c and S′.",
        `With these values, ${d(['T', 'S', 'c', 'Sa'], "Hantush's β (Reed 1980, equation 15)", `Hantush's β = (r/4)√(S′/(cTS)) = ${sig(hantushBeta(g.r, p.T, p.S, p.c, p.Sa), 3)} (Reed 1980, equation 15)`)}, and ${d(['S'], "the well's storage rc²/(2rw²S)", `the well's storage, rc²/(2rw²S), is ${sig((g.rc * g.rc) / (2 * g.rw * g.rw * p.S), 3)}`)}.`,
        'In metres and days throughout.',
      ],
      formula: "s̄(r, p) = Q K0(κr) / (2πTp D),  in the well: Q [K0(x) + Sw x K1(x)] / (2πTp D)\nD = x K1(x) + (rc² p / 2T) [K0(x) + Sw x K1(x)],  x = κ rw\nκ² = (Sp + q) / T,  q = (1/c) √m coth √m,  m = p S′ c",
    };
  },
  check(p, g, ctx) {
    const w = [];
    // A rule whose inputs the fit did not determine says nothing; the page gives the reason.
    if (!undeterminedOf(ctx, ['Sa', 'S']).length && p.Sa / p.S < 0.01) w.push(`S′/S is ${sig(p.Sa / p.S, 2)}, under 0.01, so the aquitard's storage barely changes the drawdown (Kruseman and de Ridder 1994, p. 93), and S′ is poorly fixed by the fit.`);
    if (!(g.rc > 0)) w.push('The casing radius is zero, so the well stores no water; the skin then changes only the pumped well\'s own level.');
    if (atWell(g)) w.push('In the pumped well, the storativity and the skin act together: for a fully penetrating well, the late drawdown fixes only S e^(−2Sw) (Kruseman and de Ridder 1994, equation 14.23). Treat S as an order of magnitude unless an observation well gives it too.');
    w.push(...imageStorageWarning(p.S, g.rc, ctx));
    return w;
  },
};
