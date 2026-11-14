// The t distribution, for whole degrees of freedom, which is all a fit ever has.
import * as libm from './libm.js';

/**
 * P(|T| < t) for Student's t with nu degrees of freedom, as the finite series in
 * theta = atan(t / sqrt(nu)) of Abramowitz and Stegun (1964), 26.7.3 and 26.7.4.
 * Exact for whole nu: no special functions, so nothing to tune.
 */
export function tTwoSided(t, nu) {
  if (!(nu >= 1) || !Number.isInteger(nu)) return NaN;
  const a = Math.abs(t);
  if (a === Infinity) return 1;
  const th = libm.atan(a / Math.sqrt(nu)), c = libm.cos(th), c2 = c * c, s = libm.sin(th);
  if (nu % 2 === 1) {
    if (nu === 1) return (2 / Math.PI) * th;
    // cos th (1 + (2/3) cos^2 + (2*4)/(3*5) cos^4 + ... ) up to cos^(nu-2)
    let term = libm.cos(th), sum = term;
    for (let k = 2; k <= nu - 2; k += 2) { term *= c2 * k / (k + 1); sum += term; }
    return (2 / Math.PI) * (th + s * sum);
  }
  let term = 1, sum = 1;
  for (let k = 2; k <= nu - 2; k += 2) { term *= c2 * (k - 1) / k; sum += term; }
  return s * sum;
}

/** The cumulative t distribution, P(T < t). */
export const tCdf = (t, nu) => (t >= 0 ? 0.5 + tTwoSided(t, nu) / 2 : 0.5 - tTwoSided(t, nu) / 2);

/** The t value below which a share p of the distribution lies, by bisection. */
export function tQuantile(p, nu) {
  if (!(p > 0 && p < 1) || !(nu >= 1) || !Number.isInteger(nu)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, nu);
  let lo = 0, hi = 1;
  while (tCdf(hi, nu) < p) { lo = hi; hi *= 2; if (hi > 1e12) return Infinity; }
  for (let i = 0; i < 200 && hi - lo > 1e-13 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, nu) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
