// Panels that plug into the model page after the results, as docs/design/model-tools.md
// plans them: calibration (calibrate.js) and particle tracking (particles.js), and the
// page's part (mountPanels below), which mounts them and tells them of the model.
// Each module exports mount(host, ctx), which resolves to { update(model, result, state) }.
//   ctx.model: the model as the solver takes it (null while the editor's model is incomplete);
//   ctx.result: its latest run, or null when there is none or the model has changed since;
//   ctx.state: { stale, complete, fresh }: stale, the model has changed since the run;
//     complete, the model can run; fresh, a new model was loaded, so what was typed goes;
//   ctx.run(): runs the page's model, for a panel that needs a run of the model as it is;
//   ctx.signal: aborted when the page leaves the model, for a panel's work still running;
//   ctx.onApply(fit): calibration only; fit is { grid: { nlay, nrow, ncol }, check(model),
//     apply(model) }. The page calls check on its own current model, which gives the reason
//     the values cannot go in when what they were fitted for has changed, then apply, so edits
//     made since to other parts of the model are kept. It returns null, or the reason the
//     values could not be applied;
//   ctx.overlay(draw, legend): draws on the map. draw(ctx, { X, Y }) is called after the
//     contours on every redraw, with X(x) and Y(y) turning metres east of the grid's west
//     edge and south of its north edge into canvas pixels; legend is [{ kind, label }] for
//     the map's key, kind 'path' or 'zone'. overlay(null) takes it away.
// The page calls update after every edit (briefly delayed), every run and every new model.
// A panel keeps what is typed in it across runs, and works only on a run of the current model.
import { el, errorBox } from '../../kit.js';
import { missingParts, runnable } from './edit-model.js';

// A panel is listed here once its module exists: the page's security policy allows no fetch
// to test whether a module is there, and a failed import would show as an error on the page.
export const PANELS = [
  { id: 'particles', load: () => import('./particles.js') },
  { id: 'calibrate', load: () => import('./calibrate.js') },
];

// ---- panels from later stages ----
// A panel is mounted once the model can run, and is told of the model after every edit,
// run and new model, with whether its run is of the model as it is now. It keeps what is
// typed in it, and works only on a run of the current model.

/** The panels' places after the page; offers page.syncPanels and syncPanelsSoon. */
export function mountPanels(page) {
  const { host } = page;
  const slots = {
    particles: el('div', { class: 'stack model-slot', 'data-panel': 'particles', hidden: true }),
    calibrate: el('div', { class: 'stack model-slot', 'data-panel': 'calibrate', hidden: true }),
  };
  // The panels sit after the page, not inside it, so dimming the page's old results does
  // not dim a panel's own notice that it waits for a run.
  host.append(slots.particles, slots.calibrate);

  const mounted = {};
  let panelTimer = null;
  page.signal.addEventListener('abort', () => clearTimeout(panelTimer));
  const syncPanelsSoon = () => { clearTimeout(panelTimer); panelTimer = setTimeout(syncPanels, 150); };
  async function syncPanels({ fresh = false } = {}) {
    clearTimeout(panelTimer);
    let clean = null;
    try { clean = page.model ? runnable(page.model) : null; } catch { clean = null; }
    for (const p of PANELS) {
      const slot = slots[p.id] || (slots[p.id] = el('div', { class: 'stack model-slot', 'data-panel': p.id }));
      if (!slot.isConnected) host.append(slot);
      // A panel once opened stays in view while the model is incomplete, saying why it waits.
      slot.hidden = !clean && !mounted[p.id];
      if (!clean && !mounted[p.id]) continue;
      const state = { stale: Boolean(page.result) && page.stale, complete: Boolean(clean), fresh };
      const now = page.result && !page.stale ? page.result : null;
      try {
        if (mounted[p.id]) { (await mounted[p.id]).update(clean, now, state); continue; }
        mounted[p.id] = p.load().then((mod) => mod.mount(slot, {
          model: clean, result: now, state, signal: page.signal,
          overlay: (draw, legendItems) => { page.overlays[p.id] = draw ? { draw, legend: legendItems || [] } : null; page.map.redraw(); page.drawLegend(); },
          run: () => { page.runNow({ keys: slot.contains(document.activeElement) }); page.scrollToRun(); },
          onApply: applyFitted,
        }));
        await mounted[p.id];
      } catch (e) {
        delete mounted[p.id];
        slot.replaceChildren(errorBox(`The ${p.id} panel could not be opened. ${e.message}`));
      }
    }
  }

  // Fitted values from the calibration panel go into the editor's own model, so edits made
  // since to other parts of it are kept; but only while the values the fit acts on are as
  // they were in the calibrated run (fit.check), so a multiplier never multiplies a value it
  // was not fitted for. fit: { grid: { nlay, nrow, ncol }, check(model), apply(model) }.
  function applyFitted(fit) {
    const { model } = page;
    const g = model.grid;
    if (fit.grid.nlay !== g.nlay || fit.grid.nrow !== g.nrow || fit.grid.ncol !== g.ncol) {
      return 'The grid has changed since this calibration, so its zones no longer fit the model. Calibrate again.';
    }
    const gaps = missingParts(model);
    if (gaps.length) return `The model is not complete (still needed: ${gaps.slice(0, 3).map((x) => x.text).join('; ')}), so the fitted values cannot be applied to it.`;
    const changed = fit.check ? fit.check(model) : null;
    if (changed) return changed;
    const said = fit.apply(model);
    page.edited();
    page.buildLayers();
    page.press(-1);
    page.status(`The fitted values are now in the model: ${said}. Press Run to see its heads.`);
    return null;
  }

  Object.assign(page, { syncPanels, syncPanelsSoon });
}
