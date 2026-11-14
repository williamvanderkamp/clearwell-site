// Analyze a slug test. Straight-line methods for an overdamped response, Hvorslev
// (1951) and Bouwer and Rice (1976), fitted to the normalized head in Butler's (1998)
// recommended range or a window the user sets; and type-curve methods fitted by least
// squares: Cooper, Bredehoeft and Papadopulos (1967), the KGS model (Hyder et al.
// 1994), and for an oscillating response the high-K Hvorslev model (Butler 1998),
// Springer and Gelhar (1991), Butler and Zhan (2004) and van der Kamp (1976), whose
// damped cosine is fitted to the whole record.
// One symbol for each quantity across the methods, whatever each paper writes: Le the
// screen length and D the aquifer thickness, as in Bouwer and Rice (1976) (the KGS papers
// write b and B), Lc the effective length of the water column (Butler and Garnett write
// Le), and m the slope of the straight line. The engine keeps the papers' own names.
// The page: its form, the fit and the run. Each family of methods has its text and
// results in a file of its own here: line.js, curve.js and vdk.js.
import { UNITS } from '../../../engine/index.js';
import { bouwerRice, fitWindow, HEAD_RANGE, hvorslev, packRadius, TIME_S } from '../../../engine/slug.js';
import { columnSpec, columnValues, done, el, errorBox, fileDrop, form, sig, TIME_OPTIONS, unitOptions } from '../../kit.js';
import { startJob } from '../../worker-job.js';
import { curveResults, curveSetup, curveTimes } from './curve.js';
import { detect, testsOf, unitIn } from './data.js';
import { SLUG_EXAMPLES } from './examples.js';
import { runSlugJob } from './jobs.js';
import { lineResults } from './line.js';
import { listRows } from './text.js';
import { vdkResults, vdkSetup } from './vdk.js';

// Short enough for the select on a phone; the hint says which suits which response.
const METHODS = [
  ['hvorslev', 'Hvorslev (1951), line'],
  ['bouwerRice', 'Bouwer and Rice (1976), line'],
  ['cbp', 'Cooper et al. (1967), curve'],
  ['kgs', 'KGS model (1994), curve'],
  ['highKHvorslev', 'High-K Hvorslev (1998)'],
  ['springerGelhar', 'Springer and Gelhar (1991)'],
  ['butlerZhan', 'Butler and Zhan (2004)'],
  ['vanDerKamp', 'van der Kamp (1976)'],
];
const METHOD_HINT = 'For a level that returns without oscillating: Hvorslev or Bouwer and Rice (straight lines), Cooper, Bredehoeft and Papadopulos or the KGS model of Hyder et al. (type curves). For a level that oscillates: high-K Hvorslev (Butler) in a confined aquifer, Springer and Gelhar in an unconfined one, Butler and Zhan with the storage of the aquifer, van der Kamp for T of a confined aquifer from a fully penetrating well, with S known.';
const LINE = new Set(['hvorslev', 'bouwerRice']);
const LENGTH = unitOptions(['m', 'cm', 'ft', 'in']);
const KINDS = [['disp', 'Displacement from static'], ['level', 'Water level or depth to water']];
const TOPS = [['confined', 'Confined: no flow across the top'], ['unconfined', 'Unconfined: the water table']];

// ---------------------------------------------------------------- the fit

// The KGS and Butler and Zhan fits sum many vertical modes and can take seconds, and van
// der Kamp's analysis of a dense record (a grid of starting points, the runs test's 2000
// sets of random readings, the second fit and the early and late parts, each over every
// reading) takes several, so they run in a Web Worker and the page stays live. Where a
// worker cannot start, and for the quick fits, they run here, after the page has drawn the
// "Fitting" line. Either way the result is what runSlugJob gives.
const IN_WORKER = new Set(['kgs', 'bz', 'vdk']);
// ms before a running fit offers a Cancel button.
const CANCEL_AFTER = 1500;

// startJob's { promise, stop } for one fit (worker-job.js): stop() ends a fit still
// running, as leaving the page does, whose promise then never settles.
const startFit = (job, onProgress, signal) => startJob(IN_WORKER.has(job.kind) ? new URL('./worker.js', import.meta.url) : null, job, {
  onProgress, fallback: () => runSlugJob(job), signal, failed: 'The fit stopped with an error.',
});

// The stages of van der Kamp's analysis (fitDampedCosine and analyseVanDerKamp).
const VDK_STAGES = {
  grid: 'Fitting: the grid of starting values...',
  fit: 'Fitting: least squares...',
  serial: 'Fitting: again, allowing for misfits correlated from one reading to the next...',
  runs: 'Checking: the runs test, against 2000 sets of random misfits...',
  split: 'Checking: the early part of the record against the late...',
};
const progressText = (p) => (p.vdk ? VDK_STAGES[p.stage] : (p.stage === 'start'
  ? `Fitting: starting values, ${p.step} of ${p.of} tried...`
  : `Fitting: least squares, ${p.curves} curve${p.curves === 1 ? '' : 's'} computed...`));

// ---------------------------------------------------------------- the page

export default {
  id: 'slug',
  group: 'tests',
  title: 'Analyze a slug test',
  blurb: 'You raised or lowered the level in a well and logged its return. Get hydraulic conductivity by straight-line or type-curve methods, including tests where the level oscillates.',
  lede: 'Hvorslev and Bouwer and Rice for an overdamped test; Cooper, Bredehoeft and Papadopulos and the KGS model fitted by least squares; and the high-K models of Butler, Springer and Gelhar, and Butler and Zhan, and van der Kamp\'s damped cosine, for a level that oscillates.',
  mount(host, signal) {
    let data = null, example = null, runs = 0;
    // The run whose fit is still going, if any, and whether an entry changed during it.
    let fitting = null, editedDuring = false;
    const out = el('div', { class: 'stack' });
    const showError = (msg) => { out.textContent = ''; out.append(errorBox(msg)); };
    // A method's results in place of what the page showed; a panel it leaves out is null.
    const show = (parts) => { out.textContent = ''; out.append(...parts.filter(Boolean)); };
    let running = null;
    // A fit still running for an earlier run or file, or once the page is left, is no
    // longer wanted.
    const stop = () => { runs++; if (running) running.stop(); running = null; };
    signal.addEventListener('abort', stop);
    // A fit in the worker can be stopped; the button comes only once the fit has run a
    // moment, so a quick fit does not flash it.
    const offerCancel = (busy, ticket) => {
      const cancel = el('button', { class: 'btn', type: 'button', onclick: () => { stop(); out.textContent = ''; out.append(el('p', { class: 'hint' }, 'Fit cancelled.')); } }, 'Cancel');
      setTimeout(() => { if (ticket === runs) busy.after(cancel); }, CANCEL_AFTER);
    };
    const { status } = fileDrop(host, {
      text: 'A table of elapsed time and water level from one slug test. CSV or Excel.',
      examples: SLUG_EXAMPLES,
      onTable({ name, table: tbl, example: chosen }) {
        stop();
        data = tbl;
        example = chosen || null;
        out.textContent = '';
        // Nothing from an earlier file or example carries over: empty every field, then
        // fill in what the headings say, then what the example's source gives.
        f.reset();
        f.setColumns(tbl.header);
        detect(f, tbl.header);
        if (chosen) Object.entries(chosen.values).forEach(([k, val]) => f.set(k, val));
        status(`${name}: ${tbl.rows.length} rows.${chosen ? ` ${chosen.source}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Elapsed time', need: 'Required', what: 'Time since the level was changed, as numbers. A reading at time zero gives H0.', headings: ['Time (s)', 'Time (min)'] },
        { name: 'Water level', need: 'Required', what: 'Displacement from the static level, or the water level or depth to water itself.', headings: ['Displacement (m)', 'Water level (m)', 'Depth to water (ft)'] },
        { name: 'Test', need: 'Optional', what: 'For several tests at one well in one file: the test each row belongs to, the tests in the order they were made. Each test\'s times run from its own start.', headings: ['Test'] },
        { name: 'Expected H0', need: 'Optional', what: 'With a test column: the displacement each test was expected to start from, on any of its rows.', headings: ['Expected H0 (m)'] },
      ],
      notes: [
        'Put the time unit in the heading, in brackets, and the page reads it from there. Otherwise it asks.',
        'One test per file, or several with a Test column. Readings before time zero are left out of every fit; the last of them says how far from static the test began.',
        'The well sizes, and what else the method needs, are entered on the form below.',
      ],
      // The same readings as the example buttons, as .xlsx files.
      examples: SLUG_EXAMPLES.map((x) => {
        const [h, ...lines] = x.csv.trim().split('\n');
        return { label: x.label, name: x.name.replace(/\.csv$/, '.xlsx'), header: h.split(','), rows: lines.map((l) => l.split(',').map(Number)) };
      }),
    });
    const is = (...ids) => (v) => ids.includes(v.method);
    const notCbp = (v) => v.method !== undefined && v.method !== 'cbp';
    // van der Kamp takes the screen length only for the water column of its eq. 1.
    const screenNeeded = (v) => notCbp(v) && v.method !== 'vanDerKamp';
    const deep = is('bouwerRice', 'kgs', 'springerGelhar', 'butlerZhan');
    const curveMethod = (v) => v.method !== undefined && !LINE.has(v.method);
    const f = form(host, {
      fields: [
        { id: 'method', label: 'Method', type: 'select', options: METHODS, required: true, hint: METHOD_HINT },
        { id: 't', label: 'Elapsed time column', type: 'column', required: true },
        { id: 'tUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'level', label: 'Water level column', type: 'column', required: true },
        { id: 'kind', label: 'That column holds', type: 'select', options: KINDS, required: true },
        { id: 'static', label: 'Static level, in the column\'s unit', type: 'number', required: (v) => v.kind === 'level', show: (v) => v.kind === 'level' },
        { id: 'lUnit', label: 'Unit of the well sizes', type: 'select', options: LENGTH, required: true },
        { id: 'rc', label: 'Casing radius rc', type: 'number', required: true, hint: 'Inside radius where the water level moves.' },
        { id: 'rw', label: 'Well radius rw', type: 'number', required: true, hint: 'Screen radius, or the borehole radius with a filter pack.' },
        { id: 'Le', label: 'Screen length Le', type: 'number', required: screenNeeded, show: notCbp, hint: 'For van der Kamp, optional: with l, the water column above the screen, it gives his Lc = l + (3/8) Le to compare.' },
        { id: 'anisotropy', label: 'Anisotropy Kz/Kr', type: 'number', required: screenNeeded, show: screenNeeded, hint: 'Enter 1 for an isotropic aquifer.' },
        { id: 'S', label: 'Storativity S of the aquifer', type: 'number', required: is('vanDerKamp'), show: is('vanDerKamp'), hint: 'From another test, or a value you can stand behind: van der Kamp\'s method cannot find it, though T depends on it only weakly.' },
        { id: 'Lw', label: 'Water table or top of aquifer to bottom of screen Lw', type: 'number', required: deep, show: deep, hint: 'From the water table for an unconfined aquifer; from the top of a confined one.' },
        { id: 'D', label: 'Aquifer thickness D', type: 'number', required: deep, show: deep, hint: 'Saturated thickness: from the water table, or the top of a confined aquifer, to the base.' },
        { id: 'top', label: 'Top of the aquifer', type: 'select', options: TOPS, required: is('kgs'), show: is('kgs') },
        { id: 'SsSkin', label: 'Skin specific storage, per unit of the well sizes', type: 'number', required: (v) => v.method === 'kgs' && v.rsk !== undefined, show: (v) => v.method === 'kgs' && v.rsk !== undefined },
        { id: 'lAbove', label: 'Water column above the screen l', type: 'number', required: (v) => v.method === 'butlerZhan' && v.nu !== undefined, show: (v) => (v.method === 'butlerZhan' && v.nu !== undefined) || v.method === 'vanDerKamp', hint: 'From the static level to the top of the screen.' },
        { id: 'test', label: 'Test column', type: 'column', hint: 'Several tests at one well in one file: the column naming the test of each row. Each test takes its H0 from its reading at time zero.' },
        { id: 'which', label: 'Test to analyze', show: (v) => v.test !== undefined, hint: 'Its label in the test column. Blank analyzes the first.' },
        { id: 'h0', label: 'Initial displacement H0, in the column\'s unit', type: 'number', show: (v) => v.test === undefined, hint: 'Blank uses the reading at time zero.' },
        { id: 'h0x', label: 'Expected initial displacement H0*, in the column\'s unit', type: 'number', show: (v) => v.test === undefined && v.h0xCol === undefined, hint: 'The slug\'s volume over the area where the level moves, π rc², or for a pneumatic test the air pressure as a head. Compared with H0, it shows whether the test began fast enough (Butler et al. 1996).' },
        { id: 'h0xCol', label: 'Expected H0* column', type: 'column', hint: 'Each test\'s expected initial displacement, on any of its rows; for one test, the H0* field does the same.' },
        { id: 'packN', label: 'Filter pack porosity n', type: 'number', show: is('bouwerRice'), hint: 'For a screen across the water table: rc becomes rc* = [(1 − n) rc² + n rw²]^½ for the pack\'s drainage (Bouwer 1989). Blank: no correction.' },
        { id: 'lo', label: 'Fit window, lower H/H0', type: 'number', show: (v) => LINE.has(v.method), hint: 'Blank uses Butler (1998): 0.15 for Hvorslev, 0.20 for Bouwer and Rice.' },
        { id: 'hi', label: 'Fit window, upper H/H0', type: 'number', show: (v) => LINE.has(v.method), hint: 'Blank uses Butler (1998): 0.25 for Hvorslev, 0.30 for Bouwer and Rice.' },
        { id: 'from', label: 'Fit readings from time', type: 'number', show: curveMethod, hint: 'In the time unit. Blank starts at the first reading after time zero; for van der Kamp, at the reading furthest from static, his first maximum or minimum, time zero included.' },
        { id: 'to', label: 'Fit readings up to time', type: 'number', show: curveMethod, hint: 'In the time unit. Blank runs to the last reading.' },
        { id: 'holdS', label: 'Hold storativity S at', type: 'number', show: is('cbp'), hint: 'Blank fits S with T.' },
        { id: 'bAq', label: 'Aquifer thickness D, for K = T / D', type: 'number', show: is('cbp', 'vanDerKamp'), hint: 'In the unit of the well sizes. Blank gives T only.' },
        { id: 'holdSs', label: 'Hold specific storage Ss at, per unit of the well sizes', type: 'number', show: is('kgs', 'butlerZhan'), hint: 'Blank fits Ss.' },
        { id: 'rsk', label: 'Outer radius of a well skin rsk', type: 'number', show: is('kgs'), hint: 'Blank: no skin. With a skin, its K is fitted too, and its specific storage is asked for.' },
        { id: 'nu', label: 'Kinematic viscosity of the water ν, m²/s', type: 'number', show: is('butlerZhan', 'vanDerKamp'), hint: 'Butler and Zhan: with l, adds friction in the well; blank leaves it out. van der Kamp: for the check of laminar friction, eq. 49; blank leaves the check out.' },
      ],
      onRun(v) {
        stop();
        // The last results go now, so nothing on the page is done until this run is.
        delete host.dataset.done;
        out.textContent = '';
        try {
          if (!data) throw new Error('Load a file first.');
          const ts = TIME_S[v.tUnit], L = UNITS[v.lUnit];
          const t = columnValues(data, v.t).map((x) => x * ts);
          const raw = columnValues(data, v.level);
          const skipped = t.map((_, i) => i).filter((i) => !(Number.isFinite(t[i]) && Number.isFinite(raw[i])));
          const { n, tests, chosen, h0x, unlabelled } = testsOf(v, data, t, v.kind === 'level' ? raw.map((x) => x - v.static) : raw);
          const levelUnit = unitIn(data.header[v.level]);
          // What every method's results take: the tests, for the checks of Butler's practice;
          // the level heading's unit; the example; and the rows left out.
          const ctx = { tests, chosen, h0x, levelUnit, example, skipped, extra: unlabelled.length ? [`${unlabelled.length === 1 ? 'One row' : `${unlabelled.length} rows`} without a test label ${unlabelled.length === 1 ? 'was' : 'were'} left out: row${unlabelled.length === 1 ? '' : 's'} ${listRows(unlabelled)}.`] : [] };
          if (LINE.has(v.method)) {
            const butler = HEAD_RANGE[v.method], own = v.lo !== undefined || v.hi !== undefined;
            const win = [v.lo ?? butler[0], v.hi ?? butler[1]];
            const fit = fitWindow(n.t, n.ratio, ...win);
            // Bouwer (1989): the casing radius corrected for drainage of the filter pack.
            const rcStar = v.packN !== undefined ? packRadius(v.rc, v.rw, v.packN) * L : undefined;
            const kOf = (slope) => {
              const g = { rc: rcStar ?? v.rc * L, rw: v.rw * L, Le: v.Le * L, anisotropy: v.anisotropy, slope };
              return v.method === 'bouwerRice' ? bouwerRice({ ...g, Lw: v.Lw * L, D: v.D * L }) : hvorslev(g);
            };
            const r = { ...kOf(fit.slope), rcStar };
            show(lineResults(v, n, win, fit, r, own, { ...ctx, kOf: (slope) => kOf(slope).K }));
            done(host);
            return;
          }
          if (v.method === 'vanDerKamp') {
            for (const [name, val] of [['The casing radius', v.rc], ['The well radius', v.rw], ['The storativity', v.S], ['The screen length', v.Le], ['The aquifer thickness for K', v.bAq], ['The viscosity', v.nu]]) {
              if (val !== undefined && !(val > 0)) throw new Error(`${name} must be above zero.`);
            }
            if (v.lAbove !== undefined && v.lAbove < 0) throw new Error('The water column above the screen cannot be below zero.');
            if (v.from !== undefined && v.to !== undefined && !(v.to > v.from)) throw new Error('The end of the fit must come after its start.');
            const geo = vdkSetup(v, n, levelUnit), ticket = runs;
            const busy = el('p', { class: 'hint', role: 'status' }, 'Fitting the damped cosine.');
            out.append(busy);
            offerCancel(busy, ticket);
            fitting = ticket;
            editedDuring = false;
            const options = { from: v.from === undefined ? undefined : v.from * ts, to: v.to === undefined ? undefined : v.to * ts };
            running = startFit({ kind: 'vdk', t: n.t, y: n.ratio, geo, options }, (p) => { if (ticket === runs) busy.textContent = progressText(p); }, signal);
            running.promise
              .then(({ analysis: r }) => {
                if (ticket !== runs) return;
                fitting = null;
                const outside = n.t.length - r.used.length;
                const dropped = outside ? `${outside} reading${outside === 1 ? '' : 's'} before the start of the fit or after its end ${outside === 1 ? 'was' : 'were'} left out and ${outside === 1 ? 'is' : 'are'} shown as not used.` : '';
                show(vdkResults(v, n, r, geo, { ...ctx, dropped, editedDuring }));
                if (editedDuring) host.dataset.stale = '1';
                else done(host);
              })
              .catch((e) => {
                if (ticket !== runs) return;
                fitting = null;
                showError(e.message);
              });
            return;
          }
          // Type curves: check the entries, then fit after the page has said so.
          for (const [name, val] of [['The casing radius', v.rc], ['The well radius', v.rw], ['The screen length', v.Le], ['Kz/Kr', v.anisotropy], ['The aquifer thickness', v.D], ['The aquifer thickness for K', v.bAq], ['The held storativity', v.holdS], ['The held specific storage', v.holdSs], ['The skin radius', v.rsk], ['The skin specific storage', v.SsSkin], ['The viscosity', v.nu]]) {
            if (val !== undefined && !(val > 0)) throw new Error(`${name} must be above zero.`);
          }
          if (v.lAbove !== undefined && v.lAbove < 0) throw new Error('The water column above the screen cannot be below zero.');
          if (v.Lw !== undefined && !(v.Lw > 0)) throw new Error('The distance to the bottom of the screen must be above zero.');
          if (v.Lw !== undefined && v.D !== undefined && v.Lw > v.D * (1 + 1e-9)) throw new Error('The bottom of the screen is below the base of the aquifer: Lw is more than the aquifer thickness.');
          if (v.from !== undefined && v.from < 0) throw new Error('The fit cannot start before time zero.');
          if (v.from !== undefined && v.to !== undefined && !(v.to > v.from)) throw new Error('The end of the fit must come after its start.');
          if (v.rsk !== undefined && !(v.rsk > v.rw)) throw new Error('The outer radius of the skin must be more than the well radius.');
          const setup = curveSetup(v);
          const lo = v.from === undefined ? 0 : v.from * ts, hi = v.to === undefined ? Infinity : v.to * ts;
          const keep = n.t.map((x, i) => (x > 0 && x >= lo && x <= hi ? i : -1)).filter((i) => i >= 0);
          if (keep.length < 5) throw new Error(`Only ${keep.length} reading${keep.length === 1 ? '' : 's'} fall in the fit${v.from !== undefined || v.to !== undefined ? ' window you set' : ''}; a type-curve fit needs at least 5. ${v.from !== undefined || v.to !== undefined ? 'Widen the window.' : ''}`.trim());
          // On a record that does not oscillate, Butler and Zhan's inversion would have to
          // follow the water column's natural period through the whole of a slow test, which
          // can take many minutes; the KGS model is the same model without the inertia.
          if (v.method === 'butlerZhan' && !keep.some((i) => n.ratio[i] < -0.02)) {
            throw new Error('None of the readings in the fit falls below the static level, so the response does not oscillate. Butler and Zhan (2004) is offered here for an oscillating response; for this record use the KGS model, which is the same model without the inertia of the water column.');
          }
          const outside = n.t.filter((x, i) => x > 0 && keep.indexOf(i) < 0).length;
          const window = v.from !== undefined || v.to !== undefined
            ? `, between ${sig((keep.length ? n.t[keep[0]] : 0) / ts, 4)} and ${sig(n.t[keep[keep.length - 1]] / ts, 4)} ${v.tUnit}`
            : '';
          const dropped = outside ? `${outside} reading${outside === 1 ? '' : 's'} outside the fit window you set ${outside === 1 ? 'was' : 'were'} left out of the fit and ${outside === 1 ? 'is' : 'are'} shown as not used.` : '';
          const hold = {};
          if (v.holdS !== undefined) hold.S = v.holdS;
          if (v.holdSs !== undefined) hold.Ss = v.holdSs / L;
          const busy = el('p', { class: 'hint', role: 'status' }, 'Fitting. A Laplace-space model can take several seconds.');
          out.append(busy);
          const grid = curveTimes(v, n), ticket = runs;
          if (IN_WORKER.has(setup.kind)) offerCancel(busy, ticket);
          const job = { kind: setup.kind, t: keep.map((i) => n.t[i]), y: keep.map((i) => n.ratio[i]), geo: setup.geo, hold, times: [grid, n.t] };
          fitting = ticket;
          editedDuring = false;
          running = startFit(job, (p) => { if (ticket === runs) busy.textContent = progressText(p); }, signal);
          running.promise
            .then(({ fit: r, curves: [curve, fitted] }) => {
              if (ticket !== runs) return;
              fitting = null;
              // fitSlug numbers readings from those it was given; map back to the record.
              const fit = { ...r, used: r.used.map((j) => keep[j]), held: hold, grid, curve, fitted };
              show(curveResults(v, n, fit, setup, window, { ...ctx, dropped, editedDuring }));
              // An entry changed while the fit ran: these results are for the entries as
              // they were, so they are dimmed until the next run, as after any later edit.
              if (editedDuring) host.dataset.stale = '1';
              else done(host);
            })
            .catch((e) => {
              if (ticket !== runs) return;
              fitting = null;
              showError(e.message);
            });
        } catch (e) {
          showError(e.message);
        }
      },
    });
    host.append(out);
    // The form's own handler marks finished results stale; this catches the edits made
    // while a fit is still running, before there is a result to mark.
    const noteEdit = () => { if (fitting !== null && fitting === runs) editedDuring = true; };
    f.element.addEventListener('input', noteEdit);
    f.element.addEventListener('change', noteEdit);
  },
};
