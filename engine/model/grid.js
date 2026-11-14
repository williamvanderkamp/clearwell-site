// The model grid, as MODFLOW 6 DIS and NPF build it: cell geometry, the saturated
// conductance of every connection, and the per-layer inputs expanded to one value per
// cell. Cells are numbered n = k*nrow*ncol + i*ncol + j, the order MODFLOW 6 uses.
//
// Connections on a regular grid are kept in three flat arrays indexed by the lower
// node of the pair: east (n, n+1), south (n, n+ncol) and down (n, down[n]: n+nrow*ncol, or
// the cell below past IDOMAIN -1 cells). An entry is zero where there is no connection (the
// last column, the last row, the bottom layer, or an inactive cell on either side).

import { quadSat } from './newton.js';

// Messages count layers, rows, columns, periods and steps from 1, as MODFLOW 6 and the page
// do, though the JSON counts from 0.

/** A cell as the messages name it, from 0-based indices: "layer 1, row 1, column 1". */
export const cellName = (lay, row, col) => `layer ${lay + 1}, row ${row + 1}, column ${col + 1}`;

/** The cell name of node n (n = k*nrow*ncol + i*ncol + j). */
export const nodeName = (n, nrow, ncol) => cellName(Math.floor(n / (nrow * ncol)), Math.floor((n % (nrow * ncol)) / ncol), n % ncol);

/** A period and step as the messages name them, from 0-based indices. */
export const stepName = (p, s) => `period ${p + 1}, step ${s + 1}`;

/** One value per cell from a per-layer input: each layer a number, or nrow*ncol values. */
export function perLayer(arr, nlay, ncpl, label, ncol) {
  if (!Array.isArray(arr) || arr.length !== nlay) throw new Error(`${label} needs one entry per layer (${nlay}).`);
  const out = new Float64Array(nlay * ncpl);
  for (let k = 0; k < nlay; k++) fillLayer(out, k * ncpl, arr[k], ncpl, `${label}, layer ${k + 1}`, ncol);
  return out;
}

function fillLayer(out, offset, v, ncpl, label, ncol) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`${label} is not a number.`);
    out.fill(v, offset, offset + ncpl);
    return;
  }
  if (!v || v.length !== ncpl) throw new Error(`${label} needs a number or ${ncpl} values.`);
  for (let c = 0; c < ncpl; c++) {
    const x = v[c];
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      const where = ncol ? `row ${Math.floor(c / ncol) + 1}, column ${(c % ncol) + 1}` : `value ${c + 1}`;
      throw new Error(`${label} has a value that is not a number at ${where}.`);
    }
    out[offset + c] = x;
  }
}

/** A value per cell of one layer: a number, or nrow*ncol values (ncol names the cell in messages). */
export function oneLayer(v, ncpl, label, ncol) {
  const out = new Float64Array(ncpl);
  fillLayer(out, 0, v, ncpl, label, ncol);
  return out;
}

// Harmonic-mean conductance between two half cells (TM 6-A55 eq. 4-25, MODFLOW 6
// condmean with CCOND_HMEAN): zero when either transmissivity is zero.
export function harmonic(k1, k2, thick1, thick2, cl1, cl2, width) {
  const t1 = k1 * thick1, t2 = k2 * thick2;
  return t1 * t2 > 0 ? width * t1 * t2 / (t1 * cl2 + t2 * cl1) : 0;
}

/**
 * DIS highest_active (DiscretizationBase.f90): from cell n, down the vertical connections to
 * the first cell whose ibound is not 0 (a constant-head cell counts), or the lowest cell of
 * the column when every one is 0. below[n] is the cell n connects to downward, or -1.
 */
export function highestActive(n, ibound, below) {
  while (ibound[n] === 0 && below[n] >= 0) n = below[n];
  return n;
}

/** Build the grid from model.grid and model.npf. */
export function buildGrid(model) {
  const g = model.grid, npf = model.npf;
  if (!g) throw new Error('The model has no grid.');
  if (!npf) throw new Error('The model has no npf block (hydraulic conductivity).');
  const { nlay, nrow, ncol } = g;
  for (const [name, v] of [['nlay', nlay], ['nrow', nrow], ['ncol', ncol]]) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`grid.${name} must be a whole number of at least 1.`);
  }
  const ncpl = nrow * ncol, N = nlay * ncpl;
  const delr = Float64Array.from(g.delr || []), delc = Float64Array.from(g.delc || []);
  if (delr.length !== ncol) throw new Error(`grid.delr needs ${ncol} widths.`);
  if (delc.length !== nrow) throw new Error(`grid.delc needs ${nrow} widths.`);
  for (const w of [...delr, ...delc]) if (!(w > 0)) throw new Error('Every cell width in delr and delc must be above zero.');

  // Top and bottom of every cell. A layer's top is the bottom of the layer above (DIS).
  const top = new Float64Array(N), bot = perLayer(g.botm, nlay, ncpl, 'grid.botm', ncol);
  const top0 = oneLayer(g.top, ncpl, 'grid.top', ncol);
  top.set(top0, 0);
  for (let k = 1; k < nlay; k++) top.set(bot.subarray((k - 1) * ncpl, k * ncpl), k * ncpl);
  const area = new Float64Array(N);
  for (let i = 0; i < nrow; i++) for (let j = 0; j < ncol; j++) area[i * ncol + j] = delr[j] * delc[i];
  for (let k = 1; k < nlay; k++) area.copyWithin(k * ncpl, 0, ncpl);

  // idomain (gwf-dis.dfn): 1 or more, the cell exists; 0, it does not; -1, it does not, and the
  // first existing cell above connects to the first existing cell below (a vertical pass-through
  // cell, Connections.f90 disconnections: a cell whose reduced node is -1 is skipped downward).
  const domain = new Uint8Array(N), through = new Uint8Array(N);
  if (g.idomain == null) domain.fill(1);
  else {
    if (g.idomain.length !== N) throw new Error(`grid.idomain needs ${N} values (nlay*nrow*ncol), or null.`);
    for (let n = 0; n < N; n++) {
      const v = g.idomain[n];
      if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`grid.idomain holds whole numbers; ${nodeName(n, nrow, ncol)} is ${v}.`);
      if (v > 0) domain[n] = 1;
      else if (v < 0) through[n] = 1;
    }
  }
  if (!domain.some((v) => v)) throw new Error('The model has no active cells (idomain 1): MODFLOW 6 stops with "Model does not have any active nodes".');
  for (let n = 0; n < N; n++) {
    if (domain[n] && !(top[n] > bot[n])) {
      throw new Error(`The cell at ${nodeName(n, nrow, ncol)} has its bottom (${bot[n]} m) at or above its top (${top[n]} m).`);
    }
  }

  // ICELLTYPE: 0 confined, above 0 convertible; below 0 convertible too, unless THICKSTRT is
  // on, when the cell is confined with the saturated thickness of its starting head (NPF
  // preprocess_input, gwf-npf.dfn ICELLTYPE).
  for (const key of ['thickstrt', 'variablecv', 'dewatered', 'perched']) {
    if (npf[key] !== undefined && typeof npf[key] !== 'boolean') throw new Error(`npf.${key} must be true or false.`);
  }
  if (npf.dewatered && !npf.variablecv) throw new Error('npf.dewatered is an option of VARIABLECV, so it needs npf.variablecv, as MODFLOW 6 reads them (VARIABLECV DEWATERED).');
  const icelltype = new Uint8Array(N), thick = new Uint8Array(N);
  if (!Array.isArray(npf.icelltype) || npf.icelltype.length !== nlay) throw new Error(`npf.icelltype needs one entry per layer (${nlay}).`);
  for (let k = 0; k < nlay; k++) {
    const v = npf.icelltype[k];
    if (typeof v !== 'number' && (!v || v.length !== ncpl)) throw new Error(`npf.icelltype, layer ${k + 1}, needs 0 or 1, or ${ncpl} values.`);
    for (let c = 0; c < ncpl; c++) {
      const t = typeof v === 'number' ? v : v[c], n = k * ncpl + c;
      if (!Number.isInteger(t)) throw new Error(`npf.icelltype, layer ${k + 1}${typeof v === 'number' ? '' : `, value ${c + 1}`}, is ${t}: MODFLOW 6 reads ICELLTYPE as a whole number (0 confined, 1 convertible, below 0 with THICKSTRT), so it is refused rather than rounded.`);
      if (t < 0 && npf.thickstrt) thick[n] = 1;
      else icelltype[n] = t !== 0 ? 1 : 0;
    }
  }
  const kh = perLayer(npf.k, nlay, ncpl, 'npf.k', ncol);
  // MODFLOW 6 NPF: "K33 not provided. Setting K33 = K." and, for K22, "If K22 is not included
  // in the GRIDDATA block, then K22 is set equal to K" (gwf-npf.dfn).
  const kv = npf.k33 == null ? Float64Array.from(kh) : perLayer(npf.k33, nlay, ncpl, 'npf.k33', ncol);
  const k22 = npf.k22 == null ? kh : perLayer(npf.k22, nlay, ncpl, 'npf.k22', ncol);
  for (let n = 0; n < N; n++) {
    if (domain[n] && !(kh[n] > 0 && kv[n] > 0 && k22[n] > 0)) {
      throw new Error(`Every active cell needs K${npf.k22 == null ? '' : ', K22'} and K33 above zero; at ${nodeName(n, nrow, ncol)}, K is ${kh[n]} m/d${npf.k22 == null ? '' : `, K22 is ${k22[n]} m/d`} and K33 is ${kv[n]} m/d.`);
    }
  }
  // The saturated fraction each cell's conductances start from: 1, or with THICKSTRT the
  // fraction of the starting head, (strt - bot) / (top - bot), at most 1 (preprocess_input
  // and calc_initial_sat, through thksat). Under Newton-Raphson thksat is the smoothed
  // saturation (sQuadraticSaturation, ω = 10⁻⁶), about (1 + 10⁻⁶) times that less 5 × 10⁻⁷.
  const sat0 = new Float64Array(N).fill(1);
  const nwt = model.newton !== undefined && model.newton !== null && model.newton !== false;
  if (thick.some((t) => t)) {
    if (!model.ic || !Array.isArray(model.ic.strt) || model.ic.strt.length !== nlay) throw new Error(`ic.strt needs one entry per layer (${nlay}).`);
    const strt = perLayer(model.ic.strt, nlay, ncpl, 'ic.strt', ncol);
    for (let n = 0; n < N; n++) {
      if (!domain[n] || !thick[n]) continue;
      if (bot[n] > strt[n]) throw new Error(`The cell at ${nodeName(n, nrow, ncol)} takes its thickness from its starting head (THICKSTRT), which is below its bottom (${strt[n]} m against ${bot[n]} m): MODFLOW 6 stops with "Negative cell thickness".`);
      sat0[n] = nwt ? quadSat(top[n], bot[n], strt[n]) : strt[n] >= top[n] ? 1 : (strt[n] - bot[n]) / (top[n] - bot[n]);
    }
  }

  // Saturated conductances (NPF calc_condsat), with each cell's thickness sat0 × (top - bot).
  // Between rows (along a column, the y direction) K22 acts, along a row K (hy_eff with no
  // rotation, the connection normal being a y or an x unit vector).
  const csE = new Float64Array(N), csS = new Float64Array(N), csD = new Float64Array(N);
  const down = new Int32Array(N).fill(-1);
  for (let k = 0; k < nlay; k++) {
    for (let i = 0; i < nrow; i++) {
      for (let j = 0; j < ncol; j++) {
        const n = k * ncpl + i * ncol + j;
        if (!domain[n]) continue;
        const tn = sat0[n] * (top[n] - bot[n]);
        if (j < ncol - 1 && domain[n + 1]) {
          csE[n] = harmonic(kh[n], kh[n + 1], tn, sat0[n + 1] * (top[n + 1] - bot[n + 1]), delr[j] / 2, delr[j + 1] / 2, delc[i]);
        }
        if (i < nrow - 1 && domain[n + ncol]) {
          const m = n + ncol;
          csS[n] = harmonic(k22[n], k22[m], tn, sat0[m] * (top[m] - bot[m]), delc[i] / 2, delc[i + 1] / 2, delr[j]);
        }
        // Vertical: TM 6-A55 eq. 4-42, half of each cell's full thickness over its K33,
        // the MODFLOW 6 default (no VARIABLECV), with the first existing cell below, past
        // pass-through cells; an idomain-0 cell between two layers breaks the connection, as in
        // DIS. Through pass-through cells, see `down` below.
        if (k < nlay - 1) {
          let m = n + ncpl;
          while (m < N && through[m]) m += ncpl;
          if (m < N && domain[m]) {
            down[n] = m;
            csD[n] = vcondSat(n, m);
          }
        }
      }
    }
  }
  // calc_condsat's vertical conductance: vcond with VARIABLECV and DEWATERED on and both heads
  // at the cell bottoms, so the upper cell's half takes its saturated fraction, and the lower
  // cell's counts only when it is full (with THICKSTRT, a lower cell started part full adds no
  // resistance). With every fraction 1 this is the plain eq. 4-42.
  function vcondSat(n, m) {
    const bn = sat0[n] * (top[n] - bot[n]) * 0.5 / kv[n], bm = (sat0[m] < 1 ? 0 : sat0[m]) * (top[m] - bot[m]) * 0.5 / kv[m];
    return bn + bm !== 0 ? area[n] / (bn + bm) : 0;
  }
  // A connection through pass-through cells joins n directly with the cell m = down[n] below
  // them, as MODFLOW 6's DIS does: csD[n] is that connection's C, and the solver's matrix holds
  // it between n and m (ims.js createLinear), with no node for the cells between, which are
  // MODFLOW 6's no nodes too. pass[p] marks such a cell, up[p] the cell n above its chain,
  // links[n] the number of layers the connection spans; above[m] is the cell connected to m
  // from above (above[down[n]] = n).
  const pass = new Uint8Array(N), up = new Int32Array(N).fill(-1), links = new Uint8Array(N).fill(1), above = new Int32Array(N).fill(-1);
  for (let n = 0; n < N; n++) {
    if (down[n] < 0) continue;
    above[down[n]] = n;
    if (down[n] === n + ncpl) continue;
    links[n] = (down[n] - n) / ncpl;
    for (let p = n + ncpl; p < down[n]; p += ncpl) { pass[p] = 1; up[p] = n; icelltype[p] = 0; }
  }
  // The cell each cell connects to downward, as DIS highest_active walks it.
  const below = down;
  return { nlay, nrow, ncol, ncpl, N, delr, delc, top, bot, area, domain, through, icelltype, kh, kv, k22, sat0, csE, csS, csD, below, down, above, pass, up, links };
}
