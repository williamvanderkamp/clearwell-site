// The calibration panel of the model page (docs/design/model-tools.md, section 3): the user
// picks which zones and parameter kinds to fit, gives measured heads, typed or from a CSV,
// and the fit runs in a Web Worker. It shows the fitted values with their 95% intervals,
// the residuals, measured against computed heads, and the sensitivities and correlations.
// It works only on a run of the model as it is now, keeps what is typed in it across runs,
// and "Use the fitted values" applies the fitted values to the page's current model.
// See docs/tools/model-calibrate.md.
//
// The fit itself runs in calibrate-worker.js. Nothing that needs a window is imported at
// the top, so the plain functions below can be tested in Node; kit.js is imported when the
// panel is mounted.
import { fromSpec } from '../../../engine/model/calibrate.js';
import { stepTimes as schedule, timeWeights } from '../../../engine/model/run.js';
import { countOf, listed } from '../../../engine/format.js';
import { startJob } from '../../worker-job.js';

// ---------------------------------------------------------------------------------------
// Plain functions, with no DOM: what can be fitted in a model, and reading measured heads.

// A layer whose painted values number more than this is a field, not zones: it is offered
// only as a whole, since a list of every value would be no help.
const MOST_ZONES = 12;

const layerValues = (v, ncpl) => (typeof v === 'number' ? new Array(ncpl).fill(v) : Array.from(v));

// The zones of one per-layer input: the whole layer, and each painted value in it.
function zonesOf(layers, model, label, unitText) {
  const { nlay, nrow, ncol } = model.grid, ncpl = nrow * ncol, N = nlay * ncpl;
  const active = (n) => !model.grid.idomain || model.grid.idomain[n] !== 0;
  const out = [];
  for (let k = 0; k < nlay; k++) {
    const vals = layerValues(layers[k], ncpl);
    const cells = vals.map((_, c) => k * ncpl + c).filter(active);
    if (!cells.length) continue;
    const mask = new Array(N).fill(0);
    for (const n of cells) mask[n] = 1;
    const distinct = [...new Set(cells.map((n) => vals[n - k * ncpl]))];
    out.push({ key: `L${k}`, layer: k, name: `layer ${k + 1}`, mask, value: distinct.length === 1 ? distinct[0] : null, cells: cells.length, whole: true });
    if (distinct.length < 2 || distinct.length > MOST_ZONES) continue;
    for (const v of distinct.sort((a, b) => a - b)) {
      const zm = new Array(N).fill(0);
      let count = 0;
      for (const n of cells) if (vals[n - k * ncpl] === v) { zm[n] = 1; count++; }
      out.push({ key: `L${k}=${v}`, layer: k, name: `layer ${k + 1}, the ${countOf(count, 'cell')} with ${label} ${v}${unitText}`, mask: zm, value: v, cells: count });
    }
  }
  return out;
}

/**
 * What can be fitted in a model, as ready-made parameter specs (calibrate.js fromSpec) with
 * a starting value from the model itself: 1 for a multiplier, which is the model as it is,
 * and the zone's own value for Ss and Sy. Nothing is assumed beyond the model.
 */
export function candidates(model) {
  const out = [];
  out.push({ key: 'K:all', group: 'K', label: 'K multiplier, whole model', spec: { type: 'zoneK', zone: null }, start: 1, k33: true });
  for (const z of zonesOf(model.npf.k, model, 'K', ' m/d')) {
    // base: the zone's own K, when it has one value, so the panel can say what a multiplier gives.
    out.push({ key: `K:${z.key}`, group: 'K', label: `K multiplier, ${z.name}`, spec: { type: 'zoneK', zone: z.mask }, start: 1, k33: true, base: z.value, baseName: 'K', baseUnit: 'm/d' });
  }
  if (model.rch && Object.keys(model.rch).length) {
    const rates = Object.values(model.rch);
    out.push({ key: 'R:all', group: 'Recharge', label: 'Recharge multiplier, every cell and period', spec: { type: 'recharge', as: 'multiplier', zone: null }, start: 1,
      ...(rates.length === 1 && typeof rates[0] === 'number' ? { base: rates[0], baseName: 'recharge', baseUnit: 'm/d' } : {}) });
    // Zones of recharge as painted in the first period that has it.
    const first = model.rch[Object.keys(model.rch).sort((a, b) => a - b)[0]];
    if (typeof first !== 'number') {
      const distinct = [...new Set(first)];
      if (distinct.length > 1 && distinct.length <= MOST_ZONES) {
        for (const v of distinct.sort((a, b) => a - b)) {
          const mask = Array.from(first, (x) => (x === v ? 1 : 0));
          const count = mask.reduce((a, b) => a + b, 0);
          out.push({ key: `R:=${v}`, group: 'Recharge', label: `Recharge multiplier, the ${countOf(count, 'cell')} with ${v} m/d in the first period`, spec: { type: 'recharge', as: 'multiplier', zone: mask }, start: 1, base: v, baseName: 'recharge', baseUnit: 'm/d' });
        }
      }
    }
  }
  if (model.riv && Object.values(model.riv).some((l) => l.length)) {
    out.push({ key: 'C:all', group: 'River', label: 'Riverbed conductance multiplier, every river cell', spec: { type: 'riverConductance', zone: null }, start: 1 });
  }
  if (model.sto && model.periods.some((p) => !p.steady)) {
    // With STORAGECOEFFICIENT the values are the storage coefficient S, with no unit.
    const coef = Boolean(model.sto.storagecoefficient), ss = coef ? 'S' : 'Ss';
    for (const z of zonesOf(model.sto.ss, model, ss, coef ? '' : ' per m')) {
      if (z.value === null) continue;
      out.push({ key: `Ss:${z.key}`, group: 'Storage', label: `${ss}, ${z.name}`, spec: { type: 'zoneSs', zone: z.mask, ...(coef ? { coefficient: true } : {}) }, start: z.value });
    }
    const convertible = (k) => { const v = model.npf.icelltype[k]; return typeof v === 'number' ? v !== 0 : v.some((x) => x !== 0); };
    if (model.sto.sy) {
      for (const z of zonesOf(model.sto.sy, model, 'Sy', '')) {
        if (z.value === null || !convertible(z.layer)) continue;
        out.push({ key: `Sy:${z.key}`, group: 'Storage', label: `Sy, ${z.name}`, spec: { type: 'zoneSy', zone: z.mask }, start: z.value });
      }
    }
  }
  return out;
}

/**
 * What the model has that candidates() does not offer to fit, as sentences for the panel:
 * recharge given as a list (the recharge parameters act on recharge arrays) and
 * evapotranspiration, which no parameter here changes.
 */
export function notOffered(model) {
  const out = [];
  if (model.rchList) out.push('Recharge given as a list (cell by cell, MODFLOW 6 RCH without READASARRAYS) is not offered: the recharge parameters act on recharge arrays.');
  if (model.evt || model.evtList) out.push('Evapotranspiration is not offered: no parameter here changes it.');
  return out;
}

/** The end of every time step, d, as the solver sets them (run.js stepTimes, MODFLOW 6 TDIS). */
export const stepTimes = (model) => schedule(model.periods).map((x) => x.time);

const COLUMNS = {
  name: /^(name|well|id|point|obs)/i,
  layer: /^(layer|lay)\b/i,
  row: /^row\b/i,
  col: /^(col|column)\b/i,
  time: /^(time|day|t\b)/i,
  head: /^(head|level|water level|observed|measured)/i,
  sd: /^(sd|s\.d\.|std|standard deviation|sigma|error)/i,
};
const COLUMN_NAMES = { name: 'name', layer: 'layer', row: 'row', col: 'column', head: 'head' };

/**
 * Measured heads from a table { header, rows }: a name, layer, row and column counted from 1
 * as MODFLOW counts them, the time in days (left out only when the model has one time
 * step), the head in metres, and optionally the standard deviation of its error in metres,
 * from which the weight is 1/sd² (Hill 1998, p. 14). An sd column left blank in every row
 * means no sd. Returns the observations for calibrate(), or throws, naming the row.
 *
 * Time: any time in the run. Where it falls is the solver's timeWeights, as MODFLOW-2000's
 * head observations place it (Hill et al. 2000, p. 24): { step, from, frac } means the
 * head (1 − frac) h(from) + frac h(step), from = −1 being the starting heads; a time at a step
 * end, or within a steady step, is that step alone. calibrate() does the interpolation;
 * these fields say what it will do, for the page.
 */
export function readHeads(tbl, model) {
  const at = {};
  for (const [key, rx] of Object.entries(COLUMNS)) {
    const i = tbl.header.findIndex((h) => rx.test(String(h).trim()));
    if (i >= 0) at[key] = i;
  }
  const missing = ['name', 'layer', 'row', 'col', 'head'].filter((k) => at[k] === undefined);
  if (missing.length) throw new Error(`The heads need a column for each of ${missing.map((k) => COLUMN_NAMES[k]).join(', ')}, with a heading row: name, layer, row, column, time, head, and sd if you have it.`);
  const times = stepTimes(model);
  const g = model.grid, ncpl = g.nrow * g.ncol;
  const num = (v) => (typeof v === 'number' ? v : v === null || v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim()));
  const blank = (v) => v === null || v === undefined || String(v).trim() === '';
  const useSd = at.sd !== undefined && tbl.rows.some((r) => !blank(r[at.sd]));
  const obs = tbl.rows.map((r, i) => {
    const where = `Row ${i + 1} of the heads`;
    const [L, R, C] = ['layer', 'row', 'col'].map((k) => num(r[at[k]]));
    if (![L, R, C].every(Number.isInteger)) throw new Error(`${where}: the layer, row and column must be whole numbers, counted from 1.`);
    if (L < 1 || L > g.nlay || R < 1 || R > g.nrow || C < 1 || C > g.ncol) throw new Error(`${where}: layer ${L}, row ${R}, column ${C} is outside the grid of ${g.nlay} × ${g.nrow} × ${g.ncol}.`);
    const [lay, row, col] = [L - 1, R - 1, C - 1];
    if (g.idomain && g.idomain[lay * ncpl + row * g.ncol + col] !== 1) throw new Error(`${where}: layer ${L}, row ${R}, column ${C} is not an active cell.`);
    const value = num(r[at.head]);
    if (!Number.isFinite(value)) throw new Error(`${where}: give the head, in m${blank(r[at.head]) ? '' : '; it is not a number'}.`);
    let place;
    const t = at.time === undefined ? NaN : num(r[at.time]);
    if (Number.isFinite(t)) {
      let w;
      try { w = timeWeights(model.periods, t); } catch (e) { throw new Error(`${where}: ${e.message}`); }
      place = w.w === 1 ? { step: w.b } : { step: w.b, from: w.a, frac: w.w };
    } else if (times.length === 1) place = { step: 0 };
    else throw new Error(`${where}: give the time it was measured, in days.`);
    let weight;
    if (useSd) {
      const sd = num(r[at.sd]);
      if (!(sd > 0)) throw new Error(`${where}: ${blank(r[at.sd]) ? 'give the standard deviation, or leave the sd column empty for every head' : 'the standard deviation must be above zero'}.`);
      weight = 1 / sd ** 2;
    }
    return { name: String(r[at.name] ?? '').trim(), lay, row, col, ...place, time: Number.isFinite(t) ? t : times[0], given: Number.isFinite(t), value, ...(weight !== undefined ? { weight } : {}) };
  });
  if (!obs.length) throw new Error('There are no measured heads.');
  return obs;
}

/**
 * The measured heads as calibrate() takes them: with the time when one was given (the engine
 * places it among the steps itself), otherwise with the step; never both, which it refuses.
 */
export function forEngine(observations) {
  return observations.map(({ from, frac, time, step, given, ...o }) => (given ? { ...o, time } : { ...o, step }));
}

// A value of a per-layer input at cell c of the layer: the layer's number, or its array's.
const at = (v, c) => (v === null || v === undefined || typeof v === 'number' ? v : v[c]);
const isList = (v) => Array.isArray(v) || ArrayBuffer.isView(v);
// Fitted values are put in to 4 significant figures, as the table of fitted values shows
// them, so the model holds what the table said rather than 20.00001628437863.
const FIGURES = 4;
const round = (x) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(FIGURES)) : x);

/**
 * Applies fitted values to a model, in place: each parameter's own apply() from the engine,
 * held ones at their held value, as the calibration ran them. Every value a parameter
 * changed is then rounded to 4 significant figures. A layer that was one number and now
 * has one value in all its active cells is kept as a number. Returns a short account, such
 * as "K multiplier, layer 1 × 0.3333".
 *
 * The page calls this only when fitChanges() finds the values the parameters act on as
 * they were in the calibrated run, so a multiplier multiplies the values it was fitted for.
 */
export function applyFitted(model, params, sig) {
  const g = model.grid, ncpl = g.nrow * g.ncol;
  const layersOf = (m) => [m.npf.k, m.npf.k33, m.npf.k22, m.sto && m.sto.ss, m.sto && m.sto.sy].filter(Boolean);
  // The engine's apply() puts a new array in each layer it changes, so a shallow copy keeps
  // the values before; river entries are changed in place, so their conductances are kept.
  const before = layersOf(model).map((ls) => ls.slice());
  const wasNumber = before.map((ls) => ls.map((v) => typeof v === 'number'));
  const rch0 = model.rch ? { ...model.rch } : null;
  const riv0 = new Map();
  for (const list of Object.values(model.riv || {})) for (const e of list) riv0.set(e, e[4]);
  const said = [];
  for (const p of params) {
    fromSpec(p.spec).apply(model, p.value);
    said.push(`${p.label} ${p.spec.type === 'zoneSs' || p.spec.type === 'zoneSy' ? '=' : '×'} ${sig(p.value, 4)}${p.spec.fixed ? ' (held)' : ''}`);
  }
  // Only what the fit changed is rounded; every other value stays as the user gave it.
  const roundChanged = (holder, key, old) => {
    const v = holder[key];
    if (typeof v === 'number') { if (v !== old) holder[key] = round(v); return; }
    if (isList(v)) for (let c = 0; c < v.length; c++) if (v[c] !== at(old, c)) v[c] = round(v[c]);
  };
  layersOf(model).forEach((ls, i) => ls.forEach((_, k) => roundChanged(ls, k, before[i][k])));
  if (model.rch && rch0) for (const key of Object.keys(model.rch)) roundChanged(model.rch, key, rch0[key]);
  for (const [e, c0] of riv0) if (e[4] !== c0) e[4] = round(e[4]);
  // A layer of one value that the fit left with one value in its active cells stays one
  // number (its inactive cells kept the old value, which no calculation uses).
  const active = (k, c) => !g.idomain || g.idomain[k * ncpl + c] === 1;
  layersOf(model).forEach((ls, i) => ls.forEach((v, k) => {
    if (!wasNumber[i][k] || !isList(v)) return;
    let first;
    for (let c = 0; c < v.length; c++) {
      if (!active(k, c)) continue;
      if (first === undefined) first = v[c];
      else if (v[c] !== first) return;
    }
    if (first !== undefined) ls[k] = first;
  }));
  return said.join('; ');
}

// The values a parameter acts on in a model, as [{ name, vals }], each vals a list to
// compare between two models on the same grid.
function actedOn(m, spec) {
  const { nlay, nrow, ncol } = m.grid, ncpl = nrow * ncol;
  const out = [];
  const layers = (ls, what) => {
    if (!ls) return;
    for (let k = 0; k < nlay; k++) {
      const vals = [];
      for (let c = 0; c < ncpl; c++) if (!spec.zone || spec.zone[k * ncpl + c]) vals.push(at(ls[k], c));
      if (vals.length) out.push({ name: `${what} of layer ${k + 1}`, vals });
    }
  };
  if (spec.type === 'zoneK') {
    layers(m.npf.k, 'K');
    if (spec.k33 === 'tied') layers(m.npf.k33, 'K33');
    layers(m.npf.k22, 'K22');
  } else if (spec.type === 'zoneSs') layers(m.sto && m.sto.ss, spec.coefficient ? 'S' : 'Ss');
  else if (spec.type === 'zoneSy') layers(m.sto && m.sto.sy, 'Sy');
  else if (spec.type === 'recharge') {
    const keys = Object.keys(m.rch || {}).sort((a, b) => a - b);
    out.push({ name: 'the periods that give recharge', vals: keys });
    for (const key of keys) {
      const vals = [];
      for (let c = 0; c < ncpl; c++) if (!spec.zone || spec.zone[c]) vals.push(at(m.rch[key], c));
      out.push({ name: `recharge in period ${Number(key) + 1}`, vals });
    }
  } else if (spec.type === 'riverConductance') {
    const vals = [];
    for (const key of Object.keys(m.riv || {}).sort((a, b) => a - b)) {
      for (const e of m.riv[key]) if (!spec.zone || spec.zone[e[0] * ncpl + e[1] * ncol + e[2]]) vals.push(`${key}:${e.join(',')}`);
    }
    out.push({ name: 'the river cells', vals });
  }
  return out;
}

/**
 * What the fitted parameters act on that differs between the model calibrated (ran) and the
 * model now: names such as "K of layer 1", or [] when every value they act on is as it was.
 * A fitted multiplier was found for the values of the run, so it must not multiply others.
 */
export function fitChanges(ran, now, params) {
  const a = ran.grid, b = now.grid;
  if (a.nlay !== b.nlay || a.nrow !== b.nrow || a.ncol !== b.ncol) return ['the grid'];
  const names = [];
  for (const p of params) {
    const was = actedOn(ran, p.spec), is = new Map(actedOn(now, p.spec).map((x) => [x.name, x.vals]));
    for (const x of was) {
      const y = is.get(x.name);
      if (!y || y.length !== x.vals.length || x.vals.some((v, i) => v !== y[i])) names.push(x.name);
      is.delete(x.name);
    }
    names.push(...is.keys());
  }
  return [...new Set(names)];
}

/** The words for fitChanges' names: "K of layer 1 has changed since this calibration". */
export function changesText(names) {
  const shown = names.slice(0, 4);
  return `${listed(shown)}${names.length > 4 ? ` and ${names.length - 4} more` : ''} ${names.length === 1 ? 'has' : 'have'} changed since this calibration`;
}

/**
 * What the fitted values put in the model, for the "In the model" column: the model as it
 * was calibrated, with every fitted and held value applied together as Use applies them,
 * read back in each parameter's zone. So a layer multiplier fitted with a whole-model one
 * shows their product, and the whole-model multiplier shows the K of each layer. Returns
 * { id: text }, with '' where the value column already says it (Ss and Sy).
 */
export function inTheModel(ran, params, sig, together = (t) => t) {
  const m = structuredClone(ran);
  applyFitted(m, params, sig);
  const { nlay, nrow, ncol, idomain } = m.grid, ncpl = nrow * ncol;
  const active = (n) => !idomain || idomain[n] === 1;
  const span = (vals, name, unit) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi >= lo)) return '';
    return together(lo === hi ? `${name} ${sig(lo, 4)} ${unit}` : `${name} ${sig(lo, 4)} to ${sig(hi, 4)} ${unit}`);
  };
  const out = {};
  for (const p of params) {
    const s = p.spec;
    let text = '';
    if (s.type === 'zoneK') {
      const per = [];
      for (let k = 0; k < nlay; k++) {
        const vals = [];
        for (let c = 0; c < ncpl; c++) if ((!s.zone || s.zone[k * ncpl + c]) && active(k * ncpl + c)) vals.push(at(m.npf.k[k], c));
        if (vals.length) per.push([k, span(vals, 'K', 'm/d')]);
      }
      text = per.length === 1 && s.zone ? per[0][1] : per.map(([k, t]) => `layer ${k + 1}: ${t}`).join('; ');
    } else if (s.type === 'recharge') {
      const per = Object.keys(m.rch || {}).sort((a, b) => a - b).map((key) => {
        const vals = [];
        for (let c = 0; c < ncpl; c++) if (!s.zone || s.zone[c]) vals.push(at(m.rch[key], c));
        return [Number(key), span(vals, 'recharge', 'm/d')];
      });
      text = !per.length ? '' : per.every(([, t]) => t === per[0][1]) ? per[0][1] : per.map(([key, t]) => `period ${key + 1}: ${t}`).join('; ');
    } else if (s.type === 'riverConductance') {
      const vals = [];
      for (const list of Object.values(m.riv || {})) for (const e of list) if (!s.zone || s.zone[e[0] * ncpl + e[1] * ncol + e[2]]) vals.push(e[4]);
      text = span(vals, 'conductance', 'm²/d');
    }
    out[s.id] = text;
  }
  return out;
}

/**
 * Why a fit should not be used, as sentences: a value that ran away by more than a
 * million-fold from its start, one the heads carry no information on (composite scaled
 * sensitivity 0), one whose interval cannot be found, or a search that did not converge.
 */
export function fitProblems(res, specs, sig) {
  const out = [];
  if (!res.fit.converged) out.push('The search did not converge.');
  // The engine names the values the heads cannot set (res.degenerate) and says why in its
  // warnings, which the panel shows; then only the name is repeated here.
  const engineSays = Array.isArray(res.degenerate);
  for (const p of specs) {
    const r = res.fit.params[p.id];
    if (!r || r.fixed) continue;
    if (engineSays) {
      // The status line is above the results and this box within them: the warning is
      // placed by what it is with, not by above or below.
      if (res.degenerate.includes(p.id)) out.push(`The heads cannot set ${p.label}; the warning with the fitted values says why.`);
    } else {
      const ratio = r.value / p.start;
      if (!(ratio < 1e6 && ratio > 1e-6)) out.push(`${p.label} ran to ${sig(r.value, 3)} from its start of ${sig(p.start, 3)}.`);
      const css = res.sensitivities.css[p.id];
      if (!(css > 0)) out.push(`The heads carry no information on ${p.label} (composite scaled sensitivity 0).`);
    }
    if (!intervalFound(r)) out.push(`The 95% interval of ${p.label} cannot be found.`);
  }
  return out;
}

/**
 * Whether a fitted value's 95% interval was found. Every value is fitted on its log, so a
 * lower limit of 0 is exp(−∞), an interval that could not be found, as is an infinite one.
 */
export const intervalFound = (r) => r.lower > 0 && Number.isFinite(r.lower) && Number.isFinite(r.upper);

/**
 * The engine's warnings as the page writes numbers: "1.00e-12" and a raw start such as
 * "0.0001" in "ran from 0.0001 to 1.00e-12" through sig(), so they read 1 × 10⁻⁴.
 */
export function tidyWarning(text, sig) {
  return String(text)
    .replace(/ran from (\S+) to (\S+?),/g, (m, a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? `ran from ${sig(Number(a), 3)} to ${sig(Number(b), 3)},` : m))
    .replace(/(?<![\w.])(\d+(?:\.\d+)?e[+-]?\d+)(?![\w.])/gi, (m) => sig(Number(m), 3));
}

/**
 * The interpolated heads whose computed value may owe much of its residual to the
 * interpolation itself: those in a step over which the computed head at the cell changes by
 * more than the residual. Linear interpolation across a step where the head falls almost at
 * once, as in the first step after a stress change, can be off by nearly that change.
 * observations are readHeads' (in the order of the residuals), heads the heads of the
 * calibrated run at the end of each step, strt the model's starting heads. Returns, for each
 * residual, the change across its step (m), or null where none is flagged.
 */
export function interpolationRisk(residuals, observations, heads, model) {
  const g = model.grid, ncpl = g.nrow * g.ncol;
  return residuals.map((r, i) => {
    const o = observations[i];
    if (!r.interpolated || !o || o.from === undefined || !heads || !heads[o.step]) return null;
    const n = o.lay * ncpl + o.row * g.ncol + o.col;
    const s0 = model.ic.strt[o.lay];
    const h0 = o.from < 0 ? at(s0, o.row * g.ncol + o.col) : heads[o.from][n];
    const change = Math.abs(heads[o.step][n] - h0);
    return Number.isFinite(change) && change > Math.abs(r.residual) ? change : null;
  });
}

export const CAL_REFERENCES = [
  'Doherty, J. (2025) Calibration and Uncertainty Analysis for Complex Environmental Models, second edition. Watermark Numerical Computing, Brisbane, Australia. ISBN 978-0-9943786-1-3.',
  'Hill, M.C. (1998) Methods and guidelines for effective model calibration; with application to UCODE, a computer code for universal inverse modeling, and MODFLOWP, a computer code for inverse modeling with MODFLOW. U.S. Geological Survey Water-Resources Investigations Report 98-4005. doi:10.3133/wri984005',
  'Hill, M.C., Banta, E.R., Harbaugh, A.W., and Anderman, E.R. (2000) MODFLOW-2000, the U.S. Geological Survey modular ground-water model; user guide to the observation, sensitivity, and parameter-estimation processes and three post-processing programs. U.S. Geological Survey Open-File Report 00-184. doi:10.3133/ofr00184',
];

/** The method text for kit's method(), for one calibration. */
export function calibrationMethod(specs, observations, res, sig) {
  const weighted = observations.some((o) => o.weight !== undefined);
  const between = observations.filter((o) => o.from !== undefined).length;
  return {
    steps: [
      { title: 'What is fitted', lines: [
        `Each parameter changes the model as it was run: a multiplier on K (with K33 tied to it or held, as chosen, and K22, where the model gives it, multiplied with K so K22/K stays as given), on recharge or on riverbed conductance in its zone, or the value of ${specs.some((p) => p.coefficient) ? 'the storage coefficient S (STORAGECOEFFICIENT)' : 'Ss'} or Sy in its zone. Every value is fitted on the log of itself, so it stays above zero.`,
      ], numbers: specs.map((p) => [p.label, p.fixed ? `held at ${sig(p.start, 4)}` : `from ${sig(p.start, 4)}`]) },
      { title: 'Weighted least squares', lines: [
        `The fit makes S(b) = Σ wᵢ (yᵢ − y′ᵢ(b))² as small as it can, where yᵢ is a measured head, y′ᵢ(b) the model's head there for the parameter values b, and wᵢ its weight (Hill 1998, eq. 1). ${weighted ? 'Each weight is 1/sd², one over the variance of the measurement error (Hill 1998, p. 14).' : 'No sd was given, so every head has the same weight, and the error variance is estimated from the fit.'}`,
        'The search is the Levenberg-Marquardt method, as PEST uses it (Doherty 2025, section 7.4): the model is run with trial values, and the values move downhill on S(b) with derivatives taken by finite differences.',
      ], formula: 'S(b) = Σ wᵢ (yᵢ − y′ᵢ(b))²', numbers: [['Measured heads', String(observations.length)], ['Runs of the model', String(res.runs.runs)], ['Iterations', String(res.fit.iterations)]] },
      { title: 'Heads at the measured times', lines: [between
        ? `${between} of the heads fall between the ends of two time steps. Their model heads are interpolated linearly in time between the heads at the ends of those steps, as MODFLOW-2000's head observations are (Hill et al. 2000, p. 24); within a steady period the steady heads are used.`
        : 'Each measured head is compared with the model\'s head at the end of the time step at its time. A head between two step ends would be interpolated linearly in time between them, as MODFLOW-2000\'s head observations are (Hill et al. 2000, p. 24).'], numbers: [] },
      { title: 'How well the heads fix each value', lines: [
        'The dimensionless scaled sensitivity of head i to parameter j is (∂y′ᵢ/∂bⱼ) bⱼ wᵢ^½, and the composite scaled sensitivity of parameter j is the root mean square of those over the heads (Hill 1998, eq. 8 and 10). A value whose composite scaled sensitivity is below about 0.01 of the largest is poorly fixed by the heads (Hill 1998, p. 38).',
        'The calculated error variance is s² = S(b) / (ND − NP), with ND heads and NP fitted values (Hill 1998, eq. 14); it should be near 1 when the weights are 1/sd². The 95% intervals come from s² and the sensitivities, with the t distribution on ND − NP degrees of freedom, and the correlations from the same matrix (Hill 1998, eq. 26 and 30). Correlations near ±1 mean the heads cannot tell two values apart.',
        'The labels of the fit statistics are those MODFLOW-2000 prints (Hill et al. 2000).',
      ], numbers: [] },
    ],
    references: CAL_REFERENCES,
  };
}

// ---------------------------------------------------------------------------------------
// The panel.

/**
 * Mounts the panel in host. ctx: { model, result, state, run, onApply, signal }: the model
 * as the solver takes it and its run; state { stale, complete, fresh } from the page; run()
 * runs the page's model; onApply(fit) gives the page the fitted values, as { grid,
 * apply(model) }, and returns null or the reason they could not be applied; signal, aborted
 * when the page leaves the model, ends a calibration still running. Returns {
 * update(model, result, state) }, which the page calls after every edit and run.
 */
export async function mount(host, ctx) {
  const { chart, el, errorBox, fixed, method, panel, readFile, sig, table, together } = await import('../../kit.js');
  // job: the calibration running, if one is.
  let model = ctx.model, result = ctx.result, state = ctx.state || {}, job = null;
  const blank = () => ({ use: {}, hold: {}, start: {}, k33: {}, heads: '' });
  let typed = blank();
  const box = panel(el('h2', {}, 'Calibrate'));
  host.append(box);
  const banner = el('div', { class: 'model-stale', role: 'status', hidden: true });
  const body = el('div', { class: 'stack' });
  box.append(banner, body);
  let runBtn = null, out = null, status = null, stopBtn = null;

  function showState() {
    const fresh = Boolean(result) && !state.stale;
    host.toggleAttribute('data-stale', Boolean(state.stale));
    if (runBtn) runBtn.disabled = !fresh || Boolean(job);
    if (fresh) { banner.hidden = true; return; }
    const why = state.stale
      ? 'The model has changed since the last run. A calibration starts from a run of the model as it is now, so run it first.'
      : 'Run the model first: a calibration starts from its run.';
    banner.replaceChildren(el('p', {}, why),
      state.complete && ctx.run ? el('button', { class: 'btn', type: 'button', onclick: () => ctx.run() }, 'Run the model') : el('p', { class: 'hint' }, 'Give every value the model still needs, then press Run.'));
    banner.hidden = false;
  }

  function render() {
    body.textContent = '';
    if (job) { job.stop(); job = null; }
    runBtn = null;
    useControl = null;
    if (!model) { showState(); return; }
    const list = candidates(model);
    const rows = list.map((c) => {
      const use = el('input', { type: 'checkbox', 'aria-label': `Fit ${c.label}` });
      use.checked = Boolean(typed.use[c.key]);
      use.addEventListener('change', () => { typed.use[c.key] = use.checked; });
      const hold = el('input', { type: 'checkbox', 'aria-label': `Hold ${c.label}` });
      hold.checked = Boolean(typed.hold[c.key]);
      hold.addEventListener('change', () => { typed.hold[c.key] = hold.checked; });
      const start = el('input', { inputmode: 'decimal', value: typed.start[c.key] ?? String(c.start), size: 8, 'aria-label': `Starting value of ${c.label}` });
      start.addEventListener('input', () => { typed.start[c.key] = start.value; });
      // No choice is made for the user: K33 tied or held must be said for each K multiplier.
      // It sits under the parameter's name, so a narrow screen shows it without scrolling.
      const k33 = c.k33 ? el('select', { 'aria-label': `K33 for ${c.label}` }, el('option', { value: '' }, 'K33: choose'), el('option', { value: 'tied' }, 'K33 tied to K'), el('option', { value: 'held' }, 'K33 held')) : null;
      if (k33) { k33.value = typed.k33[c.key] || ''; k33.addEventListener('change', () => { typed.k33[c.key] = k33.value; k33.classList.remove('missing'); }); }
      // The start and the K33 choice sit under the parameter's name, so a phone shows every
      // control without a sideways scroll.
      const opts = el('div', { class: 'btn-row' }, el('label', { class: 'hint' }, 'Start ', start), k33);
      return { c, use, hold, start, k33, tr: el('tr', {}, el('td', {}, use), el('td', {}, hold), el('td', { class: 'text' }, el('div', {}, c.label), opts)) };
    });
    const paramTable = el('div', { class: 'tablewrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Fit', 'Hold', 'Parameter and start'].map((h, i) => {
        // The two tick columns as narrow as their headings; the parameter takes the rest.
        const th = el('th', { class: i === 2 ? 'text' : undefined }, h);
        if (i < 2) th.style.width = '1%';
        return th;
      }))),
      el('tbody', {}, rows.map((r) => r.tr))));

    const heads = el('textarea', { rows: 8, cols: 60, spellcheck: 'false', 'aria-label': 'Measured heads, CSV', placeholder: 'name,layer,row,column,time,head,sd\np1,1,5,8,10,11.23,0.01' });
    heads.value = typed.heads;
    heads.addEventListener('input', () => { typed.heads = heads.value; });
    // A button over a hidden file input, as the page's own "Open a model".
    const file = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xls', hidden: true, 'aria-label': 'Measured heads file' });
    const fileName = el('span', { class: 'hint' });
    const fileBtn = el('button', { class: 'btn quiet small', type: 'button', onclick: () => file.click() }, 'Read the heads from a file');
    status = el('p', { class: 'hint', role: 'status' });
    out = el('div', { class: 'stack' });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const { table: t } = await readFile(f);
        heads.value = typed.heads = [t.header, ...t.rows].map((r) => r.map((v) => (v === null ? '' : v)).join(',')).join('\n');
        fileName.textContent = together(`${f.name}: ${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'}.`);
      } catch (err) { fileName.textContent = ''; status.textContent = err.message; }
      file.value = '';
    });
    const fromObs = (model.obs || []).length
      ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => {
        const times = stepTimes(model);
        heads.value = typed.heads = ['name,layer,row,column,time,head', ...model.obs.map((o) => `${o.name},${o.lay + 1},${o.row + 1},${o.col + 1},${times.length === 1 ? '' : +times[times.length - 1].toPrecision(10)},`)].join('\n');
      } }, "Start from the model's observation points")
      : null;

    runBtn = el('button', { class: 'btn', type: 'button' }, 'Calibrate');
    // Stopping a calibration keeps nothing, so it is Cancel, as on the other tools.
    stopBtn = el('button', { class: 'btn quiet', type: 'button', hidden: true }, 'Cancel');
    // Focus that was on Calibrate or Cancel goes back to Calibrate when the work ends, rather
    // than falling to the top of the page with the button that is taken away.
    const focusBack = () => {
      const a = document.activeElement;
      return a === stopBtn || a === runBtn || !a || a === document.body;
    };
    const restoreFocus = (was) => { if (was && runBtn && !runBtn.disabled && runBtn.isConnected) runBtn.focus({ preventScroll: true }); };
    stopBtn.addEventListener('click', () => {
      const was = focusBack();
      if (job) { job.stop(); job = null; }
      stopBtn.hidden = true;
      status.textContent = 'Cancelled before the calibration finished: nothing was fitted.';
      showState();
      restoreFocus(was);
    });
    runBtn.addEventListener('click', () => {
      out.textContent = '';
      status.textContent = '';
      delete host.dataset.done;
      if (!result || state.stale) { showState(); return; }
      let specs, observations;
      const gaps = [];
      const chosen = rows.filter((r) => r.use.checked);
      if (!chosen.length) gaps.push('Tick at least one parameter to fit.');
      specs = chosen.map((r, i) => {
        const text = r.start.value.trim(), start = Number(text);
        if (!(text !== '' && start > 0)) gaps.push(`${r.c.label}: the starting value must be a number above zero.`);
        if (r.k33 && !r.k33.value) { gaps.push(`${r.c.label}: choose whether K33 is tied to K or held.`); r.k33.classList.add('missing'); }
        return { ...r.c.spec, id: `p${i + 1}`, key: r.c.key, label: r.c.label, start, fixed: r.hold.checked, ...(r.k33 ? { k33: r.k33.value } : {}) };
      });
      if (specs.length && specs.every((x) => x.fixed)) gaps.push('Every ticked parameter is held, so there is nothing to fit.');
      const text = heads.value.trim();
      if (!text) gaps.push('Give the measured heads.');
      else {
        try {
          const lines = text.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((x) => x.trim()));
          observations = readHeads({ header: lines[0], rows: lines.slice(1).filter((l) => l.some((x) => x !== '')) }, model);
        } catch (err) { gaps.push(err.message); }
      }
      if (gaps.length) { out.append(errorBox(together(gaps.join(' ')))); return; }
      const ran = { model, specs, observations };
      // No fallback: a worker that fails is an error on the panel. Leaving the page
      // (ctx.signal) ends the calibration.
      job = startJob(new URL('./calibrate-worker.js', import.meta.url), { model, specs, observations: forEngine(observations) }, {
        onProgress: (progress) => { status.textContent = `${progress.runs} runs of the model (${progress.stage})…`; },
        signal: ctx.signal, failed: 'The calibration stopped with an error.',
      });
      const fromHere = document.activeElement === runBtn;
      stopBtn.hidden = false;
      // Focus moves to Cancel before Calibrate is turned off, so it is not lost.
      if (fromHere) stopBtn.focus({ preventScroll: true });
      runBtn.disabled = true;
      status.textContent = 'Running the model…';
      const finish = () => { const was = focusBack(); job = null; stopBtn.hidden = true; showState(); restoreFocus(was); };
      job.promise.then((res) => {
        finish();
        const problems = fitProblems(res, specs, sig);
        status.textContent = together(problems.length
          ? `Finished after ${res.runs.runs} runs of the model and ${res.fit.iterations} iterations, but the fit is not usable. ${problems.join(' ')} Fit fewer values, or hold some, and calibrate again.`
          : `Done: ${res.runs.runs} runs of the model, ${res.fit.iterations} iterations.`);
        showResult(out, res, ran, problems);
        host.dataset.done = '1';
      }, (err) => { finish(); status.textContent = ''; out.append(errorBox(err.message)); });
    });

    body.append(
      el('p', { class: 'hint' }, 'Tick the parameters to fit, from the model as it stands: a multiplier of 1 is the model as it is. Hold keeps a value at its start but still reports its sensitivity. The method is written out below the results.'),
      paramTable,
      ...notOffered(model).map((t) => el('p', { class: 'hint' }, t)),
      el('h3', {}, 'Measured heads'),
      el('p', { class: 'hint' }, `One per line, with a heading row: name, layer, row and column (counted from 1, as in MODFLOW), time in days (blank for a model with one step), and head in metres. A time between the ends of two steps is interpolated linearly between them, as MODFLOW-2000 does (Hill et al. 2000). An sd column is optional: the standard deviation of each measurement in metres, which weights its head by 1/sd². Give sd for every head or for none; with none, every head counts the same.`),
      heads, el('div', { class: 'btn-row' }, file, fileBtn, fromObs, fileName),
      el('div', { class: 'btn-row' }, runBtn, stopBtn), status, out);
    showState();
  }

  function showResult(target, res, ran, problems) {
    const { specs, observations } = ran;
    const label = Object.fromEntries(specs.map((p) => [p.id, p.label]));
    const fit = res.fit, s = res.summary, sens = res.sensitivities;
    const cssMax = Math.max(...Object.values(sens.css));
    // What Use puts in the model: every fitted and held value applied together, so a layer
    // multiplier fitted with a whole-model one shows their product.
    const params = fittedParams(res, ran);
    let gives = {};
    try { gives = inTheModel(ran.model, params, sig, together); } catch { gives = {}; }
    const anyGives = Object.values(gives).some(Boolean);
    const risk = interpolationRisk(res.residuals, observations, res.result && res.result.heads, ran.model);
    const risky = risk.filter((x) => x !== null).length;
    // DOM append writes null as text, so the parts that may be absent are filtered out.
    target.append(...[
      ...res.warnings.map((w) => errorBox(together(tidyWarning(w, sig)))),
      problems.length ? errorBox(together(`This fit should not be used. ${problems.join(' ')}`)) : null,
      el('h3', {}, 'Fitted values'),
      table(['Parameter', 'Value', ...(anyGives ? ['In the model'] : []), '95% interval, lower', 'upper', 'Composite scaled sensitivity', 'css / largest'], specs.map((p) => {
        const r = fit.params[p.id], ratio = sens.css[p.id] / cssMax;
        // An interval not found is n/a at both ends, not a lower limit of 0 (exp(−∞)).
        const found = intervalFound(r);
        return [label[p.id], sig(r.value, 4), ...(anyGives ? [gives[p.id] || '—'] : []), r.fixed ? 'held' : found ? sig(r.lower, 4) : 'n/a', r.fixed ? '—' : found ? sig(r.upper, 4) : 'n/a', sig(sens.css[p.id], 3), `${sig(ratio, 2)}${ratio < 0.01 ? ' (below 0.01: poorly fixed)' : ''}`];
      })),
      anyGives ? el('p', { class: 'hint' }, 'In the model: the values that "Use the fitted values in the model" puts in, with every fitted and held value applied together, to 4 significant figures.') : null,
      sens.weak.length ? errorBox(`The heads cannot tell these apart from the others: ${sens.weak.map((id) => label[id]).join('; ')}. Fit fewer, or hold one.`) : null,
      el('p', { class: 'hint' }, 'A composite scaled sensitivity below about 0.01 of the largest means the heads hold little information on that value (Hill 1998).'),
      fit.free.length > 1 ? el('h3', {}, 'Correlation of the fitted values') : null,
      fit.free.length > 1 ? table(['', ...fit.free.map((id) => label[id])], fit.free.map((a, i) => [label[a], ...fit.corr[i].map((v) => sig(v, 3))])) : null,
      el('h3', {}, 'Fit'),
      table(['Statistic', 'Value'], [
        ['Measured heads', s.n],
        ['Sum of squared weighted residuals', sig(s.swsr, 4)],
        ['Calculated error variance', sig(s.errorVariance, 4)],
        ['Standard error of the regression', sig(s.standardError, 4)],
        ['Largest weighted residual', `${sig(s.maxWeighted.value, 3)} (${s.maxWeighted.name})`],
        ['Smallest weighted residual', `${sig(s.minWeighted.value, 3)} (${s.minWeighted.name})`],
        ['Mean weighted residual', sig(s.meanWeighted, 3)],
        ['Residuals ≥ 0 and < 0', `${s.positive} and ${s.negative}`],
        ['Runs of one sign', s.runsTest.valid ? `${s.runs} (expected ${sig(s.runsTest.mean, 3)})` : `${s.runs}`],
        ['R, weighted measured against computed', sig(s.R, 4)],
        ['R²N, normal probability', sig(s.RN2, 4)],
      ]),
      chart({
        title: 'Measured against computed heads',
        xLabel: 'Measured head (m)', yLabel: 'Computed head (m)',
        series: [
          { label: 'Heads', x: res.residuals.map((r) => r.observed), y: res.residuals.map((r) => r.simulated), line: false },
          (() => { const v = res.residuals.flatMap((r) => [r.observed, r.simulated]); const lo = Math.min(...v), hi = Math.max(...v); return { label: 'Equal', x: [lo, hi], y: [lo, hi] }; })(),
        ],
      }),
      el('h3', {}, 'Residuals'),
      res.residuals.some((r) => r.interpolated) ? el('p', { class: 'hint' }, 'Times marked * fall between the ends of two steps: their computed heads are interpolated linearly in time between those steps, as MODFLOW-2000 does (Hill et al. 2000, p. 24).') : null,
      risky ? errorBox(together(`${risky === 1 ? 'One interpolated head falls' : `${risky} interpolated heads fall`} in a step over which the computed head at the cell changes by more than the residual (marked † below), so linear interpolation across the step could make much of the residual, and pull the fit with it. This is most likely in the first step after a change in pumping, where the head falls almost at once. Shorter steps there (more steps, or a step multiplier above 1) would show whether the residual is real.`)) : null,
      table(['Name', 'Layer', 'Row', 'Column', 'Time (d)', 'Measured (m)', 'Computed (m)', 'Residual (m)', 'Weighted', ...(risky ? ['Head change across the step (m)'] : [])], res.residuals.map((r, i) => [
        r.name, r.lay + 1, r.row + 1, r.col + 1, `${sig(r.time ?? (observations[i] && observations[i].time), 6)}${r.interpolated ? ' *' : ''}${risk[i] !== null ? ' †' : ''}`, fixed(r.observed, 4), fixed(r.simulated, 4), fixed(Math.abs(r.residual) < 5e-5 ? 0 : r.residual, 4), sig(r.weighted, 3),
        ...(risky ? [risk[i] !== null ? fixed(risk[i], 4) : ''] : [])])),
      ctx.onApply && !problems.length ? useButton(res, ran, params) : null,
      el('h3', {}, 'Exactly what was done'),
      method(calibrationMethod(specs, observations, res, sig)),
    ].filter(Boolean));
  }

  // Every parameter of the calibration with its value: fitted ones at the fitted value and
  // held ones at the value they were held at, as the calibrated run had them.
  function fittedParams(res, ran) {
    return ran.specs.map((p) => {
      const r = res.fit.params[p.id];
      return { spec: { type: p.type, ...p }, value: p.fixed || !r ? p.start : r.value, label: p.label };
    });
  }

  // The fitted values go into the page's model only while the values they act on are as
  // they were in the calibrated run: a multiplier found for K = 30 must not multiply 60.
  let useControl = null;
  function useButton(res, ran, params) {
    const note = el('p', { class: 'hint', role: 'status' });
    const check = (now) => {
      const names = fitChanges(ran.model, now, params);
      return names.length ? together(`${changesText(names)}, so the fitted values, which were found for the values before, are not put in. Run the model and calibrate again.`) : null;
    };
    let applied = false;
    const btn = el('button', { class: 'btn', type: 'button', onclick: () => {
      const g = ran.model.grid;
      const why = ctx.onApply({ grid: { nlay: g.nlay, nrow: g.nrow, ncol: g.ncol }, check, apply: (m) => applyFitted(m, params, sig) });
      note.textContent = why ? why : 'The fitted values are in the model now. Press Run to see its heads.';
      if (!why) { applied = true; btn.disabled = true; }
    } }, 'Use the fitted values in the model');
    // After an edit: the button goes off, saying why, if the edit touched what was fitted.
    useControl = {
      refresh(now, stale) {
        if (applied) return;
        if (!stale) { btn.disabled = false; note.textContent = ''; return; }
        const why = now ? check(now) : 'The model is not complete, so the fitted values cannot be put in it.';
        btn.disabled = Boolean(why);
        note.textContent = why || 'The model has changed since this calibration, but not in the values it fitted, so they can still be put in. They were fitted with the model as it was run.';
      },
    };
    return el('div', { class: 'stack' }, el('div', { class: 'btn-row' }, btn), note,
      el('p', { class: 'hint' }, `Puts the values of the "In the model" column in the page's model, to ${FIGURES} significant figures: each fitted multiplier multiplies the values it was fitted for, and each fitted Ss, S or Sy replaces the value in its zone. Edits made since the run to other parts of the model are kept. If an edit changed a value that was fitted, the values are not put in, and the calibration must be run again.`));
  }

  render();
  return {
    update(nextModel, nextResult, nextState = {}) {
      state = nextState;
      if (state.fresh) typed = blank();
      const fresh = nextResult && !state.stale;
      if (fresh && (nextResult !== result || state.fresh)) { model = nextModel; result = nextResult; render(); return; }
      if (state.fresh) { model = nextModel; result = null; render(); return; }
      if (out && state.stale) out.classList.add('model-old');
      if (!result && nextModel) { model = nextModel; render(); return; }
      if (useControl) useControl.refresh(nextModel, Boolean(state.stale));
      showState();
    },
  };
}
