// Editing a flow model on the model page. The model is the JSON of docs/design/model.md
// (metres and days, indices from 0), held with null wherever the user has not yet given a
// value: nothing is filled in for them. missingParts() lists what is still needed, and
// runnable() gives the clean model the solver and the MODFLOW 6 writer take. Nothing here
// needs a browser, so the Node tests use the same functions as the page.

import { countOf } from '../../../engine/format.js';
import { newtonProblems, readNewton, readRewet, rewetForRun, rewetGaps, rewetProblems, readSolverOptions, solverForRun, solverOptionGaps, solverOptionProblems } from './solver.js';

/** The largest grid the page builds: beyond this the browser would struggle to draw and solve it. */
export const MAX_CELLS = 1000000;

// The values painted cell by cell. Each is per layer (a number or nrow*ncol values),
// except the model top (one layer), idomain (one flat array) and recharge (per period).
export const PROPS = {
  k: { label: 'K', name: 'Horizontal hydraulic conductivity K', unit: 'm/d', positive: true },
  k33: { label: 'K33', name: 'Vertical hydraulic conductivity K33', unit: 'm/d', positive: true },
  // Optional: without it K22 equals K, as MODFLOW 6 NPF sets it.
  k22: { label: 'K22', name: 'Hydraulic conductivity along the columns K22', unit: 'm/d', positive: true },
  ss: { label: 'Ss', name: 'Specific storage Ss', unit: 'per m', nonNegative: true },
  sy: { label: 'Sy', name: 'Specific yield Sy', unit: '', nonNegative: true, atMost: 1 },
  strt: { label: 'Starting head', name: 'Starting head', unit: 'm' },
  top: { label: 'Top', name: 'Top of the model', unit: 'm' },
  botm: { label: 'Bottom', name: 'Bottom of the layer', unit: 'm' },
  idomain: { label: 'Active', name: 'Active cells (idomain)', unit: '' },
  rch: { label: 'Recharge', name: 'Recharge', unit: 'm/d' },
};

/**
 * What the storage values of model m are read as, for the note under "Storage given as": the
 * numbers stay as they are when STORAGECOEFFICIENT is turned on or off, so they are read the
 * other way, and MODFLOW 6's capacity is Ss × cell thickness × area or S × area (STO SsCapacity).
 */
export function ssKindText(m) {
  if (!m || !m.sto) return '';
  return m.sto.storagecoefficient
    ? 'The values in the S column are storage coefficients, with no unit: each cell stores S × its area per metre of head. Changing this keeps the numbers and reads them as specific storage again, so they would need to be divided by each cell\'s thickness.'
    : 'The values in the Ss column are specific storage, per metre: each cell stores Ss × its thickness × its area per metre of head. Changing this keeps the numbers and reads them as storage coefficients, so they would need to be multiplied by each cell\'s thickness.';
}

/**
 * A layer property as the page names it in model m: under STORAGECOEFFICIENT, sto.ss is the
 * storage coefficient S, with no unit, not specific storage Ss per m (MODFLOW 6 STO).
 */
export function propOf(m, p) {
  if (p === 'ss' && m && m.sto && m.sto.storagecoefficient) return { ...PROPS.ss, label: 'S', name: 'Storage coefficient S', unit: '' };
  return PROPS[p];
}

// The boundary packages, with their values after [lay, row, col], as in the design.
export const PACKAGES = {
  wel: { label: 'Well', plural: 'Wells', values: [['q', 'Rate', 'm³/d', 'Negative for pumping, positive for injection.']] },
  chd: { label: 'Constant-head cell', plural: 'Constant-head cells', values: [['head', 'Head', 'm']] },
  riv: { label: 'River cell', plural: 'River cells', values: [['stage', 'Stage', 'm'], ['cond', 'Riverbed conductance', 'm²/d'], ['rbot', 'Riverbed bottom', 'm']] },
  drn: { label: 'Drain', plural: 'Drains', values: [['elev', 'Elevation', 'm'], ['cond', 'Conductance', 'm²/d']] },
  ghb: { label: 'General-head boundary', plural: 'General-head boundaries', values: [['bhead', 'Head', 'm'], ['cond', 'Conductance', 'm²/d']] },
  // MODFLOW 6 EVT as a list, with one segment: ET at the maximum rate with the head at or above
  // the surface, falling linearly to nothing at the extinction depth below it.
  evtList: {
    label: 'Evapotranspiration cell', plural: 'Evapotranspiration cells',
    values: [['surface', 'Surface', 'm', 'The ET surface: the full rate while the head is at or above it.'], ['rate', 'Maximum rate', 'm/d', 'A rate per unit area of the cell.'], ['depth', 'Extinction depth', 'm', 'Below the surface: no ET once the head is this far down.']],
  },
};
export const PACKAGE_IDS = Object.keys(PACKAGES);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// A count of cells in words people read: 20 000 000 as 2 × 10⁷, as sig() writes it in kit.
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const bigCount = (n) => {
  if (n < 1e6) return String(n);
  const e = Math.floor(Math.log10(n)), m = Number((n / 10 ** e).toPrecision(3));
  return `${m === 1 ? '' : `${m} × `}10${String(e).replace(/./g, (c) => SUP[c])}`;
};
const clone = (v) => (Array.isArray(v) ? v.slice() : v);
export const ncplOf = (m) => m.grid.nrow * m.grid.ncol;

/** Cell (layer, row, column) as people read it, counted from 1 as in MODFLOW 6. */
export const cellName = (lay, row, col) => `layer ${lay + 1}, row ${row + 1}, column ${col + 1}`;

// ---------------------------------------------------------------------------------------
// Cell widths

/**
 * Widths from a list such as "100, 50, 20*10, 50": numbers separated by commas or spaces,
 * and n*w for n cells of width w (MODFLOW's repeat count). what names the field in a message.
 */
export function parseWidths(text, what) {
  const toks = String(text ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!toks.length) throw new Error(`${what}: give at least one width.`);
  const out = [];
  for (const t of toks) {
    if (t.includes('*') && !/^\d+\*/.test(t)) throw new Error(`${what}: in "${t}", the count before the * must be a whole number.`);
    const m = /^(\d+)\*(.+)$/.exec(t);
    const count = m ? Number(m[1]) : 1, w = Number(m ? m[2] : t);
    if (!Number.isFinite(w) || w <= 0) throw new Error(`${what}: "${t}" is not a width above zero.`);
    if (!(count >= 1)) throw new Error(`${what}: "${t}" needs a count of at least 1 before the *.`);
    if (out.length + count > MAX_CELLS) throw new Error(`${what}: more than ${bigCount(MAX_CELLS)} cells.`);
    for (let i = 0; i < count; i++) out.push(w);
  }
  return out;
}

/** The list form of widths, with runs written n*w, so that parseWidths reads it back exactly. */
export function widthsToText(widths) {
  const parts = [];
  for (let i = 0; i < widths.length;) {
    let j = i;
    while (j + 1 < widths.length && widths[j + 1] === widths[i]) j++;
    const n = j - i + 1;
    parts.push(n > 1 ? `${n}*${widths[i]}` : String(widths[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Equal cells across an extent. The extent must hold a whole number of cells. */
export function uniformWidths(extent, size, what) {
  if (!(extent > 0)) throw new Error(`${what}: the extent must be above zero.`);
  if (!(size > 0)) throw new Error(`${what}: the cell size must be above zero.`);
  const n = Math.round(extent / size);
  if (n < 1 || Math.abs(n * size - extent) > 1e-9 * extent) {
    throw new Error(`${what}: ${extent} m is not a whole number of ${size} m cells.`);
  }
  if (n > MAX_CELLS) throw new Error(`${what}: more than ${bigCount(MAX_CELLS)} cells.`);
  return new Array(n).fill(size);
}

/** The cumulative edges of cells from their widths: n + 1 values from 0. */
export function edges(widths) {
  const out = new Float64Array(widths.length + 1);
  for (let i = 0; i < widths.length; i++) out[i + 1] = out[i] + widths[i];
  return out;
}

// ---------------------------------------------------------------------------------------
// A new model, and a loaded one made ready for editing

const nulls = (n) => new Array(n).fill(null);

/** An empty model on a new grid: every value that the user must give is null. */
export function newModel({ name, nlay, delr, delc }) {
  if (!Number.isInteger(nlay) || nlay < 1) throw new Error('Layers: give a whole number of at least 1.');
  if (nlay * delr.length * delc.length > MAX_CELLS) {
    throw new Error(`The grid would have ${bigCount(nlay * delr.length * delc.length)} cells; this page builds at most ${bigCount(MAX_CELLS)}.`);
  }
  return {
    name: name ?? null,
    grid: { nlay, nrow: delc.length, ncol: delr.length, delr: delr.slice(), delc: delc.slice(), top: null, botm: nulls(nlay), idomain: null },
    npf: { icelltype: nulls(nlay), k: nulls(nlay), k33: nulls(nlay) },
    sto: { ss: nulls(nlay), sy: nulls(nlay) },
    ic: { strt: nulls(nlay) },
    periods: [],
    obs: [],
    solver: { outer: null, inner: null, hclose: null, rclose: null },
  };
}

// A per-layer input as loaded: each entry a number, null, or nrow*ncol values (numbers or null).
// perLayer false: one array that is not a layer's (the top, a period's recharge).
function layerList(v, nlay, ncpl, what, perLayer = true) {
  if (v === undefined || v === null) return nulls(nlay);
  if (!Array.isArray(v) || v.length !== nlay) throw new Error(`${what} needs one entry per layer (${nlay}).`);
  return v.map((x, k) => {
    if (x === null || isNum(x)) return x;
    if (Array.isArray(x) && x.length === ncpl && x.every((c) => c === null || isNum(c))) return x.slice();
    throw new Error(`${what}${perLayer ? ` of layer ${k + 1}` : ''} must be a number or ${ncpl} values.`);
  });
}

// The parts of a model the page keeps as they were read, without editing them: evapotranspiration
// as arrays, recharge as a list of cells, the layer of recharge by period (irch; the page sets
// only period 1's, rchLayer below), and the packages' options (FIXED_CELL; the page sets
// recharge's). They are run and saved as they are.
export const KEPT = ['evt', 'rchList', 'irch', 'options'];
/** NPF's options: THICKSTRT, VARIABLECV, its DEWATERED, and PERCHED (MODFLOW 6's names, lower case). */
export const NPF_OPTIONS = ['thickstrt', 'variablecv', 'dewatered', 'perched'];
/** STO's options: SS read as the storage coefficient, and Ss in a convertible cell only while it is full. */
export const STO_OPTIONS = ['storagecoefficient', 'ssConfinedOnly'];

function stressLists(pkg, name, nper, width, id) {
  if (pkg === undefined || pkg === null) return undefined;
  if (typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error(`${name} must map period numbers to lists.`);
  const out = {};
  for (const [key, list] of Object.entries(pkg)) {
    const p = Number(key);
    if (!Number.isInteger(p) || p < 0 || (nper && p >= nper)) throw new Error(`${name}: period ${key} is not one of the model's periods.`);
    if (!Array.isArray(list)) throw new Error(`${name} period ${p + 1} must be a list.`);
    out[p] = list.map((e, i) => {
      // An evapotranspiration list may have NSEG segments, each beyond the first adding a pxdp and a petm.
      const ok = id === 'evtList' ? e.length >= 3 + width && (e.length - 3 - width) % 2 === 0 : e.length === 3 + width;
      if (!Array.isArray(e) || !ok || !e.every(isNum)) throw new Error(`${name} period ${p + 1}, entry ${i + 1}: needs ${3 + width} numbers${id === 'evtList' ? ', or 2 more for each segment beyond the first' : ''}.`);
      return e.slice();
    });
  }
  return out;
}

/**
 * A model from a saved file, made ready for editing: every part is present, with null
 * where the file gives no value. The file's own values are kept exactly. Throws with a
 * message naming the part that cannot be read.
 */
export function editable(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('It is not a model: the file holds no JSON object.');
  const g = json.grid;
  if (!g || typeof g !== 'object') throw new Error('It is not a model: it has no grid.');
  // Messages name the part in words, as the page does, not by its key in the file.
  const COUNTS = { nlay: 'layers', nrow: 'rows', ncol: 'columns' };
  for (const key of ['nlay', 'nrow', 'ncol']) if (!Number.isInteger(g[key]) || g[key] < 1) throw new Error(`The model's number of ${COUNTS[key]} must be a whole number of at least 1.`);
  const { nlay, nrow, ncol } = g, ncpl = nrow * ncol;
  if (nlay * ncpl > MAX_CELLS) throw new Error(`The grid has ${bigCount(nlay * ncpl)} cells; this page works with at most ${bigCount(MAX_CELLS)}.`);
  const widths = (w, n, what) => {
    if (!Array.isArray(w) || w.length !== n || !w.every((x) => isNum(x) && x > 0)) throw new Error(`${what} needs ${n} widths above zero.`);
    return w.slice();
  };
  const m = newModel({ name: typeof json.name === 'string' ? json.name : null, nlay, delr: widths(g.delr, ncol, 'The column widths'), delc: widths(g.delc, nrow, 'The row widths') });
  if (g.top !== undefined && g.top !== null) m.grid.top = layerList([g.top], 1, ncpl, 'The top of the model', false)[0];
  m.grid.botm = layerList(g.botm, nlay, ncpl, 'The bottom');
  if (g.idomain !== undefined && g.idomain !== null) {
    if (!Array.isArray(g.idomain) || g.idomain.length !== nlay * ncpl || !g.idomain.every((v) => v === 0 || v === 1 || v === -1)) {
      throw new Error(`The active cells (idomain) need ${nlay * ncpl} values of 1, 0 or -1 (vertical pass-through), or none.`);
    }
    m.grid.idomain = g.idomain.slice();
  }
  const npf = json.npf || {};
  for (const k of NPF_OPTIONS) if (npf[k] === true) m.npf[k] = true;
  m.npf.icelltype = layerList(npf.icelltype, nlay, ncpl, 'The cell type').map((v, k) => {
    // Below 0 is convertible, as MODFLOW 6 reads it, unless THICKSTRT is on.
    const read = (x) => (x < 0 && !m.npf.thickstrt ? 1 : x);
    if (v === null || [0, 1, -1].includes(read(v))) return v === null ? v : read(v);
    // The page sets the cell type per layer, as MODFLOW 6 files read by fromMf6 do.
    if (Array.isArray(v) && v.every((c) => c === v[0]) && [0, 1, -1].includes(read(v[0]))) return read(v[0]);
    throw new Error(`The cell type of layer ${k + 1}: this page takes 0 (confined), 1 (convertible) or, with THICKSTRT, -1 for a whole layer.`);
  });
  m.npf.k = layerList(npf.k, nlay, ncpl, 'K');
  if (npf.k22 !== undefined && npf.k22 !== null) m.npf.k22 = layerList(npf.k22, nlay, ncpl, 'K22');
  m.npf.k33 = layerList(npf.k33, nlay, ncpl, 'K33');
  readRewet(npf, m, (v) => layerList(v, nlay, ncpl, 'WETDRY'));
  if (json.sto) {
    m.sto.ss = layerList(json.sto.ss, nlay, ncpl, 'Ss');
    m.sto.sy = layerList(json.sto.sy, nlay, ncpl, 'Sy');
    // STO's options, MODFLOW 6's STORAGECOEFFICIENT and SS_CONFINED_ONLY.
    for (const k of STO_OPTIONS) if (json.sto[k] === true) m.sto[k] = true;
  }
  m.ic.strt = layerList(json.ic && json.ic.strt, nlay, ncpl, 'The starting head');
  if (json.periods !== undefined) {
    if (!Array.isArray(json.periods)) throw new Error('The stress periods must be a list.');
    m.periods = json.periods.map((p, i) => {
      if (!p || typeof p !== 'object') throw new Error(`Period ${i + 1} is not a period.`);
      const num = (v) => (isNum(v) ? v : null);
      return { length: num(p.length), nstp: num(p.nstp), tsmult: num(p.tsmult), steady: typeof p.steady === 'boolean' ? p.steady : null };
    });
  }
  const nper = m.periods.length;
  PACKAGE_IDS.forEach((id) => {
    const lists = stressLists(json[id], PACKAGES[id].plural, nper, PACKAGES[id].values.length, id);
    if (lists) m[id] = lists;
  });
  if (json.rch !== undefined && json.rch !== null) {
    if (typeof json.rch !== 'object' || Array.isArray(json.rch)) throw new Error('Recharge must be given by period number.');
    m.rch = {};
    for (const [key, v] of Object.entries(json.rch)) {
      const p = Number(key);
      if (!Number.isInteger(p) || p < 0 || (nper && p >= nper)) throw new Error(`Recharge: period ${key} is not one of the model's periods.`);
      m.rch[p] = layerList([v], 1, ncpl, `Recharge of period ${p + 1}`, false)[0];
    }
  }
  for (const key of KEPT) if (json[key] !== undefined && json[key] !== null) m[key] = structuredClone(json[key]);
  if (json.obs !== undefined && json.obs !== null) {
    if (!Array.isArray(json.obs)) throw new Error('The observation points must be a list.');
    m.obs = json.obs.map((o, i) => {
      if (!o || typeof o.name !== 'string' || ![o.lay, o.row, o.col].every(Number.isInteger)) throw new Error(`Observation ${i + 1} needs a name, lay, row and col.`);
      return { name: o.name, lay: o.lay, row: o.row, col: o.col };
    });
  }
  if (json.solver) for (const key of ['outer', 'inner', 'hclose', 'rclose']) m.solver[key] = isNum(json.solver[key]) ? json.solver[key] : null;
  // Units the MODFLOW 6 files left unknown are kept, so the model is not run until someone
  // says what they are, rather than taken as metres and days; so are the units the files
  // came in (for writing them back) and the notes on how they were read.
  if (json.units && typeof json.units === 'object') m.units = { ...json.units };
  if (json.fileUnits && typeof json.fileUnits === 'object') m.fileUnits = { ...json.fileUnits };
  // The relaxation factor, STRICT and the other IMS settings (solver.js).
  if (json.solver) readSolverOptions(json.solver, m.solver);
  readNewton(json, m);
  if (json.georef && typeof json.georef === 'object') m.georef = { ...json.georef };
  if (typeof json.startDateTime === 'string') m.startDateTime = json.startDateTime;
  if (Array.isArray(json.notes)) m.notes = json.notes.map(String);
  return m;
}

// ---------------------------------------------------------------------------------------
// Values per layer

/** The entry of a stress package in force in period p: the latest period at or before p that has one. */
export function inForce(pkg, p) {
  if (!pkg) return undefined;
  let best = -1;
  for (const key of Object.keys(pkg)) { const kp = Number(key); if (kp <= p && kp > best) best = kp; }
  return best < 0 ? undefined : pkg[best];
}
/** The period whose entry is in force in period p, or -1 when none is. */
export function sourcePeriod(pkg, p) {
  let best = -1;
  if (pkg) for (const key of Object.keys(pkg)) { const kp = Number(key); if (kp <= p && kp > best) best = kp; }
  return best;
}

/** A property's value on layer k (period p for recharge): a number, nrow*ncol values, or null. */
export function layerValue(m, prop, k, p = 0) {
  const ncpl = ncplOf(m);
  switch (prop) {
    case 'k': case 'k33': return m.npf[prop][k];
    case 'k22': return m.npf.k22 ? m.npf.k22[k] : null;
    case 'ss': case 'sy': return m.sto[prop][k];
    case 'strt': return m.ic.strt[k];
    case 'botm': return m.grid.botm[k];
    case 'top': return m.grid.top;
    case 'idomain': return m.grid.idomain ? m.grid.idomain.slice(k * ncpl, (k + 1) * ncpl) : 1;
    case 'rch': { const v = inForce(m.rch, p); return v === undefined ? null : v; }
    default: throw new Error(`No property ${prop}.`);
  }
}

/** Sets a property's value on layer k: a number, nrow*ncol values, or null for not given. */
export function setLayerValue(m, prop, k, v, p = 0) {
  const ncpl = ncplOf(m);
  switch (prop) {
    case 'k': case 'k33': m.npf[prop][k] = v; break;
    case 'k22': {
      // K22 is given for every layer or none: cleared everywhere, it equals K again.
      if (!m.npf.k22) m.npf.k22 = new Array(m.grid.nlay).fill(null);
      m.npf.k22[k] = v;
      if (m.npf.k22.every((x) => x === null)) delete m.npf.k22;
      break;
    }
    case 'ss': case 'sy': m.sto[prop][k] = v; break;
    case 'strt': m.ic.strt[k] = v; break;
    case 'botm': m.grid.botm[k] = v; break;
    case 'top': m.grid.top = v; break;
    case 'idomain': {
      if (v === 1 && !m.grid.idomain) break;
      // Recharge set to the top active cell of each column follows the active cells.
      const top = rchLayer(m).kind === 'top';
      if (!m.grid.idomain) m.grid.idomain = new Array(m.grid.nlay * ncpl).fill(1);
      for (let c = 0; c < ncpl; c++) m.grid.idomain[k * ncpl + c] = Array.isArray(v) ? v[c] : v;
      if (m.grid.idomain.every((x) => x === 1)) m.grid.idomain = null;
      if (top) m.irch = { 0: topActiveLayers(m) };
      break;
    }
    case 'rch': {
      if (m.rchList) throw new Error('This model gives recharge as a list of cells (from its MODFLOW 6 files), and one RCH package takes one form: recharge is not painted here.');
      if (!m.rch) m.rch = {};
      // Recharge cleared in a period falls back to the period before, as MODFLOW 6 keeps it.
      if (v === null) delete m.rch[p]; else m.rch[p] = v;
      if (!Object.keys(m.rch).length) delete m.rch;
      break;
    }
    default: throw new Error(`No property ${prop}.`);
  }
}

/** Per column, the highest layer (from 0) whose cell is active, or 0 where none is. */
export function topActiveLayers(m) {
  const g = m.grid, ncpl = ncplOf(m), out = new Array(ncpl).fill(0);
  if (!g.idomain) return out;
  for (let c = 0; c < ncpl; c++) {
    for (let k = 0; k < g.nlay; k++) if (g.idomain[k * ncpl + c] === 1) { out[c] = k; break; }
  }
  return out;
}

/**
 * Where recharge goes, as the page sets it (MODFLOW 6 RCHA IRCH): { kind } is 'layer1' (no irch,
 * MODFLOW 6's default), 'top' (period 1's irch is the top active layer of each column),
 * 'layer' with { layer } (one layer for every column), or 'files' (irch as a model's files gave
 * it, kept as it is).
 */
export function rchLayer(m) {
  // Recharge given as a list names each cell, in any layer: there is no one layer to show.
  if (m.rchList) return { kind: 'list' };
  if (!m.irch) return { kind: 'layer1' };
  const keys = Object.keys(m.irch);
  if (keys.length !== 1 || keys[0] !== '0') return { kind: 'files' };
  const v = m.irch[0];
  if (typeof v === 'number') return { kind: 'layer', layer: v };
  const top = topActiveLayers(m);
  return Array.isArray(v) && v.every((k, c) => k === top[c]) ? { kind: 'top' } : { kind: 'files' };
}

/** Sets where recharge goes: kind 'layer1', 'top' or 'layer' (with layer, from 0), as rchLayer gives them. */
export function setRchLayer(m, kind, layer) {
  if (kind === 'layer1') delete m.irch;
  else if (kind === 'top') m.irch = { 0: topActiveLayers(m) };
  else if (kind === 'layer') {
    if (!(Number.isInteger(layer) && layer >= 0 && layer < m.grid.nlay)) throw new Error(`Recharge: layer ${layer + 1} is not one of the model's layers.`);
    m.irch = { 0: layer };
  } else throw new Error(`Recharge: no choice ${kind}.`);
}

/** Recharge kept on its own cell when that cell is dry (MODFLOW 6 FIXED_CELL), on or off. */
export function setRchFixedCell(m, on) {
  const key = m.rchList ? 'rchList' : 'rch';
  const o = { ...(m.options || {}) };
  if (on) o[key] = { ...(o[key] || {}), fixedCell: true };
  else if (o[key]) { const { fixedCell, ...rest } = o[key]; void fixedCell; if (Object.keys(rest).length) o[key] = rest; else delete o[key]; }
  if (Object.keys(o).length) m.options = o; else delete m.options;
}

/** Gives cells (indices within the layer) the value v, keeping the rest of the layer as it was. */
export function paintCells(m, prop, k, cells, v, p = 0) {
  const ncpl = ncplOf(m);
  const now = layerValue(m, prop, k, p);
  const arr = Array.isArray(now) ? now.slice() : new Array(ncpl).fill(now);
  for (const c of cells) arr[c] = v;
  setLayerValue(m, prop, k, arr, p);
}

/** What a layer holds: 'none', 'value' (one number), 'painted' (every cell given) or 'partial'. */
export function describe(v) {
  if (v === null || v === undefined) return { state: 'none' };
  if (isNum(v)) return { state: 'value', value: v };
  let given = 0, min = Infinity, max = -Infinity;
  for (const x of v) if (x !== null) { given++; if (x < min) min = x; if (x > max) max = x; }
  return { state: given === v.length ? 'painted' : given ? 'partial' : 'none', given, total: v.length, min, max };
}

// ---------------------------------------------------------------------------------------
// Boundaries, period by period. A period's list stands until a later period gives its own,
// as in MODFLOW 6; editing a period that has none first copies the list in force.

/** The list of package id in force in period p (not a copy). */
export const listIn = (m, id, p) => inForce(m[id], p) || [];

/** The list of package id that period p owns, made from the list in force if it had none. */
export function ownList(m, id, p) {
  if (!m[id]) m[id] = {};
  if (!m[id][p]) m[id][p] = listIn(m, id, p).map((e) => e.slice());
  return m[id][p];
}

/** Period p goes back to using the list of the period before it. */
export function dropOwnList(m, id, p) {
  if (m[id]) delete m[id][p];
  if (m[id] && !Object.keys(m[id]).length) delete m[id];
}

/**
 * Why evapotranspiration cells cannot be placed on the page in this model, or null: one EVT
 * package takes one form and one number of segments, and the page places cells with one.
 */
export function evtCellsBlocked(m) {
  if (m.evt) return 'This model gives evapotranspiration as arrays (from its MODFLOW 6 files), and one EVT package takes one form: cells are not placed here.';
  const wide = Object.values(m.evtList || {}).flat().find((e) => e.length > 6);
  if (wide) return `This model's evapotranspiration has ${(wide.length - 6) / 2 + 1} segments (from its MODFLOW 6 files); cells placed here have one, and MODFLOW 6 takes one number of segments for the package.`;
  return null;
}

/**
 * What evapotranspiration given as arrays (a model's evt, from MODFLOW 6 EVT with
 * READASARRAYS) holds in period p, for the page to show though it does not edit them: the
 * range of the ET surface, the maximum rate and the extinction depth over the active cells
 * of the layer they go to, the layer (IEVT), and FIXED_CELL; as MODFLOW 6 keeps each array
 * until a later period gives it again. '' when the model has no ET arrays.
 */
export function evtArraysText(m, p, sig) {
  if (!m.evt) return '';
  const ncpl = ncplOf(m);
  const keys = Object.keys(m.evt).map(Number).sort((a, b) => a - b);
  const latest = (field) => { let v; for (const k of keys) if (k <= p && m.evt[k] && m.evt[k][field] !== undefined) v = m.evt[k][field]; return v; };
  const head = 'Evapotranspiration is given as arrays (from the model\'s MODFLOW 6 files), and is kept and run as it is; it is not edited here.';
  const surface = latest('surface'), rate = latest('rate'), depth = latest('depth'), ievt = latest('ievt');
  if (surface === undefined && rate === undefined && depth === undefined) return `${head} None is in force in period ${p + 1}; it starts in period ${keys[0] + 1}.`;
  const layerOf = (c) => (ievt === undefined ? 0 : typeof ievt === 'number' ? ievt : ievt[c]);
  const idomain = m.grid.idomain;
  const span = (v, unit) => {
    if (v === undefined) return 'not given';
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < ncpl; c++) {
      if (idomain && idomain[layerOf(c) * ncpl + c] !== 1) continue;
      const x = typeof v === 'number' ? v : v[c];
      if (x < lo) lo = x; if (x > hi) hi = x;
    }
    if (!(hi >= lo)) return 'on no active cell';
    return lo === hi ? `${sig(lo, 4)} ${unit}` : `${sig(lo, 4)} to ${sig(hi, 4)} ${unit}`;
  };
  const layer = ievt === undefined ? 'layer 1 (no IEVT)' : typeof ievt === 'number' ? `layer ${ievt + 1} (IEVT)` : 'the layer IEVT gives for each column';
  const fixed = m.options && m.options.evt && m.options.evt.fixedCell ? ', with FIXED_CELL' : '';
  return `${head} In period ${p + 1}: the ET surface ${span(surface, 'm')}, the maximum rate ${span(rate, 'm/d')} and the extinction depth ${span(depth, 'm')}, on ${layer}${fixed}.`;
}

/** Places a boundary on a cell in period p, replacing any of the same package on that cell. */
export function placeEntry(m, id, p, lay, row, col, values) {
  if (values.length !== PACKAGES[id].values.length || !values.every(isNum)) throw new Error(`${PACKAGES[id].label}: every value is needed.`);
  if (id === 'evtList' && evtCellsBlocked(m)) throw new Error(evtCellsBlocked(m));
  const list = ownList(m, id, p);
  const at = list.findIndex((e) => e[0] === lay && e[1] === row && e[2] === col);
  const entry = [lay, row, col, ...values];
  if (at >= 0) list[at] = entry; else list.push(entry);
}

/** Removes the boundaries of package id in period p on the cells given as [lay, row, col]. Returns how many. */
export function removeEntries(m, id, p, cells) {
  const has = listIn(m, id, p);
  const key = (l, r, c) => `${l},${r},${c}`;
  const drop = new Set(cells.map((c) => key(...c)));
  if (!has.some((e) => drop.has(key(e[0], e[1], e[2])))) return 0;
  const list = ownList(m, id, p);
  const before = list.length;
  m[id][p] = list.filter((e) => !drop.has(key(e[0], e[1], e[2])));
  return before - m[id][p].length;
}

// ---------------------------------------------------------------------------------------
// Periods

// What else is given period by period: recharge (as arrays, their layer, or a list), and
// evapotranspiration as arrays.
const PER_PERIOD = ['rch', 'irch', 'rchList', 'evt'];

export function addPeriod(m) {
  m.periods.push({ length: null, nstp: null, tsmult: null, steady: null });
}

/**
 * What removing period i would lose: the packages whose own list in period i is in force in
 * no other period, because period i is the last or the next period has its own. A list that
 * the next period inherits is kept: it moves to that period (removePeriod).
 */
export function listsLostWith(m, i) {
  const out = [];
  for (const id of [...PACKAGE_IDS, ...PER_PERIOD]) {
    const pkg = m[id];
    if (!pkg || pkg[i] === undefined) continue;
    // Evapotranspiration arrays the next period does not give itself move to it (removePeriod).
    const covered = id !== 'evt' || i + 1 >= m.periods.length || pkg[i + 1] === undefined || Object.keys(pkg[i]).every((k) => k in pkg[i + 1]);
    if (covered && (i + 1 >= m.periods.length || pkg[i + 1] !== undefined)) out.push(id);
  }
  return out;
}

/**
 * Removes period i. Lists given from a later period move up with it. A list given in period i
 * that the next period inherits moves to the next period, so every later period keeps the
 * boundaries it had; one that no other period uses is dropped (listsLostWith says which).
 */
export function removePeriod(m, i) {
  for (const id of [...PACKAGE_IDS, ...PER_PERIOD]) {
    const pkg = m[id];
    // Evapotranspiration arrays given in period i stand for the next period too, each array
    // on its own, so those the next period does not give move to it.
    if (id === 'evt' && pkg && pkg[i] !== undefined && i + 1 < m.periods.length && pkg[i + 1] !== undefined) pkg[i + 1] = { ...pkg[i], ...pkg[i + 1] };
    if (pkg && pkg[i] !== undefined && i + 1 < m.periods.length && pkg[i + 1] === undefined) pkg[i + 1] = pkg[i];
  }
  const shift = (pkg) => {
    if (!pkg) return pkg;
    const out = {};
    for (const [key, v] of Object.entries(pkg)) {
      const p = Number(key);
      if (p < i) out[p] = v;
      else if (p > i) out[p - 1] = v;
    }
    return Object.keys(out).length ? out : undefined;
  };
  m.periods.splice(i, 1);
  for (const id of [...PACKAGE_IDS, ...PER_PERIOD]) { const s = shift(m[id]); if (s) m[id] = s; else delete m[id]; }
}

/** End time of every time step, as MODFLOW 6 TDIS sets the steps (sim-tdis.dfn, tsmult). */
export function stepTimes(periods) {
  const out = [];
  let t = 0;
  for (const p of periods) {
    let delt = p.tsmult !== 1 ? p.length * (1 - p.tsmult) / (1 - p.tsmult ** p.nstp) : p.length / p.nstp;
    const start = t;
    for (let s = 0; s < p.nstp; s++) {
      if (s > 0) delt *= p.tsmult;
      t = s === p.nstp - 1 ? start + p.length : t + delt;
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// What is still needed, and the model the solver takes

const MF6_NAME = /^[A-Za-z0-9_.-]{1,16}$/;
const transientOf = (m) => m.periods.some((p) => p.steady === false);

/**
 * What is still needed before the model can run, each as { part, text }: part is 'grid',
 * 'layers', 'periods', 'solver' or 'map', the panel where it is given. Only values not yet
 * given are listed here; a value given but impossible is in badParts().
 */
export function missingParts(m) {
  const out = [];
  const need = (part, text) => out.push({ part, text });
  if (m.units && m.units.length === 'UNKNOWN') need('units', 'the length unit of the MODFLOW 6 files');
  if (m.units && m.units.time === 'UNKNOWN') need('units', 'the time unit of the MODFLOW 6 files');
  if (!m.name) need('grid', 'a model name');
  const g = m.grid, nlay = g.nlay;
  const layerText = (k) => (nlay > 1 ? ` of layer ${k + 1}` : '');
  const check = (v, what) => {
    const d = describe(v);
    if (d.state === 'none') return what;
    if (d.state === 'partial') return `${what} (${countOf(d.total - d.given, 'cell', 'cells')} not painted)`;
    return null;
  };
  const layers = [];
  const add = (t) => { if (t) layers.push(t); };
  add(check(g.top, 'the top of the model'));
  for (let k = 0; k < nlay; k++) add(check(g.botm[k], `the bottom${layerText(k)}`));
  for (let k = 0; k < nlay; k++) if (m.npf.icelltype[k] === null) add(`the cell type${layerText(k)}`);
  for (let k = 0; k < nlay; k++) add(check(m.npf.k[k], `K${layerText(k)}`));
  for (let k = 0; k < nlay; k++) add(check(m.npf.k33[k], `K33${layerText(k)}`));
  // K22 is one array for the grid in MODFLOW 6: once given for a layer, every layer needs it.
  if (m.npf.k22) for (let k = 0; k < nlay; k++) { const t = check(m.npf.k22[k], `K22${layerText(k)}`); if (t) add(`${t} (or K22 for no layer, to have K22 equal to K)`); }
  if (transientOf(m)) {
    for (let k = 0; k < nlay; k++) add(check(m.sto.ss[k], `${propOf(m, 'ss').label}${layerText(k)}`));
    // MODFLOW 6 reads Sy for every layer once there is storage, though only convertible
    // layers use it, and the MODFLOW 6 writer needs it too.
    for (let k = 0; k < nlay; k++) add(check(m.sto.sy[k], `Sy${layerText(k)}`));
  }
  for (let k = 0; k < nlay; k++) add(check(m.ic.strt[k], `the starting head${layerText(k)}`));
  layers.forEach((t) => need('layers', t));
  if (!m.periods.length) need('periods', 'at least one stress period');
  m.periods.forEach((p, i) => {
    const gaps = [];
    if (p.length === null) gaps.push('length');
    if (p.nstp === null) gaps.push('steps');
    if (p.tsmult === null) gaps.push('multiplier');
    if (typeof p.steady !== 'boolean') gaps.push('steady or transient');
    if (gaps.length) need('periods', `period ${i + 1}: ${gaps.join(', ')}`);
  });
  if (m.rch) for (const [p, v] of Object.entries(m.rch)) { const t = check(v, `recharge in period ${Number(p) + 1}`); if (t) need('periods', t); }
  const s = m.solver;
  const solverGaps = [];
  if (s.outer === null) solverGaps.push('outer iterations');
  if (s.inner === null) solverGaps.push('inner iterations');
  if (s.hclose === null) solverGaps.push('head closure');
  if (s.rclose === null) solverGaps.push('residual closure');
  if (solverGaps.length) need('solver', `the solver's ${solverGaps.join(', ')}`);
  for (const t of solverOptionGaps(s)) need('solver', t);
  for (const t of rewetGaps(m)) need('solver', t);
  if (m.obs.some((o) => !o.name)) need('map', 'a name for every observation point');
  return out;
}

/**
 * Values given that no model can have, each as { part, text, field }: text names the field
 * and the rule ("K of layer 1 must be above zero."), and field says which input to mark:
 * { prop, k } for a layer value, { period, key } for a period, { solver: key }, or { name }.
 * Only active cells are checked, as the solver checks them. Run stays off while any is listed.
 */
export function badParts(m) {
  const out = [];
  const bad = (part, text, field = null) => out.push({ part, text, field });
  if (m.name && !MF6_NAME.test(m.name)) bad('grid', 'The model name must be 1 to 16 letters, digits, _, . or -, as MODFLOW 6 takes.', { name: true });
  const g = m.grid, nlay = g.nlay, ncpl = ncplOf(m);
  const active = (k, c) => !g.idomain || g.idomain[k * ncpl + c] === 1;
  const of = (k) => (nlay > 1 ? ` of layer ${k + 1}` : '');
  const at = (v, c) => (v === null || v === undefined ? null : typeof v === 'number' ? v : v[c]);
  // The cells of layer k where a given value breaks the rule, with the first one.
  const scan = (v, k, wrong) => {
    let n = 0, first = -1, value = null;
    if (v === null || v === undefined) return { n };
    for (let c = 0; c < ncpl; c++) {
      const x = at(v, c);
      if (x === null || !active(k, c) || !wrong(x)) continue;
      if (first < 0) { first = c; value = x; }
      n++;
    }
    return { n, first, value };
  };
  const where = (k, r) => (r.n === 0 ? '' : typeof r.value === 'number' && r.n === ncpl ? '' : ` (${r.n === 1 ? cellName(k, Math.floor(r.first / g.ncol), r.first % g.ncol) : `${r.n} cells, such as ${cellName(k, Math.floor(r.first / g.ncol), r.first % g.ncol)}`})`);
  const rules = [
    ['k', 'K', (x) => !(x > 0), 'must be above zero', (k) => m.npf.k[k]],
    ['k33', 'K33', (x) => !(x > 0), 'must be above zero', (k) => m.npf.k33[k]],
    ['k22', 'K22', (x) => !(x > 0), 'must be above zero', (k) => (m.npf.k22 ? m.npf.k22[k] : null)],
    ['ss', propOf(m, 'ss').label, (x) => x < 0, 'cannot be below zero', (k) => m.sto.ss[k]],
    ['sy', 'Sy', (x) => x < 0 || x > 1, 'must be from 0 to 1', (k) => m.sto.sy[k]],
  ];
  for (const [prop, label, wrong, rule, get] of rules) {
    for (let k = 0; k < nlay; k++) {
      const v = get(k), r = scan(v, k, wrong);
      if (r.n) bad('layers', `${label}${of(k)} ${rule}${typeof v === 'number' ? '' : where(k, r)}.`, { prop, k });
    }
  }
  // Each layer's bottom below its top: the model top for layer 1, the bottom above for the rest.
  for (let k = 0; k < nlay; k++) {
    const top = k === 0 ? g.top : g.botm[k - 1], bot = g.botm[k];
    if (describe(top).state === 'none' || describe(bot).state === 'none') continue;
    let n = 0, first = -1;
    for (let c = 0; c < ncpl; c++) {
      const t = at(top, c), b = at(bot, c);
      if (t === null || b === null || !active(k, c) || b < t) continue;
      if (first < 0) first = c;
      n++;
    }
    if (n) {
      const t = at(top, first), b = at(bot, first);
      const cell = cellName(k, Math.floor(first / g.ncol), first % g.ncol);
      bad('layers', `The bottom${of(k)} must be below its top: at ${cell} it is ${b} m, against a top of ${t} m${n > 1 ? `, and ${countOf(n - 1, 'other cell is', 'other cells are')} the same` : ''}.`, { prop: 'botm', k });
    }
  }
  m.periods.forEach((p, i) => {
    if (p.length !== null && !(p.length > 0)) bad('periods', `Period ${i + 1}: the length must be above zero.`, { period: i, key: 'length' });
    if (p.nstp !== null && !(Number.isInteger(p.nstp) && p.nstp >= 1)) bad('periods', `Period ${i + 1}: the number of time steps must be a whole number of at least 1.`, { period: i, key: 'nstp' });
    if (p.tsmult !== null && !(p.tsmult > 0)) bad('periods', `Period ${i + 1}: the step multiplier must be above zero.`, { period: i, key: 'tsmult' });
  });
  const s = m.solver;
  for (const [key, what] of [['outer', 'outer iterations'], ['inner', 'inner iterations']]) {
    if (s[key] !== null && !(Number.isInteger(s[key]) && s[key] >= 1)) bad('solver', `The solver's ${what} must be a whole number of at least 1.`, { solver: key });
  }
  for (const [key, what] of [['hclose', 'head closure'], ['rclose', 'residual closure']]) {
    if (s[key] !== null && !(s[key] > 0)) bad('solver', `The solver's ${what} must be above zero.`, { solver: key });
  }
  for (const w of solverOptionProblems(s)) bad('solver', w.text, { solver: w.key });
  for (const w of newtonProblems(m)) bad('solver', w.text, { solver: w.key });
  for (const w of rewetProblems(m)) bad('solver', w.text, { solver: w.key });
  // Boundaries and observations on cells that are not active: the solver refuses them.
  const on = (l, r, c) => !g.idomain || g.idomain[l * ncpl + r * g.ncol + c] === 1;
  for (const id of PACKAGE_IDS) {
    if (!m[id]) continue;
    for (const [p, list] of Object.entries(m[id])) {
      const off = list.filter((e) => !on(e[0], e[1], e[2]));
      if (!off.length) continue;
      const e = off[0], what = PACKAGES[id];
      bad('map', `${off.length === 1 ? `A ${what.label.toLowerCase()} in period ${Number(p) + 1} is on an inactive cell (${cellName(e[0], e[1], e[2])})` : `${off.length} ${what.plural.toLowerCase()} in period ${Number(p) + 1} are on inactive cells, such as ${cellName(e[0], e[1], e[2])}`}: remove ${off.length === 1 ? 'it' : 'them'} or make the cells active.`);
    }
  }
  const names = new Set();
  for (const o of m.obs) {
    if (o.name && names.has(o.name)) bad('map', `Each observation point needs its own name: ${o.name} is used twice.`);
    names.add(o.name);
    if (!on(o.lay, o.row, o.col)) bad('map', `Observation point ${o.name || '(no name)'} is on an inactive cell (${cellName(o.lay, o.row, o.col)}): move it or make the cell active.`);
  }
  return out;
}

/**
 * The model as the solver and the MODFLOW 6 writer take it: a deep copy with nothing
 * left null. Storage is left out when every period is steady, since it is not used.
 * Throws if anything is still needed.
 */
export function runnable(m) {
  const gaps = missingParts(m);
  if (gaps.length) throw new Error(`Still needed: ${gaps.map((x) => x.text).join('; ')}.`);
  const wrong = badParts(m);
  if (wrong.length) throw new Error(wrong.map((x) => x.text).join(' '));
  const nlay = m.grid.nlay;
  const out = {
    name: m.name,
    grid: { nlay, nrow: m.grid.nrow, ncol: m.grid.ncol, delr: m.grid.delr.slice(), delc: m.grid.delc.slice(), top: clone(m.grid.top), botm: m.grid.botm.map(clone), idomain: m.grid.idomain ? m.grid.idomain.slice() : null },
    npf: { icelltype: m.npf.icelltype.slice(), k: m.npf.k.map(clone), ...(m.npf.k22 ? { k22: m.npf.k22.map(clone) } : {}), k33: m.npf.k33.map(clone) },
    ic: { strt: m.ic.strt.map(clone) },
    periods: m.periods.map((p) => ({ ...p })),
  };
  for (const k of NPF_OPTIONS) if (m.npf[k]) out.npf[k] = true;
  rewetForRun(m, out, clone);
  if (transientOf(m)) {
    out.sto = { ss: m.sto.ss.map(clone), sy: m.sto.sy.map(clone) };
    for (const k of STO_OPTIONS) if (m.sto[k]) out.sto[k] = true;
  }
  for (const id of PACKAGE_IDS) {
    if (m[id] && Object.keys(m[id]).length) out[id] = Object.fromEntries(Object.entries(m[id]).map(([p, list]) => [p, list.map((e) => e.slice())]));
  }
  if (m.rch && Object.keys(m.rch).length) out.rch = Object.fromEntries(Object.entries(m.rch).map(([p, v]) => [p, clone(v)]));
  for (const key of KEPT) if (m[key] !== undefined) out[key] = structuredClone(m[key]);
  if (m.obs.length) out.obs = m.obs.map((o) => ({ ...o }));
  out.solver = solverForRun(m.solver);
  if (m.newton) out.newton = m.newton === true ? true : { ...m.newton };
  if (m.units) out.units = { ...m.units };
  if (m.fileUnits) out.fileUnits = { ...m.fileUnits };
  if (m.georef) out.georef = { ...m.georef };
  if (m.startDateTime) out.startDateTime = m.startDateTime;
  return out;
}

/**
 * The model converted to metres and days from the units its files were in, by convert (the
 * engine's convertUnits), with every value not yet given (null) kept null rather than
 * multiplied into 0.
 */
export function convertKeepingGaps(m, units, convert) {
  const out = convert(m, units);
  const keep = (a, b) => { if (Array.isArray(a) && Array.isArray(b)) a.forEach((v, i) => { if (v === null) b[i] = null; }); };
  const layers = (a, b) => { if (Array.isArray(a) && Array.isArray(b)) a.forEach((v, k) => { if (v === null) b[k] = null; else keep(v, b[k]); }); };
  keep(m.grid.top, out.grid.top);
  if (m.grid.top === null) out.grid.top = null;
  layers(m.grid.botm, out.grid.botm);
  layers(m.npf.k, out.npf.k);
  layers(m.npf.k33, out.npf.k33);
  if (m.npf.k22) layers(m.npf.k22, out.npf.k22);
  if (m.npf.wetdry) layers(m.npf.wetdry, out.npf.wetdry);
  if (m.sto && out.sto) { layers(m.sto.ss, out.sto.ss); layers(m.sto.sy, out.sto.sy); }
  layers(m.ic.strt, out.ic.strt);
  if (m.rch && out.rch) for (const p of Object.keys(m.rch)) keep(m.rch[p], out.rch[p]);
  for (const key of ['outer', 'inner', 'hclose', 'rclose']) if (m.solver[key] === null) out.solver[key] = null;
  m.periods.forEach((p, i) => { for (const key of ['length', 'nstp', 'tsmult']) if (p[key] === null) out.periods[i][key] = null; });
  return out;
}

/**
 * The model as it is saved: as edited, with null still marking each value not yet given,
 * but without parts that hold nothing at all (storage with no value, no observation
 * points), so a complete model is saved exactly as the design's JSON.
 */
export function forSaving(m) {
  const out = JSON.parse(JSON.stringify(m));
  if (out.sto && [...out.sto.ss, ...out.sto.sy].every((v) => v === null) && !STO_OPTIONS.some((k) => out.sto[k])) delete out.sto;
  if (!out.obs.length) delete out.obs;
  return out;
}

/**
 * The model as JSON text for saving: one key to a line, with each list of numbers kept
 * on one line, so a file of a large grid stays readable. JSON.parse reads it back exactly.
 */
export function toJsonText(m) {
  return JSON.stringify(m, null, 1).replace(/\[[\s\d.eE+\-,null]*\]/g, (list) => {
    const items = list.slice(1, -1).split(',').map((s) => s.trim()).filter((s) => s !== '');
    return `[${items.join(', ')}]`;
  });
}
