// The verdict on one value the fit gave (fit.js), for the pages that show or carry it:
// the fit page and the predict page. Each page has its own words for each.

// The profile of a value cut short by its budget of evaluations, leaving its linearized
// interval.
export const cutShort = (r) => Boolean(r.budget && r.interval === 'linearized');

/**
 * The verdict on r, one of fit.js's values ({ value, fixed, undetermined, interval,
 * budget, ... }), as a code:
 *   'fixed'        held at the value the user gave, not fitted;
 *   'limit'        ended at its limit, where an interval does not hold;
 *   'time'         no standard error, since the fit reached its time limit first;
 *   'unsettled'    not determined by its linearized interval alone, its profile cut short
 *                  by its budget: whether the readings fix it is not settled;
 *   'undetermined' not determined, for the reason r.undetermined gives;
 *   'interval'     determined, with its 95% interval.
 */
export function verdictOf(r) {
  if (r.fixed) return 'fixed';
  if (r.undetermined === 'limit') return 'limit';
  if (r.undetermined === 'time') return 'time';
  if (r.undetermined && cutShort(r)) return 'unsettled';
  if (r.undetermined) return 'undetermined';
  return 'interval';
}
