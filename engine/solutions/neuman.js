// Neuman (1974, 1975): delayed gravity response of an unconfined anisotropic aquifer to a
// fully penetrating well, with the drawdown averaged over the saturated thickness, as a
// fully penetrating observation well sees it.
//   s = Q / (4 pi T) W(ts, sigma, beta),  ts = T t / (S r^2),  sigma = S / Sy,
//   beta = r^2 Kz / (b^2 Kr)
// W comes from src/engine/unconfined.js, by Stehfest inversion of its Laplace transform,
// checked there against all 392 values of Kruseman and de Ridder (1994), Annex 5.1.
// The fitted anisotropy is Kz/Kr, not beta, so the value does not depend on r and image
// wells at other distances can share it.
import { neumanAt } from '../unconfined.js';
import { STEHFEST_N } from '../laplace.js';
import { wellFunction } from '../pumping.js';
import { fitComments, lateReach, withCommentReferences } from '../water-table.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, singleCurveWarning, undeterminedOf } from './bounds.js';
import { KRUSEMAN_DE_RIDDER_1994, NEUMAN_1972, NEUMAN_1974, NEUMAN_1975, STEHFEST_1970 } from '../refs.js';

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity, elastic', kind: 'S', max: FRACTION_MAX },
  { id: 'Sy', symbol: 'Sy', label: 'Specific yield', kind: 'Sy', max: FRACTION_MAX },
  { id: 'Kz/Kr', symbol: 'Kz/Kr', label: 'Anisotropy Kz/Kr', kind: 'ratio' },
];

function drawdown(p, g, t, Q) {
  const c = Q / (4 * Math.PI * p.T), sigma = p.S / p.Sy, beta = (g.r * g.r * p['Kz/Kr']) / (g.b * g.b);
  return t.map((x) => (x > 0 ? c * neumanAt((p.T * x) / (p.S * g.r * g.r), sigma, beta) : 0));
}

export default {
  id: 'neuman',
  name: 'Neuman (1975)',
  family: 'unconfined',
  summary: 'An unconfined aquifer: water comes first from elastic storage, then from drainage as the water table falls. Drainage at the water table is instantaneous; the delay comes from vertical flow in the aquifer. Both wells screened over the full saturated thickness.',
  params: PARAMS,
  geometry: ['r', 'b'],
  images: true,
  drawdown,
  references: [
    KRUSEMAN_DE_RIDDER_1994,
    NEUMAN_1972,
    NEUMAN_1974,
    NEUMAN_1975,
    STEHFEST_1970,
  ],
  method(p, g, ctx) {
    const beta = (g.r * g.r * p['Kz/Kr']) / (g.b * g.b), Kr = p.T / g.b;
    // A number built from a value the fit did not determine is not determined either.
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    return {
      lines: [
        'Drawdown in an unconfined aquifer pumped at a constant rate by a well screened over the full saturated thickness, averaged over that thickness, as a fully penetrating observation well sees it. The aquifer is uniform, infinite and anisotropic; water comes first from elastic storage and then from gravity drainage as the water table falls. Drainage at the water table is instantaneous; the delay in it comes from the time water takes to flow vertically through the aquifer. The water table is treated as a boundary that moves little compared with the saturated thickness (Neuman 1972, 1974, 1975).',
        `Here s is the drawdown, Q the pumping rate, T the transmissivity, S the elastic storativity, Sy the specific yield, η = S/Sy (Neuman writes it σ), r the distance from the pumped well, t the time, ts = Tt/(Sr²), b the saturated thickness, Kr and Kz the horizontal and vertical hydraulic conductivity, Kz/Kr the anisotropy and β = r²Kz/(b²Kr). W is the Neuman well function, computed from its Laplace transform (p the Laplace variable of ts, e_n the roots of e tan e = p/(ηβ), K0 the modified Bessel function of the second kind) and turned back into time by the Stehfest (1970) algorithm with ${STEHFEST_N} terms; in the limit S/Sy → 0 it reproduces the type A and type B tables of Kruseman and de Ridder (1994, Annex 5.1) to within 2 in the last of the three printed digits.`,
        `From the fitted values: ${[
          d(['Kz/Kr'], 'β', `β = ${sig(beta, 4)}`),
          d(['T'], 'Kr', `Kr = T/b = ${sig(Kr, 4)} m/d`),
          d(['T', 'Kz/Kr'], 'Kz', `Kz = ${sig(Kr * p['Kz/Kr'], 4)} m/d`),
        ].join('; ')}. In metres and days throughout.`,
      ],
      formula: 's = Q / (4πT) · W(ts, η, β)\nts = Tt / (Sr²),  η = S / Sy,  β = r² Kz / (b² Kr)\nW(p) = (2/p) sum over n of 2 sin²(e_n) / (e_n (e_n + sin e_n cos e_n)) K0(√(β e_n² + p)),  e_n tan e_n = p / (ηβ)',
    };
  },
  check(p, g, ctx) {
    const out = [];
    // The span of beta in Neuman's tables, which W was checked against (Annex 5.1).
    const beta = g && g.r && g.b ? (g.r * g.r * p['Kz/Kr']) / (g.b * g.b) : NaN;
    if (!undeterminedOf(ctx, ['Kz/Kr']).length && (beta < 0.001 || beta > 7)) out.push(`β = r² Kz / (b² Kr) is ${sig(beta)}, outside the span of Neuman's tables (0.001 to 7) that the well function was checked against.`);
    const single = singleCurveWarning(p, ctx, PARAMS);
    out.push(...single);
    // Kruseman and de Ridder (1994, p. 103) set Sy/S above 10 for Neuman's method.
    if (!single.length && p.Sy / p.S < 10) out.push(`Sy/S is ${sig(p.Sy / p.S)}. Kruseman and de Ridder (1994, p. 103) list Sy/S above 10 as a condition for this method, so treat the result with caution.`);
    // The critical comments on a water table test (water-table.js), with the late Theis
    // curve, Q/(4 pi T) W(r²(S + Sy)/(4Tt)), against this curve at the last reading.
    const late = (Q, t, rms) => lateReach((x) => [drawdown(p, g, [x], Q)[0], (Q / (4 * Math.PI * p.T)) * wellFunction((g.r * g.r * (p.S + p.Sy)) / (4 * p.T * x))], t, rms);
    out.push(...fitComments(p, g, ctx, { late, fully: true }));
    return out;
  },
  // The page's references with the sources its notes cite added: the comments above cite
  // sources of their own.
  noteReferences: withCommentReferences,
};
