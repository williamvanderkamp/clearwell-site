// The Butler and Zhan (2004) model for slug tests in highly permeable aquifers: the
// KGS model of a partially penetrating well in a confined aquifer, with the inertia of
// the water column in the well (Kipp 1985) and, optionally, friction in the well. The
// Laplace-space solution is equation (49) of Zhan and Butler (2003, KGS Open-File
// Report 2003-60); its response oscillates, which the Stehfest method cannot invert,
// so the inversion here is that of de Hoog, Knight and Stokes (1982), a Fourier-series
// method of the family Zhan and Butler (2003, section X) used.
// Metres and seconds throughout.

import { checkPositive, checkScreen, G } from './slug-models.js';
import { cadd, cdiv, cmul, cscale, csqrt, cx, invertOscillating, oscillatingGroups, ratioK } from './laplace.js';
import * as libm from './libm.js';

// The modes summed exactly at each p (up to n1), and once, linearly in p (up to n2).
function modeCounts({ beta, psi }, pMax) {
  const n1 = Math.min(100000, Math.max(16, Math.ceil(Math.sqrt(100 * pMax) / psi / (Math.PI / beta))));
  return { n1, n2: Math.max(8 * n1, Math.ceil(40 * beta), 4000) };
}

// Omega_w(p) of Zhan and Butler (2003, eqs. 48 and 50), the KGS sum of vertical modes,
// for complex p. Modes up to n1 exactly; beyond, f1 is nearly linear in p, so those are
// summed once at p = 0 and a small real p, as in slug-models.js.
function omegaW(m, pMax) {
  const { beta, zeta, psi } = m;
  const weight = (n) => {
    if (n === 0) return 1 / beta;
    const s = libm.sin(n * Math.PI / (2 * beta)), c = libm.cos(n * Math.PI * (1 + 2 * zeta) / (2 * beta));
    return (8 * beta / (Math.PI * Math.PI)) * (s * s * c * c) / (n * n);
  };
  const real = (w, p) => { const v = Math.sqrt(psi * psi * w * w + p); return ratioK(cx(v)).re / v; };
  const { n1, n2 } = modeCounts(m, pMax);
  const pRef = Math.max(pMax, 1e-9) * 1e-3;
  let A0 = 0, A1 = 0;
  for (let n = n1 + 1; n <= n2; n++) {
    const c = weight(n);
    if (c === 0) continue;
    const w = (n * Math.PI) / beta, f0 = real(w, 0);
    A0 += c * f0;
    A1 += c * (real(w, pRef) - f0) / pRef;
  }
  const far = (8 * beta / (Math.PI * Math.PI)) * 0.25 * (beta / (psi * Math.PI)) / (2 * n2 * n2);
  const modes = [];
  for (let n = 0; n <= n1; n++) modes.push([(n * Math.PI) / beta, weight(n)]);
  return (p) => {
    let sum = cx(A0 + A1 * p.re + far, A1 * p.im);
    for (const [w, c] of modes) {
      if (c === 0) continue;
      const v = csqrt(cadd(cx(psi * psi * w * w), p));
      sum = cadd(sum, cscale(cdiv(ratioK(v), v), c));
    }
    return sum;
  };
}

/**
 * Dimensionless groups of Zhan and Butler (2003, eqs. 18-24). p: { Kr, Ss, Le };
 * g: { rc, rw, b, d, B, anisotropy, nu, l }. nu (kinematic viscosity, m²/s) and l (the
 * water column above the screen, m) give the friction term Fl; without them Fl = 0.
 */
export function bzGroups({ Kr, Ss, Le }, { rc, rw, b, d, B, anisotropy, nu, l, g = G }) {
  checkPositive({
    'Hydraulic conductivity': Kr, 'Specific storage': Ss, 'Effective water column length': Le,
    'Casing radius': rc, 'Well radius': rw, 'Screen length': b, 'Aquifer thickness': B, 'Kz/Kr': anisotropy,
  });
  checkScreen(d, b, B);
  const friction = nu > 0 && l >= 0;
  const L = friction ? l + 2 * b * libm.pow(rc / rw, 4) : 0;
  return {
    alpha: (rc * rc) / (2 * rw * rw * b * Ss),
    beta2: (4 * Le * b * b * Kr * Kr) / (g * libm.pow(rc, 4)),
    Fl: friction ? (16 * b * nu * L * Kr) / (g * libm.pow(rc, 4)) : 0,
    L,
    psi: (Math.sqrt(anisotropy) * rw) / b,
    beta: B / b,
    zeta: d / b,
    tau: Kr / (rw * rw * Ss),   // tau per second
  };
}

// What bzHead needs before it sums any modes; null when no time is above zero.
function bzPlan(t, p, g) {
  const m = bzGroups(p, g);
  const pos = t.filter((s) => s > 0);
  if (!pos.length) return null;
  const taus = pos.map((s) => s * m.tau);
  // The natural frequency of the water column, sqrt(g/Le) in real time, in tau.
  const omega = Math.sqrt((g.g || G) / p.Le) / m.tau;
  // The largest Laplace variable the inversion uses, at the earliest group.
  const T0 = 3 * Math.min(...taus);
  const M0 = Math.min(120, 16 + Math.ceil((4 * T0 * omega) / (2 * Math.PI)));
  const pMax = libm.hypot(-libm.log(1e-12) / (2 * T0), (2 * M0 * Math.PI) / T0);
  return { m, taus, omega, pMax };
}

/**
 * The work bzHead(t, p, g) will do, in terms of the modes it sums: n1 + 1 at each value
 * of the transform, and the n2 - n1 summed once. Found without summing any.
 */
export function bzWork(t, p, g) {
  const plan = bzPlan(t, p, g);
  if (!plan) return 0;
  const { n1, n2 } = modeCounts(plan.m, plan.pMax);
  const values = oscillatingGroups(plan.taus, plan.omega).reduce((sum, { M }) => sum + 2 * M + 1, 0);
  return (n1 + 1) * values + 2 * (n2 - n1);
}

/**
 * H/H0 at times t (s) by Butler and Zhan (2004): equation (49) of Zhan and Butler
 * (2003) for a slug test (q = 0, Phi0 = 1, and no initial velocity of the water level):
 * Phi(p) = (a Fl + a^2 b p + a Ow) / (1 + a p Fl + a^2 b p^2 + a p Ow), a = alpha,
 * b = beta, Ow = Omega_w(p), in tau = t Kr / (rw^2 Ss).
 */
export function bzHead(t, p, g) {
  const plan = bzPlan(t, p, g);
  if (!plan) return t.map(() => 1);
  const { m, taus, omega, pMax } = plan;
  const ow = omegaW(m, pMax);
  const { alpha: a, beta2: b, Fl } = m;
  const F = (s) => {
    const o = ow(s);
    const num = cadd(cx(a * Fl), cadd(cscale(s, a * a * b), cscale(o, a)));
    const den = cadd(cadd(cx(1), cscale(s, a * Fl)), cadd(cscale(cmul(s, s), a * a * b), cscale(cmul(s, o), a)));
    return cdiv(num, den);
  };
  const heads = invertOscillating(F, taus, omega);
  let j = 0;
  return t.map((s) => (s > 0 ? heads[j++] : 1));
}
