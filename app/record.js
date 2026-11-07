// The well record tool: removes barometric and earth tide effects from a long record.
import { fixed, together } from './format.js';
import { correct } from '../engine/index.js';
import { describe, stamp } from './method-text.js';
import { draw, resize } from './charts.js';
import { buildWorkbook } from './workbook.js';
import { $, applyDetected, datesAmbiguous, isDayFirst, numberIn, renderMethod, renderNotes, showError, state, tideFields } from './ui.js';
import {
  chartHosts, chartImages, chosenColumns, column, efficiencyProblem, fillBody, resultPanels, siteProblem, stampTimes, wireCharts, wireWorkbook,
} from './well-page.js';

const panels = resultPanels(['results', 'c1Panel', 'c2Panel', 'c3Panel', 'methodPanel']);
const CHART_KEYS = ['level', 'removed', 'response'];
const hosts = () => chartHosts(CHART_KEYS, 'chart-');

const dateIn = (id, endOfDay) => {
  const v = $(id).value;
  if (!v) return undefined;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return endOfDay ? ms + 864e5 : ms;
};

// Entries that can't be right, named by their field. Returns the first problem, or ''.
function badEntry() {
  const from = dateIn('fitStart'), to = dateIn('fitEnd', true);
  const fitDates = from !== undefined && to !== undefined && to <= from ? '"Fit to" must be on or after "Fit from".' : '';
  return efficiencyProblem() || siteProblem() || fitDates;
}

function run() {
  showError('');
  $('runError').hidden = true;
  const col = chosenColumns();
  const t = stampTimes(col, isDayFirst(col.time));
  if (t.filter(Number.isFinite).length < 24) {
    panels.fail('The date and time column could not be read. Choose the right column, or check that dates look like 2026-06-29 14:30.');
    return;
  }
  const bad = badEntry();
  if (bad) { panels.fail(bad); return; }
  const opts = {
    levelKind: $('levelKind').value, levelUnit: $('levelUnit').value, baroUnit: $('baroUnit').value,
    fitStart: dateIn('fitStart'), fitEnd: dateIn('fitEnd', true),
    lat: numberIn('lat'), lon: numberIn('lon'), utcOffsetHours: numberIn('utcOffset'), userBE: numberIn('userBE'),
  };
  const { header } = state.table;
  try {
    const result = correct({ t, level: column(col.level), baro: column(col.baro) }, opts);
    state.result = result;
    state.col = col;
    state.text = describe(result, {
      fileName: state.name, sheetName: state.sheets.length > 1 ? state.sheet.name : '',
      levelName: header[col.level], baroName: header[col.baro],
    });
    render();
  } catch (e) {
    panels.fail(e.message);
  }
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
    summaryRow(`Standard: response function, ${m.lagHours} h lag${m.tide.used ? ', earth tide' : ''}`, m.be, percent(m.explained), m.beRange, toMm(r.diagnostics.changeCorrected)),
    summaryRow('Constant barometric efficiency', m.constant.be, percent(m.constantExplained), m.constant.range, toMm(r.diagnostics.changeConstant)),
    ...(r.user ? [summaryRow('Your barometric efficiency', r.user.be, '', null, '')] : []),
  ]);
  $('rawChange').textContent = `Before correction the same step-to-step change was ${toMm(r.diagnostics.changeRaw)} mm.`;
}

function render() {
  const r = state.result;
  panels.show();
  renderSummary(r);
  fillBody($('lines'), Object.entries(r.diagnostics.lines).map(([name, a]) => [name, fixed(a.before * 1000, 2, ''), fixed(a.after * 1000, 2, '')]));
  renderMethod($('method'), state.text);
  renderNotes($('notes'), r.warnings.map(together));
  $('period').textContent = `${stamp(r.t[0])} to ${stamp(r.t[r.t.length - 1])}, ${r.t.length} rows`;
  $('saveStatus').textContent = '';
  draw(r, hosts());
}

async function workbook() {
  const images = await chartImages(state.result, CHART_KEYS);
  return buildWorkbook(window.ExcelJS, state.result, state.text, state.table, state.col, images);
}

export const record = {
  title: 'Clean a well record',
  lede: 'Removes barometric pressure and earth tide effects from a well record, using published regression methods. You get back the corrected record, each removed component, and the fitted numbers.',
  dropText: 'Excel or CSV, with the columns below.',
  samples: [{ label: 'Use an example', file: 'sample.js', read: () => window.CLEARWELL_SAMPLE, note: 'Example: USGS well WOOD-08-01, Illinois, public data.' }],
  hide: panels.hide,
  run,
  resize() { if (state.result) resize(hosts()); },
  redraw() { if (state.result) draw(state.result, hosts()); },
  fresh() { $('fitStart').value = ''; $('fitEnd').value = ''; },
  start() { applyDetected(); },
  // Shows the fields that apply, and returns those that must be filled.
  required() {
    const ambiguous = datesAmbiguous(+$('colTime').value);
    $('dateOrderField').hidden = !ambiguous;
    $('baroUnitField').hidden = false;
    $('colTime2Field').hidden = false;
    return ['colTime', ...(ambiguous ? ['dateOrder'] : []), 'colLevel', 'levelKind', 'levelUnit', 'colBaro', 'baroUnit', ...tideFields()];
  },
  wire() {
    wireWorkbook('saveXlsx', 'saveStatus', 'corrected', workbook);
    wireCharts('png', 'saveStatus');
  },
};
