// Recharge, as MODFLOW 6's RCH package: array input (READASARRAYS, the model's rch, with the
// layer of each column in irch) and list input (RCH6 without READASARRAYS, the model's
// rchList). See docs/tools/model.md.
//
// rch_cf in gwf-rch.f90 (MODFLOW 6 6.7.0), with no auxiliary multiplier: rhs = −rate × area
// of the cell it goes to, hcof = 0. The cell is the one listed, or for arrays the cell of layer
// IRCH in each column (layer 1 when IRCH is not given, default_nodelist). Without FIXED_CELL,
// recharge on a dry cell goes to the highest active cell below it (DIS highest_active), and
// the moved cell is kept, as rch_cf keeps it in its nodelist. It is not applied on a
// constant-head cell, on a column dry to its bottom, nor where the cell has idomain 0 (it has
// no node, so nlarray_to_nodelist gives 0).

import { highestActive, oneLayer } from './grid.js';
import { checkPeriodKeys, layerNodes, packageOptions } from './topcell.js';

/**
 * The RCH package of a model, or null: { size, setPeriod(p), formulate(ibound, x, t), lost(ibound, dry) }.
 * readList(g, list, width, label) reads a stress list as run.js does.
 */
export function rchPackage(model, g, readList) {
  for (const k of ['rch', 'irch', 'rchList']) checkPeriodKeys(model[k], k);
  const hasList = model.rchList != null, hasArrays = model.rch != null;
  if (!hasList && !hasArrays) {
    if (model.irch != null) throw new Error('irch gives the layer of recharge, but the model has no recharge arrays (rch).');
    return null;
  }
  if (hasList && hasArrays) throw new Error('Recharge is given both as arrays (rch) and as a list (rchList): give one of them, as one RCH package.');
  if (hasList && model.irch != null) throw new Error('irch is for recharge arrays (rch); a recharge list (rchList) gives each cell itself.');
  const fixed = packageOptions(model, hasList ? 'rchList' : 'rch').fixedCell === true;
  return hasList ? listForm(model, g, readList, fixed) : arrayForm(model, g, fixed);
}

function listForm(model, g, readList, fixed) {
  let size = 0, node = new Int32Array(0), top = node, rate = new Float64Array(0);
  return {
    get size() { return size; },
    setPeriod(p) {
      if (model.rchList[p] === undefined) return;
      const l = readList(g, model.rchList[p], 1, `rchList, period ${p + 1}`);
      size = l.node.length; node = l.node; top = Int32Array.from(node); rate = l.vals[0];
    },
    formulate(ibound, x, t) {
      for (let e = 0; e < size; e++) {
        let n = fixed ? node[e] : top[e];
        if (!fixed) { if (ibound[n] === 0) n = highestActive(n, ibound, g.below); node[e] = n; }
        t.node[e] = n; t.hcof[e] = 0;
        t.rhs[e] = ibound[n] > 0 ? -rate[e] * g.area[n] : 0;
      }
    },
    lost(ibound, dry) { return { ...lostOn(size, (e) => node[e], (e) => rate[e], ibound, dry, g), fixed }; },
  };
}

function arrayForm(model, g, fixed) {
  const { ncpl, ncol } = g;
  const node = new Int32Array(ncpl), top = new Int32Array(ncpl);
  // Layer 1 until IRCH is given (default_nodelist): no node where its idomain is 0.
  for (let c = 0; c < ncpl; c++) node[c] = g.domain[c] ? c : -1;
  let rate = null, size = 0;
  return {
    get size() { return size; },
    setPeriod(p) {
      const r = model.rch[p], k = model.irch ? model.irch[p] : undefined;
      if (r === undefined && k === undefined) return;
      if (r !== undefined) rate = oneLayer(r, ncpl, `rch, period ${p + 1}`, ncol);
      if (!rate) throw new Error(`irch, period ${p + 1}: the layer of recharge is given, but no recharge (rch) has been given by this period.`);
      if (k !== undefined) layerNodes(k, g, node, `irch, period ${p + 1}`);
      top.set(node);
      size = ncpl;
    },
    formulate(ibound, x, t) {
      for (let c = 0; c < ncpl; c++) {
        let n = fixed ? node[c] : top[c];
        t.hcof[c] = 0; t.rhs[c] = 0;
        if (n < 0) { t.node[c] = -1; continue; }
        if (!fixed) { if (ibound[n] === 0) n = highestActive(n, ibound, g.below); node[c] = n; }
        t.node[c] = n;
        if (ibound[n] > 0) t.rhs[c] = -rate[c] * g.area[n];
      }
    },
    lost(ibound, dry) { return { ...lostOn(size, (c) => node[c], (c) => rate[c], ibound, dry, g), fixed }; },
  };
}

// Recharge given that went nowhere because its cell, and with FIXED_CELL off every cell below
// it, is dry: the count and the rate (m³/d), for the run's notice. (Recharge on a cell with
// no node, idomain 0, is lost too, but from the start and by the grid, so it is not counted.)
function lostOn(size, nodeOf, rateOf, ibound, dry, g) {
  let cells = 0, rate = 0;
  for (let e = 0; e < size; e++) {
    const n = nodeOf(e);
    if (n < 0 || ibound[n] !== 0 || !dry[n] || rateOf(e) === 0) continue;
    cells++;
    rate += rateOf(e) * g.area[n];
  }
  return { cells, rate };
}
