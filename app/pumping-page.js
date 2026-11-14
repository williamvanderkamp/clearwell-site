// The pumping test tool: removes background effects, then analyzes the test.
import { fixed, together, unit } from '../engine/format.js';
import { RATE_UNITS, detectPumping, pumpingTest, theisCurve } from '../engine/index.js';
import { parseStamp } from './read-file.js';
import { draw, resize } from './charts.js';
import { pumpingDefinitions } from './pumping-charts.js';
import { durationText, curveHeader, curveRows, extendedReach, reachText, resultCells, resultHeader, resultRows, tUnit } from './pumping-format.js';
import { describePumping } from './pumping-text.js';
import { buildPumpingWorkbook } from './workbook.js';
import { $, applyDetected, datesAmbiguous, isDayFirst, numberIn, renderMethod, renderNotes, showError, state, tideFields } from './ui.js';
import {
  chartHosts, chartImages, chosenColumns, column, efficiencyProblem, fillBody, resultPanels, siteProblem, stampTimes, wireCharts, wireWorkbook,
} from './well-page.js';

const panels = resultPanels(['pumpResults', 'pExtPanel', 'p1Panel', 'p2Panel', 'p3Panel', 'p4Panel', 'p5Panel', 'pumpMethodPanel']);
const ELAPSED_MS = { min: 60000, hour: 3600000, day: 86400000 };
const CHART_KEYS = ['extended', 'level', 'removed', 'diagnostic', 'semilog', 'recovery'];
const hosts = () => chartHosts(CHART_KEYS, 'chart-p-');

const pad = (n) => String(n).padStart(2, '0');
// YYYY-MM-DD HH:MM, with the seconds only when there are some.
function showStamp(ms) {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${pad(d.getUTCSeconds())}` : ''}`;
}

const elapsedKind = () => (ELAPSED_MS[$('timeKind').value] ? $('timeKind').value : null);

// Times as ms. Elapsed values count from the start of the test.
function readTimes(col) {
  const kind = elapsedKind();
  if (kind) return { t: column(col.time).map((v) => v * ELAPSED_MS[kind]) };
  const dayFirst = isDayFirst(col.time);
  return { t: stampTimes(col, dayFirst), dayFirst };
}

function readWhen(id, dayFirst) {
  const raw = $(id).value.trim();
  if (!raw) return undefined;
  const kind = elapsedKind();
  if (kind) { const v = parseFloat(raw); return Number.isFinite(v) ? v * ELAPSED_MS[kind] : NaN; }
  return parseStamp(raw, dayFirst);
}

// The level can suggest when the pump changed, but only the crew's log can say, so
// these are offered and never filled in.
function offer(id, words, ms) {
  const b = $(`${id}Offer`), kind = elapsedKind();
  b.hidden = !Number.isFinite(ms);
  b.dataset.value = kind ? String(ms / ELAPSED_MS[kind]) : showStamp(ms);
  b.textContent = `${words} ${b.dataset.value}. Use this`;
}

function offerTimes() {
  const col = chosenColumns(), levelKind = $('levelKind').value;
  // Only once the columns are chosen and the dates can be read one way.
  const undecided = elapsedKind() === null && datesAmbiguous(col.time) && !$('dateOrder').value;
  const known = $('timeKind').value && levelKind && col.time >= 0 && col.level >= 0 && !undecided;
  const sign = ['depth', 'drawdown'].includes(levelKind) ? -1 : 1;
  const found = known ? detectPumping(readTimes(col).t, column(col.level).map((x) => sign * x)) : {};
  offer('pumpStart', 'The level drops sharply at', found.start);
  offer('pumpStop', 'The level turns back at', found.stop);
}

// Entries that can't be right, named by their field. Returns the first problem, or ''.
function badEntry(pumpedWell) {
  const rate = numberIn('rate'), dist = numberIn('distance'), from = numberIn('fitFromMin'), to = numberIn('fitToMin');
  if (rate !== undefined && !(rate > 0)) return 'The pumping rate must be above zero.';
  if (!pumpedWell && dist !== undefined && !(dist > 0)) return 'The distance from the pumped well must be above zero.';
  const be = efficiencyProblem();
  if (be) return be;
  if (from !== undefined && from < 0) return '"Fit from, minutes of pumping" must be zero or more.';
  if (to !== undefined && !(to > 0)) return '"Fit to, minutes of pumping" must be above zero.';
  if (from !== undefined && to !== undefined && to <= from) return '"Fit to" must be later than "Fit from".';
  return siteProblem();
}

function run() {
  showError('');
  $('runError').hidden = true;
  const col = chosenColumns();
  const { t, dayFirst } = readTimes(col);
  if (t.filter(Number.isFinite).length < 4) {
    panels.fail('The time column could not be read. Choose the right column, and say whether it holds dates or elapsed time.');
    return;
  }
  const noStop = $('noStop').checked;
  const pumpStop = noStop ? undefined : readWhen('pumpStop', dayFirst);
  if (!noStop && !Number.isFinite(pumpStop)) {
    panels.fail('The time pumping stopped could not be read. Write it as YYYY-MM-DD HH:MM, or in the time unit of the file.');
    return;
  }
  const pumpedWell = $('wellType').value === 'pumped';
  const bad = badEntry(pumpedWell);
  if (bad) { panels.fail(bad); return; }
  const opts = {
    levelKind: $('levelKind').value, levelUnit: $('levelUnit').value, baroUnit: $('baroUnit').value,
    pumpStart: elapsedKind() ? 0 : readWhen('pumpStart', dayFirst), pumpStop,
    rate: numberIn('rate'), rateUnit: $('rateUnit').value, distance: pumpedWell ? undefined : numberIn('distance'), distanceUnit: $('distanceUnit').value,
    pumpedWell, userBE: numberIn('userBE'), lat: numberIn('lat'), lon: numberIn('lon'), utcOffsetHours: numberIn('utcOffset'),
    staticLevel: numberIn('staticLevel'), removeTrend: $('removeTrend').checked,
    fitFromMin: numberIn('fitFromMin'), fitToMin: numberIn('fitToMin'), elapsed: Boolean(elapsedKind()),
  };
  const { header } = state.table;
  try {
    const result = pumpingTest({ t, level: column(col.level), baro: col.baro >= 0 ? column(col.baro) : undefined }, opts);
    state.result = result;
    state.col = col;
    state.text = describePumping(result, {
      fileName: state.name, sheetName: state.sheets.length > 1 ? state.sheet.name : '',
      levelName: header[col.level], baroName: col.baro >= 0 ? header[col.baro] : '',
    });
    render();
  } catch (e) {
    panels.fail(e.message);
  }
}

// These tables' headings change with the units, so they are written here too.
function fillTable(table, header, rows) {
  table.tHead.textContent = '';
  const head = table.tHead.insertRow();
  header.forEach((h) => { const th = document.createElement('th'); th.textContent = h; head.append(th); });
  fillBody(table, rows.map((row) => row.map((v) => (v === null ? '—' : v))));
}

function renderSummary(r) {
  fillTable($('pumpSummary'), resultHeader(r), resultCells(r));
  $('rawNote').hidden = !r.rawAnalysis;
  const m = r.method, b = m.background;
  const be = fixed(b.be, 3, ''), days = fixed(m.pretestDays, 1, '');
  // When nothing was removed, or there is no stop time, the notes under the table say
  // so and why, so the lead does not say it again.
  const mode = {
    none: '',
    user: `Your barometric efficiency of ${be} was applied.`,
    constant: `A constant barometric efficiency of ${be} was fitted on the ${days} days before pumping.`,
    response: `A barometric response function reaching ${be} was fitted on the ${days} days before pumping${b.tide && b.tide.used ? ', with the earth tide' : ''}.`,
  }[b.mode];
  const ext = r.analysis.extended;
  const reach = ext && ext.t.length
    ? ` Recovery extends the ${durationText(m.durationDays)} of pumping to an effective ${durationText(ext.t[ext.t.length - 1])}.`
    : Number.isFinite(m.stop) ? '' : ' If levels were measured after the pump stopped, enter the stop time to add the recovery analysis.';
  $('pumpLead').textContent = together(`${mode}${reach} T is in ${tUnit(m)}.`.trim());
}

function render() {
  const r = state.result;
  panels.show();
  $('p2Panel').hidden = !r.baroEffect;
  $('p5Panel').hidden = !(r.analysis.recoveryBins && r.analysis.recoveryBins.t.length);
  const reach = extendedReach(r);
  $('pExtPanel').hidden = !reach;
  if (reach) fillTable($('pumpReach'), reach.header, reach.rows.map(([label, ...values]) => [label, ...values.map(reachText)]));
  renderSummary(r);
  renderNotes($('pumpNotes'), r.warnings.map(together));
  renderMethod($('pumpMethod'), state.text);
  $('pumpSaveStatus').textContent = '';
  draw(r, hosts(), pumpingDefinitions);
}

async function workbook() {
  const r = state.result;
  // Only the charts this result has: what was removed, extended drawdown and recovery
  // are there only when the test gives them.
  const defs = pumpingDefinitions(r, { axis: '#000', grid: '#000' });
  const images = await chartImages(r, CHART_KEYS.filter((k) => defs[k]), pumpingDefinitions);
  const theis = r.analysis.theis ? theisCurve(r.analysis.theis, r.analysis.pump.t) : null;
  const sheets = { results: { header: resultHeader(r), rows: resultRows(r) }, curves: { header: curveHeader(r), rows: curveRows(r, theis) } };
  return buildPumpingWorkbook(window.ExcelJS, r, state.text, sheets, state.table, state.col, images);
}

export const pumping = {
  title: 'Analyze a pumping test',
  lede: 'Removes barometric effects using the record before pumping, then gives drawdown, transmissivity, storativity and a recovery analysis by published methods, including extended drawdown from recovery.',
  dropText: 'Excel or CSV, with the columns below.',
  samples: [
    {
      id: 'demo', label: 'Example with a known answer', file: 'pumping-samples.js', read: () => window.CLEARWELL_PUMPING && window.CLEARWELL_PUMPING.demo,
      note: together('Invented test: computed drawdown with T = 250 m²/d and S = 2.00 × 10⁻⁴, seen through a real barometer (Rockford, Illinois) at a barometric efficiency of 0.35. The rate is 129.6 m³/d at 60 m.'),
    },
    {
      id: 'textbook', label: 'Real textbook test', file: 'pumping-samples.js', read: () => window.CLEARWELL_PUMPING && window.CLEARWELL_PUMPING.textbook,
      note: together('Real data: Oude Korendijk, piezometer H30, 788 m³/d at 30 m, from Kruseman and de Ridder (1994), Table 3.1. The book gets T = 385 m²/d and S = 1.7 × 10⁻⁴ from a line through the readings from 1.4 to 13.1 minutes. Try that window: Fit from 1.4 and Fit to 13.1 minutes of pumping.'),
    },
  ],
  hide: panels.hide,
  run,
  resize() { if (state.result) resize(hosts()); },
  redraw() { if (state.result) draw(state.result, hosts(), pumpingDefinitions); },
  fresh(site) {
    const given = ['rate', 'rateUnit', 'distance', 'distanceUnit', 'wellType', 'pumpStart', 'pumpStop'];
    [...given, 'staticLevel', 'fitFromMin', 'fitToMin'].forEach((id) => { $(id).value = (site && site[id]) || ''; });
    $('removeTrend').checked = false;
    $('noStop').checked = Boolean(site && site.noStop);
  },
  start() {
    const d = applyDetected();
    $('timeKind').value = d.timeKind;
    offerTimes();
  },
  // Shows the fields that apply, and returns those that must be filled.
  required() {
    const elapsed = elapsedKind(), pumped = $('wellType').value === 'pumped', noBaro = $('colBaro').value === '-1', noStop = $('noStop').checked;
    const ambiguous = $('timeKind').value === 'date' && datesAmbiguous(+$('colTime').value);
    $('dateOrderField').hidden = !ambiguous;
    $('pumpStartField').hidden = Boolean(elapsed);
    $('colTime2Field').hidden = Boolean(elapsed);
    $('distanceField').hidden = pumped;
    $('distanceUnitField').hidden = pumped;
    $('baroUnitField').hidden = noBaro;
    $('pumpStop').disabled = noStop;
    $('pumpStop').placeholder = elapsed ? `${{ min: 'Minutes', hour: 'Hours', day: 'Days' }[elapsed]} since pumping began` : 'YYYY-MM-DD HH:MM';
    return [
      'colTime', 'timeKind', ...(ambiguous ? ['dateOrder'] : []), 'colLevel', 'levelKind', 'levelUnit',
      ...(elapsed ? [] : ['pumpStart']), ...(noStop ? [] : ['pumpStop']), 'rate', 'rateUnit', 'wellType',
      ...(pumped ? [] : ['distance', 'distanceUnit']), ...(noBaro ? [] : ['baroUnit']), ...tideFields(),
    ];
  },
  wire() {
    Object.keys(RATE_UNITS).forEach((u) => $('rateUnit').add(new Option(unit(u), u)));
    const reoffer = () => { if (state.view === 'pumping' && state.table) offerTimes(); };
    ['timeKind', 'dateOrder', 'levelKind', 'colTime', 'colLevel'].forEach((id) => $(id).addEventListener('change', reoffer));
    ['pumpStart', 'pumpStop'].forEach((id) => $(`${id}Offer`).addEventListener('click', (e) => {
      $(id).value = e.target.dataset.value;
      $(id).dispatchEvent(new Event('input', { bubbles: true }));
    }));
    wireWorkbook('pumpSaveXlsx', 'pumpSaveStatus', 'pumping-test', workbook);
    wireCharts('pump-png', 'pumpSaveStatus', pumpingDefinitions);
  },
};
