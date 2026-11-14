// Running the model page's model, and saving and exporting it: the Run panel with what the
// model still needs, the run in a Web Worker (worker.js), and the JSON and MODFLOW 6 files.
import { toMf6 } from '../../../engine/model/mf6.js';
import { run } from '../../../engine/model/run.js';
import { countOf, el, errorBox, together } from '../../kit.js';
import { saveFile } from '../../ui.js';
import { startJob } from '../../worker-job.js';
import { zip } from '../../zip.js';
import { badParts, forSaving, missingParts, runnable, toJsonText } from './edit-model.js';
import { metres } from './common.js';

// ---------------------------------------------------------------------------------------
// Solving off the page

// The result so far from the steps the worker has posted: what the page shows when the run
// is stopped or a step does not converge.
function fromSteps(steps, base = {}) {
  const r = { ...base, times: [], heads: [], budget: [], obs: {}, iterations: [], periods: [], steps: [], dry: [], flows: [], notices: base.notices || [] };
  for (const st of steps) {
    r.times.push(st.time); r.heads.push(st.head); r.budget.push(st.budget); r.iterations.push(st.iteration);
    r.periods.push(st.period); r.steps.push(st.step); r.dry.push(st.dry); r.flows.push(st.flows ?? null);
    for (const [k, v] of Object.entries(st.obs)) (r.obs[k] || (r.obs[k] = [])).push(v);
  }
  if (!base.notices && steps.length) r.notices = steps[steps.length - 1].notices;
  return r;
}

function solve(model, onProgress, holder, signal) {
  const steps = [];
  const started = Date.now();
  // Solved on the page, as where the worker does not load, the result is whole; from the
  // worker, its heads came in the steps.
  let here = false;
  // A page left mid-run (signal) ends the run, and is given nothing.
  const job = startJob(new URL('./worker.js', import.meta.url), { model }, {
    onProgress, onStep: (st) => steps.push(st), signal, failed: 'The run stopped with an error.',
    fallback: () => { here = true; const t = Date.now(); const r = run(model); r.seconds = (Date.now() - t) / 1000; return r; },
  });
  return new Promise((resolve, reject) => {
    // Stop keeps the steps already solved, as MODFLOW 6's own output would hold them.
    if (holder) {
      holder.stop = () => {
        job.stop();
        if (!steps.length) { reject(new Error('Stopped before the first time step was solved.')); return; }
        resolve(Object.assign(fromSteps(steps), { complete: false, stopped: true, seconds: (Date.now() - started) / 1000 }));
      };
    }
    job.promise.then((res) => resolve(here ? res : fromSteps(steps, res)), (err) => {
      // The worker's result so far is the rest of the steps it posted.
      if (!here) err.result = err.result && steps.length ? Object.assign(fromSteps(steps, err.result), { complete: false }) : undefined;
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------------------

/** The Run panel; offers page.runNow, scrollToRun, scheduleChecks, refreshChecks and resetRun. */
export function mountRun(page) {
  const { host, view, notNumbers, blanks } = page;
  const runButton = el('button', { class: 'btn', type: 'button', onclick: () => runNow() }, 'Run');
  // Stop keeps the steps already solved, unlike Cancel on the other tools, which keeps nothing.
  const stopButton = el('button', { class: 'btn quiet', type: 'button', hidden: true, onclick: () => page.running && page.running.stop && page.running.stop() }, 'Stop (keeps the steps solved)');
  const needed = el('p', { class: 'needed', role: 'status' });
  const progress = el('progress', { max: '1', value: '0', hidden: true, 'aria-label': 'Run progress' });
  const progressText = el('p', { class: 'hint', role: 'status' });
  const runError = errorBox('');
  runError.hidden = true;
  const summary = el('p', { class: 'hint' });
  const saveButton = el('button', { class: 'btn quiet', type: 'button', onclick: saveJson }, 'Save the model (.json)');
  const exportButton = el('button', { class: 'btn quiet', type: 'button', onclick: () => exportMf6(false) }, 'Export MODFLOW 6 files (.zip)');
  // A model that came in other units can be written back in them, or in metres and days.
  const exportOwnButton = el('button', { class: 'btn quiet', type: 'button', hidden: true, onclick: () => exportMf6(true) }, '');
  const runPanel = el('section', { class: 'panel form-panel model-run', 'aria-label': 'Run', hidden: true },
    el('div', { class: 'setup-foot' }, summary, el('div', { class: 'run' }, el('div', { class: 'btn-row' }, runButton, stopButton), progress, progressText, needed)),
    runError,
    el('div', { class: 'downloads' }, saveButton, exportOwnButton, exportButton));
  page.root.append(runPanel);
  const scrollToRun = () => runPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  function saveJson() {
    const { model } = page;
    if (!model) return;
    saveFile(`${model.name || 'model'}.json`, new Blob([toJsonText(forSaving(model))], { type: 'application/json' }));
  }
  const unitWords = (u) => [{ FEET: 'feet', CENTIMETERS: 'centimetres', METERS: 'metres' }[u.length || 'METERS'], { HOURS: 'hours', MINUTES: 'minutes', SECONDS: 'seconds', DAYS: 'days' }[u.time || 'DAYS']].join(' and ');
  function exportMf6(own) {
    const { model } = page;
    runError.hidden = true;
    try {
      const m = runnable(model);
      const files = toMf6(m, own && m.fileUnits ? { units: m.fileUnits } : {});
      // In a folder of the model's name, so unzipping does not scatter the files.
      const bytes = zip(Object.entries(files).map(([name, data]) => ({ name: `${model.name}/${name}`, data })));
      saveFile(`${model.name}-mf6${own ? '-file-units' : ''}.zip`, new Blob([bytes], { type: 'application/zip' }));
    } catch (e) {
      runError.textContent = `The MODFLOW 6 files could not be written. ${e.message}`;
      runError.hidden = false;
    }
  }

  // keys: the run was started from a control that had the keyboard focus (Run, or a
  // panel's "Run the model"), so the focus goes to Stop, and back to Run at the end.
  async function runNow({ keys = document.activeElement === runButton } = {}) {
    if (!page.model || page.running) return;
    runError.hidden = true;
    page.noteMap('');
    let m;
    try { m = runnable(page.model); } catch (e) { runError.textContent = e.message; runError.hidden = false; return; }
    const total = m.periods.reduce((s, p) => s + p.nstp, 0);
    // The model and the edit count the run starts from: an edit made while it runs leaves
    // its results stale, and a model loaded while it runs is not given its results.
    const forModel = page.model, editsAtStart = page.editCount;
    page.running = {};
    stopButton.hidden = false;
    // Focus moves to Stop before Run is turned off, so a keyboard user is not sent to the
    // top of the page.
    if (keys) stopButton.focus({ preventScroll: true });
    runButton.disabled = true;
    progress.hidden = false;
    progress.value = 0;
    progressText.textContent = `Solving ${countOf(total, 'time step', 'time steps')}…`;
    const wasExample = page.example;
    const runState = page.running;
    try {
      const res = await solve(m, (p) => {
        progress.value = Math.min(1, (p.step - 1) / p.total);
        progressText.textContent = `Solving step ${p.step} of ${p.total} (period ${p.period + 1})…`;
      }, page.running, page.signal);
      if (page.model === forModel) showRun(res, m, wasExample, res.stopped ? `Stopped after ${countOf(res.times.length, 'time step', 'time steps')} of ${total}; the steps solved are shown.` : '', page.editCount !== editsAtStart);
    } catch (e) {
      if (page.model === forModel) {
        runError.textContent = e.message;
        runError.hidden = false;
        // A step that did not converge: the steps solved before it are still shown.
        if (e.result && e.result.times && e.result.times.length) {
          const n = e.result.times.length;
          showRun(e.result, m, wasExample, `The run stopped at a step that did not converge (see the message above). ${n === 1 ? 'The time step' : `The ${n} time steps`} solved before it ${n === 1 ? 'is' : 'are'} shown.`, page.editCount !== editsAtStart);
        }
      }
    } finally {
      // A new model loaded during the run has already taken the controls over.
      if (page.running === runState) {
        const lost = stopButton.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
        page.running = null;
        stopButton.hidden = true;
        progress.hidden = true;
        progressText.textContent = '';
        refreshChecks();
        if (keys && lost) {
          if (!runButton.disabled) runButton.focus({ preventScroll: true });
          else page.focusResults();
        }
      }
    }
  }

  // Shows a run's result: a whole run, or (partial says which) one stopped or the steps
  // solved before a step that did not converge. changed: the model was edited while it
  // ran, so the result is of the model as it was, and is shown as stale.
  function showRun(res, m, wasExample, partial, changed = false) {
    page.result = res;
    page.result.partial = partial || '';
    page.resultModel = m;
    page.stale = changed;
    page.forgetDrawn();
    if (page.stale) host.dataset.stale = '1'; else delete host.dataset.stale;
    const keepShow = view.show === 'drawdown' ? 'drawdown' : 'head';
    view.step = res.times.length - 1;
    view.period = res.periods[view.step];
    view.show = keepShow;
    page.buildShowSelect();
    page.buildStepSelect();
    page.buildRefSelect();
    page.buildScaleSelect();
    page.buildPeriodSelect();
    // The comparison with MODFLOW 6 belongs to the example as it was run; an edit made during
    // the run has already let the example go.
    page.resultExample = wasExample;
    page.refreshView();
    page.renderLists();
    page.renderResults();
    if (page.stale) delete host.dataset.done;
    page.syncPanels();
  }

  // ---- what the model still needs ----
  let checkTimer = null;
  function scheduleChecks() { clearTimeout(checkTimer); checkTimer = setTimeout(refreshChecks, 120); }
  page.signal.addEventListener('abort', () => clearTimeout(checkTimer));
  function refreshChecks() {
    const { model } = page;
    if (!model) return;
    const gaps = missingParts(model), wrong = badParts(model);
    const say = [];
    if (gaps.length) say.push(`Still needed: ${gaps.slice(0, 10).map((x) => x.text).join('; ')}${gaps.length > 10 ? `; and ${gaps.length - 10} more` : ''}.`);
    if (wrong.length) say.push(`To put right: ${wrong.slice(0, 8).map((x) => x.text).join(' ')}${wrong.length > 8 ? ` And ${wrong.length - 8} more.` : ''}`);
    if (blanks.size) say.push(`Still needed in the lists: ${[...blanks.keys()].join('; ')}.`);
    if (notNumbers.size) say.push(`Not a number: ${[...notNumbers.keys()].join('; ')}.`);
    needed.textContent = together(say.join(' '));
    const blocked = Boolean(gaps.length || wrong.length || notNumbers.size || blanks.size);
    runButton.disabled = blocked || Boolean(page.running);
    exportButton.disabled = blocked;
    exportOwnButton.hidden = !model.fileUnits;
    exportOwnButton.disabled = blocked;
    if (model.fileUnits) {
      exportOwnButton.textContent = `Export MODFLOW 6 files in ${unitWords(model.fileUnits)} (.zip)`;
      exportButton.textContent = 'Export MODFLOW 6 files in metres and days (.zip)';
    } else exportButton.textContent = 'Export MODFLOW 6 files (.zip)';
    // Every empty value the model needs is marked, as kit forms mark them once the page has a
    // model, and every impossible one is marked bad.
    page.markLayers(wrong);
    page.markGrid(wrong);
    page.markPeriods(wrong);
    page.showWords();
    page.showSolverWords();
    const g = model.grid, c = page.centres();
    const total = model.periods.reduce((s2, p) => s2 + (Number.isInteger(p.nstp) ? p.nstp : 0), 0);
    summary.textContent = together(`${model.name || 'Unnamed model'}: ${countOf(g.nlay, 'layer', 'layers')} of ${g.nrow} × ${g.ncol} cells over ${metres(c.W)} × ${metres(c.H)}; ${countOf(model.periods.length, 'stress period', 'stress periods')}, ${countOf(total, 'time step', 'time steps')}.`);
  }

  // A new model: the run's message goes, and the panel shows.
  function resetRun() {
    runError.hidden = true;
    runPanel.hidden = false;
  }

  Object.assign(page, { runNow, scrollToRun, scheduleChecks, refreshChecks, resetRun });
}
