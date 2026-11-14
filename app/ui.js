// What both tools share: the page state, the settings panel and the method text.
import { detect } from './columns.js';
import { detectDayFirst } from './read-file.js';

export const $ = (id) => document.getElementById(id);
export const state = { view: 'home', name: '', sheets: [], sheet: null, table: null, detected: null, result: null, text: null, col: null };
window.clearwell = state; // for the browser tests

export function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function fillSelect(id, value, blank) {
  const sel = $(id);
  sel.textContent = '';
  sel.add(new Option(blank, '-1'));
  state.table.header.forEach((h, i) => sel.add(new Option(h || `Column ${i + 1}`, String(i))));
  sel.value = String(value);
}

export function applyDetected() {
  const d = detect(state.table.header, state.table.rows);
  state.detected = d;
  fillSelect('colTime', d.time, 'Choose a column');
  fillSelect('colTime2', d.time2, 'None');
  fillSelect('colLevel', d.level, 'Choose a column');
  fillSelect('colBaro', d.baro, state.view === 'record' ? 'Choose a column' : 'None');
  $('levelKind').value = d.levelKind === 'drawdown' && state.view === 'record' ? 'depth' : d.levelKind;
  $('levelUnit').value = d.levelUnit;
  $('baroUnit').value = d.baroUnit;
  $('utcOffset').value = d.utcClock ? '0' : '';
  return d;
}

// The whole entry must be a number: 250abc is not read as 250.
export const numberIn = (id) => { const s = $(id).value.trim(); const v = s === '' ? NaN : Number(s); return Number.isFinite(v) ? v : undefined; };

const isEmpty = (id) => ($(id).inputMode === 'decimal' ? numberIn(id) === undefined : ['', '-1'].includes($(id).value.trim()));
const labelOf = (id) => document.querySelector(`label[for="${id}"]`).textContent;

// Run stays off until every required field has a value and every number field that has
// anything typed in it holds a number, required or not. The page names the fields, as
// the other tools' forms do: 12abc is "Not a number", not silently left out.
export function checkRequired(ids) {
  document.querySelectorAll('.field.missing').forEach((f) => f.classList.remove('missing'));
  const shown = (e) => e.offsetParent !== null;
  const notNumbers = [...document.querySelectorAll('#setup input[inputmode="decimal"]')]
    .filter((e) => shown(e) && e.value.trim() !== '' && numberIn(e.id) === undefined).map((e) => e.id);
  const empty = ids.filter((id) => isEmpty(id) && !notNumbers.includes(id));
  [...empty, ...notNumbers].forEach((id) => $(id).closest('.field').classList.add('missing'));
  const say = [];
  if (empty.length) say.push(`Still needed: ${empty.map(labelOf).join('; ')}.`);
  if (notNumbers.length) say.push(`Not a number: ${notNumbers.map(labelOf).join('; ')}.`);
  $('needed').textContent = say.join(' ');
  $('run').disabled = empty.length + notNumbers.length > 0;
  return !$('run').disabled;
}

// The earth tide is optional, but it takes all three or none.
export const tideFields = () => (numberIn('lat') !== undefined || numberIn('lon') !== undefined ? ['lat', 'lon', 'utcOffset'] : []);

const dateValues = (col) => state.table.rows.map((r) => r[col]);
export const datesAmbiguous = (col) => col >= 0 && detectDayFirst(dateValues(col)) === null;
export function isDayFirst(col) {
  const found = detectDayFirst(dateValues(col));
  return found === null ? $('dateOrder').value === 'dmy' : found;
}

export function renderMethod(host, text) {
  host.textContent = '';
  const list = document.createElement('ol');
  list.className = 'steps';
  for (const s of text.steps) {
    const li = document.createElement('li');
    const h = document.createElement('h3');
    h.textContent = s.title;
    li.append(h);
    for (const l of s.lines) { const p = document.createElement('p'); p.textContent = l; li.append(p); }
    if (s.formula) { const pre = document.createElement('pre'); pre.textContent = s.formula; li.append(pre); }
    if (s.numbers.length) {
      const dl = document.createElement('dl');
      for (const [k, v] of s.numbers) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
      }
      li.append(dl);
    }
    list.append(li);
  }
  host.append(list);
  // One reference to a line, under its own heading, so a long list can be read.
  if (!text.references.length) return;
  const head = document.createElement('h3');
  head.className = 'refs-head';
  head.textContent = 'References';
  const refs = document.createElement('ul');
  refs.className = 'refs';
  for (const r of text.references) { const li = document.createElement('li'); li.textContent = r; refs.append(li); }
  host.append(head, refs);
}

export function renderNotes(host, warnings) {
  host.textContent = '';
  warnings.forEach((w) => { const li = document.createElement('li'); li.textContent = w; host.append(li); });
  host.hidden = !warnings.length;
}

export function saveFile(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export const baseName = () => state.name.replace(/\.[^.]+$/, '') || 'well-record';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
