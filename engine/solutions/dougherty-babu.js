// Dougherty and Babu (1984): a pumped well of finite diameter, with wellbore storage and
// skin, screened over part of a confined aquifer, solved in Laplace space. Drawdown in the
// pumped well, or at a piezometer or observation well in the aquifer.
//
// The paper itself could not be read here (Wiley refused the download), so the module is
// built from the problem as published elsewhere and checked against every published value
// and limit that could be found:
// - Barlow and Moench (1999, p. 7) list the pumped-well assumptions of Dougherty and Babu
//   (1984): the head in the well is the same along it; the flow from the aquifer into the
//   screen is the same at every depth; no flow through the base of the well; a thin skin
//   with no storage may separate screen and aquifer, its factor Sw = Kr ds / (Ks rw).
// - The aquifer's response to that uniform flux, with anisotropy Kz/Kr, is the finite
//   cosine series of Mishra et al. (2012, equation 6 with no storage; also Yang et al.
//   2006), re-derived here in metres and days:
//     s(p) = Q / (2 pi T p) [ G(q0, r) + sum n>=1 of 2 e_n o_n G(qn, r) ]
//     G(q, r) = K0(q r) / (q rw K1(q rw)),  qn^2 = pS/T + (Kz/Kr)(n pi / b)^2
//     e_n = b / (n pi (l - d)) [sin(n pi l/b) - sin(n pi d/b)], the screen average of cos(n pi z/b)
//   and o_n is cos(n pi z/b) at a piezometer, or its average over an observation screen.
// - The well's water level is the screen average of the aquifer head at rw plus the skin
//   loss; the casing's storage takes Q - q(t) from it. In Laplace space, with H the well's
//   response per unit rate (Barlow and Moench 1999, p. 11, give the same storage and skin
//   groups):
//     sw(p) = Q / (2 pi T p) (Hw + Sw b/L) / (1 + (p rc^2 / 2T)(Hw + Sw b/L)),  L = l - d
//   and drawdown in the aquifer is its own response times the same 1 / (1 + ...).
// At full penetration this is Papadopulos and Cooper (1967) with skin; with rc = 0 and
// Sw = 0 it is Theis for a well of finite radius; with rw -> 0 it is the series of
// Hantush (1961). The tests check each of these.
import { cadd, cdiv, cexp, cmul, cscale, csqrt, cx, deHoogAt, k0OverK1, k0OverK1At, k0OverK1Both, k0OverK1BothTwice, k1OverK1At, K_RATIOS, kScaled01, stehfest, STEHFEST_N } from '../laplace.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, imageStorageWarning, SKIN_HINT, SKIN_MIN, skinAllowed, skinRefusal, undeterminedOf } from './bounds.js';
import * as libm from '../libm.js';
import { BARLOW_MOENCH_1999, DE_HOOG_ET_AL_1982, DOUGHERTY_BABU_1984_CORRECTION, HANTUSH_1961A, KRUSEMAN_DE_RIDDER_1994, PAPADOPULOS_COOPER_1967, REED_1980, STEHFEST_1970, WEEKS_1969 } from '../refs.js';

// The pumped well's series converges slowly, as 1/n^3, because the screen is a line of
// small radius. Terms are summed exactly until q rw reaches X0; past that,
// K0(x)/(x K1(x)) = 1/x - 1/(2x^2) + 3/(8x^3) + O(x^-4) is summed in closed form over the
// rest (Kummer's method).
const X0 = 8;
// The aquifer's series falls as exp(-qn (r - rw)); exp(-40) is far below a double's reach.
const DECAY = 40;
const N_MIN = 40, N_MAX = 6000;
// Only the first terms change much with p: qn^2 = pS/T + (Kz/Kr)(n pi/b)^2 and the second
// part soon dominates. Each series is summed once with p = 0, and at each p only terms up
// to n = DIRECT sqrt(pmax S/T) / (sqrt(Kz/Kr) pi/b) are recomputed; beyond them the change
// is linear in pS/T, to a relative error (1/DIRECT)^4. These counts are fixed within one
// call, so the error is smooth in p, as Stehfest's inversion needs.
const DIRECT = 6, DIRECT_MIN = 8;
// Terms of the closed-form tail sums Tk = sum n>N of s_n / n^k, beyond which the remainder
// is taken from the mean of s_n.
const TAIL_FACTOR = 64;

// s_n = (sin nA - sin nB)^2 averages w0 over n; the rest is a sum of cosines in n.
// The sums depend only on the screen and N, which most of a fit's calls share (N stays
// at N_MAX wherever Kz/Kr is small), and cost 64 N sines each, as much as the rest of a
// call in the pumped well: so the last few are kept.
const TAILS_KEPT = 8;
const keptTails = new Map();
function tails(A, B, N, w0) {
  const key = `${A} ${B} ${N} ${w0}`;
  let t = keptTails.get(key);
  if (!t) {
    t = tailSums(A, B, N, w0);
    if (keptTails.size >= TAILS_KEPT) keptTails.delete(keptTails.keys().next().value);
    keptTails.set(key, t);
  }
  return t;
}
function tailSums(A, B, N, w0) {
  const M = TAIL_FACTOR * N;
  let t3 = 0, t4 = 0, t5 = 0;
  for (let n = M; n > N; n--) {
    const d = libm.sin(n * A) - libm.sin(n * B), s = d * d, n2 = n * n;
    t3 += s / (n2 * n); t4 += s / (n2 * n2); t5 += s / (n2 * n2 * n);
  }
  return { t3: t3 + w0 / (2 * M * M), t4: t4 + w0 / (3 * M * M * M), t5: t5 + w0 / (4 * M * M * M * M) };
}

// The pumped well's term K0(x) / (x K1(x)), x = q rw, and its change with pS/T.
const gw = (x) => k0OverK1(x) / x;
const dgw = (x, rw) => (rw * rw * (libm.pow(k0OverK1(x), 2) - 1)) / (2 * x * x);
// The observation point's term K0(q r) / (q rw K1(q rw)), and its change with pS/T.
const go = (q, r, rw) => k0OverK1At(q * r, q * rw) / (q * rw);
function dgo(q, r, rw) {
  const y = q * rw;
  return (rw * k0OverK1At(q * r, y) * k0OverK1(y) - r * k1OverK1At(q * r, y)) / (2 * q * q * rw);
}

// The largest p times t that each inversion asks for: 16 ln 2 for Stehfest's 16 terms,
// and |γ + 10πi| t for de Hoog's 21 terms over a half period 2t, γ = −ln(10⁻¹²)/(4t).
const STEHFEST_PT = 16 * Math.LN2;
const DEHOOG_PT = libm.hypot(-libm.log(1e-12) / 4, 10 * Math.PI);

// The pieces of the series that do not depend on p, for one parameter set and geometry,
// for inversions at times from tMin on that reach p tMin = pt.
function setup(p, g, tMin, pt) {
  const { T, S } = p, a = Math.sqrt(p['Kz/Kr']);
  const { rw, rc, b, d, l } = g;
  const L = l - d;
  const full = d <= 0 && l >= b;
  const r = Math.max(g.r, rw), inWell = !(g.r > rw);
  const kz = (Math.PI * a) / b, kappa = kz * rw;
  const baseMax = (pt / tMin) * (S / T);
  const kept = keptFor([T, S, a, g.r, rw, b, d, l, inWell ? 0 : g.z1, inWell ? 0 : g.z2, tMin, pt].join(' '));
  const k = { T, S, Sw: p.Sw, rw, rc, r, b, L, full, inWell, kz, kept };
  if (full) return k;
  const Nw = Math.min(N_MAX, Math.max(N_MIN, Math.ceil((X0 * Math.sqrt(1 + baseMax * rw * rw)) / kappa)));
  const No = inWell ? 0 : Math.min(N_MAX, Math.max(N_MIN, Math.ceil((DECAY * b) / (Math.PI * a * (r - rw)))));
  const ND = Math.min(Math.max(Nw, No), Math.ceil((DIRECT * Math.sqrt(baseMax)) / kz) + DIRECT_MIN);
  return Object.assign(k, { ND, Nw, No }, sums(a, g, r, inWell, Nw, No, ND));
}

// The sums at p = 0 depend on T and S only through the numbers of terms, so a fit's
// steps in T, S and the skin, with Kz/Kr held, mostly find them already done: about half
// the calls of a fit share Kz/Kr with one of the four before. In the pumped well they were
// most of a call's time (thousands of K0/K1 by the trapezoid rule). The last few are kept.
const SUMS_KEPT = 8;
const keptSums = new Map();
function sums(a, g, r, inWell, Nw, No, ND) {
  const key = [a, g.rw, g.b, g.d, g.l, r, inWell, inWell ? 0 : g.z1, inWell ? 0 : g.z2, Nw, No, ND].join(' ');
  let out = keptSums.get(key);
  if (!out) {
    out = sumsAtZero(a, g, r, inWell, Nw, No, ND);
    if (keptSums.size >= SUMS_KEPT) keptSums.delete(keptSums.keys().next().value);
    keptSums.set(key, out);
  }
  return out;
}
function sumsAtZero(a, g, r, inWell, Nw, No, ND) {
  const { rw, b, d, l } = g;
  const L = l - d, A = (Math.PI * l) / b, B = (Math.PI * d) / b;
  const kz = (Math.PI * a) / b, kappa = kz * rw;
  const N = Math.max(Nw, No);
  const e = new Float64Array(N + 1), o = new Float64Array(N + 1);
  const piezo = g.z1 === g.z2;
  for (let n = 1; n <= N; n++) {
    const kn = (n * Math.PI) / b;
    e[n] = (libm.sin(kn * l) - libm.sin(kn * d)) / (kn * L);
    if (!inWell) o[n] = piezo ? libm.cos(kn * g.z1) : (libm.sin(kn * g.z2) - libm.sin(kn * g.z1)) / (kn * (g.z2 - g.z1));
  }
  // The pumped well at p = 0, with the closed-form tail past Nw.
  // w0: the mean of s_n, 1 less a half for each screen end that meets the aquifer's edge.
  const w0 = 1 - (l >= b ? 0.5 : 0) - (d <= 0 ? 0.5 : 0);
  const t = tails(A, B, Nw, w0), pre = 2 * libm.pow(b / (Math.PI * L), 2);
  const gw0 = new Float64Array(ND + 1);
  let Hw = pre * (t.t3 / kappa - t.t4 / (2 * kappa * kappa) + (0.375 * t.t5) / (kappa * kappa * kappa));
  let dHw = -pre * ((rw * rw) / 2) * (t.t5 / (kappa * kappa * kappa));
  for (let n = 1; n <= Nw; n++) {
    const x = kappa * n, w = 2 * e[n] * e[n], v = gw(x);
    Hw += w * v;
    if (n <= ND) gw0[n] = v; else dHw += w * dgw(x, rw);
  }
  if (inWell) return { e, o, gw0, Hw, dHw };
  const go0 = new Float64Array(ND + 1);
  let Ho = 0, dHo = 0;
  for (let n = 1; n <= No; n++) {
    const q = kz * n, w = 2 * e[n] * o[n], v = go(q, r, rw);
    Ho += w * v;
    if (n <= ND) go0[n] = v; else dHo += w * dgo(q, r, rw);
  }
  return { e, o, gw0, Hw, dHw, go0, Ho, dHo };
}

// The skin enters only through Hw + Sw b/L, and the casing only after the sums, so a step
// of a fit in Sw alone (one call in nine at the Oude Korendijk piezometer) leaves both
// series as they were at every p. The sums of the last few problems are kept, by p, as
// Moench (1997) keeps its own: the same sums, not recomputed. Each holds at most
// SERIES_KEPT_P values of p.
const SERIES_KEPT = 4, SERIES_KEPT_P = 20000;
const keptSeries = new Map();
function keptFor(key) {
  let m = keptSeries.get(key);
  if (!m) {
    if (keptSeries.size >= SERIES_KEPT) keptSeries.delete(keptSeries.keys().next().value);
    keptSeries.set(key, (m = new Map()));
  } else if (m.size > SERIES_KEPT_P) m.clear();
  return m;
}

// Laplace transform of the drawdown times 2πT / Q, at real p, for Stehfest.
function laplaceReal(k, p) {
  let sums = k.kept.get(p);
  if (!sums) k.kept.set(p, (sums = seriesReal(k, p)));
  const [Hw, Ho] = sums;
  const H = Hw + (k.Sw * k.b) / k.L;
  const denom = p * (1 + ((p * k.rc * k.rc) / (2 * k.T)) * H);
  if (k.inWell) return H / denom;
  return Ho / denom;
}

// The two series at real p: [Hw, Ho], Ho 0 in the pumped well.
// Each term n of both series takes K0(q rw) / K1(q rw) and K0(q r) / K1(q rw) at the same
// q, so where both are summed the two come from one series at q rw (k0OverK1Both), the
// same bits as gw and go give apart, each sum kept in its own order.
function seriesReal(k, p) {
  const { T, S, rw, r, full, inWell, kz } = k;
  const base = (p * S) / T, q0 = Math.sqrt(base), x0 = q0 * rw;
  let Hw = gw(x0), Ho = inWell ? 0 : go(q0, r, rw);
  if (!full) {
    Hw += k.Hw + base * k.dHw;
    if (!inWell) Ho += k.Ho + base * k.dHo;
    const { e, o } = k, topW = Math.min(k.ND, k.Nw), topO = inWell ? 0 : Math.min(k.ND, k.No);
    const both = Math.min(topW, topO), qAt = (n) => Math.sqrt(base + (kz * n) * (kz * n));
    for (let n = 1, top = Math.max(topW, topO); n <= top; n++) {
      const q = qAt(n), y = q * rw;
      // Terms n and n + 1 together where both are in both series (k0OverK1BothTwice).
      if (n < both) {
        const q2 = qAt(n + 1), y2 = q2 * rw;
        k0OverK1BothTwice(q * r, y, q2 * r, y2);
        Hw += 2 * e[n] * e[n] * (K_RATIOS[0] / y - k.gw0[n]);
        Ho += 2 * e[n] * o[n] * (K_RATIOS[1] / y - k.go0[n]);
        n++;
        Hw += 2 * e[n] * e[n] * (K_RATIOS[2] / y2 - k.gw0[n]);
        Ho += 2 * e[n] * o[n] * (K_RATIOS[3] / y2 - k.go0[n]);
      } else if (n <= topW && n <= topO) {
        k0OverK1Both(q * r, y);
        Hw += 2 * e[n] * e[n] * (K_RATIOS[0] / y - k.gw0[n]);
        Ho += 2 * e[n] * o[n] * (K_RATIOS[1] / y - k.go0[n]);
      } else if (n <= topW) Hw += 2 * e[n] * e[n] * (gw(y) - k.gw0[n]);
      else Ho += 2 * e[n] * o[n] * (go(q, r, rw) - k.go0[n]);
    }
  }
  return [Hw, Ho];
}

// The same at complex p, for de Hoog. The pumped well's term K0(x) / (x K1(x)) and the
// observation point's K0(q r) / (q rw K1(q rw)) at complex arguments, from e^z K0 and e^z K1, whose scale
// cancels except for e^(−q (r − rw)).
function gwC(x) {
  const [k0, k1] = kScaled01(x);
  return cdiv(k0, cmul(x, k1));
}
function goC(q, r, rw) {
  const y = cscale(q, rw);
  const [k0r] = kScaled01(cscale(q, r)), [, k1] = kScaled01(y);
  return cdiv(cmul(k0r, cexp(cscale(q, -(r - rw)))), cmul(y, k1));
}
// [gwC(q rw), goC(q, r, rw)], with e^z K0 and e^z K1 at q rw taken once: the same bits.
function gwoC(q, r, rw) {
  const y = cscale(q, rw);
  const [k0, k1] = kScaled01(y), [k0r] = kScaled01(cscale(q, r));
  return [cdiv(k0, cmul(y, k1)), cdiv(cmul(k0r, cexp(cscale(q, -(r - rw)))), cmul(y, k1))];
}

function laplaceComplex(k, p) {
  const key = `${p.re} ${p.im}`;
  let sums = k.kept.get(key);
  if (!sums) k.kept.set(key, (sums = seriesComplex(k, p)));
  const [Hw, Ho] = sums;
  const H = cadd(Hw, cx((k.Sw * k.b) / k.L));
  const denom = cmul(p, cadd(cx(1), cmul(cscale(p, (k.rc * k.rc) / (2 * k.T)), H)));
  if (k.inWell) return cdiv(H, denom);
  return cdiv(Ho, denom);
}

// The two series at complex p, as seriesReal: [Hw, Ho], Ho null in the pumped well. Where a
// term n is in both, the two take K at q rw from one call (gwoC), each sum in its order.
function seriesComplex(k, p) {
  const { T, S, rw, r, full, inWell, kz } = k;
  const base = cscale(p, S / T), q0 = csqrt(base);
  let [Hw, Ho] = inWell ? [gwC(cscale(q0, rw)), null] : gwoC(q0, r, rw);
  if (!full) {
    Hw = cadd(Hw, cadd(cx(k.Hw), cscale(base, k.dHw)));
    if (!inWell) Ho = cadd(Ho, cadd(cx(k.Ho), cscale(base, k.dHo)));
    const { e, o } = k, topW = Math.min(k.ND, k.Nw), topO = inWell ? 0 : Math.min(k.ND, k.No);
    for (let n = 1, top = Math.max(topW, topO); n <= top; n++) {
      const q = csqrt(cadd(base, cx((kz * n) * (kz * n))));
      if (n <= topW && n <= topO) {
        const [w, v] = gwoC(q, r, rw);
        Hw = cadd(Hw, cscale(cadd(w, cx(-k.gw0[n])), 2 * e[n] * e[n]));
        Ho = cadd(Ho, cscale(cadd(v, cx(-k.go0[n])), 2 * e[n] * o[n]));
      } else if (n <= topW) Hw = cadd(Hw, cscale(cadd(gwC(cscale(q, rw)), cx(-k.gw0[n])), 2 * e[n] * e[n]));
      else Ho = cadd(Ho, cscale(cadd(goC(q, r, rw), cx(-k.go0[n])), 2 * e[n] * o[n]));
    }
  }
  return [Hw, Ho];
}

// Stehfest's 16-term sum is good to 10⁻⁴ of the Theis curve up to u = 1, but out by 0.2%
// at u = 5 and 11% at u = 10, and it dips below zero further out. Where the drawdown is
// that early, measured by u from the nearest point of the screen with the vertical gap
// scaled by Kr/Kz, the series is inverted by de Hoog's method at complex p instead,
// which holds there; elsewhere Stehfest, at a sixth of the cost.
const U_DEHOOG = 1;
function earlyU(p, g) {
  const r = Math.max(g.r, g.rw), inWell = !(g.r > g.rw);
  const zTop = inWell ? g.d : Math.min(g.z1, g.z2), zBot = inWell ? g.l : Math.max(g.z1, g.z2);
  const dz = Math.max(0, g.d - zBot, zTop - g.l);
  return ((r - g.rw) * (r - g.rw) + (dz * dz) / p['Kz/Kr']) * (p.S / (4 * p.T));
}

/** Drawdown (m) at each t (d) for a constant rate Q (m3/d). Exported for the tests. */
export function doughertyBabu(p, g, t, Q) {
  if (!skinAllowed(p.Sw)) throw new Error(skinRefusal('Dougherty and Babu (1984)'));
  const a = earlyU(p, g), c = Q / (2 * Math.PI * p.T);
  const late = t.filter((x) => x > 0 && a / x <= U_DEHOOG), early = t.filter((x) => x > 0 && a / x > U_DEHOOG);
  const kR = late.length ? setup(p, g, Math.min(...late), STEHFEST_PT) : null;
  const kC = early.length ? setup(p, g, Math.min(...early), DEHOOG_PT) : null;
  return t.map((x) => {
    if (!(x > 0)) return 0;
    return a / x > U_DEHOOG ? c * deHoogAt((z) => laplaceComplex(kC, z), x) : c * stehfest((z) => laplaceReal(kR, z), x);
  });
}

const MISHRA_ET_AL_2012 = 'Mishra, P.K., Vesselinov, V.V., and Neuman, S.P. (2012) Radial flow to a partially penetrating well with storage in an anisotropic confined aquifer. Journal of Hydrology 448-449, 255-259.';

const where = (g) => {
  if (!(g.r > g.rw)) return 'in the pumped well';
  if (g.z1 === g.z2) return `at a piezometer ${sig(g.r)} m away, ${sig(g.z1)} m below the top of the aquifer`;
  return `in an observation well ${sig(g.r)} m away, screened ${sig(g.z1)} to ${sig(g.z2)} m below the top of the aquifer`;
};

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  { id: 'Kz/Kr', symbol: 'Kz/Kr', label: 'Anisotropy Kz/Kr', kind: 'ratio' },
  { id: 'Sw', symbol: 'Sw', label: 'Wellbore skin Sw', kind: 'skin', min: SKIN_MIN, hint: SKIN_HINT },
];

export default {
  id: 'dougherty-babu',
  name: 'Dougherty and Babu (1984)',
  family: 'confined',
  summary: 'A pumped well of finite diameter in a confined aquifer, with wellbore storage, skin and partial penetration: the single-porosity case of Dougherty and Babu (their fractured, double-porosity form is not included). Drawdown in the pumped well or at an observation point.',
  params: PARAMS,
  geometry: ['r', 'rw', 'rc', 'b', 'd', 'l', 'z1', 'z2'],
  // Image wells superpose as wells of the same kind, each with its own storage. That
  // leaves out the drawdown an image adds to the pumped well's own water level; the error
  // is measured in tests/solutions/images-storage.test.js, and check() warns where it is poor.
  images: true,
  drawdown: doughertyBabu,
  references: [BARLOW_MOENCH_1999, DE_HOOG_ET_AL_1982, DOUGHERTY_BABU_1984_CORRECTION, HANTUSH_1961A, KRUSEMAN_DE_RIDDER_1994, MISHRA_ET_AL_2012, PAPADOPULOS_COOPER_1967, REED_1980, STEHFEST_1970, WEEKS_1969],
  method(p, g, ctx) {
    const L = g.l - g.d, full = g.d <= 0 && g.l >= g.b;
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const Kr = p.T / g.b, CD = (g.rc * g.rc) / (2 * g.rw * g.rw * (p.S / g.b) * L);
    return {
      lines: [
        `Drawdown ${where(g)}, from a well of finite diameter pumping at a constant rate from a confined aquifer (Dougherty and Babu 1984, the single-porosity case; their double-porosity form for fractured rock is not included). The aquifer is uniform, of infinite extent and anisotropic, Kz/Kr. The well is screened from ${sig(g.d)} to ${sig(g.l)} m below the top of an aquifer ${sig(g.b)} m thick${full ? ', its full thickness' : ''}. Water enters the screen at the same rate at every depth; the water level in the well is the same along it and stands at the average head over the screen plus the loss across a thin skin of low permeability and no storage; the casing's stored water supplies part of the early pumping (Barlow and Moench 1999, p. 7).`,
        `Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, Kr = T/b and Kz the horizontal and vertical hydraulic conductivity, b the aquifer thickness, d and l the depths to the top and bottom of the screen and L = l − d its length, z the depth of a piezometer, Sw the skin factor (Kr ds/(Ks rw) for a skin ds thick of conductivity Ks), rw the screen radius, rc the casing radius where the water level moves, p the Laplace variable, and K0 and K1 the modified Bessel functions of the second kind. The aquifer's response is a finite cosine series in depth (Mishra et al. 2012, equation 6, without storage), summed with closed-form tails. It is turned back into time by the Stehfest (1970) algorithm with ${STEHFEST_N} terms, except at early times, where u from the nearest point of the screen is above 1 and Stehfest loses accuracy; there the method of de Hoog, Knight and Stokes (1982) is used.`,
        'The paper of Dougherty and Babu (1984) could not be obtained for this work. The method follows its assumptions as Barlow and Moench (1999) state them, and is checked against Papadopulos and Cooper (1967) at full penetration, Theis with no storage, the series of Hantush (1961a) for a well of small diameter, and its late-time correction as tabulated by Kruseman and de Ridder (1994, Annex 8.1) after Weeks (1969) and reprinted by Reed (1980).',
        `From the fitted values: ${d(['T'], 'Kr', `Kr = ${sig(Kr)} m/d`)}; ${d(['T', 'Kz/Kr'], 'Kz', `Kz = ${sig(Kr * p['Kz/Kr'])} m/d`)}; and ${d(['S'], 'the wellbore storage group rc²/(2 rw² Ss L)', `the wellbore storage group rc²/(2 rw² Ss L) = ${sig(CD)}`)}, with Ss = S/b (Barlow and Moench 1999, p. 11). In metres and days throughout.`,
      ],
      formula: 's(p) = Q / (2πTp) · Ho / (1 + (p rc² / 2T)(Hw + Sw b/L))   at an observation point\ns(p) = Q / (2πTp) · (Hw + Sw b/L) / (1 + (p rc² / 2T)(Hw + Sw b/L))   in the pumped well\nHw = G0(rw) + Σ 2 e_n² Gn(rw),  Ho = G0(r) + Σ 2 e_n o_n Gn(r)\nGn(r) = K0(qn r) / (qn rw K1(qn rw)),  qn² = pS/T + (Kz/Kr)(nπ/b)²,  L = l − d\ne_n = b / (nπL) · [sin(nπl/b) − sin(nπd/b)],  o_n = cos(nπz/b) or its average over the observation screen',
    };
  },
  check(p, g, ctx) {
    const out = [];
    if (!(g.b > 0) || !(g.d >= 0) || !(g.l > g.d) || !(g.l <= g.b)) out.push('The screen must lie inside the aquifer: 0 ≤ d < l ≤ b.');
    if (g.r > g.rw && !(g.z1 >= 0 && g.z2 >= g.z1 && g.z2 <= g.b)) out.push('Give the depth of the observation point: z1 = z2 for a piezometer, or the top and bottom of the observation screen, inside the aquifer.');
    if (g.r < g.rw) out.push('The distance r is less than the well radius rw. The drawdown is taken in the pumped well.');
    const reach = (1.5 * g.b) / Math.sqrt(p['Kz/Kr']);
    if (g.d <= 0 && g.l >= g.b) out.push('The well penetrates the whole aquifer, so Kz/Kr has no effect and cannot be fitted; hold it fixed.');
    // Reed (1980, p. 9): partial penetration matters within 1.5 b sqrt(Kr/Kz); Kruseman and
    // de Ridder (1994, p. 159) give 2 b sqrt(Kr/Kz).
    else if (!undeterminedOf(ctx, ['Kz/Kr']).length && g.r > reach) out.push(`The observation point is farther than 1.5 b √(Kr/Kz) = ${sig(reach)} m from the well, beyond which Reed (1980, p. 9) treats partial penetration as negligible (Kruseman and de Ridder 1994, p. 159, give 2 b √(Kr/Kz)). The drawdown is nearly that of a fully penetrating well there, so Kz/Kr is poorly determined.`);
    if (g.r > g.rw && p.Sw !== 0) out.push('Away from the pumped well, the skin only delays the early drawdown through the well\'s storage; Sw is poorly determined from an observation well alone.');
    if (!(g.r > g.rw)) out.push('In the pumped well, the storativity and the skin act together: for a fully penetrating well, the late drawdown fixes only S e^(−2Sw) (Kruseman and de Ridder 1994, equation 14.23). Treat S as an order of magnitude unless an observation well gives it too.');
    // The aquifer's series needs about DECAY b / (pi a (r - rw)) terms; past N_MAX it is cut short.
    const full = g.d <= 0 && g.l >= g.b;
    if (!full && g.r > g.rw && (DECAY * g.b) / (Math.PI * Math.sqrt(p['Kz/Kr']) * (g.r - g.rw)) > N_MAX) out.push('The observation point is so close to the screen that the series is cut short and the drawdown there is not reliable. Treat it as the pumped well (r = rw) or move it out.');
    out.push(...imageStorageWarning(p.S, g.rc, ctx));
    return out;
  },
};
