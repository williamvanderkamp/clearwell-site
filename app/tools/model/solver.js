// The solver settings beyond the four every model gives (outer, inner, hclose, rclose):
// MODFLOW 6 IMS's linear acceleration, preconditioner, re-orthogonalization, inner closure,
// outer under-relaxation and backtracking, and the settings each COMPLEXITY gives. The pure
// functions are used by edit-model.js (reading, what is missing or wrong, the model to run);
// solverOptions builds their part of the page's solver panel. The settings and their meaning
// are the engine's (src/engine/model/ims.js, docs/tools/model.md).
import { complexitySolver } from '../../../engine/model/ims.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const UR_PARAMS = { simple: ['gamma'], cooley: ['gamma'], dbd: ['theta', 'kappa', 'gamma', 'momentum'] };
const UR_NAMES = { theta: 'theta', kappa: 'kappa', gamma: 'gamma', momentum: 'momentum' };
const BT_PARAMS = ['tolerance', 'reductionFactor', 'residualLimit'];
const BT_NAMES = { number: 'number of backtracks', tolerance: 'backtracking tolerance', reductionFactor: 'backtracking reduction factor', residualLimit: 'backtracking residual limit' };
const NUMBERS = ['relax', 'levels', 'dropTolerance', 'orthogonalizations', 'innerHclose'];

/** The optional solver settings of a loaded model, copied onto the page's solver s, with null for a value not given. */
export function readSolverOptions(json, s) {
  if (!json || typeof json !== 'object') return;
  if (json.linear === 'cg' || json.linear === 'bicgstab') s.linear = json.linear;
  else if (json.linear !== undefined) throw new Error('The solver\'s linear acceleration must be CG or BICGSTAB.');
  for (const k of NUMBERS) if (isNum(json[k])) s[k] = json[k];
  if (json.strict === true) s.strict = true;
  const ur = json.underRelaxation;
  if (ur && typeof ur === 'object') {
    if (!UR_PARAMS[ur.method]) throw new Error('The solver\'s under-relaxation must be SIMPLE, COOLEY or DBD.');
    s.underRelaxation = { method: ur.method };
    for (const k of UR_PARAMS[ur.method]) s.underRelaxation[k] = isNum(ur[k]) ? ur[k] : null;
  }
  const bt = json.backtracking;
  if (bt && typeof bt === 'object') {
    s.backtracking = { number: isNum(bt.number) ? bt.number : null };
    for (const k of BT_PARAMS) s.backtracking[k] = isNum(bt[k]) ? bt[k] : null;
  }
  if (json.noPtc === 'all' || json.noPtc === 'first') s.noPtc = json.noPtc;
}

/** What an option that is on still needs, as texts ("the under-relaxation's theta"). */
export function solverOptionGaps(s) {
  const out = [];
  const ur = s.underRelaxation;
  if (ur) for (const k of UR_PARAMS[ur.method]) if (ur[k] === null) out.push(`the ${ur.method.toUpperCase()} under-relaxation's ${UR_NAMES[k]}`);
  const bt = s.backtracking;
  if (bt) {
    if (bt.number === null) out.push(`the ${BT_NAMES.number}`);
    else if (bt.number > 0) for (const k of BT_PARAMS) if (bt[k] === null) out.push(`the ${BT_NAMES[k]}`);
  }
  return out;
}

/** Values given that the solver refuses, each { text, key }, key naming the input. */
export function solverOptionProblems(s) {
  const out = [];
  const bad = (key, text) => out.push({ key, text });
  if (isNum(s.relax) && !(s.relax >= 0 && s.relax <= 1)) bad('relax', 'The preconditioner\'s relaxation factor must be from 0 to 1.');
  for (const [k, what] of [['levels', 'preconditioner levels'], ['orthogonalizations', 'orthogonalizations']]) {
    if (s[k] !== undefined && !(Number.isInteger(s[k]) && s[k] >= 0)) bad(k, `The ${what} must be a whole number of at least 0.`);
  }
  if (s.dropTolerance !== undefined && !(s.dropTolerance >= 0)) bad('dropTolerance', 'The drop tolerance must be 0 or more.');
  if (s.innerHclose !== undefined && !(s.innerHclose > 0)) bad('innerHclose', 'The inner head closure must be above zero.');
  const ur = s.underRelaxation;
  if (ur) {
    for (const k of UR_PARAMS[ur.method]) if (ur[k] !== null && !(ur[k] >= 0)) bad(`ur.${k}`, `The under-relaxation's ${UR_NAMES[k]} must be 0 or more.`);
    if (ur.method === 'simple' && ur.gamma === 0) bad('ur.gamma', 'SIMPLE under-relaxation needs gamma above zero, as MODFLOW 6 requires.');
  }
  const bt = s.backtracking;
  if (bt) {
    if (bt.number !== null && !(Number.isInteger(bt.number) && bt.number >= 0)) bad('bt.number', 'The number of backtracks must be a whole number of at least 0.');
    // With no backtracks the other values are not used (solverForRun leaves them out), nor shown.
    if (bt.number > 0) for (const k of BT_PARAMS) if (bt[k] !== null && !(bt[k] >= 0)) bad(`bt.${k}`, `The ${BT_NAMES[k]} must be 0 or more.`);
  }
  return out;
}

/** The solver settings as run() and toMf6 take them: options that are off are left out. */
export function solverForRun(s) {
  const out = { outer: s.outer, inner: s.inner, hclose: s.hclose, rclose: s.rclose };
  if (s.linear === 'bicgstab') out.linear = 'bicgstab';
  for (const k of NUMBERS) if (isNum(s[k])) out[k] = s[k];
  if (!out.levels) { delete out.levels; delete out.dropTolerance; }
  if (out.orthogonalizations === 0) delete out.orthogonalizations;
  if (s.strict) out.strict = true;
  if (s.underRelaxation) out.underRelaxation = { ...s.underRelaxation };
  if (s.backtracking && s.backtracking.number > 0) out.backtracking = { ...s.backtracking };
  if (s.noPtc) out.noPtc = s.noPtc;
  return out;
}

/** The model's Newton-Raphson setting (docs/design/model.md newton), copied onto the page's model. */
export function readNewton(json, m) {
  const v = json && json.newton;
  if (v === true) m.newton = true;
  else if (v && typeof v === 'object') m.newton = v.underRelaxation === true ? { underRelaxation: true } : true;
}

/** NPF REWET and WETDRY of a loaded model onto the page's: rewet { wetfct, iwetit, ihdwet } and wetdry per layer (layers reads a per-layer list). */
export function readRewet(npf, m, layers) {
  if (!npf || !npf.rewet || typeof npf.rewet !== 'object') return;
  const num = (v) => (isNum(v) ? v : null);
  m.npf.rewet = { wetfct: num(npf.rewet.wetfct), iwetit: num(npf.rewet.iwetit), ihdwet: num(npf.rewet.ihdwet) };
  m.npf.wetdry = layers(npf.wetdry);
}

const REWET_NAMES = { wetfct: 'the wetting factor (WETFCT)', iwetit: 'the wetting interval (IWETIT)', ihdwet: 'the wetting head equation (IHDWET)' };

/** What REWET, when on, still needs. */
export function rewetGaps(m) {
  const r = m.npf.rewet;
  if (!r) return [];
  const out = Object.keys(REWET_NAMES).filter((k) => r[k] === null).map((k) => REWET_NAMES[k]);
  m.npf.wetdry.forEach((v, k) => { if (v === null) out.push(`the wetting threshold (WETDRY)${m.grid.nlay > 1 ? ` of layer ${k + 1}` : ''}`); });
  return out;
}

/** REWET values the solver refuses, each { text, key }. */
export function rewetProblems(m) {
  const r = m.npf.rewet;
  if (!r) return [];
  const out = [];
  if (r.iwetit !== null && !(Number.isInteger(r.iwetit) && r.iwetit >= 1)) out.push({ key: 'rw.iwetit', text: 'The wetting interval (IWETIT) must be a whole number of at least 1.' });
  if (r.ihdwet !== null && !Number.isInteger(r.ihdwet)) out.push({ key: 'rw.ihdwet', text: 'The wetting head equation (IHDWET) must be a whole number: 0 for the neighbour\'s head, another for the threshold.' });
  if (m.newton) out.push({ key: 'newton', text: 'Rewetting (REWET) cannot be used with the Newton-Raphson formulation, as MODFLOW 6 refuses it.' });
  return out;
}

/** REWET and WETDRY into the model to run, when on. */
export function rewetForRun(m, out, clone) {
  if (!m.npf.rewet) return;
  out.npf.rewet = { ...m.npf.rewet };
  out.npf.wetdry = m.npf.wetdry.map(clone);
}

/** What MODFLOW 6 refuses with NEWTON, each { text, key }. */
export function newtonProblems(m) {
  if (!m.newton) return [];
  const out = [];
  if (m.solver.linear !== 'bicgstab') out.push({ key: 'linear', text: 'The Newton-Raphson formulation needs BICGSTAB as the linear acceleration: its matrix is not symmetric, as MODFLOW 6 says.' });
  for (const [k, word] of [['perched', 'PERCHED'], ['variablecv', 'VARIABLECV']]) {
    if (m.npf && m.npf[k]) out.push({ key: 'newton', text: `The Newton-Raphson formulation cannot be used with ${word}, as MODFLOW 6 refuses it.` });
  }
  return out;
}

/** Every solver setting set to MODFLOW 6's for a COMPLEXITY, in place. */
export function useComplexity(s, name) {
  const p = complexitySolver(name);
  for (const k of ['linear', 'relax', 'levels', 'dropTolerance', 'orthogonalizations', 'innerHclose', 'underRelaxation', 'backtracking']) delete s[k];
  Object.assign(s, p);
}

// ---------------------------------------------------------------------------------------
// The page's part

const num = (t) => { const v = String(t).trim(); if (v === '') return undefined; const x = Number(v); return Number.isFinite(x) ? x : NaN; };

/**
 * The options' inputs for the solver panel. get() gives the page's model (its solver is
 * edited in place), edited() is called after each change, and notNumbers is the page's
 * map of entries that are not numbers. main is { inputs, labels }, the page's own inputs of
 * the four settings every model gives, which a COMPLEXITY sets too. Returns { node, fill,
 * mark(wrong) }: fill() shows the model's settings, mark(wrong) marks the inputs whose values
 * are missing or refused.
 */
export function solverOptions({ el, field, get, edited, notNumbers, main }) {
  const input = (id, mode = 'decimal', placeholder = '') => el('input', { id, inputmode: mode, placeholder });
  const labels = {
    innerHclose: 'Inner head closure (m)', relax: 'Preconditioner relaxation factor', levels: 'Preconditioner levels', dropTolerance: 'Drop tolerance',
    orthogonalizations: 'Orthogonalizations', 'ur.theta': 'Theta', 'ur.kappa': 'Kappa', 'ur.gamma': 'Gamma', 'ur.momentum': 'Momentum',
    'bt.number': 'Backtracks, at most', 'bt.tolerance': 'Backtracking tolerance', 'bt.reductionFactor': 'Reduction factor', 'bt.residualLimit': 'Residual limit (m³/d)',
  };
  const inputs = {
    innerHclose: input('mInnerHclose', 'decimal', 'the head closure'), relax: input('mRelax', 'decimal', '0.97'),
    levels: input('mLevels', 'numeric', '0'), dropTolerance: input('mDropTol'), orthogonalizations: input('mNorth', 'numeric', '0'),
    'ur.theta': input('mUrTheta'), 'ur.kappa': input('mUrKappa'), 'ur.gamma': input('mUrGamma'), 'ur.momentum': input('mUrMomentum'),
    'bt.number': input('mBtNumber', 'numeric', '0'), 'bt.tolerance': input('mBtTol'), 'bt.reductionFactor': input('mBtReduce'), 'bt.residualLimit': input('mBtLimit'),
  };
  const linear = el('select', { id: 'mLinear' }, el('option', { value: 'cg' }, 'CG'), el('option', { value: 'bicgstab' }, 'BICGSTAB'));
  const formulation = el('select', { id: 'mFormulation' }, el('option', { value: '' }, 'Standard'), el('option', { value: 'newton' }, 'Newton-Raphson'), el('option', { value: 'newton-ur' }, 'Newton-Raphson, with its under-relaxation'));
  const ptc = el('select', { id: 'mPtc' }, el('option', { value: '' }, 'In every steady period (MODFLOW 6\'s default)'), el('option', { value: 'first' }, 'Not in the first period (NO_PTC FIRST)'), el('option', { value: 'all' }, 'In no period (NO_PTC ALL)'));
  formulation.addEventListener('change', () => {
    const m = get();
    if (!m) return;
    if (!formulation.value) delete m.newton;
    else m.newton = formulation.value === 'newton-ur' ? { underRelaxation: true } : true;
    fill(true);
    edited();
  });
  ptc.addEventListener('change', () => { const m = get(); if (!m) return; if (ptc.value) m.solver.noPtc = ptc.value; else delete m.solver.noPtc; edited(); });
  const urMethod = el('select', { id: 'mUr' }, el('option', { value: '' }, 'None'), el('option', { value: 'simple' }, 'SIMPLE'), el('option', { value: 'cooley' }, 'COOLEY'), el('option', { value: 'dbd' }, 'DBD (delta-bar-delta)'));
  const complexity = el('select', { id: 'mComplexity', 'aria-label': 'COMPLEXITY' }, el('option', { value: '' }, 'Choose'), el('option', { value: 'SIMPLE' }, 'SIMPLE'), el('option', { value: 'MODERATE' }, 'MODERATE'), el('option', { value: 'COMPLEX' }, 'COMPLEX'));
  const useButton = el('button', { class: 'btn quiet small', type: 'button', disabled: true }, 'Use MODFLOW 6\'s values');
  complexity.addEventListener('change', () => { useButton.disabled = !complexity.value; });
  useButton.addEventListener('click', () => {
    const m = get();
    if (!m || !complexity.value) return;
    useComplexity(m.solver, complexity.value);
    for (const label of Object.values(labels)) notNumbers.delete(label);
    // The four main settings too: a COMPLEXITY sets them, so an entry left there that is not a
    // number gives way to MODFLOW 6's value.
    if (main) {
      for (const [key, box] of Object.entries(main.inputs)) {
        notNumbers.delete(main.labels[key]);
        box.classList.remove('bad');
        box.value = m.solver[key] === null || m.solver[key] === undefined ? '' : String(m.solver[key]);
      }
    }
    fill(true);
    edited();
  });

  // Where each input's value lives in the solver.
  const place = (s, key) => {
    if (key.startsWith('ur.')) return [s.underRelaxation, key.slice(3)];
    if (key.startsWith('bt.')) {
      if (!s.backtracking) s.backtracking = { number: null, tolerance: null, reductionFactor: null, residualLimit: null };
      return [s.backtracking, key.slice(3)];
    }
    return [s, key];
  };
  for (const [key, box] of Object.entries(inputs)) {
    box.addEventListener('input', () => {
      const m = get();
      if (!m) return;
      const v = num(box.value);
      if (Number.isNaN(v)) { notNumbers.set(labels[key], true); box.classList.add('bad'); edited(); return; }
      notNumbers.delete(labels[key]); box.classList.remove('bad');
      const [obj, k] = place(m.solver, key);
      if (!obj) return;
      // An optional setting left empty is the solver's default; a value an option needs is null.
      if (v === undefined) {
        if (obj === m.solver) delete obj[k];
        else obj[k] = null;
      } else obj[k] = v;
      if (key === 'bt.number' && v === undefined) delete m.solver.backtracking;
      if (key === 'levels') show();
      if (key === 'bt.number') show();
      edited();
    });
  }
  linear.addEventListener('change', () => { const m = get(); if (!m) return; if (linear.value === 'cg') delete m.solver.linear; else m.solver.linear = linear.value; edited(); });
  urMethod.addEventListener('change', () => {
    const m = get();
    if (!m) return;
    const old = m.solver.underRelaxation;
    if (!urMethod.value) delete m.solver.underRelaxation;
    else {
      // Values already given for another method are kept where the new one uses them.
      m.solver.underRelaxation = { method: urMethod.value };
      for (const k of UR_PARAMS[urMethod.value]) m.solver.underRelaxation[k] = old && isNum(old[k]) ? old[k] : null;
    }
    fill(true);
    edited();
  });

  // REWET (NPF) and WETDRY, one value per layer here (an array from MODFLOW 6 files is kept).
  const rewetSel = el('select', { id: 'mRewet' }, el('option', { value: '' }, 'Off: a dry cell stays dry'), el('option', { value: 'on' }, 'On (REWET)'));
  const rw = { wetfct: input('mWetfct'), iwetit: input('mIwetit', 'numeric'), ihdwet: el('select', { id: 'mIhdwet' }, el('option', { value: '' }, 'Choose'), el('option', { value: '0' }, '0: from the neighbour\'s head'), el('option', { value: '1' }, '1: from the threshold')) };
  const rwLabels = { wetfct: 'Wetting factor (WETFCT)', iwetit: 'Wetting interval (IWETIT)', ihdwet: 'Head of a wetted cell (IHDWET)' };
  const wetdryBox = el('div', { class: 'fields' });
  // Turned off, REWET's values are kept here, so turning it on again for the same model brings
  // back what was given (from the files or typed), the cell-by-cell WETDRY too.
  let offRewet = null;
  rewetSel.addEventListener('change', () => {
    const m = get();
    if (!m) return;
    if (!rewetSel.value) {
      if (m.npf.rewet) offRewet = { m, rewet: m.npf.rewet, wetdry: m.npf.wetdry };
      delete m.npf.rewet; delete m.npf.wetdry;
    } else if (offRewet && offRewet.m === m) {
      m.npf.rewet = offRewet.rewet;
      m.npf.wetdry = offRewet.wetdry;
    } else {
      m.npf.rewet = { wetfct: null, iwetit: null, ihdwet: null };
      m.npf.wetdry = new Array(m.grid.nlay).fill(null);
    }
    fill(true);
    edited();
  });
  for (const k of ['wetfct', 'iwetit']) {
    rw[k].addEventListener('input', () => {
      const m = get();
      if (!m || !m.npf.rewet) return;
      const v = num(rw[k].value);
      if (Number.isNaN(v)) { notNumbers.set(rwLabels[k], true); rw[k].classList.add('bad'); edited(); return; }
      notNumbers.delete(rwLabels[k]); rw[k].classList.remove('bad');
      m.npf.rewet[k] = v === undefined ? null : v;
      edited();
    });
  }
  rw.ihdwet.addEventListener('change', () => { const m = get(); if (!m || !m.npf.rewet) return; m.npf.rewet.ihdwet = rw.ihdwet.value === '' ? null : Number(rw.ihdwet.value); edited(); });
  const rewetFields = el('div', { class: 'fields' }, ['wetfct', 'iwetit', 'ihdwet'].map((k) => el('div', { class: 'field' }, el('label', { for: rw[k].id }, rwLabels[k]), rw[k])));
  // WETDRY given cell by cell (from the files), per model and layer: a value typed over it
  // replaces it, and clearing the box brings it back.
  const fileWetdry = new WeakMap();
  const wetdryLabel = (k) => `WETDRY of layer ${k + 1} (m)`;
  let wetdryInputs = [];
  function buildWetdry(m) {
    // The boxes are made again from the model, so entries in the old ones that were not
    // numbers go, and with them what they held back.
    for (const label of [...notNumbers.keys()]) if (/^WETDRY of layer \d+ \(m\)$/.test(label)) notNumbers.delete(label);
    wetdryBox.replaceChildren();
    wetdryInputs = [];
    if (!m.npf.rewet) return;
    if (!fileWetdry.has(m)) fileWetdry.set(m, []);
    const files = fileWetdry.get(m);
    m.npf.wetdry.forEach((v, k) => {
      if (Array.isArray(v)) files[k] = v;
      const label = wetdryLabel(k);
      const box = el('input', { id: `mWetdry${k}`, inputmode: 'decimal', placeholder: Array.isArray(v) ? 'cell by cell, from the files' : '' });
      if (!Array.isArray(v)) box.value = v === null ? '' : String(v);
      box.addEventListener('input', () => {
        const x = num(box.value);
        if (Number.isNaN(x)) { notNumbers.set(label, true); box.classList.add('bad'); edited(); return; }
        notNumbers.delete(label); box.classList.remove('bad');
        m.npf.wetdry[k] = x === undefined ? files[k] ?? null : x;
        box.placeholder = x === undefined && files[k] ? 'cell by cell, from the files' : '';
        edited();
      });
      wetdryInputs.push(box);
      wetdryBox.append(el('div', { class: 'field' }, el('label', { for: box.id }, label), box,
        files[k] ? el('span', { class: 'hint' }, 'Cell by cell from the files. A value typed here replaces them; clearing it brings them back.') : null));
    });
  }
  const ptcField = el('div', { class: 'field' }, el('label', { for: ptc.id }, 'Pseudo-transient continuation'), ptc, el('span', { class: 'hint' }, 'Newton-Raphson only, in steady periods'));
  const fieldOf = {};
  for (const [key, box] of Object.entries(inputs)) fieldOf[key] = field(labels[key], box);
  const urFields = el('div', { class: 'fields' }, ['ur.theta', 'ur.kappa', 'ur.gamma', 'ur.momentum'].map((k) => fieldOf[k]));
  const btFields = el('div', { class: 'fields' }, ['bt.tolerance', 'bt.reductionFactor', 'bt.residualLimit'].map((k) => fieldOf[k]));
  const node = el('div', { class: 'model-solver-options' },
    el('h3', {}, 'How the iterations are taken'),
    el('p', { class: 'hint' }, 'As MODFLOW 6 IMS takes them. Left empty, each is MODFLOW 6\'s default for a file with no COMPLEXITY (SIMPLE): CG, no under-relaxation or backtracking, the inner closure equal to the head closure; the relaxation factor is this page\'s 0.97. A COMPLEXITY sets all of them, and the four above, to MODFLOW 6\'s own values.'),
    el('div', { class: 'fields' }, el('div', { class: 'field' }, el('label', { for: complexity.id }, 'MODFLOW 6 COMPLEXITY'), complexity, useButton)),
    el('div', { class: 'fields' },
      el('div', { class: 'field' }, el('label', { for: linear.id }, 'Linear acceleration'), linear, el('span', { class: 'hint' }, 'LINEAR_ACCELERATION')),
      fieldOf.innerHclose, fieldOf.relax, fieldOf.levels, fieldOf.dropTolerance, fieldOf.orthogonalizations),
    el('div', { class: 'fields' },
      el('div', { class: 'field' }, el('label', { for: formulation.id }, 'Formulation'), formulation, el('span', { class: 'hint' }, 'NEWTON in the GWF name file: no cell dries, and the matrix needs BICGSTAB')),
      ptcField),
    el('div', { class: 'fields' }, el('div', { class: 'field' }, el('label', { for: urMethod.id }, 'Under-relaxation'), urMethod, el('span', { class: 'hint' }, 'UNDER_RELAXATION, of the heads between outer iterations')), fieldOf['bt.number']),
    urFields, btFields,
    el('div', { class: 'fields' }, el('div', { class: 'field' }, el('label', { for: rewetSel.id }, 'Rewetting of dry cells'), rewetSel,
      el('span', { class: 'hint' }, 'NPF REWET, standard formulation only. WETDRY: 0 never wets; above 0 the cell below or beside can wet it, below 0 only the cell below (or above); its size, from the bottom, is the head that wets it.'))),
    rewetFields, wetdryBox);

  function show() {
    const m = get();
    if (!m) return;
    const s = m.solver, ur = s.underRelaxation;
    for (const k of ['theta', 'kappa', 'gamma', 'momentum']) fieldOf[`ur.${k}`].hidden = !(ur && UR_PARAMS[ur.method].includes(k));
    urFields.hidden = !ur;
    btFields.hidden = !(s.backtracking && s.backtracking.number > 0);
    fieldOf.dropTolerance.hidden = !(s.levels > 0);
    ptcField.hidden = !m.newton;
    rewetFields.hidden = !m.npf.rewet;
    // An entry that is not a number in a field now hidden goes, with its mark, so nothing
    // unseen holds back Run and Export; the field shows the model's value when it comes back.
    const hiddenNow = (key) => fieldOf[key].hidden || (key.startsWith('ur.') && urFields.hidden) || (key !== 'bt.number' && key.startsWith('bt.') && btFields.hidden);
    for (const [key, box] of Object.entries(inputs)) {
      if (!hiddenNow(key) || !notNumbers.delete(labels[key])) continue;
      box.classList.remove('bad');
      const [obj, k] = key.startsWith('ur.') ? [s.underRelaxation, key.slice(3)] : key.startsWith('bt.') ? [s.backtracking, key.slice(3)] : [s, key];
      box.value = obj && obj[k] !== null && obj[k] !== undefined ? String(obj[k]) : '';
    }
    if (!m.npf.rewet) {
      for (const k of ['wetfct', 'iwetit']) if (notNumbers.delete(rwLabels[k])) { rw[k].classList.remove('bad'); rw[k].value = ''; }
    }
  }
  /** Show the model's settings; force writes even into the input being edited. */
  function fill(force = false) {
    const m = get();
    if (!m) return;
    const s = m.solver;
    const set = (box, v) => { if ((force || document.activeElement !== box) && (force || !box.classList.contains('bad'))) box.value = v === null || v === undefined ? '' : String(v); };
    for (const key of Object.keys(inputs)) {
      const [obj, k] = key.startsWith('ur.') ? [s.underRelaxation, key.slice(3)] : key.startsWith('bt.') ? [s.backtracking, key.slice(3)] : [s, key];
      set(inputs[key], obj ? obj[k] : undefined);
      if (force) inputs[key].classList.remove('bad');
    }
    linear.value = s.linear || 'cg';
    urMethod.value = s.underRelaxation ? s.underRelaxation.method : '';
    formulation.value = !m.newton ? '' : m.newton.underRelaxation ? 'newton-ur' : 'newton';
    ptc.value = s.noPtc || '';
    rewetSel.value = m.npf.rewet ? 'on' : '';
    if (m.npf.rewet) {
      for (const k of ['wetfct', 'iwetit']) if (force || document.activeElement !== rw[k]) rw[k].value = m.npf.rewet[k] === null ? '' : String(m.npf.rewet[k]);
      rw.ihdwet.value = m.npf.rewet.ihdwet === null ? '' : m.npf.rewet.ihdwet === 0 ? '0' : '1';
    }
    if (force || !wetdryBox.contains(document.activeElement)) buildWetdry(m);
    show();
  }
  function mark(wrongKeys, gaps) {
    const m = get();
    if (!m) return;
    const s = m.solver;
    for (const [key, box] of Object.entries(inputs)) {
      const [obj, k] = key.startsWith('ur.') ? [s.underRelaxation, key.slice(3)] : key.startsWith('bt.') ? [s.backtracking, key.slice(3)] : [s, key];
      box.closest('.field').classList.toggle('missing', Boolean(gaps && obj && obj[k] === null));
      box.classList.toggle('bad', wrongKeys.has(key) || notNumbers.has(labels[key]));
    }
    linear.classList.toggle('bad', wrongKeys.has('linear'));
    formulation.classList.toggle('bad', wrongKeys.has('newton'));
    // REWET's values, marked as needed and as wrong as the other fields are.
    const r = m.npf.rewet;
    for (const k of ['wetfct', 'iwetit', 'ihdwet']) {
      rw[k].closest('.field').classList.toggle('missing', Boolean(gaps && r && r[k] === null));
      rw[k].classList.toggle('bad', wrongKeys.has(`rw.${k}`) || notNumbers.has(rwLabels[k] ?? ''));
    }
    wetdryInputs.forEach((box, k) => {
      box.closest('.field').classList.toggle('missing', Boolean(gaps && r && m.npf.wetdry && m.npf.wetdry[k] === null));
      box.classList.toggle('bad', notNumbers.has(wetdryLabel(k)));
    });
  }
  return { node, fill, mark };
}
