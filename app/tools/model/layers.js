// The model page's layers: the top of the model, each layer's cell type, bottom, K, K22,
// K33, Ss, Sy and starting head, and the options of STO and NPF.
import { el, together } from '../../kit.js';
import { describe, layerValue, PROPS, setLayerValue, ssKindText } from './edit-model.js';
import { field, num, tiny, withUnit } from './common.js';

const LAYER_PROPS = ['botm', 'k', 'k22', 'k33', 'ss', 'sy', 'strt'];

// A number field for a value that may instead be painted. Empty leaves painted values alone.
export function numberInput(page, input, label, get, set) {
  input.addEventListener('input', () => {
    const v = num(input.value);
    const now = get();
    if (Number.isNaN(v)) { page.notNumbers.set(label, true); input.classList.add('bad'); } else {
      page.notNumbers.delete(label); input.classList.remove('bad');
      if (v === undefined) { if (!Array.isArray(now)) set(null); } else set(v);
    }
    page.edited();
  });
}

/** The layers panel; offers page.buildLayers, fillLayerInputs, showWords, markLayers and resetLayers. */
export function mountLayers(page) {
  const topInput = el('input', { id: 'mTop', inputmode: 'decimal' });
  const layersBody = el('tbody');
  // Very small or large values as the page writes them, since a field shows 1e-10 or 0.00001
  // as typed: "Ss of layer 1: 1 × 10⁻⁵ per m".
  const layerWords = el('p', { class: 'hint', hidden: true });
  function showWords() {
    const { model } = page;
    if (!model) return;
    const say = [];
    for (let k = 0; k < model.grid.nlay; k++) {
      for (const p of LAYER_PROPS) {
        const v = layerValue(model, p, k);
        const coef = p === 'ss' && model.sto.storagecoefficient;
        if (tiny(v)) say.push(`${coef ? 'S' : PROPS[p].label} of layer ${k + 1} is ${withUnit(v, coef ? '' : PROPS[p].unit)}`);
      }
    }
    layerWords.textContent = say.length ? together(`In powers of ten: ${say.join('; ')}.`) : '';
    layerWords.hidden = !say.length;
  }
  const layerInputs = [];
  const k33Button = el('button', { class: 'btn quiet small', type: 'button', onclick: () => {
    const { model } = page;
    for (let k = 0; k < model.grid.nlay; k++) { const v = model.npf.k[k]; model.npf.k33[k] = Array.isArray(v) ? v.slice() : v; }
    page.edited(); fillLayerInputs();
  } }, 'Set K33 equal to K in every layer');
  // STO's options: SS read as the storage coefficient, and Ss in a convertible cell only while full.
  const ssKind = el('select', { id: 'mSsKind' }, el('option', { value: 'ss' }, 'Specific storage Ss, per m (MODFLOW 6\'s default)'), el('option', { value: 'coef' }, 'The storage coefficient S, no unit (STORAGECOEFFICIENT)'));
  const ssWhen = el('select', { id: 'mSsWhen' }, el('option', { value: 'always' }, 'Whenever the head is above the cell bottom (MODFLOW 6\'s default)'), el('option', { value: 'confined' }, 'Only while the head is at or above the cell top (SS_CONFINED_ONLY)'));
  const stoOption = (key, on) => { if (on) page.model.sto[key] = true; else delete page.model.sto[key]; page.edited(); fillStoOptions(); fillLayerInputs(); page.buildShowSelect(); };
  ssKind.addEventListener('change', () => stoOption('storagecoefficient', ssKind.value === 'coef'));
  ssWhen.addEventListener('change', () => stoOption('ssConfinedOnly', ssWhen.value === 'confined'));
  const ssHead = el('th', {}, 'Ss (per m)');
  // The numbers stay as they are when the option changes, and are read the other way: said here.
  const ssKindNote = el('span', { class: 'hint' });
  // NPF's options for the connection between layers: VARIABLECV (with DEWATERED) and PERCHED.
  const cvKind = el('select', { id: 'mCv' }, el('option', { value: 'fixed' }, 'From full cells, fixed (MODFLOW 6\'s default)'), el('option', { value: 'var' }, 'Varying with the saturation (VARIABLECV)'),
    el('option', { value: 'dew' }, 'Varying, a lower cell not full adding nothing (VARIABLECV DEWATERED)'));
  const perchedKind = el('select', { id: 'mPerched' }, el('option', { value: 'off' }, 'Off (MODFLOW 6\'s default)'), el('option', { value: 'on' }, 'On: flow down to a cell below its top as if to the bottom above (PERCHED)'));
  const npfOption = (key, on) => { if (on) page.model.npf[key] = true; else delete page.model.npf[key]; };
  cvKind.addEventListener('change', () => { npfOption('variablecv', cvKind.value !== 'fixed'); npfOption('dewatered', cvKind.value === 'dew'); page.edited(); });
  perchedKind.addEventListener('change', () => { npfOption('perched', perchedKind.value === 'on'); page.edited(); });
  function fillStoOptions() {
    const { model } = page;
    cvKind.value = model.npf.variablecv ? (model.npf.dewatered ? 'dew' : 'var') : 'fixed';
    perchedKind.value = model.npf.perched ? 'on' : 'off';
    ssKind.value = model.sto.storagecoefficient ? 'coef' : 'ss';
    ssWhen.value = model.sto.ssConfinedOnly ? 'confined' : 'always';
    ssHead.textContent = model.sto.storagecoefficient ? 'S (no unit)' : 'Ss (per m)';
    ssKindNote.textContent = ssKindText(model);
  }
  const layersPanel = el('section', { class: 'panel model-layers', 'aria-labelledby': 'mLayersHead', hidden: true },
    el('h2', { id: 'mLayersHead' }, 'Layers'),
    el('p', { class: 'hint' }, 'One value for the whole layer, or paint cell values on the map. Typing a value here replaces the whole layer, painted cells too.'),
    el('div', { class: 'fields' }, field('Top of the model (m)', topInput, 'The top of layer 1; each layer\'s top is the bottom of the one above.')),
    el('div', { class: 'tablewrap' }, el('table', { class: 'model-table' },
      el('thead', {}, el('tr', {}, ['Layer', 'Cell type', 'Bottom (m)', 'K (m/d)', 'K22 (m/d)', 'K33 (m/d)', ssHead, 'Sy', 'Starting head (m)'].map((h) => (typeof h === 'string' ? el('th', {}, h) : h)))),
      layersBody)),
    el('div', { class: 'btn-row' }, k33Button), layerWords,
    el('div', { class: 'fields' },
      field('Storage given as', ssKind, 'As MODFLOW 6\'s STO reads SS: storage per metre of thickness, or the storage coefficient of the whole cell.'),
      field('Compressible storage in a convertible cell', ssWhen, 'With SS_CONFINED_ONLY, as in MODFLOW-2005, a cell below its top stores water by Sy alone.'),
      field('Conductance between layers', cvKind, 'As MODFLOW 6\'s NPF: by default from half of each cell\'s full thickness over its K33.'),
      field('Perched water', perchedKind, 'As MODFLOW 6\'s NPF PERCHED, for a convertible cell whose head is below its top.')),
    el('p', { class: 'hint' }, ssKindNote),
    el('p', { class: 'hint' }, 'K22 is the conductivity along the columns (north to south), K along the rows; left empty in every layer, K22 equals K, as in MODFLOW 6. A layer "Confined (THICKSTRT)" is confined with the saturated thickness of its starting head, as MODFLOW 6\'s THICKSTRT gives it.'));
  page.root.append(layersPanel);
  numberInput(page, topInput, 'Top of the model', () => layerValue(page.model, 'top', 0), (v) => setLayerValue(page.model, 'top', 0, v));

  function showValue(input, v) {
    if (document.activeElement === input) return;
    const d = describe(v);
    input.value = d.state === 'value' ? String(v) : '';
    input.placeholder = d.state === 'painted' ? 'painted' : d.state === 'partial' ? 'partly painted' : '';
  }

  function buildLayers() {
    layersBody.textContent = '';
    layerInputs.length = 0;
    for (let k = 0; k < page.model.grid.nlay; k++) {
      const type = el('select', { 'aria-label': `Cell type of layer ${k + 1}` }, el('option', { value: '' }, 'Choose'), el('option', { value: '0' }, 'Confined'), el('option', { value: '1' }, 'Convertible'),
        el('option', { value: '-1' }, 'Confined (THICKSTRT)'));
      type.addEventListener('change', () => {
        const { model } = page;
        model.npf.icelltype[k] = type.value === '' ? null : Number(type.value);
        // THICKSTRT is on exactly while some layer takes its thickness from its starting head.
        if (model.npf.icelltype.includes(-1)) model.npf.thickstrt = true; else delete model.npf.thickstrt;
        page.edited();
      });
      const inputs = { icelltype: type };
      const cells = LAYER_PROPS.map((p) => {
        const input = el('input', { inputmode: 'decimal', 'aria-label': `${PROPS[p].label} of layer ${k + 1}` });
        numberInput(page, input, `${PROPS[p].label} of layer ${k + 1}`, () => layerValue(page.model, p, k), (v) => setLayerValue(page.model, p, k, v));
        inputs[p] = input;
        return el('td', {}, input);
      });
      layerInputs.push(inputs);
      layersBody.append(el('tr', {}, el('td', {}, String(k + 1)), el('td', {}, type), cells));
    }
    fillLayerInputs();
  }
  function fillLayerInputs() {
    const { model } = page;
    if (!model) return;
    fillStoOptions();
    showValue(topInput, model.grid.top);
    layerInputs.forEach((inputs, k) => {
      if (document.activeElement !== inputs.icelltype) inputs.icelltype.value = model.npf.icelltype[k] === null ? '' : String(model.npf.icelltype[k]);
      for (const p of LAYER_PROPS) showValue(inputs[p], layerValue(model, p, k));
      if (!model.npf.k22 && document.activeElement !== inputs.k22) inputs.k22.placeholder = '= K';
    });
  }

  // Every empty value the model needs is marked, and every impossible one is marked bad.
  function markLayers(wrong) {
    const { model } = page;
    const transient = model.periods.some((p) => p.steady === false);
    const need = (v) => ['none', 'partial'].includes(describe(v).state);
    const badLayer = new Set(wrong.filter((w) => w.field && w.field.prop).map((w) => `${w.field.prop}|${w.field.k}`));
    const typedBad = (input, label) => page.notNumbers.has(label);
    topInput.closest('.field').classList.toggle('missing', need(model.grid.top));
    layerInputs.forEach((inputs, k) => {
      inputs.icelltype.classList.toggle('missing', model.npf.icelltype[k] === null);
      for (const p of LAYER_PROPS) {
        const required = p === 'k22' ? Boolean(model.npf.k22) : (p !== 'ss' && p !== 'sy') || transient;
        inputs[p].classList.toggle('missing', required && need(layerValue(model, p, k)));
        inputs[p].classList.toggle('bad', badLayer.has(`${p}|${k}`) || typedBad(inputs[p], `${PROPS[p].label} of layer ${k + 1}`));
      }
    });
  }

  // A new model: the panel shows.
  function resetLayers() {
    layersPanel.hidden = false;
  }

  Object.assign(page, { buildLayers, fillLayerInputs, showWords, markLayers, resetLayers });
}
