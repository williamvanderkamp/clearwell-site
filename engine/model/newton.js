// MODFLOW 6's Newton-Raphson formulation (the GWF name file's NEWTON option), the parts
// beyond the standard formulation in run.js: the quadratic smoothing of saturation, the
// Newton terms of NPF (upstream-weighted horizontal conductance) and of STO, MODFLOW 6's
// Newton under-relaxation of heads below the bottom of the model (NEWTON UNDER_RELAXATION),
// and pseudo-transient continuation in steady periods. Langevin and others (2017), USGS TM
// 6-A55, chapter 2 (eq. 2-25 to 2-30), chapter 4 (upstream weighting and its smoothing) and
// chapter 5 (storage); each routine follows the MODFLOW 6 6.7.0 source, named where it is
// used (src/Model/GroundWaterFlow/gwf-npf.f90, gwf-sto.f90, gwf.f90,
// src/Solution/NumericalSolution.f90, src/Utilities/SmoothingFunctions.f90).
//
// The matrix is run.js's M = -A, with b = -rhs, A and rhs being MODFLOW 6's: a term MODFLOW 6
// adds to A is subtracted from M. d is the diagonal, oE, oS, oD the upper couplings of row n
// with n+1, n+ncol and n+ncpl, and lE, lS, lD the lower ones of those rows with n. Under
// Newton-Raphson the matrix is not symmetric, so the solver is BICGSTAB, and every column
// stays in the matrix, as MODFLOW 6 keeps it (sln_ls moves constant-head columns only for a
// symmetric matrix).

import { isClose } from './ims.js';

/**
 * The model's newton setting: absent or false for the standard formulation; true, or
 * { underRelaxation: true|false }, for MODFLOW 6's NEWTON (with UNDER_RELAXATION).
 * Returns null or { underRelaxation }.
 */
export function checkNewton(v) {
  if (v === undefined || v === null || v === false) return null;
  if (v === true) return { underRelaxation: false };
  if (typeof v === 'object' && !Array.isArray(v) && (v.underRelaxation === undefined || typeof v.underRelaxation === 'boolean')
    && Object.keys(v).every((k) => k === 'underRelaxation')) return { underRelaxation: v.underRelaxation === true };
  throw new Error('newton must be true, or { underRelaxation: true or false } (the GWF name file\'s NEWTON and its UNDER_RELAXATION).');
}

/** The saturation smoothing interval MODFLOW 6 uses with Newton (gwf-npf.f90 and gwf-sto.f90: satomega = DEM6). */
export const SATOMEGA = 1e-6;

/**
 * sQuadraticSaturation: the saturated fraction of a cell from its head, linear between
 * bottom and top except within eps of each, where quadratic pieces make its slope
 * continuous (TM 6-A55, eq. 4-5 and 4-6). With eps 0 it is the standard formulation's
 * (h - bot) / (top - bot) clipped to 0 and 1.
 */
export function quadSat(top, bot, x, eps = SATOMEGA) {
  const b = top - bot;
  if (!(b > 0)) return x < bot ? 0 : 1;
  const br = x < bot ? 0 : x > top ? 1 : (x - bot) / b;
  const av = 1 / (1 - eps), bri = 1 - br;
  if (br < eps) return av * 0.5 * (br * br) / eps;
  if (br < 1 - eps) return av * br + 0.5 * (1 - av);
  if (br < 1) return 1 - (av * 0.5 * (bri * bri)) / eps;
  return 1;
}

/** sQuadraticSaturationDerivative: d(quadSat)/dx. */
export function quadSatDerivative(top, bot, x, eps = SATOMEGA) {
  const b = top - bot;
  const br = x < bot ? 0 : x > top ? 1 : (x - bot) / b;
  const av = 1 / (1 - eps), bri = 1 - br;
  let y;
  if (br < eps) y = av * br / eps;
  else if (br < 1 - eps) y = av;
  else if (br < 1) y = av * bri / eps;
  else y = 0;
  return y / b;
}

/**
 * The Newton terms of NPF (npf_fn) for the horizontal connections: the derivative of the
 * upstream-weighted conductance sat(h_up) × condsat with the upstream head, added to the
 * row and column of the upstream cell. Vertical conductance is constant (no VARIABLECV,
 * which MODFLOW 6 does not allow with Newton), so vertical connections have none.
 */
export function npfNewtonTerms(g, ibound, x, m, b) {
  const { N, ncol, ncpl, top, bot, icelltype, csE, csS } = g;
  const { d, oE, oS, lE, lS } = m;
  const add = (n, k, csat, up, low) => {
    if (!(csat > 0)) return;
    // The upstream cell: k unless its head is below n's (ties go to k, as npf_fn has it).
    const iups = x[k] < x[n] ? n : k, idn = iups === n ? k : n;
    if (!icelltype[iups]) return;
    const consterm = -csat * (x[iups] - x[idn]);
    const derv = quadSatDerivative(top[iups], bot[iups], x[iups]);
    if (iups === n) {
      const term = consterm * derv;
      d[n] -= term; b[n] -= term * x[n];
      b[k] += term * x[n];
      if (ibound[k] > 0) low[n] += term;
    } else {
      const term = -consterm * derv;
      b[n] -= term * x[k];
      if (ibound[n] > 0) up[n] -= term;
      d[k] += term; b[k] += term * x[k];
    }
  };
  for (let n = 0; n < N; n++) {
    if (n % ncol < ncol - 1) add(n, n + 1, csE[n], oE, lE);
    if (n + ncol < N && Math.floor((n % ncpl) / ncol) < g.nrow - 1) add(n, n + ncol, csS[n], oS, lS);
  }
}

/**
 * The Newton terms of STO (sto_fn) for convertible variable-head cells in a transient
 * step: the derivative of specific storage's saturation-weighted term, and of specific yield
 * while the cell is partly saturated. rho1 and rho2 are Ss × capacity / Δt and
 * Sy × area / Δt of each cell, as sto_fc takes them.
 */
export function stoNewtonTerms(g, ibound, x, rho1Of, rho2Of, m, b, ssConfinedOnly = false) {
  const { N, top, bot, icelltype } = g;
  const { d } = m;
  for (let n = 0; n < N; n++) {
    if (ibound[n] <= 0 || !icelltype[n]) continue;
    const tp = top[n], bt = bot[n], tthk = tp - bt, h = x[n];
    const snnew = quadSat(tp, bt, h), derv = quadSatDerivative(tp, bt, h);
    const rho1 = rho1Of(n), rho2 = rho2Of(n);
    // Specific storage, unless SS_CONFINED_ONLY (iconf_ss), which has no Newton term.
    if (!ssConfinedOnly) {
      const drterm = -rho1 * derv * (h - bt) + rho1 * tthk * snnew * derv;
      d[n] -= drterm; b[n] -= drterm * h;
    }
    if (snnew < 1 && snnew > 0) {
      const rterm = -rho2 * tthk * snnew, dr2 = -rho2 * tthk * derv;
      d[n] -= dr2 + rho2;
      // rhs = rhs - rterm + drterm h + rho2 bt, summed left to right as sto_fn does (b = -rhs).
      b[n] = b[n] + rterm - dr2 * h - rho2 * bt;
    }
  }
}

/**
 * The lowest cell connected below each cell (npf preprocess_input, ibotnode): the one whose
 * bottom is the bottom of the model there, for NEWTON UNDER_RELAXATION.
 */
export function bottomNodes(g) {
  const { N, csD, bot, down } = g;
  const out = new Int32Array(N);
  for (let n = 0; n < N; n++) {
    // Down the vertical connections, past pass-through cells as DIS joins them.
    let nn = n, minbot = bot[n];
    while (down[nn] >= 0 && csD[nn] > 0 && bot[down[nn]] < minbot) { nn = down[nn]; minbot = bot[nn]; }
    out[n] = nn;
  }
  return out;
}

/**
 * NEWTON UNDER_RELAXATION (npf_nur): a convertible cell above a convertible bottom cell
 * whose new head is below the bottom of the model there is put at 0.9 of the way from its
 * last head to that bottom, and its change kept in dx as MODFLOW 6 keeps it (old − new).
 * Returns whether any cell was moved.
 */
export function newtonUnderRelax(g, ibound, ibot, x, xtemp, dx) {
  const { N, icelltype, bot } = g;
  let moved = false;
  for (let n = 0; n < N; n++) {
    // A pass-through cell (IDOMAIN -1) is a node here only to carry the chain; not in MODFLOW 6.
    if (ibound[n] < 1 || (g.pass && g.pass[n])) continue;
    const nb = ibot[n];
    if (!(icelltype[n] > 0 && icelltype[nb] > 0)) continue;
    const botm = bot[nb];
    if (x[n] < botm) {
      moved = true;
      x[n] = xtemp[n] * (1 - 0.9) + botm * 0.9;
      dx[n] = xtemp[n] - x[n];
    }
  }
  return moved;
}

/**
 * Pseudo-transient continuation (gwf_ptc and sln_ls), which MODFLOW 6 applies in the steady
 * periods of a Newton-Raphson model unless IMS NO_PTC says not to. A term 1/Δτ is added to
 * the diagonal of every variable-head cell and 1/Δτ × h to its right-hand side, which
 * vanishes once the heads stop changing. The pseudo time step starts, at each step's first
 * outer iteration, from the largest residual per cell volume (or from 1/(10 Δt) when the
 * residuals are all zero), and grows as the residual's norm falls. MODFLOW 6 keeps its state
 * from step to step, as here.
 */
export function createPtc(g, mode) {
  let l2norm0 = 0, ptcdel = 0;
  return {
    /**
     * After the formulation, before the identity rows of sln_ls: r is the residual M x - b of
     * the active rows (ims.js residual), l2norm its norm. Adds the PTC terms to m and b, as
     * sln_ls does after its identity rows; returns whether it did.
     */
    apply({ kiter, kper, kstp, delt, ibound, x, m, b, r, l2norm }) {
      if (mode === 'none' || (mode === 'after-first' && kper === 0)) return false;
      // gwf_ptc: the reciprocal of the pseudo time step from each cell's residual over its volume.
      let ptcf = 0;
      for (let n = 0; n < g.N; n++) {
        if (ibound[n] < 1 || (g.pass && g.pass[n])) continue;
        const v = g.area[n] * (g.top[n] - g.bot[n]);
        const p = Math.abs(r[n]) / v;
        if (p > ptcf) ptcf = p;
      }
      if (ptcf === 0) ptcf = 1 / (delt * 10);
      // sln_ls: no PTC when the residual did not grow since the last time (from the second
      // step on), or is the same as the last outer iteration's.
      if (kiter === 1) {
        if ((kper > 0 || kstp > 0) && l2norm <= l2norm0) return false;
      } else if (isClose(l2norm, l2norm0)) return false;
      if (kiter === 1) ptcdel = 1 / ptcf;
      else ptcdel = l2norm > 0 ? ptcdel * (l2norm0 / l2norm) : 0;
      const ptcval = ptcdel > 0 ? 1 / ptcdel : 1;
      for (let n = 0; n < g.N; n++) {
        if (ibound[n] < 1) continue;
        m.d[n] += ptcval;
        b[n] += ptcval * x[n];
      }
      l2norm0 = l2norm;
      return true;
    },
  };
}
