// Predict drawdown: the reference tool. Others copy its shape: a form, a run, then a
// lead line, a table, a chart, the method text and a download.
//
// Beyond one well at a constant rate (Theis 1935), it predicts the drawdown of long-term
// production pumping from the values a test gave: a leaky or unconfined aquifer, rates
// that change over months or years, several wells, straight boundaries, the range of
// drawdown the values' 95% intervals allow, and how far the test itself reached. Values
// can be brought over from the fit page and the leaky aquifer tool (predict-fit.js). The
// form is read and the drawdowns worked out in predict-run.js, these in a Web Worker.
import { RATE_UNITS } from '../../engine/index.js';
import { wellFunction } from '../../engine/pumping.js';
import { boxCoverage, lineReach, LONG_TIME_SHARE, RANGE_GOLDEN, RANGE_STEPS, RANGE_SWEEPS, undoJacob } from '../../engine/predict.js';
import { chart, done, downloads, downloadWorkbook, el, errorBox, form, methodPanel, panel, sig, table, unit, unitOptions } from '../kit.js';
import { listed, together } from '../../engine/format.js';
import { takeHandOff } from '../handoff.js';
import { startJob } from '../worker-job.js';
import { fromFit, fromLeaky } from './predict-fit.js';
import { asTyped, daysText, readPrediction, runPrediction, SCHEDULE_TIMES } from './predict-run.js';
import { COOPER_JACOB_1946, FERRIS_ET_AL_1962_PAGES, HANTUSH_1956, HANTUSH_JACOB_1955, KRUSEMAN_DE_RIDDER_1994, NEUMAN_1975, THEIS_1935, VAN_DER_KAMP_1985, VAN_DER_KAMP_1989, VAN_DER_KAMP_ET_AL_2021 } from '../../engine/refs.js';

const LENGTH = unitOptions(['m', 'ft']);
const T_UNITS = unitOptions(['m2/d', 'ft2/d']);
const RATES = unitOptions(Object.keys(RATE_UNITS));
// Each aquifer as the page gives it: its name in the list, the caveat on its drawdowns,
// the storativity its drawdown spreads with, its solution in the method text with the
// values it adds there, and the sources it adds.
const AQUIFER_PAGE = {
  confined: {
    option: 'Confined (Theis 1935)',
    ideal: 'Real aquifers have boundaries and leakage, so treat these drawdowns as the ideal case.',
    storage: 'S',
    method: { title: 'Theis solution', lines: [
      'Drawdown from one well pumping at a constant rate in an ideal confined aquifer: uniform, infinite, fully penetrated, with no leakage or boundaries (Theis 1935).',
      's is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, t the time since pumping began, and W(u) the Theis well function.',
    ], formula: 's = Q / (4πT) · W(u),  u = r²S / (4Tt)' },
    numbers: () => [],
    references: [],
  },
  leaky: {
    option: 'Leaky, aquitard storage neglected (Hantush and Jacob 1955)',
    ideal: 'The aquitard is taken to store no water and the layer above it to hold its level, which long pumping may not allow (Kruseman and de Ridder 1994, p. 74), so treat these drawdowns as the ideal case.',
    storage: 'S',
    method: { title: 'Hantush and Jacob solution', lines: [
      'Drawdown from a well pumping at a constant rate from a confined aquifer that also takes water through an aquitard (Hantush and Jacob 1955). The aquifer is uniform, infinite and fully penetrated; flow in it is horizontal and through the aquitard vertical; the aquitard stores no water, and the level in the layer above it stays constant (Kruseman and de Ridder 1994, section 4.2.1). If that layer\'s level falls under long pumping, these drawdowns are too small, unless its transmissivity is much greater than the aquifer\'s (Kruseman and de Ridder 1994, p. 74).',
      'B is the leakage factor, √(Tc), with c the aquitard\'s resistance. W(u, r/B) is the leaky well function of Hantush (1956), the same code the fit page and the leaky aquifer tool use, checked against the table of Kruseman and de Ridder (1994, Annex 4.2). At long times it tends to 2 K0(r/B), and the drawdown to De Glee\'s steady drawdown (Kruseman and de Ridder 1994, equation 4.1).',
    ], formula: 's = Q / (4πT) · W(u, r/B),  u = r²S / (4Tt)\nsteady:  s = Q / (2πT) · K0(r/B)' },
    numbers: ({ v, inM }) => [['B', inM(v.B)]],
    references: [HANTUSH_1956, HANTUSH_JACOB_1955],
  },
  unconfined: {
    option: 'Unconfined, long times (Theis with S + Sy)',
    ideal: 'Theis with S + Sy holds once the delayed drainage is over; before that the drawdown is larger (Neuman 1975). Treat these drawdowns as the ideal case.',
    storage: 'S + Sy',
    method: { title: 'Unconfined aquifer at long times', lines: [
      'An unconfined aquifer gives water first from elastic storage and then by drainage as the water table falls. Once the delayed drainage is over, the drawdown follows the Theis curve again, with the final storativity S + Sy, elastic storage and drainage added (Gambolati 1976, as Kruseman and de Ridder 1994 give it, p. 104). Neuman\'s (1975) late curve uses Sy alone; where Sy is much larger than S, as it usually is, the two hardly differ.',
      'Before the drainage is over, the drawdown is larger than this (Neuman 1975). The storativity S from the early part of a test cannot be used to predict long-term drawdowns (Kruseman and de Ridder 1994, p. 101). The thickness is taken as unchanged, so the drawdown must be small against it.',
    ], formula: 's′ = Q / (4πT) · W(u),  u = r²(S + Sy) / (4Tt)' },
    numbers: ({ v, p }) => [['Sy', sig(v.Sy, 4)], ['S + Sy', sig(p.S + p.Sy, 4)]],
    references: [NEUMAN_1975],
  },
};
const AQUIFER_OPTIONS = Object.entries(AQUIFER_PAGE).map(([id, x]) => [id, x.option]);
const LAYOUTS = [['distances', 'One well, at distances from it'], ['map', 'Wells and points on a map (x, y)']];
const RATE_KINDS = [['constant', 'Constant'], ['schedule', 'Changing over time']];
const ARRANGEMENTS = [['one', 'One straight boundary'], ['parallel', 'Two parallel boundaries'], ['right', 'Two at right angles']];
const TYPES = [['head', 'Constant head (river, lake, canal)'], ['noflow', 'No flow (impermeable edge)']];
// Drawdown is shown to what a logger can resolve: 1 mm, or 0.01 ft.
const DECIMALS = { m: 3, ft: 2 };
// Up to this many days a constant-rate chart is in minutes, as it always was; past it, in days.
const MINUTES_UP_TO = 10;

// The invented test behind the pumping test tool's example (scripts/make-pumping-sample.js).
const EXAMPLES = [
  {
    label: 'Invented example (pumping test tool)',
    values: [['aquifer', 'confined'], ['T', 250], ['tUnit', 'm2/d'], ['S', 0.0002], ['layout', 'distances'], ['rateKind', 'constant'], ['Q', 129.6], ['qUnit', 'm3/d'], ['r', '10, 60, 250'], ['rUnit', 'm'], ['days', 3]],
    note: `Invented example: the test behind the pumping test tool's example, with T = 250 ${unit('m2/d')} and S = ${sig(2e-4, 3, true)}, pumped at 129.6 ${unit('m3/d')} for 3 days and observed at 60 m. The distances 10 m and 250 m are added to show how drawdown falls off with distance.`,
  },
  {
    label: 'Invented: a well near a river',
    values: [['aquifer', 'confined'], ['T', 250], ['tUnit', 'm2/d'], ['S', 0.0002], ['Tlo', 238], ['Thi', 263], ['Slo', 0.00016], ['Shi', 0.00025], ['layout', 'map'], ['rUnit', 'm'],
      ['wells', '0 0'], ['points', '60 0; -250 0; 0 300'], ['bounds', 'one'], ['b1Type', 'head'], ['b1At', 400], ['rateKind', 'constant'], ['Q', 500], ['qUnit', 'm3/d'], ['days', 3650], ['testDays', 3]],
    note: `Invented example with a known answer: the aquifer of the pumping test tool's example (T = 250 ${unit('m2/d')}, S = ${sig(2e-4, 3, true)}, with 95% intervals invented as a fit might give them), a production well pumping 500 ${unit('m3/d')} for 10 years, and a river along the line x = 400 m taken as a constant head. After 10 years the drawdown is steady, and is Dietz's (1943; Kruseman and de Ridder 1994, equations 6.1 and 6.2): Q/(2πT) ln(r′/r), with r′ the distance from the image well, 0.800 m at (60, 0), 0.457 m at (−250, 0) and 0.333 m at (0, 300).`,
  },
  {
    label: 'Dalem fit, seasonal pumping',
    values: [['aquifer', 'leaky'], ['T', 1662], ['tUnit', 'm2/d'], ['S', 0.001785], ['B', 738], ['Tlo', 1444], ['Thi', 1904], ['Slo', 0.001456], ['Shi', 0.002107], ['Blo', 488.7], ['Bhi', 1482],
      ['layout', 'map'], ['rUnit', 'm'], ['wells', '0 0\n400 0'], ['points', '90 0; 200 300; 1500 0'], ['rateKind', 'schedule'], ['schedule', '0 0; 125 500; 245 1500'], ['repeat', 365], ['until', 3650], ['qUnit', 'm3/d'], ['testDays', 0.333]],
    note: `The values and 95% intervals are what the fit page gives for its Dalem example (Hantush and Jacob, piezometer at 90 m; Kruseman and de Ridder 1994, Table 4.2, after De Ridder 1961), a test of 8 hours. The pumping is invented: two wells 400 m apart, each resting for four months, then pumping 500 ${unit('m3/d')} for four and 1500 for four, every year for 10 years.`,
  },
].map((x) => ({ ...x, note: together(x.note) }));

/** Drawdown to the decimals a logger resolves, or "< 0.001" where it rounds away. */
function drawdownText(s, u) {
  if (Number.isNaN(s)) return 'drained';
  const d = DECIMALS[u] ?? 3, least = 10 ** -d;
  return s < least ? `< ${least.toFixed(d)}` : s.toFixed(d);
}
const rangeText = (lo, hi, u) => `${drawdownText(lo, u)} to ${drawdownText(hi, u)}`;

// The drawdowns are worked out in a Web Worker, as the fit page's fits are, so the page
// stays live while the range over the intervals is found: seconds for a schedule over
// years, more between parallel boundaries. Where a worker cannot start, or fails to load,
// they are worked out here, after the page has cleared its old results. Gives startJob's
// { promise, stop } (worker-job.js): a promise of runPrediction's result, and a stop that
// ends the work if it is still going, as leaving the page does, after which the promise
// never settles.
const predictOffPage = (job, signal) => startJob(new URL('./predict-worker.js', import.meta.url), job, { fallback: () => runPrediction(job), delay: 20, signal });

export default {
  id: 'predict',
  group: 'tests',
  title: 'Predict drawdown',
  blurb: 'You know T and S, or have fitted a test. See the drawdown that pumping would cause, from one well for days to several wells for years, with leakage, boundaries and the range the fitted values allow.',
  lede: 'The drawdown that pumping would cause, from values a test gave: Theis, Hantush and Jacob, or an unconfined aquifer at long times, for rates that change over the years, several wells and straight boundaries.',
  mount(host, signal) {
    const out = el('div', { class: 'stack' });
    const showError = (message) => out.append(errorBox(message));
    // The prediction being worked out, if any, and whether an input changed meanwhile. A
    // run or an example started since, or leaving the page, makes it unwanted.
    let prediction = null, editedDuring = false;
    const stop = () => {
      if (prediction) prediction.stop();
      prediction = null;
    };
    // There is no file to drop here, so this tool writes its own line under the example
    // buttons, in the same place and style as fileDrop's status line.
    const line = el('p', { class: 'hint loaded', role: 'status', hidden: true });
    const status = (text) => {
      line.textContent = text;
      line.hidden = !text;
    };
    // Values brought from the fit page or the leaky tool, while their fields still hold them.
    let brought = null;
    const buttons = EXAMPLES.map((x, i) => el('button', { class: 'btn quiet', type: 'button', 'data-example': String(i), 'aria-pressed': 'false', onclick: () => {
      stop();
      f.reset();
      x.values.forEach(([k, val]) => f.set(k, val));
      brought = null;
      out.textContent = '';
      delete host.dataset.done;
      delete host.dataset.stale;
      buttons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
      status(x.note);
    } }, x.label));
    // The wrapper keeps the phone-width rule for .drop-actions inside the drop box from
    // placing this row in a second grid column.
    host.append(el('div', { class: 'examples' }, el('div', { class: 'drop-actions' }, buttons)), line);
    // Once the user edits a field the example filled in, the note no longer describes
    // the form, so it goes, and the example is no longer shown as chosen.
    const yours = () => {
      if (!buttons.some((b) => b.getAttribute('aria-pressed') === 'true')) return;
      buttons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
      status('');
    };
    const is = (k, x) => (v) => v[k] === x;
    const leaky = is('aquifer', 'leaky'), unconfined = is('aquifer', 'unconfined'), map = is('layout', 'map'), distances = is('layout', 'distances');
    const constant = is('rateKind', 'constant'), schedule = is('rateKind', 'schedule');
    const bounded = (v) => map(v) && Boolean(v.bounds), two = (v) => bounded(v) && v.bounds !== 'one';
    const f = form(host, {
      fields: [
        { id: 'aquifer', label: 'Aquifer', type: 'select', options: AQUIFER_OPTIONS, required: true },
        { id: 'T', label: 'Transmissivity T', type: 'number', required: true },
        { id: 'tUnit', label: 'Transmissivity unit', type: 'select', options: T_UNITS, required: true },
        { id: 'S', label: 'Storativity S', type: 'number', required: true, hint: 'For an unconfined aquifer, the elastic storativity.' },
        { id: 'B', label: 'Leakage factor B', type: 'number', required: leaky, show: leaky, hint: 'In the distance unit. B = √(Tc), with c the aquitard\'s resistance.' },
        { id: 'Sy', label: 'Specific yield Sy', type: 'number', required: unconfined, show: unconfined },
        { id: 'layout', label: 'Wells and points', type: 'select', options: LAYOUTS, required: true },
        { id: 'r', label: 'Distances (comma separated)', type: 'text', required: distances, show: (v) => !map(v), placeholder: 'e.g. 10, 50, 200' },
        { id: 'wells', label: 'Pumping wells, x y, one to a line', type: 'textarea', required: map, show: map, placeholder: '0 0\n400 0: 0 800; 180 0',
          hint: 'A well pumps the rate below, or rates of its own after a colon: time (days) and rate, as in 0 800; 180 0.' },
        { id: 'points', label: 'Points to predict at, x y', type: 'text', required: map, show: map, placeholder: 'e.g. 60 0; 250 -100', hint: 'Separated by semicolons.' },
        { id: 'rUnit', label: 'Distance unit', type: 'select', options: LENGTH, required: true, hint: 'Drawdown is given in this unit too.' },
        { id: 'rateKind', label: 'Pumping rate', type: 'select', options: RATE_KINDS, required: true },
        { id: 'Q', label: 'Pumping rate Q', type: 'number', required: constant, show: (v) => !schedule(v) },
        { id: 'schedule', label: 'Rate changes: time (days) and rate', type: 'text', required: schedule, show: schedule, placeholder: 'e.g. 0 800; 120 300; 240 0', hint: 'Each rate is held until the next change. 0 is a pause.' },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'days', label: 'Pumping time (days)', type: 'number', required: constant, show: (v) => !schedule(v) },
        { id: 'until', label: 'Predict to (days)', type: 'number', required: schedule, show: schedule },
        { id: 'repeat', label: 'Repeat the rate changes every (days)', type: 'number', show: (v) => schedule(v) || map(v), hint: 'For a pattern that repeats, such as 365 for a yearly one. Applies to every well\'s rates.' },
        { id: 'bounds', label: 'Boundaries', type: 'select', options: ARRANGEMENTS, show: map, hint: 'Put the map\'s y axis along boundary 1, so it is the line x = a.' },
        { id: 'b1Type', label: 'Boundary 1', type: 'select', options: TYPES, required: bounded, show: bounded },
        { id: 'b1At', label: 'Boundary 1 is the line x =', type: 'number', required: bounded, show: bounded, hint: 'In the distance unit.' },
        { id: 'b2Type', label: 'Boundary 2', type: 'select', options: TYPES, required: two, show: two },
        { id: 'b2At', label: 'Boundary 2 is the line (x = for parallel, y = at right angles)', type: 'number', required: two, show: two, hint: 'In the distance unit.' },
        { id: 'Tlo', label: 'T, lower end of its 95% interval', type: 'number' },
        { id: 'Thi', label: 'T, upper end of its 95% interval', type: 'number' },
        { id: 'Slo', label: 'S, lower end of its 95% interval', type: 'number' },
        { id: 'Shi', label: 'S, upper end of its 95% interval', type: 'number' },
        { id: 'Blo', label: 'B, lower end of its 95% interval', type: 'number', show: leaky },
        { id: 'Bhi', label: 'B, upper end of its 95% interval', type: 'number', show: leaky },
        { id: 'Sylo', label: 'Sy, lower end of its 95% interval', type: 'number', show: unconfined },
        { id: 'Syhi', label: 'Sy, upper end of its 95% interval', type: 'number', show: unconfined },
        { id: 'testDays', label: 'Length of the test the values come from (days)', type: 'number', hint: 'For how far the test\'s drawdown reached, against how far the prediction\'s does.' },
        { id: 'D', label: 'Saturated thickness', type: 'number', show: unconfined, hint: 'In the distance unit. For Jacob\'s correction, undone, and with Kz/Kr for when the delayed drainage is over.' },
        { id: 'KzKr', label: 'Anisotropy Kz/Kr', type: 'number', show: unconfined, hint: 'With the thickness: when Neuman\'s (1975) drawdown joins Theis with S + Sy.' },
      ],
      onRun: (v) => run(v),
    });
    // Between parallel boundaries over long times the image series needs more rings than are summed.
    const failure = (e) => (/did not converge/.test(e.message) ? `${e.message} Over long times between parallel boundaries it needs more image wells than are summed here: shorten the prediction, or build a model.` : e.message);
    f.element.addEventListener('input', yours);
    f.element.addEventListener('change', yours);
    const noteEdit = () => { if (prediction) editedDuring = true; };
    f.element.addEventListener('input', noteEdit);
    f.element.addEventListener('change', noteEdit);
    host.append(out);
    // Values brought from another tool fill the form; the line under the buttons says
    // where they came from and what is missing.
    const handed = takeHandOff('predict');
    if (handed) {
      brought = handed.kind === 'leaky' ? fromLeaky(handed) : fromFit(handed);
      if (brought) {
        f.set('aquifer', brought.aquifer);
        f.set('tUnit', `${brought.lu}2/d`);
        f.set('rUnit', brought.lu);
        for (const [k, x] of Object.entries(brought.fields)) f.set(k, x);
        if (brought.lastDay > 0) f.set('testDays', Number(brought.lastDay.toPrecision(4)));
        const missing = Object.entries(brought.values).filter(([, x]) => x.status === 'undetermined').map(([id]) => id);
        status(together(`Brought from ${brought.from === 'leaky' ? 'the leaky aquifer tool' : 'the fit page'}: ${brought.name}, in ${brought.lu}. ${missing.length ? `${listed(missing)} ${missing.length > 1 ? 'were' : 'was'} not determined by the test, so ${missing.length > 1 ? 'they are' : 'it is'} left blank: give ${missing.length > 1 ? 'values' : 'a value'} known from elsewhere, and the results will say so. ` : ''}${brought.lastDay > 0 ? `The length of the test is taken as the time of the last point fitted; change it if the test ran longer. ` : ''}${brought.unused || ''} Choose the wells, points and rates to predict for.`));
      }
    }

    // What each value rests on, for the notes: the user's own values, or ones brought over.
    function provenance(v, ids) {
      const said = [], none = new Map();
      if (!brought) return said;
      for (const id of ids) {
        const b = brought.values[id];
        if (!b) continue;
        // A value the test did not determine is named whatever aquifer is chosen now.
        if (b.status === 'undetermined') said.push(`${id} was ${b.notes[0]}. The prediction uses ${id} = ${asTyped(v[id])}, which you gave, not a value the test supports, and the drawdowns depend on it.`);
        if (b.status === 'undetermined' || brought.aquifer !== v.aquifer) continue;
        const kept = b.value !== undefined && v[id] === b.value;
        if (kept && b.status === 'none' && v[`${id}lo`] === undefined) none.set(b.notes[0], [...(none.get(b.notes[0]) || []), id]);
        else if (kept && b.notes.length && v[`${id}lo`] === b.lower && v[`${id}hi`] === b.upper) said.push(`The 95% interval of ${id} from the fit: ${b.notes.join('; ')}. The range may be too narrow for that.`);
      }
      // Values with no interval, for the same reason, in one note.
      for (const [why, syms] of none) said.push(`${listed(syms)}: ${why}. ${syms.length > 1 ? 'They add' : 'It adds'} nothing to the range.`);
      return said;
    }

    // The run: the form read and checked here, so a message comes at once, the drawdowns
    // worked out off the page, and the results shown once they come.
    function run(values) {
      stop();
      out.textContent = '';
      let read;
      try {
        read = readPrediction(values);
      } catch (e) {
        showError(failure(e));
        return;
      }
      editedDuring = false;
      prediction = predictOffPage(read.job, signal);
      prediction.promise
        .then((res) => {
          prediction = null;
          show(read, res);
          // An input changed while the drawdowns were worked out: these results are for
          // the inputs as they were, so they are dimmed until the next run.
          if (editedDuring) host.dataset.stale = '1';
          else done(host);
        })
        .catch((e) => {
          prediction = null;
          out.textContent = '';
          showError(failure(e));
        });
    }

    // The results: read is what readPrediction gave, and the rest what runPrediction did.
    function show(read, { curves, joined, peak, per, range, steady, steadyRange }) {
      const { v, a, p, ru, L, end, common, wells, points, twice, labels, lines, changing, box, D, t, plain } = read;
      const d = DECIMALS[ru], ranged = Object.keys(box);
      const shown = (s) => (D === undefined ? s : undoJacob(s, D)) / L;
      const last = curves.map((c) => c[c.length - 1]);

      // How far the test reached, and the prediction.
      const Seff = a.values(p).S;
      const reach = v.testDays > 0 ? { test: lineReach(p.T, Seff, v.testDays), pred: lineReach(p.T, Seff, end) } : null;

      // The page.
      const least = 10 ** -d;
      const tiny = labels.filter((_, i) => shown(last[i]) < least);
      const list = (rs) => rs.map((r) => asTyped(r)).join(', ');
      const where = v.layout === 'map' ? 'At the points' : 'At';
      const { ideal, storage } = AQUIFER_PAGE[v.aquifer];
      const said = [];
      if (twice.length) said.push(`${list(twice)} ${ru} ${twice.length === 1 ? 'was' : 'were'} listed more than once, and ${twice.length === 1 ? 'is' : 'are'} shown once.`);
      if (tiny.length) said.push(`${where} ${tiny.join(v.layout === 'map' ? '; ' : ', ')} ${ru} the drawdown after ${daysText(end)} is below ${least.toFixed(d)} ${ru}, too small for a logger to measure, so it is shown as < ${least.toFixed(d)}. ${changing ? '' : 'The cone of depression has barely reached that far. '}The spreadsheet has the computed values.`);
      said.push(...provenance(v, a.params));
      if (ranged.length) {
        const k = ranged.length;
        said.push(`The range is the least and the greatest drawdown the search finds over every combination of ${listed(ranged)} within ${k > 1 ? 'their' : 'its'} 95% interval${k > 1 ? 's' : ''}${a.params.length > k ? `, with ${listed(a.params.filter((id) => !box[id]))} held at the value given` : ''}. If the model is right and each interval holds its true value in 95% of tests, the true drawdown lies in the range in at least ${Math.round(boxCoverage(k) * 100)}% of them (Bonferroni's inequality), whatever the correlation between the values. It takes in combinations the test rules out where values trade off, so it can be wider than the test allows, and it leaves out errors in the rates, the distances, and the choice of aquifer and boundaries.`);
      } else said.push('No 95% intervals were given, so no range is shown: the drawdowns rest on the values exactly as given.');
      if (D !== undefined) {
        const drained = labels.filter((_, i) => Number.isNaN(shown(Math.max(...curves[i]))));
        said.push(`The drawdowns have Jacob's (1944) correction undone for a saturated thickness of ${asTyped(v.D)} ${ru}: s = D − √(D² − 2Ds′), with s′ the drawdown of Theis with S + Sy (Kruseman and de Ridder 1994, p. 101).${drained.length ? ` At ${drained.join('; ')} the computed drawdown passes half the thickness, where the correction has no answer: the aquifer would be drained, and no drawdown is given.` : ''}`);
      } else if (v.aquifer === 'unconfined') said.push('The drawdown must be small against the saturated thickness for these drawdowns to hold. Give the thickness to have Jacob\'s correction undone.');
      if (joined) {
        const late = labels.filter((_, i) => joined[i] > end);
        said.push(`For one well pumping a constant rate, Neuman's (1975) drawdown comes within ${LONG_TIME_SHARE * 100}% of Theis with S + Sy after ${labels.map((lab, i) => `${sig(joined[i], 3)} d at ${lab} ${ru}`).join('; ')}${v.layout === 'map' ? ' (each from its nearest well)' : ''}. Before then the drawdown is larger than shown${changing ? ', and after each change of rate the delayed drainage starts again for that change' : ''}.${late.length ? ` At ${late.join('; ')} ${ru} that is after the end of the prediction, so the drawdowns there are too small.` : ''}`);
        if (v.testDays > 0 && Math.max(...joined) > v.testDays) said.push(`The test lasted ${daysText(v.testDays)}, less than the drainage takes, so it may have ended before its own drainage was over, and Sy from it may be low: Sy from the late curve is often unreasonably low (Kruseman and de Ridder 1994, pp. 100 and 106, after van der Kamp 1985).`);
      } else if (v.aquifer === 'unconfined') said.push('Give the saturated thickness and Kz/Kr to see when the delayed drainage is over and the long-time form holds.');
      if (reach) {
        const ratio = end / v.testDays;
        said.push(`The test lasted ${daysText(v.testDays)} and the prediction runs ${ratio >= 1 ? `${sig(ratio, 3)} times as long` : 'less long'}. Cooper and Jacob's straight line reaches zero drawdown at r₀ = 1.5 √(Tt/S): about ${sig(reach.test / L, 3)} ${ru} at the end of the test, and ${sig(reach.pred / L, 3)} ${ru} at the end of the prediction${storage === 'S' ? '' : `, with ${storage}`}. Beyond ${sig(reach.test / L, 3)} ${ru} the test saw little of the aquifer, so the prediction there rests on the aquifer being as uniform and unbounded, but for the boundaries given, as where the test saw it.`);
        if (v.layout === 'distances') {
          const far = labels.filter((_, i) => points[i].x > reach.test);
          if (far.length) said.push(`${list(far.map(Number))} ${ru} ${far.length > 1 ? 'are' : 'is'} beyond the ${sig(reach.test / L, 3)} ${ru} the test reached.`);
        }
      }
      // The spreadsheet carries the same caveats as the page.
      const text = methodText({ v, a, p, L, ru, wells, points, lines, labels, end, common, changing, plain, box, range, reach, D, t, joined });
      text.notes = [ideal, ...said];

      const head = (ids) => ids.map((id) => `${id} = ${id === 'S' || id === 'Sy' ? sig(v[id], 4) : `${asTyped(v[id])} ${id === 'T' ? unit(v.tUnit) : ru}`}`);
      const lead = changing ? `The rates given, to ${daysText(end)}` : `After ${daysText(end)} at ${asTyped(v.Q)} ${unit(v.qUnit)}`;
      const pointHead = v.layout === 'map' ? `Point x, y (${ru})` : `Distance (${ru})`;
      const rangeCol = range ? [`Range from the 95% intervals (${ru})`] : [];
      const endRows = labels.map((lab, i) => [plain ? Number(lab) : lab, drawdownText(shown(last[i]), ru), ...(range ? [rangeText(shown(range.low[i * per]), shown(range.high[i * per]), ru)] : [])]);
      const peakRows = changing ? labels.map((lab, i) => [lab, drawdownText(shown(curves[i][peak[i]]), ru), asTyped(Number(t[peak[i]].toPrecision(4))), ...(range ? [rangeText(shown(range.low[i * per + 1]), shown(range.high[i * per + 1]), ru)] : [])]) : null;
      const steadyRows = steady ? labels.map((lab, i) => [lab, drawdownText(steady[i] / L, ru), ...(steadyRange ? [rangeText(steadyRange.low[i] / L, steadyRange.high[i] / L, ru)] : [])]) : null;

      const days = !changing && !plain && end > MINUTES_UP_TO;
      const tx = changing || days ? t : t.map((x) => x * 1440);
      const tName = changing ? 'Days since the rates began' : days ? 'Days since pumping began' : 'Minutes since pumping began';
      const sheets = [{
        name: 'Drawdown', header: [tName, ...labels.map((lab) => `Drawdown at ${lab} ${ru} (${ru})`)],
        rows: tx.map((m, i) => [m, ...curves.map((c) => shown(c[i]))]),
      }];
      if (!plain) {
        sheets.push({
          name: 'Results', header: ['Point', `Drawdown at ${asTyped(end)} d (${ru})`, `Least over the intervals (${ru})`, `Greatest over the intervals (${ru})`,
            `Largest drawdown (${ru})`, 'At day', `Least there (${ru})`, `Greatest there (${ru})`, `Steady drawdown (${ru})`],
          rows: labels.map((lab, i) => [lab, shown(last[i]), range ? shown(range.low[i * per]) : null, range ? shown(range.high[i * per]) : null,
            changing ? shown(curves[i][peak[i]]) : null, changing ? t[peak[i]] : null, range && changing ? shown(range.low[i * per + 1]) : null, range && changing ? shown(range.high[i * per + 1]) : null,
            steady ? steady[i] / L : null].map((x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x))),
        });
      }
      out.append(panel(
        el('h2', {}, 'Predicted drawdown'),
        el('p', { class: 'chart-sub' }, together(`${lead}, with ${listed(head(a.params))}. ${ideal}`)),
        table([pointHead, `Drawdown at ${asTyped(end)} d (${ru})`, ...rangeCol], endRows),
        peakRows ? el('h3', {}, 'Largest drawdown over the prediction') : null,
        peakRows ? table([pointHead, `Largest drawdown (${ru})`, 'At day', ...(range ? [`Range at that day (${ru})`] : [])], peakRows) : null,
        steadyRows ? el('h3', {}, 'Steady drawdown, if the rate were held for ever') : null,
        steadyRows ? table([pointHead, `Steady drawdown (${ru})`, ...rangeCol], steadyRows) : null,
        said.length ? el('ul', { class: 'notes' }, said.map((s) => el('li', {}, together(s)))) : null,
        downloads(() => downloadWorkbook('predicted-drawdown.xlsx', sheets, text))),
      panel(chart({
        title: 'Drawdown against time', xLabel: changing ? 'Time since the rates began (days)' : days ? 'Time since pumping began (days)' : 'Time since pumping began (minutes)',
        yLabel: `Drawdown (${ru})`, logX: !changing, invertY: true,
        series: labels.map((lab, i) => ({ label: `${lab} ${ru}`, x: tx, y: curves[i].map(shown) })),
      })),
      ...(plain ? [] : [panel(el('h2', {}, 'Beyond these solutions'), el('p', {}, 'The extended drawdown on ', el('a', { href: '#pumping' }, 'the pumping test tool'),
        ' (van der Kamp 1989) carries a test\'s drawdown past the end of pumping, from the recovery, for as long as the recovery was measured. A longer effective test reaches farther: put that length above to see how far. Where the aquifer is not uniform, has boundaries that are not straight lines, or loses water to rivers and wells in ways these solutions leave out, ',
        el('a', { href: '#model' }, 'build a model'), ' instead.'))]),
      methodPanel(text));
    }
  },
};

/** The method text: the solution, the pumping, the boundaries, the range and the reach. */
function methodText({ v, a, p, L, ru, wells, points, lines, labels, end, common, changing, plain, box, range, reach, D, t, joined }) {
  const conv = (typed, u, si, siValue) => {
    const shown = `${asTyped(typed)} ${unit(u)}`;
    return u === si ? shown : `${shown} = ${sig(siValue, 4)} ${unit(si)}`;
  };
  const inM = (x) => (ru === 'm' ? `${asTyped(x)} m` : `${asTyped(x)} ${ru} = ${sig(x * L, 4)} m`);
  const kind = AQUIFER_PAGE[v.aquifer];
  const steps = [{ ...kind.method, numbers: [['T', conv(v.T, v.tUnit, 'm2/d', p.T)], ['S', sig(v.S, 4)], ...kind.numbers({ v, p, inM })] }];
  // The pumping.
  const rateLines = [];
  const qText = (x) => `${asTyped(x / RATE_UNITS[v.qUnit])} ${unit(v.qUnit)}`;
  const ratesText = (rates) => rates.map(([t0, Q]) => `${asTyped(t0)} d: ${qText(Q)}`).join('; ');
  if (v.rateKind === 'constant') rateLines.push(`A constant rate of ${conv(v.Q, v.qUnit, 'm3/d', common[0][1])} from 0 to ${daysText(end)}.`);
  else rateLines.push(`Rates changing at the times given, each held until the next${v.repeat !== undefined ? `, repeated every ${daysText(v.repeat)}` : ''}, to ${daysText(end)}: ${common.length} changes in all${common.length <= 12 ? ` (${ratesText(common)})` : ''}.`);
  if (wells.some((w) => w.own)) rateLines.push(`Wells with rates of their own: ${wells.map((w, i) => (w.own ? `well ${i + 1}, ${w.rates.length} changes` : null)).filter(Boolean).join('; ')}.`);
  if (changing || wells.length > 1) {
    rateLines.push('Each change of rate starts a new well pumping the change, from the time of the change, and the wells add: superposition, which rests on the flow equation being linear (Kruseman and de Ridder 1994, chapter 6; van der Kamp 1989).');
  }
  if (v.layout === 'map') rateLines.push(`Wells at (x, y) in ${ru}: ${wells.map((w) => `(${asTyped(w.x / L)}, ${asTyped(w.y / L)})`).join('; ')}. Points: ${labels.map((lab) => `(${lab})`).join('; ')}.`);
  rateLines.push(changing ? `Drawdown is computed at ${t.length} times: ${SCHEDULE_TIMES} spread evenly to the end, and each change of rate, where a fall in rate begins. The largest drawdown is the largest at those times.`
    : `Drawdown is computed at 80 times spaced evenly in log time, from 1 minute to ${daysText(end)}.`);
  rateLines.push(`Converted to metres and days for the calculation. The drawdown is then given back in ${ru}.`);
  steps.push({ title: 'Pumping', lines: rateLines, numbers: v.layout === 'distances' ? [['r', ru === 'm' ? `${labels.join(', ')} m` : `${labels.join(', ')} ${ru} = ${points.map((pt) => sig(pt.x, 4)).join(', ')} m`], [changing ? 'Predicted to' : 'Pumping time t', `${asTyped(end)} d`]] : [['Predicted to', `${asTyped(end)} d`]] });
  if (lines.length) {
    const kind = (l) => (l.type === 'head' ? 'constant head' : 'no flow');
    steps.push({ title: 'Boundaries', lines: [
      `Straight boundaries, fully penetrating: ${lines.map((l, i) => `boundary ${i + 1}, the line ${l.axis} = ${asTyped(l.at / L)} ${ru}, ${kind(l)}`).join('; ')}.`,
      'Each is replaced by image wells, reflections of each pumping well across it, pumping the same rates: an image across a constant head boundary injects, one across a no-flow boundary pumps (Ferris et al. 1962; Kruseman and de Ridder 1994, chapter 6). At right angles there are three images of each well; between parallel boundaries the images go on for ever, and are added until the next pair changes the drawdown by less than 10⁻¹⁰ of it. A constant head boundary is taken to be in full contact with the aquifer, with no resistance in its bed.',
    ], numbers: [] });
  }
  const boxed = Object.keys(box);
  if (boxed.length) {
    const n = (x, id) => (id === 'S' || id === 'Sy' ? sig(x, 4) : id === 'T' ? `${sig(x, 4)} ${unit('m2/d')}` : `${sig(x, 4)} m`);
    steps.push({ title: 'Range from the 95% intervals', lines: [
      `Each value given an interval may lie anywhere in it, whatever the others are: a box of values. The range is the least and the greatest drawdown over the box, found on a grid of ${RANGE_STEPS} values of each, evenly spread in log scale with both ends included, and the values given; each least and greatest is then refined by golden-section search along each value in turn, ${RANGE_GOLDEN} steps between the grid values either side of it, ${RANGE_SWEEPS} times over. This is done at the end of the prediction${changing ? ', and at the time of each point\'s largest drawdown for the values given' : ''}. A least or greatest that needs two values moved together, away from the grid, could be missed.`,
      `If each interval holds its true value with probability 95%, all ${boxed.length} hold theirs together with probability at least 1 − ${boxed.length} × 0.05 = ${sig(boxCoverage(boxed.length), 2)}, by Bonferroni's inequality, P(all hold) ≥ 1 − Σ P(each fails), which needs nothing of the correlation between them (NIST/SEMATECH 2012, section 7.4.7.3). If the aquifer, rates and boundaries are right, the true drawdown then lies in the range at least that often. The intervals themselves are approximate, as the fit page says, so this is too.`,
    ], formula: 'range = [ min over the box of s,  max over the box of s ]\nP(every value in its interval) ≥ 1 − Σ P(a value outside its interval)', numbers: boxed.map((id) => [`${id} interval`, `${n(box[id][0], id)} to ${n(box[id][1], id)}`]) });
  }
  if (reach) {
    const S2 = kind.storage;
    steps.push({ title: 'How far the test reached', lines: [
      `Cooper and Jacob's (1946) straight line meets zero drawdown at r₀ = √(2.25 Tt / ${S2}) (Kruseman and de Ridder 1994, equation 3.10). Theis's drawdown there is not zero: u = 0.5625, so s = Q/(4πT) · W(u) with W(u) = ${sig(wellFunction(0.5625), 4)}. So r₀ is a scale for how far the drawdown spread, not an edge.`,
      'Recovery readings probe farther than the pumping did (van der Kamp, Grunsky and Wei 2021), and the extended drawdown on the pumping test tool carries the drawdown on past the end of pumping (van der Kamp 1989); a test so lengthened can be entered with its effective length.',
    ], formula: `r₀ = √(2.25 Tt / ${S2}) = 1.5 √(Tt / ${S2})`, numbers: [['Test length', `${asTyped(v.testDays)} d`], [`r₀ at the end of the test (${ru})`, sig(reach.test / L, 4)], [`r₀ at the end of the prediction (${ru})`, sig(reach.pred / L, 4)]] });
  }
  if (joined) {
    steps.push({ title: 'When the delayed drainage is over', lines: [`Neuman's (1975) drawdown for one well pumping a constant rate, from the fit page's solution library (Stehfest inversion, checked against Kruseman and de Ridder 1994, Annex 5.1), is compared with Theis's with S + Sy at 10 times to a log cycle; the time given is the last at which they differ by more than ${LONG_TIME_SHARE * 100}% of Theis's, narrowed to 0.1% by bisection. ${LONG_TIME_SHARE * 100}% is this page's choice, not a published one. Neuman's solution takes both wells screened over the whole saturated thickness.`],
      numbers: [['Kz/Kr', sig(v.KzKr, 4)], ...labels.map((lab, i) => [`Within ${LONG_TIME_SHARE * 100}% after, at ${lab} ${ru} (d)`, sig(joined[i], 4)])] });
  }
  if (D !== undefined) {
    steps.push({ title: 'Jacob\'s correction, undone', lines: ['In an unconfined aquifer the saturated thickness falls with the water table. Jacob (1944) corrects a measured drawdown s to the drawdown s′ the aquifer would show if its thickness D did not change; the correction holds for the late drawdowns that follow the Theis curve (Neuman 1975, as Kruseman and de Ridder 1994 give it, pp. 101 and 102). Here s′ is computed, and s is found from it. Past s′ = D/2 there is no answer.'],
      formula: 's′ = s − s² / (2D),  so  s = D − √(D² − 2Ds′)', numbers: [['D', inM(v.D)]] });
  }
  if (plain) {
    // One worked value, so the numbers can be checked against a W(u) table.
    const r0 = points[0].x, u0 = (r0 ** 2 * p.S) / (4 * p.T * end);
    const W0 = wellFunction(u0), s0 = (common[0][1] / (4 * Math.PI * p.T)) * W0;
    steps.push({ title: 'One value worked through', lines: [`At r = ${labels[0]} ${ru} at the end of pumping, in metres and days:`], numbers: [
      ['u', sig(u0, 4, true)], ['W(u)', sig(W0, 4, true)], ['s (m)', sig(s0, 4, true)], ...(ru === 'm' ? [] : [[`s (${ru})`, sig(s0 / L, 4, true)]]),
    ] });
  }
  const refs = [
    THEIS_1935,
  ];
  if (!plain) {
    refs.push(KRUSEMAN_DE_RIDDER_1994);
    refs.push(...kind.references);
    if (joined && v.testDays > 0 && Math.max(...joined) > v.testDays) refs.push(VAN_DER_KAMP_1985);
    if (lines.length) refs.push(FERRIS_ET_AL_1962_PAGES);
    if (boxed.length) refs.push('NIST/SEMATECH (2012) e-Handbook of Statistical Methods, section 7.4.7.3, Bonferroni\'s method. National Institute of Standards and Technology. https://www.itl.nist.gov/div898/handbook/');
    if (reach) refs.push(COOPER_JACOB_1946, VAN_DER_KAMP_ET_AL_2021);
    refs.push(VAN_DER_KAMP_1989);
  }
  return { steps, references: refs };
}
