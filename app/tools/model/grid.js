// The model page's grid: the model name, the number of layers and the cell widths, and a
// new grid made from them, which starts an empty model.
import { countOf, el, errorBox, together } from '../../kit.js';
import { edges, newModel, parseWidths, uniformWidths, widthsToText } from './edit-model.js';
import { field, metres, num } from './common.js';

/** The grid panel; offers page.fillGridForm, markGrid and resetGrid. */
export function mountGrid(page) {
  const gridError = errorBox('');
  gridError.hidden = true;
  const gi = {
    name: el('input', { id: 'mName', autocomplete: 'off', spellcheck: 'false' }),
    nlay: el('input', { id: 'mNlay', inputmode: 'numeric' }),
    mode: el('select', { id: 'mMode' }, el('option', { value: '' }, 'Choose'), el('option', { value: 'equal' }, 'Equal cells across an extent'), el('option', { value: 'list' }, 'A list of widths')),
    xExtent: el('input', { id: 'mXext', inputmode: 'decimal' }), xSize: el('input', { id: 'mXsize', inputmode: 'decimal' }),
    yExtent: el('input', { id: 'mYext', inputmode: 'decimal' }), ySize: el('input', { id: 'mYsize', inputmode: 'decimal' }),
    delr: el('textarea', { id: 'mDelr', rows: 2, spellcheck: 'false' }), delc: el('textarea', { id: 'mDelc', rows: 2, spellcheck: 'false' }),
  };
  const equalBox = el('div', { class: 'fields' },
    field('Extent along x, west to east (m)', gi.xExtent), field('Cell width along x (m)', gi.xSize),
    field('Extent along y, north to south (m)', gi.yExtent), field('Cell width along y (m)', gi.ySize));
  const listBox = el('div', { class: 'fields' },
    field('Column widths, west to east (m)', gi.delr, 'Such as 100, 50, 20*10, 50, 100, where 20*10 is 20 columns of 10 m.'),
    field('Row widths, north to south (m)', gi.delc, 'Row 1 is the northern edge, as in MODFLOW 6.'));
  const gridSummary = el('p', { class: 'hint' });
  const confirmBox = el('div', { class: 'model-confirm', hidden: true },
    el('p', {}, 'A new grid starts an empty model: the values, boundaries and results of the model now open are not kept. Save it first if you want it.'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', type: 'button', onclick: () => makeGrid(true) }, 'Make the new grid'),
      el('button', { class: 'btn quiet', type: 'button', onclick: () => { confirmBox.hidden = true; } }, 'Keep this model')));
  const showMode = () => { equalBox.hidden = gi.mode.value !== 'equal'; listBox.hidden = gi.mode.value !== 'list'; };
  gi.mode.addEventListener('change', showMode);
  gi.name.addEventListener('input', () => { if (page.model) { page.model.name = gi.name.value.trim() || null; page.edited(); } });
  page.root.append(el('section', { class: 'panel model-grid', 'aria-labelledby': 'mGridHead' },
    el('div', { class: 'chart-head' }, el('h2', { id: 'mGridHead' }, 'Grid'), gridSummary),
    el('div', { class: 'fields' },
      field('Model name', gi.name, '1 to 16 letters, digits, _, . or -, as MODFLOW 6 takes.'),
      field('Layers', gi.nlay), field('Cell sizes', gi.mode)),
    equalBox, listBox,
    el('div', { class: 'btn-row' }, el('button', { class: 'btn', type: 'button', onclick: () => makeGrid(false) }, 'Make the grid')),
    confirmBox, gridError));
  showMode();

  function makeGrid(confirmed) {
    gridError.hidden = true;
    try {
      const nlay = num(gi.nlay.value);
      if (nlay === undefined) throw new Error('Layers: give the number of layers.');
      if (!Number.isInteger(nlay) || nlay < 1) throw new Error('Layers must be a whole number of at least 1.');
      let delr, delc;
      if (gi.mode.value === 'equal') {
        const vals = [gi.xExtent, gi.xSize, gi.yExtent, gi.ySize].map((x) => num(x.value));
        if (vals.some((v) => v === undefined)) throw new Error('Give both extents and both cell widths.');
        if (vals.some((v) => Number.isNaN(v))) throw new Error('The extents and cell widths must be numbers.');
        delr = uniformWidths(vals[0], vals[1], 'Along x');
        delc = uniformWidths(vals[2], vals[3], 'Along y');
      } else if (gi.mode.value === 'list') {
        delr = parseWidths(gi.delr.value, 'Column widths');
        delc = parseWidths(gi.delc.value, 'Row widths');
      } else throw new Error('Cell sizes: choose equal cells or a list of widths.');
      const m = newModel({ name: gi.name.value.trim() || null, nlay, delr, delc });
      if (page.model && !confirmed) { confirmBox.hidden = false; return; }
      confirmBox.hidden = true;
      page.press(-1);
      page.useModel(m, null);
      page.showNotes([]);
      page.status(`New grid: ${countOf(nlay, 'layer', 'layers')}, ${delc.length} rows × ${delr.length} columns. Give the layers' values below, then the periods and the solver settings.`);
    } catch (e) {
      gridError.textContent = e.message;
      gridError.hidden = false;
    }
  }

  function fillGridForm(m) {
    gi.name.value = m.name || '';
    gi.nlay.value = String(m.grid.nlay);
    const even = (w) => w.every((x) => x === w[0]);
    if (even(m.grid.delr) && even(m.grid.delc)) {
      gi.mode.value = 'equal';
      const c = edges(m.grid.delr), r = edges(m.grid.delc);
      gi.xExtent.value = String(Number(c[c.length - 1].toPrecision(12))); gi.xSize.value = String(m.grid.delr[0]);
      gi.yExtent.value = String(Number(r[r.length - 1].toPrecision(12))); gi.ySize.value = String(m.grid.delc[0]);
    } else {
      gi.mode.value = 'list';
      gi.delr.value = widthsToText(m.grid.delr);
      gi.delc.value = widthsToText(m.grid.delc);
    }
    showMode();
    const c = page.centres();
    gridSummary.textContent = together(`${m.grid.nrow} rows × ${m.grid.ncol} columns × ${countOf(m.grid.nlay, 'layer', 'layers')}, ${metres(c.W)} by ${metres(c.H)}.`);
  }

  // The model name is marked when it is missing or not one MODFLOW 6 takes.
  function markGrid(wrong) {
    gi.name.closest('.field').classList.toggle('missing', !page.model.name || wrong.some((w) => w.field && w.field.name));
    gi.name.classList.toggle('bad', wrong.some((w) => w.field && w.field.name));
  }

  // A new model: the grid's message and the question before a new grid go.
  function resetGrid() {
    gridError.hidden = true;
    confirmBox.hidden = true;
  }

  Object.assign(page, { fillGridForm, markGrid, resetGrid });
}
