// Moench (1997): flow to a partially penetrating well of finite diameter in a homogeneous,
// anisotropic water table aquifer, with storage and skin at the pumped well, a delayed
// response at the observation well, and drainage from above the water table that is
// either instantaneous (Neuman 1974) or gradual, with one drainage constant (Moench 1995).
// It is the solution in USGS program WTAQ (Barlow and Moench 1999).
//
// Moench's paper could not be fetched, so the Laplace solution here is derived from the
// boundary value problem as Barlow and Moench (1999, p. 7-11) state it, by separation of
// variables in z, and checked against the output WTAQ prints (their figures 13 and 15).
// docs/tools/solutions/moench-1997.md sets out the derivation.
//
// Dimensionless, after Barlow and Moench (1999): tD = Kr t / (Ss rw^2), rD = r / rw,
// zD = z / b (down from the water table), hD = 4 pi T s / Q, betaW = (Kz/Kr) (rw/b)^2,
// sigma = S / Sy, gamma = alpha b Sy / Kz. In the Laplace variable p of tD, with
// a = p / (sigma betaW) and A = a gamma / (a + gamma) (A = a when drainage is instantaneous):
//   hD(p) = qD(p) sum_n S_n V_n K0(q_n rD) / (q_n K1(q_n) N_n) / (1 + p WD')
//   e_n tan e_n = A,  q_n = sqrt(p + betaW e_n^2),  N_n = (e_n + sin e_n cos e_n) / (2 e_n)
//   S_n = [sin(e_n (1 - dD)) - sin(e_n (1 - lD))] / e_n          (over the pumped screen)
//   V_n = cos(e_n (1 - zD)) at a piezometer, or the screen average of it at a well
//   qD(p) = 2 / (p LD (1 + p WD (F + Sw))),  F = sum_n S_n^2 K0(q_n) / (LD q_n K1(q_n) N_n)
// and at the pumped well itself hD(p) = qD(p) (F + Sw). The page writes sigma as η, S_n
// as P_n and N_n as c_n, because σ, S and N name other things in its method text.

import { besselK01Scaled, besselK0Scaled, stehfest, STEHFEST_N } from '../laplace.js';
import { tanRoot, tanRootTwo } from '../unconfined.js';
import { sig } from '../format.js';
import { derived, FRACTION_MAX, imageStorageWarning, singleCurveWarning, SKIN_HINT, SKIN_MIN, skinAllowed, skinRefusal } from './bounds.js';
import { fitComments, withCommentReferences } from '../water-table.js';
import * as libm from '../libm.js';
import { BARLOW_MOENCH_1999, HVORSLEV_1951_CORPS_FIRST, KRUSEMAN_DE_RIDDER_1994, MOENCH_1995, MOENCH_1997, NEUMAN_1974, STEHFEST_1970 } from '../refs.js';

// The series need e^x K0(x) and e^x K1(x) hundreds of times for each p; laplace.js gives
// them from fits made once, and e^x K0(x) alone where K1 is not needed.
const scaledK0 = besselK0Scaled;

// Root n of e tan e = A, with sin and cos of e - n pi. With no drainage at the top,
// A = 0 and the roots are n pi.
const root = (n, A) => (A > 0 ? tanRoot(n, A) : { e: n * Math.PI, sin: 0, cos: 1 });

// Integral of cos(e (1 - z)) dz from z1 to z2, which is z2 - z1 when e = 0.
const band = (e, z1, z2) => (e === 0 ? z2 - z1 : (libm.sin(e * (1 - z1)) - libm.sin(e * (1 - z2))) / e);

// The terms of the two series for root e: f for F, the pumped screen's own, and g for the
// observation point. N is the norm of cos(e (1 - z)) over the thickness.
function terms(e, N, p, c, needF, needG) {
  const q = Math.sqrt(p + c.betaW * e * e);
  const S = band(e, c.dD, c.lD);
  const [k0q, k1q] = besselK01Scaled(q);
  const k1 = q * k1q * N;
  const f = needF ? (S * S * k0q) / (c.LD * k1) : 0;
  let g = 0;
  if (needG) {
    const V = c.point ? libm.cos(e * (1 - c.zD)) : band(e, c.z1D, c.z2D) / (c.z2D - c.z1D);
    g = (S * V * libm.exp(-q * (c.rD - 1)) * scaledK0(q * c.rD)) / k1;
  }
  return [f, g];
}

// The same number of terms is summed at every p of an inversion, so the truncation is a
// smooth function of p, which Stehfest's large alternating weights do not amplify.
// At the pumped screen (F) the terms fall only as 1/n^3. Past n = M they hardly depend on
// p or on the water table, so that tail is summed once, for the confined case at p = 0
// (e = n pi), and added at every p. At an observation point (G) the terms fall as
// exp(-q (rD - 1)); near the water table their tail does depend on the drainage, so G is
// summed in full, to the term where that factor passes e^-DECAY.
const MIN_TERMS = 200;
const MAX_TERMS = 5000;
// The tail is summed to TAIL_REACH M, and what is left after that taken as c / n^2.
const TAIL_REACH = 64;
const DECAY = 40;

// The tail depends on the geometry and betaW alone, which most of a fit's calls share
// (only a change of Kz/Kr moves it), so the last few are kept.
const TAILS_KEPT = 8;
const kept = new Map();
function tail(c, M, needF, needG) {
  const key = [c.betaW, c.dD, c.lD, c.LD, c.rD, c.point, c.zD, c.z1D, c.z2D, M, needF, needG].join(' ');
  let sums = kept.get(key);
  if (!sums) {
    sums = tailSums(c, M, needF, needG);
    if (kept.size >= TAILS_KEPT) kept.delete(kept.keys().next().value);
    kept.set(key, sums);
  }
  return sums;
}
function tailSums(c, M, needF, needG) {
  const sums = [0, 0];
  let half = [0, 0];
  for (let n = M + 1; n <= TAIL_REACH * M; n++) {
    const [f, g] = terms(n * Math.PI, 0.5, 0, c, needF, needG);
    sums[0] += f; sums[1] += g;
    if (n === (TAIL_REACH * M) / 2) half = sums.slice();
  }
  return sums.map((s, i) => s + (s - half[i]) / 3);
}

/**
 * Sets the number of terms for inversions down to tD = tMin: for F, enough that its tail
 * sits where betaW e^2 is well above the largest p used.
 */
export function prepare(c, tMin, minTerms = MIN_TERMS) {
  const pMax = (STEHFEST_N * Math.LN2) / tMin;
  const needF = c.pumped || c.WD > 0, needG = !c.pumped;
  const M = needF ? Math.min(MAX_TERMS, Math.max(minTerms, Math.ceil((3 * Math.sqrt(pMax / c.betaW)) / Math.PI))) : 0;
  const nG = c.rD > 1 ? Math.ceil(DECAY / (Math.sqrt(c.betaW) * Math.PI * (c.rD - 1))) : Infinity;
  const MG = needG ? Math.min(MAX_TERMS, nG) : 0;
  // Only an observation point within a hair of the screen runs out of terms.
  const tails = tail(c, needF ? M : MG, needF, needG && nG > MAX_TERMS);
  const kept = keptFor([c.sigma, c.betaW, c.gamma, c.dD, c.lD, c.LD, c.rD, c.point, c.zD, c.z1D, c.z2D, M, MG, needF, needG].join(' '));
  return { ...c, tMin, M, MG, needF, needG, tailF: needF ? tails[0] : 0, tailG: needG && nG > MAX_TERMS ? tails[1] : 0, kept };
}

// The skin enters only through F + Sw, so a change of Sw alone leaves both series as they
// were at every p. A fit's slopes take such a step for each value they work out, about one
// call in seven of a fit, so the series of the last few problems are kept, by p: the same
// sums, not recomputed. Each holds at most SERIES_KEPT_P values of p.
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

function series(p, c) {
  const a = p / (c.sigma * c.betaW);
  // With no drainage at all (gamma or Sy zero) the top is a no-flow boundary: A = 0.
  const A = c.gamma === Infinity ? a : a > 0 && c.gamma > 0 ? (a * c.gamma) / (a + c.gamma) : 0;
  let F = c.tailF, G = c.tailG;
  const last = Math.max(c.M, c.MG);
  // Roots are found two at a time (tanRootTwo), each the same as alone.
  let held = null;
  for (let n = 0; n <= last; n++) {
    let r = held;
    held = null;
    if (!r && A > 0 && n < last) [r, held] = tanRootTwo(n, A);
    const { e, sin, cos } = r || root(n, A);
    const N = e < 1e-8 ? 1 : (e + sin * cos) / (2 * e);
    const [f, g] = terms(e, N, p, c, c.needF && n <= c.M, c.needG && n <= c.MG);
    F += f; G += g;
  }
  return { F, G };
}

/** hD in Laplace space at p, for the dimensionless problem c (from prepare). */
export function moenchLaplace(p, c) {
  let sums = c.kept && c.kept.get(p);
  if (!sums) {
    sums = series(p, c);
    if (c.kept) c.kept.set(p, sums);
  }
  const { F, G } = sums;
  const Fs = F + c.Sw;
  const qD = 2 / (p * c.LD * (1 + (c.WD > 0 ? p * c.WD * Fs : 0)));
  if (c.pumped) return qD * Fs;
  return (qD * G) / (1 + p * c.WDP);
}

// Stehfest's sum carries a scatter of about 10⁻⁹ in hD, which at the earliest times, where
// hD itself is that small, makes values that swing above and below zero (against the
// de Hoog inversion of the confined case, tests/solutions/moench-1997.test.js). From
// hD = 10⁻⁶ up the error is under 0.1%. Below it the drawdown is not resolved, and is
// given as 0, which the method text says; it is under a millionth of Q/(4πT) there.
export const HD_FLOOR = 1e-6;

/** hD at dimensionless time tD = Kr t / (Ss rw^2), or 0 where it is below HD_FLOOR. */
export function moenchAt(tD, c) {
  if (!(tD > 0)) return 0;
  const ready = c.M && c.tMin <= tD ? c : prepare(c, tD);
  const v = stehfest((p) => moenchLaplace(p, ready), tD);
  return v < HD_FLOOR ? 0 : v;
}

/**
 * The dimensionless problem for parameters p (m and d) and geometry g, as WTAQ forms it.
 * Errors name the input that is out of range.
 */
export function dimensionless(p, g) {
  const { T, S, Sy, alpha, Sw } = p, KD = p['Kz/Kr'];
  const { r, rw, rc, b, d, l, z1, z2, rcObs } = g;
  if (!(b > 0)) throw new Error('The saturated thickness b must be above zero.');
  if (!(rw > 0)) throw new Error('The radius of the pumped well screen rw must be above zero.');
  if (!(rc >= 0)) throw new Error('The casing radius rc must be zero or more.');
  if (!(d >= 0 && l > d && l <= b)) throw new Error('The pumped screen needs 0 ≤ d < l ≤ b.');
  if (!(r >= rw)) throw new Error('The distance r must be at least the well radius rw.');
  if (!skinAllowed(Sw)) throw new Error(skinRefusal('Moench (1997)'));
  const pumped = r === rw;
  if (!pumped && !(z1 >= 0 && z2 >= z1 && z2 <= b)) throw new Error('The observation screen needs 0 ≤ z1 ≤ z2 ≤ b.');
  const Kr = T / b, Ss = S / b, L = l - d;
  // Barlow and Moench (1999, p. 11): WD = pi rc^2 / (2 pi rw^2 Ss (zpl - zpd)).
  const WD = (rc * rc) / (2 * rw * rw * Ss * L);
  // Delayed response of an observation well (Barlow and Moench 1999, p. 12, after Hvorslev
  // 1951, case 8): WD' = pi rp^2 / (2 pi rw^2 Ss F'), F' = L' / ln(x + sqrt(1 + x^2)),
  // x = m L' / (2 rp), m = sqrt(Kr / Kz). It needs a screen, so not at a piezometer.
  let WDP = 0;
  const Lo = pumped ? 0 : z2 - z1;
  if (!pumped && rcObs > 0 && Lo > 0) {
    const x = Lo / (2 * rcObs * Math.sqrt(KD));
    const Fp = Lo / libm.log(x + Math.sqrt(1 + x * x));
    WDP = (rcObs * rcObs) / (2 * rw * rw * Ss * Fp);
  }
  return {
    sigma: S / Sy, betaW: KD * (rw / b) * (rw / b),
    // gamma = alpha b Sy / Kz (Barlow and Moench 1999, p. 8).
    gamma: alpha === Infinity ? Infinity : (alpha * b * Sy) / (KD * Kr),
    rD: r / rw, dD: d / b, lD: l / b, LD: L / b,
    point: !pumped && z1 === z2, zD: z1 / b, z1D: z1 / b, z2D: z2 / b,
    pumped, WD, Sw, WDP, tScale: Kr / (Ss * rw * rw),
  };
}

const PARAMS = [
  { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
  { id: 'S', symbol: 'S', label: 'Storativity, elastic', kind: 'S', max: FRACTION_MAX },
  { id: 'Sy', symbol: 'Sy', label: 'Specific yield', kind: 'Sy', max: FRACTION_MAX },
  { id: 'Kz/Kr', symbol: 'Kz/Kr', label: 'Anisotropy Kz/Kr', kind: 'ratio' },
  { id: 'alpha', symbol: 'α₁', label: 'Drainage constant α₁ (1/d)', kind: 'other', hint: 'Per day. A very large value is instantaneous drainage, as in Neuman (1974).' },
  { id: 'Sw', symbol: 'Sw', label: 'Wellbore skin Sw', kind: 'skin', min: SKIN_MIN, hint: SKIN_HINT },
];

export default {
  id: 'moench-1997',
  name: 'Moench (1997)',
  family: 'unconfined',
  summary: 'A water table aquifer with instantaneous or gradual drainage at the water table, partial penetration, and storage and skin at the pumped well.',
  params: PARAMS,
  geometry: ['r', 'rw', 'rc', 'b', 'd', 'l', 'z1', 'z2', 'rcObs'],
  // Depths are measured down from the initial water table in this solution (Barlow and
  // Moench 1999, figures 3 and 5), not from the top of a confined aquifer.
  geometryLabels: {
    d: ['Depth to the top of the pumped well screen', 'Below the water table before pumping.'],
    l: ['Depth to the bottom of the pumped well screen', 'Below the water table before pumping.'],
    z1: ['Depth to the top of the observation screen', 'Below the water table before pumping. For a piezometer, its depth.'],
    z2: ['Depth to the bottom of the observation screen', 'Below the water table before pumping. For a piezometer, the same as the top.'],
    rcObs: ['Radius of the observation well casing', 'Inside radius of the standpipe, which sets how far a screened well lags the aquifer. 0 for no lag. A piezometer (top and bottom the same) has no lag here, whatever is entered.'],
  },
  // Each image carries its own storage, an approximation measured in
  // tests/solutions/images-storage.test.js; check() warns where it is poor.
  images: true,
  drawdown(p, g, t, Q) {
    const c0 = dimensionless(p, g);
    const scale = Q / (4 * Math.PI * p.T);
    const tMin = Math.min(...t.filter((ti) => ti > 0));
    if (!(tMin < Infinity)) return t.map(() => 0);
    const c = prepare(c0, c0.tScale * tMin);
    return t.map((ti) => (ti > 0 ? scale * moenchAt(c.tScale * ti, c) : 0));
  },
  references: [BARLOW_MOENCH_1999, HVORSLEV_1951_CORPS_FIRST, KRUSEMAN_DE_RIDDER_1994, MOENCH_1995, MOENCH_1997, NEUMAN_1974, STEHFEST_1970],
  method(p, g, ctx) {
    const c = dimensionless(p, g);
    // A number built from a value the fit did not determine is not determined either.
    const d = (ids, name, text) => derived(ctx, PARAMS, ids, name, text);
    const lines = [
      'Drawdown in a water table aquifer pumped at a constant rate by a well of finite diameter, the problem of Moench (1997) as Barlow and Moench (1999, p. 7-12) state it for the program WTAQ. Its assumptions: the aquifer is homogeneous, of infinite extent and uniform thickness, and anisotropic, Kz/Kr; the water table moves little compared with the saturated thickness; the pumped well may be screened over part of the thickness, with the head the same along it and water entering at the same rate at every depth; its casing stores water and a thin skin of low permeability and no storage may surround its screen; an observation well lags the aquifer in proportion to the head difference (Hvorslev 1951, case 8); drainage at the water table is instantaneous (Neuman 1974) or gradual, with one drainage constant (Moench 1995).',
      "Here s is the drawdown, Q the pumping rate, T the transmissivity, S the elastic storativity and Ss = S/b, Sy the specific yield, b the saturated thickness, Kr = T/b and Kz the horizontal and vertical hydraulic conductivity, α₁ the drainage constant, r the distance from the pumped well, rw its screen radius and rc its casing radius, d and l the depths of the top and bottom of its screen below the water table, z1 and z2 those of the observation screen (z1 = z2 at a piezometer), rcObs the observation well's casing radius, Sw the skin and t the time.",
      "In dimensionless form: tD = Kr t/(Ss rw²), hD = 4πTs/Q, rD = r/rw, and dD = d/b, lD = l/b, LD = (l − d)/b and zD = z/b, with z the depth of a piezometer; η = S/Sy (Barlow and Moench write it σ); βw = (Kz/Kr)(rw/b)², and β = (Kz/Kr)(r/b)², Neuman's parameter; γ = α₁bSy/Kz; WD = rc²/(2rw²Ss(l − d)) the pumped well's storage and WD′ the observation well's lag. In the Laplace transform, p is the Laplace variable of tD; a = p/(ηβw), and A = aγ/(a + γ), or A = a when drainage is instantaneous; e_n are the roots of e tan e = A, for n = 0, 1, 2, …, and q_n = √(p + βw e_n²); P_n is the integral of cos(e_n(1 − zD)) over the pumped screen, from dD to lD; V_n is that cosine at the piezometer, or its average over the observation screen; c_n = (e_n + sin e_n cos e_n)/(2e_n) is the mean of its square over the thickness; F is the pumped screen's own sum; qD is the dimensionless rate at which water leaves the pumped screen for the aquifer, less than the pumping rate at first while the casing supplies part of it; and K0 and K1 are the modified Bessel functions of the second kind.",
      "Moench's 1997 paper could not be obtained for this work, so the Laplace solution was derived here from the problem as Barlow and Moench (1999) state it, by separation of variables in depth, and checked against the drawdowns WTAQ prints for its sample problems (Barlow and Moench 1999, figures 13 and 15) and against Neuman's solution. It is turned back into time by the Stehfest (1970) algorithm with " + STEHFEST_N + ' terms.',
      `With these values: ${[
        d(['S', 'Sy'], 'η', `η = ${sig(c.sigma, 4)}`),
        d(['Kz/Kr'], 'βw', `βw = ${sig(c.betaW, 4)}`),
        d(['Kz/Kr'], 'β', `β = (Kz/Kr)(r/b)² = ${sig(c.betaW * c.rD * c.rD, 4)}`),
      ].join('; ')}.`,
      c.gamma === Infinity ? 'Drainage at the water table is instantaneous.' : `Drainage at the water table is gradual: ${d(['alpha', 'Sy', 'Kz/Kr', 'T'], 'γ', `γ = ${sig(c.gamma, 4)}`)}.`,
      `Pumped screen from ${sig(g.d, 4)} to ${sig(g.l, 4)} m below the water table, in ${sig(g.b, 4)} m of saturated thickness.`,
      c.WD > 0
        ? `${d(['S'], 'The wellbore storage WD', `Wellbore storage WD = ${sig(c.WD, 4)}`)}; ${d(['Sw'], 'the skin Sw', `skin Sw = ${sig(c.Sw, 4)}`)}.`
        : `No wellbore storage (rc = 0); ${d(['Sw'], 'the skin Sw', `skin Sw = ${sig(c.Sw, 4)}`)}, which then changes only the pumped well's own drawdown.`,
    ];
    if (c.pumped) lines.push('Drawdown is for the pumped well: the screen average of the aquifer head, plus the skin loss.');
    else if (c.point) lines.push(`Drawdown is at a piezometer ${sig(g.r, 4)} m from the pumped well, ${sig(g.z1, 4)} m below the water table, with no lag.`);
    else lines.push(`Drawdown is the average over an observation screen from ${sig(g.z1, 4)} to ${sig(g.z2, 4)} m, ${sig(g.r, 4)} m from the pumped well.`);
    if (c.WDP > 0) lines.push(`The observation well lags the aquifer by WD′ = rcObs²/(2rw²Ss F′), with F′ the shape factor of Hvorslev (1951, case 8) as WTAQ uses it (Barlow and Moench 1999, p. 12): ${d(['S', 'Kz/Kr'], 'WD′', `WD′ = ${sig(c.WDP, 4)}`)}.`);
    else if (!c.pumped && !c.point) lines.push('The observation well casing radius is 0, so the well is taken to follow the aquifer with no lag.');
    lines.push(`Where the drawdown is under ${sig(HD_FLOOR)} of Q/(4πT), the Stehfest inversion cannot resolve it, and it is given as zero; this happens only at the earliest times, before the drawdown reaches the observation point.`);
    lines.push('In metres and days throughout.');
    return {
      lines,
      formula: [
        's = Q / (4πT) · hD(tD),  tD = Kr t / (Ss rw²),  rD = r / rw',
        'hD(p) = qD(p) Σ P_n V_n K0(q_n rD) / (q_n K1(q_n) c_n) / (1 + p WD′)   at an observation point',
        'hD(p) = qD(p) (F + Sw)   in the pumped well',
        'qD(p) = 2 / (p LD (1 + p WD (F + Sw))),  F = Σ P_n² K0(q_n) / (LD q_n K1(q_n) c_n)',
        'q_n = √(p + βw e_n²),  e_n tan e_n = A,  A = a γ / (a + γ),  a = p / (η βw)',
        'P_n = [sin(e_n (1 − dD)) − sin(e_n (1 − lD))] / e_n,  c_n = (e_n + sin e_n cos e_n) / (2 e_n)',
      ].join('\n'),
    };
  },
  check(p, g, ctx) {
    // Only evidence that the fit has settled on one Theis curve is reported. Sy/S above
    // 10, which Kruseman and de Ridder (1994, p. 103) set for matching Neuman's type
    // curves in two parts, is not a condition of this solution, fitted as a whole; their
    // own answer for Vennebulten has Sy/S = 9.4 (p. 106).
    const out = singleCurveWarning(p, ctx, PARAMS, true);
    if (g.rc > 0 && g.rc < g.rw / 100) out.push('The casing radius is under 1% of the screen radius; check that rc and rw are the right way round.');
    if (g.r === g.rw) out.push('In the pumped well, the storativity and the skin act together: for a fully penetrating well, the late drawdown fixes only S e^(−2Sw) (Kruseman and de Ridder 1994, equation 14.23). Treat S as an order of magnitude unless an observation well gives it too.');
    out.push(...imageStorageWarning(p.S, g.rc, ctx));
    // The critical comments on a water table test (water-table.js). The screens are part of
    // this solution, so partial penetration is not one of them; and with them the late
    // Theis curve is not the curve's own late part near the well, so nor is the late gap.
    // Gradual drainage is said to be in the fit only when α₁ was fitted and determined (it has
    // an interval, which the page gives only for a value determined): one held at a very
    // large value is instantaneous drainage.
    const gradual = Boolean(ctx?.intervals?.alpha);
    out.push(...fitComments(p, g, ctx, { fully: false, gradual }));
    return out;
  },
  // The page's references with the sources its notes cite added: the comments above cite
  // sources of their own.
  noteReferences: withCommentReferences,
};
