// The particle-tracking panel of the model page (docs/design/model-tools.md, sections 1
// and 2): the user gives the porosity of each layer, starting points or a pumping well,
// the direction, MODPATH's weak sink and weak source options and each package's IFACE,
// and the panel tracks the particles through the run (src/engine/model/particles.js),
// draws the pathlines or the capture zone in plan, and lists where each particle ended.
// See docs/tools/model-particles.md.
//
// The page mounts it as its other panels (panels.js): mount(host, { model, result,
// state, run, overlay }) resolves to { update(model, result, state) }. It tracks only
// through a run of the model as it is now: when state.stale says the model has changed
// since the run, it says so and offers to run. overlay, if the page gives it, is
// overlay(draw | null, legend): the page's map calls draw(ctx, { X, Y }) after its
// contours, with X(x) and Y(y) the canvas position of a point x metres east of the grid's
// left edge and y metres south of its top edge, so the pathlines lie on the page's own map,
// and lists legend's items in its key. The panel draws its own plan view as well.
//
// Nothing that needs a window is imported at the top, so the plain functions below can be
// tested in Node; kit.js is imported when the panel is mounted.
import { track, captureZone } from '../../../engine/model/particles.js';
import { listed, sig } from '../../../engine/format.js';

const PACKAGES = ['CHD', 'WEL', 'RCH', 'EVT', 'RIV', 'DRN', 'GHB'];
const PACKAGE_NAMES = { CHD: 'Constant-head cells (CHD)', WEL: 'Wells (WEL)', RCH: 'Recharge (RCH)', EVT: 'Evapotranspiration (EVT)', RIV: 'River cells (RIV)', DRN: 'Drains (DRN)', GHB: 'General-head boundaries (GHB)' };
// Short enough for a phone's width; the hint above the selects says what IFACE 0 means.
const FACES = [
  [0, 'inside the cell (0)'],
  [6, 'top face (6)'], [5, 'bottom face (5)'],
  [1, 'column − 1 face (1)'], [2, 'column + 1 face (2)'], [3, 'row + 1 face (3)'], [4, 'row − 1 face (4)'],
];

// ---------------------------------------------------------------------------------------
// Plain functions, with no DOM.

/** The steady-state saved steps of a run, as [{ step, label }]. */
export function steadySteps(model, result) {
  if (!result) return [];
  const out = [];
  result.heads.forEach((_, s) => {
    const p = result.periods ? result.periods[s] : 0;
    if (model.periods[p] && model.periods[p].steady) out.push({ step: s, label: `period ${p + 1}, step ${(result.steps ? result.steps[s] : 0) + 1}` });
  });
  return out;
}

// The list of a stress package in force in period p (as run.js reads it).
function inForce(pkg, p) {
  if (!pkg) return null;
  let best = -1;
  for (const key of Object.keys(pkg)) { const k = Number(key); if (Number.isInteger(k) && k <= p && k > best) best = k; }
  return best < 0 ? null : pkg[best];
}

/** The packages with entries in a period, of those particle tracking can give an IFACE. */
export function packagesIn(model, period) {
  return PACKAGES.filter((k) => {
    // Recharge and ET as arrays (a period's arrays stand until replaced) or as lists.
    if (k === 'RCH') return inForce(model.rch, period) != null || (inForce(model.rchList, period) || []).length > 0;
    if (k === 'EVT') return inForce(model.evt, period) != null || (inForce(model.evtList, period) || []).length > 0;
    const l = inForce(model[k.toLowerCase()], period);
    return l && l.length > 0;
  });
}

/** The pumping wells in force in a period: [{ lay, row, col, q, label }], 0-based cells. */
export function pumpingWells(model, period) {
  return (inForce(model.wel, period) || []).filter((e) => e[3] < 0).map((e) => ({
    lay: e[0], row: e[1], col: e[2], q: e[3],
    label: `layer ${e[0] + 1}, row ${e[1] + 1}, column ${e[2] + 1}, pumping ${-e[3]} m³/d`,
  }));
}

/**
 * Starting points from text: one per line, layer, row, column (counted from 1, as in
 * MODFLOW) and the local x, y, z in the cell from 0 to 1, comma, tab or space separated.
 * A heading line is skipped. Returns [{ id, lay, row, col, x, y, z }], 0-based cells.
 */
export function readStarts(text, model) {
  const g = model.grid, out = [];
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  lines.forEach((line, k) => {
    const f = line.split(/[\s,;\t]+/);
    if (k === 0 && f.some((v) => v !== '' && !Number.isFinite(Number(v)))) return;
    if (f.length !== 6) throw new Error(`Line ${k + 1}: give layer, row, column, x, y and z (six values).`);
    const v = f.map(Number);
    if (v.some((x) => !Number.isFinite(x))) throw new Error(`Line ${k + 1}: a value is not a number.`);
    const [lay, row, col] = [v[0] - 1, v[1] - 1, v[2] - 1];
    if (![lay, row, col].every(Number.isInteger) || lay < 0 || lay >= g.nlay || row < 0 || row >= g.nrow || col < 0 || col >= g.ncol) {
      throw new Error(`Line ${k + 1}: the cell (layer ${v[0]}, row ${v[1]}, column ${v[2]}) is not in the grid of ${g.nlay} × ${g.nrow} × ${g.ncol}.`);
    }
    for (const [name, x] of [['x', v[3]], ['y', v[4]], ['z', v[5]]]) if (!(x >= 0 && x <= 1)) throw new Error(`Line ${k + 1}: ${name} must be from 0 to 1 within the cell.`);
    out.push({ id: out.length, lay, row, col, x: v[3], y: v[4], z: v[5] });
  });
  if (!out.length) throw new Error('Give at least one starting point.');
  return out;
}

/** A list of numbers above zero from text ("" gives []). */
export function readTimes(text) {
  const s = String(text).trim();
  if (!s) return [];
  return s.split(/[\s,;]+/).map((t) => {
    const v = Number(t);
    if (!(v > 0)) throw new Error(`"${t}" is not a travel time above zero.`);
    return v;
  }).sort((a, b) => a - b);
}

/**
 * Porosity per layer from one text box per layer: numbers above 0 and at most 1. Every
 * gap and every bad value is named at once, as the page lists what a model still needs.
 */
export function readPorosity(values) {
  const empty = [], bad = [];
  const out = values.map((t, k) => {
    const s = String(t).trim();
    if (!s) { empty.push(k + 1); return null; }
    const v = Number(s);
    if (!(v > 0 && v <= 1)) bad.push(k + 1);
    return v;
  });
  const layers = (ks) => `${ks.length === 1 ? 'layer' : 'layers'} ${listed(ks)}`;
  const say = [];
  if (empty.length) say.push(`Give the porosity of ${layers(empty)}.`);
  if (bad.length) say.push(`The porosity of ${layers(bad)} must be above 0 and at most 1.`);
  if (say.length) throw new Error(say.join(' '));
  return out;
}

/** The grid's extent: width W east and height H north, in metres. */
export function extent(model) {
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  return { W: sum(model.grid.delr), H: sum(model.grid.delc) };
}

/**
 * The pathlines and outlines in map coordinates, x east of the left edge and y south of
 * the top edge (the engine's y is north of the grid's front edge, MODPATH's convention).
 */
export function mapShapes(model, out) {
  const { H } = extent(model);
  const flip = (p) => ({ x: p.x, y: H - p.y });
  return {
    paths: (out.paths || []).map((p) => ({ status: p.status, points: p.points.map(flip) })),
    outlines: (out.zones || []).map((z) => ({ time: z.time, points: z.outline.map(flip) })),
  };
}

/** Run the tracking for the panel's choices. */
export function runTracking(model, result, choice) {
  const base = {
    porosity: choice.porosity, step: choice.step, weakSinks: choice.weakSinks, weakSources: choice.weakSources,
    iface: choice.iface, ...(choice.maxTime ? { maxTime: choice.maxTime } : {}),
  };
  if (choice.mode === 'well') {
    return captureZone(model, result, { ...base, well: choice.well, times: choice.times, particlesPerFace: choice.particlesPerFace });
  }
  return track(model, result, { ...base, direction: choice.direction, starts: choice.starts });
}

/**
 * Where each outline is labelled: the point of it farthest from the well, in map metres
 * (x east, y south), so the labels of nested outlines spread apart. Returns [{ time, x, y }].
 */
export function outlineLabels(model, shapes, well) {
  const ex = [0], ey = [0];
  model.grid.delr.forEach((w, j) => ex.push(ex[j] + w));
  model.grid.delc.forEach((w, i) => ey.push(ey[i] + w));
  const cx = (ex[well.col] + ex[well.col + 1]) / 2, cy = (ey[well.row] + ey[well.row + 1]) / 2;
  return shapes.outlines.map((o) => {
    let best = o.points[0], far = -1;
    for (const p of o.points) { const d = Math.hypot(p.x - cx, p.y - cy); if (d > far) { far = d; best = p; } }
    return { time: o.time, x: best.x, y: best.y };
  });
}

/** The method text for kit's method(), for the choices of one tracking run. */
export function particleMethod(model, choice) {
  const steps = [
    { title: 'Velocities at the cell faces', lines: [
      'The flow across each face of each cell, and every boundary flow entry by entry, is the flow model\'s own for the steady step chosen: the flows its budget is made of, which are what MODFLOW 6 writes to its budget file and MODPATH 7 reads (Pollock 2016). Nothing is rebuilt from the heads, so whatever the flow model does is in them as it did it (K22, VARIABLECV, PERCHED, THICKSTRT, Newton-Raphson, rewetting, evapotranspiration, the layer recharge goes to), and the flows of each cell balance. The velocity at a face is that flow over the face area and the porosity n of the cell (Pollock 2016, eq. 1), so halving the porosity halves every travel time and leaves the paths unchanged.',
    ], formula: 'vx1 = Qx1 / (n Δy Δz),  vx2 = Qx2 / (n Δy Δz), and the same in y and z', numbers: choice.porosity.map((v, k) => [`Porosity, layer ${k + 1}`, String(v)]) },
    { title: 'A path through a cell', lines: [
      'Within a cell each velocity component varies linearly between its two faces (Pollock 2016, eq. 2 and 3), so a particle\'s position has an exact solution in time (eq. 8). The time to reach each face it moves towards follows from it (eq. 9); the particle leaves by the face it reaches first, and goes on in the next cell. This is the semi-analytical method of Pollock (1988), as MODPATH has it (Pollock 1989, 1994) in version 7 (Pollock 2016). Here x is the position in the cell, x1 its face at the low side, A = (vx2 − vx1) / Δx the velocity gradient and t1 the time the particle was at x(t1).',
      ...(choice.mode === 'well' || choice.direction === 'backward' ? ['Tracking backward reverses every velocity, so a particle goes to where its water came from (Pollock 2016, p. 15).'] : []),
    ], formula: 'vx = A (x − x1) + vx1\nx(t) = x1 + (vx(t1) e^(A (t − t1)) − vx1) / A\nΔt to face x2 = ln(vx2 / vx(t1)) / A', numbers: [] },
    { title: 'Sinks, sources and boundary faces', lines: [
      `A weak sink takes only part of the water entering its cell, and a weak source gives only part of what leaves it. Whether a particle there is taken out cannot be known from the flows, so MODPATH leaves it to the modeller (Pollock 2016). Chosen: weak sinks, particles ${choice.weakSinks === 'stop' ? 'stop there' : 'pass through'}; weak sources, particles ${choice.weakSources === 'stop' ? 'stop there' : 'pass through'}.`,
      `A boundary flow given a face (IFACE) enters or leaves across that face when it has no active neighbour; otherwise it stays inside the cell, as in MODPATH. ${Object.keys(choice.iface).length ? `Given here: ${Object.entries(choice.iface).map(([k, v]) => `${PACKAGE_NAMES[k]} on face ${v}`).join(', ')}; every other package inside its cell (IFACE 0).` : 'Every package\'s flow is inside its cell (IFACE 0), MODPATH\'s own rule when it is given nothing.'}`,
    ], numbers: [] },
  ];
  if (choice.mode === 'well') {
    steps.push({ title: 'Capture zone', lines: [`${choice.particlesPerFace} particles are released evenly along each of the four side faces of the well's cell, at mid-depth, and tracked backward. Each outline joins where those particles are at its travel time, in order around the cell; a particle that stopped sooner is taken at its end. The full zone is where they end.`], numbers: [['Travel times (d)', choice.times.length ? choice.times.map((t) => sig(t, 4)).join(', ') : 'none']] });
  }
  if (choice.maxTime) steps.push({ title: 'Stop time', lines: [`Particles stop after ${sig(choice.maxTime, 4)} d.`], numbers: [] });
  steps.push({ title: 'Limits', lines: [
    'Only steady-state steps are tracked. MODPATH tracks a transient run step by step, with storage as a source or sink; that is not built here.',
    ...(model.newton ? ['Under the Newton-Raphson formulation no cell goes dry in the flow model, but a convertible cell whose head is below its bottom is taken as dry here, as MODPATH 7 takes such a cell of a MODFLOW 6 model: no particle starts in it, and one that reaches it has left at a boundary.'] : []),
  ], numbers: [] });
  return {
    steps,
    references: [
      'Pollock, D.W. (1988) Semianalytical computation of path lines for finite-difference models. Groundwater 26(6), 743-750. doi:10.1111/j.1745-6584.1988.tb00425.x',
      'Pollock, D.W. (1989) Documentation of computer programs to compute and display pathlines using results from the U.S. Geological Survey modular three-dimensional finite-difference ground-water flow model. U.S. Geological Survey Open-File Report 89-381. doi:10.3133/ofr89381',
      'Pollock, D.W. (1994) User\'s guide for MODPATH/MODPATH-PLOT, Version 3: a particle tracking post-processing package for MODFLOW, the U.S. Geological Survey finite-difference ground-water flow model. U.S. Geological Survey Open-File Report 94-464. doi:10.3133/ofr94464',
      'Pollock, D.W. (2016) User guide for MODPATH Version 7—A particle-tracking model for MODFLOW. U.S. Geological Survey Open-File Report 2016-1086. doi:10.3133/ofr20161086',
    ],
  };
}

// ---------------------------------------------------------------------------------------
// The panel.

export async function mount(host, ctx) {
  const { el, errorBox, fixed, method, panel, table, together } = await import('../../kit.js');
  let model = ctx.model, result = ctx.result, state = ctx.state || {};
  const blank = () => ({ porosity: [], starts: '', times: '', perFace: '', maxTime: '', mode: 'points', direction: '', weakSinks: '', weakSources: '', iface: {}, well: '', step: '' });
  let typed = blank();
  const box = panel(el('h2', {}, 'Track particles'));
  host.append(box);
  const banner = el('div', { class: 'model-stale', role: 'status', hidden: true });
  const body = el('div', { class: 'stack' });
  box.append(banner, body);
  let runBtn = null, out = null;
  let uid = 0;
  const id = () => `mp-${++uid}`;

  const select = (label, options, value, onchange) => {
    const s = el('select', { id: id(), 'aria-label': label }, options.map(([v, t]) => el('option', { value: String(v) }, t)));
    s.value = String(value);
    s.addEventListener('change', () => onchange(s.value));
    return s;
  };
  // As kit.js lays out a field, with the label tied to its input.
  const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { for: input.id }, label), input, hint ? el('span', { class: 'hint' }, hint) : null);
  const text = (label, key, attrs = {}) => {
    const i = el('input', { id: id(), inputmode: 'decimal', 'aria-label': label, value: typed[key], ...attrs });
    i.addEventListener('input', () => { typed[key] = i.value; });
    return i;
  };

  // Whether the panel can track now, and the notice when it cannot.
  function showState() {
    const fresh = Boolean(result) && !state.stale;
    host.toggleAttribute('data-stale', Boolean(state.stale));
    if (runBtn) runBtn.disabled = !fresh;
    if (fresh) { banner.hidden = true; return; }
    const why = state.stale
      ? 'The model has changed since the last run, so particles cannot be tracked through it yet: they follow the heads of a run of the model as it is now.'
      : 'Run the model first: particles are tracked through its heads.';
    banner.replaceChildren(el('p', {}, why),
      state.complete && ctx.run ? el('button', { class: 'btn', type: 'button', onclick: () => ctx.run() }, 'Run the model') : el('p', { class: 'hint' }, 'Give every value the model still needs, then press Run.'));
    banner.hidden = false;
  }

  function render() {
    body.textContent = '';
    runBtn = null;
    if (ctx.overlay) ctx.overlay(null);
    showState();
    if (!result) return;
    const steps = steadySteps(model, result);
    if (!steps.length) {
      body.append(el('p', { class: 'hint' }, 'Particle tracking needs a steady-state period. Tracking through transient steps, as MODPATH does step by step with storage, is not built yet.'));
      return;
    }
    if (!steps.some((s) => String(s.step) === typed.step)) typed.step = String(steps[steps.length - 1].step);
    const period = result.periods ? result.periods[Number(typed.step)] : 0;
    const nlay = model.grid.nlay;
    while (typed.porosity.length < nlay) typed.porosity.push('');
    typed.porosity.length = nlay;

    const por = typed.porosity.map((v, k) => {
      const i = el('input', { id: id(), inputmode: 'decimal', size: 6, value: v, 'aria-label': `Porosity of layer ${k + 1}` });
      i.addEventListener('input', () => { typed.porosity[k] = i.value; });
      return field(`Layer ${k + 1}`, i);
    });
    const pk = packagesIn(model, period);
    const ifaceRows = pk.map((k) => {
      if (typed.iface[k] == null) typed.iface[k] = '0';
      return field(PACKAGE_NAMES[k], select(`IFACE for ${PACKAGE_NAMES[k]}`, FACES, typed.iface[k], (v) => { typed.iface[k] = v; }));
    });
    const wells = pumpingWells(model, period);
    const modeSel = select('What to track', [['points', 'Particles from points'], ['well', 'Capture zone of a pumping well']], typed.mode, (v) => { typed.mode = v; render(); });
    const choose = [['', 'Choose']];
    const parts = [
      el('p', { class: 'hint' }, "Pollock's semi-analytical method, as MODPATH 7 uses it, through the flow of a steady-state step. Nothing is assumed: give the porosity of each layer, and choose how particles treat cells with weak sinks and sources. The method is written out below the results."),
      steps.length > 1 ? field('Step', select('Step', steps.map((s) => [s.step, s.label]), typed.step, (v) => { typed.step = v; render(); })) : null,
      el('h3', {}, 'Porosity'), el('div', { class: 'btn-row' }, por),
      el('h3', {}, 'What to track'), field('Track', modeSel),
    ];
    if (typed.mode === 'points') {
      const starts = el('textarea', { id: id(), rows: 6, cols: 50, spellcheck: 'false', 'aria-label': 'Starting points', placeholder: 'layer,row,column,x,y,z\n1,5,3,0.5,0.5,0.5' });
      starts.value = typed.starts;
      starts.addEventListener('input', () => { typed.starts = starts.value; });
      const fromObs = (model.obs || []).length ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => {
        starts.value = typed.starts = ['layer,row,column,x,y,z', ...model.obs.map((o) => `${o.lay + 1},${o.row + 1},${o.col + 1},0.5,0.5,0.5`)].join('\n');
      } }, "Start from the model's observation points") : null;
      parts.push(
        el('p', { class: 'hint' }, 'One point per line: layer, row and column (counted from 1, as in MODFLOW), then x, y and z within the cell from 0 to 1. x runs west to east, y south to north (0 on the row + 1 side, as MODPATH has it) and z from the bottom of the cell to the top of its saturated part.'),
        starts, fromObs ? el('div', { class: 'btn-row' }, fromObs) : null,
        field('Direction', select('Direction', [...choose, ['forward', 'Forward, with the flow'], ['backward', 'Backward, to where the water came from']], typed.direction, (v) => { typed.direction = v; })));
    } else if (!wells.length) {
      parts.push(el('p', { class: 'hint' }, 'There is no pumping well (a well with a negative rate) in this period.'));
    } else {
      if (!wells.some((w, k) => String(k) === typed.well)) typed.well = '';
      parts.push(
        field('Well', select('Well', [...choose, ...wells.map((w, k) => [k, w.label])], typed.well, (v) => { typed.well = v; })),
        field('Particles on each side of the cell', text('Particles on each side of the well cell', 'perFace', { size: 4, inputmode: 'numeric' }), 'Released at mid-depth along the four side faces and tracked backward.'),
        field('Travel times (d)', text('Travel times', 'times', { size: 24 }), 'Optional, for example 365, 1825, 3650: the zone each time reaches. The full zone is always drawn.'));
    }
    parts.push(
      el('h3', {}, 'Weak sinks and sources'),
      el('p', { class: 'hint' }, 'A weak sink takes only part of the water entering its cell (a well, drain, river or evapotranspiration with flow passing on). Whether a particle entering such a cell is taken out there cannot be known; MODPATH leaves it to the modeller (Pollock 2016).'),
      el('div', { class: 'btn-row' },
        field('Weak sinks', select('Weak sinks', [...choose, ['pass', 'Particles pass through'], ['stop', 'Particles stop there']], typed.weakSinks, (v) => { typed.weakSinks = v; })),
        field('Weak sources', select('Weak sources', [...choose, ['pass', 'Particles pass through'], ['stop', 'Particles stop there']], typed.weakSources, (v) => { typed.weakSources = v; }))),
      pk.length ? el('h3', {}, 'Where boundary flows enter (IFACE)') : null,
      pk.length ? el('p', { class: 'hint' }, 'Inside the cell (IFACE 0) is what MODPATH does when it is not told. Recharge usually enters across the top face, and a river near the top of a cell is often treated the same way. A flow put on a face that has an active neighbour stays inside the cell, as in MODPATH.') : null,
      pk.length ? el('div', { class: 'btn-row' }, ifaceRows) : null,
      field('Stop after (d)', text('Stop after, days', 'maxTime', { size: 10 }), 'Optional: without it particles go until they stop.'));
    runBtn = el('button', { class: 'btn', type: 'button' }, typed.mode === 'well' ? 'Draw the capture zone' : 'Track');
    out = el('div', { class: 'stack model-old-host' });
    runBtn.addEventListener('click', () => {
      out.textContent = '';
      out.classList.remove('model-old');
      delete host.dataset.done;
      if (!result || state.stale) { showState(); return; }
      // Every gap at once, as the page lists what the model still needs.
      const gaps = [];
      const choice = { mode: typed.mode, step: Number(typed.step), weakSinks: typed.weakSinks, weakSources: typed.weakSources,
        iface: Object.fromEntries(pk.map((k) => [k, Number(typed.iface[k])]).filter(([, v]) => v > 0)) };
      const tryIt = (fn) => { try { fn(); } catch (e) { gaps.push(e.message); } };
      tryIt(() => { choice.porosity = readPorosity(typed.porosity); });
      if (!choice.weakSinks || !choice.weakSources) gaps.push('Choose how particles treat weak sinks and weak sources.');
      if (typed.maxTime.trim()) {
        choice.maxTime = Number(typed.maxTime);
        if (!(choice.maxTime > 0)) gaps.push('Stop after must be a number of days above zero.');
      }
      if (typed.mode === 'points') {
        if (!typed.direction) gaps.push('Choose the direction.');
        choice.direction = typed.direction;
        tryIt(() => { choice.starts = readStarts(typed.starts, model); });
      } else if (!wells.length) {
        gaps.push('There is no pumping well in this period.');
      } else {
        if (typed.well === '') gaps.push('Choose the well.');
        choice.well = wells[Number(typed.well)];
        choice.particlesPerFace = Number(typed.perFace);
        if (!(Number.isInteger(choice.particlesPerFace) && choice.particlesPerFace >= 1 && choice.particlesPerFace <= 100)) gaps.push('Give the number of particles on each side of the cell: a whole number from 1 to 100.');
        tryIt(() => { choice.times = readTimes(typed.times); });
      }
      if (gaps.length) { out.append(errorBox(gaps.join(' '))); return; }
      try {
        show(out, { choice, res: runTracking(model, result, choice) });
        host.dataset.done = '1';
      } catch (e) {
        out.append(errorBox(e.message));
      }
    });
    body.append(...parts.filter(Boolean), el('div', { class: 'btn-row' }, runBtn), out);
    showState();
  }

  const colour = (name, fallback) => getComputedStyle(host).getPropertyValue(name).trim() || fallback;
  // Lines with a dark edge, so they show over any colour of the map's scale.
  function stroke(c2, points, close, core, halo, width, dash) {
    c2.beginPath();
    points.forEach(([x, y], k) => (k ? c2.lineTo(x, y) : c2.moveTo(x, y)));
    if (close) c2.closePath();
    c2.setLineDash(dash || []);
    if (halo) { c2.strokeStyle = halo; c2.lineWidth = width + 2.5; c2.stroke(); }
    c2.strokeStyle = core; c2.lineWidth = width; c2.stroke();
    c2.setLineDash([]);
  }
  // Every outline is dashed, each time its own way, so no outline reads as the solid edge of
  // a row of boundary cells.
  const DASH = [[8, 4], [3, 3], [12, 3, 3, 3], [2, 6]];
  function drawShapes(c2, X, Y, shapes, look, labels) {
    for (const p of shapes.paths) stroke(c2, p.points.map((q) => [X(q.x), Y(q.y)]), false, look.path, look.halo, 1.5);
    shapes.outlines.forEach((o, i) => stroke(c2, o.points.map((q) => [X(q.x), Y(q.y)]), true, look.zone, look.halo, 2, DASH[i % DASH.length]));
    // Start (open) and end (filled) of each path.
    for (const p of shapes.paths) {
      const a = p.points[0], b = p.points[p.points.length - 1];
      for (const [q, filled] of [[a, false], [b, true]]) {
        c2.beginPath();
        c2.arc(X(q.x), Y(q.y), 2.5, 0, 2 * Math.PI);
        c2.fillStyle = filled ? look.halo || look.path : look.path;
        c2.strokeStyle = filled ? look.path : look.halo || look.path;
        c2.lineWidth = 1.2;
        c2.fill(); c2.stroke();
      }
    }
    if (labels) {
      c2.font = `600 11px ${colour('--font-body', 'sans-serif')}`;
      c2.textBaseline = 'middle';
      c2.textAlign = 'left';
      for (const l of labels) {
        const t = together(`${sig(l.time, 4)} d`), x = X(l.x) + 5, y = Y(l.y);
        c2.lineWidth = 3; c2.strokeStyle = look.halo || colour('--panel', '#fff'); c2.strokeText(t, x, y);
        c2.fillStyle = look.zone; c2.fillText(t, x, y);
      }
    }
  }

  function show(target, { choice, res }) {
    const shapes = mapShapes(model, res);
    const labels = choice.mode === 'well' ? outlineLabels(model, shapes, choice.well) : null;
    const onMap = { path: colour('--model-path', '#fff'), zone: colour('--model-zone', '#ff4fd8'), halo: colour('--model-halo', '#10222b') };
    const times = (res.zones || []).map((z) => z.time);
    const legend = [{ kind: 'path', label: choice.mode === 'well' ? 'Pathlines, backward from the well' : `Pathlines, ${choice.direction}` }];
    if (times.length) legend.push({ kind: 'zone', label: `Capture zone at ${times.map((t) => sig(t, 4)).join(', ')} d, each outline labelled with its time` });
    if (ctx.overlay) ctx.overlay((c2, { X, Y }) => drawShapes(c2, X, Y, shapes, onMap, labels), legend);
    // The panel's own plan view: the whole grid fitted to the width, with its cells, the wells
    // and the paths in ink on the panel's background.
    const { W, H } = extent(model);
    const width = Math.min(720, Math.max(280, host.clientWidth || 600));
    const scale = width / W, height = Math.max(120, Math.round(H * scale));
    const canvas = el('canvas', { width: String(width), height: String(height), role: 'img', 'aria-label': choice.mode === 'well' ? 'Capture zone and backward pathlines in plan, all layers' : 'Pathlines in plan, all layers' });
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    const c2 = canvas.getContext('2d');
    if (c2) {
      c2.fillStyle = colour('--panel', '#fff');
      c2.fillRect(0, 0, width, height);
      // Cell lines where cells are at least 4 px, so a fine grid does not turn grey.
      c2.strokeStyle = colour('--model-grid', 'rgba(0,0,0,0.2)');
      c2.lineWidth = 1;
      c2.beginPath();
      let x = 0;
      model.grid.delr.forEach((w, j) => { x += w; if (j < model.grid.delr.length - 1 && w * scale >= 4 && model.grid.delr[j + 1] * scale >= 4) { c2.moveTo(Math.round(x * scale) + 0.5, 0); c2.lineTo(Math.round(x * scale) + 0.5, height); } });
      let y = 0;
      model.grid.delc.forEach((h, i) => { y += h; if (i < model.grid.delc.length - 1 && h * scale >= 4 && model.grid.delc[i + 1] * scale >= 4) { c2.moveTo(0, Math.round(y * scale) + 0.5); c2.lineTo(width, Math.round(y * scale) + 0.5); } });
      c2.stroke();
      c2.strokeStyle = colour('--ink-2', '#555');
      c2.strokeRect(0.5, 0.5, width - 1, height - 1);
      // Wells of the step's period.
      const ex = [0], ey = [0];
      model.grid.delr.forEach((w, j) => ex.push(ex[j] + w));
      model.grid.delc.forEach((w, i) => ey.push(ey[i] + w));
      for (const w of inForce(model.wel, result.periods ? result.periods[choice.step] : 0) || []) {
        c2.beginPath();
        c2.arc(((ex[w[2]] + ex[w[2] + 1]) / 2) * scale, ((ey[w[1]] + ey[w[1] + 1]) / 2) * scale, 4.5, 0, 2 * Math.PI);
        c2.fillStyle = colour('--model-wel', '#e3001b');
        c2.fill();
      }
      // In the panel's own view, on the plain background, the outlines are drawn in the accent
      // colour, which has no boundary colours to be confused with here.
      drawShapes(c2, (v) => v * scale, (v) => v * scale, shapes, { path: colour('--ink', '#10222b'), zone: colour('--accent', '#0f6c8c'), halo: null }, labels);
    }
    const paths = res.paths;
    const counts = {};
    for (const p of paths) counts[p.status] = (counts[p.status] || 0) + 1;
    const rows = paths.map((p) => {
      const a = p.points[0], b = p.points[p.points.length - 1];
      return [p.id + 1, `${a.lay + 1}, ${a.row + 1}, ${a.col + 1}`, `${b.lay + 1}, ${b.row + 1}, ${b.col + 1}`, fixed(b.x, 2), fixed(b.y, 2), fixed(b.z, 2), fixed(b.t, 2), p.status];
    });
    const lastEnd = Math.max(...paths.map((p) => p.points[p.points.length - 1].t));
    const beyond = times.filter((t) => t >= lastEnd);
    const key = (cls, label) => el('span', { class: 'model-key' }, el('span', { class: `model-swatch ${cls}`, 'aria-hidden': 'true' }), label);
    // The plan view's outlines are in the accent colour, dashed, so its key is drawn to match.
    const planZoneKey = () => {
      const k = key('k-zone', 'Capture zone outlines');
      const sw = k.firstChild;
      sw.style.background = `repeating-linear-gradient(90deg, ${colour('--accent', '#0f6c8c')} 0 6px, transparent 6px 9px)`;
      sw.style.boxShadow = 'none';
      return k;
    };
    // The native append writes a null as the text "null", so the parts left out are dropped first.
    target.append(...[
      el('h3', {}, choice.mode === 'well' ? 'Capture zone' : 'Pathlines'),
      el('p', { class: 'hint' }, together(`${paths.length} ${paths.length === 1 ? 'particle' : 'particles'}: ${Object.entries(counts).map(([st, n]) => `${n} ${st}`).join(', ')}. Plan view of all layers${choice.mode === 'well' && times.length ? `; the outlines are the zone at ${times.map((t) => sig(t, 4)).join(', ')} d, each labelled with its time` : ''}. The paths are drawn on the map above as well.`)),
      beyond.length ? el('p', { class: 'hint' }, together(`Every particle had stopped by ${sig(lastEnd, 4)} d, so the outline at ${beyond.map((t) => sig(t, 4)).join(', ')} d is the full zone.`)) : null,
      el('div', { class: 'model-plan' }, canvas,
        el('div', { class: 'model-legend' }, key('k-wel', 'Pumping wells'), key('k-start', 'Start of a path'), key('k-end', 'End of a path'), times.length ? planZoneKey() : null)),
      el('h3', {}, 'Where each particle ended'),
      el('p', { class: 'hint' }, 'x is metres east of the grid\'s west edge and y metres north of its south edge, as MODPATH gives them; z is the elevation in m.'),
      table(['Particle', 'Start cell (layer, row, column)', 'End cell', 'x (m)', 'y (m)', 'z (m)', 'Time (d)', 'Status'], rows),
      el('h3', {}, 'Exactly what was done'),
      method(particleMethod(model, choice))].filter(Boolean));
  }

  render();
  return {
    update(nextModel, nextResult, nextState = {}) {
      state = nextState;
      if (state.fresh) typed = blank();
      const fresh = nextResult && !state.stale;
      if (fresh && (nextResult !== result || nextModel !== model || state.fresh)) { model = nextModel; result = nextResult; render(); return; }
      if (state.fresh) { model = nextModel; result = null; render(); return; }
      if (out && state.stale) out.classList.add('model-old');
      showState();
    },
  };
}
