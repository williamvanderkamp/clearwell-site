// The slug test page's checks against the practice of Butler, McElwee and Liu (1996) and
// the Kansas Geological Survey reports that apply it, in words, free of the page so that
// they can be tested in Node. practice() makes each check the entries and the record
// allow (src/engine/slug-checks.js) and gives: notes, said only where the record gives
// cause, each quoting the user's numbers and its source; rows for the table of checks
// made; a plain summary of what K rests on; the checks that could not be made and what
// they need; and, for a file of several tests, the tests side by side.
import { UNITS } from '../../../engine/index.js';
import { compareTests, curvature, H0_BAND, H0_CONCERN, H0_DYNAMIC, H0_FACTOR, h0Check, K_BOUND, MIN_TESTS, ordering, RECOVERY, RECOVERY_LARGE_ALPHA, startChecks } from '../../../engine/slug-checks.js';
import { packRadius, TIME_S } from '../../../engine/slug.js';
import { countOf, fixed, listed, sig, six } from '../../../engine/format.js';
import { four } from './text.js';

// Units a level heading can name that are lengths, in metres.
export const LENGTH_OF_LEVEL = Object.fromEntries(['m', 'cm', 'mm', 'ft', 'in'].map((u) => [u, UNITS[u]]));
// Methods whose Lw runs from the water table, so that Lw - Le is the depth of the top of
// the screen below it.
const fromWaterTable = (v) => v.method === 'bouwerRice' || v.method === 'springerGelhar' || (v.method === 'kgs' && v.top === 'unconfined');

const pct = (x) => `${sig(100 * x, 2)}%`;

/**
 * v: the form's values. n: the analysed test, from normalize(). levelUnit: the unit the
 * level heading names, or ''. tests: for a file of several tests, [{ label, n, expected }]
 * in the order made, and chosen, the index of the analysed one; otherwise null. h0x: the
 * expected H0* of the analysed test, if known. line: for the straight-line methods,
 * { win, kOf } (kOf turns a slope in 1/s into K in m/s). K: the analysis's K in m/s, if
 * it gives one.
 */
export function practice({ v, n, levelUnit, tests = null, chosen = 0, h0x, line = null, K }) {
  const ts = TIME_S[v.tUnit], u = levelUnit ? ` ${levelUnit}` : '';
  const at = (s) => `${sig(s / ts, 4)} ${v.tUnit}`;
  // hints: a line of context under the table of checks, said only where the record calls for it.
  const notes = [], summary = [], rows = [], notMade = [], hints = [];
  // A check that raises doubt: its full note, and a short line for the summary.
  const doubt = (full, short) => { notes.push(full); summary.push(short); };

  // ---------------------------------------------------------- the start of the test
  const start = startChecks(n);
  if (h0x !== undefined) {
    // Butler and Healey (1999, Table 2, note 4): the H0 measured at the start, so the
    // reading at time zero where there is one, not an H0 typed in.
    const zero = n.t[0] === 0 ? n.ratio[0] * n.h0 : undefined, measured = zero ?? n.h0;
    const which = zero !== undefined ? 'the reading at time zero' : 'the H0 you entered, since there is no reading at time zero';
    const asH0 = `H0 here is ${zero !== undefined ? 'the reading at time zero' : 'the H0 you entered'}`;
    const c = h0Check(measured, h0x);
    rows.push(['H0 / H0*, measured over expected', `${four(c.ratio)} (H0 = ${sig(Math.abs(measured), 4)}${u}, ${which}; H0* = ${sig(Math.abs(h0x), 4)}${u})`]);
    const signs = c.signs ? ' H0 and H0* were compared as sizes, since their signs differ as entered.' : '';
    const dynamic = c.dynamic ? ` Butler and Healey (1999) add that a ratio below ${H0_DYNAMIC} is often a sign that the pressure transducer's readings need a correction for dynamic pressure in the accelerating water column; this page applies none.` : '';
    if (c.concern && c.ratio < 1) {
      doubt(`The measured H0, ${sig(Math.abs(measured), 4)}${u} (${which}), is ${pct(c.difference)} below the expected H0*, ${sig(Math.abs(h0x), 4)}${u} (H0/H0* = ${four(c.ratio)}). Butler, McElwee and Liu (1996, guideline 3) take a difference of more than ${pct(H0_CONCERN)} of H0* as a cause for concern: it shows a start too slow for the formation's response, and with the measured H0, and the smaller gradient toward the well that a slow start leaves, K comes out lower than the formation's.${dynamic}${signs}`,
        `H0 is ${pct(c.difference)} below the expected H0*, more than the ${pct(H0_CONCERN)} Butler, McElwee and Liu (1996) take as a concern: a slow start, which makes K too low.`);
    } else if (c.band === 'low') {
      notes.push(`H0/H0* = ${four(c.ratio)} (${asH0}), below about ${H0_BAND[0]}, which Butler and Healey (1999, Table 2) read as a possible sign of a start that was not instantaneous relative to the formation's response, or of readings that need a correction for dynamic pressure. It is within the ${pct(H0_CONCERN)} that Butler, McElwee and Liu (1996) take as the level of concern.${signs}`);
    } else if (c.band === 'high') {
      // Butler, McElwee and Liu's 10% concerns a slow start, an H0 below H0*; above it,
      // only Butler and Healey's reading applies.
      notes.push(`H0/H0* = ${four(c.ratio)} (${asH0}), above about ${H0_BAND[1]}, which Butler and Healey (1999, Table 2) put down to sensor noise and the way H0 was read from the record. Check H0* and the reading taken as H0.${signs}`);
    } else if (signs) notes.push(signs.trim());
  } else notMade.push(`H0 against the expected H0* (from the slug's volume over the area where the level moves, π rc², or for a pneumatic test the air pressure the level was held at, as a head${tests ? ': give an Expected H0 column' : ''}), Butler, McElwee and Liu's (1996) check that the test began fast enough`);

  if (start.beyond) {
    const b = start.beyond, last = b.last;
    const where = line ? (line.win[1] < 1 ? 'They lie above the fit window and take no part in the straight line.' : `The fit window you set reaches H/H0 = ${sig(line.win[1], 3)}, so readings beyond H0 can fall in it.`)
      : v.method === 'vanDerKamp' ? 'van der Kamp\'s fit starts at the reading furthest from static, so it starts at one of these unless you set the start.'
        : v.from !== undefined && v.from * ts > last ? 'They come before the start of the fit you set and take no part in it.'
          : 'The type-curve fit uses every reading after time zero; set "Fit readings from" to leave these out.';
    notes.push(`${b.count === 1 ? '1 reading' : `${b.count} readings`} after time zero ${b.count === 1 ? 'lies' : 'lie'} further from static than H0 (|H/H0| above 1), the furthest ${four(Math.abs(b.ratio))} times H0 at ${at(b.at)}${b.count > 1 ? `, between ${at(b.first)} and ${at(last)}` : ''}. Butler, McElwee and Liu (1996) find such early fluctuations "related to test initiation" and say they should be ignored when judging the fit of a model. ${where} If the level is furthest from static well after time zero, check time zero and H0: Butler and Healey (1999) put differences between repeat tests down to "uncertainty regarding H0 and the time of test initiation".`);
  }
  if (start.residual) {
    const r = start.residual, share = Math.abs(r.share), same = r.share * n.h0 > 0;
    rows.push(['Level when the test began, from static', `${pct(share)} of H0, ${same ? 'on the side H0 is' : r.share === 0 ? 'at static' : 'on the side opposite H0'} (the last of ${countOf(r.count, 'reading')} before time zero, at ${at(r.at)})`]);
    const why = 'Either the level had not recovered from what went before, or the test began before the time taken as zero (Butler and Garnett 2000 read the start from a plot of the whole record).';
    // Butler (1997) simulates the residual a previous test leaves, on the side of H0.
    const butler = `Butler (1997, KGS Open-File Report 97-59), simulating a test begun before the level had recovered from the one before, on the side of static H0 is on, finds that a residual deviation below ${pct(RECOVERY)} of H0 can be ignored for practical purposes, and that with a large storage parameter it should be below ${pct(RECOVERY_LARGE_ALPHA)} to keep the error in K under 10% (his estimates by Hvorslev's time lag and by Cooper et al.); incomplete recovery made K too low.`;
    if (same && share > RECOVERY) {
      doubt(`At ${at(r.at)}, the last reading before time zero, the level was ${pct(share)} of H0 from static, on the side H0 is. ${why} ${butler}`,
        `The level was ${pct(share)} of H0 from static when the test began, more than the ${pct(RECOVERY)} Butler (1997) finds can be ignored: K may be too low.`);
    } else if (same && share > RECOVERY_LARGE_ALPHA) {
      notes.push(`At ${at(r.at)}, the last reading before time zero, the level was ${pct(share)} of H0 from static, on the side H0 is. ${why} ${butler}`);
    } else if (!same && share > RECOVERY_LARGE_ALPHA) {
      notes.push(`At ${at(r.at)}, the last reading before time zero, the level was ${pct(share)} of H0 from static, on the side opposite H0, as where a test follows one that moved the level the other way. ${why} Butler (1997, KGS Open-File Report 97-59) treats a residual on the side of H0 only, so the page says nothing of which way this one moves K.`);
    }
  }

  // ---------------------------------------------------------- the straight line
  let curve = null;
  if (line) {
    curve = curvature(n.t, n.ratio, line.win[0]);
    if (curve) {
      const change = curve.late / curve.early;
      const span = `H/H0 from 1 to ${fixed(line.win[0], 2)}, ${countOf(curve.n, 'reading')} from ${at(curve.from)} to ${at(curve.to)}`;
      const shape = { up: 'concave upward: the fall slows', down: 'concave downward: the fall quickens', straight: 'no curvature beyond the scatter' }[curve.shape];
      rows.push(['Shape of the log plot', `${shape} (${span}; slope at the end ${pct(change)} of that at the start; t of the curvature ${fixed(curve.tStat, 1)} against ${fixed(curve.tCrit, 2)})`]);
      if (curve.shape === 'straight') hints.push('A log plot with no curvature beyond the scatter is what the Hvorslev and Bouwer and Rice models describe. Hyder et al. (1994), as Butler, McElwee and Liu (1996) cite them, note that it can also mean a large share of vertical flow to a partially penetrating screen, or a low-permeability well skin, which keeps the plot straight where the storage of the aquifer would otherwise curve it upward (Butler and McElwee 1996, section III.F).');
      if (curve.shape === 'down') {
        doubt(`ln(H/H0) against time is concave downward over ${span}: the line's slope at the end is ${pct(change)} of that at the start, a curvature the scatter does not explain (Student's t of the quadratic term ${fixed(curve.tStat, 1)}, beyond ${fixed(curve.tCrit, 2)}). Butler and McElwee (1996, KGS Open-File Report 95-75, section III.B) write that conventional theory gives straight or concave-upward plots of this kind and nothing in it allows a concave-downward one; at GEMS they found it, with K falling as H0 rose, among the signs of mechanisms the conventional theory leaves out in a very permeable aquifer. Butler and Garnett (2000) cite Butler's book (Butler 1998, p. 150; they date it 1997) that a linear or concave-upward plot shows the methods for highly permeable formations are not needed; this plot is neither. The span starts at time zero, and early readings are those Butler, McElwee and Liu (1996) find "related to test initiation": check the start too.`,
          `The log plot is concave downward (its slope ends at ${pct(change)} of where it starts), which conventional theory does not allow: check the start, and whether the formation is highly permeable.`);
      }
    }
  }

  // ---------------------------------------------------------- the screen and the water table
  if (fromWaterTable(v) && v.Lw !== undefined && v.Le !== undefined) {
    const top = v.Lw - v.Le, L = UNITS[v.lUnit];
    if (top <= v.Le * 1e-9) {
      const used = v.packN !== undefined;
      doubt(`The top of the screen is at the water table (Lw = ${sig(v.Lw, 4)} ${v.lUnit}, Le = ${sig(v.Le, 4)} ${v.lUnit}). Where a well is screened across the water table the filter pack drains as the level falls in it, and the log plot can show two straight lines, the first from the pack and the second from the formation: Bouwer (1989) fits the second, with the casing radius corrected for the pack's porosity n, rc* = [(1 − n) rc² + n rw²]^½ (as HydroSOLVE gives it). ${used ? `rc* = ${sig(packRadius(v.rc, v.rw, v.packN), 4)} ${v.lUnit} was used, from n = ${sig(v.packN, 3)}.` : v.method === 'bouwerRice' ? 'Enter the pack\'s porosity to have rc* used.' : 'This method takes no such correction here.'} The response can also depend on H0 and on whether the level was raised or lowered, since the length of screen that water flows through changes during the test (Butler, McElwee and Liu 1996).`,
        'The screen reaches the water table: the filter pack can drain, giving the double straight line of Bouwer (1989), and the response can depend on H0.');
    } else {
      if (v.packN !== undefined) notes.push(`rc* = ${sig(packRadius(v.rc, v.rw, v.packN), 4)} ${v.lUnit} was used for rc, from the filter pack porosity n = ${sig(v.packN, 3)} you gave, though the top of the screen is ${sig(top, 4)} ${v.lUnit} below the water table: Bouwer (1989) makes this correction where the level falls within the screen and its pack, as in a well screened across the water table (HydroSOLVE).`);
      const toM = LENGTH_OF_LEVEL[levelUnit];
      if (toM === undefined) notMade.push('whether the level was driven below the top of the screen, which needs H0 as a length: put the level column\'s unit in its heading, such as Displacement (m)');
      else {
        const h0m = Math.abs(n.h0) * toM, topM = top * L;
        rows.push(['|H0| against the depth of the screen top below the water table', `${sig(h0m / L, 4)} against ${sig(top, 4)} ${v.lUnit}`]);
        if (h0m > topM) {
          doubt(`|H0| = ${sig(h0m / L, 4)} ${v.lUnit} is more than the depth of the top of the screen below the water table, Lw − Le = ${sig(top, 4)} ${v.lUnit}. If this test lowered the level, it went below the top of the screen. Butler, McElwee and Liu (1996) find responses independent of whether the level was raised or lowered only "as long as the water level in the well is not driven below the top of the screen"; below it, the length of screen that water flows through changes during the test, and the filter pack can drain (Bouwer 1989).`,
            `|H0| is more than the depth of the screen top below the water table: if the level was lowered, it left the screen part dry.`);
        }
      }
    }
  }

  // ---------------------------------------------------------- repeat tests
  let series = null;
  if (tests && tests.length > 1) series = repeatTests({ tests, line, levelUnit, doubt, notes, rows });
  else {
    notMade.push(`repeat tests: ${tests ? 'the test column names one test' : 'the file holds one test'}, and Butler, McElwee and Liu (1996) advise ${MIN_TESTS} or more at a well, from ${H0_FACTOR} or more initial displacements a factor of ${H0_FACTOR} or more apart, the first and last with the same H0, so that a response that depends on H0, or a well that changes during testing, shows${tests ? '' : '. Put the tests in one file with a Test column'}`);
  }

  // ---------------------------------------------------------- what K rests on
  const lead = [];
  if (tests && tests.length > 1) lead.push(`K is from test ${tests[chosen].label}, ${chosen === 0 ? 'the first' : `number ${chosen + 1}`} of the ${tests.length} in the file${series && series.advice ? `; ${series.advice}` : ''}.`);
  if (K !== undefined && Number.isFinite(K)) {
    const md = K * 86400, [lo, hi] = K_BOUND.map((x) => x * 86400);
    const screen = `the Le and rw entered (${sig(v.Le, 4)} and ${sig(v.rw, 4)} ${v.lUnit}) should be the pack's length and radius`;
    if (md < lo) lead.push(`K = ${sig(md, 3)} m/d is below the ${lo} to ${hi} m/d under which Butler, McElwee and Liu (1996, guideline 8) find the filter pack usually much more permeable than the formation, so that the pack's length and radius are the effective screen length and radius${v.Le !== undefined ? `: if the well has a pack, ${screen}` : ''}.`);
    else if (md <= hi) lead.push(`K = ${sig(md, 3)} m/d is within the ${lo} to ${hi} m/d that Butler, McElwee and Liu (1996) give as the bound between moderate-to-low and high permeability: below it the filter pack's length and radius are the effective screen length and radius; above it responses often depend on H0.`);
    else lead.push(`K = ${sig(md, 3)} m/d is above the ${lo} to ${hi} m/d beyond which Butler, McElwee and Liu (1996) often found responses depend on H0, from non-Darcian losses, and needed electronic readings, "at least several hertz" in very rapidly responding wells; there it is harder to say whether the pack's or the screen's dimensions apply.${tests && tests.length > 1 ? '' : ' Repeat the test at another H0 to see whether this one depends on it.'}`);
  }
  summary.unshift(...lead);
  summary.push('Butler (2019, chapter 1) advises taking K from a slug test as a lower bound on the formation\'s K near the well, since incomplete well development and the details of well construction lower it; with good practice in the field and the analysis it can be a reasonable estimate.');
  const step = practiceStep({ rows, notMade, curve, series, h0x, start });
  const said = [...notes, ...summary, ...hints, ...rows.map((r) => r[1]), ...notMade, ...step.lines].join(' ');
  return { notes, summary, rows, hints, notMade, series, curve, start, step, cites: citesIn(said) };
}

// The step of the method text that says how each check made was made.
function practiceStep({ rows, notMade, curve, series, h0x, start }) {
  const lines = ['Checks of the test against the guidelines of Butler, McElwee and Liu (1996), as the Kansas Geological Survey reports that apply them make them. Each limit is the one a source gives, and a note is shown only where the record passes it.'];
  if (h0x !== undefined) lines.push(`H0, the displacement the record starts from, against the expected H0* you gave, as sizes: a difference of more than ${pct(H0_CONCERN)} of H0* is a concern (Butler, McElwee and Liu 1996, guideline 3); Butler and Healey (1999, Table 2) read H0/H0* below about ${H0_BAND[0]} as a start slower than the formation's response, or dynamic pressure in the water column, and above about ${H0_BAND[1]} as sensor noise.`);
  lines.push('Readings after time zero further from static than H0, which conventional theory does not allow, are counted.');
  if (start.residual) lines.push(`Readings before time zero take no part in any fit. The last of them gives the level's departure from static when the test began, which Butler (1997, KGS Open-File Report 97-59) finds can be ignored below ${pct(RECOVERY)} of H0 (below ${pct(RECOVERY_LARGE_ALPHA)} with a large storage parameter) where it is on the side of static H0 is on, the case he treats.`);
  if (curve) lines.push('The shape of the log plot: a least-squares quadratic in time through ln(H/H0), over the readings from H/H0 = 1 down to the bottom of the fit window, and Student\'s t test of its quadratic term at the 5% level, which takes the misfits as independent. Its slope at the last reading over that at the first says how far the fall slows (concave upward, as the storage of the aquifer makes it) or quickens (concave downward, outside conventional theory).');
  if (series && series.test) lines.push('Repeat tests: a straight line in the same window through each test, and the extra-sum-of-squares F test (Bates and Watts 1988) of one slope for all, each test with its own intercept, against a slope for each, at the 5% level. K follows from each slope as from the analysed test\'s.');
  if (series) lines.push(`Butler, McElwee and Liu (1996): ${MIN_TESTS} or more tests at a well, H0 varied by a factor of ${H0_FACTOR} or more, the first and last tests at the same H0.`);
  return { title: 'Checks against Butler\'s practice', lines, numbers: rows.map(([a, b]) => [a, b]), notMade };
}

// The works the words of the checks, and of the method text, cite, as the keys of the
// page's reference list (REF in refs.js), so that the references follow what was said.
const CITES = [
  [/Butler, McElwee and Liu('s)? \(1996/, 'butlerMcElweeLiu'],
  [/Butler and Healey \(1999/, 'butlerHealey'],
  [/Butler \(1997, KGS Open-File Report 97-59\)/, 'butlerRecovery'],
  [/Butler and McElwee \(1996/, 'butlerMcElwee'],
  [/Butler and Garnett \(?2000/, 'butlerGarnett'],
  [/Butler 1998/, 'butler'],
  [/Butler \(2019/, 'butler2019'],
  [/Bouwer \(?1989/, 'bouwer'],
  [/HydroSOLVE/, 'hydrosolveDsl'],
  [/Cunningham and Schalk 2011/, 'cunninghamSchalk'],
  [/Bates and Watts 1988/, 'batesWatts'],
  [/Hyder et al\. \(1994/, 'hyder'],
];
/** The works that text cites, as keys of REF in refs.js. */
export const citesIn = (said) => CITES.filter(([rx]) => rx.test(said)).map(([, key]) => key);

// The tests of one file side by side: H0 of each, H0/H0*, and for the straight-line
// methods K by the same method and window, compared by the F test of their slopes.
function repeatTests({ tests, line, levelUnit, doubt, notes, rows }) {
  const u = levelUnit ? ` ${levelUnit}` : '';
  const h0 = tests.map((g) => g.n.h0), size = h0.map(Math.abs);
  const ratio = tests.map((g) => (g.expected !== undefined ? h0Check(g.n.h0, g.expected).ratio : undefined));
  const k = tests.length;
  if (k < MIN_TESTS) {
    doubt(`The file holds ${k} tests. Butler, McElwee and Liu (1996, guideline 1) advise ${MIN_TESTS} or more at a well, closely spaced in time, so that a well that changes during testing can be told apart from a response that depends on H0; the USGS procedure GWPD 17 (Cunningham and Schalk 2011) makes four, two raising the level and two lowering it.`,
      `${k} tests, fewer than the ${MIN_TESTS} Butler, McElwee and Liu (1996) advise.`);
  }
  const factor = Math.max(...size) / Math.min(...size);
  if (factor < H0_FACTOR) {
    doubt(`|H0| spans a factor of ${sig(factor, 3)}, from ${sig(Math.min(...size), 4)} to ${sig(Math.max(...size), 4)}${u}. Butler, McElwee and Liu (1996, guideline 2) advise a factor of ${H0_FACTOR} or more, to show whether the response depends on H0.`,
      `H0 varies by a factor of ${sig(factor, 3)} across the tests, less than the ${H0_FACTOR} Butler, McElwee and Liu (1996) advise.`);
  }
  // Guideline 2 asks for the same H0 first and last, and gives no tolerance: the sizes are
  // shown, with no verdict.
  rows.push(['|H0| of the first and last tests', `${sig(size[0], 4)} and ${sig(size[k - 1], 4)}${u} (tests ${tests[0].label} and ${tests[k - 1].label}); Butler, McElwee and Liu (1996, guideline 2) advise the same H0 for both, with no tolerance given`]);
  const out = { h0, ratio, lines: null, K: null, test: null, advice: '' };
  if (!line) {
    notes.push(`The ${k} tests are drawn together, normalized, as Butler, McElwee and Liu (1996) advise: under conventional theory they coincide. This method is fitted to one test at a time; choose another under "Test to analyze" to compare its values.`);
    return out;
  }
  const cmp = compareTests(tests.map((g) => ({ label: g.label, t: g.n.t, ratio: g.n.ratio })), ...line.win);
  out.lines = cmp.lines;
  out.K = cmp.lines.map((l) => (l.error ? undefined : line.kOf(l.slope)));
  out.test = cmp.test;
  const failed = cmp.lines.map((l, i) => (l.error ? tests[i].label : null)).filter((x) => x !== null);
  if (failed.length) notes.push(`No straight line could be fitted to test${failed.length > 1 ? 's' : ''} ${listed(failed)} in the window: ${cmp.lines.find((l) => l.error).error} ${failed.length > 1 ? 'They are' : 'It is'} left out of the comparison.`);
  const okIdx = out.K.map((x, i) => (x === undefined ? -1 : i)).filter((i) => i >= 0);
  if (!cmp.test) {
    if (okIdx.length >= 2) notes.push('The tests\' lines could not be compared by their scatter: their windows hold too few readings to measure it.');
    return out;
  }
  const t = cmp.test, Ks = okIdx.map((i) => out.K[i]);
  const spread = Math.max(...Ks) / Math.min(...Ks);
  const stat = t.exact ? 'the readings lie on their lines exactly' : `F = ${sig(t.F, 3)} with ${t.d1} and ${t.d2} degrees of freedom, p = ${sig(t.p, 2)}`;
  const level = `the extra-sum-of-squares F test of Bates and Watts (1988) at the 5% level, the page's own choice of level, which takes the misfits about each line as independent and of one spread, so that with many readings it finds small differences`;
  rows.push(['K of the tests, largest over smallest', `${sig(spread, 3)}; ${t.differ ? 'beyond' : 'within'} the scatter (${stat})`]);
  const okSize = okIdx.map((i) => size[i]);
  if (!t.differ) {
    const varied = Math.max(...okSize) / Math.min(...okSize) >= H0_FACTOR;
    const both = new Set(okIdx.map((i) => Math.sign(h0[i]))).size > 1;
    const shows = [...(varied ? ['no dependence on H0'] : []), 'no change in the well during testing'];
    notes.push(`The ${okIdx.length} tests' straight lines in the window share one slope to within their scatter (${level}): K by test spans a factor of ${sig(spread, 3)}. Normalized responses that coincide show, by Butler, McElwee and Liu (1996), ${listed(shows)}${both ? ', whichever way the level was moved' : ''}.${varied ? '' : ` With |H0| varied by less than a factor of ${H0_FACTOR}, they cannot show whether the response depends on H0.`}`);
    return out;
  }
  const lab = (i) => tests[i].label;
  const kText = (i) => `${sig(out.K[i] * 86400, 3)} m/d`;
  const causes = [], shorts = [];
  const byH0 = ordering(okSize, Ks), byOrder = ordering(okIdx, Ks);
  if (byH0 === 'falls') {
    const below = Math.max(...Ks) < K_BOUND[0];
    causes.push(`K falls as |H0| rises, from ${kText(okIdx.reduce((a, i) => (size[i] < size[a] ? i : a)))} at the smallest H0 to ${kText(okIdx.reduce((a, i) => (size[i] > size[a] ? i : a)))} at the largest. Butler, McElwee and Liu (1996) find this inverse relationship between H0 and K in very permeable formations, above about ${K_BOUND[0] * 86400} to ${K_BOUND[1] * 86400} m/d, from non-Darcian losses; ${below ? `here every test's K is below that, where they found independence of H0 in confined formations "quite sound", so look first at the well and the screen. ` : ''}in wells screened near or across the water table a dependence on H0 can also come from the length of screen that water flows through changing during the test. Conventional theory, and the methods on this page, then no longer hold; Butler and Garnett (2000), after Butler's book (Butler 1998), advise small initial displacements.`);
    shorts.push('K falls as H0 rises');
    out.advice = 'the tests with the smallest H0 are the least affected by the dependence on H0';
  } else if (byH0 === 'rises') causes.push('K rises as |H0| rises, a pattern the sources here do not describe.');
  if (byOrder) {
    causes.push(`K ${byOrder === 'falls' ? 'falls' : 'rises'} from each test to the next, from ${kText(okIdx[0])} (test ${lab(okIdx[0])}) to ${kText(okIdx[okIdx.length - 1])} (test ${lab(okIdx[okIdx.length - 1])}). A response that changes during testing${byH0 ? '' : ', with no consistent order by H0,'} means the well or the formation next to it is changing: Butler, McElwee and Liu (1996) suggest fine material mobilized by the slugs may form a low-permeability skin, K falling test by test, and advise analysing the tests from before the skin became pronounced. Butler (2019) uses repeat tests to judge whether a well's development was effective.`);
    shorts.push(`K ${byOrder} from test to test`);
    if (byOrder === 'falls' && !out.advice) out.advice = `with a skin forming during testing, Butler, McElwee and Liu (1996) advise the earliest test, here ${lab(okIdx[0])}`;
  }
  const signs = okIdx.map((i) => Math.sign(h0[i]));
  if (new Set(signs).size > 1) {
    const bySign = ordering(signs, Ks);
    if (bySign) {
      causes.push(`Every test with ${bySign === 'falls' ? 'negative' : 'positive'} H0 gives a larger K than every test with ${bySign === 'falls' ? 'positive' : 'negative'} H0: the response depends on whether the level was raised or lowered. Butler, McElwee and Liu (1996) found it does not in properly developed wells, as long as the level is not driven below the top of the screen; it can where development is incomplete, in a well screened across the water table, or, in theory, in a very permeable formation.`);
      shorts.push('K depends on the direction of the test');
    }
  }
  if (!causes.length) causes.push('K follows no consistent order by H0 or by the order of the tests. Butler, McElwee and Liu (1996) took responses that varied from test to test with no reproducible dependence on H0 (two tests of similar H0 differing by close to a factor of 2) as a sign that the filter pack or the formation near the well was being altered during testing.');
  const full = `K by test spans a factor of ${sig(spread, 3)}, more than the scatter about each test's straight line in the window allows (${stat}; ${level}). ${causes.join(' ')} Whether a difference matters is the analyst's judgment: Butler, McElwee and Liu (1996) call a factor of close to 2 between tests of similar H0 considerable, and Butler and Healey (1999) took a small dependence on H0 as negligible.`;
  // A difference beyond the scatter alone is not put in the summary: with dense records the
  // F test finds small ones. A pattern the sources describe is.
  if (shorts.length) doubt(full, `The repeat tests' K spans a factor of ${sig(spread, 3)}: ${listed(shorts)}.`);
  else notes.push(full);
  return out;
}

/** The checks made, the tests side by side and every test's readings, as workbook sheets. */
export function practiceSheets(p, v, tests) {
  const ts = TIME_S[v.tUnit], blank = (x) => six(x, '');
  const sheets = [{
    name: 'Checks',
    header: ['Check', 'Result'],
    rows: [...p.rows, ...p.hints.map((x) => ['Note', x]), ...p.notMade.map((x) => ['Not checked', x]), ...p.summary.map((x) => ['Summary', x])],
  }];
  if (tests && tests.length > 1) {
    const s = p.series;
    sheets.push({
      name: 'Tests',
      header: ['Test', 'Order', 'H0', 'Expected H0*', 'H0/H0*', ...(s.K ? ['Readings in window', 'Slope (1/s)', 'K (m/s)', 'K (m/d)'] : [])],
      rows: tests.map((g, i) => [g.label, i + 1, blank(g.n.h0), blank(g.expected), blank(s.ratio[i]),
        ...(s.K ? (s.lines[i].error ? ['', '', '', ''] : [s.lines[i].n, blank(s.lines[i].slope), blank(s.K[i]), blank(s.K[i] * 86400)]) : [])]),
    }, {
      name: 'All tests',
      header: ['Test', `Time (${v.tUnit})`, 'H/H0'],
      rows: tests.flatMap((g) => g.n.t.map((x, i) => [g.label, Number((x / ts).toPrecision(12)), blank(g.n.ratio[i])])),
    });
  }
  return sheets;
}
