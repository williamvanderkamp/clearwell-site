// Evapotranspiration, as MODFLOW 6's EVT package: list input (EVT6, the model's evtList) and
// array input (READASARRAYS, the model's evt). See docs/tools/model.md.
//
// The formulation is evt_cf in gwf-evt.f90 (MODFLOW 6 6.7.0), with SURF_RATE_SPECIFIED off
// and no auxiliary multiplier; TM 6-A55 (Langevin and others 2017) describes the package in
// chapter 6. With c = rate × cell area, s the ET surface, x the extinction depth and h the head:
//   h ≥ s:            ET = c, a constant (rhs only);
//   s − x < h < s:    one segment (NSEG 1), ET = c (1 − (s − h)/x), linear in h;
//                     more segments, ET falls from petm₁ c to petm₂ c across each segment
//                     between depths pxdp₁ x and pxdp₂ x, the last ending at (x, 0);
//   h ≤ s − x:        no ET.
// MODFLOW 6's rate into the aquifer is hcof h − rhs, so ET is negative.
//
// The cell: as recharge, ET goes to the cell given (list) or to the cell of layer IEVT in each
// column (arrays, layer 1 when IEVT is not given), and, when that cell is dry and FIXED_CELL is
// not set, to the highest active cell below it (DIS highest_active, with the nodelist kept as
// moved, as evt_cf does). It is not applied to a constant-head or inactive cell, and an array
// column whose cell has idomain 0 has no node, so nothing is applied there.

import { cellName, highestActive, oneLayer } from './grid.js';
import { checkPeriodKeys, layerNodes, packageOptions } from './topcell.js';

const ARRAYS = ['surface', 'rate', 'depth'];

/**
 * The EVT package of a model, or null when it has none: { size, setPeriod(p), formulate(ibound, x, t) }.
 * readList(g, list, width, label) reads a stress list as run.js does: { node, vals }, refusing
 * a cell outside the grid or not active.
 */
export function evtPackage(model, g, readList) {
  for (const k of ['evt', 'evtList']) checkPeriodKeys(model[k], k);
  const hasList = model.evtList != null, hasArrays = model.evt != null;
  if (!hasList && !hasArrays) return null;
  if (hasList && hasArrays) throw new Error('Evapotranspiration is given both as arrays (evt) and as a list (evtList): give one of them, as one EVT package.');
  const opts = packageOptions(model, hasList ? 'evtList' : 'evt');
  const fixed = opts.fixedCell === true;
  return hasList ? listForm(model, g, readList, fixed) : arrayForm(model, g, fixed);
}

/** NSEG of an evtList: from the entries' length, 6 + 2 (NSEG − 1), the same for every entry. */
export function evtSegments(evtList) {
  let nseg = null;
  for (const [p, list] of Object.entries(evtList || {})) {
    if (!Array.isArray(list)) throw new Error(`evtList, period ${Number(p) + 1}, must be a list of entries.`);
    list.forEach((e, r) => {
      const len = Array.isArray(e) ? e.length : 0;
      if (len < 6 || len % 2 !== 0) throw new Error(`evtList, period ${Number(p) + 1}, entry ${r + 1}, needs layer, row, column, surface, rate and depth, then NSEG − 1 values of pxdp and as many of petm.`);
      const n = (len - 6) / 2 + 1;
      if (nseg === null) nseg = n;
      else if (n !== nseg) throw new Error(`evtList, period ${Number(p) + 1}, entry ${r + 1}, has ${n} segment${n === 1 ? '' : 's'} where the entries before have ${nseg}: MODFLOW 6 takes one NSEG for the package.`);
    });
  }
  return nseg ?? 1;
}

function listForm(model, g, readList, fixed) {
  const nseg = evtSegments(model.evtList);
  const width = 3 + 2 * (nseg - 1);
  let size = 0, node = new Int32Array(0), top = node, vals = [];
  return {
    get size() { return size; },
    nseg,
    setPeriod(p) {
      if (model.evtList[p] === undefined) return;
      const l = readList(g, model.evtList[p], width, `evtList, period ${p + 1}`);
      // check_pxdp: each pxdp above 0 and below 1, increasing down the segments.
      for (let e = 0; e < l.node.length; e++) {
        let prev = 0;
        for (let i = 0; i < nseg - 1; i++) {
          const v = l.vals[3 + i][e];
          const at = cellName(...model.evtList[p][e].slice(0, 3));
          if (!(v > 0 && v < 1)) throw new Error(`evtList, period ${p + 1}: pxdp ${i + 1} at ${at} is ${v}; MODFLOW 6 takes each pxdp above 0 and below 1.`);
          if (v < prev) throw new Error(`evtList, period ${p + 1}: the pxdp values at ${at} do not increase down the segments, as MODFLOW 6 requires.`);
          prev = v;
        }
      }
      size = l.node.length; node = l.node; top = Int32Array.from(node); vals = l.vals;
    },
    formulate(ibound, x, t) {
      for (let e = 0; e < size; e++) {
        let n = fixed ? node[e] : top[e];
        if (!fixed) { if (ibound[n] === 0) n = highestActive(n, ibound, g.below); node[e] = n; }
        t.node[e] = n;
        etTerms(t, e, ibound[n] > 0, vals[1][e] * g.area[n], vals[0][e], vals[2][e], x[n], nseg, vals, 3);
      }
    },
  };
}

function arrayForm(model, g, fixed) {
  const { ncpl, ncol } = g;
  const cur = { surface: null, rate: null, depth: null };
  const node = new Int32Array(ncpl), top = new Int32Array(ncpl);
  // Layer 1 until IEVT is given (default_nodelist): no node where its idomain is 0.
  for (let c = 0; c < ncpl; c++) node[c] = g.domain[c] ? c : -1;
  let size = 0;
  return {
    get size() { return size; },
    nseg: 1,
    setPeriod(p) {
      const v = model.evt[p];
      if (v === undefined) return;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`evt, period ${p + 1}, must hold surface, rate, depth or ievt.`);
      for (const k of Object.keys(v)) if (![...ARRAYS, 'ievt'].includes(k)) throw new Error(`evt, period ${p + 1}: ${k} is not one of surface, rate, depth and ievt.`);
      for (const k of ARRAYS) if (v[k] !== undefined) cur[k] = oneLayer(v[k], ncpl, `evt, period ${p + 1}, ${k}`, ncol);
      const missing = ARRAYS.filter((k) => !cur[k]);
      if (missing.length) throw new Error(`evt, period ${p + 1}, needs ${missing.join(', ')}: an array not given stands from an earlier period, and none has given ${missing.length === 1 ? 'it' : 'them'}.`);
      if (v.ievt !== undefined) layerNodes(v.ievt, g, node, `evt, period ${p + 1}, ievt`);
      top.set(node);
      size = ncpl;
    },
    formulate(ibound, x, t) {
      for (let c = 0; c < ncpl; c++) {
        let n = fixed ? node[c] : top[c];
        if (n < 0) { t.node[c] = -1; t.hcof[c] = 0; t.rhs[c] = 0; continue; }
        if (!fixed) { if (ibound[n] === 0) n = highestActive(n, ibound, g.below); node[c] = n; }
        t.node[c] = n;
        etTerms(t, c, ibound[n] > 0, cur.rate[c] * g.area[n], cur.surface[c], cur.depth[c], x[n], 1, null, 0);
      }
    },
  };
}

// evt_cf for one entry: hcof and rhs (MODFLOW 6's sign, rate = hcof h − rhs).
function etTerms(t, e, on, c, s, depth, h, nseg, vals, at) {
  let hcof = 0, rhs = 0;
  if (on) {
    if (h >= s) rhs = c;
    else {
      const d = s - h;
      if (d < depth) {
        if (nseg > 1) {
          let pxdp1 = 0, petm1 = 1, pxdp2 = 1, petm2 = 0;
          for (let i = 0; i < nseg; i++) {
            if (i < nseg - 1) { pxdp2 = vals[at + i][e]; petm2 = vals[at + nseg - 1 + i][e]; } else { pxdp2 = 1; petm2 = 0; }
            if (d <= pxdp2 * depth) break;
            pxdp1 = pxdp2; petm1 = petm2;
          }
          const th = -(petm1 - petm2) * c / ((pxdp2 - pxdp1) * depth);
          rhs = th * (s - pxdp1 * depth) + petm1 * c;
          hcof = th;
        } else {
          rhs = c - c * s / depth;
          hcof = -c / depth;
        }
      }
    }
  }
  t.hcof[e] = hcof; t.rhs[e] = rhs;
}
