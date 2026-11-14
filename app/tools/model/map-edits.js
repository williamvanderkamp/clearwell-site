// What the map's tools do to the model: paint a cell value, place a boundary or an
// observation point, or erase them, on the cells the user chose on the map.
import { countOf } from '../../kit.js';
import { badParts, evtCellsBlocked, PACKAGE_IDS, PACKAGES, paintCells, placeEntry, propOf, removeEntries } from './edit-model.js';
import { num, SHOW_PROPS } from './common.js';

/** The edits on the map; offers page.apply, which the map calls with the cells chosen. */
export function mountMapEdits(page) {
  const { view } = page;
  // A brush stroke reaches apply() a few cells at a time; what it removed or left out is
  // counted over the whole stroke, so the note says what the stroke did.
  let tally = { stroke: null, removed: 0, skipped: 0 };
  function apply(cells, stroke = null) {
    const { model, vi, pkgInputs } = page;
    if (!model) return;
    const g = model.grid, k = view.layer, ncpl = g.nrow * g.ncol;
    const isActive = (r, c) => !g.idomain || g.idomain[k * ncpl + r * g.ncol + c] === 1;
    if (!stroke || tally.stroke !== stroke) tally = { stroke, removed: 0, skipped: 0 };
    // Messages go to the note by the map, which the readout does not overwrite. Each edit
    // clears the one before, so a note always says what the latest edit did.
    page.noteMap('');
    const tell = page.noteMap;
    const t = view.tool;
    if (t === 'paint') {
      const prop = view.show;
      if (!SHOW_PROPS.includes(prop)) { tell('Choose what to paint under Show: a cell value, not results or the boundaries.'); return; }
      let v;
      if (prop === 'idomain') v = Number(vi.active.value);
      else {
        v = num(vi.value.value);
        if (v === undefined) { tell('Give the value to paint first.'); return; }
        if (Number.isNaN(v)) { tell('The value to paint is not a number.'); return; }
        const pr = propOf(model, prop);
        if (pr.positive && !(v > 0)) { tell(`${pr.label} must be above zero.`); return; }
        if (pr.nonNegative && v < 0) { tell(`${pr.label} cannot be below zero.`); return; }
        if (pr.atMost !== undefined && v > pr.atMost) { tell(`${pr.label} cannot be above ${pr.atMost}.`); return; }
      }
      if (prop === 'rch' && !model.periods.length) { tell('Add a stress period first: recharge is given period by period.'); return; }
      paintCells(model, prop, k, cells.map(([r, c]) => r * g.ncol + c), v, view.period);
      if (prop === 'idomain' && v !== 1) {
        const off = badParts(model).filter((b) => b.part === 'map');
        if (off.length) tell(`${off[0].text}${off.length > 1 ? ` And ${countOf(off.length - 1, 'other list', 'other lists')} the same.` : ''}`);
      }
    } else if (PACKAGE_IDS.includes(t)) {
      if (!model.periods.length) { tell('Add a stress period first: boundaries are given period by period.'); return; }
      const vals = pkgInputs[t].map((x) => num(x.input.value));
      if (vals.some((x) => x === undefined)) { tell(`Give the ${PACKAGES[t].values.map(([, l]) => l.toLowerCase()).join(', ')} first.`); return; }
      if (vals.some((x) => Number.isNaN(x))) { tell(`A ${PACKAGES[t].label.toLowerCase()} value is not a number.`); return; }
      if (t === 'riv' && vals[2] > vals[0]) { tell('The riverbed bottom must be at or below the stage, as MODFLOW 6 requires.'); return; }
      if (PACKAGES[t].values.some(([key], i) => key === 'cond' && vals[i] < 0)) { tell('A conductance cannot be below zero.'); return; }
      if (t === 'evtList' && (vals[1] < 0 || vals[2] < 0)) { tell('The maximum rate and the extinction depth cannot be below zero.'); return; }
      if (t === 'evtList' && evtCellsBlocked(model)) { tell(evtCellsBlocked(model)); return; }
      for (const [r, c] of cells) { if (isActive(r, c)) placeEntry(model, t, view.period, k, r, c, vals); else tally.skipped++; }
      const skipped = tally.skipped;
      if (skipped) tell(`${countOf(skipped, 'inactive cell was', 'inactive cells were')} left out of the ${PACKAGES[t].plural.toLowerCase()} in period ${view.period + 1}: a boundary needs an active cell.`);
    } else if (t === 'obs') {
      const [r, c] = cells[0];
      const name = vi.obsName.value.trim();
      if (!name) { tell('Give the observation point a name first.'); return; }
      if (model.obs.some((o) => o.name === name)) { tell(`There is already a point called ${name}. Give the new one another name.`); return; }
      if (!isActive(r, c)) { tell('An observation point needs an active cell.'); return; }
      model.obs.push({ name, lay: k, row: r, col: c });
      vi.obsName.value = page.nextObsName();
    } else if (t === 'erase') {
      let n = 0;
      const triples = cells.map(([r, c]) => [k, r, c]);
      for (const id of PACKAGE_IDS) n += removeEntries(model, id, view.period, triples);
      const key = new Set(cells.map(([r, c]) => `${r},${c}`));
      const before = model.obs.length;
      model.obs = model.obs.filter((o) => !(o.lay === k && key.has(`${o.row},${o.col}`)));
      n += before - model.obs.length;
      tally.removed += n;
      if (tally.removed) tell(`Removed ${countOf(tally.removed, 'boundary or point', 'boundaries and points')} in period ${view.period + 1}.`);
    } else return;
    page.edited();
    page.map.redraw();
    page.map.refreshReadout();
  }

  Object.assign(page, { apply });
}
