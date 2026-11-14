// The flow model: MODFLOW 6 GWF with the standard formulation (not Newton-Raphson) for
// DIS, NPF, IC, STO, CHD, WEL, RCH, EVT, RIV, DRN, GHB and OBS. See docs/design/model.md and
// docs/tools/model.md. Each formula cites Langevin and others (2017), USGS TM 6-A55, and
// follows the MODFLOW 6 6.7.0 source where the report leaves a detail open.
//
// Every outer (Picard) iteration does what MODFLOW 6 does in its cf/fc/solve sequence:
//  1. dry out convertible cells whose head is at or below their bottom (NPF wetdry);
//  2. update the saturated fraction of convertible cells from the latest heads;
//  3. recompute horizontal conductances and the head-dependent boundary terms from them;
//  4. assemble and solve the linear system with PCG;
//  5. stop when the largest head change is at most hclose and the linear solve converged.
//
// Why the system stays symmetric: in the standard formulation every nonlinear term is
// lagged one iteration. A convertible cell's conductance is a function of both cells'
// saturations from the previous iterate, and is the same number in row n and row m.
// RIV, DRN and GHB only add to the diagonal (HCOF) and the right-hand side, with the RIV
// branch (head above or below the river bottom) and the DRN on/off switch chosen from the
// previous iterate, exactly as MODFLOW 6 riv_cf and drn_cf do. Storage of convertible cells
// takes its saturation from the previous iterate too (STO sto_fc). So each iteration is a
// symmetric positive definite solve, and the nonlinearity is carried by the Picard loop.
// MODFLOW 6's Newton-Raphson formulation (newton.js) and PERCHED make the matrix nonsymmetric.
// Constant-head columns are moved to the right-hand side so the matrix keeps its symmetry,
// as MODFLOW 6 sln_ls does for a symmetric matrix.

import { buildGrid, cellName, harmonic, nodeName, oneLayer, stepName } from './grid.js';
import { RELAX, checkImsSettings, createLinear, createOuter, maxval } from './ims.js';
import { createRewet } from './rewet.js';
import { bottomNodes, checkNewton, createPtc, newtonUnderRelax, npfNewtonTerms, quadSat, stoNewtonTerms } from './newton.js';
import { rchPackage } from './rch.js';
import { evtPackage } from './evt.js';
import { isPerched, variableCv } from './npf.js';
import { unknownUnits } from './units.js';
import { checkKeys } from './keys.js';
import { sig } from '../format.js';

const PACKAGES = ['CHD', 'WEL', 'RCH', 'EVT', 'RIV', 'DRN', 'GHB'];
// The order the stress packages are in the name file toMf6 writes, which gwf_fc follows.
const FC_ORDER = ['WEL', 'RIV', 'DRN', 'GHB', 'RCH', 'EVT'];
// The model's keys that give each budget term: recharge and evapotranspiration as arrays or lists.
const PACKAGE_KEYS = { CHD: ['chd'], WEL: ['wel'], RCH: ['rch', 'rchList'], EVT: ['evt', 'evtList'], RIV: ['riv'], DRN: ['drn'], GHB: ['ghb'] };

// The budget discrepancy, in percent of the mean of the total in and out, above which a
// step is flagged. MODFLOW 6 prints the discrepancy and sets no limit; its forerunner's
// documentation says only that "the percentage error should be small" for equations solved
// correctly (Harbaugh 2005, TM 6-A16, p. 3-9), with no number. So 1 % is chosen here, a
// common rule of thumb for which no USGS source was found. It is far above what a converged
// run gives: the reference models balance to 2.4 × 10⁻⁷ % or better (docs/tools/model-mf6.md),
// so a step over 1 % has not been solved.
export const DISCREPANCY_LIMIT = 1;

/**
 * The end time of every time step, with its period and step (from 0) and its length, as
 * MODFLOW 6 TDIS sets them (tdis_set_delt and tdis_set_timestep), to the last bit: within a
 * period the steps grow by tsmult, the last step takes what is left, and each end time is the
 * last plus the step's length.
 */
export function stepTimes(periods) {
  const out = [];
  let totim = 0;
  periods.forEach((per, p) => {
    const topertim = totim;
    let delt = 0;
    for (let kstp = 0; kstp < per.nstp; kstp++) {
      if (kstp === 0) delt = per.tsmult !== 1 ? per.length * (1 - per.tsmult) / (1 - powi(per.tsmult, per.nstp)) : per.length / per.nstp;
      else if (kstp === per.nstp - 1) delt = topertim + per.length - totim;
      else delt *= per.tsmult;
      totim += delt;
      out.push({ time: totim, period: p, step: kstp, delt });
    }
  });
  return out;
}

// Fortran's x**n for a whole number n as gfortran computes it (libgcc __powidf2): by
// squaring, which can round differently from Math.pow (1.4**6, for one, by one unit).
function powi(x, m) {
  let n = Math.abs(m), y = n % 2 ? x : 1;
  while ((n = Math.floor(n / 2))) { x *= x; if (n % 2) y *= x; }
  return m < 0 ? 1 / y : y;
}

// The entries of a stress package in force in period p: the latest period at or before p
// that has a list (MODFLOW 6 keeps a period's list until a later period replaces it).
function inForce(pkg, p) {
  if (!pkg) return null;
  let best = -1;
  for (const key of Object.keys(pkg)) {
    const kp = Number(key);
    if (!Number.isInteger(kp) || kp < 0) throw new Error(`A stress package period key "${key}" is not a period number.`);
    if (kp <= p && kp > best) best = kp;
  }
  return best < 0 ? null : pkg[best];
}

/**
 * Where a time t (d, from the start of the run) falls among the saved steps, for a head at
 * that time, as MODFLOW-2000's head observations take it (Hill and others 2000, USGS OFR
 * 00-184, p. 24 and 39): within a time step, linearly between the heads at its beginning and
 * end, the beginning of a transient first period being the starting heads; within a
 * steady-state step, that step's own solution. Returns { a, b, w }: the head is
 * (1 - w) H[a] + w H[b], H[s] being the heads of saved step s and a = -1 the starting heads.
 * A time within 10⁻⁹ of a step end, relative, is that step end.
 */
export function timeWeights(periods, t) {
  const sched = stepTimes(periods);
  const end = sched[sched.length - 1].time;
  if (!(Number.isFinite(t) && t >= 0)) throw new Error(`The time ${t} is not a time from 0 d on.`);
  if (t > end * (1 + 1e-9)) throw new Error(`The time ${sig(t, 6)} d is after the end of the run, ${sig(end, 6)} d.`);
  for (let s = 0; s < sched.length; s++) {
    const { time, period, delt } = sched[s];
    if (Math.abs(t - time) <= 1e-9 * Math.max(1, time)) return { a: s, b: s, w: 1 };
    if (t < time) {
      if (periods[period].steady) return { a: s, b: s, w: 1 };
      return { a: s - 1, b: s, w: (t - (time - delt)) / delt };
    }
  }
  return { a: sched.length - 1, b: sched.length - 1, w: 1 };
}

/** The head of node n at time t (d) from a run of the model, by timeWeights; NaN where dry. */
export function headAtTime(model, result, n, t) {
  const { a, b, w } = timeWeights(model.periods, t);
  const hb = result.heads[b][n];
  if (w === 1) return hb;
  const ncpl = model.grid.nrow * model.grid.ncol, v = model.ic.strt[Math.floor(n / ncpl)];
  const ha = a < 0 ? (typeof v === 'number' ? v : v[n % ncpl]) : result.heads[a][n];
  return (1 - w) * ha + w * hb;
}

function cellIndex(g, entry, label) {
  const [k, i, j] = entry;
  if (![k, i, j].every(Number.isInteger) || k < 0 || k >= g.nlay || i < 0 || i >= g.nrow || j < 0 || j >= g.ncol) {
    throw new Error(`${label}: ${[k, i, j].every(Number.isInteger) ? cellName(k, i, j) : `the cell [${k}, ${i}, ${j}]`} is outside the grid of ${g.nlay} layers, ${g.nrow} rows and ${g.ncol} columns.`);
  }
  const n = k * g.ncpl + i * g.ncol + j;
  if (!g.domain[n]) throw new Error(`${label}: ${cellName(k, i, j)} is not an active cell (idomain ${g.through[n] ? '−1, a vertical pass-through cell' : '0'}).`);
  return n;
}

function readList(g, list, width, label) {
  if (!Array.isArray(list)) throw new Error(`${label} must be a list of entries.`);
  const node = new Int32Array(list.length), vals = [];
  for (let v = 0; v < width; v++) vals.push(new Float64Array(list.length));
  list.forEach((e, r) => {
    if (!Array.isArray(e) || e.length !== 3 + width) throw new Error(`${label}, entry ${r + 1}, needs ${3 + width} values.`);
    node[r] = cellIndex(g, e, `${label}, entry ${r + 1}`);
    for (let v = 0; v < width; v++) {
      if (typeof e[3 + v] !== 'number' || !Number.isFinite(e[3 + v])) throw new Error(`${label}, entry ${r + 1} (${cellName(e[0], e[1], e[2])}), has a value that is not a number.`);
      vals[v][r] = e[3 + v];
    }
  });
  return { node, vals };
}

function checkSolver(s) {
  if (!s) throw new Error('The model has no solver block (outer, inner, hclose, rclose).');
  for (const key of ['outer', 'inner']) if (!Number.isInteger(s[key]) || s[key] < 1) throw new Error(`solver.${key} must be a whole number of at least 1.`);
  for (const key of ['hclose', 'rclose']) if (!(s[key] > 0)) throw new Error(`solver.${key} must be above zero.`);
  if (s.innerHclose !== undefined && !(s.innerHclose > 0)) throw new Error('solver.innerHclose (IMS INNER_DVCLOSE) must be above zero.');
  if (s.strict !== undefined && typeof s.strict !== 'boolean') throw new Error('solver.strict must be true or false.');
  if (s.relax !== undefined && !(typeof s.relax === 'number' && s.relax >= 0 && s.relax <= 1)) throw new Error('solver.relax (the preconditioner\'s relaxation factor) must be from 0 to 1.');
  checkImsSettings(s);
  return s;
}

/**
 * Run a model (the JSON in docs/design/model.md). Returns times, heads, budget, obs,
 * iterations, and beyond the design: periods, steps, dry, flows (cellFlows), notices, complete.
 *   progress({ step, total, period }): called after each time step.
 *   onStep(out, s): called after time step s (from 0) with the result so far, so a caller
 *     can pass on each step as it is solved (a Web Worker posting them, for one).
 *   shouldStop(): called after each time step; when it returns true the run ends there and
 *     returns the steps solved so far, with complete: false and stopped: true.
 * A step that does not converge ends the run with an error, as MODFLOW 6 stops: the error
 * has code 'not-converged', where ({ period, step, iterations, maxChange, cell }), and
 * result, the steps solved before it (complete: false).
 */
export function run(model, { progress, onStep, shouldStop } = {}) {
  checkKeys(model);
  const unknown = unknownUnits(model);
  if (unknown) throw new Error(unknown);
  const g = buildGrid(model);
  const { N, ncol, ncpl, nlay, top, bot, area, domain, icelltype, kh, delr, delc } = g;
  const solver = checkSolver(model.solver);
  // The Newton-Raphson formulation (newton.js), or null for the standard one.
  const newton = checkNewton(model.newton);
  const periods = model.periods;
  if (!Array.isArray(periods) || !periods.length) throw new Error('The model has no stress periods.');
  periods.forEach((p, i) => {
    if (!(p.length > 0)) throw new Error(`Period ${i + 1} needs a length above zero.`);
    if (!Number.isInteger(p.nstp) || p.nstp < 1) throw new Error(`Period ${i + 1} needs nstp, a whole number of at least 1.`);
    if (!(p.tsmult > 0)) throw new Error(`Period ${i + 1} needs tsmult above zero.`);
    if (typeof p.steady !== 'boolean') throw new Error(`Period ${i + 1} must say steady: true or false.`);
  });
  const transient = periods.some((p) => !p.steady);
  let ss = null, sy = null;
  if (model.sto) {
    const per = (v, label) => {
      const out = new Float64Array(N);
      if (!Array.isArray(v) || v.length !== nlay) throw new Error(`${label} needs one entry per layer (${nlay}).`);
      for (let k = 0; k < nlay; k++) out.set(oneLayer(v[k], ncpl, `${label}, layer ${k + 1}`, ncol), k * ncpl);
      return out;
    };
    ss = per(model.sto.ss, 'sto.ss');
    // A pass-through cell stores nothing: it is not a cell of MODFLOW 6's grid (grid.js).
    for (let n = 0; n < N; n++) if (g.pass[n]) ss[n] = 0;
    for (const k of ['storagecoefficient', 'ssConfinedOnly']) if (model.sto[k] !== undefined && typeof model.sto[k] !== 'boolean') throw new Error(`sto.${k} must be true or false.`);
    if (icelltype.some((c, n) => c && domain[n])) sy = per(model.sto.sy, 'sto.sy');
    // gwf-sto.f90 source_data: MODFLOW 6 stops on an SS or SY below zero in any cell of its
    // grid (SY whenever it is given), with "Error in SS DATA: SS value in cell ... is less
    // than zero". With STORAGECOEFFICIENT, SS is the storage coefficient, checked the same.
    const syAll = sy || (model.sto.sy !== undefined ? per(model.sto.sy, 'sto.sy') : null);
    for (const [arr, key] of [[ss, 'ss'], [syAll, 'sy']]) {
      if (!arr) continue;
      for (let n = 0; n < N; n++) {
        if (!domain[n] || !(arr[n] < 0)) continue;
        const what = key === 'ss' && model.sto.storagecoefficient === true ? 'sto.ss (the storage coefficient, with STORAGECOEFFICIENT)' : `sto.${key}`;
        throw new Error(`${what} is ${sig(arr[n], 6)} at ${nodeName(n, g.nrow, ncol)}, below zero. MODFLOW 6 stops on it: "Error in ${key.toUpperCase()} DATA: ${key.toUpperCase()} value in cell ... is less than zero".`);
      }
    }
  } else if (transient) {
    throw new Error('A transient period needs the sto block (ss, and sy for convertible layers).');
  }
  if (!model.ic || model.ic.strt == null) throw new Error('The model has no starting heads (ic.strt).');
  const strt = new Float64Array(N);
  if (!Array.isArray(model.ic.strt) || model.ic.strt.length !== nlay) throw new Error(`ic.strt needs one entry per layer (${nlay}).`);
  for (let k = 0; k < nlay; k++) strt.set(oneLayer(model.ic.strt[k], ncpl, `ic.strt, layer ${k + 1}`, ncol), k * ncpl);

  const obsList = (model.obs || []).map((o) => {
    const n = cellIndex(g, [o.lay, o.row, o.col], `Observation ${o.name}`);
    return { name: o.name, n };
  });

  // State. ibound as in MODFLOW 6: 1 variable head, 0 no-flow (idomain 0 or dry), -1 CHD.
  const ibound = new Int8Array(N), dry = new Uint8Array(N);
  const x = Float64Array.from(strt), hold = new Float64Array(N);
  // Saturated fractions: 1 for a confined cell, or its starting fraction with THICKSTRT.
  const sat = Float64Array.from(g.sat0);
  const npfOpt = model.npf, perched = npfOpt.perched === true;
  // check_options in gwf-npf.f90: "NEWTON OPTION CANNOT BE USED WITH PERCHED OPTION", nor
  // with VARIABLECV (nor REWET).
  if (newton && (perched || npfOpt.variablecv)) throw new Error(`The Newton-Raphson formulation cannot be used with ${perched ? 'PERCHED' : 'VARIABLECV'} (npf.${perched ? 'perched' : 'variablecv'}), as MODFLOW 6 refuses it.`);
  const cE = new Float64Array(N), cS = new Float64Array(N), cD = new Float64Array(N);
  const d = new Float64Array(N), oE = new Float64Array(N), oS = new Float64Array(N), oD = new Float64Array(N), b = new Float64Array(N);
  const xtemp = new Float64Array(N);
  // The linear and outer-iteration settings of IMS, and its linear solver on the matrix in
  // MODFLOW 6's CSR form (ims.js). lE, lS, lD hold the lower couplings. With CG they are the
  // upper arrays themselves, the matrix being symmetric, and constant-head columns are moved
  // to the right-hand side, as sln_ls does for a symmetric matrix; with BICGSTAB, as in
  // MODFLOW 6, every column stays in the matrix and the rows are held apart.
  const ims = checkImsSettings(solver, { newton: Boolean(newton) });
  const outerIts = createOuter(N, ims);
  // Under Newton-Raphson: pseudo-transient continuation in steady periods, and for NEWTON
  // UNDER_RELAXATION the lowest cell below each cell.
  const ptc = newton ? createPtc(g, ims.ptc) : null;
  const ibot = newton && newton.underRelaxation ? bottomNodes(g) : null;
  // keepColumns: MODFLOW 6 holds the matrix as not symmetric (BICGSTAB), so constant-head
  // columns stay in it. ownLower: the lower couplings are held apart from the upper ones, as
  // they must be with BICGSTAB, and with PERCHED under CG too, whose term MODFLOW 6 puts in the
  // matrix's lower part alone and still solves with CG (npf_fc).
  const keepColumns = ims.linear === 'bicgstab', ownLower = keepColumns || perched;
  const lE = ownLower ? new Float64Array(N) : oE, lS = ownLower ? new Float64Array(N) : oS, lD = ownLower ? new Float64Array(N) : oD;
  const mat = { d, oE, oS, oD, lE, lS, lD };
  const rbuf = new Float64Array(N), rres = new Float64Array(N);
  const linear = createLinear(g, (n) => g.csE[n] > 0, (n) => g.csS[n] > 0, (n) => g.csD[n] > 0, { ...ims, relax: solver.relax ?? RELAX });
  // A pass-through cell is no node of MODFLOW 6's grid, nor of its system here (ims.js).
  for (let n = 0; n < N; n++) ibound[n] = domain[n] ? 1 : 0;

  let curKiter = 0;   // the outer iteration being formulated, for REWET's IWETIT
  // REWET (rewet.js), or null.
  const rewet = createRewet(model, g);
  // Cells that start dry stay dry, unless they can be wetted: NPF preprocess_input calls
  // wetdry with the starting heads (outer iteration 0).
  dryCells(true, 0);

  function dryCells(atStart, kiter) {
    // NPF sgwf_npf_wetdry: first, with REWET, dry cells wetted from their neighbours; then a
    // convertible cell whose saturated thickness min(h, top) - bot is zero or less goes dry.
    // With no rewetting it stays inactive for the rest of the run.
    // Under Newton-Raphson no cell dries: npf_cf and preprocess_input call it only without.
    if (newton) return;
    if (rewet) rewet.wet(kiter, ibound, x);
    for (let n = 0; n < N; n++) {
      if (ibound[n] === 0 || !icelltype[n]) continue;
      if (Math.min(x[n], top[n]) - bot[n] <= 0) {
        if (ibound[n] < 0 && !atStart) throw new Error(`The constant-head cell at ${nodeName(n, g.nrow, ncol)} went dry: its head is at or below its bottom (${bot[n]} m). MODFLOW 6 stops the run here.`);
        ibound[n] = 0;
        dry[n] = 1;
        if (rewet) x[n] = rewet.HDRY;
      }
    }
    if (rewet) rewet.done(ibound, dry);
  }

  // Stress data for the current period.
  let chdNode = new Int32Array(0), chdHead = new Float64Array(0);
  let wel = null, riv = null, drn = null, ghb = null;
  // RCH and EVT keep their own state from period to period (rch.js, evt.js).
  const rch = rchPackage(model, g, readList), evt = evtPackage(model, g, readList);

  function setPeriod(p) {
    const chdList = inForce(model.chd, p);
    if (chdList !== curChd) {
      for (const n of chdNode) if (ibound[n] < 0) ibound[n] = 1;
      const l = readList(g, chdList || [], 1, `chd, period ${p + 1}`);
      for (const n of l.node) {
        if (ibound[n] < 0) throw new Error(`chd: the cell at ${nodeName(n, g.nrow, ncol)} is listed twice in period ${p + 1}.`);
        ibound[n] = -1;
        dry[n] = 0;
      }
      chdNode = l.node; chdHead = l.vals[0];
      curChd = chdList;
    }
    const wl = inForce(model.wel, p);
    wel = wl && wl.length ? readList(g, wl, 1, `wel, period ${p + 1}`) : null;
    const rv = inForce(model.riv, p);
    riv = rv && rv.length ? readList(g, rv, 3, `riv, period ${p + 1}`) : null;
    const dn = inForce(model.drn, p);
    drn = dn && dn.length ? readList(g, dn, 2, `drn, period ${p + 1}`) : null;
    const gh = inForce(model.ghb, p);
    ghb = gh && gh.length ? readList(g, gh, 2, `ghb, period ${p + 1}`) : null;
    if (rch) rch.setPeriod(p);
    if (evt) evt.setPeriod(p);
    const at = (pk, e) => nodeName(pk.node[e], g.nrow, ncol);
    if (riv) for (let e = 0; e < riv.node.length; e++) {
      if (riv.vals[2][e] > riv.vals[0][e]) throw new Error(`riv, period ${p + 1}: the river at ${at(riv, e)} has its bottom (${riv.vals[2][e]} m) above its stage (${riv.vals[0][e]} m), which MODFLOW 6 refuses.`);
      if (riv.vals[1][e] < 0) throw new Error(`riv, period ${p + 1}: the river at ${at(riv, e)} has a conductance below zero.`);
    }
    for (const [pk, what] of [[drn, 'drain'], [ghb, 'general-head boundary']]) {
      if (pk) pk.vals[1].forEach((c, e) => { if (c < 0) throw new Error(`The ${what} at ${at(pk, e)} in period ${p + 1} has a conductance below zero.`); });
    }
    // riv_ck, drn_ck and ghb_ck: in a convertible cell, MODFLOW 6 refuses a river bottom or
    // stage, a drain elevation or a boundary head below the cell bottom.
    const under = (pk, v, key, what) => {
      if (pk) for (let e = 0; e < pk.node.length; e++) {
        const n = pk.node[e];
        if (icelltype[n] && pk.vals[v][e] < bot[n]) throw new Error(`${key}, period ${p + 1}: the ${what} at ${at(pk, e)} (${pk.vals[v][e]} m) is below the cell bottom (${bot[n]} m), which MODFLOW 6 refuses in a convertible cell.`);
      }
    };
    under(riv, 2, 'riv', 'river bottom'); under(riv, 0, 'riv', 'river stage'); under(drn, 0, 'drn', 'drain elevation'); under(ghb, 0, 'ghb', 'boundary head');
  }
  let curChd;

  // Per-entry MODFLOW 6 hcof and rhs for each package (rate = hcof*h - rhs, positive into
  // the aquifer), kept from the last formulation so the budget uses them as MODFLOW 6 does.
  const terms = {};
  function packageTerms() {
    // WEL (wel_cf): rhs = -q, nothing in a cell that is not variable-head.
    if (wel) {
      const t = ensure('WEL', wel.node.length);
      for (let e = 0; e < wel.node.length; e++) {
        const n = wel.node[e];
        t.node[e] = n; t.hcof[e] = 0; t.rhs[e] = ibound[n] > 0 ? -wel.vals[0][e] : 0;
      }
    } else delete terms.WEL;
    // RCH (rch_cf) and EVT (evt_cf): on the cell given, or the highest active cell below it
    // (rch.js, evt.js).
    if (rch && rch.size) rch.formulate(ibound, x, ensure('RCH', rch.size)); else delete terms.RCH;
    if (evt && evt.size) evt.formulate(ibound, x, ensure('EVT', evt.size)); else delete terms.EVT;
    // RIV (riv_cf): above the bottom, cond*(stage - h); at or below it, cond*(stage - rbot).
    if (riv) {
      const t = ensure('RIV', riv.node.length);
      for (let e = 0; e < riv.node.length; e++) {
        const n = riv.node[e], stage = riv.vals[0][e], c = riv.vals[1][e], rbot = riv.vals[2][e];
        t.node[e] = n;
        if (ibound[n] <= 0) { t.hcof[e] = 0; t.rhs[e] = 0; }
        else if (x[n] <= rbot) { t.hcof[e] = 0; t.rhs[e] = -c * (stage - rbot); }
        else { t.hcof[e] = -c; t.rhs[e] = -c * stage; }
      }
    } else delete terms.RIV;
    // DRN (drn_cf with no DRNDEPTH): cond*(elev - h) while h is above elev, else nothing.
    if (drn) {
      const t = ensure('DRN', drn.node.length);
      for (let e = 0; e < drn.node.length; e++) {
        const n = drn.node[e], elev = drn.vals[0][e], c = drn.vals[1][e];
        const f = ibound[n] > 0 && x[n] > elev ? 1 : 0;
        t.node[e] = n; t.hcof[e] = -f * c; t.rhs[e] = -f * c * elev;
      }
    } else delete terms.DRN;
    // GHB (ghb_cf): cond*(bhead - h).
    if (ghb) {
      const t = ensure('GHB', ghb.node.length);
      for (let e = 0; e < ghb.node.length; e++) {
        const n = ghb.node[e], c = ghb.vals[1][e];
        t.node[e] = n;
        if (ibound[n] > 0) { t.hcof[e] = -c; t.rhs[e] = -c * ghb.vals[0][e]; } else { t.hcof[e] = 0; t.rhs[e] = 0; }
      }
    } else delete terms.GHB;
  }
  function ensure(name, len) {
    let t = terms[name];
    if (!t || t.node.length !== len) t = terms[name] = { node: new Int32Array(len), hcof: new Float64Array(len), rhs: new Float64Array(len) };
    return t;
  }

  // Saturated fraction (NPF npf_cf and sgwf_npf_thksat, standard formulation).
  function saturation() {
    for (let n = 0; n < N; n++) {
      if (!icelltype[n]) continue;
      if (ibound[n] === 0) sat[n] = 0;
      // Under Newton-Raphson, quadratically smoothed (sgwf_npf_thksat, satomega 1e-6).
      else if (newton) sat[n] = quadSat(top[n], bot[n], x[n]);
      else sat[n] = x[n] >= top[n] ? 1 : (x[n] - bot[n]) / (top[n] - bot[n]);
    }
  }

  // Conductances (NPF hcond and vcond). Between two confined cells, and in the vertical
  // (no VARIABLECV), the saturated value. Otherwise the harmonic mean of the two
  // transmissivities with each cell's saturated thickness sat*(top - bot), eq. 4-4 and 4-27.
  function conductances() {
    const { csE, csS, csD } = g;
    for (let n = 0; n < N; n++) {
      cE[n] = cS[n] = cD[n] = 0;
      if (ibound[n] === 0) continue;
      const j = n % ncol, i = Math.floor((n % ncpl) / ncol);
      if (csE[n] > 0 && ibound[n + 1] !== 0) {
        const m = n + 1;
        cE[n] = !icelltype[n] && !icelltype[m] ? csE[n] : newton ? upstream(n, m) * csE[n]
          : harmonic(kh[n], kh[m], sat[n] * (top[n] - bot[n]), sat[m] * (top[m] - bot[m]), delr[j] / 2, delr[j + 1] / 2, delc[i]);
      }
      if (csS[n] > 0 && ibound[n + ncol] !== 0) {
        const m = n + ncol;
        cS[n] = !icelltype[n] && !icelltype[m] ? csS[n] : newton ? upstream(n, m) * csS[n]
          : harmonic(g.k22[n], g.k22[m], sat[n] * (top[n] - bot[n]), sat[m] * (top[m] - bot[m]), delc[i] / 2, delc[i + 1] / 2, delr[j]);
      }
      // Vertical, with the cell below past any pass-through cells: the saturated value, or with
      // VARIABLECV one from the saturations (npf.js).
      if (csD[n] > 0 && ibound[g.down[n]] !== 0) {
        cD[n] = npfOpt.variablecv ? variableCv(g, n, g.down[n], x, sat, npfOpt.dewatered === true, csD[n]) : csD[n];
      }
    }
  }

  // Newton-Raphson: the saturated conductance times the saturation of the cell upstream, the
  // one with the higher head (hcond convertible_upstream; a confined cell's saturation is 1).
  const upstream = (n, m) => (x[n] > x[m] ? sat[n] : sat[m]);

  // Storage terms for cell n (STO sto_fc with SsTerms, SyTerms and SsCapacity; omega = 0, so
  // the saturation is linear in head). With STORAGECOEFFICIENT, ss is the storage coefficient,
  // so the capacity takes no thickness; with SS_CONFINED_ONLY a convertible cell has
  // compressible storage only while full. Returns [aterm, rhsterm] in MODFLOW 6's sign.
  const stoCoef = Boolean(model.sto && model.sto.storagecoefficient), ssConfined = Boolean(model.sto && model.sto.ssConfinedOnly);
  const stoOut = new Float64Array(8);
  const rho1Of = (n, tled) => ss[n] * (stoCoef ? 1 : top[n] - bot[n]) * area[n] * tled;   // SsCapacity / Δt
  const satOf = newton ? quadSat : linSat;   // STO satomega: 1e-6 under Newton, else 0
  function storage(n, tled, h) {
    const tp = top[n], bt = bot[n], thk = tp - bt;
    const rho1 = rho1Of(n, tled);
    let aSs, rSs, aSy = 0, rSy = 0, rateSs, rateSy = 0;
    if (!icelltype[n]) {
      aSs = -rho1;
      rSs = -rho1 * hold[n];
      rateSs = aSs * h - rSs;
    } else {
      const snold = satOf(tp, bt, hold[n]), snnew = satOf(tp, bt, h);
      if (ssConfined) {
        // SsTerms with iconf_ss: storage about the cell top, only while the cell is full.
        aSs = snnew === 1 ? -rho1 : 0;
        rSs = (snold === 1 ? -rho1 * (hold[n] - tp) : 0) - (snnew === 1 ? rho1 * tp : 0);
      } else {
        // TM 6-A55 eq. 5-4 with the 6.x convertible form: storage measured about the
        // centre of the saturated part, zold and znew.
        const zold = bt + 0.5 * thk * snold, znew = bt + 0.5 * thk * snnew;
        aSs = -rho1 * snnew;
        rSs = -rho1 * snold * (hold[n] - zold) - rho1 * snnew * znew;
      }
      rateSs = aSs * h - rSs;
      // Specific yield, eq. 5-13.
      const rho2 = sy[n] * area[n] * tled;
      if (snnew < 1) {
        if (snnew > 0) { aSy = -rho2; rSy = -rho2 * thk * snold - rho2 * bt; }
        else rSy = thk * (0 - rho2 * snold);
      } else rSy = thk * (rho2 * snnew - rho2 * snold);
      rateSy = rho2 * thk * snold - rho2 * thk * snnew;
    }
    stoOut[0] = aSs + aSy; stoOut[1] = rSs + rSy; stoOut[2] = rateSs; stoOut[3] = rateSy;
    stoOut[4] = aSs; stoOut[5] = rSs; stoOut[6] = aSy; stoOut[7] = rSy;
    return stoOut;
  }

  function assemble(tled) {
    d.fill(0); b.fill(0); oE.fill(0); oS.fill(0); oD.fill(0);
    if (ownLower) { lE.fill(0); lS.fill(0); lD.fill(0); }
    // Internal flow: M = -A has +C on the diagonal and -C off it.
    for (let n = 0; n < N; n++) {
      if (ibound[n] === 0) continue;
      couple(n, n + 1, cE[n], oE, lE);
      couple(n, n + ncol, cS[n], oS, lS);
      // The cell below, past any pass-through cells, perched or not.
      if (perched && cD[n] && isPerched(g, g.down[n], x)) perchedCouple(n, g.down[n], cD[n]);
      else if (cD[n]) couple(n, g.down[n], cD[n], oD, lD);
    }
    // Storage before the stress packages, its specific storage before its specific yield, as
    // gwf_fc and sto_fc add them, so the sums round as MODFLOW 6's do.
    if (tled > 0) {
      for (let n = 0; n < N; n++) {
        if (ibound[n] < 1) continue;
        const s = storage(n, tled, x[n]);
        d[n] -= s[4]; b[n] -= s[5];
        if (icelltype[n]) { d[n] -= s[6]; b[n] -= s[7]; }
      }
    }
    // In the order of the name file toMf6 writes (and FloPy's scripts), as gwf_fc adds the
    // packages, so that a cell with two of them sums as MODFLOW 6's does.
    for (const name of FC_ORDER) {
      const t = terms[name];
      if (!t) continue;
      for (let e = 0; e < t.node.length; e++) {
        const n = t.node[e];
        if (n < 0 || ibound[n] <= 0) continue;
        d[n] -= t.hcof[e];
        b[n] -= t.rhs[e];
      }
    }
  }
  // sln_ls, once every term is in: identity rows for cells that are not variable head.
  function finishRows() {
    for (let n = 0; n < N; n++) {
      if (ibound[n] <= 0) { d[n] = 1; b[n] = x[n]; }
      // sln_ls: an active cell with no coefficients at all keeps its head.
      else if (Math.abs(d[n]) < 1e-15) { d[n] = 1; b[n] += x[n]; }
    }
    // sln_ls for a symmetric matrix (CG): each variable-head row's couplings with
    // constant-head cells moved to its right-hand side, after every term is in, column by
    // column, so the sums round as MODFLOW 6's do. couple() leaves those entries out.
    if (keepColumns) return;
    const { nrow } = g;
    for (let n = 0; n < N; n++) {
      if (ibound[n] <= 0) continue;
      const j = n % ncol, i = Math.floor((n % ncpl) / ncol), u = g.above[n], dn = g.down[n];
      const move = (m, c) => { if (c && ibound[m] < 0) b[n] += c * x[m]; };
      if (u >= 0) move(u, cD[u]);
      if (i > 0) move(n - ncol, cS[n - ncol]);
      if (j > 0) move(n - 1, cE[n - 1]);
      if (j < ncol - 1) move(n + 1, cE[n]);
      if (i < nrow - 1) move(n + ncol, cS[n]);
      // PERCHED puts nothing in row n for the cell below (perchedCouple).
      if (dn >= 0 && !(perched && isPerched(g, dn, x))) move(dn, cD[n]);
    }
  }
  // The formulation of one outer iteration (sln_buildsystem: the model's cf and fc), then
  // sln_ls's rows for cells that are not variable head.
  // withNewton false builds the standard terms only, as sln_buildsystem does for backtracking.
  function formulate(tled, withNewton = true) {
    dryCells(false, curKiter);
    saturation();
    conductances();
    packageTerms();
    assemble(tled);
    if (newton && withNewton) {
      npfNewtonTerms(g, ibound, x, mat, b);
      if (tled > 0) stoNewtonTerms(g, ibound, x, (n) => rho1Of(n, tled), (n) => sy[n] * area[n] * tled, mat, b, ssConfined);
    }
    // sln_calc_ptc: the residual PTC takes its pseudo time step from, after gwf_fc (the
    // Newton terms in) and before sln_ls's identity rows.
    if (ptc && withNewton && tled === 0) linear.residual(mat, b, x, ibound, rbuf);
    finishRows();
  }
  // PERCHED (npf_fc): the flow from n down to m is C (h(n) - bot(n)). Row n holds C on its
  // diagonal and C bot(n) on its right-hand side; row m holds -C h(n) in the matrix's lower
  // part alone, which is not symmetric, and MODFLOW 6 puts it there with CG as with BICGSTAB
  // (under CG, sln_ls moves it to the right-hand side when n is a constant head).
  function perchedCouple(n, m, c) {
    if (ibound[n] > 0) { d[n] += c; b[n] += c * bot[n]; }
    if (ibound[m] <= 0) return;
    b[m] -= c * bot[n];
    // Under CG a constant-head n's column goes to the right-hand side (finishRows).
    if (keepColumns || ibound[n] > 0) lD[n] -= c;
  }
  function couple(n, m, c, off, low) {
    if (c === 0) return;
    const bn = ibound[n], bm = ibound[m];
    if (bn > 0) d[n] += c;
    if (bm > 0) d[m] += c;
    if (keepColumns) {
      // Each variable-head row keeps its coupling, to a constant-head cell too; the rows of
      // cells that are not variable head have none (sln_ls zero_row_offdiag).
      if (bn > 0) off[n] = -c;
      if (bm > 0) low[n] = -c;
    } else if (bn > 0 && bm > 0) { off[n] = -c; if (ownLower) low[n] = -c; }
    // A coupling with a constant-head cell goes to the right-hand side in finishRows.
  }

  // Beyond the design's output: the period and step of each saved step, and the cells that
  // are dry (MODFLOW 6 HDRY) as opposed to never active (idomain 0); both are NaN in heads.
  // notices: what the run did that the user should hear of (see dryNotices and
  // discrepancyNotice); complete: false when the run ended early. flows: for each saved step
  // of a steady period, the cell-by-cell flows MODFLOW 6 saves to its budget file (see
  // cellFlows), which particle tracking reads as MODPATH 7 does; null for a transient step.
  const out = {
    times: [], heads: [], budget: [], obs: {}, iterations: [], innerIterations: [], periods: [], steps: [], dry: [], flows: [],
    notices: [], discrepancyLimit: DISCREPANCY_LIMIT, complete: false,
  };
  const schedule = stepTimes(periods);
  for (const o of obsList) out.obs[o.name] = [];
  // INNER_DVCLOSE is OUTER_DVCLOSE unless solver.innerHclose gives another, as each COMPLEXITY sets it.
  const inner = { inner: solver.inner, dvclose: solver.innerHclose ?? solver.hclose, rclose: solver.rclose, strict: solver.strict === true, relax: solver.relax ?? RELAX };
  const notices = noticeBook(out, g);

  for (let s = 0; s < schedule.length; s++) {
    const { time: totim, period: p, step: kstp, delt } = schedule[s];
    const per = periods[p];
    if (kstp === 0) setPeriod(p);
    hold.set(x);
    if (rewet) rewet.advance(ibound, x, hold);
    for (let e = 0; e < chdNode.length; e++) { x[chdNode[e]] = chdHead[e]; hold[chdNode[e]] = chdHead[e]; }
    const tled = per.steady ? 0 : 1 / delt;

    // One outer iteration as NumericalSolution.f90 solve does it: backtracking (when asked
    // for), the formulation (cf and fc), the linear solve, the convergence test on the
    // largest head change, and, if not converged, the under-relaxation.
    let converged = false, kiter = 0, dvmax = 0, nmax = -1, lin = null, innerTotal = 0;
    for (kiter = 1; kiter <= solver.outer; kiter++) {
      curKiter = kiter;
      if (outerIts.backtracking) {
        outerIts.backtrack(kiter, {
          rebuild: () => formulate(tled, false), norm: () => linear.residual(mat, b, x, ibound, rbuf),
          active: ibound, x, xtemp, dvclose: solver.hclose,
        });
      }
      formulate(tled);
      if (ptc && per.steady) {
        // sln_ls: the norm, after the Newton terms and the identity rows.
        const l2norm = linear.residual(mat, b, x, ibound, rres);
        ptc.apply({ kiter, kper: p, kstp, delt, ibound, x, m: mat, b, r: rbuf, l2norm });
      }
      xtemp.set(x);
      lin = linear.solve(mat, b, x, inner);
      innerTotal += lin.iterations;
      if (!x.every(Number.isFinite)) throw brokeDown(p, kstp, kiter);
      // sln_get_dxmax: the largest change of an active cell, with its sign.
      let bigch = 0;
      dvmax = 0; nmax = -1;
      for (let n = 0; n < N; n++) {
        if (ibound[n] < 1) continue;
        const h = x[n] - xtemp[n], a = Math.abs(h);
        if (a > dvmax) { dvmax = a; bigch = h; nmax = n; }
      }
      if (lin.converged && dvmax <= solver.hclose) { converged = true; break; }
      outerIts.relax(kiter, bigch, ibound, x, xtemp);
      // NEWTON UNDER_RELAXATION: heads below the bottom of the model pulled back, and then
      // converged when the changes left and the iteration's own are within hclose (solve).
      if (ibot && newtonUnderRelax(g, ibound, ibot, x, xtemp, outerIts.dxold)
        && Math.abs(maxval(outerIts.dxold)) <= solver.hclose && dvmax <= solver.hclose) { converged = true; break; }
    }
    if (!converged) throw notConverged(p, kstp, dvmax, nmax, lin);
    out.times.push(totim);
    out.periods.push(p);
    out.steps.push(kstp);
    out.iterations.push(kiter);
    out.innerIterations.push(innerTotal);
    // The flows of the budget take the conductances at the final heads (npf_cq): under
    // Newton-Raphson the upstream cell is chosen from them, with the last saturations.
    if (newton) conductances();
    const bud = budget(tled);
    bud.discrepancyWarning = Math.abs(bud.discrepancyPercent) > DISCREPANCY_LIMIT;
    out.budget.push(bud);
    out.flows.push(per.steady ? cellFlows() : null);
    const h = new Float64Array(N);
    for (let n = 0; n < N; n++) h[n] = ibound[n] === 0 || g.pass[n] ? NaN : x[n];
    out.heads.push(h);
    const dryNow = [];
    for (let n = 0; n < N; n++) if (dry[n] && ibound[n] === 0) dryNow.push(n);
    out.dry.push(dryNow);
    for (const o of obsList) out.obs[o.name].push(h[o.n]);
    notices.step(s, dryBoundaries(), bud);
    if (s === schedule.length - 1) out.complete = true;
    if (onStep) onStep(out, s);
    if (progress) progress({ step: s + 1, total: schedule.length, period: p });
    if (!out.complete && shouldStop && shouldStop()) {
      out.stopped = true;
      return out;
    }
  }
  return out;

  // The stress entries on dry cells at the end of this step, which MODFLOW 6 does not apply:
  // wel_cf, riv_cf, drn_cf and ghb_cf set nothing for a cell whose ibound is 0, and rch_cf
  // drops recharge whose column is dry to the bottom (or idomain 0 below a dry cell).
  function dryBoundaries() {
    const found = [];
    for (const [name, pk, width] of [['WEL', wel, 1], ['RIV', riv, 3], ['DRN', drn, 2], ['GHB', ghb, 2]]) {
      if (!pk) continue;
      for (let e = 0; e < pk.node.length; e++) {
        const n = pk.node[e];
        if (ibound[n] !== 0 || !dry[n]) continue;
        if (name === 'WEL' && pk.vals[0][e] === 0) continue;
        const values = [];
        for (let v = 0; v < width; v++) values.push(pk.vals[v][e]);
        found.push({ package: name, n, values });
      }
    }
    if (rch && terms.RCH) {
      const { cells, rate, fixed } = rch.lost(ibound, dry);
      if (cells) found.push({ package: 'RCH', cells, rate, fixed });
    }
    return found;
  }

  function notConverged(p, kstp, dvmax, nmax, lin) {
    const parts = [`The solution did not converge in ${stepName(p, kstp)} after ${solver.outer} outer iteration${solver.outer === 1 ? '' : 's'}`];
    const where = nmax >= 0 ? `, at ${nodeName(nmax, g.nrow, ncol)}` : '';
    parts.push(`: the largest head change in the last one was ${sig(dvmax, 3)} m${where}, against a closure (hclose) of ${sig(solver.hclose, 3)} m`);
    if (lin && !lin.converged) parts.push(`, and the linear solver did not close within ${solver.inner} inner iteration${solver.inner === 1 ? '' : 's'}`);
    let text = `${parts.join('')}. Try more outer or inner iterations, or check the model.`;
    if (periods[p].steady && !chdNode.length && !riv && !ghb && !drn) {
      text += ` Period ${p + 1} is steady and has no constant-head, river, drain or general-head boundary cells, so nothing fixes its heads: a steady model needs at least one.`;
    }
    const err = new Error(text);
    err.code = 'not-converged';
    err.where = { period: p, step: kstp, iterations: solver.outer, maxChange: dvmax, cell: nmax >= 0 ? cellOfNode(nmax) : null };
    err.result = out;
    return err;
  }
  // The linear solve gave heads that are not finite numbers: BICGSTAB broke down, as it can
  // when an ILU(0) or MILU(0) pivot fails in the first factorization and leaves the rows from
  // it unfactored (ims.js ilu0). MODFLOW 6 6.7.0 carries the NaN on and ends abnormally.
  function brokeDown(p, kstp, kiter) {
    const err = new Error(`The linear solver broke down in ${stepName(p, kstp)}, outer iteration ${kiter}: the heads it gave are not finite numbers, so the run stops here. `
      + 'MODFLOW 6 ends abnormally on such a model too. This can happen when the preconditioner meets a pivot that changes sign; try another one (solver.relax 0 for ILU(0), or ILUT with solver.levels).');
    err.code = 'solver-failed';
    err.where = { period: p, step: kstp, iterations: kiter };
    err.result = out;
    return err;
  }
  function cellOfNode(n) {
    return { lay: Math.floor(n / ncpl), row: Math.floor((n % ncpl) / ncol), col: n % ncol };
  }

  // The volumetric budget for the step, as the MODFLOW 6 list file gives it. Package
  // rates use the terms of the last formulation and the final heads (bnd_cq); storage is
  // recomputed from the final heads (sto_cq); CHD is the flow to its active neighbours,
  // counted connection by connection (calc_chd_rate).
  function budget(tled) {
    const inn = {}, outt = {};
    const add = (name, rate) => { if (rate > 0) inn[name] += rate; else outt[name] -= rate; };
    // STO-SY appears only when some cell is convertible, as in the MODFLOW 6 list file.
    if (ss) inn['STO-SS'] = outt['STO-SS'] = 0;
    if (sy) inn['STO-SY'] = outt['STO-SY'] = 0;
    if (tled > 0) {
      for (let n = 0; n < N; n++) {
        if (ibound[n] <= 0) continue;
        const s = storage(n, tled, x[n]);
        add('STO-SS', s[2]);
        if (sy) add('STO-SY', s[3]);
      }
    }
    if (model.chd) {
      inn.CHD = outt.CHD = 0;
      for (const n of chdNode) {
        for (const [m, c] of neighbours(n)) {
          if (ibound[m] <= 0) continue;
          const q = flowInto(n, m, c);  // flow into the CHD cell
          if (q < 0) inn.CHD -= q; else outt.CHD += q;
        }
      }
    }
    for (const name of PACKAGES) {
      if (name === 'CHD' || !PACKAGE_KEYS[name].some((k) => model[k])) continue;
      inn[name] = outt[name] = 0;
      const t = terms[name];
      if (!t) continue;
      for (let e = 0; e < t.node.length; e++) {
        const n = t.node[e];
        if (n < 0 || ibound[n] <= 0) continue;
        add(name, t.hcof[e] * x[n] - t.rhs[e]);
      }
    }
    let totalIn = 0, totalOut = 0;
    for (const v of Object.values(inn)) totalIn += v;
    for (const v of Object.values(outt)) totalOut += v;
    const avg = (totalIn + totalOut) / 2;
    return { in: inn, out: outt, totalIn, totalOut, discrepancyPercent: avg !== 0 ? 100 * (totalIn - totalOut) / avg : 0 };
  }

  // The cell-by-cell flows of the step, the terms MODFLOW 6 writes to its budget file and
  // MODPATH 7 reads (Pollock 2016, OFR 2016-1086): FLOW-JA-FACE (npf_cq) as right, front
  // and lower, the flow out of each cell across its column + 1, row + 1 and layer + 1 faces,
  // from the same conductances and flowInto as the budget; and each package's records entry by
  // entry (bnd_cq), { node, rate } with rate positive into the aquifer and 0 on a cell that is
  // not variable head, CHD's being the net flow from each constant-head cell to its neighbours
  // (calc_chd_rate). Through pass-through cells, every link of the chain is given the flow of
  // its connection (MODFLOW 6's own, from the cell above the chain to the one below).
  function cellFlows() {
    const right = new Float64Array(N), front = new Float64Array(N), lower = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      if (ibound[n] === 0 || g.pass[n]) continue;
      if (cE[n]) right[n] = -flowInto(n, n + 1, cE[n]);
      if (cS[n]) front[n] = -flowInto(n, n + ncol, cS[n]);
      if (cD[n]) {
        lower[n] = -flowInto(n, g.down[n], cD[n]);
        for (let p = n + ncpl; p < N && g.pass[p]; p += ncpl) lower[p] = lower[n];
      }
    }
    const packages = {};
    if (chdNode.length) {
      const rate = new Float64Array(chdNode.length);
      chdNode.forEach((n, e) => {
        const j = n % ncol, i = Math.floor((n % ncpl) / ncol);
        rate[e] = right[n] + front[n] + lower[n] - (j > 0 ? right[n - 1] : 0) - (i > 0 ? front[n - ncol] : 0) - (n >= ncpl ? lower[n - ncpl] : 0);
      });
      packages.CHD = { node: Int32Array.from(chdNode), rate };
    }
    for (const name of PACKAGES) {
      const t = terms[name];
      if (!t) continue;
      const node = [], rate = [];
      for (let e = 0; e < t.node.length; e++) {
        const n = t.node[e];
        if (n < 0) continue;
        node.push(n);
        rate.push(ibound[n] > 0 ? t.hcof[e] * x[n] - t.rhs[e] : 0);
      }
      packages[name] = { node: Int32Array.from(node), rate: Float64Array.from(rate) };
    }
    return { right, front, lower, packages };
  }

  // The flow into cell n from its neighbour m through conductance c (sgwf_npf_qcalc), with
  // PERCHED's head below a perched connection taken at the upper cell's bottom.
  // m may be the cell below or above n past pass-through cells.
  function flowInto(n, m, c) {
    if (perched) {
      if (m === g.down[n] && isPerched(g, m, x)) return c * (bot[n] - x[n]);
      if (n === g.down[m] && isPerched(g, n, x)) return c * (x[m] - bot[m]);
    }
    return c * (x[m] - x[n]);
  }
  function neighbours(n) {
    const list = [], j = n % ncol, i = Math.floor((n % ncpl) / ncol);
    if (j < ncol - 1) list.push([n + 1, cE[n]]);
    if (j > 0) list.push([n - 1, cE[n - 1]]);
    if (i < g.nrow - 1) list.push([n + ncol, cS[n]]);
    if (i > 0) list.push([n - ncol, cS[n - ncol]]);
    if (g.down[n] >= 0) list.push([g.down[n], cD[n]]);
    if (g.above[n] >= 0) list.push([g.above[n], cD[g.above[n]]]);
    return list;
  }
}

// The run's notices, kept up to date after every step so that a run which ends early has
// them too. Each is { kind, text, from, to, ... }, from and to being saved steps (from 0):
//  - 'dry-boundary': a well, river, drain or general-head boundary on a dry cell, which MODFLOW
//    6 does not apply ({ package, lay, row, col, values }, values as in the model's list);
//  - 'dry-recharge': recharge not applied because its column is dry ({ cells, rate }, the
//    largest count and rate, m³/d, over the steps);
//  - 'discrepancy': steps whose budget discrepancy is above DISCREPANCY_LIMIT ({ steps,
//    worst: { index, percent } }).
function noticeBook(out, g) {
  let open = new Map(), rch = null, disc = null;
  const name = (s) => stepName(out.periods[s], out.steps[s]);
  const span = (nt) => (nt.from === nt.to ? `at ${name(nt.from)}` : `from ${name(nt.from)} to ${name(nt.to)}`);
  const rate = (q) => `${sig(q, 4)} m³/d`;
  const text = (nt) => {
    const at = cellName(nt.lay, nt.row, nt.col), v = nt.values;
    switch (nt.package) {
      case 'WEL': return `The well at ${at} (${rate(v[0])}) was in a dry cell ${span(nt)}, so it was not ${v[0] < 0 ? 'pumped' : 'injecting'}: MODFLOW 6 applies no well rate in a dry cell.`;
      case 'RIV': return `The river at ${at} (stage ${sig(v[0], 6)} m) was in a dry cell ${span(nt)}, so it exchanged no water with the aquifer, as in MODFLOW 6.`;
      case 'DRN': return `The drain at ${at} (elevation ${sig(v[0], 6)} m) was in a dry cell ${span(nt)}, so it took no water out, as in MODFLOW 6.`;
      default: return `The general-head boundary at ${at} (head ${sig(v[0], 6)} m) was in a dry cell ${span(nt)}, so it exchanged no water with the aquifer, as in MODFLOW 6.`;
    }
  };
  return {
    step(s, found, bud) {
      const seen = new Map();
      for (const f of found) {
        if (f.package === 'RCH') {
          if (!rch || rch.to !== s - 1) {
            rch = { kind: 'dry-recharge', from: s, to: s, cells: 0, rate: 0 };
            out.notices.push(rch);
          }
          rch.to = s;
          rch.cells = Math.max(rch.cells, f.cells);
          rch.rate = Math.max(rch.rate, f.rate);
          rch.text = `Recharge on ${rch.cells === 1 ? '1 cell' : `up to ${rch.cells} cells`} (${rch.cells === 1 ? '' : 'up to '}${rate(rch.rate)}) was not applied ${span(rch)}: ${f.fixed ? 'each such cell is dry, and with FIXED_CELL MODFLOW 6 does not pass its recharge to the cell below' : 'each such column is dry down to its lowest cell, and MODFLOW 6 puts recharge only on an active cell'}.`;
          continue;
        }
        const key = `${f.package}|${f.n}|${f.values.join(',')}`;
        let nt = open.get(key);
        if (!nt) {
          nt = { kind: 'dry-boundary', package: f.package, lay: Math.floor(f.n / g.ncpl), row: Math.floor((f.n % g.ncpl) / g.ncol), col: f.n % g.ncol, values: f.values, from: s, to: s };
          out.notices.push(nt);
        }
        nt.to = s;
        nt.text = text(nt);
        seen.set(key, nt);
      }
      open = seen;
      if (bud.discrepancyWarning) {
        if (!disc) {
          disc = { kind: 'discrepancy', steps: [], worst: { index: s, percent: bud.discrepancyPercent } };
          out.notices.push(disc);
        }
        disc.steps.push(s);
        if (Math.abs(bud.discrepancyPercent) > Math.abs(disc.worst.percent)) disc.worst = { index: s, percent: bud.discrepancyPercent };
        disc.from = disc.steps[0];
        disc.to = s;
        const n = disc.steps.length;
        disc.text = `The budget discrepancy is above ${DISCREPANCY_LIMIT} % at ${n === 1 ? '1 time step' : `${n} time steps`}, the largest ${sig(disc.worst.percent, 3)} % at ${name(disc.worst.index)}: the heads and budget there cannot be trusted. `
          + 'A converged run balances to far less. Tighten the solver closures (hclose, rclose), and look for extreme values: a very large K or rate, or very short time steps.';
      }
    },
  };
}

function linSat(tp, bt, h) {
  // sQuadraticSaturation with omega = 0, the standard formulation: linear between bottom and top.
  if (h <= bt) return 0;
  if (h >= tp) return 1;
  return (h - bt) / (tp - bt);
}
