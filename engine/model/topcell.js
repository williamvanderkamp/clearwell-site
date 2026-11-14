// What the recharge and evapotranspiration packages share (rch.js, evt.js): the options of a
// stress package, and the cells of a layer chosen column by column (IRCH, IEVT).

/** Checks that a package's keys are period numbers, as run.js's inForce does for the lists. */
export function checkPeriodKeys(pkg, label) {
  if (pkg == null) return;
  if (typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error(`${label} must map period numbers to what each period gives.`);
  for (const key of Object.keys(pkg)) {
    const kp = Number(key);
    if (!Number.isInteger(kp) || kp < 0) throw new Error(`A stress package period key "${key}" is not a period number.`);
  }
}

/** The options of a stress package (model.options[key]), checked: only fixedCell is known. */
export function packageOptions(model, key) {
  const all = model.options;
  if (all == null) return {};
  if (typeof all !== 'object' || Array.isArray(all)) throw new Error('options must map package names (rch, rchList, evt, evtList) to their options.');
  for (const k of Object.keys(all)) if (!['rch', 'rchList', 'evt', 'evtList'].includes(k)) throw new Error(`options.${k}: only rch, rchList, evt and evtList take options here.`);
  const o = all[key];
  if (o == null) return {};
  if (typeof o !== 'object' || Array.isArray(o)) throw new Error(`options.${key} must be an object, such as { fixedCell: true }.`);
  for (const k of Object.keys(o)) if (k !== 'fixedCell') throw new Error(`options.${key}.${k} is not an option; the one option is fixedCell (MODFLOW 6 FIXED_CELL).`);
  if (o.fixedCell !== undefined && typeof o.fixedCell !== 'boolean') throw new Error(`options.${key}.fixedCell must be true or false.`);
  return o;
}

/**
 * The node of the cell of the given layer (from 0) in each column, into out (ncpl values): v
 * is one layer for every column or ncpl layers. A cell with idomain 0 (or −1) has no node, so
 * it gets −1, as nlarray_to_nodelist gives it node 0 in MODFLOW 6 (Dis.f90).
 */
export function layerNodes(v, g, out, label) {
  const { ncpl, nlay, ncol } = g;
  for (let c = 0; c < ncpl; c++) {
    const k = typeof v === 'number' ? v : Array.isArray(v) ? v[c] : NaN;
    if (!Number.isInteger(k) || k < 0 || k >= nlay) {
      const where = Array.isArray(v) ? ` at row ${Math.floor(c / ncol) + 1}, column ${(c % ncol) + 1}` : '';
      throw new Error(`${label}${where}: ${Number.isInteger(k) ? `layer ${k + 1}` : `"${k}"`} is not one of the model's layers, 1 to ${nlay} (counted from 0 here, as every index in the model).`);
    }
    const n = k * ncpl + c;
    out[c] = g.domain[n] ? n : -1;
  }
}
