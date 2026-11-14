// The slug test file as the page reads it: the columns its headings name, the unit its
// level heading gives, and its tests, one, or several told apart by a test column.
import { normalize } from '../../../engine/slug.js';
import { splitTests } from '../../../engine/slug-checks.js';
import { timeUnitIn } from '../../columns.js';
import { columnValues, findColumn } from '../../kit.js';

// The unit a level heading names in brackets, such as m in "Depth to water (m)".
export const unitIn = (heading) => {
  const m = /\(([^()]+)\)\s*$/.exec(String(heading || ''));
  return m ? m[1].trim() : '';
};

export function detect(f, header) {
  const t = findColumn(header, /^\s*(elapsed\s+)?time\b/i);
  if (t !== undefined) { f.set('t', t); f.set('tUnit', timeUnitIn(header[t])); }
  const disp = findColumn(header, /displacement/i);
  const level = findColumn(header, /water level|depth to water|water elevation/i);
  const test = findColumn(header, /^\s*test\s*(no\.?|number|id|label|name)?\s*$/i);
  if (test !== undefined) f.set('test', test);
  const expected = findColumn(header, /expected/i);
  if (expected !== undefined) f.set('h0xCol', expected);
  if (disp !== undefined) {
    f.set('level', disp);
    f.set('kind', 'disp');
  } else if (level !== undefined) {
    f.set('level', level);
    f.set('kind', 'level');
  }
}

// The tests of the file: one, or several told apart by a test column, each with its H0
// from its reading at time zero; the analysed one; and its expected H0*.
export function testsOf(v, data, t, disp) {
  const expected = v.h0xCol === undefined ? [] : columnValues(data, v.h0xCol);
  if (v.test === undefined) return { n: normalize(t, disp, v.h0), tests: null, chosen: 0, h0x: v.h0x ?? expected.find(Number.isFinite), unlabelled: [] };
  const split = splitTests(t, disp, data.rows.map((r) => r[v.test]), expected);
  if (!split.tests.length) throw new Error('The test column holds no labels.');
  const tests = split.tests.map((g) => {
    try {
      return { ...g, n: normalize(g.t, g.d, undefined, { withoutZero: 'With several tests in one file, each takes its H0 from its reading at time zero.' }) };
    } catch (e) {
      throw new Error(`Test ${g.label}: ${e.message}`);
    }
  });
  const want = v.which === undefined ? tests[0].label : String(v.which).trim();
  const chosen = tests.findIndex((g) => g.label === want);
  if (chosen < 0) throw new Error(`No test is labelled ${want} in the test column. Its labels are ${tests.map((g) => g.label).join(', ')}.`);
  return { n: tests[chosen].n, tests, chosen, h0x: tests[chosen].expected, unlabelled: split.unlabelled };
}
