// Fitted values brought to the predict page: from the "Fit a pumping test solution" page,
// with each value's 95% interval and verdict, and from the leaky aquifer tool, with
// values alone. Each solution the predict page can carry maps to one of its aquifers;
// only the values that aquifer uses come over.
import { AQUIFERS } from '../../engine/predict.js';
import { verdictOf } from '../verdicts.js';

// The fitted solutions whose values the predict page's aquifers take, value for value
// (AQUIFERS names them). extra(handed, fields), where given, fills in fields beyond those
// values and returns what the page says of them.
export const FROM_FIT = {
  theis: { aquifer: 'confined' },
  'hantush-jacob': { aquifer: 'leaky' },
  neuman: { aquifer: 'unconfined', extra: neumanExtra },
};

// Neuman's anisotropy and the saturated thickness the fit was given, for when the delayed
// drainage is over, and the thickness for Jacob's correction, undone. Kz/Kr shapes only
// the delayed drainage, which is over at the long times the unconfined aquifer is
// predicted for (Theis with S + Sy).
function neumanExtra(handed, fields) {
  const k = handed.params['Kz/Kr'];
  const kOk = k && !k.undetermined;
  if (kOk) fields.KzKr = four(k.value);
  if (handed.b > 0) fields.D = handed.b;
  return `${kOk ? 'Kz/Kr comes over only to say when the delayed drainage is over; at long times the drawdown no longer depends on it (Kruseman and de Ridder 1994, p. 104).' : 'Kz/Kr was not determined by the fit, so it is left blank.'}${handed.b > 0 ? ' The saturated thickness the fit was given comes over too: with it, Jacob\'s correction is undone on the drawdowns. Clear it to see them without.' : ''}`;
}

// Each value as the fit page shows it: to 4 significant figures.
const four = (x) => Number(x.toPrecision(4));

// What fit.js's verdict codes mean, for a value not determined.
const NOT_FIXED = 'the readings do not pin it down';
// Each verdict but 'interval' (verdicts.js), in words: why the value comes with no interval.
const NO_INTERVAL = {
  fixed: 'held in the fit at the value you gave, not estimated from the test',
  limit: 'ended at its limit in the fit, where an interval does not hold',
  time: 'no interval, since the fit reached its time limit first',
  unsettled: 'not settled by the fit: its profile was cut short by its budget of evaluations',
  undetermined: `not determined by the fit: ${NOT_FIXED}`,
};

/**
 * What the fit page hands over, { solution, name, lu, params, lastDay, b }, turned into the
 * predict page's fields and a word on each value. params is the fit page's values in the
 * user's units ({ value, lower, upper, fixed, undetermined, interval, budget, further,
 * clipped, widened }). Returns null for a solution the page cannot carry.
 *
 * Returns { aquifer, lu, fields: { id: number }, values: { id: { value, lower, upper,
 * status, notes } }, lastDay, name, unused }. status is 'interval' (a value with its 95%
 * interval), 'none' (a value with no interval, with the reason in notes) or 'undetermined'
 * (no value: the user must give one known from elsewhere).
 */
export function fromFit(handed) {
  const map = FROM_FIT[handed.solution];
  if (!map) return null;
  const values = {}, fields = {};
  for (const id of AQUIFERS[map.aquifer].params) {
    const r = handed.params[id];
    const verdict = verdictOf(r);
    const status = verdict === 'interval' ? 'interval' : verdict === 'unsettled' || verdict === 'undetermined' ? 'undetermined' : 'none';
    const notes = [];
    if (status !== 'interval') notes.push(NO_INTERVAL[verdict]);
    else {
      if (r.atLimit) notes.push('it ended at its limit in the fit, and its interval runs from the limit');
      if (r.interval === 'linearized') notes.push('its interval is linearized, and may be too narrow');
      if (r.further) notes.push('its interval may reach further');
      if (r.widened) notes.push('its interval was widened to take in other fits as good');
      if (r.clipped) notes.push('its interval is cut at the limit the method allows');
    }
    const v = { status, notes };
    if (status !== 'undetermined') { v.value = four(r.value); fields[id] = v.value; }
    if (status === 'interval') {
      v.lower = four(r.lower); v.upper = four(r.upper);
      fields[`${id}lo`] = v.lower; fields[`${id}hi`] = v.upper;
    }
    values[id] = v;
  }
  const unused = map.extra ? map.extra(handed, fields) : null;
  return { aquifer: map.aquifer, lu: handed.lu, fields, values, lastDay: handed.lastDay, name: handed.name, unused, from: 'fit' };
}

/**
 * What the leaky aquifer tool hands over, { T, S, B, lu } in the user's units: values
 * alone, since that tool gives no intervals.
 */
export function fromLeaky(handed) {
  const values = {}, fields = {};
  for (const id of AQUIFERS.leaky.params) {
    values[id] = { status: 'none', notes: ['no interval, since the leaky aquifer tool gives none'], value: four(handed[id]) };
    fields[id] = values[id].value;
  }
  return { aquifer: 'leaky', lu: handed.lu, fields, values, lastDay: handed.lastDay, name: 'Hantush and Jacob (1955), from the leaky aquifer tool', unused: null, from: 'leaky' };
}
