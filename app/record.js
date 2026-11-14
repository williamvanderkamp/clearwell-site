// The well record tool: removes barometric and earth tide effects from a long record,
// and the effects of any further measured inputs the user adds.
import { fixed, together } from '../engine/format.js';
import { correct, INPUT_ACTIONS } from '../engine/index.js';
import { describe, inputMeaning, perUnit, plusMinus, stamp } from './method-text.js';
import { draw, resize } from './charts.js';
import { buildWorkbook } from './workbook.js';
import { $, applyDetected, datesAmbiguous, isDayFirst, numberIn, renderMethod, renderNotes, showError, state, tideFields } from './ui.js';
import {
  chartHosts, chartImages, chosenColumns, column, efficiencyProblem, fillBody, resultPanels, siteProblem, stampTimes, wireCharts, wireWorkbook,
} from './well-page.js';
import { addInput, clearInputs, inputFieldIds, inputProblem, inputSpecs, wireInputs } from './record-inputs.js';
import { startJob } from './worker-job.js';

const panels = resultPanels(['results', 'c1Panel', 'c2Panel', 'c3Panel', 'inputsPanel', 'methodPanel']);
// The inputs' charts are drawn only when there are inputs.
const chartKeys = (r) => ['level', 'removed', 'response', ...(r && r.inputs ? ['inputResponse', 'inputEffect'] : [])];
const hosts = () => chartHosts(chartKeys(state.result), 'chart-');
// Inputs an example comes with, put in once its table is loaded.
let exampleInputs = null;

// A long record takes seconds to correct, so correct() runs in a Web Worker and the page
// stays live, as the slug and pumping fits do (worker-job.js). Where a worker cannot start,
// or fails to load, it runs here, after the page has had a moment to draw. stop() ends a
// run still going, whose promise then never settles.
function corrector() {
  let job = null;
  const stop = () => {
    if (job) job.stop();
    job = null;
  };
  function start(input, opts) {
    stop();
    job = startJob(new URL('./record-worker.js', import.meta.url), { input, opts }, { fallback: () => correct(input, opts) });
    return job.promise;
  }
  return { start, stop };
}
const corrections = corrector();

const dateIn = (id, endOfDay) => {
  const v = $(id).value;
  if (!v) return undefined;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return endOfDay ? ms + 864e5 : ms;
};

// Entries that can't be right, named by their field. Returns the first problem, or ''.
function badEntry(col) {
  const from = dateIn('fitStart'), to = dateIn('fitEnd', true);
  const fitDates = from !== undefined && to !== undefined && to <= from ? '"Fit to" must be on or after "Fit from".' : '';
  return efficiencyProblem() || siteProblem() || fitDates || inputProblem(col);
}

function run() {
  // A run still going is for the entries as they were.
  corrections.stop();
  showError('');
  $('runError').hidden = true;
  const col = chosenColumns();
  const t = stampTimes(col, isDayFirst(col.time));
  if (t.filter(Number.isFinite).length < 24) {
    panels.fail('The date and time column could not be read. Choose the right column, or check that dates look like 2026-06-29 14:30.');
    return;
  }
  const bad = badEntry(col);
  if (bad) { panels.fail(bad); return; }
  const opts = {
    levelKind: $('levelKind').value, levelUnit: $('levelUnit').value, baroUnit: $('baroUnit').value,
    fitStart: dateIn('fitStart'), fitEnd: dateIn('fitEnd', true),
    lat: numberIn('lat'), lon: numberIn('lon'), utcOffsetHours: numberIn('utcOffset'), userBE: numberIn('userBE'),
    inputs: inputSpecs(),
  };
  const { header } = state.table;
  const info = {
    fileName: state.name, sheetName: state.sheets.length > 1 ? state.sheet.name : '',
    levelName: header[col.level], baroName: header[col.baro],
  };
  corrections.start({ t, level: column(col.level), baro: column(col.baro) }, opts).then((result) => {
    state.result = result;
    state.col = col;
    state.text = describe(result, info);
    render();
  }).catch((e) => panels.fail(e.message));
}

// One method's row. A cell with no value says n/a, as the other tools' tables do,
// instead of standing empty.
function summaryRow(label, be, explained, range, changed) {
  const cells = [fixed(be, 3, ''), fixed(1 - be, 3, ''), range ? `${fixed(range.min, 2, '')} to ${fixed(range.max, 2, '')}` : '', explained, changed];
  return [label, ...cells.map((v) => v || 'n/a')];
}

function renderSummary(r) {
  const m = r.method;
  const toMm = (v) => fixed(v * 1000, 1, '');
  const percent = (v) => `${fixed(v * 100, 0, '')}%`;
  fillBody($('summary'), [
    summaryRow(`Standard: response function, ${m.lagHours} h lag${m.tide.used ? ', earth tide' : ''}${r.inputs ? `, ${r.inputs.list.length} further input${r.inputs.list.length > 1 ? 's' : ''}` : ''}`, m.be, percent(m.explained), m.beRange, toMm(r.diagnostics.changeCorrected)),
    summaryRow('Constant barometric efficiency', m.constant.be, percent(m.constantExplained), m.constant.range, toMm(r.diagnostics.changeConstant)),
    ...(r.user ? [summaryRow('Your barometric efficiency', r.user.be, '', null, '')] : []),
  ]);
  $('rawChange').textContent = `Before correction the same step-to-step change was ${toMm(r.diagnostics.changeRaw)} mm.`;
}

// Each input's response in a table row, and what it means under the table.
function renderInputs(r) {
  $('inputsPanel').hidden = !r.inputs;
  if (!r.inputs) return;
  const m = r.method;
  fillBody($('inputsTable'), r.inputs.list.map((x) => [
    x.name, perUnit(x, m.levelUnit), `${fixed(x.lagHours, 0)} h`, plusMinus(x, x.immediate), x.lagged ? plusMinus(x, x.lagged) : 'n/a', plusMinus(x, x.total), INPUT_ACTIONS[x.action],
  ].map(together)));
  const host = $('inputsText');
  host.textContent = '';
  for (const x of r.inputs.list) {
    const h = document.createElement('h3');
    h.textContent = x.name;
    host.append(h, ...inputMeaning(x, m).map((line) => { const p = document.createElement('p'); p.textContent = together(line); return p; }));
  }
}

function render() {
  const r = state.result;
  panels.show();
  renderSummary(r);
  renderInputs(r);
  fillBody($('lines'), Object.entries(r.diagnostics.lines).map(([name, a]) => [name, fixed(a.before * 1000, 2, ''), fixed(a.after * 1000, 2, '')]));
  renderMethod($('method'), state.text);
  renderNotes($('notes'), r.warnings.map(together));
  $('period').textContent = `${stamp(r.t[0])} to ${stamp(r.t[r.t.length - 1])}, ${r.t.length} rows`;
  $('saveStatus').textContent = '';
  draw(r, hosts());
}

async function workbook() {
  const images = await chartImages(state.result, chartKeys(state.result));
  return buildWorkbook(window.ExcelJS, state.result, state.text, state.table, state.col, images);
}

export const record = {
  title: 'Clean a well record',
  lede: 'Removes barometric pressure and earth tide effects from a well record, using published regression methods, and the effects of rain, a river stage or any other series you measured, if you add them. You get back the corrected record, each removed component, and the fitted numbers.',
  dropText: 'Excel or CSV, with the columns below.',
  samples: [
    { label: 'Use an example', file: 'sample.js', read: () => window.CLEARWELL_SAMPLE, note: 'Example: USGS well WOOD-08-01, Illinois, public data.' },
    {
      id: 'rain', label: 'Rain and river example', file: 'rain-sample.js', read: () => window.CLEARWELL_RAIN,
      note: 'Example with a known answer: an invented confined well, rain gauge and river, seen through a real barometer (Rockford, Illinois). It was made with a barometric efficiency of 0.202, an immediate rain response of 0.798, the loading efficiency, then −0.318 more by 72 hours, and a river response of 0.100 at once and 0.249 more by 48 hours.',
    },
  ],
  hide() { corrections.stop(); panels.hide(); },
  run,
  resize() { if (state.result) resize(hosts()); },
  redraw() { if (state.result) draw(state.result, hosts()); },
  fresh(site) { $('fitStart').value = ''; $('fitEnd').value = ''; exampleInputs = site && site.inputs ? site.inputs : null; },
  // A new file or sheet starts with no inputs, unless it is an example that has them.
  start() {
    applyDetected();
    clearInputs();
    (exampleInputs || []).forEach(addInput);
  },
  // Shows the fields that apply, and returns those that must be filled.
  required() {
    const ambiguous = datesAmbiguous(+$('colTime').value);
    $('dateOrderField').hidden = !ambiguous;
    $('baroUnitField').hidden = false;
    $('colTime2Field').hidden = false;
    return ['colTime', ...(ambiguous ? ['dateOrder'] : []), 'colLevel', 'levelKind', 'levelUnit', 'colBaro', 'baroUnit', ...tideFields(), ...inputFieldIds()];
  },
  wire() {
    wireInputs();
    wireWorkbook('saveXlsx', 'saveStatus', 'corrected', workbook);
    wireCharts('png', 'saveStatus');
  },
};
