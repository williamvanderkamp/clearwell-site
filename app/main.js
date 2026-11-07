// The front page, and everything that gets a file to the chosen tool. The file is read
// and processed in this browser.
import { LEVEL_UNITS, BARO_UNITS } from './columns.js';
import { parseDelimited, readWorkbook, tidyTable } from './read-file.js';
import { $, checkRequired, showError, state } from './ui.js';
import { pumping } from './pumping-page.js';
import { record } from './record.js';
import { SPEC } from './spec.js';
import { EXTRA_TOOLS } from './tools/index.js';
import { el } from './kit.js';
import { together } from './format.js';

const TOOLS = { record, pumping };
const EXTRA = Object.fromEntries(EXTRA_TOOLS.map((t) => [t.id, t]));
// The front page groups, in the order a hydrogeologist would look. The first two tools'
// cards are in index.html; the others are added here. A tool missing from this list
// still appears, under "More tools".
const GROUPS = {
  tests: ['pumping', 'distance', 'leaky', 'unconfined', 'step', 'slug', 'predict'],
  levels: ['record', 'logger', 'recharge', 'trend'],
  properties: ['chem', 'grainsize'],
};
const tool = () => TOOLS[state.view];
const ready = () => checkRequired(tool().required());

// The status line under the drop box, as on every other tool: the file and its rows,
// then for an example its note.
function sayLoaded() {
  const note = $('exampleNote');
  note.textContent = together(`${state.name}${state.sheets.length > 1 ? `, sheet ${state.sheet.name}` : ''}: ${state.table.rows.length} rows.${state.site ? ` ${state.site.note}` : ''}`);
  note.hidden = false;
}

// The chosen example is shown pressed; a file of the user's own un-presses them all.
function pressSample(id) {
  $('samples').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === id)));
}

function useSheet(sheet) {
  state.sheet = sheet;
  state.table = tidyTable(sheet.rows);
  state.result = null;
  sayLoaded();
  tool().hide();
  $('setup').hidden = false;
  tool().start();
  if (ready()) tool().run();
}

function load(sheets, name, site) {
  $('runError').hidden = true;
  state.name = name;
  state.sheets = sheets;
  $('setupTitle').textContent = name;
  $('spec').open = false;
  const sel = $('sheet');
  sel.textContent = '';
  sheets.forEach((s, i) => sel.add(new Option(s.name, String(i))));
  $('sheetField').hidden = sheets.length < 2;
  $('userBE').value = '';
  $('dateOrder').value = '';
  tool().fresh(site);
  $('lat').value = site && site.lat !== undefined ? site.lat : '';
  $('lon').value = site && site.lon !== undefined ? site.lon : '';
  state.site = site;
  pressSample(null);
  useSheet(sheets[0]);
}

async function handleFile(file) {
  showError('');
  if (EXTRA[state.view]) { if (state.extraDrop) state.extraDrop(file); return; }
  if (!tool()) { $('homeError').textContent = 'Choose a tool first, then drop the file on its page.'; $('homeError').hidden = false; return; }
  try {
    const isText = /\.(csv|tsv|txt|dat)$/i.test(file.name);
    const sheets = isText
      ? [{ name: file.name, rows: parseDelimited(await file.text()), date1904: false }]
      : readWorkbook(await file.arrayBuffer(), window.XLSX);
    if (!sheets.length || sheets[0].rows.length < 3) throw new Error('This file looks empty.');
    load(sheets, file.name, null);
  } catch (e) {
    // The same words as the other tools' drop boxes, and nothing loaded before is lost.
    showError(`${file.name} could not be read. ${e.message}${state.table ? ' The data loaded before it is still the data in use.' : ''}`);
  }
}
state.handleFile = handleFile;

// Samples are scripts, because this page's policy forbids all network requests.
function loadSample(sample) {
  const open = () => {
    const s = sample.read();
    load([{ name: 'sample', rows: parseDelimited(s.csv), date1904: false }], s.name, { ...s, note: sample.note });
    pressSample(sample.id || 'default');
  };
  if (sample.read()) { open(); return; }
  const s = document.createElement('script');
  s.src = sample.file;
  s.onload = open;
  document.head.append(s);
}

function showSamples(t) {
  const host = $('samples');
  host.textContent = '';
  t.samples.forEach((sample) => {
    const b = document.createElement('button');
    b.className = 'btn quiet';
    b.type = 'button';
    b.dataset.sample = sample.id || 'default';
    b.setAttribute('aria-pressed', 'false');
    b.textContent = sample.label;
    b.addEventListener('click', () => loadSample(sample));
    host.append(b);
  });
}

function showSpec() {
  const spec = SPEC[state.view];
  const body = $('specTable').tBodies[0];
  body.textContent = '';
  spec.columns.forEach((c) => {
    const row = body.insertRow();
    row.insertCell().textContent = c.name;
    const need = row.insertCell();
    need.textContent = c.need;
    need.className = c.need === 'Required' ? 'need-yes' : 'need-no';
    row.insertCell().textContent = c.what;
    row.insertCell().append(...c.headings.map((h) => { const e = document.createElement('code'); e.textContent = h; return e; }));
  });
  $('specNotes').textContent = '';
  spec.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; $('specNotes').append(li); });
  $('specExamples').textContent = '';
  spec.examples.forEach((x) => {
    const a = document.createElement('a');
    a.className = 'btn quiet';
    a.href = `examples/${x.file}`;
    a.download = x.file;
    a.textContent = x.label;
    $('specExamples').append(a);
  });
  $('spec').open = true;
}

function showExtra(t) {
  $('extraTitle').textContent = t.title;
  $('extraLede').textContent = t.lede;
  const host = $('extraHost');
  host.textContent = '';
  delete host.dataset.done;
  t.mount(host);
}

function route() {
  const name = location.hash.slice(1);
  state.view = TOOLS[name] || EXTRA[name] ? name : 'home';
  Object.assign(state, { name: '', sheets: [], sheet: null, table: null, result: null, text: null, extraDrop: null, site: null });
  $('exampleNote').hidden = true;
  $('exampleNote').textContent = '';
  document.body.dataset.view = EXTRA[name] ? 'extra' : state.view;
  showError('');
  $('runError').hidden = true;
  $('homeError').hidden = true;
  delete document.body.dataset.stale;
  $('home').hidden = state.view !== 'home';
  $('footBack').hidden = state.view === 'home';
  $('tool').hidden = state.view === 'home' || Boolean(EXTRA[name]);
  $('extraTool').hidden = !EXTRA[name];
  // Hide the first two tools' setup and results on every route, so none of it is left
  // on another tool's page after the back button.
  $('setup').hidden = true;
  Object.values(TOOLS).forEach((t) => t.hide());
  if (EXTRA[name]) { document.title = `${EXTRA[name].title}, Clearwell`; showExtra(EXTRA[name]); window.scrollTo(0, 0); return; }
  const t = tool();
  document.title = t ? `${t.title}, Clearwell` : 'Clearwell';
  if (t) {
    if (state.view === 'record') $('requiredFields').append($('baroField'), $('baroUnitField'));
    else $('optionalFields').prepend($('baroField'), $('baroUnitField'));
    $('toolTitle').textContent = t.title;
    $('toolLede').textContent = t.lede;
    $('dropText').textContent = t.dropText;
    showSamples(t);
    showSpec();
  }
  window.scrollTo(0, 0);
}

const card = (t) => el('a', { class: 'choice', href: `#${t.id}`, 'data-extra': t.id },
  el('div', { class: 'strata', 'aria-hidden': 'true' }),
  el('div', { class: 'stack' }, el('h3', {}, t.title), el('p', {}, t.blurb), el('span', { class: 'btn choice-go' }, 'Open')));
const grouped = new Set(Object.values(GROUPS).flat());
for (const [group, ids] of Object.entries(GROUPS)) {
  document.querySelector(`[data-group="${group}"]`).append(...ids.filter((id) => EXTRA[id]).map((id) => card(EXTRA[id])));
}
const others = EXTRA_TOOLS.filter((t) => !grouped.has(t.id));
document.querySelector('[data-group="other"]').append(...others.map(card));
document.querySelector('[data-group="other"]').closest('section').hidden = !others.length;
LEVEL_UNITS.forEach((u) => $('levelUnit').add(new Option(u, u)));
BARO_UNITS.forEach((u) => $('baroUnit').add(new Option(u, u)));
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
$('run').addEventListener('click', () => tool().run());
// Editing the settings after a run dims the results until Run is pressed again, as on
// the other tools, even while a field is empty or not a number: Run stays off until it
// is put right. Results are taken away only by a new file or a run that fails.
$('setup').addEventListener('input', () => {
  $('runError').hidden = true;
  ready();
  if (state.result) document.body.dataset.stale = '1';
});
$('sheet').addEventListener('change', (e) => useSheet(state.sheets[+e.target.value]));
Object.values(TOOLS).forEach((t) => t.wire());

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) handleFile(f);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (tool()) tool().resize(); }, 150);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (tool()) tool().redraw(); });
window.addEventListener('hashchange', route);
route();
