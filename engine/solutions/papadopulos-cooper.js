// Papadopulos and Cooper (1967): a fully penetrating pumped well of finite diameter in a
// confined aquifer, whose casing holds water that supplies part of the early pumping.
// Papadopulos (1967) extended it to drawdown in the aquifer at r > rw. Their solution,
// as given by Reed (1980, p. 37):
//   s = Q / (4 pi T) F(u, alpha, rho),  u = r^2 S / 4Tt,  alpha = rw^2 S / rc^2,  rho = r / rw
// F is an integral of J and Y Bessel functions. Here the same problem is solved in Laplace
// space, from the boundary conditions Reed lists (p. 37, equations 1 to 5):
//   s(p) = Q / (2 pi T p) K0(q r) / [q rw K1(q rw) + (p rc^2 / 2T) K0(q rw)],  q = sqrt(pS/T)
// and turned back into time by de Hoog, Knight and Stokes (1982). Checked against the
// table of F in Reed (1980, table 8.1), which reprints Papadopulos and Cooper (1967) and
// Papadopulos (1967), and against the integral Reed prints for F (in the tests).
// Stehfest's 16-term sum, used before, gave small negative drawdowns at large u, at
// distant points early on (−1.2 × 10⁻⁷ m at r/rw = 10⁵); de Hoog's holds there.
import { cadd, cdiv, cexp, cmul, cscale, csqrt, cx, deHoogAt, kScaled01 } from '../laplace.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, imageStorageWarning, undeterminedOf } from './bounds.js';
import { DE_HOOG_ET_AL_1982, KRUSEMAN_DE_RIDDER_1994, PAPADOPULOS_COOPER_1967, REED_1980 } from '../refs.js';

/**
 * Laplace transform of the drawdown, times 2πT/Q, at complex Laplace variable p (1/d).
 * Numerator and denominator are both divided by K1(q rw); the e^z scaling of kScaled01
 * cancels except for e^(−q (r − rw)).
 */
export function papadopulosCooperLaplace(p, T, S, r, rw, rc) {
  const q = csqrt(cscale(p, S / T)), x = cscale(q, rw);
  const [k0, k1] = kScaled01(x), k = cdiv(k0, k1);
  const top = r > rw ? cmul(cdiv(kScaled01(cscale(q, r))[0], k1), cexp(cscale(q, -(r - rw)))) : k;
  return cdiv(top, cmul(p, cadd(x, cmul(cscale(p, (rc * rc) / (2 * T)), k))));
}

const PAPADOPULOS_1967 = 'Papadopulos, I.S. (1967) Drawdown distribution around a large-diameter well. National Symposium on Ground-Water Hydrology, San Francisco, California, November 6-8, 1967, Proceedings, 157-168.';

// Where the table of Papadopulos and Cooper (1967) stops, in alpha.
const ALPHA_MIN = 1e-5, ALPHA_MAX = 0.1;

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
];

export default {
  id: 'papadopulos-cooper',
  name: 'Papadopulos and Cooper (1967)',
  family: 'confined',
  summary: 'A large-diameter pumped well in a confined aquifer, whose stored water supplies the early pumping. Drawdown in the pumped well, or at a distance (Papadopulos 1967).',
  params: PARAMS,
  geometry: ['r', 'rw', 'rc'],
  // Each image carries its own storage, an approximation measured in
  // tests/solutions/images-storage.test.js; check() warns where it is poor.
  images: true,
  drawdown(p, g, t, Q) {
    const { T, S } = p, rw = g.rw, rc = g.rc, r = Math.max(g.r, rw);
    const F = (x) => papadopulosCooperLaplace(x, T, S, r, rw, rc);
    const c = Q / (2 * Math.PI * T);
    return t.map((x) => (x > 0 ? c * deHoogAt(F, x) : 0));
  },
  references: [PAPADOPULOS_COOPER_1967, PAPADOPULOS_1967, REED_1980, KRUSEMAN_DE_RIDDER_1994, DE_HOOG_ET_AL_1982],
  method(p, g, ctx) {
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const alpha = (g.rw * g.rw * p.S) / (g.rc * g.rc);
    const inWell = !(g.r > g.rw);
    // Times after which F is within a few percent of the Theis W(u): 250 rc^2/T in the
    // pumped well (Papadopulos and Cooper 1967, p. 242), 2500 rc^2/T in the aquifer
    // (Papadopulos 1967, p. 161), both as quoted by Reed (1980, p. 39).
    const theisAfter = ((inWell ? 250 : 2500) * g.rc * g.rc) / p.T;
    return {
      lines: [
        'Drawdown from a well that penetrates the whole of a confined aquifer and has a casing wide enough that the water stored in it matters. At first most of the pumped water comes from the casing, so the water level falls in proportion to time; later the aquifer supplies nearly all of it and the curve joins Theis. The aquifer is uniform and of infinite extent; there is no well loss; the water level in the well equals the head in the aquifer at the well face (Papadopulos and Cooper 1967; Papadopulos 1967, for drawdown in the aquifer).',
        'Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well (rw at the well itself), rw the radius of the screen, rc the radius of the casing where the water level moves, t the time, p the Laplace variable, q = √(pS/T), and K0 and K1 the modified Bessel functions of the second kind. The Laplace transform s(p) follows from the boundary conditions listed by Reed (1980, p. 37) and is turned back into time by the method of de Hoog, Knight and Stokes (1982), with 21 values of the transform for each time. Papadopulos and Cooper\'s papers could not be obtained for this work; the problem and table are as Reed (1980) reprints them. The calculation matches Reed\'s table of F (table 8.1; also Kruseman and de Ridder 1994, Annex 11.1) to the printed digits at 184 of its 212 entries; at the other 28 an independent evaluation of the integral Reed prints for F sides with the calculation, so they are taken as misprints in the table. In metres and days throughout.',
        `From the fitted values: ${d(['S'], 'α = rw²S/rc²', `α = rw²S/rc² = ${sig(alpha)}`)}. ${inWell ? 'Drawdown in the pumped well' : `Drawdown at r/rw = ${sig(g.r / g.rw)}`} is within a few percent of Theis after ${inWell ? '250' : '2500'} rc²/T (Reed 1980, p. 39)${undeterminedOf(ctx, ['T']).length ? ', which is not determined, because T is not' : `, about ${sig(theisAfter)} d`}.`,
      ],
      formula: 's = Q / (4πT) · F(u, α, r/rw),  u = r²S / (4Tt),  α = rw²S / rc²\ns(p) = Q / (2πTp) · K0(qr) / [q rw K1(q rw) + (p rc² / 2T) K0(q rw)],  q = √(pS/T)',
    };
  },
  check(p, g, ctx) {
    const out = [];
    if (g.r < g.rw) out.push('The distance r is less than the well radius rw. The drawdown is taken at the well face, r = rw.');
    const alpha = (g.rw * g.rw * p.S) / (g.rc * g.rc);
    if (!undeterminedOf(ctx, ['S']).length && (alpha < ALPHA_MIN || alpha > ALPHA_MAX)) out.push(`α = rw²S/rc² is ${sig(alpha)}, outside the range Papadopulos and Cooper (1967) tabulated (${sig(ALPHA_MIN)} to ${sig(ALPHA_MAX)}). The calculation still holds, but it has been checked against their table only inside that range.`);
    // The shapes for alpha a factor of ten apart differ only slightly (Papadopulos and
    // Cooper 1967, p. 244, as quoted by Reed 1980, p. 40), so S from the pumped well alone
    // is uncertain.
    if (!(g.r > g.rw)) out.push('S comes from the shape of the curve, which changes little when α changes tenfold (Papadopulos and Cooper 1967, p. 244, as quoted by Reed 1980, p. 40). Treat S as an order of magnitude unless an observation well gives it too.');
    out.push(...imageStorageWarning(p.S, g.rc, ctx));
    return out;
  },
};
