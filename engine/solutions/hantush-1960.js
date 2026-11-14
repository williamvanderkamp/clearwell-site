// Hantush (1960): a well pumping at a constant rate from a leaky aquifer whose aquitard
// stores water. Hantush published the drawdown only for small and for large times; here
// it is computed for every time from its Laplace transform, which holds both.
//
// The problem is Hantush's (1960, equations 5 to 7, p. 3716): radial flow in the aquifer,
// vertical flow in each aquitard, a line-sink well. His Laplace transform of the drawdown
// (equations 40 and 41, p. 3722) is, for a rate Q from t = 0,
//   s̄(r, p) = Q K0(κ r) / (2π T p),  κ² = p/ν + (K'/T) √(p/ν') coth(b' √(p/ν')) + (the same for b''),
// ν = T/S, ν' = K'b'/S'. Each aquitard's term is q(p)/T, with, in c = b'/K' and m = p S' c,
//   q(p) = (1/c) √m coth √m   constant head beyond the aquitard (Hantush's case 1)
//   q(p) = (1/c) √m tanh √m   no flow beyond it (his cases 2 and 3, p. 3724)
// as Barlow and Moench (1998, equations A1.27a and A1.27b) also give them, after Moench
// (1985). Only K'/b' and S' enter, so the aquitard is described by c = b'/K' and S'.
//
// The transform is turned back into time by the method of de Hoog, Knight and Stokes
// (1982), not Stehfest's: Stehfest with 16 terms is out by 0.2% at u = 5 on the Theis
// curve, where early readings at a distant piezometer still sit, while de Hoog's is
// good to 1e-9 there. It needs the transform at complex p, so K0 is taken at complex
// argument too; both come from laplace.js. Metres and days throughout.
import { cadd, cabs, cdiv, cexp, cmul, cscale, csqrt, csub, cx, deHoogAt, kScaled } from '../laplace.js';
import { erfc, GL_W, GL_X } from '../numeric.js';
import { wellFunction } from '../pumping.js';
import { countOf, sig } from '../format.js';
import { derived, FRACTION_MAX, readingsOf, timeText, undeterminedOf } from './bounds.js';
import * as libm from '../libm.js';
import { BARLOW_MOENCH_1998, DE_HOOG_ET_AL_1982, HANTUSH_1960, HANTUSH_JACOB_1955, KRUSEMAN_DE_RIDDER_1994, REED_1980 } from '../refs.js';

// x coth x and x tanh x for x = √m with Re x >= 0, through e^-2x, which cannot overflow
// there; by their series near 0, where both tend to 1 and m.
function cothTerm(m) {
  if (cabs(m) < 1e-8) return cadd(cx(1), cscale(m, 1 / 3));
  const x = csqrt(m), e = cexp(cscale(x, -2));
  return cmul(x, cdiv(cadd(cx(1), e), csub(cx(1), e)));
}
function tanhTerm(m) {
  if (cabs(m) < 1e-8) return m;
  const x = csqrt(m), e = cexp(cscale(x, -2));
  return cmul(x, cdiv(csub(cx(1), e), cadd(cx(1), e)));
}

/**
 * The aquitard's term q(p), in 1/d, for one aquitard at complex p: c = b'/K' in days,
 * Sa = S'. base: 'head' (constant head beyond it), 'noflow' (impermeable beyond it), or
 * 'infinite' (an aquitard so thick that the far side is never felt, which is Hantush's
 * small-time solution: q = √(p S' / c)).
 */
export function aquitardTerm(p, { c, Sa, base = 'head' }) {
  if (!(c > 0) || !Number.isFinite(c)) return cx(0);
  if (base === 'infinite') return csqrt(cscale(p, Sa / c));
  const m = cscale(p, Sa * c);
  return cscale(base === 'noflow' ? tanhTerm(m) : cothTerm(m), 1 / c);
}

/** κ = √((S p + Σ q) / T) at complex p, in 1/m. */
export function kappa(p, T, S, layers) {
  let sum = cscale(p, S);
  for (const layer of layers) sum = cadd(sum, aquitardTerm(p, layer));
  return csqrt(cscale(sum, 1 / T));
}

/** Laplace transform of the drawdown at r per unit rate, for aquitards in `layers`. */
export function leakyLaplace(p, r, T, S, layers) {
  const z = cscale(kappa(p, T, S, layers), r);
  return cdiv(cmul(cexp(cscale(z, -1)), kScaled(0, z)), cscale(p, 2 * Math.PI * T));
}

/**
 * Drawdown in m at each t (days), for any aquitard layout. The inversion is good to about
 * 10⁻⁹ of the drawdown; where the drawdown is itself below 10⁻¹² of Q/(2πT) its rounding
 * can dip below zero, and only there is it set to zero. A larger negative value is a
 * fault, and is left in view.
 */
export function leakyDrawdown(T, S, layers, r, t, Q) {
  const floor = (1e-12 * Q) / (2 * Math.PI * T);
  return t.map((ti) => {
    if (!(ti > 0)) return 0;
    const v = Q * deHoogAt((p) => leakyLaplace(p, r, T, S, layers), ti);
    return v < 0 && v > -floor ? 0 : v;
  });
}

/**
 * Hantush's (1960) small-time well function, from its defining integral (equation 46,
 * p. 3723, and the list of symbols, p. 3715)
 *   H(u, β) = integral from u to infinity of (e^-y / y) erfc(β√u / √(y (y - u))) dy,
 * written with y = u + w and w = e^v, where the integrand is smooth and dies off at
 * both ends, and taken by 8-point Gauss-Legendre panels 0.1 wide in v. β = 0 is Theis.
 * Kept separate from the Laplace route so each checks the other.
 */
export function hantushH(u, beta) {
  if (!(u > 0)) return Infinity;
  if (!(beta > 0)) return wellFunction(u);
  const b = beta * Math.sqrt(u);
  const f = (v) => {
    const w = libm.exp(v), y = u + w;
    return (libm.exp(-y) * w / y) * erfc(b / Math.sqrt(y * w));
  };
  // Below w_lo the erfc is under 1e-30 (its argument over 8); above w_hi e^-w is gone.
  const lo = libm.log(Math.min((b * b) / (64 * (u + 1)), 1e-3 * u) + 1e-300);
  const hi = libm.log(u + 50) + 1;
  const n = Math.ceil((hi - lo) / 0.1), h = (hi - lo) / n;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const mid = lo + (k + 0.5) * h;
    for (let j = 0; j < 4; j++) {
      const d = (GL_X[j] * h) / 2;
      sum += GL_W[j] * (f(mid - d) + f(mid + d));
    }
  }
  return (sum * h) / 2;
}

/**
 * Hantush's β at distance r for one aquitard: (r/4) √(S'/(c T S)), with c = b'/K'. His
 * β = rλ/4 (equation 8, p. 3716), λ = √(K'S'/(b'TS)) + √(K''S''/(b''TS)) (list of
 * symbols, p. 3715), so for two aquitards their β add; Reed (1980, eq. 15) gives the same.
 */
export const hantushBeta = (r, T, S, c, Sa) => (r / 4) * Math.sqrt(Sa / (c * T * S));

/**
 * The times, in days, that bound Hantush's (1960) two published forms, for aquitards in
 * `layers` (as for leakyDrawdown), with b'S'/K' = S'c for each:
 *   small: his small-time form H(u, β) (equation 8) holds "for t less than both
 *          b'S'/10K' and b''S''/10K''" (p. 3716), the same for his three cases;
 *   large: his large-time forms hold for t above the larger of 5b'S'/K' for an aquitard
 *          with constant head beyond it and 10b''S''/K'' for one with no flow beyond it:
 *          case 1, both 5 (p. 3716, equation 11); case 2, both 10 (p. 3717, equation 13);
 *          case 3, 5 and 10 (p. 3717, equation 15). The factors come from x coth x ≈ 1 + x²/3
 *          for x² < 0.2 and tanh x ≈ x for x² < 0.1 (pp. 3723 and 3724).
 * An aquitard too thick to feel its far side ('infinite') is in the small-time form at
 * every time and never in the large-time one (Hantush's Fig. 4, p. 3721).
 */
export function hantushRanges(layers) {
  let small = Infinity, large = 0;
  for (const { c, Sa, base = 'head' } of layers) {
    if (base === 'infinite') { large = Infinity; continue; }
    const tc = Sa * c;
    small = Math.min(small, tc / 10);
    large = Math.max(large, (base === 'noflow' ? 10 : 5) * tc);
  }
  return { small, large };
}

const layersOf = (p) => [{ c: p.c, Sa: p.Sa, base: 'head' }];

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  { id: 'c', symbol: 'c', label: 'Aquitard resistance c = b′/K′', kind: 'c' },
  { id: 'Sa', symbol: 'S′', label: 'Aquitard storativity S′', kind: 'S', max: FRACTION_MAX },
];

export default {
  id: 'hantush-1960',
  name: 'Hantush (1960)',
  family: 'leaky',
  summary: 'A leaky aquifer under an aquitard that stores water, with constant head above it: the modified Hantush method.',
  params: PARAMS,
  geometry: ['r'],
  images: true,
  drawdown(p, g, t, Q) {
    return leakyDrawdown(p.T, p.S, layersOf(p), g.r, t, Q);
  },
  references: [
    BARLOW_MOENCH_1998,
    DE_HOOG_ET_AL_1982,
    HANTUSH_1960,
    HANTUSH_JACOB_1955,
    KRUSEMAN_DE_RIDDER_1994,
    REED_1980,
  ],
  method(p, g, ctx) {
    const beta = hantushBeta(g.r, p.T, p.S, p.c, p.Sa);
    const tc = p.Sa * p.c;
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const tcKnown = !undeterminedOf(ctx, ['Sa', 'c']).length;
    return {
      lines: [
        "The drawdown from a well pumping at a constant rate from a confined aquifer that takes water through an overlying aquitard, with the aquitard's own storage counted: the problem of Hantush (1960, equations 5 to 7, p. 3716), his case 1 with one aquitard, as Reed (1980, solution 5) also states it. Its assumptions: the aquifer and aquitard are uniform and of infinite extent; the aquitard's conductivity is so much below the aquifer's that flow in the aquifer is horizontal and in the aquitard vertical (Hantush 1960, pp. 3713 and 3714); the head above the aquitard stays constant; the well fully penetrates the aquifer and is of small diameter, so it stores no water.",
        "Hantush published the solution in two parts: for small times, s = Q/(4πT) H(u, β) (equation 8, p. 3716), and for large times, s = Q/(4πT) W(uδ, r/B) with δ = 1 + S′/(3S) (equation 11, p. 3716). Here it is computed for every time from his Laplace transform (equation 40, p. 3722), which holds both, with the aquitard term q as Barlow and Moench (1998, equation A1.27a) write it, and turned back into time by the method of de Hoog, Knight and Stokes (1982), with 21 values of the transform for each time.",
        "In the formulas, s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, t the time, u = r²S/(4Tt), p the Laplace variable, κ the aquifer's decay rate in Laplace space, K0 the modified Bessel function of the second kind, c = b′/K′ the aquitard's resistance (b′ its thickness and K′ its vertical hydraulic conductivity), S′ its storativity, q the water it gives per unit drawdown, B = √(Tc) the leakage factor and W(u, r/B) the leaky well function. Only c and S′ describe the aquitard, so b′ and K′ are not needed apart; K′ = b′/c when b′ is known.",
        `With these values, ${d(['T', 'S', 'c', 'Sa'], 'β', `β = ${sig(beta, 3)}`)}, and ${d(['Sa', 'c'], 'S′c', `S′c = ${sig(tc, 3)} d`)}. Hantush's small-time form holds for t less than b′S′/10K′ = S′c/10${tcKnown ? ` = ${sig(tc / 10, 3)} d` : ''}, and his large-time form for t greater than 5b′S′/K′ = 5S′c${tcKnown ? ` = ${sig(5 * tc, 3)} d` : ''} (Hantush 1960, p. 3716); between them he gave no expression (p. 3717). The Laplace solution needs neither limit. With S′ = 0 the aquitard stores nothing, and the solution is that of Hantush and Jacob (1955), his equation 20 (p. 3718).`,
        'In metres and days throughout.',
      ],
      formula: "s̄(r, p) = Q K0(κr) / (2πTp),  κ² = (Sp + q) / T\nq = (1/c) √m coth √m,  m = p S′ c\nβ = (r/4) √(S′ / (c T S)),  u = r²S / (4Tt)",
    };
  },
  check(p, g, ctx) {
    const w = [];
    // A rule whose inputs the fit did not determine says nothing; the page gives the reason.
    const known = (...ids) => !undeterminedOf(ctx, ids).length;
    if (known('Sa', 'S') && p.Sa / p.S < 0.01) w.push(`S′/S is ${sig(p.Sa / p.S, 2)}, under 0.01, so the aquitard's storage changes the drawdown very little (Hantush 1960, p. 3718; Kruseman and de Ridder 1994, p. 93), and S′ is poorly fixed by the fit. Hantush and Jacob (1955) gives nearly the same curve.`);
    const beta = hantushBeta(g.r, p.T, p.S, p.c, p.Sa);
    if (known('T', 'S', 'c', 'Sa') && beta < 0.5) w.push(`β is ${sig(beta, 2)}. Below about 0.5 the early-time curves are so alike that β, and with it S′/c, is close to indeterminate (Kruseman and de Ridder 1994, p. 91; Reed 1980, p. 27).`);
    const R = readingsOf(ctx);
    if (R && known('Sa', 'c')) w.push(rangesNote(R, hantushRanges(layersOf(p)), ctx));
    return w;
  },
};

/**
 * Which of the readings fall in the range of time of each of Hantush's (1960) two forms,
 * for his case 1 with one aquitard. The curve here holds at every time, so no reading is
 * outside it, but the ranges say what the readings can show. With changes of rate each
 * change adds the same drawdown at the time since that change, so a reading is in the
 * small-time range when its time since pumping began is, and in the large-time range when
 * its time since its own rate began is.
 */
function rangesNote(R, { small, large }, ctx) {
  const n = R.t.length;
  const early = R.t.filter((t) => t < small).length, late = R.since.filter((t) => t > large).length;
  const between = n - early - late;
  const changes = R.t.some((t, i) => t !== R.since[i]);
  const said = [
    `Hantush (1960) gave this drawdown in two forms, each for a range of time: for t less than b′S′/10K′, here S′c/10 = ${timeText(small, ctx)}, s = Q/(4πT) H(u, β), the same whatever lies beyond the aquitard (equation 8, p. 3716); for t greater than 5b′S′/K′, here 5S′c = ${timeText(large, ctx)}, s = Q/(4πT) W(uδ, r/B) (equation 11, p. 3716); between them he gave no expression (p. 3717). The curve here is the inverse of his Laplace transform (equation 40, p. 3722), which holds at every time, so no reading is outside its range, but the ranges say what the readings can show.`,
    `Of the ${countOf(n, 'reading')} fitted, ${early} ${early === 1 ? 'is' : 'are'} before S′c/10, where the drawdown depends on S′ and c only through S′/c and not on the head above the aquitard; ${late} after 5S′c, where S′ enters only through S + S′/3; and ${between} between.`,
  ];
  if (early === n) said.push('So every reading is in the small-time range: they fix S′ and c only as S′/c, and cannot tell a constant head above the aquitard from no flow there, which is Hantush\'s case 2.');
  if (late === n) said.push('So every reading is in the large-time range: they fix S and S′ only as S + S′/3, and the curve is that of Hantush and Jacob (1955) with S + S′/3 for S.');
  if (changes) said.push('The rate changed, so a reading counts as before S′c/10 when its time since pumping began is, and as after 5S′c when its time since its own rate began is: each change adds the drawdown at the time since that change.');
  return said.join(' ');
}
