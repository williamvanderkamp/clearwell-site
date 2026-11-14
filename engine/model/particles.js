// Particle tracking: Pollock's semi-analytical method, as MODPATH 7 uses it (Pollock 2016,
// USGS Open-File Report 2016-1086; Pollock 1988, Groundwater 26(6), 743-750). See
// docs/design/model-tools.md section 2 and docs/tools/model-particles.md.
//
// The method (OFR 2016-1086, eq. 1-10): each face's velocity is its flow over the face area
// and the porosity; inside a cell each component varies linearly between its two faces, so
// a particle's time to each face, and where it is when it gets there, follow in closed form.
// The particle leaves by the face it reaches first, and the next cell takes over.
//
// Every detail follows the MODPATH 7.2.001 source as released (github.com/MODFLOW-USGS/
// modpath-v7, commit d0bb65d, December 2017), the version the tests run, because those
// details decide where a particle ends up:
//  - TrackSubCell.f90: the time to each face, the 1e-4 test for a uniform velocity, the
//    nudge off a divide, and the order in which faces are tried;
//  - TrackCell.f90: when a particle stops (no exit face, a weak sink or source under the
//    option chosen, an inactive cell);
//  - ModpathCellData.f90: the face flows of a cell, a package flow with an IFACE put on a
//    boundary face or else inside the cell, and the saturated thickness of a convertible cell;
//  - ParticleTrackingEngine.f90: which package flows are sources and which sinks, dry
//    cells, and the move from one cell to the next.
//
// The flows are the flow model's own (run.js cellFlows): the FLOW-JA-FACE and package records
// MODFLOW 6 writes to its budget file, which is where MODPATH 7 takes them from, so each cell's
// face flows and package flows balance.

import { buildGrid, cellName, nodeName, oneLayer } from './grid.js';

const PACKAGES = ['CHD', 'WEL', 'RCH', 'EVT', 'RIV', 'DRN', 'GHB'];

// What a particle's end means, by MODPATH 7's endpoint status code (MPath7.f90).
const STATUS = {
  forward: { 1: 'reached max time', 2: 'left at a boundary', 3: 'stopped in a weak sink', 4: 'stopped in a weak source', 5: 'reached a sink', 7: 'dry', 9: 'undefined' },
  // Backward, the flow is reversed: what stops a particle is a source of the real flow.
  backward: { 1: 'reached max time', 2: 'left at a boundary', 3: 'stopped in a weak sink', 4: 'stopped in a weak source', 5: 'reached a source', 7: 'dry', 9: 'undefined' },
};

// MODPATH 7's stop time when none is given (ParticleTrackingOptions.f90).
const NO_STOP = 1e30;

// --- flows ---------------------------------------------------------------------------

/**
 * The face flows and package flows of one saved step, as MODPATH 7 reads them from MODFLOW
 * 6's budget file: the run's own cell-by-cell flows (run.js cellFlows, FLOW-JA-FACE and each
 * package's records), not flows rebuilt from the heads, so every option of the flow model
 * (K22, VARIABLECV, PERCHED, THICKSTRT, Newton-Raphson, REWET, EVT, the layer and FIXED_CELL
 * of recharge and ET) is in them as the solver had it, and each cell balances.
 * Returns per cell (n = k*nrow*ncol + i*ncol + j): right, front and lower, the flow out
 * across the column + 1, row + 1 and layer + 1 faces (m³/d); active (1 where the cell has
 * a head); and packages, each package's [{ n, rate }] entry by entry, rate positive into
 * the aquifer.
 */
export function faceFlows(model, result, step) {
  const g = buildGrid(model);
  const { N, domain } = g;
  if (!result || !Array.isArray(result.heads) || !result.heads.length) throw new Error('There is no run result to track particles through.');
  if (!Number.isInteger(step) || step < 0 || step >= result.heads.length) throw new Error(`Step ${step} (counted from 0) is not one of the run's ${result.heads.length} saved steps.`);
  const fl = result.flows && result.flows[step];
  if (!fl) throw new Error('The run holds no cell-by-cell flows for this step (it is not a steady step, or the run is from before they were kept): run the model again.');
  const h = result.heads[step];
  const period = result.periods ? result.periods[step] : 0;
  // Dry as MODPATH 7 takes a cell of a MODFLOW 6 grid (ParticleTrackingEngine LoadTimeStep):
  // no head (HDRY, or idomain 0), or a convertible cell whose head is below its bottom, which
  // only the Newton-Raphson formulation leaves active.
  const active = new Uint8Array(N);
  for (let n = 0; n < N; n++) active[n] = domain[n] && Number.isFinite(h[n]) && !(g.icelltype[n] && h[n] < g.bot[n]) ? 1 : 0;
  const packages = {};
  for (const [name, { node, rate }] of Object.entries(fl.packages)) packages[name] = Array.from(node, (n, e) => ({ n, rate: rate[e] }));
  return { grid: g, heads: h, active, right: fl.right, front: fl.front, lower: fl.lower, packages, period };
}

// --- the cell data MODPATH 7 builds ------------------------------------------------------

function checkOptions(model, result, opts) {
  const o = opts || {};
  if (o.direction !== 'forward' && o.direction !== 'backward') throw new Error("Choose the direction: 'forward' or 'backward'.");
  for (const key of ['weakSinks', 'weakSources']) {
    // MODPATH 7 leaves this to the modeller (OFR 2016-1086, p. 19), so there is no default.
    if (o[key] !== 'pass' && o[key] !== 'stop') throw new Error(`Choose ${key}: 'pass' (particles go on through) or 'stop' (particles stop on entering such a cell), as MODPATH 7 offers.`);
  }
  if (o.porosity == null) throw new Error('Give the porosity for each layer (a number, or nrow*ncol values).');
  const iface = o.iface || {};
  for (const [k, v] of Object.entries(iface)) {
    if (!PACKAGES.includes(k)) throw new Error(`iface: ${k} is not one of ${PACKAGES.join(', ')}.`);
    if (!Number.isInteger(v) || v < 0 || v > 6) throw new Error(`iface: ${k} must be a whole number from 0 to 6.`);
  }
  if (o.maxTime != null && !(o.maxTime > 0)) throw new Error('maxTime must be above zero.');
  let step = o.step;
  if (step == null) {
    // The design: steady state uses the last saved step. Anything else must be said.
    const last = result.heads.length - 1;
    const p = result.periods ? result.periods[last] : 0;
    if (!model.periods[p].steady) throw new Error('Say which saved step to track through (step).');
    step = last;
  }
  const p = result.periods ? result.periods[step] : 0;
  if (!model.periods[p] || !model.periods[p].steady) {
    // MODPATH 7 tracks a transient run step by step, with storage as a source or sink;
    // that is not built here, and holding one transient step's flows fixed is not MODPATH's method.
    throw new Error('Particle tracking here needs a steady-state step; tracking through transient steps is not built yet.');
  }
  return { ...o, iface, step };
}

/** Build the tracking state for one step: face flows, porosity and MODPATH 7's per-cell data. */
function prepare(model, result, o) {
  const f = faceFlows(model, result, o.step);
  const g = f.grid;
  const { N, nlay, nrow, ncol, ncpl, top, bot, delr, delc, icelltype } = g;
  const porosity = new Float64Array(N);
  if (!Array.isArray(o.porosity) || o.porosity.length !== nlay) throw new Error(`porosity needs one entry per layer (${nlay}).`);
  for (let k = 0; k < nlay; k++) porosity.set(oneLayer(o.porosity[k], ncpl, `porosity, layer ${k + 1}`, ncol), k * ncpl);
  for (let n = 0; n < N; n++) {
    if (g.domain[n] && !(porosity[n] > 0 && porosity[n] <= 1)) throw new Error(`Every active cell needs a porosity above 0 and at most 1; at ${nodeName(n, nrow, ncol)} it is ${porosity[n]}.`);
  }

  // Sources, sinks and IFACE flows (ParticleTrackingEngine LoadTimeStep): an entry with an
  // IFACE above 0 adds to that face's boundary flow; otherwise a positive rate is a source
  // and a negative one a sink, spread through the cell.
  const source = new Float64Array(N), sink = new Float64Array(N), bflow = new Float64Array(6 * N);
  for (const [name, entries] of Object.entries(f.packages)) {
    const iface = o.iface[name] || 0;
    for (const { n, rate } of entries) {
      if (iface > 0) bflow[6 * n + iface - 1] += rate;
      else if (rate > 0) source[n] += rate;
      else if (rate < 0) sink[n] += rate;
    }
  }

  // Cell edges as MODPATH 7 places them: x from the grid's left edge, y from its front edge
  // (the far side of the last row), so local y runs from the row + 1 face (0) to the row - 1
  // face (1).
  const X = new Float64Array(ncol + 1), Y = new Float64Array(nrow + 1);
  for (let j = 0; j < ncol; j++) X[j + 1] = X[j] + delr[j];
  for (let i = 0; i < nrow; i++) Y[0] += delc[i];
  for (let i = 0; i < nrow; i++) Y[i + 1] = Y[i] - delc[i];

  const cells = new Array(N);
  const neighbour = (n, face) => {
    const k = Math.floor(n / ncpl), i = Math.floor((n % ncpl) / ncol), j = n % ncol;
    let m = -1;
    if (face === 1 && j > 0) m = n - 1;
    else if (face === 2 && j < ncol - 1) m = n + 1;
    else if (face === 3 && i < nrow - 1) m = n + ncol;
    else if (face === 4 && i > 0) m = n - ncol;
    // Past vertical pass-through cells (idomain −1), to the cell MODFLOW 6 connects.
    else if (face === 5 && k < nlay - 1) m = g.pass[n + ncpl] ? g.down[n] : n + ncpl;
    else if (face === 6 && k > 0) m = g.pass[n - ncpl] ? g.up[n - ncpl] : n - ncpl;
    return m >= 0 && g.domain[m] ? m : -1;
  };

  function cellData(n) {
    if (cells[n]) return cells[n];
    const k = Math.floor(n / ncpl), i = Math.floor((n % ncpl) / ncol), j = n % ncol;
    const h = f.heads[n];
    // Face flows in the + coordinate direction (ModpathCellData SetDataStructured):
    // faces 1, 2 are x (columns), 3, 4 are y (3 the front, row + 1), 5, 6 are z (5 the bottom).
    const Q = [
      j > 0 ? f.right[n - 1] : 0,
      f.right[n],
      -f.front[n],
      i > 0 ? -f.front[n - ncol] : 0,
      -f.lower[n],
      k > 0 ? -f.lower[n - ncpl] : 0,
    ];
    const conn = [1, 2, 3, 4, 5, 6].map((face) => neighbour(n, face));
    let src = source[n], snk = sink[n];
    for (let face = 1; face <= 6; face++) {
      const b = bflow[6 * n + face - 1];
      if (b === 0) continue;
      const m = conn[face - 1];
      // A boundary face has no neighbour in the model; otherwise the flow stays inside the
      // cell. A dry neighbour does not make a boundary face in MODPATH 7.2.001 (its
      // ModpathCellData tests the fixed IBOUND, not the step's); later MODPATH source does.
      if (m < 0) Q[face - 1] = face % 2 ? b : -b;
      else if (b > 0) src += b;
      else snk += b;
    }
    // Saturated thickness (GetDZ): a convertible cell below its top is saturated to its head.
    let dz = top[n] - bot[n];
    if (icelltype[n]) {
      if (h < top[n]) dz = h - bot[n];
      if (dz <= 0) dz = 1e-4;
    }
    // The top used for z (LoadTimeStep SaturatedTop): the head in a convertible cell whose
    // head is within it, otherwise the cell top.
    const satTop = icelltype[n] && f.active[n] && h <= top[n] && h >= bot[n] ? h : top[n];
    const cellY = (Y[i] + Y[i + 1]) / 2, cellX = (X[j] + X[j + 1]) / 2;
    const c = {
      n, k, i, j, Q, conn, source: src, sink: snk, dx: delr[j], dy: delc[i], dz,
      left: cellX - delr[j] / 2, right: cellX + delr[j] / 2, front: cellY - delc[i] / 2, back: cellY + delc[i] / 2,
      bottom: bot[n], satTop, porosity: porosity[n], active: f.active[n] === 1,
    };
    cells[n] = c;
    return c;
  }
  return { flows: f, grid: g, cellData, porosity };
}

// --- Pollock's method, one cell (TrackSubCell.f90) ------------------------------------

// Time to the exit face in one direction (pr_CalculateDT). Returns [status, v, dvdx, dt]:
// status 0 linear velocity, 1 uniform, 2 zero, 3 no outflow in this direction.
function calculateDT(v1, v2, dx, xL) {
  let dt = 1e20;
  const v2a = Math.abs(v2), v1a = Math.abs(v1), dv = v2 - v1, dva = Math.abs(dv);
  const tol = 1e-15;
  if (v2a < tol && v1a < tol) return [2, 0, 0, dt];
  // Nearly uniform: MODPATH treats a relative change below 1e-4 as constant velocity.
  const vv = Math.max(v1a, v2a);
  if (dva / vv < 1e-4) {
    const x = xL * dx;
    if (v1 > tol) dt = (dx - x) / v1;
    if (v1 < -tol) dt = -x / v1;
    return [1, v1, 0, dt];
  }
  const dvdx = dv / dx;
  let v = (1 - xL) * v1 + xL * v2;
  if (!(v1 < 0) && !(v2 > 0)) return [3, v, dvdx, dt];
  // On a divide exactly: nudge the velocity so the particle leaves it.
  if (v1 <= 0 && v2 >= 0 && Math.abs(v) <= 0) v = v2 <= 0 ? -1e-20 : 1e-20;
  const vr1 = v1 / v, vr2 = v2 / v;
  let vr = vr1 <= 0 ? vr2 : vr1;
  if (v1 * v2 > 0) {
    if (v > 0) vr = vr2;
    if (v < 0) vr = vr1;
  }
  dt = Math.log(vr) / dvdx;
  return [0, v, dvdx, dt];
}

// Position after dt in one direction (pr_NewXYZ, eq. 8).
function newXYZ(v, dvdx, v1, dt, x, dx, status) {
  let nx = x;
  if (status === 1) nx += v1 * dt / dx;
  else if (v !== 0) nx += v * (Math.exp(dvdx * dt) - 1) / dvdx / dx;
  return nx < 0 ? 0 : nx > 1 ? 1 : nx;
}

// Track through one cell from loc until a face or maxTime (TrackCell + TrackSubCell for a
// structured cell, which is its own single sub-cell). Returns { status, face, loc }:
// status 'exit' | 'maxTime' | 'noExit' | 'weakSink' | 'weakSource' | 'undefined'.
function trackCell(c, loc, maxTime, backward, opts) {
  const sign = backward ? -1 : 1;
  const q = c.Q.map((x) => sign * x);
  // HasExitFace (ModpathCellData): outflow across some face.
  const hasExit = q[0] < 0 || q[1] > 0 || q[2] < 0 || q[3] > 0 || q[4] < 0 || q[5] > 0;
  // Steady state: no exit face means the particle has reached a strong sink.
  if (!hasExit) return { status: 'noExit', loc };
  if (backward) {
    if (opts.weakSources === 'stop' && c.source !== 0) return { status: 'weakSource', loc };
  } else if (opts.weakSinks === 'stop' && c.sink !== 0) return { status: 'weakSink', loc };

  // Face velocities (FillSubCellDataBuffer, eq. 1), retardation 1.
  const nr = c.porosity;
  const vx1 = q[0] / c.dy / c.dz / nr, vx2 = q[1] / c.dy / c.dz / nr;
  const vy1 = q[2] / c.dx / c.dz / nr, vy2 = q[3] / c.dx / c.dz / nr;
  const vz1 = q[4] / c.dx / c.dy / nr, vz2 = q[5] / c.dx / c.dy / nr;
  // The sub-cell's own exit test: always the same faces as the cell's for one sub-cell.
  if (!(vx1 < 0 || vx2 > 0 || vy1 < 0 || vy2 > 0 || vz1 < 0 || vz2 > 0)) return { status: 'noExit', loc };

  const [sx, vx, ax, dtx] = calculateDT(vx1, vx2, c.dx, loc.x);
  const [sy, vy, ay, dty] = calculateDT(vy1, vy2, c.dy, loc.y);
  const [sz, vz, az, dtz] = calculateDT(vz1, vz2, c.dz, loc.z);
  let face = 0, dt = 1e30;
  if (sx < 2 || sy < 2 || sz < 2) {
    dt = dtx;
    if (vx < 0) face = 1; else if (vx > 0) face = 2;
    if (dty < dt) { dt = dty; if (vy < 0) face = 3; else if (vy > 0) face = 4; }
    if (dtz < dt) { dt = dtz; if (vz < 0) face = 5; else if (vz > 0) face = 6; }
  }
  let t = loc.t + dt;
  if (maxTime < t) {
    dt = maxTime - loc.t;
    t = maxTime;
    return {
      status: 'maxTime', face: 0,
      loc: { x: newXYZ(vx, ax, vx1, dt, loc.x, c.dx, sx), y: newXYZ(vy, ay, vy1, dt, loc.y, c.dy, sy), z: newXYZ(vz, az, vz1, dt, loc.z, c.dz, sz), t },
    };
  }
  let x, y, z;
  if (face === 1 || face === 2) {
    x = face === 2 ? 1 : 0;
    y = newXYZ(vy, ay, vy1, dt, loc.y, c.dy, sy);
    z = newXYZ(vz, az, vz1, dt, loc.z, c.dz, sz);
  } else if (face === 3 || face === 4) {
    x = newXYZ(vx, ax, vx1, dt, loc.x, c.dx, sx);
    y = face === 4 ? 1 : 0;
    z = newXYZ(vz, az, vz1, dt, loc.z, c.dz, sz);
  } else if (face === 5 || face === 6) {
    x = newXYZ(vx, ax, vx1, dt, loc.x, c.dx, sx);
    y = newXYZ(vy, ay, vy1, dt, loc.y, c.dy, sy);
    z = face === 6 ? 1 : 0;
  } else return { status: 'undefined', loc };
  return { status: 'exit', face, loc: { x, y, z, t } };
}

// A point in the cell, in model coordinates (ConvertToModelXYZ).
function point(c, loc) {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  return {
    x: clamp((1 - loc.x) * c.left + loc.x * c.right, c.left, c.right),
    y: clamp((1 - loc.y) * c.front + loc.y * c.back, c.front, c.back),
    z: clamp((1 - loc.z) * c.bottom + loc.z * c.satTop, c.bottom, c.satTop),
    t: loc.t, lay: c.k, row: c.i, col: c.j, xl: loc.x, yl: loc.y, zl: loc.z,
  };
}

// The local position across a face in the next cell (ConvertFromNeighbor).
const ENTRY = { 1: ['x', 1], 2: ['x', 0], 3: ['y', 1], 4: ['y', 0], 5: ['z', 1], 6: ['z', 0] };

function trackOne(state, start, o) {
  const { grid: g, cellData } = state;
  const backward = o.direction === 'backward';
  const maxTime = o.maxTime != null ? o.maxTime : NO_STOP;
  const { lay, row, col } = start;
  if (![lay, row, col].every(Number.isInteger) || lay < 0 || lay >= g.nlay || row < 0 || row >= g.nrow || col < 0 || col >= g.ncol) {
    throw new Error(`Particle ${start.id}: ${[lay, row, col].every(Number.isInteger) ? cellName(lay, row, col) : `the cell [${lay}, ${row}, ${col}]`} is outside the grid of ${g.nlay} layers, ${g.nrow} rows and ${g.ncol} columns.`);
  }
  for (const key of ['x', 'y', 'z']) {
    if (!(start[key] >= 0 && start[key] <= 1)) throw new Error(`Particle ${start.id}: local ${key} must be from 0 to 1.`);
  }
  let n = lay * g.ncpl + row * g.ncol + col;
  if (!g.domain[n]) throw new Error(`Particle ${start.id}: ${cellName(lay, row, col)} is not in the model (idomain 0).`);
  let c = cellData(n);
  let loc = { x: start.x, y: start.y, z: start.z, t: 0 };
  const points = [point(c, loc)];
  // MODPATH 7 does not release a particle in a dry cell (MPath7.f90, status 7).
  if (!c.active) return finish(start, points, 7, o);
  for (let guard = 0; guard < 1e7; guard++) {
    const r = trackCell(c, loc, maxTime, backward, o);
    if (r.status === 'exit') {
      points.push(point(c, r.loc));
      const m = c.conn[r.face - 1];
      // Out of the grid, or into an inactive or dry cell: the particle has left at a boundary.
      if (m < 0 || !state.flows.active[m]) return finish(start, points, 2, o);
      const [key, v] = ENTRY[r.face];
      loc = { ...r.loc, [key]: v };
      n = m;
      c = cellData(n);
    } else if (r.status === 'maxTime') {
      points.push(point(c, r.loc));
      return finish(start, points, 1, o);
    } else {
      // The particle stops where it entered this cell (TrackPath adds that point again).
      points.push(point(c, loc));
      const code = { noExit: 5, weakSink: 3, weakSource: 4, undefined: 9 }[r.status];
      return finish(start, points, code, o);
    }
  }
  throw new Error(`Particle ${start.id} crossed too many cells.`);
}

function finish(start, points, code, o) {
  return { id: start.id, points, status: STATUS[o.direction][code], code };
}

/**
 * Track particles through one steady-state step of a run (docs/design/model-tools.md).
 * opts: porosity (per layer, a number or nrow*ncol values), direction ('forward' or
 * 'backward'), weakSinks and weakSources ('pass' or 'stop', as MODPATH 7 offers; required),
 * starts [{ id, lay, row, col, x, y, z }] in local cell coordinates 0..1 (y = 0 on the row + 1
 * side, z = 0 at the bottom of the saturated part), and optionally step, maxTime (days) and
 * iface ({ RCH: 6, RIV: 6, ... }: the face each package's flow crosses, MODPATH's default
 * IFACE; a package not named is spread through its cell, IFACE 0, as MODPATH does).
 * Returns { paths: [{ id, points: [{ x, y, z, t, lay, row, col, xl, yl, zl }], status, code }] },
 * x and y in metres from the grid's left and front edges, z the elevation, t the tracking time
 * in days (positive both ways) and code MODPATH 7's endpoint status number.
 */
export function track(model, result, opts) {
  const o = checkOptions(model, result, opts);
  if (!Array.isArray(o.starts) || !o.starts.length) throw new Error('Give at least one starting point.');
  const state = prepare(model, result, o);
  return { paths: o.starts.map((s) => trackOne(state, s, o)) };
}

/**
 * The capture zone of a well: particles released on the four side faces of the well's cell
 * (particlesPerFace on each, at mid-depth) and tracked backward. For each travel time in
 * times, the particles' positions at that time (where each would be if MODPATH 7 stopped
 * there) and the outline through them, in release order around the cell; and the endpoints
 * of the tracking run to the end.
 * opts: well { lay, row, col }, porosity, times (days), particlesPerFace, weakSinks,
 * weakSources, and optionally step, iface, maxTime.
 */
export function captureZone(model, result, opts) {
  const o = opts || {};
  const w = o.well;
  if (!w || ![w.lay, w.row, w.col].every(Number.isInteger)) throw new Error('Give the well as { lay, row, col }.');
  if (!Number.isInteger(o.particlesPerFace) || o.particlesPerFace < 1) throw new Error('particlesPerFace must be a whole number of at least 1.');
  const times = o.times || [];
  if (!Array.isArray(times) || times.some((t) => !(t > 0))) throw new Error('times must be a list of travel times above zero.');
  const k = o.particlesPerFace, s = Array.from({ length: k }, (_, i) => (i + 0.5) / k);
  // The faces in MODPATH's order: 1 (x = 0), 2 (x = 1), 3 (y = 0), 4 (y = 1).
  const starts = [];
  for (const v of s) starts.push({ x: 0, y: v });
  for (const v of s) starts.push({ x: 1, y: v });
  for (const v of s) starts.push({ x: v, y: 0 });
  for (const v of s) starts.push({ x: v, y: 1 });
  const all = starts.map((p, id) => ({ id, lay: w.lay, row: w.row, col: w.col, x: p.x, y: p.y, z: 0.5 }));
  // Around the cell anticlockwise from its south-west corner: face 3 west to east, face 2
  // south to north, face 4 east to west, face 1 north to south.
  const ring = [...range(2 * k, 3 * k), ...range(k, 2 * k), ...range(3 * k, 4 * k).reverse(), ...range(0, k).reverse()];
  const base = { ...o, direction: 'backward', starts: all };
  delete base.times;
  const full = track(model, result, base);
  const zones = times.map((T) => {
    const r = track(model, result, { ...base, maxTime: o.maxTime != null ? Math.min(T, o.maxTime) : T });
    const at = r.paths.map((p) => ({ ...p.points[p.points.length - 1], id: p.id, status: p.status }));
    return { time: T, points: at, outline: ring.map((id) => ({ x: at[id].x, y: at[id].y })) };
  });
  const endpoints = full.paths.map((p) => ({ ...p.points[p.points.length - 1], id: p.id, status: p.status, code: p.code }));
  return { starts: all, paths: full.paths, endpoints, zones, ring };
}

function range(a, b) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}
