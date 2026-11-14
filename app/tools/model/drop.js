// The top of the model page: the drop box, the examples, the units of MODFLOW 6 files that
// did not give them, and what a model needs.
import { fromMf6 } from '../../../engine/model/mf6.js';
import { convertUnits } from '../../../engine/model/units.js';
import { countOf, el, errorBox, together } from '../../kit.js';
import { state } from '../../ui.js';
import { mf6Texts, readZip } from '../../zip.js';
import { convertKeepingGaps, editable } from './edit-model.js';

const EXAMPLES = [
  { id: 'm03', label: 'Example: a pumping well (m03)' },
  { id: 'm04', label: 'Example: three layers and every package (m04)' },
];

// The examples are a script, because the page's policy forbids network requests (as sample.js).
let examplesLoading = null;
function loadExamples() {
  if (window.CLEARWELL_MODELS) return Promise.resolve(window.CLEARWELL_MODELS);
  if (!examplesLoading) {
    examplesLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'model-examples.js';
      s.onload = () => resolve(window.CLEARWELL_MODELS);
      s.onerror = () => { examplesLoading = null; reject(new Error('The examples could not be loaded.')); };
      document.head.append(s);
    });
  }
  return examplesLoading;
}

// Files from a chooser or a drop: one saved model (.json), a zip of MODFLOW 6 files, or
// the MODFLOW 6 files themselves. Returns { model, name, kind }.
async function readModelFiles(files) {
  if (files.length === 1 && /\.json$/i.test(files[0].name)) {
    let json;
    try { json = JSON.parse(await files[0].text()); } catch { throw new Error(`${files[0].name} is not a JSON file this page can read.`); }
    return { model: editable(json), name: files[0].name, kind: 'json' };
  }
  let texts = {};
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    // Stored or deflated, and the files in a folder or not (zip.js).
    texts = mf6Texts(await readZip(new Uint8Array(await files[0].arrayBuffer())));
    if (!texts) throw new Error(`${files[0].name} holds no mfsim.nam, the MODFLOW 6 simulation file.`);
  } else {
    for (const f of files) texts[f.name] = await f.text();
    if (!Object.keys(texts).some((n) => /^mfsim\.nam$/i.test(n))) {
      throw new Error('The MODFLOW 6 files must include mfsim.nam, the simulation file. Choose all the model\'s files at once, or a zip of them.');
    }
    const key = Object.keys(texts).find((n) => /^mfsim\.nam$/i.test(n));
    if (key !== 'mfsim.nam') { texts = { ...texts, 'mfsim.nam': texts[key] }; }
  }
  return { model: editable(fromMf6(texts)), name: files.length === 1 ? files[0].name : `${files.length} MODFLOW 6 files`, kind: 'mf6' };
}

/** The drop box, the examples, the units panel and what a model needs; offers page.status, press, showNotes, showUnits and resetDrop. */
export function mountDrop(page) {
  // ---- drop box and examples ----
  const chooser = el('input', { type: 'file', multiple: true, hidden: true, accept: '.json,.zip,.nam,.tdis,.ims,.dis,.npf,.ic,.sto,.chd,.wel,.rch,.rcha,.riv,.drn,.ghb,.obs,.oc,.evt,.evta,.ts,.tas,.txt,.ref,.dat,.arr,.asc' });
  const problem = errorBox('');
  problem.hidden = true;
  const line = el('p', { class: 'hint loaded', role: 'status', hidden: true });
  const status = (text) => { line.textContent = text ? together(text) : ''; line.hidden = !text; };
  const exampleButtons = EXAMPLES.map((x, i) => el('button', {
    class: 'btn quiet', type: 'button', 'data-example': String(i), 'aria-pressed': 'false', disabled: true, onclick: () => useExample(x, i),
  }, x.label));
  const field0 = (label, input) => el('div', { class: 'field' }, el('label', { for: input.id }, label), input);
  const press = (i) => exampleButtons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
  page.root.append(el('section', { class: 'drop' },
    el('div', { class: 'strata', 'aria-hidden': 'true' }),
    el('div', {}, el('strong', {}, 'Drop a model anywhere on this page'),
      el('span', {}, 'A model saved from this page (.json), a zip of MODFLOW 6 files, or the MODFLOW 6 files themselves, all chosen at once. They are read in this browser and not uploaded.')),
    el('div', { class: 'drop-actions' }, chooser,
      el('button', { class: 'btn', type: 'button', onclick: () => chooser.click() }, 'Open a model'),
      exampleButtons)),
  problem, line);
  // Notes on how MODFLOW 6 files were read (fromMf6 and convertUnits), shown after the line.
  const notesList = el('ul', { class: 'notes model-notes', hidden: true });
  const showNotes = (list) => { notesList.replaceChildren(...(list || []).map((t) => el('li', {}, together(t)))); notesList.hidden = !(list && list.length); };
  // Units the files did not give: asked for before anything else, as nothing can run without them.
  const unitSel = {
    length: el('select', { id: 'mUnitLength' }, el('option', { value: '' }, 'Choose'), el('option', { value: 'METERS' }, 'Metres'), el('option', { value: 'FEET' }, 'Feet'), el('option', { value: 'CENTIMETERS' }, 'Centimetres')),
    time: el('select', { id: 'mUnitTime' }, el('option', { value: '' }, 'Choose'), el('option', { value: 'DAYS' }, 'Days'), el('option', { value: 'HOURS' }, 'Hours'), el('option', { value: 'MINUTES' }, 'Minutes'), el('option', { value: 'SECONDS' }, 'Seconds')),
  };
  const unitFields = { length: field0('Length unit of the files', unitSel.length), time: field0('Time unit of the files', unitSel.time) };
  const unitError = errorBox('');
  unitError.hidden = true;
  const unitsPanel = el('section', { class: 'panel model-units', 'aria-labelledby': 'mUnitsHead', hidden: true },
    el('h2', { id: 'mUnitsHead' }, 'Units of the MODFLOW 6 files'),
    el('p', { class: 'hint' }, 'MODFLOW 6 files may leave out LENGTH_UNITS or TIME_UNITS, and MODFLOW 6 then does no conversion. Say what the numbers in these files are in; the model is converted to metres and days, and runs once you have said.'),
    el('div', { class: 'fields' }, unitFields.length, unitFields.time),
    el('div', { class: 'btn-row' }, el('button', { class: 'btn', type: 'button', onclick: () => setUnits() }, 'Convert to metres and days')),
    unitError);
  page.root.append(notesList, unitsPanel);
  function showUnits() {
    const u = page.model && page.model.units;
    unitsPanel.hidden = !(u && (u.length === 'UNKNOWN' || u.time === 'UNKNOWN'));
    if (unitsPanel.hidden) return;
    unitFields.length.hidden = u.length !== 'UNKNOWN';
    unitFields.time.hidden = u.time !== 'UNKNOWN';
    unitSel.length.value = ''; unitSel.time.value = '';
    unitError.hidden = true;
  }
  function setUnits() {
    const u = page.model.units, choice = {};
    const gaps = [];
    if (u.length === 'UNKNOWN') { if (unitSel.length.value) choice.length = unitSel.length.value; else gaps.push('the length unit'); }
    if (u.time === 'UNKNOWN') { if (unitSel.time.value) choice.time = unitSel.time.value; else gaps.push('the time unit'); }
    if (gaps.length) { unitError.textContent = `Choose ${gaps.join(' and ')}.`; unitError.hidden = false; return; }
    const m = convertKeepingGaps(page.model, choice, convertUnits);
    // The notes that asked for a unit are answered now.
    if (m.notes) m.notes = m.notes.filter((t) => !/unit is not known/.test(t));
    const name = line.textContent;
    page.useModel(editable(m), null);
    status(name);
    showNotes(m.notes);
  }
  loadExamples().then(() => exampleButtons.forEach((b) => { b.disabled = false; }), (e) => { problem.textContent = e.message; problem.hidden = false; });

  async function takeFiles(files) {
    if (!files.length) return;
    let read;
    try {
      read = await readModelFiles(files);
    } catch (e) {
      const what = files.length === 1 ? files[0].name : 'The files';
      problem.textContent = `${what} could not be read. ${e.message}${page.model ? ' The model loaded before is still the one in use.' : ''}`;
      problem.hidden = false;
      return;
    }
    press(-1);
    page.useModel(read.model, null);
    const g = read.model.grid;
    const u = read.model.units;
    status(`${read.name}: ${countOf(g.nlay, 'layer', 'layers')}, ${g.nrow} rows × ${g.ncol} columns, ${countOf(read.model.periods.length, 'stress period', 'stress periods')}.${read.kind === 'mf6' ? ' Read from MODFLOW 6 files.' : ''}${u ? ' Say what units the files are in, below, before anything else.' : ''}`);
    showNotes(read.model.notes);
  }
  chooser.addEventListener('change', () => { takeFiles([...chooser.files]); chooser.value = ''; });
  state.extraDrop = (file, all) => takeFiles(all || [file]);

  function useExample(x, i) {
    const data = window.CLEARWELL_MODELS[x.id];
    press(i);
    page.useModel(editable(data.model), data);
    status(data.note);
    showNotes([]);
  }

  // ---- what a model needs ----
  const spec = el('details', { class: 'panel spec', open: true },
    el('summary', {}, 'What a model needs'),
    el('div', { class: 'tablewrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Part', 'Needed', 'What goes in it'].map((h) => el('th', {}, h)))),
      el('tbody', {}, [
        ['Grid', 'Required', 'A model name, the number of layers, and the cell widths along x and y: equal cells across an extent, or a list of widths for a telescoping grid.'],
        ['Layer tops and bottoms', 'Required', 'The top of the model and the bottom of each layer, in m: one value for a layer, or painted cell by cell.'],
        ['Cell type', 'Required', 'Each layer confined, or convertible (unconfined while the head is below its top).'],
        ['K and K33', 'Required', 'Horizontal and vertical hydraulic conductivity, in m/d, for every active cell.'],
        ['Ss and Sy', 'For transient periods', 'Specific storage, per m (0 or more), and specific yield (0 to 1), for every cell. MODFLOW 6 reads Sy for every layer, though only convertible layers use it.'],
        ['Starting heads', 'Required', 'In m. For a steady first period they are only where the solver starts, and drawdown is measured from the heads at the end of that period; for a transient first period they are the heads at time zero, and drawdown is measured from them.'],
        ['Stress periods', 'Required', 'For each period: its length in days, the number of time steps, the step multiplier, and steady or transient.'],
        ['Solver settings', 'Required', 'Outer and inner iterations, the head closure in m and the residual closure in m³/d, as MODFLOW 6 IMS takes them.'],
        ['Boundaries', 'Optional', 'Wells, constant-head cells, river cells, drains and general-head boundaries, drawn on the map with their values in each period. Recharge, in m/d, for each period.'],
        ['Observation points', 'Optional', 'Cells whose heads are plotted against time.'],
      ].map(([a, b, c]) => el('tr', {}, el('td', {}, a), el('td', { class: b === 'Optional' ? 'need-no' : 'need-yes' }, b), el('td', {}, c)))))),
    el('ul', { class: 'notes' },
      el('li', {}, 'Nothing is filled in for you. A value still needed is marked, and Run stays off until every value is given.'),
      el('li', {}, 'Units are metres and days throughout, as in the model JSON and the MODFLOW 6 files the page writes. A model read from MODFLOW 6 files in other units is converted to metres and days, and can also be written back in the units of its files.')));
  page.root.append(spec);

  // A new model: the message about the files before goes, and the list of needs folds.
  function resetDrop() {
    problem.hidden = true;
    spec.open = false;
  }

  Object.assign(page, { status, press, showNotes, showUnits, resetDrop });
}
