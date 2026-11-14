// Parameter estimation for the flow model, as PEST does it (Doherty 2015; second edition
// 2025, section 7.4): the model is run with trial parameter values, and the weighted sum of
// squared differences between measured and computed heads is brought to its least by the
// Levenberg-Marquardt method. The search and its statistics are lsq.js's leastSquares,
// unchanged; this module turns a model and a set of measured heads into the function
// leastSquares fits, and adds the diagnostics of Hill (1998, USGS WRIR 98-4005) as
// MODFLOW-2000 prints them (Hill and others 2000, USGS OFR 00-184), which Hill and Tiedeman
// (2007) carry on: dimensionless and composite scaled sensitivities, parameter correlation,
// and the weighted residual summary.
//
// Weights: leastSquares minimizes sum (y - f)^2. Hill's objective (WRIR 98-4005 eq. 1) is
// sum w (y - f)^2, which is the same sum with y and f each multiplied by w^1/2, so the fit
// is given the weighted heads, and its residuals, error variance and covariance are Hill's
// weighted ones (eq. 14 and 26).
//
// Metres and days throughout. See docs/tools/model-calibrate.md.
import { run, timeWeights } from './run.js';
import { buildGrid, cellName } from './grid.js';
import { leastSquares, logScale } from '../lsq.js';
import { invertSPD } from '../linalg.js';
import { normalQuantile } from '../trend.js';
import { isNum } from '../numeric.js';
import { sig } from '../format.js';

// ---------------------------------------------------------------------------------------
// Ready-made parameters. Each returns { id, label, kind, apply(model, value), start, ... }
// as calibrate() takes them. apply() edits a fresh copy of the model as it was given, so a
// multiplier always multiplies the model's own values, never the last trial's.

// Edits every cell of a per-layer input (a number or nrow*ncol values per layer) that the
// mask marks, mask being nlay*nrow*ncol values or null for every cell. A layer that is a
// number and wholly inside the zone stays a number, so the MODFLOW 6 files stay small.
function editLayers(layers, nlay, ncpl, mask, fn, label) {
  if (!Array.isArray(layers) || layers.length !== nlay) throw new Error(`${label} needs one entry per layer (${nlay}).`);
  for (let k = 0; k < nlay; k++) {
    const v = layers[k];
    if (!mask && typeof v === 'number') { layers[k] = fn(v); continue; }
    let touched = !mask;
    if (mask) for (let c = 0; c < ncpl && !touched; c++) if (mask[k * ncpl + c]) touched = true;
    if (!touched) continue;
    const arr = typeof v === 'number' ? new Array(ncpl).fill(v) : Array.from(v);
    for (let c = 0; c < ncpl; c++) if (!mask || mask[k * ncpl + c]) arr[c] = fn(arr[c]);
    layers[k] = arr;
  }
}

function dims(model) {
  const g = model.grid;
  return { nlay: g.nlay, ncpl: g.nrow * g.ncol, N: g.nlay * g.nrow * g.ncol };
}

function checkMask(mask, size, label) {
  if (mask == null) return null;
  if (!mask || mask.length !== size) throw new Error(`${label}: the zone needs ${size} values (1 in the zone, 0 outside), or null for every cell.`);
  let any = false;
  for (let i = 0; i < size; i++) if (mask[i]) { any = true; break; }
  if (!any) throw new Error(`${label}: the zone has no cells.`);
  return mask;
}

const base = (o, kind, label) => {
  if (typeof o.id !== 'string' || !o.id) throw new Error('Every parameter needs an id.');
  return { id: o.id, label: o.label || label, kind, start: o.start, fixed: !!o.fixed, min: o.min, max: o.max };
};

/**
 * A multiplier on k in a zone. k33 must be said: 'tied' multiplies k33 by the same value,
 * so the anisotropy k/k33 stays as given; 'held' leaves k33 as it is. K22, where the model
 * gives it, is multiplied with k, so the horizontal anisotropy K22/K stays as given: it is the
 * same K in the other horizontal direction (MODFLOW 6 NPF, gwf-npf.dfn K22).
 *   zone: nlay*nrow*ncol values (truthy in the zone), or null for the whole model.
 */
export function zoneK(o) {
  if (o.k33 !== 'tied' && o.k33 !== 'held') throw new Error(`${o.id}: say whether k33 is 'tied' to k or 'held'.`);
  const p = base(o, 'K', 'K multiplier');
  p.zone = o.zone ?? null;
  p.k33 = o.k33;
  p.apply = (m, v) => {
    const { nlay, ncpl, N } = dims(m);
    const mask = checkMask(p.zone, N, p.id);
    editLayers(m.npf.k, nlay, ncpl, mask, (x) => x * v, 'npf.k');
    // MODFLOW 6 sets k33 = k when k33 is not given, so it follows k either way then.
    if (p.k33 === 'tied' && m.npf.k33 != null) editLayers(m.npf.k33, nlay, ncpl, mask, (x) => x * v, 'npf.k33');
    // MODFLOW 6 sets K22 = K when it is not given, so it follows k then too.
    if (m.npf.k22 != null) editLayers(m.npf.k22, nlay, ncpl, mask, (x) => x * v, 'npf.k22');
  };
  return p;
}

/**
 * Recharge in a zone, as a rate (as: 'value', m/d) or a multiplier on the model's own
 * rates (as: 'multiplier'), in the listed periods of model.rch (null for every one).
 *   zone: nrow*ncol values (truthy in the zone), or null for every cell.
 */
export function recharge(o) {
  if (o.as !== 'value' && o.as !== 'multiplier') throw new Error(`${o.id}: say whether recharge is fitted as a 'value' or a 'multiplier'.`);
  const p = base(o, o.as === 'value' ? 'recharge' : 'recharge multiplier', o.as === 'value' ? 'Recharge' : 'Recharge multiplier');
  p.zone = o.zone ?? null;
  p.periods = o.periods ?? null;
  p.as = o.as;
  p.apply = (m, v) => {
    if (!m.rch) throw new Error(`${p.id}: the model has no recharge (rch).`);
    const { ncpl } = dims(m);
    const mask = checkMask(p.zone, ncpl, p.id);
    const keys = p.periods ? p.periods.map(String) : Object.keys(m.rch);
    for (const key of keys) {
      if (!(key in m.rch)) throw new Error(`${p.id}: the model's recharge has no entry for period ${Number(key) + 1} (keyed ${key}).`);
      const fn = p.as === 'value' ? () => v : (x) => x * v;
      const cur = [m.rch[key]];
      editLayers(cur, 1, ncpl, mask, fn, `rch, period ${Number(key) + 1}`);
      m.rch[key] = cur[0];
    }
  };
  return p;
}

/**
 * A multiplier on the conductance of the river cells in a zone, in every period.
 *   zone: nlay*nrow*ncol values (truthy in the zone), or null for every river cell.
 */
export function riverConductance(o) {
  const p = base(o, 'riverbed', 'Riverbed conductance multiplier');
  p.zone = o.zone ?? null;
  p.apply = (m, v) => {
    if (!m.riv) throw new Error(`${p.id}: the model has no river cells (riv).`);
    const { ncpl, N } = dims(m);
    const mask = checkMask(p.zone, N, p.id);
    const ncol = m.grid.ncol;
    let count = 0;
    // A list can be shared by several periods (structuredClone keeps the sharing), so each
    // entry is multiplied once.
    const done = new Set();
    for (const list of Object.values(m.riv)) {
      for (const e of list) {
        if (done.has(e) || (mask && !mask[e[0] * ncpl + e[1] * ncol + e[2]])) continue;
        done.add(e);
        e[4] *= v;
        count++;
      }
    }
    if (!count) throw new Error(`${p.id}: no river cell is in the zone.`);
  };
  return p;
}

// Specific storage (per metre), the storage coefficient or specific yield in a zone, as the
// value itself. coefficient: the model's sto.ss is the storage coefficient (STORAGECOEFFICIENT).
function zoneStorage(o, key, kind, label, coefficient) {
  const p = base(o, kind, label);
  p.zone = o.zone ?? null;
  p.apply = (m, v) => {
    if (!m.sto) throw new Error(`${p.id}: the model has no storage (sto); it is steady state.`);
    // The same numbers mean another thing with STORAGECOEFFICIENT, so a parameter says which it is.
    if (coefficient !== undefined && coefficient !== Boolean(m.sto.storagecoefficient)) {
      throw new Error(`${p.id}: the model's sto.ss is ${m.sto.storagecoefficient ? 'the storage coefficient S (STORAGECOEFFICIENT)' : 'specific storage Ss, per m'}, but the parameter is for ${coefficient ? 'the storage coefficient' : 'specific storage'}.`);
    }
    const { nlay, ncpl, N } = dims(m);
    editLayers(m.sto[key], nlay, ncpl, checkMask(p.zone, N, p.id), () => v, `sto.${key}`);
  };
  return p;
}
/**
 * Specific storage Ss (per metre) in a zone: nlay*nrow*ncol values, or null for all. With
 * coefficient: true, the model's sto.ss is the storage coefficient S (STORAGECOEFFICIENT), no
 * unit, fitted as kind 'S'; the parameter and the model must agree on which it is.
 */
export const zoneSs = (o) => (o.coefficient === true
  ? zoneStorage(o, 'ss', 'S', 'Storage coefficient', true)
  : zoneStorage(o, 'ss', 'Ss', 'Specific storage', false));
/** Specific yield Sy in a zone: nlay*nrow*ncol values, or null for all. */
export const zoneSy = (o) => zoneStorage(o, 'sy', 'Sy', 'Specific yield');

const MAKERS = { zoneK, recharge, riverConductance, zoneSs, zoneSy };

/**
 * A ready-made parameter from plain data, { type: 'zoneK' | 'recharge' | 'riverConductance'
 * | 'zoneSs' | 'zoneSy', ...its options }, since a function cannot be sent to a Web Worker.
 */
export function fromSpec(spec) {
  const make = MAKERS[spec && spec.type];
  if (!make) throw new Error(`There is no ready-made parameter called ${spec && spec.type}.`);
  return make(spec);
}

// ---------------------------------------------------------------------------------------
// Running the model for a set of parameter values.

function checkParams(params) {
  if (!Array.isArray(params) || !params.length) throw new Error('Give at least one parameter.');
  const seen = new Set();
  for (const p of params) {
    if (typeof p.id !== 'string' || !p.id) throw new Error('Every parameter needs an id.');
    if (seen.has(p.id)) throw new Error(`Two parameters share the id ${p.id}.`);
    seen.add(p.id);
    if (typeof p.apply !== 'function') throw new Error(`${p.id} has no apply(model, value).`);
    if (!isNum(p.start)) throw new Error(`${p.label || p.id} needs a starting value.`);
    if (logScale(p.kind) && !(p.start > 0)) throw new Error(`${p.label || p.id} is fitted on a log scale, so its starting value must be above zero.`);
  }
}

function checkObservations(model, observations) {
  if (!Array.isArray(observations) || !observations.length) throw new Error('Give at least one measured head.');
  const g = buildGrid(model);
  const steps = model.periods.reduce((s, p) => s + p.nstp, 0);
  const weighted = observations.filter((o) => o.weight != null).length;
  // Weights are relative unless every one is 1/variance, so a mix of given and missing
  // weights has no meaning: either every head has one or none does (all equal).
  if (weighted && weighted !== observations.length) throw new Error('Give a weight for every measured head, or for none (then all are weighted equally).');
  const names = new Set();
  return observations.map((o, i) => {
    const label = `Measured head ${o.name ?? i + 1}`;
    if (o.name == null || o.name === '') throw new Error(`Measured head ${i + 1} needs a name.`);
    if (names.has(o.name)) throw new Error(`Two measured heads share the name ${o.name}.`);
    names.add(o.name);
    const { lay, row, col } = o;
    if (![lay, row, col].every(Number.isInteger) || lay < 0 || lay >= g.nlay || row < 0 || row >= g.nrow || col < 0 || col >= g.ncol) {
      const at = [lay, row, col].every(Number.isInteger) ? cellName(lay, row, col) : `the cell [${lay}, ${row}, ${col}]`;
      throw new Error(`${label}: ${at} is outside the grid of ${g.nlay} layers, ${g.nrow} rows and ${g.ncol} columns.`);
    }
    const n = lay * g.ncpl + row * g.ncol + col;
    if (!g.domain[n]) throw new Error(`${label}: ${cellName(lay, row, col)} is not an active cell.`);
    // A time is placed among the saved steps as MODFLOW-2000 HOB places it (run.js
    // timeWeights). A step (from 0) names one saved step; it is only implied when the model
    // has one step in all.
    let at;
    if (o.time != null && o.step != null) throw new Error(`${label}: give the time it was measured at or the time step, not both.`);
    if (o.time != null) {
      if (!isNum(o.time)) throw new Error(`${label}: the time is not a number.`);
      try {
        at = timeWeights(model.periods, o.time);
      } catch (err) {
        throw new Error(`${label}: ${err.message}`);
      }
    } else {
      const step = o.step ?? (steps === 1 ? 0 : undefined);
      if (step === undefined) throw new Error(`${label}: give the time it was measured at.`);
      if (!Number.isInteger(step) || step < 0 || step >= steps) throw new Error(`${label}: step ${step} is not one of the run's saved steps, 0 to ${steps - 1} (counted from 0).`);
      at = { a: step, b: step, w: 1 };
    }
    if (!isNum(o.value)) throw new Error(`${label}: the head is not a number.`);
    const weight = o.weight ?? 1;
    if (!(isNum(weight) && weight > 0)) throw new Error(`${label}: the weight must be above zero.`);
    const v = model.ic.strt[lay];
    const start = typeof v === 'number' ? v : v[row * g.ncol + col];
    return { name: String(o.name), lay, row, col, n, step: at.b, time: o.time ?? null, at, start, value: o.value, weight };
  });
}

// The computed head for an observation: the saved step's head, or the interpolation
// timeWeights gives for a time between step ends. NaN where the cell is dry.
function simulatedHead(result, o) {
  const { a, b, w } = o.at;
  const hb = result.heads[b][o.n];
  if (w === 1) return hb;
  return (1 - w) * (a < 0 ? o.start : result.heads[a][o.n]) + w * hb;
}

/**
 * A function from parameter values to the model's result, counting the runs.
 *
 * Starting heads: when the first period is steady and every active cell is confined
 * (icelltype 0), the steady heads are the one solution of a linear system plus the RIV and
 * DRN switches, which are monotone in head, so they do not depend on the starting heads,
 * and each run may start from the last run's steady heads, which saves most of the outer
 * and inner iterations once the search has settled. Later periods start from that steady
 * step either way. Otherwise the starting heads are part of the model (a transient first
 * period starts from them; a convertible cell that starts dry stays dry), so every run
 * starts from the model's own.
 */
export function simulator(model) {
  const g = buildGrid(model);
  const confined = !g.icelltype.some((c, n) => c && g.domain[n]);
  const reuse = confined && model.periods[0].steady === true;
  const strt = model.ic.strt;
  let warm = null;
  const counts = { runs: 0, warm: 0, failed: 0, error: null };

  function runWith(params, values, { cold = false } = {}) {
    const m = structuredClone(model);
    for (const p of params) p.apply(m, values[p.id]);
    const warmed = reuse && warm && !cold;
    if (warmed) {
      m.ic = { ...m.ic, strt: strt.map((v, k) => {
        const out = new Array(g.ncpl);
        for (let c = 0; c < g.ncpl; c++) {
          const h = warm[k * g.ncpl + c];
          out[c] = Number.isFinite(h) ? h : (typeof v === 'number' ? v : v[c]);
        }
        return out;
      }) };
      counts.warm++;
    }
    counts.runs++;
    const result = run(m);
    if (reuse) warm = result.heads[0];
    // The model as it was given, with the values applied, and its own starting heads.
    if (warmed) m.ic = { ...m.ic, strt: structuredClone(strt) };
    return { model: m, result };
  }
  return { runWith, reuse, counts };
}

// ---------------------------------------------------------------------------------------
// Diagnostics, Hill (1998, USGS WRIR 98-4005) and Hill and Tiedeman (2007).

/**
 * The weighted residual summary that MODFLOW-2000 prints (Hill and others 2000, USGS OFR
 * 00-184, table 14), from residuals e = y - y' and weights w, in the order given.
 */
export function residualSummary(residuals, weights, observed, simulated, np) {
  const nd = residuals.length;
  const ew = residuals.map((e, i) => Math.sqrt(weights[i]) * e);
  let swsr = 0, sum = 0, maxI = 0, minI = 0;
  ew.forEach((v, i) => { swsr += v * v; sum += v; if (v > ew[maxI]) maxI = i; if (v < ew[minI]) minI = i; });
  // Runs test, WRIR 98-4005 p. 22, eq. 21 to 24; residuals >= 0 count as positive, as
  // MODFLOW-2000 counts them (OFR 00-184, table 14, p. 99).
  const pos = ew.filter((v) => v >= 0).length, neg = nd - pos;
  let runs = nd ? 1 : 0;
  for (let i = 1; i < nd; i++) if ((ew[i] >= 0) !== (ew[i - 1] >= 0)) runs++;
  const n1 = pos, n2 = neg, n = n1 + n2;
  const mu = n1 && n2 ? 2 * n1 * n2 / n + 1 : NaN;
  const sigma = n1 && n2 ? Math.sqrt(2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / (n * n * (n - 1))) : NaN;
  // Eq. 18 to 20: R between the weighted observations and the weighted simulated values.
  const wy = observed.map((y, i) => Math.sqrt(weights[i]) * y), wf = simulated.map((y, i) => Math.sqrt(weights[i]) * y);
  const my = wy.reduce((a, b) => a + b, 0) / nd, mf = wf.reduce((a, b) => a + b, 0) / nd;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < nd; i++) { sxy += (wy[i] - my) * (wf[i] - mf); sxx += (wy[i] - my) ** 2; syy += (wf[i] - mf) ** 2; }
  // Eq. 25: R2N between the ordered weighted residuals and the N(0,1) order statistics at
  // cumulative probability (i - 0.5)/ND.
  const eo = ew.slice().sort((a, b) => a - b), m = sum / nd;
  const tau = eo.map((_, i) => normalQuantile((i + 1 - 0.5) / nd));
  let et = 0, ee = 0, tt = 0;
  for (let i = 0; i < nd; i++) { et += (eo[i] - m) * tau[i]; ee += (eo[i] - m) ** 2; tt += tau[i] ** 2; }
  const df = nd - np;
  return {
    n: nd,
    swsr,                                          // eq. 1, the weighted objective
    errorVariance: df > 0 ? swsr / df : NaN,       // s^2, eq. 14
    standardError: df > 0 ? Math.sqrt(swsr / df) : NaN,
    maxWeighted: nd ? { index: maxI, value: ew[maxI] } : null,
    minWeighted: nd ? { index: minI, value: ew[minI] } : null,
    meanWeighted: sum / nd,
    positive: pos, negative: neg,
    runs,
    runsTest: {
      mean: mu, sd: sigma,
      tooFew: (runs - mu + 0.5) / sigma,           // eq. 23
      tooMany: (runs - mu - 0.5) / sigma,          // eq. 24
      // The normal approximation holds when n1 > 10 and n2 > 10 (p. 22).
      valid: n1 > 10 && n2 > 10,
    },
    R: sxy / Math.sqrt(sxx * syy),
    RN2: (et * et) / (ee * tt),
    weightedResiduals: ew,
  };
}

// The Jacobian's step on the fit scale, the same 1e-3 that lsq.js uses: on ln b for a
// log-scaled parameter, so a 0.1% change in the value.
const H = 1e-3;

/**
 * Dimensionless scaled sensitivities dss_ij = (dy'_i/db_j) b_j w_i^1/2 (WRIR 98-4005
 * eq. 8) and composite scaled sensitivities css_j = (sum_i dss_ij^2 / ND)^1/2 (eq. 10), by
 * central differences, for every parameter, held or not: OFR 00-184 (p. 96) asks for both
 * in a bar chart. For a log-scaled value the derivative is taken on ln b, which is
 * b dy'/db, the same scaling. Also the parameter correlation from (X'wX)^-1 (eq. 26 and 30),
 * which needs no error variance, so it can be had before any fit (Hill 1998, p. 38).
 */
function scaledSensitivities(sim, params, obs, values, progress) {
  const sqw = obs.map((o) => Math.sqrt(o.weight));
  const heads = (vals) => {
    const { result } = sim.runWith(params, vals);
    if (progress) progress({ stage: 'sensitivities', runs: sim.counts.runs });
    return obs.map((o) => simulatedHead(result, o));
  };
  // change: for each parameter, the largest change of an observed head between the two
  // runs of its central difference, in m.
  const change = {};
  const dss = params.map((p) => {
    const v = values[p.id];
    const shifted = (d) => ({ ...values, [p.id]: logScale(p.kind) ? v * Math.exp(d) : v + d });
    const h = logScale(p.kind) ? H : H * Math.max(1, Math.abs(v));
    const up = heads(shifted(h)), down = heads(shifted(-h));
    change[p.id] = Math.max(...obs.map((_, i) => Math.abs(up[i] - down[i])));
    // On the linear scale dy'/db times b; on the log scale dy'/d ln b already is.
    const scale = logScale(p.kind) ? 1 : v;
    return obs.map((_, i) => sqw[i] * scale * (up[i] - down[i]) / (2 * h));
  });
  const nd = obs.length;
  const css = Object.fromEntries(params.map((p, j) => [p.id, Math.sqrt(dss[j].reduce((s, x) => s + x * x, 0) / nd)]));
  // Correlation of the parameters that are fitted, from the scaled sensitivities: scaling
  // the columns of X does not change a correlation.
  const freeIdx = params.map((p, j) => (p.fixed ? -1 : j)).filter((j) => j >= 0);
  const k = freeIdx.length;
  const A = new Float64Array(k * k);
  freeIdx.forEach((a, ia) => freeIdx.forEach((b, ib) => { A[ia * k + ib] = dss[a].reduce((s, x, i) => s + x * dss[b][i], 0); }));
  const { inv, weak } = k ? invertSPD(A, k) : { inv: null, weak: [] };
  const corr = freeIdx.map((_, a) => freeIdx.map((__, b) => (inv ? inv[a * k + b] / Math.sqrt(inv[a * k + a] * inv[b * k + b]) : NaN)));
  return {
    dss: Object.fromEntries(params.map((p, j) => [p.id, dss[j]])), css, corr, change,
    free: freeIdx.map((j) => params[j].id),
    // Parameters whose sensitivities are (near) combinations of the others': the heads
    // cannot tell them apart, and their correlation is +1 or -1 (Hill 1998, p. 28).
    weak: weak.map((j) => params[freeIdx[j]].id),
  };
}

/**
 * Sensitivities at given values (the starting values if none), with no fit: what Hill
 * (1998, Guideline 3, p. 38) advises looking at before deciding what to estimate.
 */
export function sensitivity(model, { params, observations, values, progress }) {
  checkParams(params);
  const obs = checkObservations(model, observations);
  const sim = simulator(model);
  const vals = values || Object.fromEntries(params.map((p) => [p.id, p.start]));
  const out = scaledSensitivities(sim, params, obs, vals, progress);
  return { ...out, values: vals, runs: sim.counts.runs };
}

// ---------------------------------------------------------------------------------------
// The calibration.

/**
 * Fit parameters of a model to measured heads.
 *   params:       [{ id, label, kind, apply(model, value), start, fixed?, min?, max? }]
 *   observations: [{ name, lay, row, col, time or step, value, weight? }]: time in d from
 *                 the start of the run, the head between step ends interpolated as
 *                 MODFLOW-2000 HOB does (run.js timeWeights), or step, a saved time step
 *                 counted from 0; weight is 1/variance (per m²), or none for all.
 *   progress:     optional, called with { stage, runs } after each run of the model.
 * Returns { model, result, fit, residuals, summary, sensitivities, runs }, where model is
 * the calibrated model, result its run, and fit leastSquares's result on the weighted heads.
 */
export function calibrate(model, { params, observations, progress, maxIterations = 50 } = {}) {
  checkParams(params);
  const obs = checkObservations(model, observations);
  const free = params.filter((p) => !p.fixed);
  if (obs.length < free.length + 1) throw new Error(`Fitting ${free.length} value${free.length === 1 ? '' : 's'} with a measure of uncertainty needs at least ${free.length + 1} measured heads; there are ${obs.length}.`);
  const sim = simulator(model);
  const sqw = obs.map((o) => Math.sqrt(o.weight));
  const start = Object.fromEntries(params.map((p) => [p.id, p.start]));

  // The starting run is checked here, so its errors say what went wrong with the model.
  const first = sim.runWith(params, start, { cold: true }).result;
  obs.forEach((o) => {
    if (!Number.isFinite(simulatedHead(first, o))) throw new Error(`Measured head ${o.name}: ${cellName(o.lay, o.row, o.col)} is dry at the starting values.`);
  });

  // A run that fails (no convergence, a cell gone dry under a head) gives no heads, which
  // leastSquares reads as an infinite misfit and steps away from.
  const fitModel = (values) => {
    let heads;
    try {
      const { result } = sim.runWith(params, values);
      heads = obs.map((o, i) => sqw[i] * simulatedHead(result, o));
    } catch (err) {
      sim.counts.failed++;
      sim.counts.error = sim.counts.error || err.message;
      heads = obs.map(() => NaN);
    }
    if (progress) progress({ stage: 'fit', runs: sim.counts.runs });
    return heads;
  };
  const fit = leastSquares({
    params: params.map((p) => ({ id: p.id, kind: p.kind, min: p.min, max: p.max })),
    start,
    fixed: Object.fromEntries(params.filter((p) => p.fixed).map((p) => [p.id, true])),
    model: fitModel,
    y: obs.map((o, i) => sqw[i] * o.value),
    maxIterations,
  });

  // How much a warm start moves the heads: the search sees this as noise in the model, and
  // a finite-difference derivative sees it divided by the step (Doherty 2025, section
  // 16.4, asks for tight solver convergence for this reason).
  const warmHeads = sim.reuse ? sim.runWith(params, fit.values).result : null;
  // The calibrated model run from its own starting heads, as MODFLOW 6 would run it.
  const final = sim.runWith(params, fit.values, { cold: true });
  if (progress) progress({ stage: 'final', runs: sim.counts.runs });
  const simulated = obs.map((o) => simulatedHead(final.result, o));
  const residuals = obs.map((o, i) => ({
    name: o.name, lay: o.lay, row: o.row, col: o.col, step: o.step, time: o.time ?? final.result.times[o.step], interpolated: o.at.w !== 1,
    observed: o.value, simulated: simulated[i], residual: o.value - simulated[i],
    weight: o.weight, weighted: sqw[i] * (o.value - simulated[i]),
  }));
  const summary = residualSummary(residuals.map((r) => r.residual), obs.map((o) => o.weight), obs.map((o) => o.value), simulated, free.length);
  summary.maxWeighted.name = obs[summary.maxWeighted.index].name;
  summary.minWeighted.name = obs[summary.minWeighted.index].name;
  // A head between step ends is interpolated linearly in time, as MODFLOW-2000 HOB does.
  // Where the model's head changes over that step by more than both the residual and the
  // fit's standard error (per head, s / w^½), the interpolation alone can be as far off as
  // the residual, as across the first step after a change in pumping, where a confined head
  // falls almost at once (model-modeller round 5, L-N9). stepChange is that change, in m.
  const se = summary.standardError;
  const coarse = [];
  residuals.forEach((r, i) => {
    if (!r.interpolated) return;
    const o = obs[i], { a, b } = o.at, res = final.result;
    const ha = a < 0 ? o.start : res.heads[a][o.n];
    r.stepChange = Math.abs(res.heads[b][o.n] - ha);
    const sdi = Number.isFinite(se) ? se / sqw[i] : 0;
    if (r.stepChange > Math.max(Math.abs(r.residual), sdi)) coarse.push({ i, from: a < 0 ? 0 : res.times[a], to: res.times[b] });
  });
  const sensitivities = scaledSensitivities(sim, params, obs, fit.values, progress);
  const warmDifference = warmHeads ? Math.max(...obs.map((o, i) => Math.abs(simulatedHead(warmHeads, o) - simulated[i]))) : 0;
  const warnings = [];
  // The derivative error from that noise, against each parameter's largest head change per
  // unit of ln b: above 1% the search and its statistics start to suffer.
  for (const p of params) {
    const largest = Math.max(...sensitivities.dss[p.id].map((x, i) => Math.abs(x) / sqw[i]));
    // A parameter the heads do not depend on beyond the solver's closure is warned of below.
    if (sensitivities.change[p.id] > model.solver.hclose && warmDifference / H > 0.01 * largest) warnings.push(`The solver's convergence (hclose) is loose beside the sensitivity of the heads to ${p.label || p.id}; tighten hclose and rclose so the derivatives are sound.`);
  }
  if (coarse.length) {
    const w = coarse.reduce((x, c) => (residuals[c.i].stepChange > residuals[x.i].stepChange ? c : x));
    const r = residuals[w.i], k = coarse.length;
    warnings.push(`${k === 1 ? '1 measured head falls' : `${k} measured heads fall`} between step ends where the model's head changes over the step by more than the residual and the fit's standard error, so the straight-line interpolation in time (as MODFLOW-2000 HOB does it) can be as far off as the residual itself. `
      + `The largest is ${r.name} at ${sig(r.time, 4)} d, where the head changes by ${sig(r.stepChange, 3)} m from ${sig(w.from, 4)} d to ${sig(w.to, 4)} d. `
      + 'Shorter time steps there (a smaller first step, or more steps) put step ends near the measurements and remove this error.');
  }
  // A fitted value the heads cannot set: a log-scaled value that ran off by more than a
  // factor of 10⁶ from its start (to what the heads cannot tell from zero, or from very
  // large), or one whose central difference moved no observed head by more than the solver's
  // head closure, which is no change the solver can show. Such a fit is not one to use as it
  // stands (Hill 1998, Guideline 3: estimate only what the observations can support). The
  // run-off is named first: there the scaled sensitivity is small because the value is, and
  // the heads may well depend on the parameter near its start.
  const degenerate = [];
  const hclose = model.solver.hclose;
  for (const p of free) {
    const v = fit.values[p.id], name = p.label || p.id;
    if (logScale(p.kind) && Math.abs(Math.log10(v / p.start)) > 6) {
      degenerate.push(p.id);
      warnings.push(`${name} ran from ${sig(p.start)} to ${sig(v)}, by more than a factor of a million: the heads cannot tell it from ${v < p.start ? 'zero' : 'a very large value'}. Hold it, or fit it with another parameter held.`);
    } else if (!(sensitivities.change[p.id] > hclose)) {
      degenerate.push(p.id);
      warnings.push(`${name}: the heads do not change with it (${logScale(p.kind) ? `a change of ${100 * H} % either way` : 'a small change either way'} in it moves no measured head by more than the solver's head closure, hclose, of ${sig(hclose)} m), so the fit cannot set it; hold it, or leave it out.`);
    }
  }
  return {
    model: final.model, result: final.result, fit, residuals, summary, sensitivities, warnings, degenerate,
    runs: { ...sim.counts, reuse: sim.reuse, warmDifference },
  };
}
