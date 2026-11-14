// MODFLOW 6's iterative model solution (IMS): the outer-iteration under-relaxation (SIMPLE,
// COOLEY, DBD) and backtracking, the settings each COMPLEXITY gives, and the linear solvers
// on the sparse (CSR) matrix as MODFLOW 6 holds it: CG and BICGSTAB with ILU(0), MILU(0),
// ILUT or MILUT preconditioning and residual re-orthogonalization. Every routine follows the
// MODFLOW 6 6.7.0 source (src/Solution/NumericalSolution.f90,
// src/Solution/LinearMethods/ImsLinear.f90, ImsLinearBase.f90, ImsLinearSettings.f90 and
// src/Utilities/Libraries/sparskit2/ilut.f90, at tag 6.7.0 of
// https://github.com/MODFLOW-ORG/modflow6), named where it is used, and the input guide
// (doc/mf6io/mf6ivar/dfn/sln-ims.dfn and doc/mf6io/ims_table.tex at that tag).
//
// The matrix is held as run.js holds it, M = -A, A being MODFLOW 6's coefficient matrix:
// d the diagonal, oE, oS, oD the couplings of row n with n+1, n+ncol and n+ncpl (upper),
// and lE, lS, lD those of rows n+1, n+ncol and n+ncpl with n (lower), both indexed by the
// lower node n. Negating A and its right-hand side changes no iterate of CG or BICGSTAB
// and no preconditioner but its sign, so every iterate is MODFLOW 6's.
//
// Pure JavaScript with no DOM.

// The MILU(0) relaxation of a model that does not give one (solver.relax), written to the
// MODFLOW 6 files as RELAXATION_FACTOR so that MODFLOW 6 runs the same preconditioner. The
// IMS input guide says values near 1 are common and 0.97 often works best; it is what IMS
// COMPLEXITY MODERATE uses, and 0 (SIMPLE's) gives plain ILU(0), which takes more iterations.
// Any value gives the same converged answer, but not the same iterates, and a run stops a
// little short of the converged answer, so heads agree with MODFLOW 6's to rounding only
// when both use the same value.
export const RELAX = 0.97;

const DPREC = Number.EPSILON;           // Constants.f90: DPREC = EPSILON(1.0_DP)
const DSAME = 100 * DPREC;              // Constants.f90: DSAME = DHUNDRED * DPREC

/** MathUtil.f90 is_close with its defaults: |a - b| <= DSAME max(|a|, |b|). */
export const isClose = (a, b) => a === b || Math.abs(a - b) <= DSAME * Math.max(Math.abs(a), Math.abs(b));

// Fortran SIGN(a, b): |a| with the sign of b.
const sign = (a, b) => (b < 0 || Object.is(b, -0) ? -Math.abs(a) : Math.abs(a));

/**
 * The solver settings MODFLOW 6 6.7.0 gives each COMPLEXITY, in the solver JSON of
 * docs/design/model.md: sln_setouter (the nonlinear block) and ImsLinearSettings
 * preset_config (the linear block), the same values as the input guide's table "IMS
 * variable values for the available complexity options" (ims_table.tex). SIMPLE is also
 * what MODFLOW 6 uses when the IMS file gives no COMPLEXITY.
 */
export const COMPLEXITY = {
  SIMPLE: { outer: 25, inner: 50, hclose: 0.001, rclose: 0.1, linear: 'cg', relax: 0, levels: 0, dropTolerance: 0, orthogonalizations: 0 },
  MODERATE: {
    outer: 50, inner: 100, hclose: 0.01, rclose: 0.1, linear: 'bicgstab', relax: 0.97, levels: 0, dropTolerance: 0, orthogonalizations: 0,
    underRelaxation: { method: 'dbd', theta: 0.9, kappa: 0.0001, gamma: 0, momentum: 0 },
  },
  COMPLEX: {
    outer: 100, inner: 500, hclose: 0.1, rclose: 0.1, linear: 'bicgstab', relax: 0, levels: 5, dropTolerance: 0.0001, orthogonalizations: 2,
    underRelaxation: { method: 'dbd', theta: 0.8, kappa: 0.0001, gamma: 0, momentum: 0 },
    backtracking: { number: 20, tolerance: 1.05, reductionFactor: 0.1, residualLimit: 0.002 },
  },
};

/**
 * What MODFLOW 6 6.7.0 takes for a nonlinear value the IMS file leaves out, by COMPLEXITY
 * (sln_setouter). These are the code's values: for SIMPLE, UNDER_RELAXATION_GAMMA is 1.0 in
 * the code, though the input guide's table prints 0.0; the code is what runs, and only
 * matters when a file asks for SIMPLE or COOLEY under-relaxation and gives no gamma.
 */
export const OUTER_DEFAULTS = {
  SIMPLE: { theta: 1, kappa: 0, gamma: 1, momentum: 0, number: 0, tolerance: 0, reductionFactor: 0, residualLimit: 0 },
  MODERATE: { theta: 0.9, kappa: 0.0001, gamma: 0, momentum: 0, number: 0, tolerance: 0, reductionFactor: 0, residualLimit: 0 },
  COMPLEX: { theta: 0.8, kappa: 0.0001, gamma: 0, momentum: 0, number: 20, tolerance: 1.05, reductionFactor: 0.1, residualLimit: 0.002 },
};

/** A deep copy of the solver settings of a COMPLEXITY (SIMPLE, MODERATE or COMPLEX). */
export function complexitySolver(name) {
  const p = COMPLEXITY[String(name).toUpperCase()];
  if (!p) throw new Error(`COMPLEXITY ${name} is not one of SIMPLE, MODERATE or COMPLEX.`);
  return JSON.parse(JSON.stringify(p));
}

const UR_PARAMS = { simple: ['gamma'], cooley: ['gamma'], dbd: ['theta', 'kappa', 'gamma', 'momentum'] };

/**
 * Check the settings beyond outer, inner, hclose and rclose (run.js checks those), and
 * return them in the form the solver uses. Each must be given in full when used: the
 * model JSON has no fill-in values, and fromMf6 fills a file's gaps from its COMPLEXITY as
 * MODFLOW 6 does, saying so.
 */
export function checkImsSettings(s, { newton = false } = {}) {
  const num = (v, what, lo = 0) => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= lo)) throw new Error(`${what} must be a number of at least ${lo}.`);
    return v;
  };
  const out = { linear: 'cg', levels: 0, dropTolerance: 0, orthogonalizations: 0, ur: null, bt: null, ptc: 'all' };
  if (s.linear !== undefined) {
    if (s.linear !== 'cg' && s.linear !== 'bicgstab') throw new Error('solver.linear (IMS LINEAR_ACCELERATION) must be "cg" or "bicgstab".');
    out.linear = s.linear;
  }
  if (newton && out.linear === 'cg') {
    // NumericalSolution.f90 sln_ar refuses the same: "PRODUCES AN ASYMMETRIC COEFFICIENT
    // MATRIX, BUT THE CONJUGATE GRADIENT METHOD WAS SELECTED. USE BICGSTAB INSTEAD."
    throw new Error('The Newton-Raphson formulation makes the matrix nonsymmetric, and the conjugate gradient method (solver.linear "cg") needs a symmetric one. Use "bicgstab", as MODFLOW 6 asks.');
  }
  if (s.levels !== undefined) {
    if (!Number.isInteger(s.levels) || s.levels < 0) throw new Error('solver.levels (IMS PRECONDITIONER_LEVELS) must be a whole number of at least 0.');
    out.levels = s.levels;
  }
  if (s.dropTolerance !== undefined) out.dropTolerance = num(s.dropTolerance, 'solver.dropTolerance (IMS PRECONDITIONER_DROP_TOLERANCE)');
  if (s.orthogonalizations !== undefined) {
    if (!Number.isInteger(s.orthogonalizations) || s.orthogonalizations < 0) throw new Error('solver.orthogonalizations (IMS NUMBER_ORTHOGONALIZATIONS) must be a whole number of at least 0.');
    out.orthogonalizations = s.orthogonalizations;
  }
  const ur = s.underRelaxation;
  if (ur !== undefined && ur !== null) {
    if (typeof ur !== 'object' || !UR_PARAMS[ur.method]) throw new Error('solver.underRelaxation needs method "simple", "cooley" or "dbd" (IMS UNDER_RELAXATION), with its values.');
    const names = { theta: 'UNDER_RELAXATION_THETA', kappa: 'UNDER_RELAXATION_KAPPA', gamma: 'UNDER_RELAXATION_GAMMA', momentum: 'UNDER_RELAXATION_MOMENTUM' };
    out.ur = { method: ur.method, theta: 1, kappa: 0, gamma: 1, momentum: 0 };
    for (const k of UR_PARAMS[ur.method]) {
      if (ur[k] === undefined) throw new Error(`solver.underRelaxation.${k} (IMS ${names[k]}) is needed for ${ur.method.toUpperCase()} under-relaxation.`);
      out.ur[k] = num(ur[k], `solver.underRelaxation.${k} (IMS ${names[k]})`);
    }
    // sln_ar: "if (THIS%theta < DEM3) this%theta = DEM3"; and SIMPLE needs gamma above zero.
    if (out.ur.theta < 1e-3) out.ur.theta = 1e-3;
    if (ur.method === 'simple' && out.ur.gamma === 0) throw new Error('solver.underRelaxation.gamma must be above zero for SIMPLE under-relaxation, as MODFLOW 6 requires.');
  }
  const bt = s.backtracking;
  if (bt !== undefined && bt !== null) {
    if (typeof bt !== 'object') throw new Error('solver.backtracking needs number, tolerance, reductionFactor and residualLimit (IMS BACKTRACKING_*).');
    if (!Number.isInteger(bt.number) || bt.number < 0) throw new Error('solver.backtracking.number (IMS BACKTRACKING_NUMBER) must be a whole number of at least 0.');
    const names = { tolerance: 'BACKTRACKING_TOLERANCE', reductionFactor: 'BACKTRACKING_REDUCTION_FACTOR', residualLimit: 'BACKTRACKING_RESIDUAL_LIMIT' };
    out.bt = { number: bt.number };
    for (const k of ['tolerance', 'reductionFactor', 'residualLimit']) {
      if (bt[k] === undefined) throw new Error(`solver.backtracking.${k} (IMS ${names[k]}) is needed with backtracking.`);
      out.bt[k] = num(bt[k], `solver.backtracking.${k} (IMS ${names[k]})`);
    }
    if (bt.number === 0) out.bt = null;
  }
  if (s.noPtc !== undefined) {
    if (s.noPtc !== 'all' && s.noPtc !== 'first') throw new Error('solver.noPtc (IMS NO_PTC) must be "all" or "first".');
    out.ptc = s.noPtc === 'all' ? 'none' : 'after-first';
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Outer iterations: under-relaxation and backtracking (NumericalSolution.f90)

/**
 * The state MODFLOW 6 keeps between outer iterations, and between time steps, for the
 * under-relaxation and backtracking of one model: the delta-bar-delta weights, Cooley's
 * history, the last head changes and the last residual norm.
 */
export function createOuter(N, settings) {
  const ur = settings.ur, bt = settings.bt;
  // Allocated once and never reset between steps, as MODFLOW 6's wsave, hchold, deold and
  // dxold are (sln_ar zeroes them; sln_underrelax sets them only for active cells).
  const dxold = new Float64Array(N);
  const wsave = ur && ur.method === 'dbd' ? new Float64Array(N) : null;
  const hchold = wsave ? new Float64Array(N) : null, deold = wsave ? new Float64Array(N) : null;
  let relaxold = 0, bigchold = 0, resPrev = 0;

  return {
    dxold,
    backtracking: bt,

    /**
     * After an outer iteration that did not converge (sln_underrelax, or sln_calcdx when
     * there is no under-relaxation): x is the linear solve's result, xtemp the heads before
     * it, bigch the signed largest change; x is relaxed in place for active cells.
     */
    relax(kiter, bigch, active, x, xtemp) {
      if (!ur) {
        for (let n = 0; n < N; n++) dxold[n] = active[n] < 1 ? 0 : x[n] - xtemp[n];
        return;
      }
      if (ur.method === 'simple') {
        for (let n = 0; n < N; n++) {
          if (active[n] < 1) continue;
          const delx = x[n] - xtemp[n];
          dxold[n] = delx;
          x[n] = xtemp[n] + ur.gamma * delx;
        }
      } else if (ur.method === 'cooley') {
        let relax;
        if (kiter === 1) { relax = 1; relaxold = 1; bigchold = bigch; } else {
          const es = bigch / (bigchold * relaxold), aes = Math.abs(es);
          relax = es < -1 ? 0.5 / aes : (3 + es) / (3 + aes);
        }
        relaxold = relax;
        bigchold = (1 - ur.gamma) * bigch + ur.gamma * bigchold;
        if (relax < 1) {
          for (let n = 0; n < N; n++) {
            if (active[n] < 1) continue;
            const delx = x[n] - xtemp[n];
            dxold[n] = delx;
            x[n] = xtemp[n] + relax * delx;
          }
        }
      } else {
        for (let n = 0; n < N; n++) {
          if (active[n] < 1) continue;
          let delx = x[n] - xtemp[n];
          if (kiter === 1) { wsave[n] = 1; hchold[n] = 1e-20; deold[n] = 0; }
          // Delta-bar-delta: the weight falls by theta when the change flips sign and grows
          // by kappa when it keeps it, up to 1.
          let ww = deold[n] * delx < 0 ? ur.theta * wsave[n] : wsave[n] + ur.kappa;
          if (ww > 1) ww = 1;
          wsave[n] = ww;
          hchold[n] = kiter === 1 ? delx : (1 - ur.gamma) * delx + ur.gamma * hchold[n];
          deold[n] = delx;
          dxold[n] = delx;
          const amom = kiter > 4 ? ur.momentum : 0;
          delx = delx * ww + amom * hchold[n];
          x[n] = xtemp[n] + delx;
        }
      }
    },

    /**
     * sln_backtracking, before the outer iteration's own formulation: rebuild(), with the
     * standard terms only, then the residual norm, and if it grew by more than the
     * tolerance, pull the heads back toward xtemp by the reduction factor until it does
     * not, at most number times. Returns { flag, count, resIn, resOut } as MODFLOW 6 prints
     * them: flag 4 when the change is already below hclose, 2 when the limit was reached,
     * 1 when the residual fell back under the tolerance.
     */
    backtrack(kiter, { rebuild, norm, active, x, xtemp, dvclose }) {
      rebuild();
      let flag = 0, count = 0, resNew = 0;
      const resIn = norm();
      if (kiter === 1) { resPrev = resIn; return { flag, count, resIn, resOut: resPrev }; }
      resNew = resIn;
      if (resNew > resPrev * bt.tolerance) {
        for (let nb = 1; nb <= bt.number; nb++) {
          // get_backtracking_flag: only while the reduced change is at least dvclose.
          let dxmax = 0;
          for (let n = 0; n < N; n++) if (active[n] >= 1) dxmax = Math.max(dxmax, Math.abs(x[n] - xtemp[n]));
          if (!(bt.reductionFactor * dxmax >= dvclose)) { flag = 4; break; }
          for (let n = 0; n < N; n++) if (active[n] >= 1) x[n] = xtemp[n] + bt.reductionFactor * (x[n] - xtemp[n]);
          count = nb;
          rebuild();
          resNew = norm();
          if (nb === bt.number) { flag = 2; break; }
          if (resNew < resPrev * bt.tolerance) { flag = 1; break; }
          if (resNew < bt.residualLimit) break;
        }
      }
      resPrev = resNew;
      return { flag, count, resIn, resOut: resPrev };
    },
  };
}

/**
 * sln_maxval: the value of v largest in size, with its sign, found as MODFLOW 6 finds it
 * (each value against the largest so far, normalized by it).
 */
export function maxval(v) {
  let vmax = v[0];
  for (let n = 1; n < v.length; n++) {
    const denom = Math.abs(vmax) === 0 ? DPREC : Math.abs(vmax);
    if (Math.abs(v[n]) / denom > 1) vmax = v[n];
  }
  return vmax;
}

// ---------------------------------------------------------------------------------------
// Linear solvers on a CSR matrix (ImsLinear.f90 imslinear_ap, ImsLinearBase.f90)

/**
 * A linear solver on the matrix of a regular grid held in CSR form as MODFLOW 6 holds it:
 * each row's diagonal first, then its connections by ascending column. The pattern is the
 * grid's connections, hasE, hasS and hasD giving whether the east, south and down connections
 * of n exist (as DIS makes them: both cells active); a structural entry may hold zero. The down
 * connection of n is with g.down[n], the cell below past any pass-through cells (n + ncpl when
 * there are none), whose couplings oD[n] and lD[n] hold, as MODFLOW 6 joins the two directly.
 * Returns { solve, residual }.
 */
export function createLinear(g, hasE, hasS, hasD, settings) {
  const { N, ncol, ncpl } = g;
  const dn = (n) => (g.down ? g.down[n] : n + ncpl), up = (m) => (g.above ? g.above[m] : m - ncpl);
  // Pattern and, for each entry, where its value comes from: 0 the diagonal, 1..3 the
  // upper arrays oE, oS, oD of node n, 4..6 the lower arrays lE, lS, lD of the node below.
  const ia = new Int32Array(N + 1), jaList = [], srcList = [], idxList = [];
  for (let n = 0; n < N; n++) {
    ia[n] = jaList.length;
    jaList.push(n); srcList.push(0); idxList.push(n);
    const u = up(n);
    if (u >= 0 && hasD(u)) { jaList.push(u); srcList.push(6); idxList.push(u); }
    if (n - ncol >= 0 && hasS(n - ncol)) { jaList.push(n - ncol); srcList.push(5); idxList.push(n - ncol); }
    if (n - 1 >= 0 && hasE(n - 1)) { jaList.push(n - 1); srcList.push(4); idxList.push(n - 1); }
    if (n + 1 < N && hasE(n)) { jaList.push(n + 1); srcList.push(1); idxList.push(n); }
    if (n + ncol < N && hasS(n)) { jaList.push(n + ncol); srcList.push(2); idxList.push(n); }
    if (dn(n) >= 0 && dn(n) < N && hasD(n)) { jaList.push(dn(n)); srcList.push(3); idxList.push(n); }
  }
  ia[N] = jaList.length;
  const nja = jaList.length;
  const ja = Int32Array.from(jaList), src = Uint8Array.from(srcList), idx = Int32Array.from(idxList);
  const a = new Float64Array(nja);
  // The position of each row's first entry above the diagonal (ims_base_pccrs JAPC(n)).
  const iu = new Int32Array(N);
  for (let n = 0; n < N; n++) {
    iu[n] = ia[n + 1];
    for (let j = ia[n] + 1; j < ia[n + 1]; j++) if (ja[j] > n) { iu[n] = j; break; }
  }
  const ipc = (settings.levels > 0 ? 3 : 1) + (settings.relax > 0 ? 1 : 0);
  // The ILU(0) or MILU(0) factorizations that stopped at a pivot that changed sign or was zero.
  let pivotFailures = 0;
  const pc = ipc <= 2 ? ilu0(N, ia, ja, iu, nja) : ilut(N, ia, ja, settings.levels, settings.dropTolerance);
  const v = (len) => new Float64Array(len);
  const D = v(N), P = v(N), Q = v(N), Z = v(N), T = v(N), V = v(N), DHAT = v(N), PHAT = v(N), QHAT = v(N), W = v(N);

  function fill(m) {
    const arrs = [m.d, m.oE, m.oS, m.oD, m.lE, m.lS, m.lD];
    for (let j = 0; j < nja; j++) a[j] = arrs[src[j]][idx[j]];
  }
  // SPARSKIT amux: y = A x, row by row in storage order.
  function amux(x, y) {
    for (let i = 0; i < N; i++) {
      let t = 0;
      for (let k = ia[i]; k < ia[i + 1]; k++) t += a[k] * x[ja[k]];
      y[i] = t;
    }
  }
  function residualInto(x, b) {   // ims_base_residual: D = b - A x
    amux(x, D);
    for (let n = 0; n < N; n++) D[n] = b[n] - D[n];
  }
  const dot = (u, w) => { let s = 0; for (let n = 0; n < N; n++) s += u[n] * w[n]; return s; };

  /**
   * The residual M x - b of the active rows (rows of inactive and constant-head cells give
   * zero), into r, and its 2-norm: sln_calc_residual and sln_l2norm, which multiply the
   * solution's CSR matrix row by row in storage order (SparseMatrix spm_multiply), take away
   * the right-hand side (axpy) and sum the squares in node order (SeqVector norm2), so that
   * the norm, and the PTC and backtracking that use it, round as MODFLOW 6's do. With the
   * signs of M = -A, r is the negative of MODFLOW 6's, to the last bit.
   */
  function residual(m, b, x, active, r) {
    fill(m);
    let s = 0;
    for (let i = 0; i < N; i++) {
      let t = 0;
      for (let k = ia[i]; k < ia[i + 1]; k++) t += a[k] * x[ja[k]];
      r[i] = active[i] < 1 ? 0 : t - b[i];
      s += r[i] * r[i];
    }
    return Math.sqrt(s);
  }

  // Whether every residual is no larger than the rounding error of computing it: 16 machine
  // epsilons of the sum of the sizes of the row's terms (b and each coefficient times its
  // head). MODFLOW 6 takes no iteration only when the residual is exactly zero; its sums run
  // in another order (the CHD columns, say, are moved to the right-hand side here), so a
  // system it finds exactly solved can leave rounding noise here, and iterating on that
  // noise moves heads by about 10⁻¹⁴ m and makes flows of rounding size, whose budget
  // discrepancy is meaningless (for one, 200 % on a model with no flow). A residual this
  // small is zero to the precision of the arithmetic, so it is taken as one.
  function atRounding(x, b) {
    for (let i = 0; i < N; i++) {
      let s = Math.abs(b[i]);
      for (let k = ia[i]; k < ia[i + 1]; k++) s += Math.abs(a[k] * x[ja[k]]);
      if (Math.abs(D[i]) > 16 * Number.EPSILON * s) return false;
    }
    return true;
  }

  // ims_base_testcnvg with ICNVGOPT 0 (and 1, STRICT): 1 converged, -1 stop unconverged.
  const testcnvg = (strict, it, dvmax, rmax, dvclose, rclose) => {
    if (Math.abs(dvmax) <= dvclose && Math.abs(rmax) <= rclose) return strict && it !== 1 ? -1 : 1;
    return 0;
  };

  /**
   * Solve M x = b in place from x, as imslinear_ap does: update the preconditioner, take
   * the starting residual (no iteration when it is zero, or at rounding), then CG
   * (ims_base_cg) or BICGSTAB (ims_base_bcgs). Returns { converged, iterations, rmax, dvmax }.
   */
  function solve(m, b, x, { inner, dvclose, rclose, strict = false }) {
    fill(m);
    pc.update(a, settings.relax);
    residualInto(x, b);
    let l2 = 0;
    for (let n = 0; n < N; n++) l2 += D[n] * D[n];
    if (l2 === 0 || atRounding(x, b)) return { converged: true, iterations: 0, rmax: Math.sqrt(l2), dvmax: 0 };
    return settings.linear === 'cg' ? cg(b, x, inner, dvclose, rclose, strict) : bcgs(b, x, inner, dvclose, rclose, strict);
  }

  function cg(b, x, itmax, dvclose, rclose, strict) {
    let rho0 = 0, rho = 0, icnvg = 0, deltax = 0, rmax = 0, it = 0;
    const north = settings.orthogonalizations;
    for (let iiter = 1; iiter <= itmax; iiter++) {
      it = iiter;
      pc.apply(D, Z);
      rho = dot(D, Z);
      if (iiter === 1) P.set(Z);
      else { const beta = rho / rho0; for (let n = 0; n < N; n++) P[n] = Z[n] + beta * P[n]; }
      amux(P, Q);
      let den = dot(P, Q);
      den += sign(DPREC, den);
      const alpha = rho / den;
      deltax = 0; rmax = 0;
      for (let n = 0; n < N; n++) {
        let tv = alpha * P[n];
        x[n] += tv;
        if (Math.abs(tv) > Math.abs(deltax)) deltax = tv;
        tv = D[n] - alpha * Q[n];
        D[n] = tv;
        if (Math.abs(tv) > Math.abs(rmax)) rmax = tv;
      }
      icnvg = testcnvg(strict, iiter, deltax, rmax, dvclose, rclose);
      if (rmax === 0) icnvg = 1;
      if (icnvg !== 0) break;
      if (isClose(rho, rho0)) break;
      if (north > 0 && (iiter + 1) % north === 0) residualInto(x, b);
      if (rho === 0) break;
      rho0 = rho;
    }
    return { converged: icnvg === 1, iterations: it, rmax: Math.abs(rmax), dvmax: Math.abs(deltax) };
  }

  function bcgs(b, x, itmax, dvclose, rclose, strict) {
    let alpha = 0, alpha0 = 0, rho = 0, rho0 = 0, omega = 0, omega0 = 0, icnvg = 0, deltax = 0, rmax = 0, it = 0;
    const north = settings.orthogonalizations;
    DHAT.set(D);
    for (let iiter = 1; iiter <= itmax; iiter++) {
      it = iiter;
      rho = dot(DHAT, D);
      if (iiter === 1) P.set(D);
      else {
        const beta = (rho / rho0) * (alpha0 / omega0);
        for (let n = 0; n < N; n++) P[n] = D[n] + beta * (P[n] - omega0 * V[n]);
      }
      pc.apply(P, PHAT);
      amux(PHAT, V);
      let den = dot(DHAT, V);
      den += sign(DPREC, den);
      alpha = rho / den;
      for (let n = 0; n < N; n++) Q[n] = D[n] - alpha * V[n];
      pc.apply(Q, QHAT);
      amux(QHAT, T);
      const num = dot(T, Q);
      den = dot(T, T);
      den += sign(DPREC, den);
      omega = num / den;
      deltax = 0; rmax = 0;
      for (let n = 0; n < N; n++) {
        let tv = alpha * PHAT[n] + omega * QHAT[n];
        x[n] += tv;
        if (Math.abs(tv) > Math.abs(deltax)) deltax = tv;
        tv = Q[n] - omega * T[n];
        D[n] = tv;
        if (Math.abs(tv) > Math.abs(rmax)) rmax = tv;
      }
      icnvg = testcnvg(strict, iiter, deltax, rmax, dvclose, rclose);
      if (rmax === 0) icnvg = 1;
      if (icnvg !== 0) break;
      if (isClose(rho, rho0) || isClose(alpha, alpha0) || isClose(omega, omega0)) break;
      if (north > 0 && (iiter + 1) % north === 0) residualInto(x, b);
      if (rho * omega === 0) break;
      rho0 = rho; alpha0 = alpha; omega0 = omega;
    }
    return { converged: icnvg === 1, iterations: it, rmax: Math.abs(rmax), dvmax: Math.abs(deltax) };
  }

  // ILU(0) and MILU(0): ims_base_pcilu0 and ims_base_ilu0a, the factor kept in the matrix's
  // own pattern (inv the inverse pivots, lu the off-diagonal entries).
  //
  // A pivot that changes sign or is zero: ims_base_pcilu0 sets IPCFLAG = 1 and leaves its
  // MAIN loop, but the statement after the loop sets IPCFLAG = 0 whatever happened, so
  // ims_base_pcu never restarts with a shifted diagonal (DELTA stays 0) and writes no "ADDED
  // SMALL VALUE TO PIVOT". The factor is left as it stands: the rows before the failing one
  // are the new factor, and that row and every row after it keep the previous
  // factorization's values, which are zeros before the first (APC is zeroed once, in
  // imslinear_allocate, and never again). The preconditioner is held for the whole run, as
  // MODFLOW 6 holds APC, so "previous" is the last solve's, whatever step it was in.
  // ILUT and MILUT do restart (ilut below), as sparskit2/ilut.f90 does not reset its flag.
  function ilu0() {
    const inv = new Float64Array(N), lu = new Float64Array(nja), iw = new Uint8Array(N);
    let A = null, relax = 0;
    function factor() {
      W.fill(0); iw.fill(0);
      for (let n = 0; n < N; n++) {
        for (let j = ia[n]; j < ia[n + 1]; j++) { iw[ja[j]] = 1; W[ja[j]] += A[j]; }
        let rs = 0;
        for (let j = ia[n] + 1; j < iu[n]; j++) {
          const jcol = ja[j];
          const tl = W[jcol] * inv[jcol];
          W[jcol] = tl;
          for (let jj = iu[jcol]; jj < ia[jcol + 1]; jj++) {
            const jjcol = ja[jj];
            if (iw[jjcol]) W[jjcol] -= tl * lu[jj];
            else rs += tl * lu[jj];
          }
        }
        const dd = W[n];
        const tl = dd - relax * rs;   // (1 + DELTA) d - RELAX rs, DELTA being 0
        // EXIT MAIN: this row and the rest keep the previous factor.
        if (sign(dd, tl) !== dd || Math.abs(tl) === 0) { pivotFailures++; return; }
        inv[n] = 1 / tl;
        iw[n] = 0; W[n] = 0;
        for (let j = ia[n] + 1; j < ia[n + 1]; j++) { const jcol = ja[j]; lu[j] = W[jcol]; iw[jcol] = 0; W[jcol] = 0; }
      }
    }
    return {
      update(amat, r) { A = amat; relax = r; factor(); },
      apply(R, out) {
        for (let n = 0; n < N; n++) {
          let tv = R[n];
          for (let j = ia[n] + 1; j < iu[n]; j++) tv -= lu[j] * out[ja[j]];
          out[n] = tv;
        }
        for (let n = N - 1; n >= 0; n--) {
          let tv = out[n];
          for (let j = iu[n]; j < ia[n + 1]; j++) tv -= lu[j] * out[ja[j]];
          out[n] = tv * inv[n];
        }
      },
    };
  }

  return { solve, residual, nja, get pivotFailures() { return pivotFailures; } };
}

// ILUT and MILUT: SPARSKIT's ilut and lusol as MODFLOW 6 6.7.0 carries them
// (sparskit2/ilut.f90, with its relax, izero and delta additions), in modified sparse row
// form: alu[i] the inverse pivot of row i, then each row's L entries and its U entries.
function ilut(N, ia, ja, lfil, droptol) {
  // ims_calc_pcdims: room for N (2 lfil + 1) entries, the row pointers included.
  let rowMax = 0;
  for (let n = 0; n < N; n++) rowMax = Math.max(rowMax, ia[n + 1] - ia[n]);
  const iwk = lfil > 0 ? N * (lfil * 2 + 1) : N * rowMax;
  // Fortran's indices from 1 are kept (alu, jlu, JU1, W1, JW1), so the code reads as the source.
  const alu = new Float64Array(iwk + 2), jlu = new Int32Array(iwk + 2);
  const W1 = new Float64Array(N + 2), JW1 = new Int32Array(2 * N + 2), JU1 = new Int32Array(N + 2);
  let A = null, relax = 0;

  function factor(delta, izero) {
    const n = N;
    let ju0 = n + 2;
    jlu[1] = ju0;
    for (let j = 1; j <= n; j++) JW1[n + j] = 0;
    for (let ii = 1; ii <= n; ii++) {
      const j1 = ia[ii - 1], j2 = ia[ii] - 1;   // 0-based positions in A, inclusive
      let dropsum = 0, tnorm = 0;
      for (let k = j1; k <= j2; k++) tnorm += Math.abs(A[k]);
      if (tnorm === 0) throw new Error('The preconditioner (ILUT) met a row of zeros, which MODFLOW 6 stops on too.');
      tnorm /= (j2 - j1 + 1);
      let lenu = 1, lenl = 0;
      JW1[ii] = ii; W1[ii] = 0; JW1[n + ii] = ii;
      for (let j = j1; j <= j2; j++) {
        const k = ja[j] + 1, t = A[j];
        if (k < ii) { lenl++; JW1[lenl] = k; W1[lenl] = t; JW1[n + k] = lenl; }
        else if (k === ii) W1[ii] = t;
        else { lenu++; const jpos = ii + lenu - 1; JW1[jpos] = k; W1[jpos] = t; JW1[n + k] = jpos; }
      }
      let jj = 0, len = 0;
      for (;;) {
        jj++;
        if (jj > lenl) break;
        let jrow = JW1[jj], k = jj;
        for (let j = jj + 1; j <= lenl; j++) if (JW1[j] < jrow) { jrow = JW1[j]; k = j; }
        if (k !== jj) {
          const j = JW1[jj];
          JW1[jj] = JW1[k]; JW1[k] = j;
          JW1[n + jrow] = jj; JW1[n + j] = k;
          const s = W1[jj]; W1[jj] = W1[k]; W1[k] = s;
        }
        JW1[n + jrow] = 0;
        const fact = W1[jj] * alu[jrow];
        if (Math.abs(fact) <= droptol) { dropsum += W1[jj]; continue; }
        for (let kk = JU1[jrow]; kk <= jlu[jrow + 1] - 1; kk++) {
          const s = fact * alu[kk], j = jlu[kk], jpos = JW1[n + j];
          if (j >= ii) {
            if (jpos === 0) {
              lenu++;
              if (lenu > n) throw new Error('The preconditioner (ILUT) overflowed a row, which MODFLOW 6 stops on too.');
              const i = ii + lenu - 1;
              JW1[i] = j; JW1[n + j] = i; W1[i] = -s;
            } else W1[jpos] -= s;
          } else if (jpos === 0) {
            lenl++;
            if (lenl > n) throw new Error('The preconditioner (ILUT) overflowed a row, which MODFLOW 6 stops on too.');
            JW1[lenl] = j; JW1[n + j] = lenl; W1[lenl] = -s;
          } else W1[jpos] -= s;
        }
        len++;
        W1[len] = fact;
        JW1[len] = jrow;
      }
      for (let k = 1; k <= lenu; k++) JW1[n + JW1[ii + k - 1]] = 0;
      lenl = len;
      len = Math.min(lenl, lfil);
      qsplit(W1, JW1, 1, lenl, len);
      for (let k = 1; k <= len; k++) {
        if (ju0 > iwk) throw new Error('The preconditioner (ILUT) overflowed its storage, which MODFLOW 6 stops on too.');
        alu[ju0] = W1[k]; jlu[ju0] = JW1[k]; ju0++;
      }
      JU1[ii] = ju0;
      len = 0;
      for (let k = 1; k <= lenu - 1; k++) {
        if (Math.abs(W1[ii + k]) > droptol * tnorm) { len++; W1[ii + len] = W1[ii + k]; JW1[ii + len] = JW1[ii + k]; } else dropsum += W1[ii + k];
      }
      lenu = len + 1;
      len = Math.min(lenu, lfil);
      qsplit(W1, JW1, ii + 1, lenu - 1, len);
      if (len + ju0 > iwk) throw new Error('The preconditioner (ILUT) overflowed its storage, which MODFLOW 6 stops on too.');
      for (let k = ii + 1; k <= ii + len - 1; k++) { jlu[ju0] = JW1[k]; alu[ju0] = W1[k]; ju0++; }
      const diag = W1[ii];
      let dw = (1 + delta) * diag + relax * dropsum;
      if (sign(diag, dw) !== diag) {
        if (izero > 1) dw = sign(1, diag) * (1e-4 + droptol) * tnorm;
        else return 1;
      }
      if (Math.abs(dw) === 0) {
        if (izero > 1) dw = sign(1, diag) * (1e-4 + droptol) * tnorm;
        else return 1;
      }
      W1[ii] = dw;
      alu[ii] = 1 / dw;
      jlu[ii + 1] = ju0;
    }
    return 0;
  }
  // qsplit on a(first0 .. first0 + nn - 1), keeping the ncut largest in size first.
  function qsplit(a, ind, first0, nn, ncut) {
    let first = 1, last = nn;
    if (ncut < first || ncut > last) return;
    const off = first0 - 1;
    for (;;) {
      let mid = first;
      const abskey = Math.abs(a[off + mid]);
      for (let j = first + 1; j <= last; j++) {
        if (Math.abs(a[off + j]) > abskey) {
          mid++;
          let tmp = a[off + mid]; a[off + mid] = a[off + j]; a[off + j] = tmp;
          tmp = ind[off + mid]; ind[off + mid] = ind[off + j]; ind[off + j] = tmp;
        }
      }
      let tmp = a[off + mid]; a[off + mid] = a[off + first]; a[off + first] = tmp;
      tmp = ind[off + mid]; ind[off + mid] = ind[off + first]; ind[off + first] = tmp;
      if (mid === ncut) return;
      if (mid > ncut) last = mid - 1; else first = mid + 1;
    }
  }
  return {
    update(amat, r) {
      A = amat; relax = r;
      let delta = 0, flag = 0;
      for (let count = 0; ; ) {
        flag = factor(delta, flag);
        if (flag < 1) return;
        delta = 1.5 * delta + 1e-3;
        flag = 0;
        if (delta > 0.5) { delta = 0.5; flag = 2; }
        count++;
        if (count > 10) return;
      }
    },
    // lusol, x from y, both 0-based outside.
    apply(y, x) {
      for (let i = 1; i <= N; i++) {
        let s = y[i - 1];
        for (let k = jlu[i]; k <= JU1[i] - 1; k++) s -= alu[k] * x[jlu[k] - 1];
        x[i - 1] = s;
      }
      for (let i = N; i >= 1; i--) {
        let s = x[i - 1];
        for (let k = JU1[i]; k <= jlu[i + 1] - 1; k++) s -= alu[k] * x[jlu[k] - 1];
        x[i - 1] = alu[i] * s;
      }
    },
  };
}
