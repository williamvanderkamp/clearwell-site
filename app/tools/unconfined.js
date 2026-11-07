// Fit an unconfined aquifer: the Neuman (1975) curve fitted to drawdown against time
// at one fully penetrating observation well.
import { logTimes, RATE_UNITS, TIME_NAMES, TIME_UNITS, UNITS } from '../../engine/index.js';
import { analyzeUnconfined, DISTANCE_UNITS, LENGTH_UNITS, neumanCurves } from '../../engine/unconfined.js';
import { timeUnitIn, unitInLabel } from '../columns.js';
import { toCsv, together } from '../format.js';
import { chart, columnSpec, columnValues, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table, TIME_OPTIONS, unit, unitOptions } from '../kit.js';

const DRAWDOWN = unitOptions(LENGTH_UNITS), LENGTH = unitOptions(DISTANCE_UNITS);
const RATES = unitOptions(Object.keys(RATE_UNITS));

// Kruseman and de Ridder (1994) Table 5.1, deep piezometer WII/90, after De Ridder (1966).
// The row at time zero is left out, since it holds no drawdown.
const VENNEBULTEN = [
  [1.17, 0.004], [1.34, 0.009], [1.7, 0.015], [2.5, 0.030], [4.0, 0.047], [5.0, 0.054], [6.0, 0.061], [7.5, 0.068],
  [9, 0.064], [14, 0.090], [18, 0.098], [21, 0.103], [26, 0.110], [31, 0.115], [41, 0.128], [51, 0.133], [65, 0.141],
  [85, 0.146], [115, 0.161], [175, 0.161], [260, 0.172], [300, 0.173], [370, 0.173], [430, 0.179], [485, 0.183],
  [665, 0.182], [1340, 0.200], [1490, 0.203], [1520, 0.204],
];
const HEADER = ['Time (min)', 'Drawdown (m)'];
const EXAMPLE = {
  label: 'Vennebulten test', name: 'vennebulten-wii-90.csv',
  csv: toCsv(HEADER, VENNEBULTEN),
  values: [['rate', 873], ['rateUnit', 'm3/d'], ['distance', 90], ['distanceUnit', 'm'], ['thickness', 21], ['thicknessUnit', 'm']],
  note: together(`Vennebulten, the Netherlands: deep piezometer 90 m from the well, pumped at 873 m³/d, saturated thickness 21 m (Kruseman and de Ridder 1994, Example 5.1 and Table 5.1, after De Ridder 1966). Their type curve match gave T = 1447 m²/d from the early curve and 1616 m²/d from the late curve, S = ${sig(5.2e-4, 2, true)}, Sy = 0.0049 and β = 0.01. The deep piezometers there sit 12 to 19 m below ground and are not screened over the full thickness; the book analyzes this one as if it were, and so does this example.`),
  // The book's answers, repeated with the results so they can be compared.
  book: together(`Kruseman and de Ridder (1994) matched type curves by eye to these readings: T = 1447 m²/d from the early curve and 1616 m²/d from the late curve, S = ${sig(5.2e-4, 2, true)}, Sy = 0.0049 and β = 0.01. A least squares fit is not expected to agree exactly.`),
};

/**
 * Every number shown, formatted once, so the headline, the table and the method text
 * agree. T and the conductivities are in the distance unit the user chose.
 */
function formats(res, v) {
  const { fit } = res, L = v.distanceUnit, RU = UNITS[L];
  // Trailing zeros are kept, so a value carries the figures it was rounded to.
  const kept = (x, p) => sig(x, p, true);
  return {
    metric: L === 'm', tUnit: unit(`${L}2/d`), kUnit: `${L}/d`,
    T: kept(fit.T / RU ** 2, 4), TSI: kept(fit.T, 4), S: kept(fit.S, 4), Sy: kept(fit.Sy, 4), beta: kept(fit.beta, 4),
    Kr: kept(res.Kr / RU, 4), KrSI: kept(res.Kr, 4), Kz: kept(res.Kz / RU, 4), KzSI: kept(res.Kz, 4), ratio: kept(res.anisotropy, 4),
    rms: kept(fit.rmse / UNITS[v.drawdownUnit], 3),
    // The headline: the same values to 3 significant figures.
    head: { T: kept(fit.T / RU ** 2, 3), S: kept(fit.S, 3), Sy: kept(fit.Sy, 3), ratio: kept(res.anisotropy, 3) },
  };
}

// How far the fitted curve still is from the late Theis curve at the last reading.
const lateGap = (share) => {
  const pct = (100 * Math.abs(share - 1)).toFixed(0);
  return pct === '0' ? 'within 1% of the late Theis curve' : `${pct}% ${share > 1 ? 'above' : 'below'} the late Theis curve`;
};

function methodText(res, v, F) {
  const { fit } = res;
  // A value as the user gave or sees it, then in metres and days when that differs.
  const both = (shown, u, si, siUnit) => (unit(u) === siUnit ? `${shown} ${siUnit}` : `${shown} ${unit(u)} = ${si} ${siUnit}`);
  return {
    steps: [
      { title: 'Readings used', lines: [
        `${res.rowsUsed} readings with a time above zero. They were averaged into 20 equal widths of log time to each log cycle, so each log cycle counts the same in the fit; ${fit.rows} of these bins hold drawdown above zero.`,
        'Converted to metres and days for the calculation. Each number below is given in the units you chose, then in metres and days where those differ.'],
      numbers: [
        ['Pumping rate Q', both(sig(v.rate, 4), v.rateUnit, sig(res.Q, 4), 'm³/d')],
        ['Distance r', both(sig(v.distance, 4), v.distanceUnit, sig(res.r, 4), 'm')],
        ['Saturated thickness b', both(sig(v.thickness, 4), v.thicknessUnit, sig(res.b, 4), 'm')],
      ] },
      { title: 'Neuman solution', lines: [
        'Drawdown in an unconfined aquifer pumped at a constant rate by a well screened over the full saturated thickness, averaged over that thickness, as a fully penetrating observation well sees it. The aquifer is uniform, infinite and anisotropic, water comes first from elastic storage and then from gravity drainage at the water table, and the water table is treated as a boundary that moves little (Neuman 1972, 1974, 1975).',
        'Here s is the drawdown at time t, Q the pumping rate, T the transmissivity, S the elastic storativity, Sy the specific yield, r the distance from the pumped well, b the saturated thickness, and Kr and Kz the horizontal and vertical hydraulic conductivity. W is the Neuman well function, uA and uB its early and late arguments, and β the drainage factor.',
        'W is computed from its Laplace transform, which follows from Neuman\'s boundary value problem, and turned back into time by the Stehfest (1970) algorithm with 16 terms. In the Laplace form, p is the Laplace variable of the dimensionless time ts = T t / (S r²), σ is S/Sy, K0 is the modified Bessel function of the second kind of order zero, and e_n (n = 0, 1, 2, ...) are the roots of e_n tan e_n = p / (σβ), one between nπ and nπ + π/2. In the limit S/Sy → 0 it reproduces Neuman\'s tabulated type A and type B values (Kruseman and de Ridder 1994, Annex 5.1) to within 2 in the last of the three printed digits.'],
      formula: 's = Q / (4πT) · W(uA, uB, β)\nuA = r²S / (4Tt),  uB = r²Sy / (4Tt),  β = r² Kz / (b² Kr)\nW(p) = (2/p) sum over n of 2 sin²(e_n) / (e_n (e_n + sin e_n cos e_n)) K0(√(β e_n² + p))', numbers: [] },
      { title: 'Least squares fit', lines: ['T, S, Sy and β were chosen to make the sum of squared differences between measured and computed drawdown as small as possible. For any S, S/Sy and β the best Q/(4πT) is a plain ratio. The search started from the best of a grid of S/Sy and β values and was finished by the Levenberg-Marquardt method on the logarithms of the three.'],
        numbers: [
          ['T', both(F.T, F.tUnit, F.TSI, 'm²/d')], ['S', F.S], ['Sy', F.Sy], ['β', F.beta], ['Sy/S', sig(1 / fit.sigma, 3)],
          ['Root mean square misfit', `${F.rms} ${unit(v.drawdownUnit)}`], ['Iterations', String(fit.iterations)],
        ] },
      { title: 'Hydraulic conductivities', lines: ['From the definition of β, with the saturated thickness given.'], formula: 'Kr = T / b\nKz/Kr = β b² / r²',
        numbers: [['Kr', both(F.Kr, F.kUnit, F.KrSI, 'm/d')], ['Kz/Kr', F.ratio], ['Kz', both(F.Kz, F.kUnit, F.KzSI, 'm/d')]] },
      { title: 'Theis asymptotes', lines: [
        'At early time the curve follows the Theis (1935) curve with the elastic storativity S. At late time it follows the Theis curve with S + Sy (Gambolati 1976; Kruseman and de Ridder 1994, 5.1.1). Both are drawn with the fitted T.',
        `At the last reading the fitted curve is ${lateGap(res.lateShare)}.`],
      formula: 'early: s = Q / (4πT) · W(r²S / (4Tt))\nlate:  s = Q / (4πT) · W(r² (S + Sy) / (4Tt))', numbers: [] },
    ],
    references: [
      ...(v.example ? ['De Ridder, N.A. (1966) Analysis of the pumping test \'De Vennebulten\' near Varsseveld (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 335.'] : []),
      'Gambolati, G. (1976) Transient free surface flow to a well: an analysis of theoretical solutions. Water Resources Research 12(1), 27-39.',
      'Kruseman, G.P., and de Ridder, N.A. (1994) Analysis and Evaluation of Pumping Test Data, 2nd edition. Publication 47, International Institute for Land Reclamation and Improvement, Wageningen.',
      'Neuman, S.P. (1972) Theory of flow in unconfined aquifers considering delayed response of the water table. Water Resources Research 8(4), 1031-1045.',
      'Neuman, S.P. (1974) Effect of partial penetration on flow in unconfined aquifers considering delayed gravity response. Water Resources Research 10(2), 303-312.',
      'Neuman, S.P. (1975) Analysis of pumping test data from anisotropic unconfined aquifers considering delayed gravity response. Water Resources Research 11(2), 329-342.',
      'Stehfest, H. (1970) Algorithm 368: Numerical inversion of Laplace transforms. Communications of the ACM 13(1), 47-49.',
      'Theis, C.V. (1935) The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions, American Geophysical Union 16(2), 519-524.',
    ],
  };
}

function results(res, v) {
  const { fit } = res;
  const F = formats(res, v);
  const du = unit(v.drawdownUnit);
  const toTime = (d) => d / TIME_UNITS[v.timeUnit], toLen = (m) => m / UNITS[v.drawdownUnit];
  const grid = logTimes(fit.from / 2, fit.to * 2, 120);
  const curves = neumanCurves(fit, grid);
  // Curves far below the lowest reading would only stretch the log axis.
  const floor = Math.min(...fit.bins.y) / 5;
  const shown = (y) => y.map((x) => (x >= floor ? toLen(x) : NaN));
  const text = methodText(res, v, F);
  // The unit is part of each name, so no row has an empty unit cell.
  const rows = [
    [`Transmissivity T (${F.tUnit})`, F.T],
    ...(F.metric ? [] : [['Transmissivity T (m²/d)', F.TSI]]),
    ['Storativity S, elastic', F.S],
    ['Specific yield Sy', F.Sy],
    ['Drainage factor β = r² Kz / (b² Kr)', F.beta],
    [`Horizontal hydraulic conductivity Kr (${F.kUnit})`, F.Kr],
    ...(F.metric ? [] : [['Horizontal hydraulic conductivity Kr (m/d)', F.KrSI]]),
    ['Anisotropy Kz/Kr', F.ratio],
    [`Vertical hydraulic conductivity Kz (${F.kUnit})`, F.Kz],
    ...(F.metric ? [] : [['Vertical hydraulic conductivity Kz (m/d)', F.KzSI]]),
    [`Root mean square misfit (${du})`, F.rms],
  ];
  const RU = UNITS[v.distanceUnit];
  const sheet = {
    name: 'Fit', header: [`Time (${v.timeUnit})`, `Neuman (${du})`, `Early Theis (${du})`, `Late Theis (${du})`],
    rows: grid.map((t, i) => [toTime(t), toLen(curves.neuman[i]), toLen(curves.early[i]), toLen(curves.late[i])]),
  };
  const readings = { name: 'Readings', header: [`Time (${v.timeUnit})`, `Drawdown (${du})`], rows: res.t.map((t, i) => [toTime(t), toLen(res.s[i])]) };
  // The values in metres and days get their own rows only when the user's unit is not metres.
  const summary = { name: 'Results', header: ['Result', 'Value', 'Unit'], rows: [
    ['Transmissivity T', fit.T / RU ** 2, F.tUnit],
    ...(F.metric ? [] : [['Transmissivity T', fit.T, 'm²/d']]),
    ['Storativity S, elastic', fit.S, 'none'],
    ['Specific yield Sy', fit.Sy, 'none'],
    ['Drainage factor β', fit.beta, 'none'],
    ['Horizontal hydraulic conductivity Kr', res.Kr / RU, F.kUnit],
    ...(F.metric ? [] : [['Horizontal hydraulic conductivity Kr', res.Kr, 'm/d']]),
    ['Anisotropy Kz/Kr', res.anisotropy, 'none'],
    ['Vertical hydraulic conductivity Kz', res.Kz / RU, F.kUnit],
    ...(F.metric ? [] : [['Vertical hydraulic conductivity Kz', res.Kz, 'm/d']]),
    ['Root mean square misfit', toLen(fit.rmse), du],
  ] };
  const said = [...(v.example ? [v.example.book] : []), ...res.warnings];
  // The spreadsheet carries the same caveats as the page.
  text.notes = said;
  return [
    panel(
      el('h2', {}, 'Unconfined aquifer fit'),
      el('p', { class: 'chart-sub' }, together(`T = ${F.head.T} ${F.tUnit}, S = ${F.head.S}, Sy = ${F.head.Sy}, Kz/Kr = ${F.head.ratio}. `
        + 'The Neuman curve fitted by least squares to the drawdown at one fully penetrating observation well.')),
      table(['Result', 'Value'], rows),
      said.length ? notes(said.map(together)) : null,
      el('div', { class: 'downloads' },
        el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('unconfined-fit.xlsx', [summary, readings, sheet], text) }, 'Download spreadsheet'))),
    panel(chart({
      title: 'Drawdown against time', xLabel: `Time since pumping began (${TIME_NAMES[v.timeUnit]})`, yLabel: `Drawdown (${du})`, logX: true, logY: true,
      // Measured, Neuman, early and late Theis take blue, orange, green and purple, so
      // the fit and the late curve it runs into are never two warm colours.
      series: [
        { label: 'Measured', x: res.t.map(toTime), y: res.s.map(toLen), line: false },
        { label: 'Neuman fit', x: grid.map(toTime), y: shown(curves.neuman) },
        { label: 'Early Theis (S)', x: grid.map(toTime), y: shown(curves.early) },
        { label: 'Late Theis (S + Sy)', x: grid.map(toTime), y: shown(curves.late) },
      ],
    })),
    panel(el('h2', {}, 'Exactly what was done'), method(text)),
  ];
}

export default {
  id: 'unconfined',
  title: 'Fit an unconfined aquifer',
  blurb: 'You have drawdown at an observation well in a water table aquifer. Fit the Neuman curve for T, S, specific yield and vertical anisotropy.',
  lede: 'The Neuman (1975) delayed gravity response, fitted to drawdown against time at one observation well. Both wells are taken to be screened over the full saturated thickness.',
  mount(host) {
    let data = null;
    const out = el('div', { class: 'stack' });
    const showError = (message) => out.append(errorBox(message));
    const drop = fileDrop(host, {
      text: 'A spreadsheet or CSV with elapsed time and drawdown at one observation well.',
      examples: [EXAMPLE],
      onTable(loaded) {
        const { header } = loaded.table, { example } = loaded;
        data = loaded;
        out.textContent = '';
        f.reset();
        f.setColumns(header);
        const time = findColumn(header, /time|elapsed/i), draw = findColumn(header, /draw.?down/i);
        f.set('time', time);
        f.set('drawdown', draw);
        f.set('timeUnit', time === undefined ? undefined : timeUnitIn(header[time]));
        f.set('drawdownUnit', draw === undefined ? undefined : unitInLabel(header[draw], LENGTH_UNITS) || undefined);
        if (example) example.values.forEach(([k, val]) => f.set(k, val));
        // One format on every tool: the file and its rows, then for an example its note.
        // The line stays through a run, so the book's values remain in view.
        drop.status(`${loaded.name}: ${loaded.table.rows.length} rows.${example ? ` ${example.note}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Elapsed time', need: 'Required', what: 'Time since pumping began. The unit is chosen below, or read from the heading.', headings: ['Time (min)', 'Time (h)'] },
        { name: 'Drawdown', need: 'Required', what: 'Fall in water level from the level before pumping, in m, cm or ft. Positive downward.', headings: ['Drawdown (m)', 'Drawdown (ft)'] },
      ],
      notes: ['One observation well per file, at one distance from the pumped well.', 'Readings from the pumping period only. Recovery is not used.'],
      examples: [{ label: EXAMPLE.label, name: 'vennebulten-wii-90.xlsx', header: HEADER, rows: VENNEBULTEN }],
    });
    const f = form(host, {
      fields: [
        { id: 'time', label: 'Time column', type: 'column', required: true },
        { id: 'timeUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'drawdown', label: 'Drawdown column', type: 'column', required: true },
        { id: 'drawdownUnit', label: 'Drawdown unit', type: 'select', options: DRAWDOWN, required: true },
        { id: 'rate', label: 'Pumping rate', type: 'number', required: true },
        { id: 'rateUnit', label: 'Rate unit', type: 'select', options: RATES, required: true },
        { id: 'distance', label: 'Distance from the pumped well', type: 'number', required: true },
        { id: 'distanceUnit', label: 'Distance unit', type: 'select', options: LENGTH, required: true, hint: 'T and the conductivities are given in this unit.' },
        { id: 'thickness', label: 'Saturated thickness before pumping', type: 'number', required: true },
        { id: 'thicknessUnit', label: 'Thickness unit', type: 'select', options: LENGTH, required: true },
      ],
      onRun(v) {
        out.textContent = '';
        if (!data) { showError('Add a file first.'); return; }
        if (v.time === v.drawdown) { showError('The time column and the drawdown column are the same column. Choose a different column for each.'); return; }
        out.append(el('p', { class: 'hint', role: 'status' }, 'Fitting...'));
        // The fit takes a moment, so the page shows "Fitting..." before it starts.
        setTimeout(() => {
          out.textContent = '';
          try {
            const res = analyzeUnconfined({ t: columnValues(data.table, v.time), s: columnValues(data.table, v.drawdown) }, v);
            out.append(...results(res, { ...v, example: data.example }));
            done(host);
          } catch (e) {
            showError(e.message);
          }
        }, 20);
      },
    });
    host.append(out);
  },
};
