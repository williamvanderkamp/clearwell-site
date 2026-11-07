// Works out which columns hold time, water level and pressure, and their units, from
// what the file states. Anything it doesn't state is left blank for the user to choose.
import { median, TIME_UNITS } from '../engine/index.js';

const BARO = /baro|atmos|air.?press|\bbp\b|\bslp\b|altimeter|mmhg|inhg|hpa|mbar|millibar/i;
const TEMP = /temp|°\s*[cf]|deg.?[cf]\b/i;
const NOT_DATA = /qual|flag|code|\bcd\b|approv|grade|status|site|station|id$/i;
const LEVEL = /depth|dtw|water.?level|water.?elev|\bwl\b|\blevel\b|\bhead\b|elev|gwl|lev_va|72019|62610|62611|piezo|draw.?down/i;
const PRECIP = /precip|rain|snow/i;

const UNIT_WORDS = {
  ft: ['ft', 'feet', 'foot'], m: ['m', 'meter', 'meters', 'metre', 'metres', 'masl', 'asl'], cm: ['cm'], mm: ['mm'], in: ['in', 'inches'],
  psi: ['psi', 'psia', 'psig'], kPa: ['kpa'], hPa: ['hpa'], mbar: ['mbar', 'mb', 'millibar', 'millibars'],
  mmHg: ['mmhg'], inHg: ['inhg'], cmH2O: ['cmh2o', 'cm h2o', 'cm water'],
  s: ['s', 'sec', 'secs', 'second', 'seconds'], min: ['min', 'mins', 'minute', 'minutes'], h: ['h', 'hr', 'hrs', 'hour', 'hours'], d: ['d', 'day', 'days'],
  mH2O: ['mh2o', 'm h2o', 'm water', 'metres of water', 'meters of water'], ftH2O: ['fth2o', 'ft h2o', 'ft water'],
};
export const LEVEL_UNITS = ['m', 'ft', 'cm', 'mm', 'in', 'psi', 'kPa', 'mbar', 'hPa', 'cmH2O'];
export const BARO_UNITS = ['hPa', 'mbar', 'kPa', 'mmHg', 'inHg', 'psi', 'mH2O', 'cmH2O', 'ftH2O'];

// The unit named in a label, or null. Longest names first, so "m h2o" beats "m".
export function unitInLabel(label, options) {
  const s = ` ${String(label).toLowerCase().replace(/[()[\],_/-]/g, ' ').replace(/\s+/g, ' ')} `;
  const pairs = [];
  for (const u of options) for (const w of UNIT_WORDS[u] || []) pairs.push([u, w]);
  pairs.sort((a, b) => b[1].length - a[1].length);
  for (const [u, w] of pairs) if (s.includes(` ${w} `)) return u;
  return null;
}

/** The time unit a heading names: s, min, h or d, or null. */
export const timeUnitIn = (label) => unitInLabel(label, Object.keys(TIME_UNITS));

const SAMPLE_ROWS = 3000;

// A time column of plain numbers counts from the start of the test, in the unit its
// heading names. Excel dates are numbers too, but far larger.
function timeKindOf(label, stats) {
  const s = label.replace(/_/g, ' ');
  if (/date/i.test(s) || stats.numericShare < 0.5 || stats.median > 20000) return 'date';
  if (/\b(min|mins|minute|minutes)\b/i.test(s)) return 'min';
  if (/\b(hr|hrs|hour|hours)\b/i.test(s)) return 'hour';
  if (/\bdays?\b/i.test(s)) return 'day';
  return '';
}

function levelKindOf(label) {
  const s = label.replace(/_/g, ' ');
  if (/draw.?down/i.test(s)) return 'drawdown';
  if (/depth|dtw|below|bgs|btoc|bls|72019/i.test(s)) return 'depth';
  if (/\babs|psia/i.test(s)) return 'absolute';
  if (/elev|height|\bhead\b|masl|\basl\b|62610|62611/i.test(s)) return 'head';
  return '';
}

function columnStats(rows, col) {
  const sample = rows.slice(0, SAMPLE_ROWS).map((r) => r[col]).filter((v) => v !== null);
  const numbers = sample.filter((v) => typeof v === 'number');
  return { numericShare: numbers.length / (sample.length || 1), median: median(numbers) };
}

// Returns column indexes (-1 for none) and settings ('' for not stated).
export function detect(header, rows) {
  const h = header.map((x) => String(x || ''));
  const numeric = (i) => columnStats(rows, i).numericShare > 0.5;
  const find = (rx) => h.findIndex((x) => rx.test(x));
  let time = find(/date.*time|time.*stamp|datetime|timestamp/i), time2 = -1;
  if (time < 0) {
    time = find(/date/i);
    const t = h.findIndex((x, i) => i !== time && /^\s*time\b/i.test(x));
    if (time < 0) time = t; else time2 = t;
  }
  if (time < 0) time = find(/elapsed|^\s*(mins?|minutes?|hrs?|hours?|days?)\b/i);
  const baro = h.findIndex((x, i) => BARO.test(x) && !NOT_DATA.test(x) && numeric(i));
  let level = h.findIndex((x, i) => LEVEL.test(x) && !NOT_DATA.test(x) && !BARO.test(x) && !TEMP.test(x) && !PRECIP.test(x) && numeric(i));
  if (level < 0) level = h.findIndex((x, i) => /press/i.test(x) && !BARO.test(x) && !NOT_DATA.test(x) && numeric(i));

  const levelLabel = h[level] || '';
  return {
    time, time2, level, baro,
    levelKind: levelKindOf(levelLabel),
    levelUnit: unitInLabel(levelLabel, LEVEL_UNITS) || '',
    baroUnit: unitInLabel(h[baro] || '', BARO_UNITS) || '',
    timeKind: time < 0 ? '' : timeKindOf(h[time], columnStats(rows, time)),
    utcClock: /utc|gmt/i.test(h[time] || ''),
  };
}
