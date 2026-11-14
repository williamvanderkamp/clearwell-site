// The plain record of what was done to one pumping test. The page and the workbook
// both use this text and these tables, so they can't disagree.
import { extendedReach, fitLabel, reachText, shownT, tUnit, durationText } from './pumping-format.js';
import { fixed, unit } from '../engine/format.js';
import { figures } from './method-text.js';
import { BOURDET_ET_AL_1989, CLARK_1967, COOPER_JACOB_1946, KRUSEMAN_DE_RIDDER_1994, RASMUSSEN_CRAWFORD_1997, THEIS_1935, VAN_DER_KAMP_1989, VAN_DER_KAMP_ET_AL_2021 } from '../engine/refs.js';

// Each reference is listed only when the text cites it, in the form "Theis (1935)".
const REFERENCES = [
  ['Bourdet et al. (1989)', BOURDET_ET_AL_1989],
  ['Clark (1967)', CLARK_1967],
  ['Cooper and Jacob (1946)', COOPER_JACOB_1946],
  ['Kruseman and de Ridder (1994)', KRUSEMAN_DE_RIDDER_1994],
  ['Neville and van der Kamp (2012)', 'Neville, C.J., and van der Kamp, G. (2012) Using recovery data to extend the effective duration of pumping tests. Ground Water 50(5), 804-807.'],
  ['Rasmussen and Crawford (1997)', RASMUSSEN_CRAWFORD_1997],
  ['Theis (1935)', THEIS_1935],
  ['van der Kamp (1989)', VAN_DER_KAMP_1989],
  ['van der Kamp et al. (2021)', VAN_DER_KAMP_ET_AL_2021],
];

function backgroundStep(r, info) {
  const m = r.method, b = m.background, u = m.lengthUnit;
  const mm = (v) => (u === 'm' ? `${fixed(v * 1000, 1)} mm` : `${fixed(v / m.lengthToM, 4)} ${u}`);
  const scatter = Number.isFinite(m.rawScatter) && m.trend
    ? [['Scatter before pumping, raw', mm(m.rawScatter)], ['Scatter before pumping, corrected', mm(m.trend.scatter)]] : [];
  const days = `${fixed(m.pretestDays, 1)} days`;
  // The efficiency used, and how well a fit on the record before pumping held up.
  const efficiency = (label) => [[label, fixed(b.be, 3)], ['Loading efficiency, 1 - BE', fixed(1 - b.be, 3)]];
  const fitRows = () => [
    ['Range across six equal parts of the pre-test', b.range ? `${fixed(b.range.min, 3)} to ${fixed(b.range.max, 3)}` : 'too short to split'],
    ['Share of step-to-step change explained', `${fixed(b.explained * 100, 1)}%`], ['Steps fitted', String(b.rows)],
  ];
  if (b.mode === 'none') {
    return {
      title: 'Background effects',
      lines: [b.reason === 'no-barometer'
        ? 'Nothing was removed, because no barometer was given. Air pressure changes during the test are still in the drawdown.'
        : `Nothing was removed. The record before pumping is ${days}, too short to fit an efficiency, and none was entered.`],
      numbers: [],
    };
  }
  if (b.mode === 'user') {
    return {
      title: 'Background effects',
      lines: [
        `Your barometric efficiency was applied to the whole record, using the barometer column "${info.baroName}". No earth tide was removed.`,
        'Here h(t) is the water level and p(t) the air pressure, both in metres of water, and mean p is the mean pressure.',
      ],
      formula: 'corrected level(t) = h(t) + BE [p(t) - mean p]',
      numbers: [...efficiency('Barometric efficiency entered'), ...scatter],
    };
  }
  if (b.mode === 'constant') {
    return {
      title: 'Background effects',
      lines: [
        `Constant barometric efficiency, by first-difference regression as in Clark (1967). It was fitted only on the ${days} before pumping, and levels from the start of pumping were hidden from the fit. It was then applied to the whole record using each row's own pressure.`,
        'A full response function needs at least 14 days before pumping, so it was not used. No earth tide was removed, for the same reason. This is a choice of how much a short record can support.',
        'Here h(t) is the water level and p(t) the air pressure at step t, both in metres of water; a is the steady drift per step, b the fitted slope, e(t) what the fit leaves, and mean p the mean pressure.',
      ],
      formula: 'h(t) - h(t-1) = a + b [p(t) - p(t-1)] + e(t)\nBE = -b\ncorrected level(t) = h(t) + BE [p(t) - mean p]',
      numbers: [...efficiency('Barometric efficiency, BE'), ...fitRows(), ...scatter],
    };
  }
  return {
    title: 'Background effects',
    lines: [
      `Barometric response function, by regression deconvolution with a fixed ${b.lagHours}-hour lag, as in Rasmussen and Crawford (1997)${b.tide.used ? ', fitted together with a lagged response to the computed earth tide' : ''}. It was fitted only on the ${days} before pumping, and levels from the start of pumping were hidden from the fit. It was then applied to the whole record.`,
      b.tide.used ? 'The earth tide was included because the well showed a response at M2 or O1 before pumping.' : 'No earth tide was removed.',
      'Here h(t) is the water level and p(t) the air pressure at step t, both in metres of water; a is the steady drift per step, u(k) the coefficient for a lag of k steps, and e(t) what the fit leaves.',
    ],
    formula: 'h(t) - h(t-1) = a + sum over k of u(k) [p(t-k) - p(t-k-1)] + e(t)\ncorrected level(t) = h(t) - barometric effect(t) - earth tide effect(t)',
    numbers: [...efficiency(`Barometric efficiency at ${b.lagHours} h`), ...fitRows(), ...scatter],
  };
}

/** r: result from pumpingTest(). info: { fileName, sheetName, levelName, baroName } */
export function describePumping(r, info) {
  const m = r.method, a = r.analysis, u = m.lengthUnit;
  const unitT = tUnit(m);
  const steps = [];
  const kindText = { depth: 'depth to water', head: 'height or elevation', absolute: 'absolute pressure at the sensor', drawdown: 'drawdown, already measured from the static level' }[m.levelKind];
  const when = (ms) => (m.elapsed ? `${fixed(ms / 60000, 2)} minutes` : new Date(ms).toISOString().slice(0, 19).replace('T', ' '));

  steps.push({
    title: 'Record',
    lines: [
      `${info.fileName}${info.sheetName ? `, sheet ${info.sheetName}` : ''}: ${r.t.length} rows. Water level column "${info.levelName}", read as ${kindText}, in ${m.levelUnit}.${info.baroName ? ` Barometer column "${info.baroName}", in ${m.baroUnit}.` : ' No barometer.'}`,
      `A ${m.pumpedWell ? 'record from the pumped well' : 'record from an observation well'}, analyzed as one constant rate. Fill codes are left blank. Nothing else in the record is changed.`,
    ],
    numbers: [
      ['Pumping started', when(m.start)], ['Pumping stopped', Number.isFinite(m.stop) ? when(m.stop) : 'not given'],
      ['Pumping rate', m.rateUnit === 'm3/d' ? `${m.rate} m³/d` : `${m.rate} ${unit(m.rateUnit)} = ${figures(m.Q, 4)} m³/d`],
      ['Distance from the pumped well', m.pumpedWell ? 'pumped well' : Number.isFinite(m.r) ? `${m.distance} ${m.distanceUnit}` : 'not given'],
    ],
  });

  steps.push(backgroundStep(r, info));

  const s = m.statics;
  steps.push({
    title: 'Drawdown',
    lines: [
      { 'last-hour': `The static level is the mean of the ${s.rows} corrected readings in the hour before pumping.`, 'last-reading': 'The static level is the last corrected reading before pumping.', entered: 'The static level is the value you entered.', 'drawdown-given': 'The file already gives drawdown, so it is used as it stands.' }[s.source],
      m.trendRemoved ? 'The straight-line trend of the corrected level before pumping was carried through the test and removed, because you asked for that.' : 'No trend was removed.',
      ...(r.rawAnalysis ? ['The same steps are run on the raw record, so the results table shows what the correction changed.'] : []),
    ],
    formula: r.rawAnalysis ? 'drawdown s(t) = static level - corrected level(t)' : 'drawdown s(t) = static level - level(t)',
    numbers: !m.trend ? [] : u === 'm'
      ? [['Trend before pumping (mm per day)', figures(m.trend.perDay * 1000, 2)]]
      : [[`Trend before pumping (${u} per day)`, figures(m.trend.perDay / m.lengthToM, 2)]],
  });

  steps.push({
    title: 'Equal weight to each log cycle',
    lines: ['Readings are averaged into 20 equal widths of log time to each log cycle before any fit, so a logger running for days does not outvote the first minutes.'],
    numbers: [['Averaged points during pumping', String(a.pump.t.length)]],
  });

  if (a.theis) {
    steps.push({
      title: 'Theis curve',
      lines: ['Least squares fit of the solution of Theis (1935) for a confined aquifer of infinite extent. Q is the pumping rate, r the distance from the pumped well, t the time since pumping began, and W(u) the Theis well function.'],
      formula: 's = Q / (4πT) · W(u)\nu = r²S / (4Tt)',
      numbers: [
        [`Transmissivity, T (${unitT})`, figures(shownT(a.theis.T, m), 4)], ['Storativity, S', figures(a.theis.S, 3)],
        ['Fitted over', fitLabel(a.theis)], [`Root mean square misfit (${u})`, figures(a.theis.rmse / m.lengthToM, 3)],
      ],
    });
  } else {
    steps.push({ title: 'Theis curve', lines: [m.pumpedWell ? 'Not done. Early data in a pumped well carry casing storage and well losses.' : 'Not done. It needs the distance from the pumped well.'], numbers: [] });
  }

  steps.push(a.line ? {
    title: 'Cooper and Jacob line',
    lines: [
      Number.isFinite(a.line.S)
        ? `Least squares line through drawdown against log time, as in Cooper and Jacob (1946), where u is below 0.1, the practical limit in Kruseman and de Ridder (1994), unless you set the window. t0 is the time at which the line reaches zero drawdown.`
        : 'Least squares line through drawdown against log time, as in Cooper and Jacob (1946), over the last log cycle of pumping unless you set the window. With no distance there is no check on u.',
    ],
    formula: `slope = 2.303 Q / (4πT)${Number.isFinite(a.line.S) ? '\nS = 2.25 T t0 / r²' : ''}`,
    numbers: [
      [`Slope (${u} per log cycle)`, figures(a.line.slope / m.lengthToM, 4)], [`Transmissivity, T (${unitT})`, figures(shownT(a.line.T, m), 4)],
      ...(Number.isFinite(a.line.S) ? [['Storativity, S', figures(a.line.S, 3)], ['Zero drawdown at t0', durationText(a.line.t0)]] : []),
      ['Fitted over', fitLabel(a.line)],
    ],
  } : { title: 'Cooper and Jacob line', lines: ['Not done. Too few readings fall in the window.'], numbers: [] });

  if (Number.isFinite(m.stop)) {
    steps.push(a.recovery ? {
      title: 'Theis recovery line',
      lines: ['Least squares line through residual drawdown against log(t/t\'), where t is time since pumping began and t\' is time since it stopped, as in Theis (1935).'],
      formula: 'slope = 2.303 Q / (4πT)',
      numbers: [
        [`Slope (${u} per log cycle)`, figures(a.recovery.slope / m.lengthToM, 4)], [`Transmissivity, T (${unitT})`, figures(shownT(a.recovery.T, m), 4)],
        ['t/t\' at zero residual drawdown, should be near 1', fixed(a.recovery.ratio0, 2)], ['Fitted over t\'', fitLabel(a.recovery)],
      ],
    } : { title: 'Theis recovery line', lines: ['Not done. Too few recovery readings fall in the window.'], numbers: [] });

    const e = a.extended, reach = extendedReach(r);
    steps.push(e && e.t.length ? {
      title: 'Extended drawdown',
      lines: [
        'The method of van der Kamp (1989), as set out by Neville and van der Kamp (2012). Residual drawdown during recovery gives the drawdown that would have followed had pumping continued, as far as recovery is measured, and past one pumping period by applying the same step again.',
        'It assumes only superposition and a constant rate. No aquifer type, boundary or uniform aquifer is assumed, which is why it is useful where the Theis curve is not. It fails where flow is not linear, such as dewatering or turbulent flow.',
        'Here s(t) is the drawdown measured at time t since pumping began, during pumping and, as residual drawdown, during recovery; toff is the length of pumping, the time at which the pump stopped; and s1(t) is the extended drawdown, the drawdown that pumping for all of time t would have caused. Each step adds the drawdown one pumping period earlier, so the formula is applied again for each further period.',
        'The curve should run smoothly through shut-off and keep climbing, because it stands for pumping that never stopped. A jump, or a curve that falls, is a warning that a condition failed, and that the other analyses here are also in doubt, as van der Kamp et al. (2021) found on tests in British Columbia. No transmissivity is reported from a falling curve.',
      ],
      formula: 's1(t) = s(t)  for t ≤ toff\ns1(t) = s(t) + s1(t - toff)  for t > toff',
      numbers: [
        ['Effective duration of the test', durationText(e.t[e.t.length - 1])], ['Length of pumping', durationText(m.durationDays)],
        ...(e.check ? [
          ['Jump at shut-off, share of drawdown there', `${fixed(e.check.share * 100, 1)}%`], ['Counted as a warning above', `${fixed(e.check.limit * 100, 1)}%`],
          ['Slope after shut-off against the end of pumping', e.check.falling ? 'falling' : fixed(e.check.slopeRatio, 2)], ['Counted as a warning outside', '0.5 to 2'],
        ] : []),
        ...(e.line ? [[`T from a line through the extended part (${unitT})`, figures(shownT(e.line.T, m), 4)]] : []),
        ...(reach ? reach.rows.map(([label, value]) => [`${label}: drawdown at ${durationText(reach.at)} (${u})`, reachText(value)]) : []),
        ...(m.minResidual > 0 ? [[`Smallest residual drawdown used (${u}), 3 times the scatter before pumping`, figures(m.minResidual / m.lengthToM, 3)]] : []),
      ],
    } : { title: 'Extended drawdown', lines: ['Not done. No recovery reading could be matched to a time during pumping.'], numbers: [] });
  }

  steps.push({
    title: 'What these results assume',
    lines: [
      'The Theis and Cooper and Jacob results assume a confined aquifer of uniform thickness and infinite extent, a fully penetrating well, and a constant rate. No correction was made for leakage, boundaries, partial penetration, or dewatering of an unconfined aquifer.',
      'The diagnostic chart shows the log derivative of drawdown, after Bourdet et al. (1989). In the ideal aquifer it levels off. A later fall can mean leakage or recharge, and a rise can mean a barrier. These are possibilities to look into, not findings.',
      ...(m.background.mode === 'none' ? [] : ['The background correction assumes the well answers air pressure during the test as it did before. A correction fitted on a short record is itself uncertain.']),
    ],
    numbers: [],
  });
  const said = JSON.stringify(steps);
  const references = REFERENCES.filter(([cite]) => said.includes(cite)).map(([, ref]) => ref);
  return { steps, references };
}
