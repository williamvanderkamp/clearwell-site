// The plain record of what was done to one file. The page and the workbook's Method
// sheet both use this text, so they can't disagree.

import { fixed, sig } from './format.js';

/** sig() keeping trailing zeros, so numbers in one column carry the same precision. */
export const figures = (x, p = 3, keepZeros = true) => sig(x, p, keepZeros);
const sig5 = (v) => figures(v, 5);
export const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

const CHANGE_FORMULA = 'h(t) - h(t-1) = a + b [p(t) - p(t-1)] + e(t)';
const DECONVOLUTION_FORMULA = 'h(t) - h(t-1) = a + sum over k=0..m of u(k) [p(t-k) - p(t-k-1)] + e(t)';
const TIDE_FORMULA = '... + sum over j=0..n of v(j) [E(t-j) - E(t-j-1)]';

const REFERENCES = [
  'Bohling, G.C., Jin, W., and Butler, J.J., Jr. (2011) Kansas Geological Survey Barometric Response Function software user\'s guide. KGS Open-File Report 2011-10.',
  'Butler, J.J., Jr., Jin, W., Mohammed, G.A., and Reboulet, E.C. (2011) New insights from well responses to fluctuations in barometric pressure. Ground Water 49(4), 525-533.',
  'Clark, W.E. (1967) Computing the barometric efficiency of a well. Journal of the Hydraulics Division, ASCE 93(HY4), 93-98.',
  'Rasmussen, T.C., and Crawford, L.A. (1997) Identifying and removing barometric pressure effects in confined and unconfined aquifers. Ground Water 35(3), 502-511.',
  'Toll, N.J., and Rasmussen, T.C. (2007) Removal of barometric pressure effects and earth tides from observed water levels. Ground Water 45(1), 101-105.',
];

const TIDE_REASON = {
  'no-location': 'Not done: the well location was not given.',
  'step-too-long': 'Not done: readings are more than 3 hours apart.',
  'too-short': 'Not done: the record is shorter than 15 days.',
  'turned-off': 'Not done: turned off.',
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
      ['Share of step-to-step change explained, including any earth tide', `${fixed(m.explained * 100, 1)}%`], ['Steps fitted', String(m.fitRows)],
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

  steps.push({
    title: 'Result',
    lines: ['Effects are subtracted in level space, so the correction removes no drift, recharge, moisture loading or pumping trend beyond what moves with pressure or the tide. Rows without a full pressure history have no standard result, which is why the record starts after the first lag period.'],
    formula: 'corrected(t) = level(t) - barometric effect(t) - earth tide effect(t)',
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
        + `Standard: ${fixed(h, 5)} - (${fixed(r.standard.baroEffect[ex], 5)}) - (${fixed(r.standard.tideEffect[ex], 5)}) = ${fixed(r.standard.corrected[ex], 5)}`,
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
  return { steps, references: REFERENCES };
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
