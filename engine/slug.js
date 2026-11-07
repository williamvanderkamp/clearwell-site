// Slug tests with an overdamped response: Hvorslev (1951) and Bouwer and Rice (1976).
// Both fit a straight line to the log of normalized head against time and turn its
// slope into hydraulic conductivity. Lengths in any one unit, times in any one unit;
// K comes out in that length per that time.

import { fitLine } from './numeric.js';

// Butler (1998): fit the straight line to normalized heads in these ranges.
export const HEAD_RANGE = { hvorslev: [0.15, 0.25], bouwerRice: [0.2, 0.3] };

export const TIME_S = { s: 1, min: 60, h: 3600, d: 86400 };

/**
 * Readings as normalized head H/H0, sorted by time. d is displacement from static.
 * h0 is the initial displacement; without it, the reading at time zero is used.
 */
export function normalize(t, d, h0) {
  const pairs = t.map((x, i) => [x, d[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .sort((a, b) => a[0] - b[0]);
  if (pairs.length < 3) throw new Error('Fewer than three readings have both a time and a level.');
  if (pairs[0][0] < 0) throw new Error('Times must be elapsed time since the test began, so none can be below zero.');
  let initial = h0;
  if (initial === undefined) {
    const zero = pairs.find(([x]) => x === 0);
    if (!zero) throw new Error('There is no reading at time zero. Enter the initial displacement H0.');
    initial = zero[1];
  }
  if (!initial) throw new Error('The initial displacement H0 is zero, so heads cannot be normalized.');
  return { t: pairs.map((p) => p[0]), ratio: pairs.map((p) => p[1] / initial), h0: initial };
}

/** Least-squares line through ln(H/H0) against t, using readings with lo <= H/H0 <= hi. */
export function fitWindow(t, ratio, lo, hi) {
  if (!(lo > 0)) throw new Error('The lower H/H0 of the fit window must be above zero.');
  if (!(hi > lo)) throw new Error('The upper H/H0 of the fit window must be above the lower H/H0.');
  const used = ratio.map((r, i) => (r >= lo && r <= hi ? i : -1)).filter((i) => i >= 0);
  const fmt = (x) => String(Number(x.toPrecision(3)));
  if (used.length < 2 || t[used[0]] === t[used[used.length - 1]]) {
    const fall = used.length === 0 ? 'No readings fall' : used.length === 1 ? 'Only 1 reading falls' : `Only ${used.length} readings fall`;
    throw new Error(`${fall} between H/H0 = ${fmt(lo)} and ${fmt(hi)}, and a line needs two at different times. Widen the fit window.`);
  }
  const x = used.map((i) => t[i]), y = used.map((i) => Math.log(ratio[i]));
  const { slope, intercept } = fitLine(x, y);
  if (!(slope < 0)) throw new Error('The readings in the fit window do not fall toward static with time, so no K can be found from them.');
  return { slope, intercept, used, from: x[0], to: x[x.length - 1] };
}

function checkSizes(sizes) {
  for (const [name, v] of Object.entries(sizes)) if (!(v > 0)) throw new Error(`${name} must be above zero.`);
}

/**
 * Hvorslev (1951) for a screen in a uniform aquifer far from its boundaries, in the
 * form Butler (1998) gives with anisotropy: K = rc^2 ln[a + sqrt(1 + a^2)] / (2 Le T0),
 * a = Le / (2 rw sqrt(Kz/Kr)), T0 = -1 / slope.
 */
export function hvorslev({ rc, rw, Le, anisotropy, slope }) {
  checkSizes({ 'Casing radius': rc, 'Well radius': rw, 'Screen length': Le, 'Kz/Kr': anisotropy });
  const a = Le / (2 * rw * Math.sqrt(anisotropy));
  const shape = Math.log(a + Math.sqrt(1 + a * a));
  const T0 = -1 / slope;
  return { K: (rc * rc * shape) / (2 * Le * T0), T0, shape };
}

// Bouwer and Rice (1976) Figure 3 as polynomials in x = Le/rw, as used in RSAT 0.2.2.
const poly = (c, x) => c.reduce((s, ci, i) => s + ci * x ** i, 0);
const A_FIT = [1.4720, 3.537e-2, -8.148e-5, 1.028e-7, -6.484e-11, 1.573e-14];
const B_FIT = [0.2372, 5.151e-3, -2.682e-6, -3.491e-10, 4.738e-13];
const C_FIT = [0.7920, 3.993e-2, -5.743e-5, 3.858e-8, -9.659e-12];
export const coefficients = (x) => ({ A: poly(A_FIT, x), B: poly(B_FIT, x), C: poly(C_FIT, x) });

/**
 * Bouwer and Rice (1976): K = rc^2 ln(Re/rw) / (2 Le) * (1/t) ln(y0/yt), the last term
 * being -slope. Lw is from the water table to the bottom of the screen (Bouwer and Rice
 * call it H), D the saturated thickness, as in Bouwer and Rice. With Kz/Kr other than 1,
 * rw becomes rw sqrt(Kz/Kr) in the ratios (Zlotnik 1994).
 */
export function bouwerRice({ rc, rw, Le, Lw, D, anisotropy, slope }) {
  checkSizes({
    'Casing radius': rc, 'Well radius': rw, 'Screen length': Le,
    'Water table to bottom of screen': Lw, 'Saturated thickness': D, 'Kz/Kr': anisotropy,
  });
  if (Lw < Le) throw new Error('The distance from the water table to the bottom of the screen cannot be less than the screen length. If the screen crosses the water table, enter the length of screen below it.');
  if (Lw > D * (1 + 1e-9)) throw new Error('The bottom of the screen is below the base of the aquifer: the distance from the water table to the bottom of the screen is more than the saturated thickness.');
  const r = rw * Math.sqrt(anisotropy), x = Le / r;
  const { A, B, C } = coefficients(x);
  const full = Lw >= D * (1 - 1e-9);
  let depthTerm = null, capped = false;
  if (!full) {
    depthTerm = Math.log((D - Lw) / r);
    if (depthTerm > 6) { depthTerm = 6; capped = true; }
  }
  const lnRe = 1 / (1.1 / Math.log(Lw / r) + (full ? C : A + B * depthTerm) / x);
  return { K: (rc * rc * lnRe * -slope) / (2 * Le), lnRe, full, A, B, C, x, depthTerm, capped };
}
