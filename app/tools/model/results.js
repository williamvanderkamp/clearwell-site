// The model page's results: what the run did, the comparison with MODFLOW 6 for an example,
// the water budget, the observation points, the method, and the workbook of results.
import { chart, countOf, done, downloadWorkbook, el, errorBox, fixed, methodPanel, sig, table, together } from '../../kit.js';
import { cellName } from './edit-model.js';
import { budgetDifference, budgetTable, cumulativeBudget, dryText, headDifference, methodText, referenceText, workbookSheets } from './calc.js';

/** The results, after the Run panel; offers page.renderResults, focusResults and resetResults. */
export function mountResults(page) {
  const { host, view } = page;
  const out = el('div', { class: 'stack model-results' });
  page.root.append(out);

  function renderResults() {
    out.textContent = '';
    if (!page.result) return;
    const { resultExample } = page;
    const r = page.result, m = page.resultModel, s = view.step, g = m.grid, ncpl = g.nrow * g.ncol;
    const its = r.iterations;
    const worst = Math.max(...r.budget.map((b) => Math.abs(b.discrepancyPercent)));
    const ref = page.reference();
    const ddShown = view.show === 'drawdown' && ref;
    const allSteady = m.periods.every((p) => p.steady);
    // A run whose budget does not balance is not called solved (run.js flags each such step).
    const unbalanced = r.budget.some((b) => b.discrepancyWarning) || worst > (r.discrepancyLimit ?? 1);
    const verb = r.partial || unbalanced ? 'Ran' : 'Solved';
    const head = el('section', { class: 'panel' }, el('h2', {}, 'Results'),
      r.partial ? errorBox(together(r.partial)) : null,
      el('p', {}, together(`${verb} ${countOf(r.times.length, 'time step', 'time steps')} in ${sig(r.seconds || 0, 2)} s, with ${Math.min(...its) === Math.max(...its) ? countOf(its[0], 'outer iteration', 'outer iterations') : `${Math.min(...its)} to ${Math.max(...its)} outer iterations`}${r.times.length > 1 ? ' a step' : ''}. The largest budget discrepancy is ${sig(worst, 2)} %${unbalanced ? `, above the ${r.discrepancyLimit ?? 1} % limit, so the results cannot be trusted` : ''}.`)),
      el('p', { class: 'hint' }, together(`The map shows ${ddShown ? `drawdown, ${referenceText(r, ref)} minus the head,` : 'heads'} in layer ${view.layer + 1} at the end of period ${r.periods[s] + 1}, step ${r.steps[s] + 1} (${sig(r.times[s], 4)} d). Choose the layer, the step and head or drawdown above the map.${allSteady && !ref ? ' The run is of one steady period, so there is no drawdown: there is no earlier state to measure from.' : ''}`)));
    // The solver's notices (a well in a dry cell, a large budget discrepancy), when it gives
    // them; otherwise the page's own check of the budget.
    const given = Array.isArray(r.notices) ? r.notices : null;
    const warnings = given ? given.map((w) => (typeof w === 'string' ? w : w.text || w.message)).filter(Boolean) : [];
    if (!given && worst > (r.discrepancyLimit ?? 1)) {
      const at = r.budget.findIndex((b) => Math.abs(b.discrepancyPercent) === worst);
      warnings.push(`The budget discrepancy reaches ${sig(worst, 2)} % at period ${r.periods[at] + 1}, step ${r.steps[at] + 1}. Above about 1 % the heads cannot be trusted: tighten the head and residual closures, or check for values far outside what is physical, such as very short steps or very large K.`);
    }
    for (const w of warnings) head.append(errorBox(together(w)));
    head.append(el('p', {}, together(dryText(m, r, s, cellName))));
    if (resultExample && resultExample.mf6) head.append(compareWithMf6(r, resultExample.mf6));
    head.append(el('div', { class: 'downloads' }, el('button', { class: 'btn quiet', type: 'button', onclick: downloadResults }, 'Download the results (.xlsx)')));
    out.append(head);

    // The budget, as MODFLOW 6's list file gives it.
    const b = r.budget[s], cum = cumulativeBudget(r.budget, r.times)[s];
    const bt = budgetTable(b, cum);
    out.append(el('section', { class: 'panel' },
      el('h2', {}, `Water budget, period ${r.periods[s] + 1}, step ${r.steps[s] + 1}`),
      el('p', { class: 'hint' }, `As in the MODFLOW 6 list file: the rate of water into and out of the aquifer through each package, and the volumes added up since the start of the run. Each column is written to the same number of decimal places.${Object.keys(b.in).some((t) => t.startsWith('STO')) ? ' STO-SS and STO-SY are water released from or taken into storage.' : ''}`),
      table(['Package', 'Rate in (m³/d)', 'Rate out (m³/d)', 'Cumulative in (m³)', 'Cumulative out (m³)'], bt.rows),
      el('p', {}, together(`Discrepancy: ${sig(b.discrepancyPercent, 2)} % of the rates, ${sig(cum.discrepancyPercent, 2)} % of the cumulative volumes.`))));

    // Observation points.
    if (m.obs && m.obs.length) {
      const r0 = ref ? page.refHeads(ref) : null;
      const at0 = (o) => (r0 ? r0[o.lay * ncpl + o.row * g.ncol + o.col] : NaN);
      const sec = el('section', { class: 'panel' }, el('h2', {}, 'Observation points'));
      if (r.times.length > 1) {
        // Drawdown is drawn from its reference on; before it there is nothing to measure from.
        const from = ddShown && ref.kind === 'step' ? ref.step : 0;
        const xs = r.times.slice(from);
        const logT = xs[0] > 0 && xs[xs.length - 1] / xs[0] > 100;
        const series = m.obs.map((o) => ({ label: o.name, x: xs, y: r.obs[o.name].slice(from).map((h) => (ddShown ? at0(o) - h : h)) }));
        sec.append(chart({ title: ddShown ? 'Drawdown against time' : 'Head against time', series, xLabel: logT ? 'Time (d), log scale' : 'Time (d)', yLabel: ddShown ? 'Drawdown (m)' : 'Head (m)', logX: logT, invertY: Boolean(ddShown) }));
        if (ddShown) sec.append(el('p', { class: 'hint' }, 'Drawdown is plotted downward, from the time it is measured from.'));
      }
      const refAt = (o) => (resultExample && resultExample.mf6 && resultExample.mf6.obs[o.name] ? resultExample.mf6.obs[o.name][s] : undefined);
      const header = ['Point', 'Cell', 'Head (m)'];
      if (ref) header.push('Drawdown (m)');
      if (resultExample && resultExample.mf6) header.push('MODFLOW 6 head (m)');
      sec.append(el('p', { class: 'hint' }, together(`At the end of period ${r.periods[s] + 1}, step ${r.steps[s] + 1} (${sig(r.times[s], 4)} d).${ref ? ` Drawdown from ${referenceText(r, ref)}.` : ' No drawdown: the run is of one steady period.'}`)),
        table(header, m.obs.map((o) => {
          const h = r.obs[o.name][s];
          const row = [o.name, cellName(o.lay, o.row, o.col), Number.isFinite(h) ? fixed(h, 4) : 'dry'];
          if (ref) row.push(Number.isFinite(h) && Number.isFinite(at0(o)) ? fixed(at0(o) - h, 4) : 'n/a');
          if (resultExample && resultExample.mf6) { const x = refAt(o); row.push(x === null || x === undefined ? 'dry' : fixed(x, 4)); }
          return row;
        })));
      out.append(sec);
    }
    out.append(methodPanel(methodText(m, r, ref)));
    done(host);
  }

  function downloadResults() {
    const { result, resultModel } = page;
    if (!result) return;
    const ref = page.reference();
    const text = methodText(resultModel, result, ref);
    text.notes = [
      `Results of ${resultModel.name}, run on this page. Heads and drawdown in m, rates in m³/d, volumes in m³, times in days. Layers, rows and columns are counted from 1.`,
      `The head sheets hold every layer at period ${result.periods[view.step] + 1}, step ${result.steps[view.step] + 1} (${sig(result.times[view.step], 4)} d), rows from north to south. A blank cell is inactive or dry.`,
      ...(page.stale ? ['The model was changed on the page after this run; these are the results of the model as it was run.'] : []),
    ];
    downloadWorkbook(`${resultModel.name}-results.xlsx`, workbookSheets(resultModel, result, ref, view.step), text);
  }

  function compareWithMf6(r, ref) {
    const last = r.heads.length - 1;
    const cells = headDifference(r.heads[last], ref.lastHeads);
    let obsMax = 0, obsN = 0;
    for (const [name, vals] of Object.entries(ref.obs)) {
      const mine = r.obs[name];
      if (!mine) continue;
      const d = headDifference(mine, vals);
      obsMax = Math.max(obsMax, d.max); obsN += d.compared;
    }
    const bud = budgetDifference(r.budget, ref.budget);
    const same = cells.mismatched === 0 && r.times.length === ref.times.length;
    // The largest head difference, for the browser test.
    return el('p', { class: 'model-compare', 'data-largest': same ? String(Math.max(cells.max, obsMax)) : 'mismatch' }, together(same
      ? `MODFLOW 6 (${ref.version}) gives the same heads for this model. At the last step the largest difference over all ${cells.compared} active cells is ${sig(cells.max, 2)} m; at the observation points over every step (${obsN} heads) it is ${sig(obsMax, 2)} m. Every budget term agrees to within ${sig(bud.max, 2)} m³/d, against a largest term of ${sig(bud.largest, 4)} m³/d.`
      : `This run does not match the MODFLOW 6 run saved with the example: ${cells.mismatched} cells differ in whether they have a head.`));
  }

  // The focus, after a run started from the keyboard, when Run cannot take it.
  function focusResults() {
    const h = out.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }

  // A new model: the results of the one before go.
  function resetResults() {
    out.textContent = '';
  }

  Object.assign(page, { renderResults, focusResults, resetResults });
}
