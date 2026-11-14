// The plain record of what was done to one file. The page and the workbook's Method
// sheet both use this text, so they can't disagree.

import { MAX_TIDE_STEP_H, MIN_TIDE_DAYS } from '../engine/correct.js';
import { fixed, sig } from '../engine/format.js';
import { INPUT_ACTIONS, INPUT_KINDS, UNITS } from '../engine/index.js';
import { CLARK_1967, RASMUSSEN_CRAWFORD_1997 } from '../engine/refs.js';

/** sig() keeping trailing zeros, so numbers in one column carry the same precision. */
export const figures = (x, p = 3, keepZeros = true) => sig(x, p, keepZeros);
const sig5 = (v) => figures(v, 5);
export const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

const CHANGE_FORMULA = 'h(t) - h(t-1) = a + b [p(t) - p(t-1)] + e(t)';
const DECONVOLUTION_FORMULA = 'h(t) - h(t-1) = a + sum over k=0..m of u(k) [p(t-k) - p(t-k-1)] + e(t)';
const TIDE_FORMULA = '... + sum over j=0..n of v(j) [E(t-j) - E(t-j-1)]';
const INPUT_FORMULA = '... + sum over inputs i, k=0..m(i) of w(i,k) [x(i,t-k) - x(i,t-k-1)]';

const REFERENCES = [
  'Bohling, G.C., Jin, W., and Butler, J.J., Jr. (2011) Kansas Geological Survey Barometric Response Function software user\'s guide. KGS Open-File Report 2011-10.',
  'Butler, J.J., Jr., Jin, W., Mohammed, G.A., and Reboulet, E.C. (2011) New insights from well responses to fluctuations in barometric pressure. Ground Water 49(4), 525-533.',
  CLARK_1967,
  RASMUSSEN_CRAWFORD_1997,
  'Toll, N.J., and Rasmussen, T.C. (2007) Removal of barometric pressure effects and earth tides from observed water levels. Ground Water 45(1), 101-105.',
];

// Cited only when further inputs were given.
const INPUT_REFERENCES = [
  'Dörr, F., et al. (2026) The recharge illusion: how seasonal surface loading can hide continuing groundwater resource declines in confined deltaic aquifers. Journal of Hydrology 665, 134674.',
  'Draper, N.R., and Smith, H. (1998) Applied Regression Analysis, 3rd edition. Wiley, New York.',
  'Haehnel, P., Rasmussen, T.C., and Rau, G.C. (2024) Technical note: Removing dynamic sea-level influences from groundwater-level measurements. Hydrology and Earth System Sciences 28, 2767-2784.',
  'Smith, C.D., van der Kamp, G., Arnold, L., and Schmidt, R. (2017) Measuring precipitation with a geolysimeter. Hydrology and Earth System Sciences 21, 5263-5272.',
  'van der Kamp, G., and Maathuis, H. (1991) Annual fluctuations of groundwater levels as a result of loading by surface moisture. Journal of Hydrology 127, 137-152.',
  'van der Kamp, G., and Schmidt, R. (2017) Review: Moisture loading, the hidden information in groundwater observation well records. Hydrogeology Journal 25, 2225-2233.',
];

export const ACTION_TEXT = {
  remove: 'Its whole fitted effect was subtracted from the standard result.',
  immediate: 'Only its immediate part, w(0) x(t), was subtracted from the standard result. The lagged part stays in the record.',
  report: 'Nothing was subtracted. Its fitted effect is in the spreadsheet, beside the record, to compare.',
};

/** A fitted value and its standard error: 0.793 ± 0.037, or in significant figures for a value with units. */
export const plusMinus = (x, part) => (x.lengthRatio ? `${fixed(part.value, 3)} ± ${fixed(part.se, 3)}` : `${figures(part.value, 3)} ± ${figures(part.se, 2)}`);

/** What one input's response is measured in. */
export const perUnit = (x, levelUnit) => (x.lengthRatio ? 'ratio of lengths' : `${levelUnit} per unit of the column`);

/**
 * What one input's fitted response means, and what it cannot show, in plain words.
 * x: an entry of r.inputs.list; m: r.method.
 */
export function inputMeaning(x, m) {
  const step = `${Number(m.stepH.toFixed(2))}-hour`;
  const name = `"${x.name}"`;
  const lines = [];
  if (x.kind === 'amount') {
    lines.push(`Immediate part, lag 0: ${plusMinus(x, x.immediate)}. The level rose this much per unit of ${name} within the same ${step} step.${x.lengthRatio ? ` For water arriving at the surface, such as rain, in a confined aquifer this is the weight of the water: the pore water carries a share of the new load equal to the loading efficiency (van der Kamp and Maathuis 1991; van der Kamp and Schmidt 2017, eq. 3; Smith et al. 2017). That is 1 − BE (Dörr et al. 2026, eq. 5), ${fixed(m.loadingEfficiency, 3)} from the barometer here; for water leaving, such as evaporation, it is the same with the sign changed. Where the two are close, given the standard error above and the barometric efficiency's own uncertainty, which is not given here, loading alone can explain this part. This holds for a well-confined aquifer and loads much shorter than the time b²/D for pressure to cross the confining layer (van der Kamp and Schmidt 2017). The well feels a load spread over an area at least about ten times its depth in radius (Smith et al. 2017; van der Kamp and Schmidt 2017), where a gauge is one point.` : ''} Water reaching a shallow water table within one step would show here too, and the fit cannot tell the two apart.`);
    if (x.lagged) lines.push(`Lagged part, lags 1 to ${x.nLags}: ${plusMinus(x, x.lagged)}. What followed over the next ${fixed(x.lagHours, 0)} hours. For rain, a rise can be water reaching the aquifer, which is recharge; a fall can be water leaving the area the well feels, by run-off, as after the event in Smith et al. (2017, Fig. 2a), or by evaporation, as in the daily declines of van der Kamp and Schmidt (2017, Fig. 3). The fit gives the sum of what happened, not which process did it.`);
    lines.push(`Whole response by ${fixed(x.lagHours, 0)} hours: ${plusMinus(x, x.total)}. Past the last lag it is taken to stay as it stands then, so each unit of ${name} leaves a lasting step of that size.${x.lengthRatio ? ' In a confined aquifer, a seasonal rise that the immediate part accounts for, with an immediate part close to 1 − BE, is the weight of water at the surface, not water reaching the aquifer, and is not by itself evidence of recharge (van der Kamp and Schmidt 2017; Dörr et al. 2026).' : ''}`);
    if (x.removedPart) {
      const part = x.removedPart === 'whole' ? x.total : x.immediate;
      const spread = part.se * x.amountTotal;
      lines.push(`Removing it subtracts a running total, so an error in the ${x.removedPart === 'whole' ? 'whole response' : 'immediate part'} grows with the amount. Over the ${figures(x.amountTotal, 3)} ${x.lengthRatio ? x.unit : 'units'} of this record, one standard error is ${figures(x.lengthRatio ? spread * unitToLevel(x.unit, m) : spread, 2)} ${m.levelUnit} by the end. Evaporation, which takes the load of rain away, is not removed unless you give it as an input too, and stays in the record, partly as the fitted drift. Dörr et al. (2026, eq. 1 and 2) load with the running total of rain less evaporation, as one input. Giving that total as a level does the same; giving evaporation as a second amount instead fits it a response of its own.`);
    }
  } else {
    lines.push(`Immediate part, lag 0: ${plusMinus(x, x.immediate)}. The level rose this much per unit rise of ${name} within the same ${step} step. For a river, lake or pond over a confined aquifer this is how the weight of the water changes the pore pressure; it can also be a fast hydraulic connection.`);
    if (x.lagged) lines.push(`Lagged part, lags 1 to ${x.nLags}: ${plusMinus(x, x.lagged)}. What builds up over the next ${fixed(x.lagHours, 0)} hours, as water flows between it and the aquifer or the pressure spreads.`);
    lines.push(`Whole response by ${fixed(x.lagHours, 0)} hours: ${plusMinus(x, x.total)}. The change in level a lasting unit step in ${name} gives by then. Past the last lag it is taken to stay as it stands then. A response still growing at the last lag, as drawdown from pumping does, is cut short there.`);
  }
  lines.push(`The fit finds how the level moved with ${name}, not why. Anything else that moves with it, such as unmeasured rain over a river's catchment, is credited to it.`);
  return lines;
}

// One unit of a length, in the level unit.
const unitToLevel = (u, m) => UNITS[u] / m.levelToM;

const TIDE_REASON = {
  'no-location': 'Not done: the well location was not given.',
  'step-too-long': `Not done: readings are more than ${MAX_TIDE_STEP_H} hours apart.`,
  'too-short': `Not done: the record is shorter than ${MIN_TIDE_DAYS} days.`,
  'turned-off': 'Not done: turned off.',
  'inputs-too-long': 'Not done: with the further inputs\' lags, there are too few steps to fit it as well.',
};

/**
 * r: result from correct()
 * info: { fileName, levelName, baroName, sheetName }
 * Returns steps: [{ title, lines: [text], formula?, numbers: [[label, value]] }]
 */
export function describe(r, info) {
  const m = r.method, u = m.levelUnit, n = r.t.length;
  const kindText = { depth: 'depth to water, so down is larger', head: 'height or elevation, so up is larger', absolute: 'absolute pressure at the sensor' }[m.levelKind];
  const steps = [];

  steps.push({
    title: 'Record',
    lines: [`${info.fileName}${info.sheetName ? `, sheet ${info.sheetName}` : ''}: ${n} rows from ${stamp(r.t[0])} to ${stamp(r.t[n - 1])}, file clock.`,
      `Water level column "${info.levelName}", read as ${kindText}, in ${u}. Barometer column "${info.baroName}", in ${m.baroUnit}. Any other columns are carried through unchanged.`],
    numbers: [['Median time between rows', `${fixed(m.dtH * 60, 0)} minutes`], ['Time step used in the fits', `${fixed(m.stepH, 2)} hours`]],
  });

  steps.push({
    title: 'Data checks',
    lines: [
      'Fill codes (−9999, −999, 9999, 99999, −99999) and barometer values outside 5 to 12 m of water are treated as missing. Isolated spikes are found against a rolling median and left out of the fits. Barometer gaps up to 3 hours are interpolated. Nothing else is changed. Each affected row is named in the Flags column.',
      `Levels and pressures are averaged onto a regular ${fixed(m.stepH, 2)}-hour grid for fitting, and fitted effects are interpolated back to each row. Rows already on the grid are used exactly.`,
    ],
    numbers: [],
  });

  if (m.levelKind === 'absolute') {
    steps.push({ title: 'Air pressure subtracted', lines: ['The sensor reads total pressure, so air pressure was subtracted to give water column before anything else.'], formula: 'water column(t) = sensor(t) - p(t)', numbers: [] });
  }

  steps.push({
    title: 'Units',
    lines: ['Pressure is converted to metres of water at 10 °C (1 kPa = 0.10200 m), and levels to metres with up positive. All fits use those units. Efficiencies are dimensionless.'],
    numbers: [[`1 ${m.baroUnit} in metres of water`, sig5(m.baroToM)], [`1 ${u} in metres`, sig5(m.levelToM)]],
  });

  steps.push({
    title: 'Constant barometric efficiency',
    lines: ['Ordinary least squares on changes between steps, as in Clark (1967), with an intercept for steady drift. Barometric efficiency is the negative of the slope. The correction uses each row\'s own pressure, and removes no earth tide. It can be reproduced in a spreadsheet with SLOPE on the two change columns.', 'Here h(t) is the water level and p(t) the air pressure at step t, both in metres of water; a is the steady drift per step, b the fitted slope, e(t) what the fit leaves, and mean p the mean pressure.'],
    formula: `${CHANGE_FORMULA}\nBE = -b\ncorrected(t) = h(t) + BE [p(t) - mean p]`,
    numbers: [
      ['Barometric efficiency, BE', fixed(m.constant.be, 3)], ['Loading efficiency, 1 - BE', fixed(m.constant.loadingEfficiency, 3)],
      ['Range across six equal parts of the fit period', m.constant.range ? `${fixed(m.constant.range.min, 3)} to ${fixed(m.constant.range.max, 3)}` : 'too short to split'],
      ['Share of step-to-step change explained', `${fixed(m.constantExplained * 100, 1)}%`], ['Steps fitted', String(m.constant.rows)],
      [`Mean pressure, mean p (${m.baroUnit})`, sig5(m.baroMean)],
    ],
  });

  steps.push({
    title: 'Barometric response function',
    lines: [
      `Regression deconvolution, as in Rasmussen and Crawford (1997), Toll and Rasmussen (2007) and Butler et al. (2011), and in the KGS BRF software of Bohling et al. (2011). It is also fitted on changes between steps, with one coefficient for each lag from 0 to ${m.lagHours} hours. The lag length is fixed for every file.`,
      'u(k) is the coefficient for a lag of k steps, and m is the number of lag steps. The running sum of the coefficients is the response to a step in pressure. Its final value, with the sign changed, is the barometric efficiency. Every coefficient is on the Barometric response sheet.',
    ],
    formula: `${DECONVOLUTION_FORMULA}\nm = ${m.nLags} steps\nbarometric effect(t) = sum over k=0..m of u(k) p(t-k), less its mean`,
    numbers: [
      [`Barometric efficiency at ${m.lagHours} h`, fixed(m.be, 3)], ['Loading efficiency, 1 - BE', fixed(m.loadingEfficiency, 3)],
      ['Range across six equal parts of the fit period', m.beRange ? `${fixed(m.beRange.min, 3)} to ${fixed(m.beRange.max, 3)}` : 'too short to split'],
      [`Share of step-to-step change explained, including any earth tide${r.inputs ? ' and the further inputs' : ''}`, `${fixed(m.explained * 100, 1)}%`], ['Steps fitted', String(m.fitRows)],
      [`Fitted drift per step, kept in the record (${u})`, figures(m.driftPerStep, 3)],
      [`Mean of the barometric sum, removed from the effect (${u})`, figures(m.levelKind === 'depth' ? -m.baroOffsetM / m.levelToM : m.baroOffsetM / m.levelToM, 4)],
    ],
  });
  if (m.hasFitWindow) steps[steps.length - 1].lines.push('The fit used only the chosen dates. The correction was then applied to the whole record.');

  const t = m.tide;
  // How far the tidal lines stood above the quiet frequencies around them.
  const snr = (test) => [['M2 against quiet frequencies nearby', `${fixed(test.m2Snr, 1)} times`], ['O1 against quiet frequencies nearby', `${fixed(test.o1Snr, 1)} times`]];
  if (t.used) {
    const clock = `The file clock was taken as ${m.utcOffsetHours >= 0 ? '+' : ''}${m.utcOffsetHours} hours from UTC.`;
    steps.push({
      title: 'Earth tide',
      lines: [
        `The vertical tidal acceleration E(t) from the moon and sun was computed for the site (${m.lat}, ${m.lon}), and fitted together with the barometric response, with one coefficient for each lag from 0 to ${t.coefficients.length ? t.coefficients[t.coefficients.length - 1].lagH : 0} hours, as in BETCO and KGS BRF. ${clock}`,
        'v(j) is the coefficient for a lag of j steps, and n is the number of tide lag steps. The lags let the fit find the well\'s own gain and delay. The computed tide is on the data sheet, and the lag coefficients on the Barometric response sheet.',
      ],
      formula: `${TIDE_FORMULA}\nearth tide effect(t) = sum over j=0..n of v(j) E(t-j), less its mean`,
      numbers: [...snr(t.test), ['Needed to include the tide, on either line', `${t.test.threshold} times`]],
    });
  } else {
    const line = t.reason === 'no-response'
      ? `Not done: neither M2 nor O1 stood ${t.test.threshold} times above nearby quiet frequencies, so the well shows no tidal response to remove.`
      : TIDE_REASON[t.reason];
    steps.push({
      title: 'Earth tide',
      lines: [line],
      numbers: t.test ? snr(t.test) : [],
    });
  }

  const inputs = r.inputs ? r.inputs.list : [];
  if (inputs.length) {
    steps.push({
      title: 'Further measured inputs',
      lines: [
        `Each input was fitted together with the barometric response${t.used ? ' and the earth tide' : ''}, in the one regression above, with one coefficient for each lag from 0 to its own lag length. This is multi-factor regression deconvolution (Haehnel et al. 2024, eq. 9), as Dörr et al. (2026) use it for river levels and pond loading: the deconvolution of Rasmussen and Crawford (1997), with more drivers, as Toll and Rasmussen (2007) add the earth tide. Fitting them together lets each be found with the others held apart, so the barometric efficiency above is from this joint fit. The fit also keeps its intercept for steady drift.`,
        'Each response is a rise in the water level per unit rise of the input, whatever the direction of your level column. The effects in the spreadsheet are in the column\'s own direction, as the barometric effect is.',
        'x(i,t) is input i at step t, w(i,k) its coefficient at a lag of k steps, and m(i) its number of lag steps, from the lag length you gave. A level, such as a river or pond stage, is used as it is. An amount per row, such as rainfall, is used as its running total, so its change over a step is the amount that fell in that step, and the running sum of its coefficients is the response to one unit falling at lag 0.',
        'The lag lengths are yours. Dörr et al. (2026) took one at least as long as the time b²/D for pressure to cross the confining layer (their eq. 4, from van der Kamp and Schmidt 2017); Haehnel et al. (2024) one past which the coefficients settle about zero, and a small share of the record.',
        `Standard errors are from the coefficients' covariance, as ordinary least squares gives it (Draper and Smith 1998), and for a running sum from every variance and covariance in it, as in Haehnel et al. (2024, eq. B1), as Dörr et al. (2026) report them. They assume the residual changes are independent. Their correlation from one step to the next is ${fixed(r.inputs.residualLag1, 2)} here. Where it is far from 0, a standard error can be too small or too large, depending on how the input itself changes from step to step, so read them as a guide. Every coefficient and its standard error is on the Further inputs sheet.`,
      ],
      formula: `${INPUT_FORMULA}\nx(i,t) = the input, or for an amount, its running total\neffect of input i(t) = sum over k=0..m(i) of w(i,k) x(i,t-k), less its mean`,
      numbers: [['Residual degrees of freedom', String(r.inputs.dof)], ['Lag-1 correlation of the residual changes', fixed(r.inputs.residualLag1, 3)]],
    });
    for (const x of inputs) {
      steps.push({
        title: `Input: ${x.name}`,
        lines: [...inputMeaning(x, m), ACTION_TEXT[x.action]],
        numbers: [
          ['Kind', INPUT_KINDS[x.kind]], ['Unit', x.lengthRatio ? x.unit : 'not a length'], ['Response in', perUnit(x, u)],
          ['Lag length', `${fixed(x.lagHours, 2)} hours, ${x.nLags} steps${x.lagHoursAsked !== x.lagHours ? ` (${x.lagHoursAsked} hours asked, to the nearest step)` : ''}`],
          ['Immediate part, w(0)', plusMinus(x, x.immediate)],
          ...(x.lagged ? [[`Lagged part, w(1) to w(${x.nLags})`, plusMinus(x, x.lagged)]] : []),
          [`Whole response by ${fixed(x.lagHours, 0)} hours`, plusMinus(x, x.total)],
          ['Steps in the fit on which it changed', String(x.changes)],
          ['What was done', INPUT_ACTIONS[x.action]],
        ],
      });
    }
  }

  const inputsRemoved = inputs.some((x) => x.removedPart);
  steps.push({
    title: 'Result',
    lines: [`Effects are subtracted in level space, so the correction removes no drift, recharge, moisture loading or pumping trend beyond what moves with pressure${inputsRemoved ? ', the tide or the further inputs removed' : ' or the tide'}. Rows without a full pressure history have no standard result, which is why the record starts after the first lag period.`],
    formula: `corrected(t) = level(t) - barometric effect(t) - earth tide effect(t)${inputsRemoved ? ' - removed effect of each further input(t)' : ''}`,
    numbers: [],
  });

  const ex = workedRow(r);
  if (ex !== null) {
    const p = r.baroUsed[ex], h = r.level[ex];
    // corrected = h + BE (p - mean p) for a height, and h - BE (p - mean p) for a depth.
    const c = (m.levelKind === 'depth' ? -1 : 1) * m.constant.be;
    steps.push({
      title: 'Worked row',
      lines: [`Row at ${stamp(r.t[ex])}. In ${u}, in the file's own direction.`],
      formula: `Constant: ${fixed(h, 5)} ${c < 0 ? '-' : '+'} ${fixed(Math.abs(c), 6)} × (${fixed(p, 4)} - ${fixed(m.baroMean, 4)}) × ${sig5(m.baroToM)} / ${sig5(m.levelToM)} = ${fixed(r.constant.corrected[ex], 5)}\n`
        + `Standard: ${fixed(h, 5)} - (${fixed(r.standard.baroEffect[ex], 5)}) - (${fixed(r.standard.tideEffect[ex], 5)})${inputs.filter((x) => x.removedPart).map((x) => ` - (${fixed(x.removed[ex], 5)})`).join('')} = ${fixed(r.standard.corrected[ex], 5)}`,
      numbers: [],
    });
  }

  if (r.user) {
    steps.push({
      title: 'Your barometric efficiency',
      lines: ['Applied by the same formula as the constant result, with the value you entered in place of the fitted one.'],
      formula: 'corrected(t) = h(t) + BE [p(t) - mean p]',
      numbers: [['Barometric efficiency entered', fixed(r.user.be, 3)], ['Loading efficiency, 1 - BE', fixed(1 - r.user.be, 3)]],
    });
  }
  return { steps, references: inputs.length ? [...REFERENCES, ...INPUT_REFERENCES].sort((a, b) => a.localeCompare(b, 'en')) : REFERENCES };
}

// A clean row near the middle of the record, for the worked example.
function workedRow(r) {
  const mid = r.t.length >> 1;
  for (let d = 0; d < r.t.length; d++) {
    for (const i of [mid + d, mid - d]) {
      if (i >= 0 && i < r.t.length && !r.flags[i] && Number.isFinite(r.standard.corrected[i])) return i;
    }
  }
  return null;
}
