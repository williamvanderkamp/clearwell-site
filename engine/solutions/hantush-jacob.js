// Hantush and Jacob (1955): a well pumping from a confined aquifer that also takes water
// through an aquitard, whose own storage is neglected.
//   s = Q / (4 pi T) W(u, r/B),  u = r^2 S / (4 T t),  B = sqrt(T c)
// W(u, r/B) is the leaky well function of src/engine/leaky.js, checked there against
// the table of Kruseman and de Ridder (1994), Annex 4.2, after Hantush (1956).
import { leakyWellFunction } from '../leaky.js';
import { countOf, sig } from '../format.js';
import { derived, FRACTION_MAX, readingsOf, undeterminedOf } from './bounds.js';
import { HANTUSH_1956, HANTUSH_1960, HANTUSH_JACOB_1955, KRUSEMAN_DE_RIDDER_1994 } from '../refs.js';

// The span of r/B in the table it was checked against (Annex 4.2, pages 298 and 299).
const RB_TESTED = [0.005, 3];

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  // No upper limit: as B grows the curve becomes Theis's, which is the data failing to
  // fix B, not a limit of the method (Kruseman and de Ridder 1994, p. 81).
  { id: 'B', symbol: 'B', label: 'Leakage factor B', kind: 'L' },
];

export default {
  id: 'hantush-jacob',
  name: 'Hantush and Jacob (1955)',
  family: 'leaky',
  summary: 'A confined aquifer under an aquitard that leaks, with the storage in the aquitard neglected. Drawdown levels off as the leakage grows.',
  params: PARAMS,
  geometry: ['r'],
  images: true,
  drawdown(p, g, t, Q) {
    const c = Q / (4 * Math.PI * p.T), a = (g.r * g.r * p.S) / (4 * p.T), b = g.r / p.B;
    return t.map((x) => (x > 0 ? c * leakyWellFunction(a / x, b) : 0));
  },
  references: [
    HANTUSH_1956,
    HANTUSH_1960,
    HANTUSH_JACOB_1955,
    KRUSEMAN_DE_RIDDER_1994,
  ],
  method(p, g, ctx) {
    const c = p.B * p.B / p.T;
    return {
      lines: [
        'The drawdown from a well pumping at a constant rate from a confined aquifer that also takes water through an overlying aquitard, as given by Hantush and Jacob (1955). Its assumptions: the aquifer is uniform, of infinite extent and fully penetrated by the well; flow in the aquifer is horizontal and through the aquitard vertical; the aquitard stores no water; the head in the layer above the aquitard stays constant; the well is of small diameter (Kruseman and de Ridder 1994, section 4.2.1). Hantush (1960, equation 20, p. 3718) gives it as the limit of his solution for an aquitard that stores water, as that storage goes to zero; with storage, it follows from his solution only for t greater than 5b′S′/K′ (b′, K′ and S′ the aquitard\'s thickness, vertical conductivity and storativity), and then with S + S′/3 for S (equation 11, p. 3716).',
        'Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, t the time since pumping began, B the leakage factor and c the hydraulic resistance of the aquitard. W(u, r/B) is the leaky well function of Hantush (1956), taken from its integral with 8-point Gauss-Legendre panels in ln y, and checked against the table in Kruseman and de Ridder (1994, Annex 4.2) to its last printed digit.',
        `From the fitted values, ${derived(ctx, PARAMS, ['B', 'T'], 'c', `c = B²/T = ${sig(c, 4)} d`)}. In metres and days throughout.`,
      ],
      formula: 's = Q / (4πT) · W(u, r/B),  u = r²S / (4Tt)\nW(u, r/B) = integral from u to infinity of (1/y) exp(−y − r² / (4B²y)) dy\nB = √(Tc),  so  c = B² / T',
    };
  },
  check(p, g, ctx) {
    const rb = g.r / p.B;
    // With B not determined, r/B is not either, and the page already says why.
    if (undeterminedOf(ctx, ['B']).length) return [];
    const w = [];
    if (rb < RB_TESTED[0] || rb > RB_TESTED[1]) {
      w.push(`r/B is ${sig(rb)}, outside the span the well function was checked over against Hantush's table (${sig(RB_TESTED[0])} to ${sig(RB_TESTED[1])}). ${rb < RB_TESTED[0] ? 'So little leakage shows that B is poorly fixed by these data.' : 'The drawdown is steady almost from the start, so T and S are poorly fixed.'}`);
    }
    const R = readingsOf(ctx);
    if (R && !undeterminedOf(ctx, ['T']).length) w.push(storageNote(R, p, ctx));
    return w;
  },
};

/**
 * Hantush (1960) gives this curve as the limit of his leaky aquifer as the aquitard's
 * storage goes to zero (equation 20, p. 3718), and with storage S′ it follows from his
 * solution only in a range of time: for t greater than 5b′S′/K′ = 5S′c, as W(uδ, r/B)
 * with δ = 1 + S′/(3S) (case 1, equation 11, p. 3716), unless S′/S is 0.01 or less, when
 * the storage changes the drawdown very little (p. 3718). S′ is not fitted, so this says
 * how small S′ would have to be for the readings to lie in that range. A reading after a
 * change of rate counts by its time since that change, since each change adds the
 * drawdown at the time since it.
 */
function storageNote(R, p, ctx) {
  const c = (p.B * p.B) / p.T;
  const since = [...R.since].sort((a, b) => a - b);
  const all = since[0] / (5 * c), half = since[Math.floor(since.length / 2)] / (5 * c);
  const sKnown = !undeterminedOf(ctx, ['S']).length;
  return `Hantush (1960) gives this curve as the limit for an aquitard that stores no water (equation 20, p. 3718). If the aquitard has a storativity S′, the curve follows from his solution only for t greater than 5b′S′/K′ = 5S′c, and then with S standing for S + S′/3 (equation 11, p. 3716), unless S′/S is 0.01 or less, when the aquitard's storage changes the drawdown very little (p. 3718). S′ is not fitted here, so which readings are in that range depends on it: with c = B²/T = ${sig(c, 3)} d, all ${countOf(R.t.length, 'reading')} are later than 5S′c only if S′ is under ${sig(all, 2)}${R.t.length > 2 ? `, and half of them only if S′ is under ${sig(half, 2)}` : ''}${sKnown ? `; S′/S ≤ 0.01 is S′ ≤ ${sig(0.01 * p.S, 2)}` : ''}.${R.t.some((t, i) => t !== R.since[i]) ? ' The rate changed, so each reading counts by its time since its own rate began.' : ''} Where S′ may be larger, the Hantush (1960) solution on this page counts its storage at every time.`;
}
