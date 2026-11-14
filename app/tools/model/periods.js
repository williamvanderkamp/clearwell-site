// The model page's stress periods and solver: each period's length, time steps, multiplier,
// steady or transient and recharge, where recharge goes, and MODFLOW 6 IMS's settings.
import { el, listed, together } from '../../kit.js';
import { addPeriod, listsLostWith, PACKAGE_IDS, PACKAGES, removePeriod, rchLayer, setLayerValue, setRchFixedCell, setRchLayer, sourcePeriod } from './edit-model.js';
import { field, num, tiny, withUnit } from './common.js';
import { numberInput } from './layers.js';
import { solverOptions } from './solver.js';

/** The periods panel; offers page.buildPeriods, fillPeriods, showSolverWords, markPeriods and resetPeriods. */
export function mountPeriods(page) {
  const { view, notNumbers } = page;
  const periodsBody = el('tbody');
  const periodInputs = [];
  const si = {
    outer: el('input', { id: 'mOuter', inputmode: 'numeric' }), inner: el('input', { id: 'mInner', inputmode: 'numeric' }),
    hclose: el('input', { id: 'mHclose', inputmode: 'decimal' }), rclose: el('input', { id: 'mRclose', inputmode: 'decimal' }),
  };
  const solverLabels = { outer: 'Outer iterations', inner: 'Inner iterations', hclose: 'Head closure (m)', rclose: 'Residual closure (m³/d)' };
  // The closures in powers of ten, as the layers' values are (layers.js showWords).
  const solverWords = el('p', { class: 'hint', hidden: true });
  function showSolverWords() {
    const { model } = page;
    if (!model) return;
    const sv = ['hclose', 'rclose'].filter((key) => tiny(model.solver[key])).map((key) => `the ${solverLabels[key].replace(/ \(.*\)$/, '').toLowerCase()} is ${withUnit(model.solver[key], key === 'hclose' ? 'm' : 'm³/d')}`);
    solverWords.textContent = sv.length ? together(`In powers of ten: ${sv.join('; ')}.`) : '';
    solverWords.hidden = !sv.length;
  }
  // The other IMS settings: acceleration, preconditioner, under-relaxation, backtracking.
  const solverMore = solverOptions({ el, field, get: () => page.model, edited: () => page.edited(), notNumbers, main: { inputs: si, labels: solverLabels } });
  for (const [key, input] of Object.entries(si)) {
    input.addEventListener('input', () => {
      const v = num(input.value);
      if (Number.isNaN(v)) { notNumbers.set(solverLabels[key], true); input.classList.add('bad'); } else { notNumbers.delete(solverLabels[key]); input.classList.remove('bad'); page.model.solver[key] = v === undefined ? null : v; }
      page.edited();
    });
  }
  // Where recharge goes (RCHA IRCH) and whether it moves down from a dry cell (FIXED_CELL).
  const rchOn = el('select', { id: 'mRchOn' });
  rchOn.addEventListener('change', () => {
    const v = rchOn.value;
    if (v === 'files' || v === 'list') return;
    setRchLayer(page.model, v.startsWith('layer:') ? 'layer' : v, v.startsWith('layer:') ? Number(v.slice(6)) : undefined);
    page.edited();
  });
  const rchFixed = el('select', { id: 'mRchFixed' }, el('option', { value: 'move' }, 'Goes to the highest active cell below'), el('option', { value: 'fixed' }, 'Is not applied (FIXED_CELL)'));
  rchFixed.addEventListener('change', () => { setRchFixedCell(page.model, rchFixed.value === 'fixed'); page.edited(); });
  function fillRecharge() {
    const { model } = page;
    const now = rchLayer(model);
    // A recharge list gives each cell itself, so it is the one choice shown.
    const opts = now.kind === 'list' ? [['list', 'The cells the recharge list gives']] : [['layer1', 'Layer 1 (MODFLOW 6\'s default)'], ['top', 'The top active cell of each column']];
    if (now.kind !== 'list') for (let k = 1; k < model.grid.nlay; k++) opts.push([`layer:${k}`, `Layer ${k + 1}`]);
    if (now.kind === 'files') opts.push(['files', 'The layers the model\'s files give (IRCH)']);
    rchOn.replaceChildren(...opts.map(([v, t]) => el('option', { value: v }, t)));
    rchOn.value = now.kind === 'layer' ? (now.layer === 0 ? 'layer1' : `layer:${now.layer}`) : now.kind;
    rchOn.disabled = Boolean(model.rchList);
    const key = model.rchList ? 'rchList' : 'rch';
    rchFixed.value = model.options && model.options[key] && model.options[key].fixedCell ? 'fixed' : 'move';
  }
  const periodsPanel = el('section', { class: 'panel model-periods', 'aria-labelledby': 'mPeriodsHead', hidden: true },
    el('h2', { id: 'mPeriodsHead' }, 'Stress periods'),
    el('p', { class: 'hint' }, 'Time steps within a period grow by the multiplier, as in MODFLOW 6. A period with no recharge entry keeps the one before it; 0 turns recharge off.'),
    el('div', { class: 'tablewrap' }, el('table', { class: 'model-table' },
      el('thead', {}, el('tr', {}, ['Period', 'Length (d)', 'Time steps', 'Step multiplier', 'Steady or transient', 'Recharge (m/d)', ''].map((h) => el('th', {}, h)))),
      periodsBody)),
    el('div', { class: 'btn-row' }, el('button', { class: 'btn quiet', type: 'button', onclick: () => { addPeriod(page.model); buildPeriods(); page.edited(); } }, 'Add a period')),
    el('div', { class: 'fields' }, field('Recharge goes to', rchOn, 'As MODFLOW 6\'s RCHA with IRCH: layer 1 unless another layer is chosen. Recharge on a cell with idomain 0 is lost, as MODFLOW 6 drops it, so a top layer with inactive cells needs the top active cell.'), field('Recharge on a dry cell', rchFixed, 'Without FIXED_CELL, MODFLOW 6 puts it on the highest active cell below.')),
    el('h3', {}, 'Solver'),
    el('p', { class: 'hint' }, 'As MODFLOW 6 IMS takes them: OUTER_MAXIMUM, INNER_MAXIMUM, OUTER_DVCLOSE (also the inner head closure, unless one is given below) and INNER_RCLOSE. A step that does not converge stops the run with a message.'),
    el('div', { class: 'fields' }, Object.entries(si).map(([key, input]) => field(solverLabels[key], input))), solverWords, solverMore.node);
  page.root.append(periodsPanel);

  function buildPeriods() {
    periodsBody.textContent = '';
    periodInputs.length = 0;
    page.model.periods.forEach((p, i) => {
      const mk = (key, label, mode) => {
        const input = el('input', { inputmode: mode, 'aria-label': `${label} of period ${i + 1}` });
        input.addEventListener('input', () => {
          const v = num(input.value);
          const name = `${label} of period ${i + 1}`;
          if (Number.isNaN(v)) { notNumbers.set(name, true); input.classList.add('bad'); } else { notNumbers.delete(name); input.classList.remove('bad'); p[key] = v === undefined ? null : v; }
          page.edited();
        });
        return input;
      };
      const length = mk('length', 'Length', 'decimal'), nstp = mk('nstp', 'Time steps', 'numeric'), tsmult = mk('tsmult', 'Step multiplier', 'decimal');
      const steady = el('select', { 'aria-label': `Steady or transient, period ${i + 1}` }, el('option', { value: '' }, 'Choose'), el('option', { value: 'steady' }, 'Steady'), el('option', { value: 'transient' }, 'Transient'));
      steady.addEventListener('change', () => { p.steady = steady.value === '' ? null : steady.value === 'steady'; page.edited(); });
      const rch = el('input', { inputmode: 'decimal', 'aria-label': `Recharge in period ${i + 1}`, disabled: Boolean(page.model.rchList) });
      numberInput(page, rch, `Recharge of period ${i + 1}`, () => (page.model.rch ? page.model.rch[i] : undefined), (v) => setLayerValue(page.model, 'rch', 0, v, i));
      const remove = el('button', { class: 'btn quiet small', type: 'button', 'aria-label': `Remove period ${i + 1}`, onclick: () => askRemovePeriod(i) }, 'Remove');
      periodInputs.push({ length, nstp, tsmult, steady, rch });
      periodsBody.append(el('tr', {}, el('td', {}, String(i + 1)), [length, nstp, tsmult, steady, rch].map((x) => el('td', {}, x)), el('td', {}, remove)));
    });
    fillPeriods();
    page.buildPeriodSelect();
  }
  // A period's own lists that a later period inherits move to that period, so nothing a
  // later period uses is lost. Lists no other period uses would go with it: ask first.
  const periodConfirm = el('div', { class: 'model-confirm', hidden: true });
  function askRemovePeriod(i) {
    const { model } = page;
    const lost = listsLostWith(model, i);
    const go = () => {
      periodConfirm.hidden = true;
      const kept = [...PACKAGE_IDS, 'rch', 'evt'].filter((id) => model[id] && model[id][i] !== undefined && !lost.includes(id));
      removePeriod(model, i);
      if (view.period >= model.periods.length) view.period = Math.max(0, model.periods.length - 1);
      buildPeriods();
      page.edited();
      page.noteMap(kept.length ? `Period ${i + 1} was removed. Its ${listNames(kept)} now belong to the period after it, which used them.` : `Period ${i + 1} was removed.`);
    };
    if (!lost.length) { go(); return; }
    periodConfirm.replaceChildren(
      el('p', {}, `Period ${i + 1} has its own ${listNames(lost)}, which no other period uses. Removing the period removes ${lost.length === 1 && lost[0] === 'rch' ? 'it' : 'them'} too.`),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', type: 'button', onclick: go }, `Remove period ${i + 1}`),
        el('button', { class: 'btn quiet', type: 'button', onclick: () => { periodConfirm.hidden = true; } }, 'Keep it')));
    periodConfirm.hidden = false;
  }
  const listNames = (ids) => {
    const names = ids.map((id) => (id === 'rch' ? 'recharge' : id === 'evt' ? 'evapotranspiration arrays' : PACKAGES[id].plural.toLowerCase()));
    return listed(names);
  };
  periodsBody.closest('table').parentElement.after(periodConfirm);

  function fillPeriods() {
    const { model } = page;
    const set = (input, v) => { if (document.activeElement !== input && !input.classList.contains('bad')) input.value = v === null || v === undefined ? '' : String(v); };
    model.periods.forEach((p, i) => {
      const x = periodInputs[i];
      if (!x) return;
      set(x.length, p.length); set(x.nstp, p.nstp); set(x.tsmult, p.tsmult);
      if (document.activeElement !== x.steady) x.steady.value = p.steady === null ? '' : p.steady ? 'steady' : 'transient';
      const own = model.rch && model.rch[i] !== undefined ? model.rch[i] : undefined;
      if (document.activeElement !== x.rch) {
        x.rch.value = typeof own === 'number' ? String(own) : '';
        const from = sourcePeriod(model.rch, i);
        x.rch.placeholder = model.rchList ? 'as a list' : Array.isArray(own) ? 'painted' : from >= 0 && from < i ? `as period ${from + 1}` : model.rch ? 'none' : '';
      }
    });
    for (const [key, input] of Object.entries(si)) set(input, model.solver[key]);
    solverMore.fill();
    fillRecharge();
  }

  // Every empty value the model needs is marked, and every impossible one is marked bad.
  function markPeriods(wrong) {
    const badPeriod = new Set(wrong.filter((w) => w.field && w.field.period !== undefined).map((w) => `${w.field.period}|${w.field.key}`));
    const badSolver = new Set(wrong.filter((w) => w.field && w.field.solver).map((w) => w.field.solver));
    page.model.periods.forEach((p, i) => {
      const x = periodInputs[i];
      if (!x) return;
      x.length.classList.toggle('missing', p.length === null);
      x.nstp.classList.toggle('missing', p.nstp === null);
      x.tsmult.classList.toggle('missing', p.tsmult === null);
      x.steady.classList.toggle('missing', typeof p.steady !== 'boolean');
      for (const key of ['length', 'nstp', 'tsmult']) x[key].classList.toggle('bad', badPeriod.has(`${i}|${key}`) || notNumbers.has(`${{ length: 'Length', nstp: 'Time steps', tsmult: 'Step multiplier' }[key]} of period ${i + 1}`));
    });
    for (const [key, input] of Object.entries(si)) {
      input.closest('.field').classList.toggle('missing', page.model.solver[key] === null);
      input.classList.toggle('bad', badSolver.has(key) || notNumbers.has(solverLabels[key]));
    }
    solverMore.mark(badSolver, true);
  }

  // A new model: the question before removing a period goes, and the panel shows.
  function resetPeriods() {
    periodConfirm.hidden = true;
    periodsPanel.hidden = false;
  }

  Object.assign(page, { buildPeriods, fillPeriods, showSolverWords, markPeriods, resetPeriods });
}
