// The straight-line methods, Hvorslev (1951) and Bouwer and Rice (1976), fitted through
// the fit window: the method text, the warnings and the results.
import { UNITS } from '../../../engine/index.js';
import { HEAD_RANGE, TIME_S } from '../../../engine/slug.js';
import { fixed, six } from '../../../engine/format.js';
import { chart, downloads, downloadWorkbook, el, methodPanel, notes, panel, sig, table, tenTo } from '../../kit.js';
import { given, kTable, NAMES, normalizedStep, OTHER_K, withPractice } from './results.js';
import { four, K_RANGE, skippedNote } from './text.js';

const range = ([lo, hi]) => `${fixed(lo, 2)} to ${fixed(hi, 2)}`;

function geometryRows(v, r) {
  if (v.method === 'hvorslev') {
    return [[`Basic time lag T0, ${v.tUnit}`, four(r.T0 / TIME_S[v.tUnit])], ['Shape term ln[a + √(1 + a²)]', four(r.shape)]];
  }
  const shape = r.full
    ? [['C', four(r.C)], ['Well', 'Fully penetrating']]
    : [['A', four(r.A)], ['B', four(r.B)], ['ln((D − Lw)/rw)', r.capped ? '6 (capped)' : four(r.depthTerm)], ['Well', 'Partly penetrating']];
  return [['ln(Re/rw)', four(r.lnRe)], ['Le/rw', four(r.x)], ...shape];
}

function lineMethodText(v, n, win, fit, r, own, levelUnit) {
  const steps = [normalizedStep(v, n, levelUnit), {
    title: 'Straight line through the fit window',
    lines: [
      `A least-squares line through ln(H/H0) against time t, using the ${fit.used.length} readings with H/H0 from ${range(win)}. c is the value of ln(H/H0) where the line meets time zero, and m is its slope.`,
      own ? 'You set this window.' : `This is the range Butler (1998) recommends for the ${v.method === 'hvorslev' ? 'Hvorslev' : 'Bouwer and Rice'} method, to reduce the ambiguity of fitting a straight line to curved data: H/H0 from ${range(HEAD_RANGE.hvorslev)} for Hvorslev, and from ${range(HEAD_RANGE.bouwerRice)} for Bouwer and Rice.`,
      'Only the slope of the line is used. It need not pass through H/H0 = 1 at time zero. If the plot shows two straight segments, Bouwer (1989) uses the later one.',
    ],
    formula: 'ln(H/H0) = c + m t',
    numbers: [[`m (per ${v.tUnit})`, four(fit.slope * TIME_S[v.tUnit])], ['Line at time zero, H/H0', four(Math.exp(fit.intercept))]],
  }];
  const geo = [['rc', `${given(v.rc)} ${v.lUnit}`], ['rw', `${given(v.rw)} ${v.lUnit}`], ['Le', `${given(v.Le)} ${v.lUnit}`], ['Kz/Kr', given(v.anisotropy)]];
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
      formula: 'K = rc² ln[a + √(1 + a²)] / (2 Le T0)\na = Le / (2 rw √(Kz/Kr)),  T0 = −1/m',
      numbers: [...geo, ...geometryRows(v, r), ['K (m/s)', four(r.K)]],
    });
  } else {
    steps.push({
      title: 'Bouwer and Rice (1976)',
      lines: [
        'The quasi-steady model for a well in an unconfined aquifer.',
        `${symbols} Lw is the distance from the water table to the bottom of the screen, and D the saturated thickness, from the water table to the base of the aquifer. Re is the effective radius: the distance over which the head difference is dissipated. Bouwer and Rice write Lw as H; here H is only the displacement.`,
        'A, B and C come from the curves of Bouwer and Rice (1976, Figure 3) as functions of Le/rw, through the polynomial fits to those curves in RSAT 0.2.2. Where ln((D − Lw)/rw) is above 6, 6 is used, as Bouwer and Rice direct.',
        'With Kz/Kr other than 1, rw is replaced by rw √(Kz/Kr) in the ratios, after Zlotnik (1994). With Kz/Kr = 1 this is the original method.',
        ...(r.rcStar !== undefined ? [`The casing radius is corrected for drainage of the filter pack, as Bouwer (1989) gives it (HydroSOLVE): rc* = [(1 − n) rc² + n rw²]^½, with the pack's porosity n = ${given(v.packN)}, so rc* = ${four(r.rcStar / UNITS[v.lUnit])} ${v.lUnit} is used for rc.`] : []),
        si,
      ],
      formula: 'K = rc² ln(Re/rw) / (2 Le) × (−m)\nPartly penetrating: ln(Re/rw) = [1.1 / ln(Lw/rw) + (A + B ln((D − Lw)/rw)) / (Le/rw)]⁻¹\nFully penetrating:  ln(Re/rw) = [1.1 / ln(Lw/rw) + C / (Le/rw)]⁻¹',
      numbers: [...geo, ['Lw', `${given(v.Lw)} ${v.lUnit}`], ['D', `${given(v.D)} ${v.lUnit}`], ...(r.rcStar !== undefined ? [['Filter pack porosity n', given(v.packN)], ['rc*', `${four(r.rcStar / UNITS[v.lUnit])} ${v.lUnit}`]] : []), ...geometryRows(v, r), ['K (m/s)', four(r.K)]],
    });
  }
  steps.push({
    title: 'What the method assumes',
    lines: ['An overdamped response: the level returns to static without oscillating. A homogeneous aquifer, an instantaneous change in level at time zero, no well skin, and flow that is quasi-steady, so the storage of the aquifer is ignored. The casing radius is where the water level moves; if it moves within the screen and filter pack, enter the effective radius for that.'],
    numbers: [],
  });
  return steps;
}

function lineWarnings(n, fit, r, skipped) {
  const out = [];
  if (skipped.length) out.push(skippedNote(skipped));
  // Two points always lie on a line, so the straight run the method needs is not shown.
  if (fit.used.length < 3) out.push(`Only ${fit.used.length} readings fall in the fit window, so the line passes through them exactly and nothing shows whether the response is straight there, or how far the slope could be off. Widen the fit window, or treat K as a rough figure.`);
  if (n.ratio.some((x) => x < 0)) out.push('Some readings cross the static level (H/H0 below zero). An overdamped response does not do this. If the level oscillates, use one of the methods for an oscillating response (Butler 1998).');
  if (r.capped) out.push('ln((D − Lw)/rw) came to more than 6, so 6 was used, as Bouwer and Rice (1976) direct.');
  if (r.K < K_RANGE[0] || r.K > K_RANGE[1]) out.push(`K = ${sig(r.K)} m/s is outside the range of natural materials, about ${tenTo(-13)} to 1 m/s. Check the well sizes and their unit, and the time unit.`);
  return out;
}

export function lineResults(v, n, win, fit, r, own, ctx) {
  const ts = TIME_S[v.tUnit], K = r.K;
  const { warn, text, block, sheets: checkSheets, series } = withPractice(v, n, ctx, { K, line: { win, kOf: ctx.kOf }, warnings: lineWarnings(n, fit, r, ctx.skipped), steps: lineMethodText(v, n, win, fit, r, own, ctx.levelUnit) });
  const shown = n.t.map((s) => s / ts);
  const inWin = new Set(fit.used);
  const line = (s) => Math.exp(fit.intercept + fit.slope * s);
  const end = n.t[n.t.length - 1];
  const edge = [0, end / ts];
  const outside = n.t.map((_, i) => i).filter((i) => n.ratio[i] > 0 && !inWin.has(i));
  const name = NAMES[v.method];
  const [otherUnit, otherFactor] = OTHER_K[v.lUnit];
  const sheets = [{
    name: 'Readings',
    header: [`Time (${v.tUnit})`, 'H/H0', 'In fit window', 'Fitted line H/H0'],
    rows: n.t.map((s, i) => [Number(shown[i].toPrecision(12)), six(n.ratio[i]), inWin.has(i) ? 'yes' : 'no', six(line(s))]),
  }, {
    name: 'Result',
    header: ['Quantity', 'Value'],
    rows: [['Method', name], ...(ctx.tests ? [['Test', ctx.tests[ctx.chosen].label]] : []), ['K (m/s)', six(K)], ['K (m/d)', six(K * 86400)], ['Slope m (per s)', six(fit.slope)], ['Fit window lower H/H0', win[0]], ['Fit window upper H/H0', win[1]]],
  }, ...checkSheets];
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
      kTable(K, 'Hydraulic conductivity K'),
      ...block,
      notes(warn),
      table(['Fit', 'Value'], fitRows),
      downloads(() => downloadWorkbook('slug-test.xlsx', sheets, text))),
    // Readings first and the fit second, so they take the same colours as on the
    // pumping test page.
    panel(chart({ title: 'Normalized head against time', xLabel: `Time (${v.tUnit})`, yLabel: 'H/H0 (ratio)', logY: true, series: [
      { label: 'In fit window', x: fit.used.map((i) => shown[i]), y: fit.used.map((i) => n.ratio[i]), line: false, size: 11 },
      { label: 'Fitted line', x: edge, y: [line(0), line(end)] },
      { label: 'Other readings', x: outside.map((i) => shown[i]), y: outside.map((i) => n.ratio[i]), line: false },
      { label: `Window top ${fixed(win[1], 2)}`, x: edge, y: [win[1], win[1]] },
      { label: `Window bottom ${fixed(win[0], 2)}`, x: edge, y: [win[0], win[0]] },
    ] }), el('p', { class: 'chart-sub' }, 'Log scale. A straight run of points is the quasi-steady response the methods describe.')),
    series,
    methodPanel(text),
  ];
}
