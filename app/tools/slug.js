// Analyze a slug test: Hvorslev (1951) or Bouwer and Rice (1976), fitted to the
// normalized head in Butler's (1998) recommended range or a window the user sets.
// The saturated thickness is D, as in Bouwer and Rice (1976), so that H means only
// the displacement in H/H0.
import { UNITS } from '../../engine/index.js';
import { bouwerRice, fitWindow, HEAD_RANGE, hvorslev, normalize, TIME_S } from '../../engine/slug.js';
import { timeUnitIn } from '../columns.js';
import { fixed } from '../format.js';
import { chart, columnSpec, columnValues, done, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, method, notes, panel, sig, table, tenTo, TIME_OPTIONS, unitOptions } from '../kit.js';
import { SLUG_EXAMPLES } from './slug-examples.js';

const METHODS = [['hvorslev', 'Hvorslev (1951)'], ['bouwerRice', 'Bouwer and Rice (1976)']];
const LENGTH = unitOptions(['m', 'cm', 'ft', 'in']);
const KINDS = [['disp', 'Displacement from static'], ['level', 'Water level or depth to water']];

// Each method lists only the works its text cites.
const REF = {
  bouwer: 'Bouwer, H. (1989) The Bouwer and Rice slug test: an update. Ground Water 27(3), 304-309.',
  bouwerRice: 'Bouwer, H., and Rice, R.C. (1976) A slug test for determining hydraulic conductivity of unconfined aquifers with completely or partially penetrating wells. Water Resources Research 12(3), 423-428.',
  butler: 'Butler, J.J., Jr. (1998) The Design, Performance, and Analysis of Slug Tests. Lewis Publishers, Boca Raton, Florida, 252 p.',
  hvorslev: 'Hvorslev, M.J. (1951) Time lag and soil permeability in ground-water observations. Bulletin 36, Waterways Experiment Station, U.S. Army Corps of Engineers, Vicksburg, Mississippi.',
  rsat: 'RSAT 0.2.2, Rising head Slug test Analysis Tool. Vrije Universiteit Brussel (github.com/VUB-HYDR/RSAT). Its polynomial fits to Bouwer and Rice (1976) Figure 3 give A, B and C.',
  zlotnik: 'Zlotnik, V. (1994) Interpretation of slug and packer tests in anisotropic aquifers. Ground Water 32(5), 761-766.',
};
const REFS = {
  hvorslev: [REF.bouwer, REF.butler, REF.hvorslev],
  bouwerRice: [REF.bouwer, REF.bouwerRice, REF.butler, REF.rsat, REF.zlotnik],
};

const range = ([lo, hi]) => `${fixed(lo, 2)} to ${fixed(hi, 2)}`;
// Four figures with their trailing zeros, so 1.890 sits beside 0.2994, not 1.89.
const four = (x) => sig(x, 4, true);
// The unit a level heading names in brackets, such as m in "Depth to water (m)".
const unitIn = (heading) => {
  const m = /\(([^()]+)\)\s*$/.exec(String(heading || ''));
  return m ? m[1].trim() : '';
};
// K in the unit people use alongside m/s for the length unit of the well sizes.
const OTHER_K = { m: ['m/d', 86400], cm: ['cm/s', 100], ft: ['ft/d', 86400 / UNITS.ft], in: ['ft/d', 86400 / UNITS.ft] };
// K of natural materials, from clay to clean gravel, spans about 1e-13 to 1 m/s.
const K_RANGE = [1e-13, 1];

function detect(f, header) {
  const t = findColumn(header, /^\s*(elapsed\s+)?time\b/i);
  if (t !== undefined) { f.set('t', t); f.set('tUnit', timeUnitIn(header[t])); }
  const disp = findColumn(header, /displacement/i);
  const level = findColumn(header, /water level|depth to water|water elevation/i);
  if (disp !== undefined) {
    f.set('level', disp);
    f.set('kind', 'disp');
  } else if (level !== undefined) {
    f.set('level', level);
    f.set('kind', 'level');
  }
}

function geometryRows(v, r) {
  if (v.method === 'hvorslev') {
    return [[`Basic time lag T0, ${v.tUnit}`, four(r.T0 / TIME_S[v.tUnit])], ['Shape term ln[a + √(1 + a²)]', four(r.shape)]];
  }
  const shape = r.full
    ? [['C', four(r.C)], ['Well', 'Fully penetrating']]
    : [['A', four(r.A)], ['B', four(r.B)], ['ln((D − Lw)/rw)', r.capped ? '6 (capped)' : four(r.depthTerm)], ['Well', 'Partly penetrating']];
  return [['ln(Re/rw)', four(r.lnRe)], ['Le/rw', four(r.x)], ...shape];
}

function methodText(v, n, win, fit, r, own, levelUnit) {
  // The level column's own unit where its heading names one; H/H0 does not depend on it.
  const inLevel = levelUnit ? ` ${levelUnit}` : ', in the unit of the level column';
  const steps = [{
    title: 'Normalized head',
    lines: [
      v.kind === 'level' ? `Each reading minus the static level, ${v.static}${inLevel}, gives the displacement H, which is divided by the initial displacement H0.` : 'Each displacement H is divided by the initial displacement H0.',
      v.h0 === undefined ? 'H0 is the reading at time zero.' : 'H0 is the value you entered.',
      'H/H0 is a ratio, so the unit of the level column cancels.',
    ],
    formula: 'H/H0 = displacement / H0',
    numbers: [[levelUnit ? `H0 (${levelUnit})` : 'H0 (same unit as the level column)', four(n.h0)], ['Readings', String(n.t.length)]],
  }, {
    title: 'Straight line through the fit window',
    lines: [
      `A least-squares line through ln(H/H0) against time t, using the ${fit.used.length} readings with H/H0 from ${range(win)}. c is the value of ln(H/H0) where the line meets time zero, and b is its slope.`,
      own ? 'You set this window.' : `This is the range Butler (1998) recommends for the ${v.method === 'hvorslev' ? 'Hvorslev' : 'Bouwer and Rice'} method, to reduce the ambiguity of fitting a straight line to curved data: H/H0 from 0.15 to 0.25 for Hvorslev, and from 0.20 to 0.30 for Bouwer and Rice.`,
      'Only the slope of the line is used. It need not pass through H/H0 = 1 at time zero. If the plot shows two straight segments, Bouwer (1989) uses the later one.',
    ],
    formula: 'ln(H/H0) = c + b t',
    numbers: [[`b (per ${v.tUnit})`, four(fit.slope * TIME_S[v.tUnit])], ['Line at time zero, H/H0', four(Math.exp(fit.intercept))]],
  }];
  const geo = [['rc', `${v.rc} ${v.lUnit}`], ['rw', `${v.rw} ${v.lUnit}`], ['Le', `${v.Le} ${v.lUnit}`], ['Kz/Kr', String(v.anisotropy)]];
  const symbols = 'rc is the casing radius, where the water level moves; rw the well radius; Le the screen length; Kz/Kr the ratio of vertical to horizontal hydraulic conductivity. K is the horizontal hydraulic conductivity.';
  const si = 'Lengths are converted to metres and times to seconds for the calculation, so K comes out in m/s.';
  if (v.method === 'hvorslev') {
    steps.push({
      title: 'Hvorslev (1951)',
      lines: [
        'The quasi-steady model for a screen in a uniform aquifer, far from the water table and the base, in the form Butler (1998) gives with anisotropy. For a long screen and Kz = Kr the log term is close to ln(Le/rw).',
        `${symbols} T0 is the basic time lag, the time over which the fitted line falls by a factor of e, and a is a shape factor of the screen.`,
        si,
      ],
      formula: 'K = rc² ln[a + √(1 + a²)] / (2 Le T0)\na = Le / (2 rw √(Kz/Kr)),  T0 = −1/b',
      numbers: [...geo, ...geometryRows(v, r), ['K (m/s)', four(r.K)]],
    });
  } else {
    steps.push({
      title: 'Bouwer and Rice (1976)',
      lines: [
        'The quasi-steady model for a well in an unconfined aquifer.',
        `${symbols} Lw is the distance from the water table to the bottom of the screen, and D the saturated thickness, from the water table to the base of the aquifer. Re is the effective radius: the distance over which the head difference is dissipated.`,
        'A, B and C come from the curves of Bouwer and Rice (1976, Figure 3) as functions of Le/rw, through the polynomial fits to those curves in RSAT 0.2.2. Where ln((D − Lw)/rw) is above 6, 6 is used, as Bouwer and Rice direct.',
        'With Kz/Kr other than 1, rw is replaced by rw √(Kz/Kr) in the ratios, after Zlotnik (1994). With Kz/Kr = 1 this is the original method.',
        si,
      ],
      formula: 'K = rc² ln(Re/rw) / (2 Le) × (−b)\nPartly penetrating: ln(Re/rw) = [1.1 / ln(Lw/rw) + (A + B ln((D − Lw)/rw)) / (Le/rw)]⁻¹\nFully penetrating:  ln(Re/rw) = [1.1 / ln(Lw/rw) + C / (Le/rw)]⁻¹',
      numbers: [...geo, ['Lw', `${v.Lw} ${v.lUnit}`], ['D', `${v.D} ${v.lUnit}`], ...geometryRows(v, r), ['K (m/s)', four(r.K)]],
    });
  }
  steps.push({
    title: 'What the method assumes',
    lines: ['An overdamped response: the level returns to static without oscillating. A homogeneous aquifer, an instantaneous change in level at time zero, no well skin, and flow that is quasi-steady, so the storage of the aquifer is ignored. The casing radius is where the water level moves; if it moves within the screen and filter pack, enter the effective radius for that.'],
    numbers: [],
  });
  return { steps, references: REFS[v.method] };
}

// Rows counted from the first one below the headings: 1, 4, 9 and 3 more.
const listRows = (rows) => {
  const shown = rows.slice(0, 8).map((i) => i + 1);
  return rows.length > 8 ? `${shown.join(', ')} and ${rows.length - 8} more` : shown.join(', ');
};

function warnings(n, r, skipped) {
  const out = [];
  if (skipped.length) {
    const one = skipped.length === 1;
    out.push(`${one ? 'One row' : `${skipped.length} rows`} without a number for both time and level ${one ? 'was' : 'were'} left out: row${one ? '' : 's'} ${listRows(skipped)}, counting down from the headings and skipping blank rows.`);
  }
  if (n.ratio.some((x) => x < 0)) out.push('Some readings cross the static level (H/H0 below zero). An overdamped response does not do this. If the level oscillates, these methods do not apply (Butler 1998).');
  if (r.capped) out.push('ln((D − Lw)/rw) came to more than 6, so 6 was used, as Bouwer and Rice (1976) direct.');
  if (r.K < K_RANGE[0] || r.K > K_RANGE[1]) out.push(`K = ${sig(r.K)} m/s is outside the range of natural materials, about ${tenTo(-13)} to 1 m/s. Check the well sizes and their unit, and the time unit.`);
  return out;
}

function results(v, n, win, fit, r, own, skipped, levelUnit, about) {
  const ts = TIME_S[v.tUnit], K = r.K;
  const warn = warnings(n, r, skipped);
  // The workbook carries the example's note and the warnings, as the page shows them.
  const text = { ...methodText(v, n, win, fit, r, own, levelUnit), notes: [...(about ? [about] : []), ...warn] };
  const shown = n.t.map((s) => s / ts);
  const inWin = new Set(fit.used);
  const line = (s) => Math.exp(fit.intercept + fit.slope * s);
  const end = n.t[n.t.length - 1];
  const edge = [0, end / ts];
  const outside = n.t.map((_, i) => i).filter((i) => n.ratio[i] > 0 && !inWin.has(i));
  const name = METHODS.find((m) => m[0] === v.method)[1];
  const [otherUnit, otherFactor] = OTHER_K[v.lUnit];
  const sheets = [{
    name: 'Readings',
    header: [`Time (${v.tUnit})`, 'H/H0', 'In fit window', 'Fitted line H/H0'],
    rows: n.t.map((s, i) => [shown[i], n.ratio[i], inWin.has(i) ? 'yes' : 'no', line(s)]),
  }, {
    name: 'Result',
    header: ['Quantity', 'Value'],
    rows: [['Method', name], ['K (m/s)', K], ['K (m/d)', K * 86400], ['Fit window lower H/H0', win[0]], ['Fit window upper H/H0', win[1]]],
  }];
  const fitRows = [
    ['Fit window, H/H0', `${range(win)}${own ? ' (your choice)' : ' (Butler 1998)'}`],
    ['Readings in the window', fit.used.length],
    [`Window starts, ${v.tUnit}`, sig(fit.from / ts, 4)],
    [`Window ends, ${v.tUnit}`, sig(fit.to / ts, 4)],
    ['Fitted line at time zero, H/H0', four(Math.exp(fit.intercept))],
    ...geometryRows(v, r),
  ];
  return [
    panel(el('h2', {}, `K = ${sig(K, 3, true)} m/s (${sig(K * otherFactor, 3, true)} ${otherUnit})`),
      el('p', { class: 'chart-sub' }, `${name}, fitted to ${fit.used.length} readings with H/H0 from ${range(win)}, between ${sig(fit.from / ts, 4)} and ${sig(fit.to / ts, 4)} ${v.tUnit}.`),
      table(['Unit', 'Hydraulic conductivity K'], [['m/s', K], ['cm/s', K * 100], ['m/d', K * 86400], ['ft/d', (K * 86400) / UNITS.ft]]),
      notes(warn),
      table(['Fit', 'Value'], fitRows),
      el('div', { class: 'downloads' }, el('button', { class: 'btn', type: 'button', onclick: () => downloadWorkbook('slug-test.xlsx', sheets, text) }, 'Download spreadsheet'))),
    panel(chart({ title: 'Normalized head against time', xLabel: `Time (${v.tUnit})`, yLabel: 'H/H0 (ratio)', logY: true, series: [
      { label: 'Readings', x: outside.map((i) => shown[i]), y: outside.map((i) => n.ratio[i]), line: false },
      { label: 'In fit window', x: fit.used.map((i) => shown[i]), y: fit.used.map((i) => n.ratio[i]), line: false, size: 11 },
      { label: 'Fitted line', x: edge, y: [line(0), line(end)] },
      { label: `Window top ${fixed(win[1], 2)}`, x: edge, y: [win[1], win[1]] },
      { label: `Window bottom ${fixed(win[0], 2)}`, x: edge, y: [win[0], win[0]] },
    ] }), el('p', { class: 'chart-sub' }, 'Log scale. A straight run of points is the quasi-steady response the methods describe.')),
    panel(el('h2', {}, 'Exactly what was done'), method(text)),
  ];
}

export default {
  id: 'slug',
  title: 'Analyze a slug test',
  blurb: 'You raised or lowered the level in a well and logged its return. Get hydraulic conductivity by Hvorslev or Bouwer and Rice.',
  lede: 'The two straight-line methods for an overdamped slug test, fitted to the normalized head in the range Butler (1998) recommends, or a window you choose.',
  mount(host) {
    let data = null, about = null;
    const out = el('div', { class: 'stack' });
    const showError = (msg) => { out.textContent = ''; out.append(errorBox(msg)); };
    const { status } = fileDrop(host, {
      text: 'A table of elapsed time and water level from one slug test. CSV or Excel.',
      examples: SLUG_EXAMPLES,
      onTable({ name, table: tbl, example }) {
        data = tbl;
        about = example ? example.source : null;
        out.textContent = '';
        // Nothing from an earlier file or example carries over: empty every field, then
        // fill in what the headings say, then what the example's source gives.
        f.reset();
        f.setColumns(tbl.header);
        detect(f, tbl.header);
        if (example) Object.entries(example.values).forEach(([k, val]) => f.set(k, val));
        status(`${name}: ${tbl.rows.length} rows.${example ? ` ${example.source}` : ''}`);
      },
    });
    columnSpec(host, {
      columns: [
        { name: 'Elapsed time', need: 'Required', what: 'Time since the level was changed, as numbers. A reading at time zero gives H0.', headings: ['Time (s)', 'Time (min)'] },
        { name: 'Water level', need: 'Required', what: 'Displacement from the static level, or the water level or depth to water itself.', headings: ['Displacement (m)', 'Water level (m)', 'Depth to water (ft)'] },
      ],
      notes: [
        'Put the time unit in the heading, in brackets, and the page reads it from there. Otherwise it asks.',
        'One test per file. Readings before the test began should be left out.',
        'The well sizes, and for Bouwer and Rice the saturated thickness, are entered on the form below.',
      ],
      // The same readings as the example buttons, as .xlsx files.
      examples: SLUG_EXAMPLES.map((x) => {
        const [h, ...lines] = x.csv.trim().split('\n');
        return { label: x.label, name: x.name.replace(/\.csv$/, '.xlsx'), header: h.split(','), rows: lines.map((l) => l.split(',').map(Number)) };
      }),
    });
    const br = (v) => v.method === 'bouwerRice';
    const f = form(host, {
      fields: [
        { id: 'method', label: 'Method', type: 'select', options: METHODS, required: true },
        { id: 't', label: 'Elapsed time column', type: 'column', required: true },
        { id: 'tUnit', label: 'Time unit', type: 'select', options: TIME_OPTIONS, required: true },
        { id: 'level', label: 'Water level column', type: 'column', required: true },
        { id: 'kind', label: 'That column holds', type: 'select', options: KINDS, required: true },
        { id: 'static', label: 'Static level, in the column\'s unit', type: 'number', required: (v) => v.kind === 'level', show: (v) => v.kind === 'level' },
        { id: 'lUnit', label: 'Unit of the well sizes', type: 'select', options: LENGTH, required: true },
        { id: 'rc', label: 'Casing radius rc', type: 'number', required: true, hint: 'Inside radius where the water level moves.' },
        { id: 'rw', label: 'Well radius rw', type: 'number', required: true, hint: 'Screen radius, or the borehole radius with a filter pack.' },
        { id: 'Le', label: 'Screen length Le', type: 'number', required: true },
        { id: 'anisotropy', label: 'Anisotropy Kz/Kr', type: 'number', required: true, hint: 'Enter 1 for an isotropic aquifer.' },
        { id: 'Lw', label: 'Water table to bottom of screen Lw', type: 'number', required: br, show: br },
        { id: 'D', label: 'Saturated thickness D', type: 'number', required: br, show: br, hint: 'Water table to the base of the aquifer.' },
        { id: 'h0', label: 'Initial displacement H0, in the column\'s unit', type: 'number', hint: 'Blank uses the reading at time zero.' },
        { id: 'lo', label: 'Fit window, lower H/H0', type: 'number', hint: 'Blank uses Butler (1998): 0.15 for Hvorslev, 0.20 for Bouwer and Rice.' },
        { id: 'hi', label: 'Fit window, upper H/H0', type: 'number', hint: 'Blank uses Butler (1998): 0.25 for Hvorslev, 0.30 for Bouwer and Rice.' },
      ],
      onRun(v) {
        out.textContent = '';
        try {
          if (!data) throw new Error('Load a file first.');
          const ts = TIME_S[v.tUnit], L = UNITS[v.lUnit];
          const t = columnValues(data, v.t).map((x) => x * ts);
          const raw = columnValues(data, v.level);
          const skipped = t.map((_, i) => i).filter((i) => !(Number.isFinite(t[i]) && Number.isFinite(raw[i])));
          const n = normalize(t, v.kind === 'level' ? raw.map((x) => x - v.static) : raw, v.h0);
          const butler = HEAD_RANGE[v.method], own = v.lo !== undefined || v.hi !== undefined;
          const win = [v.lo ?? butler[0], v.hi ?? butler[1]];
          const fit = fitWindow(n.t, n.ratio, ...win);
          const g = { rc: v.rc * L, rw: v.rw * L, Le: v.Le * L, anisotropy: v.anisotropy, slope: fit.slope };
          const r = br(v) ? bouwerRice({ ...g, Lw: v.Lw * L, D: v.D * L }) : hvorslev(g);
          out.append(...results(v, n, win, fit, r, own, skipped, unitIn(data.header[v.level]), about));
          done(host);
        } catch (e) {
          showError(e.message);
        }
      },
    });
    host.append(out);
  },
};
