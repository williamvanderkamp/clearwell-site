// Fit a pumping test solution: any solution in src/engine/solutions/ fitted to drawdown
// against time at one observation point, with each fitted value's standard error and 95%
// interval, as AQTESOLV does. The page knows the solutions only through the shared
// interface (docs/design/solutions.md), so a new solution appears here by itself.
// The page: its form, the fit and the results. The names and units of the inputs and
// values are in labels.js, the examples in examples.js, and the words in text.js.
import { RATE_UNITS, TIME_NAMES, TIME_UNITS, UNITS } from '../../../engine/index.js';
import { COMPARE_ON, fitWithCurve, GRID_COMBOS, logScale, SHORT, TIME_LIMIT } from '../../../engine/fit.js';
import { bourdetDerivative } from '../../../engine/pumping.js';
import { SOLUTIONS } from '../../../engine/solutions/index.js';
import { boundaryLayout } from '../../../engine/superpose.js';
import { timeUnitIn, unitInLabel } from '../../columns.js';
import { predictButton } from '../../handoff.js';
import { verdictOf } from '../../verdicts.js';
import { startJob } from '../../worker-job.js';
import { listed, six, together } from '../../../engine/format.js';
import { chart, columnSpec, columnValues, done, downloads, downloadWorkbook, el, errorBox, fileDrop, findColumn, fixed, form, methodPanel, notes, panel, sig, table, TIME_OPTIONS, unitOptions } from '../../kit.js';
import { FROM_FIT } from '../predict-fit.js';
import { EXAMPLES } from './examples.js';
import { fieldId, geometryKeys, geometryLabel, geometryText, hintOf, kindOf, sheetUnit, shortName, symbolOf, unitOf, withUnit } from './labels.js';
import { four, interval, intervalNote, inUserUnits, methodText, STATS_PLAIN, three, unknownCode, warnings, whyOf } from './text.js';

const DRAWDOWN_UNITS = ['m', 'cm', 'ft'];
const LENGTH_UNITS = ['m', 'ft'];
const RATES = unitOptions(Object.keys(RATE_UNITS));
const FAMILIES = [['confined', 'Confined'], ['leaky', 'Leaky'], ['unconfined', 'Unconfined'], ['fractured', 'Fractured rock']];
const BY_ID = Object.fromEntries(SOLUTIONS.map((s) => [s.id, s]));

// Positions and depths that may be zero, and casing radii, where 0 means no casing
// storage or no lag; every other length must be above zero.
const ZERO_OK = ['x', 'y', 'd', 'z1', 'z2', 'rc', 'rcObs'];
// What the observation point needs only when it is not the pumped well itself.
const OBS_ONLY = ['z1', 'z2', 'rcObs'];

// ---------------------------------------------------------------------------------------
// Reading the form.

/** "0 500; 120 800; 240 0" into [[0, 500], [120, 800], [240, 0]], or a message. */
export function parseRates(text) {
  const parts = String(text || '').split(/[;\n]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error('The table of rate changes is empty. Write each change as a time and a rate, for example 0 500; 120 800.');
  const rows = parts.map((p, i) => {
    const v = p.split(/[\s,]+/).filter(Boolean).map((x) => (x === '' ? NaN : Number(x)));
    if (v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`Rate change ${i + 1} ("${p}") is not a time and a rate. Write each change as a time and a rate, changes separated by semicolons.`);
    return v;
  });
  if (rows[0][0] !== 0) throw new Error(`The first rate change must be at time 0, the start of pumping, not ${rows[0][0]}.`);
  if (!(rows[0][1] > 0)) throw new Error('The rate at the start of pumping must be above zero.');
  rows.forEach(([t, q], i) => {
    if (q < 0) throw new Error(`Rate change ${i + 1} has a rate below zero.`);
    if (i && !(t > rows[i - 1][0])) throw new Error(`The times of the rate changes must rise: change ${i + 1} (${t}) is not after change ${i} (${rows[i - 1][0]}).`);
  });
  return rows;
}

// The fit runs in a Web Worker, so the page stays live while a Laplace solution takes
// its few seconds. Where a worker cannot start, or fails to load, it runs here, after the
// page has drawn the "Fitting" line. Gives startJob's { promise, stop } (worker-job.js): a
// promise of the result, and a stop that ends the fit if it is still running, as leaving
// the page does, after which the promise never settles.
function fitOffPage(job, onProgress, signal) {
  const { solution, ...input } = job.input;
  return startJob(new URL('./worker.js', import.meta.url), { id: solution.id, input }, {
    onProgress, fallback: () => fitWithCurve(job.input), delay: 20, signal, failed: 'The fit stopped with an error.',
  });
}

// ms before a running fit offers a Cancel button, so a quick fit does not flash it.
const CANCEL_AFTER = 1500;

// ---------------------------------------------------------------------------------------

export default {
  id: 'solutions',
  group: 'tests',
  title: 'Fit a pumping test solution',
  blurb: 'Choose a published solution from a library, confined, leaky, unconfined or fractured rock, and fit it to your drawdown, with a standard error and 95% interval on every value.',
  lede: 'A published pumping test solution fitted by least squares to drawdown against time at one observation point, as AQTESOLV does. Any value can be held fixed. Variable rates and straight boundaries are added by superposition.',
  mount(host, signal) {
    let data = null, example = null, runs = 0, fit = null;
    // A fit still running for an earlier run or file, or once the page is left, is no
    // longer wanted.
    const stop = () => { runs++; if (fit) fit.stop(); fit = null; };
    signal.addEventListener('abort', stop);
    const out = el('div', { class: 'stack' });
    // Set by any edit while a fit runs.
    let editedDuring = false;
    const showError = (message) => out.append(errorBox(message));
    const drop = fileDrop(host, {
      text: 'A CSV or Excel file with elapsed time and drawdown at one observation point.',
      examples: EXAMPLES,
      onTable(loaded) {
        const { header } = loaded.table;
        data = loaded;
        example = loaded.example || null;
        stop();
        out.textContent = '';
        f.reset();
        f.setColumns(header);
        const t = findColumn(header, /time|elapsed/i), s = findColumn(header, /draw.?down/i);
        if (t !== undefined) { f.set('tCol', t); f.set('tUnit', timeUnitIn(header[t]) || undefined); }
        if (s !== undefined) { f.set('sCol', s); f.set('sUnit', unitInLabel(header[s], DRAWDOWN_UNITS) || undefined); }
        if (example) Object.entries(example.values).forEach(([k, val]) => f.set(k, val));
        syncSolution();
        // One format on every tool: the file and its rows, then for an example its note.
        drop.status(`${loaded.name}: ${loaded.table.rows.length} rows.${example ? ` ${example.note}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Elapsed time', need: 'Required', what: 'Time since pumping began, as a number. Seconds, minutes, hours or days: you choose which.', headings: ['Time (min)', 'Time (d)'] },
        { name: 'Drawdown', need: 'Required', what: 'Drop in water level at the observation point since pumping began, positive downwards. Recovery readings may follow, with the rate changes given below.', headings: ['Drawdown (m)', 'Drawdown (ft)'] },
      ],
      notes: ['One observation point per file.', 'The pumping rate is entered below, constant or as a table of rate changes.', 'Drawdown should already be corrected for anything that is not pumping, such as barometric or tidal changes. The well record tool can do that.'],
      examples: EXAMPLES.map((x) => ({ label: x.label, name: x.name.replace('.csv', '.xlsx'), header: x.header, rows: x.rows })),
    });

    const chosen = (v) => BY_ID[v.solution];
    // The observation is the pumped well itself once r is at most rw.
    const pumpedWell = (v) => v.g_r !== undefined && v.g_rw !== undefined && !(v.g_r > v.g_rw);
    const needs = (k) => (v) => Boolean(chosen(v) && chosen(v).geometry.includes(k)) && !(OBS_ONLY.includes(k) && pumpedWell(v));
    // A piezometer (z1 = z2) has no screen to lag behind the aquifer, so its standpipe
    // radius is asked for but not required.
    const piezometer = (v) => v.g_z1 !== undefined && v.g_z1 === v.g_z2;
    const required = (k) => (v) => needs(k)(v) && !(k === 'rcObs' && piezometer(v));
    const isTable = (v) => v.rateKind === 'table';
    const paramFields = SOLUTIONS.flatMap((s) => s.params.flatMap((p) => [
      { id: fieldId('p', s.id, p.id), label: `${shortName(p)}: starting or fixed value`, type: 'number', hint: hintOf(p), show: (v) => v.solution === s.id },
      { id: fieldId('h', s.id, p.id), label: `${shortName(p)}: fit or hold`, type: 'select', options: [['hold', 'Hold at the value above']], hint: 'Blank: fitted.', show: (v) => v.solution === s.id },
    ]));
    // Image wells need a solution whose drawdown depends on position only through r.
    const imagesOk = (v) => !chosen(v) || chosen(v).images;
    const bounded = (v) => imagesOk(v) && Boolean(v.bounds), two = (v) => bounded(v) && (v.bounds === 'parallel' || v.bounds === 'right');
    const TYPES = [['head', 'Constant head (a river or lake)'], ['noflow', 'No flow (a barrier)']];
    const f = form(host, {
      fields: [
        { id: 'tCol', label: 'Elapsed time column', type: 'column', required: true },
        { id: 'tUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'sCol', label: 'Drawdown column', type: 'column', required: true },
        { id: 'sUnit', label: 'Drawdown unit', type: 'select', options: unitOptions(DRAWDOWN_UNITS), required: true },
        { id: 'solution', label: 'Solution', type: 'select', options: SOLUTIONS.map((s) => [s.id, s.name]), required: true },
        { id: 'rateKind', label: 'Pumping rate', type: 'select', options: [['constant', 'Constant'], ['table', 'Changed during the test']], required: true },
        { id: 'Q', label: 'Rate', type: 'number', required: (v) => v.rateKind === 'constant', show: (v) => v.rateKind === 'constant' },
        { id: 'rates', label: 'Rate changes', type: 'text', required: isTable, show: isTable, placeholder: '0 500; 120 800; 240 0', hint: 'Each change as a time and a rate, changes separated by semicolons. Times in the time unit above, the first at 0; a rate of 0 is recovery.' },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'lUnit', label: 'Length unit', type: 'select', options: unitOptions(LENGTH_UNITS), required: true, hint: 'For the distances below, and for T, K and lengths in the results.' },
        // Each solution may relabel these; syncSolution() writes its labels in. A space
        // keeps a hint line for a solution whose own label has one.
        ...geometryKeys.map((k) => ({ id: fieldId('g', k), label: geometryLabel(k), type: 'number', required: required(k), show: needs(k), hint: geometryText(k)[1] || ' ' })),
        // Choices a solution needs that are not fitted, such as a block shape. Never preset.
        ...SOLUTIONS.flatMap((s) => (s.options || []).map((o) => ({ id: fieldId('o', s.id, o.id), label: o.label, type: 'select', options: o.choices, required: (v) => v.solution === s.id, show: (v) => v.solution === s.id }))),
        { id: 'from', label: 'Fit from this time', type: 'number', hint: 'In the time unit above.' },
        { id: 'to', label: 'Fit up to this time', type: 'number', hint: 'In the time unit above.' },
        { id: 'every', label: 'Readings fitted', type: 'select', options: [['every', 'Every reading, not averaged']], hint: 'Blank: averaged into 20 equal widths of log time to each log cycle.' },
        { id: 'bounds', label: 'Boundaries', type: 'select', options: [['one', 'One straight boundary'], ['parallel', 'Two parallel boundaries, the well between'], ['right', 'Two boundaries at right angles']], hint: 'Blank: none. Straight lines crossing the whole aquifer.', show: imagesOk },
        // Once a boundary is chosen, its fields are needed, and Run says so.
        { id: 'b1Type', label: 'Boundary 1: type', type: 'select', options: TYPES, show: bounded, required: bounded },
        { id: 'b1Dist', label: 'Boundary 1: distance from the pumped well', type: 'number', show: bounded, required: bounded, hint: 'In the length unit, at right angles to the boundary.' },
        { id: 'b1Obs', label: 'Boundary 1: distance from the observation point', type: 'number', show: bounded, required: bounded, hint: 'In the length unit, at right angles to the boundary.' },
        { id: 'b2Type', label: 'Boundary 2: type', type: 'select', options: TYPES, show: two, required: two },
        { id: 'b2Dist', label: 'Boundary 2: distance from the pumped well', type: 'number', show: two, required: two, hint: 'In the length unit, at right angles to the boundary.' },
        { id: 'b2Obs', label: 'Boundary 2: distance from the observation point', type: 'number', show: (v) => bounded(v) && v.bounds === 'right', required: (v) => bounded(v) && v.bounds === 'right', hint: 'In the length unit, at right angles to the boundary.' },
        ...paramFields,
      ],
      onRun(v) {
        stop();
        out.textContent = '';
        let job;
        try {
          job = prepare(v);
        } catch (e) {
          showError(e.message);
          return;
        }
        const status = el('p', { class: 'hint', role: 'status' }, 'Fitting: comparing starting values...');
        const slow = el('p', { class: 'hint', hidden: true });
        out.append(status, slow);
        const ticket = runs;
        editedDuring = false;
        fit = fitOffPage(job, (p) => {
          if (ticket !== runs) return;
          if (p.stage === 'slow') {
            slow.hidden = false;
            const minutes = Math.round(p.limit / 60);
            slow.textContent = `Each evaluation of ${job.sol.name} takes about ${sig(p.seconds, 2)} s here, so this fit may take minutes. It ends within ${minutes} minute${minutes === 1 ? '' : 's'}, standard errors and the fitted curve included, and says what it had to cut short.`;
          } else if (p.stage === 'grid') status.textContent = `Fitting: comparing starting values, ${p.done} of ${p.of}...`;
          else if (p.stage === 'statistics') status.textContent = 'Fitting: working out the standard errors...';
          else if (p.stage === 'intervals') status.textContent = 'Fitting: working out the 95% intervals, refitting with each value held...';
          else if (p.stage === 'curve') status.textContent = 'Fitting: drawing the fitted curve...';
          else status.textContent = `Fitting: search ${p.step} of ${p.of}...`;
        }, signal);
        const cancel = el('button', { class: 'btn', type: 'button', onclick: () => { stop(); out.textContent = ''; out.append(el('p', { class: 'hint' }, 'Fit cancelled.')); } }, 'Cancel');
        setTimeout(() => { if (ticket === runs) status.after(cancel); }, CANCEL_AFTER);
        fit.promise
          .then((res) => {
            if (ticket !== runs) return;
            out.textContent = '';
            out.append(...results({ ...job, res }));
            // An input changed while the fit ran: these results are for the inputs as
            // they were, so they are dimmed until the next run.
            if (editedDuring) host.dataset.stale = '1';
            else done(host);
          })
          .catch((e) => {
            if (ticket !== runs) return;
            out.textContent = '';
            showError(e.message);
          });
      },
    });
    host.append(out);
    const noteEdit = () => { if (fit) editedDuring = true; };
    f.element.addEventListener('input', noteEdit);
    f.element.addEventListener('change', noteEdit);

    // The solution list grouped by family, and the chosen one's summary under it.
    const select = f.element.querySelector('#x-solution');
    select.replaceChildren(new Option('Choose', ''), ...FAMILIES.map(([fam, name]) => {
      const list = SOLUTIONS.filter((s) => s.family === fam);
      return list.length ? el('optgroup', { label: name }, list.map((s) => new Option(s.name, s.id))) : null;
    }).filter(Boolean));
    const summary = el('p', { class: 'hint', 'aria-live': 'polite' });
    select.parentElement.append(summary);
    function syncSolution() {
      const s = BY_ID[select.value];
      const noImages = s && !s.images ? ` ${s.imagesOff || 'Boundaries are off for this solution: its drawdown depends on more than the distance from the well, so image wells cannot stand in for them.'}` : '';
      summary.textContent = s ? together(s.summary + noImages) : '';
      summary.hidden = !s;
      // The geometry fields in the chosen solution's own terms.
      for (const k of geometryKeys) {
        const input = f.element.querySelector(`#x-${fieldId('g', k)}`);
        const box = input.parentElement, [label, hint] = geometryText(k, s);
        box.querySelector('label').textContent = label;
        const span = box.querySelector('.hint');
        if (span) { span.textContent = hint; span.hidden = !hint.trim(); }
      }
      f.check();
    }
    select.addEventListener('change', syncSolution);
    syncSolution();

    // Everything checked and converted to metres and days before the fit starts, so a
    // message names the field that caused it.
    function prepare(v) {
      if (!data) throw new Error('Add a file first.');
      if (v.tCol === v.sCol) throw new Error('The elapsed time column and the drawdown column must be different columns.');
      const sol = chosen(v);
      const k = TIME_UNITS[v.tUnit], D = UNITS[v.sUnit], L = UNITS[v.lUnit], R = RATE_UNITS[v.qUnit];
      let ratesIn;
      if (v.rateKind === 'constant') {
        if (!(v.Q > 0)) throw new Error('The pumping rate must be above zero.');
        ratesIn = [[0, v.Q]];
      } else ratesIn = parseRates(v.rates);
      const g = {};
      const pumped = pumpedWell(v);
      for (const key of sol.geometry) {
        const x = v[fieldId('g', key)];
        // The pumped well needs no observation screen or standpipe of its own.
        if (pumped && OBS_ONLY.includes(key)) continue;
        if (key === 'rcObs' && x === undefined && piezometer(v)) continue;
        if (ZERO_OK.includes(key) ? !(x >= 0) : !(x > 0)) throw new Error(`${geometryLabel(key, sol)} must be ${ZERO_OK.includes(key) ? 'zero or above' : 'above zero'}.`);
        g[key] = x * L;
      }
      for (const o of sol.options || []) {
        const x = v[fieldId('o', sol.id, o.id)];
        if (!o.choices.some(([id]) => id === x)) throw new Error(`Choose the ${o.label.toLowerCase()}.`);
        g[o.id] = x;
      }
      if (v.from !== undefined && v.from < 0) throw new Error('"Fit from this time" must be zero or above.');
      if (v.to !== undefined && !(v.to > 0)) throw new Error('"Fit up to this time" must be above zero.');
      if (v.from !== undefined && v.to !== undefined && !(v.from < v.to)) throw new Error('"Fit from this time" must be earlier than "Fit up to this time".');
      let boundaries = null, bIn = null;
      if (v.bounds) {
        const count = v.bounds === 'one' ? 1 : 2;
        const types = [v.b1Type, v.b2Type].slice(0, count), a = [v.b1Dist, v.b2Dist].slice(0, count), d = v.bounds === 'right' ? [v.b1Obs, v.b2Obs] : [v.b1Obs];
        types.forEach((t, i) => { if (!t) throw new Error(`Choose the type of boundary ${i + 1}.`); });
        a.forEach((x, i) => { if (!(x > 0)) throw new Error(`Boundary ${i + 1}: the distance from the pumped well must be above zero.`); });
        d.forEach((x, i) => { if (!(x > 0)) throw new Error(`Boundary ${i + 1}: the distance from the observation point must be above zero.`); });
        bIn = { a, d };
        boundaries = { arrangement: v.bounds, types, a: a.map((x) => x * L), d: d.map((x) => x * L) };
      }
      const start = {}, held = {};
      for (const p of sol.params) {
        const x = v[fieldId('p', sol.id, p.id)], hold = v[fieldId('h', sol.id, p.id)] === 'hold';
        if (hold && x === undefined) throw new Error(`${shortName(p)} is to be held, so it needs a value.`);
        if (x !== undefined && logScale(p.kind) && !(x > 0)) throw new Error(`The value given for ${shortName(p)} must be above zero.`);
        if (x !== undefined && isFinite(p.min) && x * kindOf(p).si(L) < p.min) throw new Error(`The value given for ${shortName(p)} must be at least ${sig(p.min / kindOf(p).si(L), 4)}${unitOf(p, v.lUnit) ? ` ${unitOf(p, v.lUnit)}` : ''}.`);
        if (x !== undefined && isFinite(p.max) && x * kindOf(p).si(L) > p.max) throw new Error(`The value given for ${shortName(p)} must be at most ${sig(p.max / kindOf(p).si(L), 4)}${unitOf(p, v.lUnit) ? ` ${unitOf(p, v.lUnit)}` : ''}.`);
        if (x !== undefined) start[p.id] = x * kindOf(p).si(L);
        if (hold) held[p.id] = true;
      }
      if (sol.params.every((p) => held[p.id])) throw new Error('Every value is held fixed, so there is nothing to fit. Let at least one be fitted.');
      const tIn = columnValues(data.table, v.tCol), sIn = columnValues(data.table, v.sCol);
      if (!tIn.some((x, i) => x > 0 && Number.isFinite(sIn[i]))) throw new Error('No row has a time above zero and a drawdown. Check that the right columns are chosen.');
      const rates = ratesIn.map(([t, q]) => [t * k, q * R]);
      // The boundary lines, for a solution's check() on its image wells.
      const lines = boundaries ? boundaryLayout(boundaries, g.r).lines : [];
      return {
        v, sol, g, rates, ratesIn, boundaries, bIn, start, held, example, pumped, lines,
        input: {
          solution: sol, t: tIn.map((x) => x * k), s: sIn.map((x) => x * D), rates, g, boundaries, start, fixed: held,
          average: !v.every, from: v.from === undefined ? undefined : v.from * k, to: v.to === undefined ? undefined : v.to * k,
        },
      };
    }
  },
};

/**
 * The readings the fit used (kept, as fitSolution in fit.js gives them: those with a time
 * above zero, a drawdown, and inside the window, in time order), one by one, not
 * averaged: t, each one's time since pumping began, and since, its time since the start of
 * its own period of constant rate (a period holds the readings after its start), in days
 * and in time order; s, each one's drawdown in metres; and unit, the time unit of the
 * readings, for the text.
 */
function readingTimes({ t, s, rates }, kept, unitName) {
  const tt = kept.map((i) => t[i]);
  const startOf = (x) => rates.reduce((k, [t0]) => (x > t0 ? t0 : k), rates[0][0]);
  return { t: tt, since: tt.map((x) => x - startOf(x)), s: kept.map((i) => s[i]), unit: unitName };
}

function results(c) {
  const { sol, res, v, g, held } = c;
  const L = UNITS[v.lUnit], D = UNITS[v.sUnit], tk = TIME_UNITS[v.tUnit], lu = v.lUnit, su = v.sUnit;
  const user = inUserUnits(sol, res, L);
  const heldList = sol.params.filter((p) => held[p.id]);
  const given = sol.params.filter((p) => !held[p.id] && c.start[p.id] !== undefined);
  const heldText = [
    heldList.length ? `Held fixed at the values you gave: ${heldList.map(symbolOf).join(', ')}.` : '',
    given.length ? `The search started from the values you gave for ${given.map(symbolOf).join(', ')}.` : '',
    `Where no starting value was given, the starting points come from the readings: Theis fits to all the readings before the first change of rate, to the earliest 40% of their span in log time and to the latest 40%, give T and S (and a lower limit for Sy, from the late part), and for a leaky solution a Hantush and Jacob fit gives B or c. Each other value is tried over a grid: between the limits the solution gives, or over a range for its kind (Kz/Kr from 10⁻⁴ to 10, skin 0 to 10). Every combination, thinned evenly to at most ${GRID_COMBOS}, is compared on ${COMPARE_ON} points spread through the record, each also at the height that best matches them; the best are improved by stepping each value a factor of 3 or 10 either way; and the fit is run for ${SHORT} iterations from the best four different points, each after the first kept within a factor of 10 of the values the grid tried, and to the end from the best of those. If the misfits then run in long stretches of one sign, up to two more rounds of starts are tried. The search does the same work on any computer, and every function it and the solution take gives the same bits in every browser, so the same readings always give the same answer. Only the time limit of ${Math.round(TIME_LIMIT / 60000)} minutes depends on the computer's speed, and a fit that reaches it says so.`,
  ].filter(Boolean).join(' ');
  // What the solution's method() and check() are told: the boundary lines, whether the
  // observation is the pumped well, the values shown as not determined, so they build
  // nothing on those as if it were a result, and the readings fitted, so a solution can
  // say which fall outside a range of time its source gives a form for; and, for the
  // comments on a water table test (water-table.js), the rates, the misfit, its runs test
  // and the 95% intervals of the values determined, in metres and days.
  const intervals = Object.fromEntries(res.free.map((id) => [id, res.params[id]])
    .filter(([, r]) => verdictOf(r) === 'interval' && Number.isFinite(r.lower) && Number.isFinite(r.upper)).map(([id, r]) => [id, [r.lower, r.upper]]));
  const ctx = {
    lines: c.lines, pumped: c.pumped, undetermined: new Set(sol.params.filter((p) => unknownCode(user[p.id])).map((p) => p.id)), readings: readingTimes(c.input, res.kept, v.tUnit),
    rates: c.rates, rms: res.rms, misfit: res.misfit, intervals,
  };
  const text = methodText({ ...c, user, heldText, ctx });
  const said = warnings(sol, res, g, ctx, v).map(together);
  // A solution whose notes cite sources of their own, such as the comments on a water table
  // test, adds them.
  if (sol.noteReferences) text.references = sol.noteReferences(text.references, said);
  // An example's note is about the example's own solution and geometry.
  const exampleNote = c.example && v.solution === c.example.values.solution ? [c.example.note] : [];
  text.notes = [...said, ...exampleNote];

  // The fitted curve runs a little beyond the readings (fitWithCurve), so its
  // derivative, which needs 0.2 log cycles either side, reaches the ends of the data.
  const pts = res.points, toT = (x) => x / tk, toS = (x) => x / D;
  const { t: grid, s: curve } = res.curve;
  const dCurve = bourdetDerivative(grid, curve), dData = bourdetDerivative(pts.t, pts.y);
  const inside = (x) => x >= pts.t[0] && x <= pts.t[pts.t.length - 1];
  const unknown = (p) => unknownCode(user[p.id]);
  const head = sol.params.map((p) => (unknown(p) ? `${symbolOf(p)} not determined` : `${symbolOf(p)} = ${three(user[p.id].value)}${unitOf(p, lu) ? ` ${unitOf(p, lu)}` : ''}`)).join(', ');

  // The unit is part of each name, so the table keeps to four columns on a phone. Each
  // cell is written here, to 4 significant figures, since every row is a different quantity.
  const rows = sol.params.map((p) => {
    const r = user[p.id], name = withUnit(p, lu);
    switch (verdictOf(r)) {
      case 'fixed': return [name, four(r.value), 'held fixed', 'held fixed'];
      case 'limit': return [name, four(r.value), 'not determined', 'at its limit'];
      case 'time': return [name, four(r.value), 'not computed', 'time limit reached'];
      case 'unsettled': return [name, 'not settled', '', 'its profile cut short by its budget of evaluations'];
      case 'undetermined': return [name, 'not determined', '', ''];
      default: {
        const note = intervalNote(r);
        return [name, four(r.value), four(r.se), `${interval(r.lower, r.upper)}${note.length ? ` (${note.join('; ')})` : ''}`];
      }
    }
  });
  const freeParams = res.free.map((id) => sol.params.find((p) => p.id === id));
  const freeLabels = freeParams.map(symbolOf);
  // The correlations of the values that have a standard error; one that the readings fix
  // only in a combination has none. A value not determined is left out: its correlations
  // are taken where the search stopped on a plateau of the misfit, which is a matter of
  // rounding, and say nothing about the values the readings do fix.
  const shownCorr = (i) => Number.isFinite(res.corr[i][i]) && !unknownCode(res.params[res.free[i]]);
  const known = res.free.map((_, i) => i).filter(shownCorr);
  const corrLeftOut = res.free.filter((id, i) => Number.isFinite(res.corr[i][i]) && !shownCorr(i)).map((id) => symbolOf(sol.params.find((p) => p.id === id)));
  const corrRows = known.map((i) => [freeLabels[i], ...known.map((j) => fixed(res.corr[i][j], 3))]);
  const stats = [
    [`Root mean square misfit (${su})`, four(res.rms / D)],
    ['Points fitted, n', String(res.n)],
    ['Values fitted, k', String(res.free.length)],
    ['Degrees of freedom, n − k', String(res.df)],
    ['Student\'s t for a 95% interval', Number.isFinite(res.t975) ? four(res.t975) : 'n/a'],
  ];

  const resultsSheet = { name: 'Results', header: ['Parameter', 'Symbol', 'Value', 'Standard error', 'Lower 95%', 'Upper 95%', 'Unit', 'Note'], rows: [
    ...sol.params.map((p) => {
      const r = user[p.id], round = (x) => six(x, null);
      const verdict = verdictOf(r), shown = verdict === 'interval';
      const note = verdict === 'fixed' ? 'held fixed' : verdict === 'time' ? `no standard error: ${whyOf(p, r)}` : shown ? intervalNote(r).map((x) => `interval ${x}`).join('; ')
        : `not determined: ${whyOf(p, r)}`;
      return [p.label, symbolOf(p), round(r.value), shown ? round(r.se) : null, shown ? round(r.lower) : null, shown ? round(r.upper) : null, sheetUnit(p, lu), note];
    }),
    ...[[`Root mean square misfit (${su})`, res.rms / D], ['Points fitted, n', res.n], ['Values fitted, k', res.free.length], ['Degrees of freedom, n − k', res.df], ['t(0.975, n − k)', res.t975]]
      .map(([k, x]) => [k, '', six(x, null), null, null, null, '', '']),
  ] };
  const corrSheet = { name: 'Correlation', header: ['', ...freeLabels], rows: res.corr.map((row, i) => [freeLabels[i], ...row.map((x, j) => (Number.isFinite(x) && shownCorr(i) && shownCorr(j) ? Number(x.toFixed(4)) : null))]) };
  const fitSheet = { name: 'Fit', header: [`Time (${v.tUnit})`, `Measured drawdown (${su})`, 'Readings averaged', `Fitted drawdown (${su})`, `Residual (${su})`, `Measured derivative (${su})`],
    rows: pts.t.map((x, i) => [toT(x), toS(pts.y[i]), pts.n[i], toS(res.fittedY[i]), toS(res.residuals[i]), Number.isFinite(dData[i]) ? toS(dData[i]) : null]) };
  const curveSheet = { name: 'Curve', header: [`Time (${v.tUnit})`, `Fitted drawdown (${su})`, `Fitted derivative (${su})`],
    rows: grid.map((x, i) => [toT(x), toS(curve[i]), Number.isFinite(dCurve[i]) ? toS(dCurve[i]) : null]) };

  const xLabel = `Time since pumping began (${TIME_NAMES[v.tUnit]})`;
  const fitted = { label: `${sol.name} fit`, x: grid.map(toT), y: curve.map(toS) };
  // A correlation table keeps to its own width, as two-column tables do.
  const corrTable = table(['', ...known.map((i) => freeLabels[i])], corrRows);
  corrTable.querySelector('table').classList.add('pairs');
  return [
    panel(
      el('h2', {}, 'Fitted values'),
      el('p', { class: 'chart-sub' }, together(`${sol.name}: ${head}. Fitted to ${res.n} points, root mean square misfit ${three(res.rms / D)} ${su}.`)),
      table(['Parameter', 'Value', 'Standard error', '95% interval'], rows),
      el('p', { class: 'hint' }, STATS_PLAIN),
      table(['Fit', 'Value'], stats),
      said.length ? notes(said) : null,
      downloads(() => downloadWorkbook(`${sol.id}-fit.xlsx`, [resultsSheet, corrSheet, fitSheet, curveSheet], text),
        // The predict page takes the values, intervals and verdicts of the solutions it can carry.
        FROM_FIT[sol.id] ? predictButton({ kind: 'fit', solution: sol.id, name: sol.name, lu, params: user, lastDay: ctx.readings.t[ctx.readings.t.length - 1], b: v.g_b }) : null)),
    known.length > 1 ? panel(
      el('h2', {}, 'Correlation between the fitted values'),
      el('p', { class: 'chart-sub' }, 'Near 1 or −1, two values trade off against each other: the readings fix a combination of them better than either alone.'),
      corrTable,
      corrLeftOut.length ? el('p', { class: 'hint' }, together(`${listed(corrLeftOut)} ${corrLeftOut.length > 1 ? 'are' : 'is'} left out: not determined, so ${corrLeftOut.length > 1 ? 'their' : 'its'} correlations are taken wherever the search stopped on a plateau of the misfit, and say nothing.`)) : null) : null,
    // Drawdown increases upward on the log-log plot, as on type curves, and downward on the semilog one.
    panel(chart({ title: 'Drawdown and its derivative, log scales', xLabel, yLabel: `Drawdown or ds/d ln t (${su})`, logX: true, logY: true, series: [
      // Measured and fitted first, so they keep the same colours on both charts.
      { label: 'Measured', x: pts.t.map(toT), y: pts.y.map(toS), line: false },
      fitted,
      { label: 'Measured derivative', x: pts.t.map(toT), y: dData.map(toS), line: false },
      { label: 'Fitted derivative', x: grid.map(toT), y: dCurve.map((d, i) => (inside(grid[i]) ? toS(d) : NaN)) },
    ] }), el('p', { class: 'hint' }, 'The derivative ds/d ln t is the slope of drawdown against log time (Bourdet et al. 1989): flat where the straight line of Cooper and Jacob (1946) holds, falling with leakage or delayed drainage, rising beside a no-flow boundary.')),
    panel(chart({ title: 'Drawdown against log time', xLabel, yLabel: `Drawdown (${su})`, logX: true, invertY: true, series: [
      { label: 'Measured', x: pts.t.map(toT), y: pts.y.map(toS), line: false },
      fitted,
    ] })),
    methodPanel(text),
  ].filter(Boolean);
}
