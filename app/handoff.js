// Values one tool hands to another in this tab, such as the values a fit gave to the
// predict page. Held in memory only: nothing is stored, and a reload forgets it.
import { el } from './kit.js';

let held = null;

/** Holds x for the tool with id `to`, replacing anything held before. */
export const handOff = (to, x) => { held = { to, x }; };

/** What was handed to the tool with id `to`, once; null if nothing was. */
export function takeHandOff(to) {
  if (!held || held.to !== to) return null;
  const { x } = held;
  held = null;
  return x;
}

/**
 * The button that takes values to the predict page and opens it: payload is what that
 * page reads (fromFit or fromLeaky in predict-fit.js).
 */
export const predictButton = (payload) => el('button', { class: 'btn quiet', type: 'button', onclick: () => {
  handOff('predict', payload);
  location.hash = '#predict';
} }, 'Predict long-term drawdown from these values');
