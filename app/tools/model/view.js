// The model page's map: the panel with its choices of layer, value, period, step and tool,
// the backdrop image, and what the map draws: cell values or heads and drawdown with their
// contours, the boundaries, the legend and what is said of the cell under the pointer.
import { countOf, el, fixed, sig, together } from '../../kit.js';
import { cellName, describe, edges, layerValue, listIn, PACKAGE_IDS, PACKAGES, propOf } from './edit-model.js';
import { colourScale, contourLevels, contourLines, drawdownReference, intervalDecimals, LOG_DECADES, niceInterval, referenceHeads, referenceText } from './calc.js';
import { field, level, metres, num, SHOW_PROPS, withUnit } from './common.js';
import { modelMap, rampColour, rampStops } from './map.js';

const TOOLS = [
  ['look', 'Look and pan'], ['paint', 'Paint the value shown'], ['wel', 'Place wells'], ['chd', 'Draw constant-head cells'],
  ['riv', 'Draw river cells'], ['drn', 'Draw drains'], ['ghb', 'Draw general-head boundaries'], ['evtList', 'Draw evapotranspiration cells'], ['obs', 'Place observation points'], ['erase', 'Remove boundaries and points'],
];

/**
 * The map panel. Offers page.map (map.js), vi and pkgInputs (its controls, which the edits
 * on the map read), listHost (where the lists go), noteMap, centres, reference, refHeads,
 * the build…Select functions, nextObsName, drawLegend, refreshView, forgetDrawn and resetView.
 */
export function mountView(page) {
  const { view } = page;
  // ---- the map ----
  const sel = (id, label) => el('select', { id, 'aria-label': label });
  const vi = {
    layer: sel('mLayer', 'Layer'), show: sel('mShow', 'Show'), period: sel('mPeriod', 'Period'), step: sel('mStep', 'Time step'),
    tool: sel('mTool', 'Tool'), shape: sel('mShape', 'Shape'),
    value: el('input', { id: 'mValue', inputmode: 'decimal' }),
    active: el('select', { id: 'mActive' }, el('option', { value: '1' }, 'Active'), el('option', { value: '0' }, 'Inactive'), el('option', { value: '-1' }, 'Vertical pass-through (−1)')),
    obsName: el('input', { id: 'mObsName', autocomplete: 'off', spellcheck: 'false' }),
    interval: el('input', { id: 'mInterval', inputmode: 'decimal' }),
    ref: sel('mRef', 'Drawdown from'), scale: sel('mScale', 'Colour scale'),
    touchPaint: el('input', { id: 'mTouchPaint', type: 'checkbox' }),
  };
  TOOLS.forEach(([v, l]) => vi.tool.add(new Option(l, v)));
  [['brush', 'Brush, cell by cell'], ['rect', 'Rectangle']].forEach(([v, l]) => vi.shape.add(new Option(l, v)));
  const pkgInputs = {};
  for (const id of PACKAGE_IDS) {
    pkgInputs[id] = PACKAGES[id].values.map(([key, label, u, hint]) => {
      const input = el('input', { id: `mPkg-${id}-${key}`, inputmode: 'decimal' });
      return { key, input, box: field(`${PACKAGES[id].label}: ${label.toLowerCase()} (${u})`, input, hint) };
    });
  }
  const valueBox = field('Value to paint', vi.value), activeBox = field('Paint cells as', vi.active);
  const valueLabel = valueBox.querySelector('label');
  const shapeBox = field('Shape', vi.shape), obsBox = field('Name of the next point', vi.obsName);
  const intervalBox = field('Contour interval (m)', vi.interval);
  const intervalNote = el('span', { class: 'hint', role: 'status' });
  intervalBox.append(intervalNote);
  const stepBox = field('Time step', vi.step);
  const refBox = field('Drawdown from', vi.ref), scaleBox = field('Colour scale', vi.scale);
  // On a touch screen one finger pans the map; painting and drawing by dragging is asked for.
  const touchBox = el('div', { class: 'field model-check', hidden: true },
    el('label', { for: 'mTouchPaint' }, vi.touchPaint, ' Paint and draw with one finger'),
    el('span', { class: 'hint' }, 'Off: one finger pans the map and a tap uses the tool on one cell (a rectangle takes a tap at each corner).'));
  // Offered from the start on a touch screen, so the map does not jump at the first touch.
  if (window.matchMedia('(any-pointer: coarse)').matches) touchBox.dataset.touch = '1';
  const pkgBoxes = Object.fromEntries(PACKAGE_IDS.map((id) => [id, el('div', { class: 'model-pkg-fields' }, pkgInputs[id].map((x) => x.box))]));
  const mapBox = el('div', { class: 'model-mapbox' });
  const legend = el('div', { class: 'model-legend', 'aria-live': 'polite' });
  // What the last edit on the map did or could not do. It is cleared by the next edit, a
  // change of tool, layer or period, and a run, and sits under the map, so its coming and
  // going never moves the map under the pointer.
  const mapNote = el('p', { class: 'hint model-note', role: 'status', hidden: true });
  const noteMap = (text) => { mapNote.textContent = text ? together(text) : ''; mapNote.hidden = !text; };
  const listHost = el('div', { class: 'stack' });
  // A button over a hidden file input, as "Open a model" is.
  const backdropFile = el('input', { type: 'file', accept: 'image/*', id: 'mBackdrop', hidden: true });
  const backdropName = el('span', { class: 'hint' });
  const backdropButton = el('button', { class: 'btn quiet small', type: 'button', id: 'mBackdropButton', onclick: () => backdropFile.click() }, 'Choose an image');
  const bc = ['x0', 'y0', 'x1', 'y1'].map((k) => el('input', { id: `mBd-${k}`, inputmode: 'decimal' }));
  const backdropNote = el('p', { class: 'hint' });
  let backdropImg = null;
  const mapPanel = el('section', { class: 'panel model-map', 'aria-labelledby': 'mMapHead', hidden: true },
    el('div', { class: 'chart-head' }, el('h2', { id: 'mMapHead' }, 'Map'),
      el('div', { class: 'btn-row model-zoom' },
        el('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Zoom in', onclick: () => map.zoom(1.4) }, '+'),
        el('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Zoom out', onclick: () => map.zoom(1 / 1.4) }, '−'),
        el('button', { class: 'btn quiet small', type: 'button', onclick: () => map.fit() }, 'Fit'))),
    el('div', { class: 'fields model-tools' }, field('Layer', vi.layer), field('Show', vi.show), field('Stress period', vi.period), stepBox, refBox, scaleBox, intervalBox),
    el('div', { class: 'fields model-tools' }, field('Tool', vi.tool), shapeBox, valueBox, activeBox, obsBox, Object.values(pkgBoxes), touchBox),
    mapBox, mapNote, legend,
    el('p', { class: 'hint' }, 'With a mouse: drag to pan in Look and pan, or with the right mouse button in any tool; zoom with the wheel or the buttons. On a touch screen: one finger pans and a tap uses the tool, two fingers pan and zoom. With a keyboard on the map: arrows move the cell (Shift for 10), Enter or Space uses the tool, + and − zoom about the cell, 0 fits the grid.'),
    el('details', { class: 'model-backdrop' }, el('summary', {}, 'Backdrop image'),
      el('p', { class: 'hint' }, 'A map or air photo under the grid, placed by two corners in the grid\'s own coordinates: x east and y north, in m, from the grid\'s lower-left corner. It stays in this browser and is not saved with the model.'),
      el('div', { class: 'fields' }, el('div', { class: 'field' }, el('label', { for: 'mBackdropButton' }, 'Image'), el('div', { class: 'btn-row' }, backdropButton, backdropName), backdropFile),
        field('Lower-left corner x (m)', bc[0]), field('Lower-left corner y (m)', bc[1]), field('Upper-right corner x (m)', bc[2]), field('Upper-right corner y (m)', bc[3])),
      el('div', { class: 'btn-row model-backdrop-actions' }, el('button', { class: 'btn quiet small', type: 'button', onclick: clearBackdrop }, 'Remove the image')),
      backdropNote),
    listHost);
  page.root.append(mapPanel);

  function clearBackdrop() {
    backdropImg = null;
    backdropFile.value = '';
    backdropName.textContent = '';
    bc.forEach((x) => { x.value = ''; });
    placeBackdrop();
  }
  function placeBackdrop() {
    const v = bc.map((x) => num(x.value));
    if (!backdropImg) { map.setBackdrop(null); backdropNote.textContent = ''; return; }
    if (v.some((x) => x === undefined || Number.isNaN(x))) { map.setBackdrop(null); backdropNote.textContent = 'Give the image\'s two corners to place it.'; return; }
    if (!(v[2] > v[0] && v[3] > v[1])) { map.setBackdrop(null); backdropNote.textContent = 'The upper-right corner must be east and north of the lower-left corner.'; return; }
    backdropNote.textContent = '';
    map.setBackdrop({ img: backdropImg, x0: v[0], y0: v[1], x1: v[2], y1: v[3] });
  }
  backdropFile.addEventListener('change', () => {
    const f = backdropFile.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { backdropImg = img; backdropName.textContent = f.name; placeBackdrop(); };
    img.onerror = () => { backdropName.textContent = ''; backdropNote.textContent = `${f.name} could not be read as an image.`; };
    img.src = URL.createObjectURL(f);
  });
  bc.forEach((x) => x.addEventListener('input', placeBackdrop));

  const map = modelMap(mapBox, {
    label: 'Model map, plan view',
    frame: frameNow,
    tool: () => {
      const t = view.tool;
      if (t === 'look') return 'look';
      if (t === 'wel' || t === 'obs') return 'point';
      return view.shape;
    },
    onApply: (cells, stroke) => page.apply(cells, stroke),
    describe: describeCell,
    touchPaint: () => vi.touchPaint.checked,
    onTouch: () => { touchBox.dataset.touch = '1'; toolFields(); },
    signal: page.signal,
  });

  function buildLayerSelect() {
    vi.layer.textContent = '';
    for (let k = 0; k < page.model.grid.nlay; k++) vi.layer.add(new Option(`Layer ${k + 1}`, String(k)));
    vi.layer.value = String(view.layer);
  }
  function buildPeriodSelect() {
    const { model } = page;
    vi.period.textContent = '';
    if (!model.periods.length) vi.period.add(new Option('No periods yet', '0'));
    model.periods.forEach((_, i) => vi.period.add(new Option(`Period ${i + 1}`, String(i))));
    view.period = Math.min(view.period, Math.max(0, model.periods.length - 1));
    vi.period.value = String(view.period);
  }
  function buildShowSelect() {
    const { model, result } = page;
    const keep = view.show;
    vi.show.textContent = '';
    for (const p of SHOW_PROPS) vi.show.add(new Option(p === 'botm' ? 'Bottom of the layer' : p === 'idomain' ? 'Active cells' : p === 'top' ? 'Top of the model' : propOf(model, p).name, p));
    vi.show.add(new Option('Grid and boundaries only', 'none'));
    if (result) {
      vi.show.add(new Option('Head', 'head'));
      // Drawdown needs a time to measure from; a model of one steady step has none.
      if (drawdownReference(page.resultModel, result) || result.times.length > 1) vi.show.add(new Option('Drawdown', 'drawdown'));
    }
    view.show = [...vi.show.options].some((o) => o.value === keep) ? keep : 'k';
    vi.show.value = view.show;
  }
  const stepLabel = (s) => together(`Period ${page.result.periods[s] + 1}, step ${page.result.steps[s] + 1}: ${sig(page.result.times[s], 4)} d`);
  function buildRefSelect() {
    const { result } = page;
    vi.ref.textContent = '';
    if (!result) return;
    const rule = drawdownReference(page.resultModel, result);
    if (rule && rule.kind === 'strt') vi.ref.add(new Option('Starting heads (time zero)', ''));
    else if (rule) vi.ref.add(new Option(`End of period 1 (steady), ${sig(result.times[rule.step], 4)} d`, ''));
    else vi.ref.add(new Option('Choose a step', ''));
    result.times.forEach((_, s) => { if (!rule || rule.kind !== 'step' || rule.step !== s) vi.ref.add(new Option(stepLabel(s), String(s))); });
    if (![...vi.ref.options].some((o) => o.value === view.ref)) view.ref = '';
    vi.ref.value = view.ref;
  }
  const logAllowed = () => ['drawdown', 'k', 'k22', 'k33', 'ss'].includes(view.show);
  function buildScaleSelect() {
    vi.scale.textContent = '';
    vi.scale.add(new Option('Linear', 'linear'));
    vi.scale.add(new Option('Quantiles, equal cells per colour', 'quantile'));
    if (logAllowed()) vi.scale.add(new Option('Log', 'log'));
    if (![...vi.scale.options].some((o) => o.value === view.scale)) view.scale = 'linear';
    vi.scale.value = view.scale;
  }
  function buildStepSelect() {
    vi.step.textContent = '';
    if (!page.result) return;
    page.result.times.forEach((_, s) => vi.step.add(new Option(stepLabel(s), String(s))));
    vi.step.value = String(view.step);
  }
  vi.layer.addEventListener('change', () => { view.layer = Number(vi.layer.value); noteMap(''); refreshView(); });
  vi.show.addEventListener('change', () => { view.show = vi.show.value; contourCache = null; refreshView(); if (page.result) page.renderResults(); });
  // A result is shown with the boundaries of its own period, so the step sets the period,
  // and choosing a period shows its last step.
  vi.period.addEventListener('change', () => {
    const { result } = page;
    view.period = Number(vi.period.value);
    noteMap('');
    if (result && !page.stale && result.periods.includes(view.period)) { view.step = result.periods.lastIndexOf(view.period); vi.step.value = String(view.step); page.renderResults(); }
    refreshView();
    page.renderLists();
  });
  vi.step.addEventListener('change', () => {
    view.step = Number(vi.step.value);
    if (!page.stale && page.result.periods[view.step] < page.model.periods.length) { view.period = page.result.periods[view.step]; vi.period.value = String(view.period); page.renderLists(); }
    refreshView();
    page.renderResults();
  });
  vi.ref.addEventListener('change', () => { view.ref = vi.ref.value; contourCache = null; refreshView(); page.renderResults(); });
  vi.scale.addEventListener('change', () => { view.scale = vi.scale.value; refreshView(); });
  vi.interval.addEventListener('input', () => {
    const v = num(vi.interval.value);
    view.interval = v > 0 ? v : undefined;
    vi.interval.classList.toggle('bad', v !== undefined && !(v > 0));
    contourCache = null;
    refreshView();
  });
  vi.tool.addEventListener('change', () => { view.tool = vi.tool.value; noteMap(''); toolFields(); map.refreshReadout(); });
  vi.shape.addEventListener('change', () => { view.shape = vi.shape.value; });

  function toolFields() {
    const t = view.tool;
    shapeBox.hidden = !['paint', 'chd', 'riv', 'drn', 'ghb', 'evtList', 'erase'].includes(t);
    valueBox.hidden = !(t === 'paint' && view.show !== 'idomain');
    activeBox.hidden = !(t === 'paint' && view.show === 'idomain');
    obsBox.hidden = t !== 'obs';
    for (const id of PACKAGE_IDS) pkgBoxes[id].hidden = t !== id;
    touchBox.hidden = !(touchBox.dataset.touch && t !== 'look');
    const p = propOf(page.model, view.show);
    valueLabel.textContent = p ? `${p.name}${p.unit ? ` (${p.unit})` : ''}: value to paint` : 'Value to paint';
    if (t === 'obs' && !vi.obsName.value) vi.obsName.value = nextObsName();
  }
  const nextObsName = () => { const used = new Set(page.model ? page.model.obs.map((o) => o.name) : []); let n = 1; while (used.has(`p${n}`)) n++; return `p${n}`; };

  // ---- what the map draws ----
  let geo = null; // cell edges of the current grid
  function centres() {
    const { model } = page;
    if (!geo || geo.delr !== model.grid.delr || geo.delc !== model.grid.delc) {
      const ex = edges(model.grid.delr), ey = edges(model.grid.delc);
      const xs = Array.from({ length: model.grid.ncol }, (_, j) => (ex[j] + ex[j + 1]) / 2);
      const ys = Array.from({ length: model.grid.nrow }, (_, i) => (ey[i] + ey[i + 1]) / 2);
      // Cell centres are written with one count of decimals, enough for every centre.
      const widths = [...new Set([...model.grid.delr, ...model.grid.delc])];
      const d = Math.min(3, widths.reduce((most, w) => Math.max(most, intervalDecimals(w / 2)), 0));
      geo = { delr: model.grid.delr, delc: model.grid.delc, ex, ey, xs, ys, W: ex[model.grid.ncol], H: ey[model.grid.nrow], d };
    }
    return geo;
  }
  const isResultView = () => (view.show === 'head' || view.show === 'drawdown') && page.result;
  // The reference drawdown is measured from, or null (an all-steady model, until a step is chosen).
  const reference = () => (page.result ? drawdownReference(page.resultModel, page.result, view.ref) : null);
  let refCache = null;
  function refHeads(ref) {
    const key = ref.kind === 'strt' ? 'strt' : ref.step;
    if (!refCache || refCache.key !== key || refCache.result !== page.result) refCache = { key, result: page.result, heads: referenceHeads(page.resultModel, page.result, ref) };
    return refCache.heads;
  }
  function resultValues() {
    const g = page.resultModel.grid, ncpl = g.nrow * g.ncol, k = view.layer;
    const h = page.result.heads[view.step].subarray(k * ncpl, (k + 1) * ncpl);
    if (view.show === 'head') return Float64Array.from(h);
    const ref = reference();
    if (!ref) return new Float64Array(ncpl).fill(NaN);
    const r0 = refHeads(ref).subarray(k * ncpl, (k + 1) * ncpl);
    return Float64Array.from(h, (v, c) => r0[c] - v);
  }
  let contourCache = null;
  function frameNow() {
    const { model, result } = page;
    if (!model) return null;
    const g = model.grid, ncpl = g.nrow * g.ncol, k = view.layer;
    // A vertical pass-through cell (idomain -1) is not a cell of the model either.
    const active = g.idomain ? g.idomain.slice(k * ncpl, (k + 1) * ncpl).map((v) => (v === 1 ? 1 : 0)) : null;
    let values = null, scale = null, contours = null, dry = [];
    if (isResultView()) {
      values = resultValues();
      scale = colourScale(values, active, view.scale);
      const range = rangeOf(values, active);
      const interval = view.interval || (range ? niceInterval(range[0], range[1]) : 0);
      const key = `${view.show}|${view.ref}|${k}|${view.step}|${interval}|${result.seconds}`;
      if (!contourCache || contourCache.key !== key) {
        const c = centres();
        const levels = range ? contourLevels(range[0], range[1], interval) : [];
        const d = intervalDecimals(interval);
        contourCache = { key, levels, interval, decimals: d, tooMany: Boolean(range && interval > 0 && !levels.length && range[1] > range[0]), lines: contourLines(values, g.nrow, g.ncol, c.xs, c.ys, levels), labels: levels.map((L) => fixed(L === 0 ? 0 : L, d)) };
      }
      contours = contourCache;
      dry = result.dry[view.step].filter((n) => n >= k * ncpl && n < (k + 1) * ncpl).map((n) => n - k * ncpl);
    } else if (SHOW_PROPS.includes(view.show) && view.show !== 'idomain') {
      const v = layerValue(model, view.show, k, view.period);
      values = v === null ? new Array(ncpl).fill(null) : typeof v === 'number' ? new Float64Array(ncpl).fill(v) : v;
      scale = colourScale(values, active, view.scale);
    }
    const boundaries = [], wells = [];
    for (const id of ['chd', 'riv', 'drn', 'ghb', 'evtList', 'wel']) {
      for (const e of listIn(model, id, view.period)) if (e[0] === k) (id === 'wel' ? wells : boundaries).push({ row: e[1], col: e[2], pkg: id });
    }
    const obs = model.obs.filter((o) => o.lay === k).map((o) => ({ row: o.row, col: o.col, name: o.name }));
    return {
      model, values, scale, range: scale ? [scale.lo, scale.hi] : null, active, boundaries, wells, obs, dry, contours,
      faded: Boolean(result) && page.stale, overlays: Object.values(page.overlays).filter(Boolean).map((o) => o.draw),
    };
  }
  const rangeOf = (values, active) => {
    const sc = colourScale(values, active, 'linear');
    return sc ? [sc.lo, sc.hi] : null;
  };

  function drawLegend() {
    const { model, result, stale } = page;
    legend.textContent = '';
    if (!model) return;
    const f = frameNow();
    const k = view.layer;
    const items = [];
    const staleText = 'The model has changed since this run: press Run for new results.';
    if (isResultView()) {
      const ref = reference();
      const when = `period ${result.periods[view.step] + 1}, step ${result.steps[view.step] + 1}`;
      if (view.show === 'drawdown' && !ref) {
        items.push(el('span', { class: 'hint' }, 'The run is of one steady period, so there is no earlier state to measure drawdown from. To compare with another step, choose it under "Drawdown from".'));
      } else {
        const name = view.show === 'head' ? `Head, layer ${k + 1}, ${when} (m)` : `Drawdown from ${referenceText(result, ref)}, layer ${k + 1}, ${when} (m)`;
        const d = Math.max(3, f.contours ? f.contours.decimals : 0);
        // A log scale spans powers of ten, so its ends are written to significant figures.
        items.push(scaleKey(name, f.scale, f.scale && f.scale.kind === 'log' ? (v) => sig(v, 3) : (v) => fixed(Math.abs(v) < 0.5 * 10 ** -d ? 0 : v, d)));
        const typedBad = vi.interval.value.trim() !== '' && !(num(vi.interval.value) > 0);
        if (f.contours && f.contours.levels.length) items.push(el('span', { class: 'hint' }, together(`Contours every ${fixed(f.contours.interval, f.contours.decimals)} m, labelled in m${typedBad ? `, an interval chosen by the page: the ${vi.interval.value.trim()} m typed is not above zero` : ''}.`)));
      }
      if (stale) items.push(el('span', { class: 'hint' }, staleText));
    } else if (view.show === 'idomain') {
      items.push(el('span', { class: 'model-key' }, swatch('k-cell'), 'Active'), el('span', { class: 'model-key' }, swatch('k-inactive'), 'Inactive (0), or vertical pass-through (−1), joining the cells above and below'));
    } else if (view.show !== 'none') {
      const p = propOf(model, view.show);
      const d = describe(layerValue(model, view.show, k, view.period));
      const name = `${p.name}${view.show === 'top' ? '' : view.show === 'rch' ? `, period ${view.period + 1}` : `, layer ${k + 1}`}${p.unit ? ` (${p.unit})` : ''}`;
      if (d.state === 'value') {
        const sw = swatch('k-mid');
        sw.style.background = rampColour(page.root, 0.5);
        items.push(el('span', { class: 'model-key' }, sw, together(`${name}: ${sig(d.value, 4)} in every cell`)));
      }
      else if (d.state === 'none') items.push(el('span', { class: 'model-key' }, swatch('k-needed'), `${name}: still needed`));
      else {
        items.push(scaleKey(name, f.scale, (v) => sig(v, 4)));
        if (d.state === 'partial') items.push(el('span', { class: 'model-key' }, swatch('k-needed'), `${countOf(d.total - d.given, 'cell', 'cells')} still needed`));
      }
    }
    const present = new Set([...f.boundaries.map((b) => b.pkg), ...(f.wells.length ? ['wel'] : [])]);
    for (const id of ['wel', 'chd', 'riv', 'drn', 'ghb', 'evtList']) if (present.has(id)) items.push(el('span', { class: 'model-key' }, swatch(`k-${id}`), PACKAGES[id].plural));
    if (f.obs.length) items.push(el('span', { class: 'model-key' }, swatch('k-obs'), 'Observation points'));
    if (f.active && f.active.some((a) => !a) && view.show !== 'idomain') items.push(el('span', { class: 'model-key' }, swatch('k-inactive'), 'Inactive'));
    if (f.dry.length) items.push(el('span', { class: 'model-key' }, swatch('k-dry'), `Dry (${f.dry.length})`));
    // What the panels draw on the map, such as pathlines and capture zones.
    for (const o of Object.values(page.overlays)) {
      for (const it of (o && o.legend) || []) items.push(el('span', { class: 'model-key' }, swatch(`k-${it.kind}`), together(`${it.label}${stale ? '; from the run before the latest changes' : ''}`)));
    }
    legend.append(...items);
  }
  const swatch = (cls) => el('span', { class: `model-swatch ${cls}`, 'aria-hidden': 'true' });
  // The colour bar with its ends and middle, and a line saying how values map to colours.
  function scaleKey(name, sc, fmt) {
    if (!sc) return el('span', { class: 'model-scale' }, el('span', { class: 'model-scale-name' }, name), el('span', { class: 'hint' }, 'No cell has a value to show.'));
    if (!(sc.hi > sc.lo)) {
      const sw = swatch('k-mid');
      sw.style.background = rampColour(page.root, 0.5);
      return el('span', { class: 'model-key' }, sw, together(`${name}: ${fmt(sc.lo)} in every cell shown`));
    }
    const bar = el('span', { class: 'model-bar', 'aria-hidden': 'true' });
    bar.style.background = `linear-gradient(to right, ${rampStops(page.root).join(', ')})`;
    const how = sc.kind === 'quantile'
      ? `Quantile scale: each colour covers the same number of cells, and the middle is the median, ${fmt(sc.mid)}.`
      : sc.kind === 'log'
        ? `Log scale from ${fmt(sc.lo)} (${tenToText(LOG_DECADES)} of the largest, or the smallest above zero) to ${fmt(sc.hi)}${sc.clippedLow ? '; smaller values, and those at or below zero, take the bottom colour' : ''}.`
        : 'Linear scale.';
    return el('span', { class: 'model-scale' }, el('span', { class: 'model-scale-name' }, name),
      el('span', { class: 'model-scale-row' }, el('span', {}, fmt(sc.lo)), bar, el('span', {}, fmt(sc.hi))),
      el('span', { class: 'hint' }, together(how)));
  }
  const tenToText = (n) => `1/${10 ** n}`;

  function describeCell(row, col) {
    const { model, result, resultModel } = page;
    if (!model) return '';
    const c = centres(), k = view.layer, g = model.grid, ncpl = g.nrow * g.ncol, n = row * g.ncol + col;
    const parts = [];
    const at = (v) => (v === null ? null : typeof v === 'number' ? v : v[n]);
    const active = !g.idomain || g.idomain[k * ncpl + n] === 1;
    let text = `${cellName(k, row, col)[0].toUpperCase()}${cellName(k, row, col).slice(1)} (x ${metres(c.xs[col], c.d)}, y ${metres(c.H - c.ys[row], c.d)})`;
    if (!active) return together(`${text}: inactive.`);
    const val = (p, label, u) => { const v = at(layerValue(model, p, k, view.period)); parts.push(v === null || v === undefined ? `${label} needed` : `${label} ${u === 'm' ? level(v) : withUnit(v, u)}`); };
    val('k', 'K', 'm/d'); if (model.npf.k22) val('k22', 'K22', 'm/d'); val('k33', 'K33', 'm/d');
    if (model.periods.some((p) => p.steady === false)) { if (model.sto.storagecoefficient) val('ss', 'S', ''); else val('ss', 'Ss', 'per m'); val('sy', 'Sy', ''); }
    if (k === 0) val('top', 'top', 'm');
    val('botm', 'bottom', 'm');
    val('strt', 'starting head', 'm');
    const r = at(layerValue(model, 'rch', 0, view.period));
    if (k === 0 && r !== null && r !== undefined) parts.push(`recharge ${withUnit(r, 'm/d')}`);
    for (const id of PACKAGE_IDS) {
      const e = listIn(model, id, view.period).find((x) => x[0] === k && x[1] === row && x[2] === col);
      if (e) parts.push(`${PACKAGES[id].label.toLowerCase()}: ${PACKAGES[id].values.map(([, l, u], i) => `${l.toLowerCase()} ${u === 'm' ? level(e[3 + i]) : withUnit(e[3 + i], u)}`).join(', ')}`);
    }
    const o = model.obs.find((x) => x.lay === k && x.row === row && x.col === col);
    if (o) parts.push(`observation point ${o.name}`);
    text += `: ${parts.join('; ')}.`;
    if (result && resultModel.grid.nrow === g.nrow && resultModel.grid.ncol === g.ncol && resultModel.grid.nlay === g.nlay) {
      const h = result.heads[view.step][k * ncpl + n];
      const when = `period ${result.periods[view.step] + 1}, step ${result.steps[view.step] + 1}`;
      if (result.dry[view.step].includes(k * ncpl + n)) text += ` Dry at ${when}.`;
      else if (Number.isFinite(h)) {
        const ref = reference();
        const r0 = ref ? refHeads(ref)[k * ncpl + n] : NaN;
        const dd = Number.isFinite(r0) ? `, drawdown ${level(r0 - h)} from ${ref.kind === 'strt' ? 'the starting head' : `period ${result.periods[ref.step] + 1}, step ${result.steps[ref.step] + 1}`}` : '';
        text += ` Head ${level(h)}${dd} at ${when}${page.stale ? ' (before the latest changes)' : ''}.`;
      }
    }
    return together(text);
  }

  function refreshView() {
    toolFields();
    buildScaleSelect();
    map.redraw();
    map.refreshReadout();
    drawLegend();
    const res = isResultView();
    intervalBox.hidden = !res;
    stepBox.hidden = !page.result;
    refBox.hidden = !(res && view.show === 'drawdown');
    scaleBox.hidden = view.show === 'none' || view.show === 'idomain';
    const f = res ? frameNow() : null;
    intervalNote.textContent = !res ? ''
      : vi.interval.value.trim() && !(num(vi.interval.value) > 0) ? 'The interval must be a number above zero; the page chose one instead.'
        : f && f.contours && f.contours.tooMany ? `An interval of ${vi.interval.value.trim()} m gives more than 500 contours: choose a larger one.` : '';
  }

  // A new run: the contours and the reference heads are worked out again.
  function forgetDrawn() {
    contourCache = null;
    refCache = null;
  }
  // A new model: what was drawn, typed and placed for the one before goes, and the panel shows.
  function resetView() {
    contourCache = null; geo = null; refCache = null;
    // A backdrop image was placed for the grid before.
    clearBackdrop();
    noteMap('');
    vi.interval.value = '';
    vi.interval.classList.remove('bad');
    vi.obsName.value = '';
    for (const id of PACKAGE_IDS) for (const x of pkgInputs[id]) x.input.value = '';
    vi.value.value = '';
    mapPanel.hidden = false;
    vi.tool.value = view.tool;
    vi.shape.value = view.shape;
  }

  // The legend's colour bar follows a switch between light and dark, as the map does.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawLegend, { signal: page.signal });

  Object.assign(page, {
    map, vi, pkgInputs, listHost, noteMap, centres, reference, refHeads,
    buildLayerSelect, buildPeriodSelect, buildShowSelect, buildRefSelect, buildScaleSelect, buildStepSelect,
    nextObsName, drawLegend, refreshView, forgetDrawn, resetView,
  });
}
