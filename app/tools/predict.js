// Predict drawdown: the reference tool. Others copy its shape: a form, a run, then a
// lead line, a table, a chart, the method text and a download.
import { RATE_UNITS, UNITS } from '../../engine/index.js';
import { logTimes } from '../../engine/numeric.js';
import { wellFunction } from '../../engine/pumping.js';
import { parseDistances, predictDrawdown } from '../../engine/predict.js';
import { chart, done, downloadWorkbook, el, errorBox, form, method, panel, sig, table, unit, unitOptions } from '../kit.js';
import { together } from '../format.js';

const LENGTH = unitOptions(['m', 'ft']);
const T_UNITS = unitOptions(['m2/d', 'ft2/d']);
const RATES = unitOptions(Object.keys(RATE_UNITS));
// Drawdown is shown to what a logger can resolve: 1 mm, or 0.01 ft.
const DECIMALS = { m: 3, ft: 2 };
// The shortest pumping time: the first computed time is one minute.
const MINUTE = 1 / 1440;

// The invented test behind the pumping test tool's example (scripts/make-pumping-sample.js).
const EXAMPLE = {
  label: 'Invented example (pumping test tool)',
  values: [['T', 250], ['tUnit', 'm2/d'], ['S', 0.0002], ['Q', 129.6], ['qUnit', 'm3/d'], ['r', '10, 60, 250'], ['rUnit', 'm'], ['days', 3]],
  note: together(`Invented example: the test behind the pumping test tool's example, with T = 250 ${unit('m2/d')} and S = ${sig(2e-4, 3, true)}, pumped at 129.6 ${unit('m3/d')} for 3 days and observed at 60 m. The distances 10 m and 250 m are added to show how drawdown falls off with distance.`),
};

// A number as the user typed it, without float noise or e+30.
const asTyped = (x) => sig(x, 6);
const daysText = (d) => `${asTyped(d)} ${d === 1 ? 'day' : 'days'}`;

/** Drawdown to the decimals a logger resolves, or "< 0.001" where it rounds away. */
function drawdownText(s, u) {
  const d = DECIMALS[u] ?? 3, least = 10 ** -d;
  return s < least ? `< ${least.toFixed(d)}` : s.toFixed(d);
}

export default {
  id: 'predict',
  title: 'Predict drawdown',
  blurb: 'You know T and S, or want to plan a test. See the drawdown a pumping rate would cause at any distance and time.',
  lede: 'The Theis solution run forward: the drawdown a constant rate would cause in an ideal confined aquifer, at the distances you give.',
  mount(host) {
    const out = el('div', { class: 'stack' });
    const showError = (message) => out.append(errorBox(message));
    // There is no file to drop here, so this tool writes its own line under the example
    // button, in the same place and style as fileDrop's status line.
    const line = el('p', { class: 'hint loaded', role: 'status', hidden: true });
    const status = (text) => {
      line.textContent = text;
      line.hidden = !text;
    };
    const exampleButton = el('button', { class: 'btn quiet', type: 'button', 'data-example': '0', 'aria-pressed': 'false', onclick: () => {
      f.reset();
      EXAMPLE.values.forEach(([k, val]) => f.set(k, val));
      out.textContent = '';
      delete host.dataset.done;
      delete host.dataset.stale;
      exampleButton.setAttribute('aria-pressed', 'true');
      status(EXAMPLE.note);
    } }, EXAMPLE.label);
    // The wrapper keeps the phone-width rule for .drop-actions inside the drop box from
    // placing this row in a second grid column.
    host.append(el('div', { class: 'examples' }, el('div', { class: 'drop-actions' }, exampleButton)), line);
    // Once the user edits a field the example filled in, the note no longer describes
    // the form, so it goes, and the example is no longer shown as chosen.
    const yours = () => {
      if (exampleButton.getAttribute('aria-pressed') !== 'true') return;
      exampleButton.setAttribute('aria-pressed', 'false');
      status('');
    };
    const f = form(host, {
      fields: [
        { id: 'T', label: 'Transmissivity T', type: 'number', required: true },
        { id: 'tUnit', label: 'Transmissivity unit', type: 'select', options: T_UNITS, required: true },
        { id: 'S', label: 'Storativity S', type: 'number', required: true },
        { id: 'Q', label: 'Pumping rate Q', type: 'number', required: true },
        { id: 'qUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'r', label: 'Distances (comma separated)', type: 'text', required: true, placeholder: 'e.g. 10, 50, 200' },
        { id: 'rUnit', label: 'Distance unit', type: 'select', options: LENGTH, required: true, hint: 'Drawdown is given in this unit too.' },
        { id: 'days', label: 'Pumping time (days)', type: 'number', required: true },
      ],
      onRun(v) {
        out.textContent = '';
        try {
          if (!(v.T > 0)) throw new Error('The transmissivity must be above zero.');
          if (!(v.S > 0 && v.S < 1)) throw new Error('The storativity must be above zero and below 1.');
          if (!(v.Q > 0)) throw new Error('The pumping rate must be above zero.');
          if (!(v.days > MINUTE)) throw new Error('The pumping time must be longer than one minute (about 0.0007 days).');
          const { distances, twice } = parseDistances(v.r);
          const ru = v.rUnit, L = UNITS[ru], d = DECIMALS[ru];
          const T = v.tUnit === 'ft2/d' ? v.T * UNITS.ft ** 2 : v.T, Q = v.Q * RATE_UNITS[v.qUnit];
          const t = logTimes(MINUTE, v.days, 80);
          const curves = distances.map((r) => predictDrawdown({ T, S: v.S, wells: [{ Q, r: r * L }], t }).map((s) => s / L));
          const minutes = t.map((x) => x * 1440);
          const last = curves.map((c) => c[c.length - 1]);
          const least = 10 ** -d, tiny = distances.filter((_, i) => last[i] < least);
          const list = (rs) => rs.map((r) => asTyped(r)).join(', ');
          // One worked value, so the numbers can be checked against a W(u) table.
          const r0 = distances[0] * L, u0 = (r0 ** 2 * v.S) / (4 * T * v.days);
          const W0 = wellFunction(u0), s0 = (Q / (4 * Math.PI * T)) * W0;
          const conv = (typed, u, si, siValue) => {
            const shown = `${asTyped(typed)} ${unit(u)}`;
            return u === si ? shown : `${shown} = ${sig(siValue, 4)} ${unit(si)}`;
          };
          const text = {
            steps: [
              { title: 'Theis solution', lines: [
                'Drawdown from one well pumping at a constant rate in an ideal confined aquifer: uniform, infinite, fully penetrated, with no leakage or boundaries (Theis 1935).',
                's is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well, t the time since pumping began, and W(u) the Theis well function.',
                `Converted to metres and days for the calculation. The drawdown is then given back in ${ru}.`,
                `Drawdown is computed at 80 times spaced evenly in log time, from 1 minute to ${daysText(v.days)}.`,
              ], formula: 's = Q / (4πT) · W(u),  u = r²S / (4Tt)', numbers: [
                ['T', conv(v.T, v.tUnit, 'm2/d', T)],
                ['S', sig(v.S, 4)],
                ['Q', conv(v.Q, v.qUnit, 'm3/d', Q)],
                ['r', ru === 'm' ? `${list(distances)} m` : `${list(distances)} ${ru} = ${distances.map((r) => sig(r * L, 4)).join(', ')} m`],
                ['Pumping time t', `${asTyped(v.days)} d`],
              ] },
              { title: 'One value worked through', lines: [`At r = ${asTyped(distances[0])} ${ru} at the end of pumping, in metres and days:`], numbers: [
                ['u', sig(u0, 4, true)], ['W(u)', sig(W0, 4, true)], ['s (m)', sig(s0, 4, true)], ...(ru === 'm' ? [] : [[`s (${ru})`, sig(s0 / L, 4, true)]]),
              ] },
            ],
            references: ['Theis, C.V. (1935) The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions, American Geophysical Union 16(2), 519-524.'],
          };
          const rows = distances.map((r, i) => [r, drawdownText(last[i], ru)]);
          const said = [];
          const ideal = 'Real aquifers have boundaries and leakage, so treat these drawdowns as the ideal case.';
          if (twice.length) said.push(`${list(twice)} ${ru} ${twice.length === 1 ? 'was' : 'were'} listed more than once, and ${twice.length === 1 ? 'is' : 'are'} shown once.`);
          if (tiny.length) said.push(`At ${list(tiny)} ${ru} the drawdown after ${daysText(v.days)} is below ${least.toFixed(d)} ${ru}, too small for a logger to measure, so it is shown as < ${least.toFixed(d)}. The cone of depression has barely reached that far. The spreadsheet has the computed values.`);
          // The spreadsheet carries the same caveats as the page.
          text.notes = [ideal, ...said];
          const sheet = {
            name: 'Drawdown', header: ['Minutes since pumping began', ...distances.map((r) => `Drawdown at ${asTyped(r)} ${ru} (${ru})`)],
            rows: minutes.map((m, i) => [m, ...curves.map((c) => c[i])]),
          };
          out.append(panel(
            el('h2', {}, 'Predicted drawdown'),
            el('p', { class: 'chart-sub' }, together(`After ${daysText(v.days)} at ${asTyped(v.Q)} ${unit(v.qUnit)}, with T = ${asTyped(v.T)} ${unit(v.tUnit)} and S = ${sig(v.S, 4)}. ${ideal}`)),
            table([`Distance (${ru})`, `Drawdown at ${asTyped(v.days)} d (${ru})`], rows),
            said.length ? el('ul', { class: 'notes' }, said.map((s) => el('li', {}, together(s)))) : null,
            el('div', { class: 'downloads' },
              el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('predicted-drawdown.xlsx', [sheet], text) }, 'Download spreadsheet'))),
          panel(chart({
            title: 'Drawdown against time', xLabel: 'Time since pumping began (minutes)', yLabel: `Drawdown (${ru})`, logX: true, invertY: true,
            series: distances.map((r, i) => ({ label: `${asTyped(r)} ${ru}`, x: minutes, y: curves[i] })),
          })),
          panel(el('h2', {}, 'Exactly what was done'), method(text)));
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });
    f.element.addEventListener('input', yours);
    f.element.addEventListener('change', yours);
    host.append(out);
  },
};
