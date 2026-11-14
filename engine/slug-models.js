// Type-curve models for slug tests, each giving the normalized head H/H0 in the test
// well at times t:
// - Cooper, Bredehoeft and Papadopulos (1967): a fully penetrating well in a confined
//   aquifer, with aquifer storage.
// - The KGS model (Hyder, Butler, McElwee and Liu 1994): partial penetration,
//   anisotropy and a finite-thickness skin, confined or with a water table above.
// - The high-K models for an oscillating (underdamped) response: Springer and Gelhar
//   (1991) for an unconfined aquifer and the high-K Hvorslev model (Butler 1998) for a
//   confined one, both in the form of Butler and Garnett (2000).
// Everything here is in metres and seconds: K in m/s, T in m²/s, Ss in 1/m.

import { besselI0, besselI1, besselK0, besselK1, cadd, cdiv, cscale, csqrt, cx, invertOscillating, ratioK, stehfest, STEHFEST_N } from './laplace.js';
import { logTimes } from './numeric.js';
import * as libm from './libm.js';

/** Standard gravity, m/s². */
export const G = 9.80665;

// Exponentially scaled modified Bessel functions, kS(n, x) = e^x K_n(x) and
// iS(n, x) = e^-x I_n(x), so that the skin terms of the KGS model neither overflow nor
// underflow when the vertical wave number is large. kPair and iPair give orders 0 and
// 1 together, since the model always needs both. Beyond x = 12 the large-argument
// expansions (Abramowitz and Stegun 9.7.1 and 9.7.2) are used, good there to about
// 1e-10; the tests check them against laplace.js. laplace.js's besselK01Scaled is more
// accurate, but the heads come from Stehfest, whose large weights magnify the
// difference: switching moves them by 1e-7 of their value and more late in the test,
// where they are near zero. So the KGS model keeps these, which its tests were checked with.
const BIG = 12;
function asymptotic(n, x, sign) {
  const mu = 4 * n * n;
  let term = 1, sum = 1;
  for (let k = 1; k < 40; k++) {
    const next = term * sign * (mu - (2 * k - 1) * (2 * k - 1)) / (k * 8 * x);
    if (Math.abs(next) >= Math.abs(term)) break;
    term = next;
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}
export function kPair(x) {
  if (x > BIG) { const f = Math.sqrt(Math.PI / (2 * x)); return [f * asymptotic(0, x, 1), f * asymptotic(1, x, 1)]; }
  if (x <= 2) { const e = libm.exp(x); return [besselK0(x) * e, besselK1(x) * e]; }
  // e^x K_n(x) = int_0^inf exp(-x (cosh t - 1)) cosh(n t) dt, by the trapezoid rule,
  // with the step laplace.js uses.
  const h = 0.25 / Math.max(1, Math.sqrt(x / 10));
  let a = 0.5, b = 0.5;
  for (let k = 1; k < 400; k++) {
    const c = libm.cosh(k * h), v = libm.exp(-x * (c - 1));
    a += v; b += v * c;
    if (v < 1e-18 * a) break;
  }
  return [a * h, b * h];
}
export function iPair(x) {
  if (x > BIG) { const f = 1 / Math.sqrt(2 * Math.PI * x); return [f * asymptotic(0, x, -1), f * asymptotic(1, x, -1)]; }
  const e = libm.exp(-x);
  return [besselI0(x) * e, besselI1(x) * e];
}
export const kS = (n, x) => kPair(x)[n];
export const iS = (n, x) => iPair(x)[n];

/** Throws, naming the first of values that is not above zero. */
export function checkPositive(values) {
  for (const [name, v] of Object.entries(values)) if (!(v > 0)) throw new Error(`${name} must be above zero.`);
}

/** Throws unless a screen of length b, its top d below the top of the aquifer, lies within thickness B. */
export function checkScreen(d, b, B) {
  if (!(d >= 0)) throw new Error('The top of the screen cannot be above the top of the aquifer.');
  if (d + b > B * (1 + 1e-9)) throw new Error('The bottom of the screen is below the base of the aquifer.');
}

// ---------------------------------------------------------------------------------
// Cooper, Bredehoeft and Papadopulos (1967)

// The Laplace transform, in dimensionless time beta = T t / rc^2, of H/H0 for the
// Cooper et al. (1967) well, alpha = rw^2 S / rc^2, at complex p. From the aquifer
// equation with the well's mass balance pi rc^2 dH/dt = 2 pi rw T dh/dr at r = rw:
// F(p) = K0(q) / (p K0(q) + 2 q K1(q)) = 1 / (p + 2 q K1(q)/K0(q)), q = sqrt(p alpha).
const cbpComplex = (alpha) => (p) => {
  const q = csqrt(cscale(p, alpha));
  return cdiv(cx(1), cadd(p, cscale(cdiv(q, ratioK(q)), 2)));
};

/**
 * Cooper et al. (1967) F(alpha, beta) = H/H0 at each beta, by the de Hoog inversion,
 * which holds its accuracy late in the test, where Stehfest's falls to about 0.1%.
 */
export function cbpCurve(alpha, betas) {
  const out = betas.map(() => 1), pos = [];
  betas.forEach((b, i) => { if (b > 0) pos.push(i); });
  if (pos.length) invertOscillating(cbpComplex(alpha), pos.map((i) => betas[i]), 0).forEach((v, j) => { out[pos[j]] = v; });
  return out;
}
export const cbpF = (alpha, beta) => cbpCurve(alpha, [beta])[0];

/** H/H0 at times t (s) for transmissivity T (m²/s) and storativity S, casing rc, well rw (m). */
export function cbpHead(t, { T, S }, { rc, rw }) {
  checkPositive({ Transmissivity: T, Storativity: S, 'Casing radius': rc, 'Well radius': rw });
  const alpha = (rw * rw * S) / (rc * rc);
  return cbpCurve(alpha, t.map((s) => (T * s) / (rc * rc)));
}

// ---------------------------------------------------------------------------------
// The KGS model (Hyder et al. 1994), in the notation of McElwee and Butler (1994,
// KGS Open-File Report 94-32, section II.A and appendices A and B). Zone 1 is the skin
// (rw < r < rsk), zone 2 the formation. Without a skin both zones are the formation.

/**
 * Dimensionless groups of the KGS model. g: { rc, rw, b, d, B, anisotropy, top },
 * top 'confined' (no flow at the top of the aquifer) or 'unconfined' (a constant head
 * at the water table). p: { Kr, Ss } for the formation and, with a skin, { Kskin,
 * SsSkin } and g.rsk (SsSkin may be in g instead). Kz/Kr is the same in the skin and
 * the formation.
 */
export function kgsGroups(p, g) {
  const { Kr, Ss, Kskin } = p, SsSkin = p.SsSkin ?? g.SsSkin;
  const { rc, rw, b, d, B, anisotropy, rsk } = g;
  checkPositive({ 'Hydraulic conductivity': Kr, 'Specific storage': Ss, 'Casing radius': rc, 'Well radius': rw, 'Screen length': b, 'Aquifer thickness': B, 'Kz/Kr': anisotropy });
  checkScreen(d, b, B);
  const skin = rsk !== undefined && rsk !== null;
  if (skin) {
    checkPositive({ 'Skin hydraulic conductivity': Kskin, 'Skin specific storage': SsSkin });
    if (!(rsk > rw)) throw new Error('The outer radius of the skin must be more than the well radius.');
  }
  const alpha = (2 * rw * rw * b * Ss) / (rc * rc);
  return {
    alpha,
    gamma: skin ? Kr / Kskin : 1,          // Kr2 / Kr1
    lambda: skin ? Ss / SsSkin : 1,        // Ss2 / Ss1
    psi: Math.sqrt(anisotropy) * rw / b,   // (A / a^2)^0.5, a = b / rw
    beta: B / b,
    zeta: d / b,
    xsk: skin ? rsk / rw : 1,
    skin,
    unconfined: g.top === 'unconfined',
    tau: (b * Kr) / (rc * rc),             // tau per second
  };
}

// f1 of the KGS model: head over flux at the well face for one vertical wave number,
// in exponentially scaled form so that large arguments neither overflow nor underflow.
function f1(m, w, p) {
  const ww = m.psi * m.psi * w * w;
  if (!m.skin) {
    const v = Math.sqrt(ww + (m.alpha / 2) * p);
    const [k0, k1] = kPair(v);
    return k0 / (v * k1);
  }
  const v1 = Math.sqrt(ww + ((m.gamma * m.alpha) / (2 * m.lambda)) * p);
  const v2 = Math.sqrt(ww + (m.alpha / 2) * p);
  const N = v1 / v2, a = v1 * m.xsk, c = v2 * m.xsk;
  const [ka0, ka1] = kPair(a), [kc0, kc1] = kPair(c), [ia0, ia1] = iPair(a);
  const [k0, k1] = kPair(v1), [i0, i1] = iPair(v1);
  const d1 = ka0 * kc1 - (N / m.gamma) * kc0 * ka1;
  const d2 = ia0 * kc1 + (N / m.gamma) * kc0 * ia1;
  const E = libm.exp(-2 * v1 * (m.xsk - 1));
  return (d2 * k0 - d1 * i0 * E) / (v1 * (d2 * k1 + d1 * i1 * E));
}

// The weights of the vertical modes in Omega: appendix B, (B6) for the confined case
// with n = 0, 1, 2, ..., and (B7) for the unconfined case with n = 1, 3, 5, ...
function modes(m) {
  const { beta, zeta } = m;
  if (m.unconfined) {
    return (n) => {
      const w = (n * Math.PI) / (2 * beta);
      const s1 = libm.sin(n * Math.PI / (4 * beta)), s2 = libm.sin(n * Math.PI * (1 + 2 * zeta) / (4 * beta));
      return [w, (32 * beta / (Math.PI * Math.PI)) * (s1 * s1 * s2 * s2) / (n * n)];
    };
  }
  return (n) => {
    const w = (n * Math.PI) / beta;
    if (n === 0) return [0, 1 / beta];
    const s = libm.sin(n * Math.PI / (2 * beta)), c = libm.cos(n * Math.PI * (1 + 2 * zeta) / (2 * beta));
    return [w, (8 * beta / (Math.PI * Math.PI)) * (s * s * c * c) / (n * n)];
  };
}

/**
 * Omega(p) of the KGS model as a function of p, for p up to pMax. Modes up to n1 are
 * summed exactly at each p, n1 being where (psi w)^2 reaches 25 R pMax. Beyond it the
 * vertical wave number dominates, so f1 is nearly linear in p: those modes are summed
 * once, at p = 0 and at a small p, up to n2, and the rest by the large-argument limit
 * f1 = 1/(psi w) with the mean 1/4 of the squared sines and cosines. n1 is the same at
 * every p, so that Omega is smooth in p, as the Stehfest inversion needs. The tests
 * check this against the plain sum.
 */
export function kgsOmega(m, pMax) {
  const mode = modes(m);
  const step = m.unconfined ? 2 : 1, first = m.unconfined ? 1 : 0;
  const R = (m.alpha / 2) * Math.max(1, m.gamma / m.lambda);
  const perW = m.unconfined ? Math.PI / (2 * m.beta) : Math.PI / m.beta;
  const n1 = Math.min(400000, Math.max(16, Math.ceil(Math.sqrt(25 * R * pMax) / m.psi / perW)));
  // n2: far enough that the weights have gone through many periods (2 beta in n), so
  // their mean stands for them beyond it.
  const n2 = Math.max(n1 * 8, Math.ceil(40 * m.beta), 4000);
  const head = [];
  for (let n = first; n <= n1; n += step) { const md = mode(n); if (md[1] !== 0) head.push(md); }
  const pRef = Math.max(pMax, 1e-6) * 1e-3;
  let A0 = 0, A1 = 0;
  for (let n = n1 + step; n <= n2; n += step) {
    const [w, c] = mode(n);
    if (c === 0) continue;
    const a = f1(m, w, 0);
    A0 += c * a;
    A1 += c * (f1(m, w, pRef) - a) / pRef;
  }
  // Modes past n2: f1 = 1/(psi w), weights averaged; sum over n > n2 of 1/n^3 is about
  // 1/(2 n2^2), or 1/(4 n2^2) over odd n only.
  const far = m.unconfined
    ? (32 * m.beta / (Math.PI * Math.PI)) * 0.25 * (2 * m.beta / (m.psi * Math.PI)) / (4 * n2 * n2)
    : (8 * m.beta / (Math.PI * Math.PI)) * 0.25 * (m.beta / (m.psi * Math.PI)) / (2 * n2 * n2);
  return (p) => {
    let sum = 0;
    for (const [w, c] of head) sum += c * f1(m, w, p);
    return sum + A0 + A1 * p + far;
  };
}

/** The plain sum of Omega(p) over modes up to nMax, for the tests. */
export function kgsOmegaDirect(m, p, nMax) {
  const mode = modes(m);
  let sum = 0;
  for (let n = m.unconfined ? 1 : 0; n <= nMax; n += m.unconfined ? 2 : 1) {
    const [w, c] = mode(n);
    if (c !== 0) sum += c * f1(m, w, p);
  }
  return sum;
}

/**
 * The Laplace transform of H/H0 in tau = t b Kr / rc^2. McElwee and Butler (1994)
 * print (10) as (gamma/alpha) Omega / (1 + (gamma/alpha) p Omega). Their boundary
 * condition (7), written in their dimensionless variables, gives gamma/2 in place of
 * gamma/alpha, and only gamma/2 reduces to Cooper et al. (1967) for a fully penetrating
 * well, as the report says it does; Zhan and Butler (2003, eq. 49) give the same
 * result in their variables. So gamma/2 is used.
 */
export const kgsLaplace = (m, omega) => (p) => {
  const o = (m.gamma / 2) * omega(p);
  return o / (1 + p * o);
};

// Times on a log grid, 12 to a log cycle, over the span asked for; the head is found
// there and interpolated to each time, because each Laplace value costs a sum of modes.
const PER_CYCLE = 12;

/** H/H0 at times t (s) by the KGS model. */
export function kgsHead(t, p, g) {
  const m = kgsGroups(p, g);
  const pos = t.filter((s) => s > 0);
  if (!pos.length) return t.map(() => 1);
  const lo = Math.min(...pos) * m.tau, hi = Math.max(...pos) * m.tau;
  const cycles = Math.max(libm.log10(hi / lo), 0.1);
  const count = Math.max(8, Math.ceil(cycles * PER_CYCLE) + 1);
  const grid = logTimes(lo, hi, count);
  const omega = kgsOmega(m, (STEHFEST_N * Math.LN2) / lo);
  const F = kgsLaplace(m, omega);
  const heads = grid.map((x) => stehfest(F, x));
  const interp = spline(grid.map(libm.log), heads);
  return t.map((s) => (s > 0 ? interp(libm.log(s * m.tau)) : 1));
}

// Natural cubic spline through (x, y), x increasing.
function spline(x, y) {
  const n = x.length;
  if (n === 1) return () => y[0];
  const h = x.slice(1).map((v, i) => v - x[i]);
  const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), r = new Float64Array(n);
  b[0] = 1; b[n - 1] = 1;
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i];
    r[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }
  for (let i = 1; i < n; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; r[i] -= w * r[i - 1]; }
  const M = new Float64Array(n);
  M[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) M[i] = (r[i] - c[i] * M[i + 1]) / b[i];
  return (v) => {
    let i = 0;
    if (v >= x[n - 1]) i = n - 2;
    else if (v > x[0]) { let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= v) lo = mid; else hi = mid; } i = lo; }
    const t = (v - x[i]) / h[i], u = 1 - t;
    return u * y[i] + t * y[i + 1] + ((u * u * u - u) * M[i] + (t * t * t - t) * M[i + 1]) * h[i] * h[i] / 6;
  };
}

// ---------------------------------------------------------------------------------
// High-K models for an oscillating response: Butler and Garnett (2000, KGS Open-File
// Report 2000-40), equations (1) to (6), after Springer and Gelhar (1991), Butler (1998)
// and Zlotnik and McGuire (1998).

/**
 * The normalized deviation wd(td) of a damped spring, with damping CD: equations (1)
 * to (3) of Butler and Garnett (2000), td = t sqrt(g / Le).
 */
export function dampedHead(td, CD) {
  if (!(td > 0)) return 1;
  if (Math.abs(CD - 2) < 1e-9) return libm.exp(-td) * (1 + td);
  if (CD < 2) {
    const w = Math.sqrt(1 - (CD / 2) * (CD / 2));
    return libm.exp(-CD * td / 2) * (libm.cos(w * td) + (CD / (2 * w)) * libm.sin(w * td));
  }
  const w = Math.sqrt((CD / 2) * (CD / 2) - 1);
  // The roots multiply to 1, so the slow one is 1 / the fast one: -CD/2 + w would lose
  // every figure to cancellation when CD is large, as on a strongly overdamped record.
  const down = -CD / 2 - w, up = 1 / down;
  return -(1 / (up - down)) * (down * libm.exp(up * td) - up * libm.exp(down * td));
}

/**
 * The log term of the high-K models, with rw* = rw sqrt(Kz/Kr) (Zlotnik 1994):
 * confined, ln[b/(2rw*) + sqrt(1 + (b/(2rw*))^2)] (Butler and Garnett 2000, eq. 5);
 * unconfined, ln(Re/rw*) of Bouwer and Rice (1976) (eq. 4), passed in as lnRe.
 */
export function highKShape({ rw, b, anisotropy }) {
  checkPositive({ 'Well radius': rw, 'Screen length': b, 'Kz/Kr': anisotropy });
  const x = b / (2 * rw * Math.sqrt(anisotropy));
  return libm.log(x + Math.sqrt(1 + x * x));
}

/** CD from K: Kr = sqrt(g/Le) rc^2 shape / (2 b CD), equations (4) and (5), the match-point ratio being sqrt(g/Le). */
export const dampingOf = (K, Le, { rc, b, shape, g = G }) => (Math.sqrt(g / Le) * rc * rc * shape) / (2 * b * K);

/** H/H0 at times t (s) for K (m/s) and the effective water column length Le (m). */
export function highKHead(t, { K, Le }, geo) {
  checkPositive({ 'Hydraulic conductivity': K, 'Effective water column length': Le, 'Casing radius': geo.rc });
  const CD = dampingOf(K, Le, geo), f = Math.sqrt((geo.g || G) / Le);
  return t.map((s) => dampedHead(s * f, CD));
}
