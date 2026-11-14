// The well record's further measured inputs: one row of fields for each, added and
// taken away by the user. Nothing in a row is filled in but the unit, and that only
// when the column's heading states it.
import { INPUT_ACTIONS, INPUT_KINDS, INPUT_LENGTH_UNITS } from '../engine/index.js';
import { unitInLabel } from './columns.js';
import { el } from './kit.js';
import { $, numberIn, state } from './ui.js';
import { column } from './well-page.js';

let made = 0;
const rows = () => [...$('inputsHost').querySelectorAll('.input-row')];
const ids = (row) => ['Col', 'Kind', 'Unit', 'Lag', 'Action'].map((k) => `${row.dataset.input}${k}`);
// Editing the inputs changes the form as typing does: Run is checked again and the last
// results are dimmed.
const changed = () => $('setup').dispatchEvent(new Event('input', { bubbles: true }));

function options(sel, pairs) {
  pairs.forEach(([value, text]) => sel.add(new Option(text, value)));
  return sel;
}

// Labels carry the row's number, so "Still needed" can say which input it means.
function renumber() {
  rows().forEach((row, n) => {
    const [col, kind, unit, lag, action] = ids(row);
    const say = { [col]: 'column', [kind]: 'is', [unit]: 'unit', [lag]: 'lag length (hours)', [action]: 'what to do' };
    for (const [id, words] of Object.entries(say)) row.querySelector(`label[for="${id}"]`).textContent = `Input ${n + 1} ${words}`;
    row.querySelector('.input-drop').textContent = `Take away input ${n + 1}`;
  });
}

/** Adds a row of fields. preset, from a built-in example, names the column and the rest. */
export function addInput(preset = {}) {
  const id = `input${made++}`;
  const field = (key, control) => el('div', { class: 'field' }, el('label', { for: `${id}${key}` }), control);
  const col = el('select', { id: `${id}Col` });
  col.add(new Option('Choose a column', '-1'));
  state.table.header.forEach((h, i) => col.add(new Option(h || `Column ${i + 1}`, String(i))));
  const kind = options(el('select', { id: `${id}Kind` }), [['', 'Choose'], ...Object.entries(INPUT_KINDS).map(([k, v]) => [k, k === 'amount' ? `${v}, such as rain` : `${v}, such as a stage`])]);
  const unit = options(el('select', { id: `${id}Unit` }), [['', 'Choose'], ...INPUT_LENGTH_UNITS.map((u) => [u, u]), ['none', 'Not a length: per unit of the column']]);
  const lag = el('input', { id: `${id}Lag`, inputmode: 'decimal', placeholder: 'Hours' });
  const action = options(el('select', { id: `${id}Action` }), [['', 'Choose'], ...Object.entries(INPUT_ACTIONS)]);
  // The unit is taken from the heading when it names a length, as the level's is.
  col.addEventListener('change', () => { unit.value = unitInLabel(state.table.header[+col.value] || '', INPUT_LENGTH_UNITS) || ''; });
  const drop = el('button', { class: 'btn quiet small input-drop', type: 'button', onclick: () => { row.remove(); renumber(); changed(); } });
  const row = el('div', { class: 'fields input-row', 'data-input': id },
    field('Col', col), field('Kind', kind), field('Unit', unit), field('Lag', lag), field('Action', action), drop);
  $('inputsHost').append(row);
  if (preset.column !== undefined) {
    col.value = String(state.table.header.indexOf(preset.column));
    col.dispatchEvent(new Event('change'));
    kind.value = preset.kind;
    lag.value = String(preset.lagHours);
    action.value = preset.action;
  }
  renumber();
}

/** Takes every input away, as a new file does. */
export function clearInputs() { $('inputsHost').textContent = ''; }

/** The ids of every input field, all of which must be filled. */
export const inputFieldIds = () => rows().flatMap(ids);

/** The first input entry that can't be right, or ''. */
export function inputProblem(col) {
  const taken = new Map([[col.time, 'the time column'], [col.time2, 'the separate time column'], [col.level, 'the water level column'], [col.baro, 'the barometer column']]);
  for (const [n, row] of rows().entries()) {
    const [c, , , lag] = ids(row);
    const i = +$(c).value;
    if (i < 0) continue;
    if (taken.has(i)) return `Input ${n + 1} is ${taken.get(i)}. Choose another column.`;
    taken.set(i, `already input ${n + 1}`);
    if (numberIn(lag) !== undefined && numberIn(lag) < 0) return `Input ${n + 1} lag length must be 0 hours or more.`;
  }
  return '';
}

/** What correct() takes, one entry for each input. */
export const inputSpecs = () => rows().map((row) => {
  const [c, kind, unit, lag, action] = ids(row);
  const i = +$(c).value;
  return { name: state.table.header[i] || `Column ${i + 1}`, values: column(i), kind: $(kind).value, unit: $(unit).value === 'none' ? '' : $(unit).value, lagHours: numberIn(lag), action: $(action).value };
});

export function wireInputs() {
  $('addInput').addEventListener('click', () => { addInput(); changed(); });
}
