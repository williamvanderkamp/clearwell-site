// Keeping the model page in step: after an edit, everything that shows the model is brought
// up to date, and a new model clears everything from the one before.

/** Offers page.edited and useModel. */
export function mountSync(page) {
  const { host, view, notNumbers, blanks } = page;

  // rebuildLists: false for an edit typed in the lists, which must not be rebuilt under it.
  function edited(rebuildLists = true) {
    if (!page.model) return;
    page.editCount++;
    if (page.example) {
      page.example = null;
      page.press(-1);
      page.status('');
    }
    if (page.result) {
      page.stale = true;
      if (host.dataset.done) delete host.dataset.done;
      host.dataset.stale = '1';
    }
    page.scheduleChecks();
    if (rebuildLists) page.renderLists();
    page.fillPeriods();
    page.fillLayerInputs();
    page.drawLegend();
    page.map.redraw();
    // The panels always work on the model as it is now.
    page.syncPanelsSoon();
  }

  // A new model: everything from before is cleared.
  function useModel(m, ex) {
    if (page.running && page.running.stop) page.running.stop();
    page.model = m;
    page.example = ex;
    page.result = null; page.resultModel = null; page.resultExample = null; page.stale = false;
    // A panel's drawing belongs to the model it was made for.
    for (const id of Object.keys(page.overlays)) delete page.overlays[id];
    notNumbers.clear();
    blanks.clear();
    delete host.dataset.done;
    delete host.dataset.stale;
    Object.assign(view, { layer: 0, period: 0, show: 'k', step: 0, interval: undefined, ref: '', scale: 'linear' });
    page.resetDrop();
    page.resetGrid();
    page.resetLayers();
    page.resetPeriods();
    page.resetView();
    page.resetLists();
    page.resetRun();
    page.resetResults();
    page.fillGridForm(m);
    page.buildLayers();
    page.buildPeriods();
    page.buildLayerSelect();
    page.buildShowSelect();
    page.buildStepSelect();
    page.buildRefSelect();
    page.map.fit();
    page.refreshView();
    page.renderListsNow();
    page.refreshChecks();
    page.showUnits();
    page.syncPanels({ fresh: true });
  }

  Object.assign(page, { edited, useModel });
}
