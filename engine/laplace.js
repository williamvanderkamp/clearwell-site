// Special functions and numerical Laplace inversion for the well and slug test solutions
// that are known only in Laplace space: Neuman, Moench, Papadopulos-Cooper, the KGS
// model and their kind. Stehfest (1970) for transforms at real p; de Hoog, Knight and
// Stokes (1982), with complex arithmetic and K0 and K1 at complex argument, for those
// that oscillate or need more accuracy than Stehfest gives.

import { EULER } from './numeric.js';
import * as libm from './libm.js';
import { SIN_COS } from './libm.js';

/** The number of terms of the Stehfest inversion. */
export const STEHFEST_N = 16;

// Trapezoid step for the K integrals: 0.25 to x = 10, then narrowing with the peak.
const step = (x) => 0.25 / Math.max(1, Math.sqrt(x / 10));
// cosh(k h) at the nodes. Up to x = 10 the step is always 0.25, so those are taken from a
// table made once, libm.cosh(k * 0.25) itself: the same numbers without the call.
const NODES = 400;
const COSH_STEP = Float64Array.from({ length: NODES }, (_, k) => libm.cosh(k * 0.25));
const nodeCosh = (k, h) => (h === 0.25 ? COSH_STEP[k] : libm.cosh(k * h));

// 1/k, 1/k² and 1/(k (k + 1)) for the power series of K0, K1 and I1 below, taken from
// tables rather than divided out at each term, the series being most of the time of the
// pumped well's terms in Dougherty and Babu.
const INV_K = Float64Array.from({ length: 202 }, (_, k) => (k ? 1 / k : 0));
const INV_K2 = Float64Array.from({ length: 201 }, (_, k) => (k ? 1 / (k * k) : 0));
const INV_KK1 = Float64Array.from({ length: 201 }, (_, k) => (k ? 1 / (k * (k + 1)) : 0));

// K0(x) by its power series to 2 and the trapezoid rule beyond: what the Chebyshev fits
// below are made from, and besselK0 itself to 2.
function trapezoidK0(x) {
  if (!(x > 0)) return Infinity;
  if (x <= 2) {
    const q = (x * x) / 4;
    let term = 1, i0 = 1, sum = 0, harmonic = 0;
    for (let k = 1; k < 30; k++) {
      term *= q * INV_K2[k];
      harmonic += INV_K[k];
      i0 += term;
      sum += term * harmonic;
      if (term < 1e-18) break;
    }
    return -(libm.log(x / 2) + EULER) * i0 + sum;
  }
  if (x > 745) return 0;
  // K0(x) = integral from 0 to infinity of exp(-x cosh t) dt. The trapezoid rule
  // converges exponentially on this integrand; a step of 0.25 is good to about 1e-17
  // up to x = 10. The peak at t = 0 narrows as 1/sqrt(x), so the step shrinks with it.
  const h = step(x);
  let sum = libm.exp(-x) / 2;
  for (let k = 1; k < NODES; k++) {
    const v = libm.exp(-x * nodeCosh(k, h));
    sum += v;
    if (v < 1e-18 * sum) break;
  }
  return sum * h;
}

// K1(x) by its power series to 2 and the trapezoid rule beyond, as trapezoidK0.
function trapezoidK1(x) {
  if (!(x > 0)) return Infinity;
  if (x <= 2) {
    // Abramowitz and Stegun 9.6.11 with n = 1:
    // K1(x) = 1/x + ln(x/2) I1(x) - (x/4) sum_k [psi(k+1) + psi(k+2)] (x^2/4)^k / (k! (k+1)!)
    // Summed with I1 in one loop by besselK01Series, which gives the same bits.
    besselK01Series(x, false);
    return K01[1];
  }
  if (x > 745) return 0;
  // K1(x) = integral from 0 to infinity of exp(-x cosh t) cosh t dt, by the trapezoid rule.
  const h = step(x);
  let sum = libm.exp(-x) / 2;
  for (let k = 1; k < NODES; k++) {
    const c = nodeCosh(k, h), v = libm.exp(-x * c) * c;
    sum += v;
    if (v < 1e-18 * sum) break;
  }
  return sum * h;
}

// I0 and I1 by their power series, which converge for every x; past 30 the terms grow
// large before they shrink, so the integral over a period is used, where the trapezoid
// rule is exact to rounding.
function besselI(n, x) {
  const a = Math.abs(x);
  if (a <= 30) {
    const q = (a * a) / 4;
    let term = n === 0 ? 1 : a / 2, sum = term;
    for (let k = 1; k < 200; k++) {
      term *= q / (k * (k + n));
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return n === 1 && x < 0 ? -sum : sum;
  }
  // I_n(x) = (1/pi) integral from 0 to pi of exp(x cos t) cos(n t) dt.
  const m = 256;
  let sum = 0;
  for (let k = 0; k <= m; k++) {
    const t = (Math.PI * k) / m, w = k === 0 || k === m ? 0.5 : 1;
    sum += w * libm.exp(a * libm.cos(t)) * libm.cos(n * t);
  }
  const v = sum / m;
  return n === 1 && x < 0 ? -v : v;
}

/** Modified Bessel function I0(x). */
export const besselI0 = (x) => besselI(0, x);

/** Modified Bessel function I1(x). */
export const besselI1 = (x) => besselI(1, x);

// ---------------------------------------------------------------------------------
// K scaled by e^x at real argument, and ratios of K0 and K1, so that the solutions can
// take ratios where K itself underflows.

/**
 * The large-argument expansion of K_nu (Abramowitz and Stegun 1964, 9.7.2) without its
 * prefactor: K_nu(x) e^x sqrt(2x / pi) = sum over k of a_k / x^k,
 * a_k = prod_{j<=k} (4nu^2 - (2j-1)^2) / (k! 8^k). From x = 25 up its terms fall to
 * 1e-17 well before they turn, so it is exact to rounding there.
 */
export function besselKAsymptotic(nu, x) {
  const mu = 4 * nu * nu;
  let term = 1, sum = 1;
  for (let k = 1; k < 40; k++) {
    term *= (mu - (2 * k - 1) * (2 * k - 1)) / (k * 8 * x);
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}

// Past this the scaled pair below comes from the asymptotic series.
const PAIR_ASYMPTOTIC_X = 30;

// e^x K_nu(x) for nu = 0 or 1, from besselK0 and besselK1 or the asymptotic series.
function scaledK(nu, x) {
  if (x <= PAIR_ASYMPTOTIC_X) return libm.exp(x) * (nu === 0 ? trapezoidK0(x) : trapezoidK1(x));
  return besselKAsymptotic(nu, x) * Math.sqrt(Math.PI / (2 * x));
}

// A series that needs e^x K0(x) and e^x K1(x) hundreds of times for each p gets them, between
// 2 and 30, from Chebyshev fits made once, here, to the trapezoid sums: on 2 to 8 in x,
// and on 8 to 30 in 1/x for sqrt(x) e^x K. A fit is a smooth polynomial, so it adds no
// jitter for Stehfest to amplify; 48 nodes reach the precision of the functions fitted.
const CHEB_NODES = 48;
function chebFit(f, n) {
  const c = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    const th = (Math.PI * (k + 0.5)) / n, v = f(libm.cos(th));
    for (let j = 0; j < n; j++) c[j] += (2 / n) * v * libm.cos(j * th);
  }
  c[0] /= 2;
  return c;
}
// Drops the coefficients past the last one above 1e-17 of the first.
function trim(c) {
  let n = c.length;
  while (n > 1 && Math.abs(c[n - 1]) < 1e-17 * Math.abs(c[0])) n--;
  return c.slice(0, n);
}
// Two Chebyshev series of the same length at u, by Clenshaw's recurrence.
function chebPair(c, d, u) {
  let b1 = 0, b2 = 0, e1 = 0, e2 = 0;
  for (let j = c.length - 1; j >= 1; j--) {
    const b = 2 * u * b1 - b2 + c[j]; b2 = b1; b1 = b;
    const e = 2 * u * e1 - e2 + d[j]; e2 = e1; e1 = e;
  }
  return [u * b1 - b2 + c[0], u * e1 - e2 + d[0]];
}
// One Chebyshev series at u, the same recurrence as chebPair's for it.
function chebOne(c, u) {
  let b1 = 0, b2 = 0;
  for (let j = c.length - 1; j >= 1; j--) {
    const b = 2 * u * b1 - b2 + c[j]; b2 = b1; b1 = b;
  }
  return u * b1 - b2 + c[0];
}
// One Chebyshev series at u and at v, into CHEB_AT[0] and [1], each by chebOne's own
// recurrence. Each is a chain of 48 operations that wait on the one before; two side by
// side keep the processor busy for nearly the time of one.
const CHEB_AT = new Float64Array(2);
function chebTwice(c, u, v) {
  let b1 = 0, b2 = 0, e1 = 0, e2 = 0;
  for (let j = c.length - 1; j >= 1; j--) {
    const b = 2 * u * b1 - b2 + c[j]; b2 = b1; b1 = b;
    const e = 2 * v * e1 - e2 + c[j]; e2 = e1; e1 = e;
  }
  CHEB_AT[0] = u * b1 - b2 + c[0];
  CHEB_AT[1] = v * e1 - e2 + c[0];
}
// Pads the shorter of two coefficient lists with zeros.
const pair = ([a, b]) => { const n = Math.max(a.length, b.length); return [a, b].map((c) => c.concat(new Array(n - c.length).fill(0))); };
const NEAR = pair([0, 1].map((nu) => trim(chebFit((u) => scaledK(nu, 5 + 3 * u), CHEB_NODES))));
const Y_LO = 1 / PAIR_ASYMPTOTIC_X, Y_HI = 1 / 8;
const toY = (u) => (Y_LO + Y_HI) / 2 + ((Y_HI - Y_LO) / 2) * u;
const FAR = pair([0, 1].map((nu) => trim(chebFit((u) => Math.sqrt(1 / toY(u)) * scaledK(nu, 1 / toY(u)), CHEB_NODES))));

// K0(x) and K1(x) for 0 < x <= 2 together: the power series of Abramowitz and Stegun
// (1964) 9.6.13 and 9.6.11, and that of I1 which K1 needs, as besselK0, besselK1 and
// besselI1 sum them, in one loop with one logarithm, where the three functions took
// three loops and two logarithms. Each sum keeps its own operations, in their order, and
// stops where its function stops, so the values are the same to the last bit.
// With k0 false, K0's sums are skipped and only K1 is right. The two go into K01, not a
// new array: the pumped well's terms in Dougherty and Babu take thousands for each p.
const K01 = new Float64Array(2);
function besselK01Series(x, k0 = true) {
  const q = (x * x) / 4, lx = libm.log(x / 2);
  // K0: term = q^k / (k!)^2, h0 = H_k. K1: u = q^k / (k! (k+1)!), hk = H_k, hk1 = H_(k+1),
  // its k = 0 term in s1 already. I1: v = (x/2) u, summed in i1.
  let term = 1, i0 = 1, s0 = 0, h0 = 0, on0 = k0;
  let u = 1, s1 = 0 + 1 * (0 - EULER + 1 - EULER), hk = 0, hk1 = 1, on1 = true;
  let v = x / 2, i1 = v, onI = true;
  for (let k = 1; on0 || on1 || onI; k++) {
    const f = q * INV_KK1[k];
    if (on0) {
      term *= q * INV_K2[k]; h0 += INV_K[k]; i0 += term; s0 += term * h0;
      if (term < 1e-18 || k === 29) on0 = false;
    }
    if (on1) {
      u *= f; hk += INV_K[k]; hk1 += INV_K[k + 1]; s1 += u * (hk - EULER + hk1 - EULER);
      if (u < 1e-18 || k === 29) on1 = false;
    }
    if (onI) {
      v *= f; i1 += v;
      if (v < 1e-17 * i1 || k === 199) onI = false;
    }
  }
  K01[0] = -(lx + EULER) * i0 + s0;
  K01[1] = 1 / x + lx * i1 - (x / 4) * s1;
}

/** [e^x K0(x), e^x K1(x)] for x > 0. */
export function besselK01Scaled(x) {
  if (x <= 2) { const e = libm.exp(x); besselK01Series(x); return [e * K01[0], e * K01[1]]; }
  if (x > PAIR_ASYMPTOTIC_X) return [scaledK(0, x), scaledK(1, x)];
  if (x <= 8) return chebPair(NEAR[0], NEAR[1], (x - 5) / 3);
  const u = (1 / x - (Y_LO + Y_HI) / 2) / ((Y_HI - Y_LO) / 2), s = 1 / Math.sqrt(x);
  const [k0, k1] = chebPair(FAR[0], FAR[1], u);
  return [s * k0, s * k1];
}

/** e^x K0(x) for x > 0, as besselK01Scaled gives it, without the work for K1. */
export function besselK0Scaled(x) {
  if (x <= 2 || x > PAIR_ASYMPTOTIC_X) return scaledK(0, x);
  if (x <= 8) return chebOne(NEAR[0], (x - 5) / 3);
  const u = (1 / x - (Y_LO + Y_HI) / 2) / ((Y_HI - Y_LO) / 2);
  return (1 / Math.sqrt(x)) * chebOne(FAR[0], u);
}

/**
 * Modified Bessel function K0(x): its power series to 2 (Abramowitz and Stegun 1964,
 * 9.6.13), e^-x times the Chebyshev fit of e^x K0 above to 30, and the asymptotic series
 * beyond (besselKAsymptotic). Until round 9 the trapezoid sum was taken at every call above
 * 2, some 10 to 50 exponentials each, which made most of the time of Neuman's and of
 * Dougherty and Babu's solutions. The fit is made from that sum and agrees with it to
 * about 10⁻¹⁴, and both with the integral to 5 × 10⁻¹³ at worst (tests/laplace.test.js);
 * as a polynomial it is smooth in x, where the sum's stopping test is not.
 */
export function besselK0(x) {
  if (!(x > 0)) return Infinity;
  if (x <= 2) return trapezoidK0(x);
  if (x > 745) return 0;
  return libm.exp(-x) * besselK0Scaled(x);
}

/** Modified Bessel function K1(x), as besselK0. */
export function besselK1(x) {
  if (!(x > 0)) return Infinity;
  if (x <= 2) return trapezoidK1(x);
  if (x > 745) return 0;
  return libm.exp(-x) * besselK01Scaled(x)[1];
}

// x (cosh t - 1) without the cancellation near t = 0.
const coshm1 = (t) => { const s = libm.sinh(t / 2); return 2 * s * s; };

/**
 * e^x K_a(x) and e^x K_b(x) for real orders a, b and x > 0, from
 * K_v(x) = integral from 0 to infinity of exp(-x cosh t) cosh(v t) dt by the trapezoid
 * rule, which converges exponentially on it. The step is 0.25 to x = 10 and shrinks
 * with the peak beyond, as for besselK0 and besselK1. Scaled by e^x so that ratios
 * stay finite at large x.
 */
export function besselKScaledPair(a, b, x) {
  const h = 0.25 / Math.max(1, Math.sqrt(x / 10));
  const top = Math.max(Math.abs(a), Math.abs(b));
  let sa = 0.5, sb = 0.5;
  for (let k = 1; k < 2000; k++) {
    const t = k * h;
    const e = libm.exp(-x * coshm1(t));
    const va = e * libm.cosh(a * t), vb = e * libm.cosh(b * t);
    sa += va; sb += vb;
    if (e * libm.cosh(top * t) < 1e-17 * Math.min(sa, sb)) break;
  }
  return [sa * h, sb * h];
}

/** e^x K_v(x), for real v and x > 0. */
export const besselKScaled = (v, x) => besselKScaledPair(v, v, x)[0];

// Above this argument the ratios below use the asymptotic series, which carries e^-x
// outside, so K0 and K1 of large arguments do not underflow.
const RATIO_ASYMPTOTIC_X = 25;

/**
 * K0(x) / K1(x), without overflow or underflow at large x: from one loop of their series
 * below 2, as the ratio of e^x K0 and e^x K1 (besselK01Scaled) above, with no exponential
 * at all, and from the asymptotic series past RATIO_ASYMPTOTIC_X.
 */
export function k0OverK1(x) {
  if (x >= RATIO_ASYMPTOTIC_X) return besselKAsymptotic(0, x) / besselKAsymptotic(1, x);
  if (x <= 2) { besselK01Series(x); return K01[0] / K01[1]; }
  const [k0, k1] = besselK01Scaled(x);
  return k0 / k1;
}

// K_nu(x) / K1(y) for x >= y > 0, nu 0 or 1, without underflow when both are large: as
// e^(y - x) times the ratio of e^x K_nu(x) and e^y K1(y) (besselK01Scaled), one
// exponential where the trapezoid sums took tens.
function kOverK1At(nu, x, y) {
  if (y >= RATIO_ASYMPTOTIC_X) return Math.sqrt(y / x) * libm.exp(y - x) * (besselKAsymptotic(nu, x) / besselKAsymptotic(1, y));
  if (x <= 2) return (nu ? besselK1(x) : besselK0(x)) / besselK1(y);
  const top = nu ? besselK01Scaled(x)[1] : besselK0Scaled(x);
  if (y <= 2) return (libm.exp(-x) * top) / besselK1(y);
  return libm.exp(y - x) * (top / besselK01Scaled(y)[1]);
}

/** K0(x) / K1(y) for x >= y > 0. */
export const k0OverK1At = (x, y) => kOverK1At(0, x, y);

/** K1(x) / K1(y) for x >= y > 0. */
export const k1OverK1At = (x, y) => kOverK1At(1, x, y);

/**
 * K0(y) / K1(y) and K0(x) / K1(y) for x >= y > 0, into K_RATIOS[0] and [1]: k0OverK1(y)
 * and k0OverK1At(x, y), the same bits, with the series at y summed once where both would
 * sum it, and no array made for them.
 */
export const K_RATIOS = new Float64Array(4);
export function k0OverK1Both(x, y) {
  if (y > 2) { K_RATIOS[0] = k0OverK1(y); K_RATIOS[1] = k0OverK1At(x, y); return; }
  besselK01Series(y);
  const k0 = K01[0], k1 = K01[1];
  const top = x <= 2 ? trapezoidK0(x) : x > 745 ? 0 : libm.exp(-x) * besselK0Scaled(x);
  K_RATIOS[0] = k0 / k1;
  K_RATIOS[1] = top / k1;
}

/**
 * k0OverK1Both at (x, y) and at (x2, y2), into K_RATIOS[0] to [3]: the same bits. Where both
 * x fall on one Chebyshev fit of e^x K0, the two are summed side by side (chebTwice).
 */
export function k0OverK1BothTwice(x, y, x2, y2) {
  const near = x > 2 && x2 > 2 && x <= 8 && x2 <= 8, far = x > 8 && x2 > 8 && x <= PAIR_ASYMPTOTIC_X && x2 <= PAIR_ASYMPTOTIC_X;
  if (!(y <= 2 && y2 <= 2 && (near || far))) {
    k0OverK1Both(x2, y2);
    const a = K_RATIOS[0], b = K_RATIOS[1];
    k0OverK1Both(x, y);
    K_RATIOS[2] = a; K_RATIOS[3] = b;
    return;
  }
  let top, top2;
  if (near) {
    chebTwice(NEAR[0], (x - 5) / 3, (x2 - 5) / 3);
    top = libm.exp(-x) * CHEB_AT[0]; top2 = libm.exp(-x2) * CHEB_AT[1];
  } else {
    const mid = (Y_LO + Y_HI) / 2, half = (Y_HI - Y_LO) / 2;
    chebTwice(FAR[0], (1 / x - mid) / half, (1 / x2 - mid) / half);
    top = libm.exp(-x) * ((1 / Math.sqrt(x)) * CHEB_AT[0]); top2 = libm.exp(-x2) * ((1 / Math.sqrt(x2)) * CHEB_AT[1]);
  }
  besselK01Series(y);
  K_RATIOS[0] = K01[0] / K01[1]; K_RATIOS[1] = top / K01[1];
  besselK01Series(y2);
  K_RATIOS[2] = K01[0] / K01[1]; K_RATIOS[3] = top2 / K01[1];
}

/** Stehfest (1970) weights V_j for an even N. */
export function stehfestWeights(N) {
  const fact = [1];
  for (let i = 1; i <= N; i++) fact[i] = fact[i - 1] * i;
  const half = N / 2;
  const V = [];
  for (let j = 1; j <= N; j++) {
    let sum = 0;
    for (let k = Math.floor((j + 1) / 2); k <= Math.min(j, half); k++) {
      sum += (libm.pow(k, half) * fact[2 * k]) / (fact[half - k] * fact[k] * fact[k - 1] * fact[j - k] * fact[2 * k - j]);
    }
    V.push((j + half) % 2 === 0 ? sum : -sum);
  }
  return V;
}
const WEIGHTS = stehfestWeights(STEHFEST_N);

/** Inverse Laplace transform of F at time t, by Stehfest. */
export function stehfest(F, t, V = WEIGHTS) {
  const k = Math.LN2 / t;
  let sum = 0;
  for (let j = 0; j < V.length; j++) sum += V[j] * F((j + 1) * k);
  return k * sum;
}

// ---------------------------------------------------------------------------------
// Complex numbers as { re, im }: what the transforms inverted by de Hoog's method need.

export const cx = (re, im = 0) => ({ re, im });
export const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
export const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
export const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cscale = (a, k) => cx(a.re * k, a.im * k);
export const cabs = (a) => libm.hypot(a.re, a.im);
export function cdiv(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
// The principal root, whose real part is never negative.
export function csqrt(a) {
  const m = cabs(a), re = Math.sqrt((m + a.re) / 2), im = Math.sqrt(Math.max(0, (m - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
}
export function cexp(a) {
  const e = libm.exp(a.re);
  libm.sinCos(a.im);
  return cx(e * SIN_COS[1], e * SIN_COS[0]);
}
const clog = (a) => cx(libm.log(cabs(a)), libm.atan2(a.im, a.re));

// ---------------------------------------------------------------------------------
// K0 and K1 at complex argument

// K0 and K1 for |z| <= 2 by their power series (Abramowitz and Stegun 1964, 9.6.13 and
// 9.6.11), the same sums as besselK0 and besselK1 use on the real line, here at complex z.
function kSeries(z) {
  // In plain arithmetic on real and imaginary parts, the operations of cmul, cadd and
  // cscale in their order, so the sums are the same to the last bit without the objects.
  const zr = z.re, zi = z.im;
  const qr = (zr * zr - zi * zi) * 0.25, qi = (zr * zi + zi * zr) * 0.25;
  const hr = zr * 0.5, hi = zi * 0.5, lr = libm.log(libm.hypot(hr, hi)), li = libm.atan2(hi, hr);
  const lzr = lr + EULER, lzi = li + 0;
  let tr = 1, ti = 0, i0r = 1, i0i = 0, s0r = 0, s0i = 0, harmonic = 0; // term = q^k / (k!)^2
  let ur = 1, ui = 0, i1r = 1, i1i = 0, s1r = 2 * (1 - EULER) - 1, s1i = 0; // u = q^k / (k! (k+1)!)
  for (let k = 1; k < 40; k++) {
    let f = 1 / (k * k);
    const ar = tr * qr - ti * qi, ai = tr * qi + ti * qr;
    tr = ar * f; ti = ai * f;
    f = 1 / (k * (k + 1));
    const br = ur * qr - ui * qi, bi = ur * qi + ui * qr;
    ur = br * f; ui = bi * f;
    harmonic += 1 / k;
    i0r += tr; i0i += ti; s0r += tr * harmonic; s0i += ti * harmonic;
    const w = 2 * harmonic + 1 / (k + 1) - 2 * EULER;
    i1r += ur; i1i += ui; s1r += ur * w; s1i += ui * w;
    // |term| < 1e-17 |I0|, compared in squares: Math.hypot cost more than the rest of the
    // step, and the two decide alike but within rounding of the bound.
    if (tr * tr + ti * ti < 1e-34 * (i0r * i0r + i0i * i0i)) break;
  }
  const k0 = cx(s0r - (lzr * i0r - lzi * i0i), s0i - (lzr * i0i + lzi * i0r));
  // K1 = 1/z + ln(z/2) I1(z) - (z/4) sum (psi(k+1) + psi(k+2)) q^k / (k! (k+1)!), I1 = (z/2) sum q^k / (k! (k+1)!)
  const ar = hr * i1r - hi * i1i, ai = hr * i1i + hi * i1r;
  const br = lr * ar - li * ai, bi = lr * ai + li * ar;
  const cr = zr * 0.25, ci = zi * 0.25;
  const dr = cr * s1r - ci * s1i, di = cr * s1i + ci * s1r;
  const d = zr * zr + zi * zi;
  const k1 = cx((1 * zr + 0 * zi) / d + (br - dr), (0 * zr - 1 * zi) / d + (bi - di));
  return [k0, k1];
}

// cosh t - 1 at the nodes t = k/8, the step of kScaled01 up to |z| = 10: from a table made
// once, coshm1 itself, as COSH_STEP above.
const W_EIGHTH = Float64Array.from({ length: NODES }, (_, k) => coshm1(k * 0.125));

/**
 * [e^z K0(z), e^z K1(z)] for Re z > 0, scaled so they neither overflow nor underflow.
 * Up to |z| = 2 by the power series. Then to |z| = 25 from
 *   K_nu(z) = integral from 0 to infinity of exp(-z cosh t) cosh(nu t) dt,
 * written with cosh t - 1 = 2 sinh²(t/2), by the trapezoid rule, which converges
 * exponentially on it. On the de Hoog contour arg z stays within π/4, so the integrand
 * stays analytic and decaying in a strip π/4 wide, and a step of 1/8 is good to about
 * 1e-15; the peak narrows as 1/√|z|, so the step shrinks with it, as for the real K0 and
 * K1. Past 25, the asymptotic series of Abramowitz and Stegun (1964, 9.7.2), whose
 * smallest term is about e^-50.
 */
export function kScaled01(z) {
  const m = cabs(z);
  if (m <= 2) {
    const e = cexp(z), [k0, k1] = kSeries(z);
    return [cmul(e, k0), cmul(e, k1)];
  }
  if (m > 25) {
    // The terms divided by 8z as cdiv does it, in plain arithmetic. The break asks for
    // |a| + |b| only when the sums of the larger and of both parts do not settle it.
    const xr = z.re * 8, xi = z.im * 8, d = xr * xr + xi * xi, root = csqrt(cdiv(cx(Math.PI / 2), z));
    let ar = 1, ai = 0, br = 1, bi = 0, sar = 1, sai = 0, sbr = 1, sbi = 0;
    for (let k = 1; k <= 40; k++) {
      const odd = (2 * k - 1) * (2 * k - 1), fa = -odd / k, fb = (4 - odd) / k;
      const pr = ar * fa, pi = ai * fa, qr = br * fb, qi = bi * fb;
      ar = (pr * xr + pi * xi) / d; ai = (pi * xr - pr * xi) / d;
      br = (qr * xr + qi * xi) / d; bi = (qi * xr - qr * xi) / d;
      sar += ar; sai += ai; sbr += br; sbi += bi;
      const ua = Math.abs(ar), va = Math.abs(ai), ub = Math.abs(br), vb = Math.abs(bi);
      if (Math.max(ua, va) + Math.max(ub, vb) >= 1e-17) continue;
      if (ua + va + ub + vb < 1e-17 || libm.hypot(ar, ai) + libm.hypot(br, bi) < 1e-17) break;
    }
    return [cmul(cx(sar, sai), root), cmul(cx(sbr, sbi), root)];
  }
  const h = 0.125 / Math.max(1, Math.sqrt(m / 10));
  let r0 = 0.5, i0 = 0, r1 = 0.5, i1 = 0;
  for (let k = 1; k < 5000; k++) {
    const w = h === 0.125 && k < NODES ? W_EIGHTH[k] : coshm1(k * h), ch = 1 + w;
    const mag = libm.exp(-z.re * w), ph = -z.im * w;
    libm.sinCos(ph);
    const re = mag * SIN_COS[1], im = mag * SIN_COS[0];
    r0 += re; i0 += im; r1 += re * ch; i1 += im * ch;
    if ((mag * ch) * (mag * ch) < 1e-34 * (r0 * r0 + i0 * i0)) break; // in squares, as in kSeries
  }
  return [cx(r0 * h, i0 * h), cx(r1 * h, i1 * h)];
}

/** e^z K_nu(z) for nu = 0 or 1, Re z > 0. */
export const kScaled = (nu, z) => kScaled01(z)[nu];

/**
 * K0(z) / K1(z) for complex z with Re z > 0. Power series (Abramowitz and Stegun 9.6.13
 * and 9.6.11) to |z| = 2, the integral K_n(z) = int_0^inf exp(-z cosh t) cosh(n t) dt
 * (9.6.24) to |z| = 25, and the large-argument expansion (9.7.2) beyond.
 */
// The slug models use this rather than the ratio of kScaled01's pair. The two round
// differently, and the switch moves the Butler and Zhan heads by up to 1e-8 of their
// value (more where the head is near zero), so each keeps the one it was checked with.
export function ratioK(z) {
  const zr = z.re, zi = z.im, r = libm.hypot(zr, zi);
  if (r <= 2) {
    // Plain arithmetic on real and imaginary parts: this is the inner loop of the slug fits.
    const qr = (zr * zr - zi * zi) / 4, qi = (zr * zi) / 2;
    let tr = 1, ti = 0, i0r = 1, i0i = 0, s0r = 0, s0i = 0, harmonic = 0;
    let ur = 1, ui = 0, c1r = 1 - 2 * EULER, c1i = 0, sumUr = 1, sumUi = 0, hk = 0, hk1 = 1;
    for (let k = 1; k < 40; k++) {
      let x = (tr * qr - ti * qi) / (k * k), y = (tr * qi + ti * qr) / (k * k);
      tr = x; ti = y;
      harmonic += 1 / k;
      i0r += tr; i0i += ti;
      s0r += tr * harmonic; s0i += ti * harmonic;
      x = (ur * qr - ui * qi) / (k * (k + 1)); y = (ur * qi + ui * qr) / (k * (k + 1));
      ur = x; ui = y;
      hk += 1 / k; hk1 += 1 / (k + 1);
      c1r += ur * (hk + hk1 - 2 * EULER); c1i += ui * (hk + hk1 - 2 * EULER);
      sumUr += ur; sumUi += ui;
      if (Math.abs(tr) + Math.abs(ti) < 1e-18) break;
    }
    // I1 = (z/2) sum u_k; K0 = -(ln(z/2) + gamma) I0 + s0; K1 = 1/z + ln(z/2) I1 - (z/4) c1.
    const lr = libm.log(r / 2), li = libm.atan2(zi, zr);
    const i1r = (zr * sumUr - zi * sumUi) / 2, i1i = (zr * sumUi + zi * sumUr) / 2;
    const k0r = -((lr + EULER) * i0r - li * i0i) + s0r, k0i = -((lr + EULER) * i0i + li * i0r) + s0i;
    const d = zr * zr + zi * zi;
    const k1r = zr / d + (lr * i1r - li * i1i) - (zr * c1r - zi * c1i) / 4;
    const k1i = -zi / d + (lr * i1i + li * i1r) - (zr * c1i + zi * c1r) / 4;
    return cdiv(cx(k0r, k0i), cx(k1r, k1i));
  }
  if (r <= 25) {
    // Scaled by exp(z), which cancels in the ratio; step as for the real functions.
    const h = 0.25 / Math.max(1, Math.sqrt(r / 10)) / 2;
    let ar = 0.5, ai = 0, br = 0.5, bi = 0;
    for (let k = 1; k < 2000; k++) {
      const c = libm.cosh(k * h) - 1, e = libm.exp(-zr * c);
      libm.sinCos(-zi * c);
      const er = e * SIN_COS[1], ei = e * SIN_COS[0];
      ar += er; ai += ei; br += er * (c + 1); bi += ei * (c + 1);
      if (e < 1e-18) break;
    }
    return cdiv(cx(ar, ai), cx(br, bi));
  }
  const series = (n) => {
    const mu = 4 * n * n;
    let term = cx(1), sum = cx(1);
    for (let k = 1; k < 30; k++) {
      const next = cscale(cdiv(term, z), (mu - (2 * k - 1) * (2 * k - 1)) / (k * 8));
      if (cabs(next) >= cabs(term)) break;
      term = next;
      sum = cadd(sum, term);
    }
    return sum;
  };
  return cdiv(series(0), series(1));
}

// ---------------------------------------------------------------------------------
// de Hoog, Knight and Stokes (1982)

/**
 * Inverse Laplace transform of F at each of the times t, by de Hoog, Knight and Stokes
 * (1982): the Fourier series of the Bromwich integral with half period T, summed as a
 * continued fraction found by the quotient-difference algorithm, with their estimate
 * of the remainder. One T serves every time, so F is evaluated only 2M + 1 times. F
 * takes and returns complex numbers.
 */
export function deHoog(F, t, { M = 40, T = 1.2 * Math.max(...t), tol = 1e-12 } = {}) {
  const gam = -libm.log(tol) / (2 * T);
  const n = 2 * M + 1;
  const a = [];
  for (let k = 0; k < n; k++) a.push(F(cx(gam, (k * Math.PI) / T)));
  a[0] = cscale(a[0], 0.5);
  // Quotient-difference table: d holds the continued-fraction coefficients.
  let e = Array.from({ length: n }, () => cx(0));
  let q = [];
  for (let i = 0; i < n - 1; i++) q.push(cdiv(a[i + 1], a[i]));
  const d = [a[0], cscale(q[0], -1)];
  for (let r = 1; r <= M; r++) {
    const eNew = [];
    for (let i = 0; i < n - 2 * r; i++) eNew.push(cadd(csub(q[i + 1], q[i]), e[i + 1]));
    d.push(cscale(eNew[0], -1));
    if (r < M) {
      const qNew = [];
      for (let i = 0; i < n - 2 * r - 1; i++) qNew.push(cdiv(cmul(q[i + 1], eNew[i + 1]), eNew[i]));
      d.push(cscale(qNew[0], -1));
      q = qNew;
    }
    e = eNew;
  }
  // The continued fraction at z = exp(iπt/T), by its recurrence, closed with the remainder.
  return t.map((time) => {
    libm.sinCos((Math.PI * time) / T);
    const z = cx(SIN_COS[1], SIN_COS[0]);
    let A0 = cx(0), A1 = d[0], B0 = cx(1), B1 = cx(1);
    for (let k = 1; k < 2 * M; k++) {
      const dz = cmul(d[k], z);
      const A2 = cadd(A1, cmul(dz, A0)), B2 = cadd(B1, cmul(dz, B0));
      A0 = A1; A1 = A2; B0 = B1; B1 = B2;
    }
    const h = cscale(cadd(cx(1), cmul(csub(d[2 * M - 1], d[2 * M]), z)), 0.5);
    const R = cscale(cmul(h, csub(cx(1), csqrt(cadd(cx(1), cdiv(cmul(d[2 * M], z), cmul(h, h)))))), -1);
    const A = cadd(A1, cmul(R, A0)), B = cadd(B1, cmul(R, B0));
    return (libm.exp(gam * time) / T) * cdiv(A, B).re;
  });
}

/**
 * The de Hoog inversion at one time t, with its own period 2t and 2M + 1 = 21 values of
 * F, as the leaky aquifer solutions use it. A transform too small to hold in a double
 * gives 0.
 */
export function deHoogAt(F, t, M = 10, tol = 1e-12) {
  const f = deHoog(F, [t], { M, T: 2 * t, tol })[0];
  return Number.isFinite(f) ? f : 0;
}

/**
 * De Hoog inversion for a response that may oscillate with angular frequency up to
 * omega (in the units of t). The times are taken in groups spanning a factor of 2, each
 * with T = 1.5 times its last time, and with more terms where T spans more periods:
 * M = 16 + 4 per period, which the tests show keeps the error near 1e-9 on a damped
 * spring.
 */
export function invertOscillating(F, t, omega) {
  const out = new Array(t.length);
  for (const { grp, T, M } of oscillatingGroups(t, omega)) {
    deHoog(F, grp.map((i) => t[i]), { M, T }).forEach((v, j) => { out[grp[j]] = v; });
  }
  return out;
}

/** The groups invertOscillating takes the times t in: their indices grp, with T and M. */
export function oscillatingGroups(t, omega) {
  const groups = [];
  const order = t.map((x, i) => i).sort((i, j) => t[i] - t[j]);
  let k = 0;
  while (k < order.length) {
    const lo = t[order[k]];
    const grp = [];
    while (k < order.length && t[order[k]] < 2 * lo) grp.push(order[k++]);
    const T = 1.5 * t[grp[grp.length - 1]];
    const M = Math.min(120, 16 + Math.ceil((4 * T * omega) / (2 * Math.PI)));
    groups.push({ grp, T, M });
  }
  return groups;
}
