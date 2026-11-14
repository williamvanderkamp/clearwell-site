// The elementary functions the pumping test fit takes, written out in JavaScript so that
// they give the same bits on every computer and in every browser. ECMAScript leaves
// Math.exp, Math.log, Math.sin and the rest "implementation-approximated", and engines do
// differ: on 25 000 arguments, Chrome 157 and Node 26.13 gave different last bits for 2 to
// 20% of them in every one of exp, log, log10, sin, cos, atan, atan2, cosh and sinh (only
// sqrt, which IEEE 754 rounds correctly, pow and hypot agreed). A fit is a long chain of
// decisions, each step kept or not as the misfit falls, so a last bit can end it in
// another place: Dougherty and Babu on Oude Korendijk, screen 0 to 4 m, ended at 9.928
// mm in Node and 9.978 mm in Chrome.
//
// Each function follows FDLIBM 5.3 (Sun Microsystems 1993; the routine named in each
// docstring): its constants, its reductions and its order of operations, in plain double
// arithmetic, which ECMAScript defines exactly (IEEE 754, round to nearest, no fused
// multiply-add, no wider intermediates), so every engine gives the same bits. Each is
// within one unit in the last place of the true value, as the engines' own are
// (tests/libm.test.js), except sinh, log10, asinh and acosh, within two. The high and low
// 32 bits of a double are read and written through one shared buffer. Where FDLIBM
// compares the high word of |x| with a constant, the same test is made on |x| itself
// against the double with that high word, and where it adds k to a result's exponent, the
// result is multiplied by 2^k, which is the same number while the result is normal: both
// only to save time.
//
// Sun's notice, which FDLIBM asks to keep with it: "Copyright (C) 1993 by Sun
// Microsystems, Inc. All rights reserved. Developed at SunPro, a Sun Microsystems, Inc.
// business. Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved."

const F = new Float64Array(1);
const W = new Int32Array(F.buffer);
// Which word holds the sign and exponent: 1 on every little-endian machine.
const HI = (() => { F[0] = 1; return W[1] === 0x3ff00000 ? 1 : 0; })(), LO = 1 - HI;
const hiOf = (x) => { F[0] = x; return W[HI]; };
const loOf = (x) => { F[0] = x; return W[LO]; };
const withHi = (x, h) => { F[0] = x; W[HI] = h; return F[0]; };
const fromWords = (h, l) => { W[HI] = h; W[LO] = l; return F[0]; };
// The double whose high word is h, low word 0: |x| >= wordAt(h) is FDLIBM's high word of
// |x| >= h.
const wordAt = (h) => fromWords(h, 0);
// 2^k for k from -1022 to 1023, at TWO_K[k + 1022].
const TWO_K = Float64Array.from({ length: 2046 }, (_, i) => fromWords((i + 1) << 20, 0));
// y 2^k, for k from -1022 to 1024 and y within a factor of 2 of 1, as FDLIBM adds k to the
// exponent of y.
const scale = (y, k) => (k > 1023 ? y * 2 * TWO_K[k - 1 + 1022] : y * TWO_K[k + 1022]);

const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const TWO54 = 1.80143985094819840000e+16;
const HUGE = 1.0e+300, TWOM1000 = 9.33263618503218878990e-302;

// e_exp.c
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const O_THRESHOLD = 7.09782712893383973096e+02, U_THRESHOLD = -7.45133219101941108420e+02;

const EXP_BIG = wordAt(0x40862e42), EXP_HALF_LN2 = wordAt(0x3fd62e43), EXP_LN2 = wordAt(0x3ff0a2b2), EXP_TINY = wordAt(0x3e300000);

/** e^x (FDLIBM e_exp.c). */
export function exp(x) {
  const a = Math.abs(x), neg = x < 0;
  if (!(a < EXP_BIG)) {
    if (a !== a) return x + x;
    if (a === Infinity) return neg ? 0 : x;
    if (x > O_THRESHOLD) return HUGE * HUGE;
    if (x < U_THRESHOLD) return TWOM1000 * TWOM1000;
  }
  let hi = 0, lo = 0, k = 0;
  if (a >= EXP_HALF_LN2) {
    if (a < EXP_LN2) {
      hi = neg ? x + LN2_HI : x - LN2_HI; lo = neg ? -LN2_LO : LN2_LO; k = neg ? -1 : 1;
    } else {
      k = Math.trunc(INV_LN2 * x + (neg ? -0.5 : 0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (a < EXP_TINY) {
    if (HUGE + x > 1) return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  if (k >= -1021) return scale(y, k);
  return scale(y, k + 1000) * TWOM1000;
}

// e_log.c
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01, LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;

/** The natural logarithm (FDLIBM e_log.c). */
export function log(x) {
  F[0] = x;
  let hx = W[HI];
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | W[LO]) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; F[0] = x; hx = W[HI];
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  W[HI] = hx | (i ^ 0x3ff00000);
  x = F[0];
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) { if (k === 0) return 0; return k * LN2_HI + k * LN2_LO; }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - ((R - k * LN2_LO) - f);
  }
  const s = f / (2 + f), dk = k, z = s * s;
  i = hx - 0x6147a;
  const w = z * z, j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

// e_log10.c
const IVLN10 = 4.34294481903251816668e-01, LOG10_2HI = 3.01029995663611771306e-01, LOG10_2LO = 3.69423907715893078616e-13;

/** The logarithm to base 10 (FDLIBM e_log10.c). */
export function log10(x) {
  let hx = hiOf(x);
  const lx = loOf(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; hx = hiOf(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = withHi(x, hx);
  const z = y * LOG10_2LO + IVLN10 * log(x);
  return z + y * LOG10_2HI;
}

// k_sin.c and k_cos.c: sin and cos on [-π/4, π/4], x + y the argument, y its tail.
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const KERNEL_TINY = wordAt(0x3e400000);
function kernelSin(x, y, iy) {
  if (Math.abs(x) < KERNEL_TINY && Math.trunc(x) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const COS_SMALL = wordAt(0x3fd33333), COS_BIG = wordAt(0x3fe90001);
function kernelCos(x, y) {
  const ax = Math.abs(x);
  if (ax < KERNEL_TINY && Math.trunc(x) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ax < COS_SMALL) return 1 - (0.5 * z - (z * r - x * y));
  // x/4 with the low word cleared.
  let qx = 0.28125;
  if (ax < COS_BIG) { F[0] = ax; W[LO] = 0; qx = F[0] * 0.25; }
  const hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// e_rem_pio2.c, to |x| <= 2^19 π/2: x - n π/2 as y0 + y1, with π/2 in three parts of 33
// bits each, so n π/2 is exact in each. Beyond that, remPio2Large below.
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const Y = new Float64Array(2);
function remPio2(x) {
  F[0] = x;
  const hx = W[HI], ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { Y[0] = z - PIO2_1T; Y[1] = (z - Y[0]) - PIO2_1T; } else { z -= PIO2_2; Y[0] = z - PIO2_2T; Y[1] = (z - Y[0]) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { Y[0] = z + PIO2_1T; Y[1] = (z - Y[0]) + PIO2_1T; } else { z += PIO2_2; Y[0] = z + PIO2_2T; Y[1] = (z - Y[0]) + PIO2_2T; }
    return -1;
  }
  const t = Math.abs(x);
  const n = Math.trunc(t * INV_PIO2 + 0.5), fn = n;
  let r = t - fn * PIO2_1, w = fn * PIO2_1T;
  // FDLIBM goes on to the next part of π/2 where the exponent of y0 is more than 16 (then
  // 49) below that of x, j: where |y0| < 2^(j - 16 - 1023) (then 2^(j - 49 - 1023)).
  const j = ix >> 20;
  let y0 = r - w;
  if (Math.abs(y0) < TWO_K[j - 17]) {
    let u = r; w = fn * PIO2_2; r = u - w; w = fn * PIO2_2T - ((u - r) - w); y0 = r - w;
    if (Math.abs(y0) < TWO_K[j - 50]) { u = r; w = fn * PIO2_3; r = u - w; w = fn * PIO2_3T - ((u - r) - w); y0 = r - w; }
  }
  Y[0] = y0;
  Y[1] = (r - y0) - w;
  if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
  return n;
}

// k_rem_pio2.c, for |x| > 2^19 π/2 (e_rem_pio2.c's last case): Payne and Hanek's
// reduction, |x| in three pieces of 24 bits times 2/π to as many of its bits as it takes
// (1584 tabulated), and the fraction left times π/2 in pieces of 24 bits. Only FDLIBM's
// double precision (its prec 2) is here.
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7,
  0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c,
  0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11,
  0x8b5a0a, 0x6d1f6d, 0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7,
  0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e,
  0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
];
const PIO2 = [1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22, 1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51];
const TWO24 = 1.67772160000000000000e+07, TWON24 = 5.96046447753906250000e-08;
const TX = new Float64Array(3), IQ = new Int32Array(20), FT = new Float64Array(20), FQ = new Float64Array(20), QT = new Float64Array(20);
function remPio2Large(x) {
  F[0] = x;
  const hx = W[HI], ix = hx & 0x7fffffff;
  // z = |x| 2^-e0, in [2^23, 2^24), in three pieces of 24 bits.
  const e0 = (ix >> 20) - 1046;
  W[HI] = ix - (e0 << 20);
  let z = F[0];
  for (let i = 0; i < 2; i++) { TX[i] = Math.trunc(z); z = (z - TX[i]) * TWO24; }
  TX[2] = z;
  let nx = 3;
  while (TX[nx - 1] === 0) nx--;
  const n = kernelRemPio2(e0, nx);
  if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
  return n;
}
function kernelRemPio2(e0, nx) {
  const jk = 4, jp = 4, jx = nx - 1;
  const jv = Math.max(Math.trunc((e0 - 3) / 24), 0);
  let q0 = e0 - 24 * (jv + 1);
  // FT[0] to FT[jx + jk], FT[jx + jk] the piece TWO_OVER_PI[jv + jk]; QT[0] to QT[jk].
  for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++) FT[i] = j < 0 ? 0 : TWO_OVER_PI[j];
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (let j = 0; j <= jx; j++) fw += TX[j] * FT[jx + i - j];
    QT[i] = fw;
  }
  let jz = jk, z, n, ih;
  for (;;) {
    // QT distilled into IQ, the other way round.
    z = QT[jz];
    for (let i = 0, j = jz; j > 0; i++, j--) {
      const fw = Math.trunc(TWON24 * z);
      IQ[i] = Math.trunc(z - TWO24 * fw);
      z = QT[j - 1] + fw;
    }
    // n, the integer part modulo 8.
    z *= TWO_K[q0 + 1022];
    z -= 8 * Math.floor(z * 0.125);
    n = Math.trunc(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {
      const i = IQ[jz - 1] >> (24 - q0);
      n += i;
      IQ[jz - 1] -= i << (24 - q0);
      ih = IQ[jz - 1] >> (23 - q0);
    } else if (q0 === 0) ih = IQ[jz - 1] >> 23;
    else if (z >= 0.5) ih = 2;
    // Above one half: n one more, and the fraction 1 - q.
    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (let i = 0; i < jz; i++) {
        const j = IQ[i];
        if (carry === 0) {
          if (j !== 0) { carry = 1; IQ[i] = 0x1000000 - j; }
        } else IQ[i] = 0xffffff - j;
      }
      if (q0 === 1) IQ[jz - 1] &= 0x7fffff;
      else if (q0 === 2) IQ[jz - 1] &= 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= TWO_K[q0 + 1022];
      }
    }
    // Recomputed with more pieces of 2/π where every bit kept cancelled.
    if (z !== 0) break;
    let j = 0;
    for (let i = jz - 1; i >= jk; i--) j |= IQ[i];
    if (j !== 0) break;
    let k = 1;
    while (IQ[jk - k] === 0) k++;
    for (let i = jz + 1; i <= jz + k; i++) {
      FT[jx + i] = TWO_OVER_PI[jv + i];
      let fw = 0;
      for (let m = 0; m <= jx; m++) fw += TX[m] * FT[jx + i - m];
      QT[i] = fw;
    }
    jz += k;
  }
  // The zero pieces chopped off, or z broken into pieces of 24 bits.
  if (z === 0) {
    jz -= 1; q0 -= 24;
    while (IQ[jz] === 0) { jz--; q0 -= 24; }
  } else {
    z *= TWO_K[-q0 + 1022];
    if (z >= TWO24) {
      const fw = Math.trunc(TWON24 * z);
      IQ[jz] = Math.trunc(z - TWO24 * fw);
      jz += 1; q0 += 24;
      IQ[jz] = fw;
    } else IQ[jz] = Math.trunc(z);
  }
  // The pieces as doubles, times π/2.
  let fw = TWO_K[q0 + 1022];
  for (let i = jz; i >= 0; i--) { QT[i] = fw * IQ[i]; fw *= TWON24; }
  for (let i = jz; i >= 0; i--) {
    let f = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) f += PIO2[k] * QT[i + k];
    FQ[jz - i] = f;
  }
  let f = 0;
  for (let i = jz; i >= 0; i--) f += FQ[i];
  Y[0] = ih === 0 ? f : -f;
  f = FQ[0] - f;
  for (let i = 1; i <= jz; i++) f += FQ[i];
  Y[1] = ih === 0 ? f : -f;
  return n & 7;
}

const PI_4 =wordAt(0x3fe921fc), MEDIUM = wordAt(0x413921fc);

// sin and cos are each split in two, the reduction apart, so that the short part, which
// is all that |x| < π/4 takes, is small enough for the engine to write in at each call.

/** The sine (FDLIBM s_sin.c). */
export function sin(x) {
  const a = Math.abs(x);
  return a < PI_4 ? kernelSin(x, 0, 0) : sinReduced(x, a);
}
function sinReduced(x, a) {
  if (!(a < Infinity)) return x - x;
  const n = a < MEDIUM ? remPio2(x) : remPio2Large(x);
  switch (n & 3) {
    case 0: return kernelSin(Y[0], Y[1], 1);
    case 1: return kernelCos(Y[0], Y[1]);
    case 2: return -kernelSin(Y[0], Y[1], 1);
    default: return -kernelCos(Y[0], Y[1]);
  }
}

/** The cosine (FDLIBM s_cos.c). */
export function cos(x) {
  const a = Math.abs(x);
  return a < PI_4 ? kernelCos(x, 0) : cosReduced(x, a);
}
function cosReduced(x, a) {
  if (!(a < Infinity)) return x - x;
  const n = a < MEDIUM ? remPio2(x) : remPio2Large(x);
  switch (n & 3) {
    case 0: return kernelCos(Y[0], Y[1]);
    case 1: return -kernelSin(Y[0], Y[1], 1);
    case 2: return -kernelCos(Y[0], Y[1]);
    default: return kernelSin(Y[0], Y[1], 1);
  }
}

/**
 * The sine and the cosine of x together, into SIN_COS[0] and SIN_COS[1]: sin(x) and cos(x)
 * to the last bit, with one reduction where the two took one each. Nothing is returned,
 * so that a call makes no array.
 */
export const SIN_COS = new Float64Array(2);
export function sinCos(x) {
  const a = Math.abs(x);
  if (a < PI_4) { SIN_COS[0] = kernelSin(x, 0, 0); SIN_COS[1] = kernelCos(x, 0); return; }
  if (!(a < Infinity)) { SIN_COS[0] = SIN_COS[1] = x - x; return; }
  const n = a < MEDIUM ? remPio2(x) : remPio2Large(x), s = kernelSin(Y[0], Y[1], 1), c = kernelCos(Y[0], Y[1]);
  switch (n & 3) {
    case 0: SIN_COS[0] = s; SIN_COS[1] = c; return;
    case 1: SIN_COS[0] = c; SIN_COS[1] = -s; return;
    case 2: SIN_COS[0] = -s; SIN_COS[1] = -c; return;
    default: SIN_COS[0] = -c; SIN_COS[1] = s;
  }
}

// s_atan.c
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

const ATAN_HUGE = wordAt(0x44100000), ATAN_A = wordAt(0x3fdc0000), ATAN_TINY = wordAt(0x3e200000), ATAN_B = wordAt(0x3ff30000), ATAN_C = wordAt(0x3fe60000), ATAN_D = wordAt(0x40038000);

/** The arctangent (FDLIBM s_atan.c). */
export function atan(x) {
  const a = Math.abs(x), neg = x < 0;
  let id;
  if (!(a < ATAN_HUGE)) {
    if (a !== a) return x + x;
    return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];
  }
  if (a < ATAN_A) {
    if (a < ATAN_TINY && HUGE + x > 1) return x;
    id = -1;
  } else {
    x = a;
    if (a < ATAN_B) {
      if (a < ATAN_C) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
    } else if (a < ATAN_D) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return neg ? -r : r;
}

// e_atan2.c
const PI_O_4 = 7.8539816339744827900e-01, PI_O_2 = 1.5707963267948965580e+00, PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;

/** The angle of (x, y) from the x axis, in (-π, π] (FDLIBM e_atan2.c). */
export function atan2(y, x) {
  const hx = hiOf(x), lx = loOf(x), hy = hiOf(y), ly = loOf(y);
  const ix = hx & 0x7fffffff, iy = hy & 0x7fffffff;
  if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000) return x + y;
  if (hx === 0x3ff00000 && lx === 0) return atan(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) {
      case 0: case 1: return y;
      case 2: return PI + 1e-300;
      default: return -PI - 1e-300;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - 1e-300 : PI_O_2 + 1e-300;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return PI_O_4 + 1e-300;
        case 1: return -PI_O_4 - 1e-300;
        case 2: return 3 * PI_O_4 + 1e-300;
        default: return -3 * PI_O_4 - 1e-300;
      }
    }
    switch (m) {
      case 0: return 0;
      case 1: return -0;
      case 2: return PI + 1e-300;
      default: return -PI - 1e-300;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - 1e-300 : PI_O_2 + 1e-300;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return withHi(z, hiOf(z) ^ 0x80000000);
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// s_expm1.c
const Q1 = -3.33333333333331316428e-02, Q2 = 1.58730158725481460165e-03, Q3 = -7.93650757867487942473e-05, Q4 = 4.00821782732936239552e-06, Q5 = -2.01099218183624371326e-07;

/** e^x - 1, exact near 0 (FDLIBM s_expm1.c). */
export function expm1(x) {
  let hx = hiOf(x);
  const xsb = hx & 0x80000000;
  hx &= 0x7fffffff;
  if (hx >= 0x4043687a) {
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | loOf(x)) !== 0) return x + x;
        return xsb === 0 ? x : -1;
      }
      if (x > O_THRESHOLD) return HUGE * HUGE;
    }
    if (xsb !== 0 && x + 1e-300 < 0) return 1e-300 - 1;
  }
  let hi, lo, k, c = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (xsb === 0) { hi = x - LN2_HI; lo = LN2_LO; k = 1; } else { hi = x + LN2_HI; lo = -LN2_LO; k = -1; }
    } else {
      k = Math.trunc(INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
    c = (hi - x) - lo;
  } else if (hx < 0x3c900000) {
    const t = HUGE + x;
    return x - (t - (HUGE + x));
  } else k = 0;
  const hfx = 0.5 * x, hxs = x * hfx;
  const r1 = 1 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  let t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) return x < -0.25 ? -2 * (e - (x + 0.5)) : 1 + 2 * (x - e);
  let y;
  if (k <= -2 || k > 56) {
    y = 1 - (e - x);
    y = withHi(y, hiOf(y) + (k << 20));
    return y - 1;
  }
  if (k < 20) {
    t = fromWords(0x3ff00000 - (0x200000 >> k), 0);
    y = t - (e - x);
    y = withHi(y, hiOf(y) + (k << 20));
  } else {
    t = fromWords((0x3ff - k) << 20, 0);
    y = x - (e + t);
    y += 1;
    y = withHi(y, hiOf(y) + (k << 20));
  }
  return y;
}

const COSH_A = wordAt(0x3fd62e43), COSH_TINY = wordAt(0x3c800000), COSH_22 = wordAt(0x40360000);

/** The hyperbolic cosine (FDLIBM e_cosh.c). */
export function cosh(x) {
  const a = Math.abs(x);
  if (!(a < Infinity)) return x * x;
  if (a < COSH_A) {
    const t = expm1(a), w = 1 + t;
    if (a < COSH_TINY) return w;
    return 1 + (t * t) / (w + w);
  }
  if (a < COSH_22) { const t = exp(a); return 0.5 * t + 0.5 / t; }
  if (a < EXP_BIG) return 0.5 * exp(a);
  const ix = hiOf(x) & 0x7fffffff;
  if (ix < 0x408633ce || (ix === 0x408633ce && (loOf(x) >>> 0) <= 0x8fb9f87d)) { const w = exp(0.5 * a), t = 0.5 * w; return t * w; }
  return HUGE * HUGE;
}

/** The hyperbolic sine (FDLIBM e_sinh.c). */
export function sinh(x) {
  const a = Math.abs(x);
  if (!(a < Infinity)) return x + x;
  const h = x < 0 ? -0.5 : 0.5;
  if (a < COSH_22) {
    if (a < EXP_TINY && HUGE + x > 1) return x;
    const t = expm1(a);
    if (a < 1) return h * (2 * t - (t * t) / (t + 1));
    return h * (t + t / (t + 1));
  }
  if (a < EXP_BIG) return h * exp(a);
  const ix = hiOf(x) & 0x7fffffff;
  if (ix < 0x408633ce || (ix === 0x408633ce && (loOf(x) >>> 0) <= 0x8fb9f87d)) { const w = exp(0.5 * a), t = h * w; return t * w; }
  return x * 1.0e307;
}

/**
 * log(1 + x), exact near 0, by Goldberg's (1991, Theorem 4) correction of log(1 + x):
 * within a few units in the last place. Not FDLIBM's s_log1p.c.
 */
export function log1p(x) {
  const w = 1 + x;
  if (w === 1) return x;
  if (!(w < Infinity) || !(w > 0)) return log(w);
  return (log(w) * x) / (w - 1);
}

const TWO28 = wordAt(0x41b00000);

/**
 * The inverse hyperbolic sine, by the formulas of FDLIBM's s_asinh.c with log1p above:
 * log |x| + ln 2 where x² would overflow, log(2|x| + 1/(√(x² + 1) + |x|)) above 2, and
 * log1p(|x| + x²/(1 + √(1 + x²))) below, with the sign of x.
 */
export function asinh(x) {
  const a = Math.abs(x);
  if (!(a < Infinity) || a === 0) return x + x;
  let r;
  if (a > TWO28) r = log(a) + LN2_HI + LN2_LO;
  else if (a > 2) r = log(2 * a + 1 / (Math.sqrt(x * x + 1) + a));
  else { const t = x * x; r = log1p(a + t / (1 + Math.sqrt(1 + t))); }
  return x < 0 ? -r : r;
}

/**
 * The inverse hyperbolic cosine for x >= 1, by the formulas of FDLIBM's e_acosh.c with
 * log1p above: log x + ln 2 where x² would overflow, log(2x − 1/(x + √(x² − 1))) above
 * 2, and log1p(t + √(2t + t²)) with t = x − 1 below.
 */
export function acosh(x) {
  if (!(x >= 1)) return NaN;
  if (x > TWO28) return x === Infinity ? x : log(x) + LN2_HI + LN2_LO;
  if (x === 1) return 0;
  if (x > 2) return log(2 * x - 1 / (x + Math.sqrt(x * x - 1)));
  const t = x - 1;
  return log1p(t + Math.sqrt(2 * t + t * t));
}

// e_pow.c
const BP = [1, 1.5], DP_H = [0, 5.84962487220764160156e-01], DP_L = [0, 1.35003920212974897128e-08];
const TWO53 = 9007199254740992, TINY = 1.0e-300;
const L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01, L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01;
const POW_LN2 = 6.93147180559945286227e-01, POW_LN2_H = 6.93147182464599609375e-01, POW_LN2_L = -1.90465429995776804525e-09;
const OVT = 8.0085662595372944372e-17;
const CP = 9.61796693925975554329e-01, CP_H = 9.61796700954437255859e-01, CP_L = -7.02846165095275826516e-09;
const IVLN2 = 1.44269504088896338700e+00, IVLN2_H = 1.44269502162933349609e+00, IVLN2_L = 1.92596299112661746887e-08;
// x with its low word cleared.
const clearLo = (x) => { F[0] = x; W[LO] = 0; return F[0]; };

/**
 * x to the power y (FDLIBM e_pow.c): within one unit in the last place, and exact where
 * the result is representable and x and y are integers; y = 2 gives x * x and y = 0.5
 * gives √x.
 */
export function pow(x, y) {
  F[0] = x;
  const hx = W[HI], lx = W[LO];
  F[0] = y;
  const hy = W[HI], ly = W[LO];
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if ((iy | ly) === 0) return 1;
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;
  // Whether y is an odd integer (1), an even one (2) or not one (0), where x < 0.
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly >>> 0) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if ((j << (20 - k)) === iy) yisint = 2 - (j & 1);
      }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) === 0) return y - y;
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }
  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z);
      else if (yisint === 1) z = -z;
    }
    return z;
  }
  let n = (hx >> 31) + 1;
  if ((n | yisint) === 0) return (x - x) / (x - x);
  // The sign of the result: -1 for a negative x to an odd power.
  const s = (n | (yisint - 1)) === 0 ? -1 : 1;
  // log2(|x|) as t1 + t2, t1 with its low word cleared.
  let t1, t2;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    // |1 - x| <= 2^-20: log(x) by x - x²/2 + x³/3 - x⁴/4.
    const t = ax - 1;
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = IVLN2_H * t, v = t * IVLN2_L - w * IVLN2;
    t1 = clearLo(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) { ax *= TWO53; n -= 53; ix = hiOf(ax); }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    // |x| scaled to [1, 2), and taken about 1 below √(3/2) and about 1.5 below √3; above,
    // halved and taken about 1 with n one more.
    let k;
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else { k = 0; n += 1; ix -= 0x00100000; }
    ax = withHi(ax, ix);
    // ss = s_h + s_l = (x - 1)/(x + 1) or (x - 1.5)/(x + 1.5).
    let u = ax - BP[k];
    let v = 1 / (ax + BP[k]);
    const ss = u * v;
    const s_h = clearLo(ss);
    let t_h = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let t_l = ax - (t_h - BP[k]);
    const s_l = v * ((u - s_h * t_h) - s_h * t_l);
    // log(ax).
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = clearLo(3 + s2 + r);
    t_l = r - ((t_h - 3) - s2);
    // u + v = ss (1 + ...), times 2/(3 log 2).
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    const p_h = clearLo(u + v);
    const p_l = v - (p_h - u);
    const z_h = CP_H * p_h;
    const z_l = CP_L * p_h + p_l * CP + DP_L[k];
    // log2(ax) = n + dp_h + z_h + z_l.
    const t = n;
    t1 = clearLo(((z_h + z_l) + DP_H[k]) + t);
    t2 = z_l - (((t1 - t) - DP_H[k]) - z_h);
  }
  // y log2(x) as p_h + p_l, y split as y1 + (y - y1).
  const y1 = clearLo(y);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  F[0] = z;
  let j = W[HI];
  const i = W[LO];
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (p_l + OVT > z - p_h) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY;
    if (p_l <= z - p_h) return s * TINY * TINY;
  }
  // 2^(p_h + p_l), with n = [z + 0.5] taken out where |z| > 0.5.
  const ij = j & 0x7fffffff;
  let k = (ij >> 20) - 0x3ff;
  n = 0;
  if (ij > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  const t = clearLo(p_l + p_h);
  const u = t * POW_LN2_H;
  const v = (p_l - (t - p_h)) * POW_LN2 + t * POW_LN2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const c = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * c) / (c - 2) - (w + z * w);
  z = 1 - (r - z);
  j = (hiOf(z) + (n << 20)) | 0;
  // A subnormal result: FDLIBM's scalbn, the exponent set 54 higher and the result
  // multiplied by 2^-54, so that it is rounded once.
  if (j >> 20 <= 0) return s * (withHi(z, j + (54 << 20)) * TWO_K[-54 + 1022]);
  return s * withHi(z, j);
}

/** √(x² + y²) without overflow or underflow on the way (FDLIBM e_hypot.c). */
export function hypot(x, y) {
  let ha = hiOf(x) & 0x7fffffff, hb = hiOf(y) & 0x7fffffff;
  let a, b;
  if (hb > ha) { a = y; b = x; const j = ha; ha = hb; hb = j; } else { a = x; b = y; }
  a = withHi(a, ha);
  b = withHi(b, hb);
  if (ha - hb > 0x3c00000) return a + b;
  let k = 0;
  if (ha > 0x5f300000) {
    if (ha >= 0x7ff00000) {
      let w = a + b;
      if (((ha & 0xfffff) | loOf(a)) === 0) w = a;
      if (((hb ^ 0x7ff00000) | loOf(b)) === 0) w = b;
      return w;
    }
    // a and b scaled by 2^-600.
    ha -= 0x25800000; hb -= 0x25800000; k += 600;
    a = withHi(a, ha);
    b = withHi(b, hb);
  }
  if (hb < 0x20b00000) {
    if (hb <= 0x000fffff) {
      if ((hb | loOf(b)) === 0) return a;
      // A subnormal b, a and b scaled by 2^1022.
      const t1 = fromWords(0x7fd00000, 0);
      b *= t1;
      a *= t1;
      k -= 1022;
    } else {
      ha += 0x25800000; hb += 0x25800000; k -= 600;
      a = withHi(a, ha);
      b = withHi(b, hb);
    }
  }
  let w = a - b;
  if (w > b) {
    const t1 = fromWords(ha, 0), t2 = a - t1;
    w = Math.sqrt(t1 * t1 - (b * (-b) - t2 * (a + t1)));
  } else {
    a += a;
    const y1 = fromWords(hb, 0), y2 = b - y1;
    const t1 = fromWords(ha + 0x00100000, 0), t2 = a - t1;
    w = Math.sqrt(t1 * y1 - (w * (-w) - (t1 * y2 + t2 * b)));
  }
  return k !== 0 ? fromWords(0x3ff00000 + (k << 20), 0) * w : w;
}
