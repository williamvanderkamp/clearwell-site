// Example data for the trend tool, embedded because the page may not fetch files.
// Two are worked examples from USEPA (2009) with their published answers; the third
// is real USGS data with no published answer. choices holds only what the source
// gives; needs says, right after loading, which choices are left to the user and why.
import { toCsv } from '../format.js';

const SULFATE_YRMON = [89.6, 89.8, 90.1, 90.3, 90.6, 90.8, 91.1, 91.3, 91.6, 91.8, 92.1, 92.6,
  93.1, 93.6, 94.1, 94.6, 95.1, 95.6, 95.8, 96.1, 96.3, 96.6, 96.8];
const SULFATE = [480, 450, 490, 520, 485, 510, 510, 530, 510, 560, 560, 540, 590, 550, 600, 700, 570, 610, 650, 620, 830, 720, 590];

// Rows are months, columns are 1983, 1984, 1985 (USEPA 2009, Example 14-8).
const MONTHLY = [[1.99, 2.01, 2.15], [2.10, 2.10, 2.17], [2.12, 2.17, 2.27], [2.12, 2.13, 2.23], [2.11, 2.13, 2.24], [2.15, 2.18, 2.26],
  [2.19, 2.25, 2.31], [2.18, 2.24, 2.32], [2.16, 2.22, 2.28], [2.08, 2.13, 2.22], [2.05, 2.08, 2.19], [2.08, 2.16, 2.22]];

const pad = (m) => String(m).padStart(2, '0');
const yrmon = (v) => { const [y, m] = v.toFixed(1).split('.'); return `19${y}-${pad(+m)}-01`; };

const seasonalRows = [1983, 1984, 1985].flatMap((y, k) => MONTHLY.map((row, m) => [`${y}-${pad(m + 1)}-01`, row[k]]));
const sulfateRows = SULFATE_YRMON.map((d, i) => [yrmon(d), SULFATE[i]]);
const illinoisRows = '2026-06-29,78.340\n2026-06-30,78.433\n2026-07-01,78.594\n2026-07-02,78.856\n2026-07-03,78.960\n2026-07-04,78.906\n2026-07-05,78.788\n2026-07-06,78.733\n2026-07-07,78.769\n2026-07-08,78.858\n2026-07-09,78.916\n2026-07-10,78.957\n2026-07-11,79.021\n2026-07-12,79.099\n2026-07-13,79.210\n2026-07-14,79.345\n2026-07-15,79.476\n2026-07-16,79.632\n2026-07-17,79.764\n2026-07-18,79.689\n2026-07-19,79.649\n2026-07-20,79.608\n2026-07-21,79.564\n2026-07-22,79.708\n2026-07-23,79.845\n2026-07-24,79.912\n2026-07-25,79.962\n2026-07-26,79.979\n2026-07-27,79.989\n2026-07-28,80.004\n2026-07-29,80.035\n2026-07-30,80.065\n2026-07-31,80.053\n2026-08-01,79.886\n2026-08-02,79.742\n2026-08-03,79.687\n2026-08-04,79.703\n2026-08-05,79.745\n2026-08-06,79.848\n2026-08-07,79.849\n2026-08-08,79.861\n2026-08-09,79.846\n2026-08-10,79.766\n2026-08-11,79.748\n2026-08-12,79.725\n2026-08-13,79.748\n2026-08-14,79.762\n2026-08-15,79.735\n2026-08-16,79.642\n2026-08-17,79.641\n2026-08-18,79.645\n2026-08-19,79.616\n2026-08-20,79.653\n2026-08-21,79.709\n2026-08-22,79.671\n2026-08-23,79.650\n2026-08-24,79.661\n2026-08-25,79.710\n2026-08-26,79.748\n2026-08-27,79.984\n2026-08-28,80.272\n2026-08-29,80.469\n2026-08-30,80.538\n2026-08-31,80.690\n2026-09-01,81.068\n2026-09-02,81.151\n2026-09-03,81.027\n2026-09-04,80.920\n2026-09-05,80.835\n2026-09-06,80.802\n2026-09-07,80.735\n2026-09-08,80.708\n2026-09-09,80.687\n2026-09-10,80.717\n2026-09-11,80.670\n2026-09-12,80.612\n2026-09-13,80.657\n2026-09-14,80.697\n2026-09-15,80.618\n2026-09-16,80.638\n2026-09-17,80.590\n2026-09-18,80.569\n2026-09-19,80.429\n2026-09-20,80.293\n2026-09-21,80.286\n2026-09-22,80.349\n2026-09-23,80.362\n2026-09-24,80.346\n2026-09-25,80.288\n2026-09-26,80.286\n2026-09-27,80.205\n2026-09-28,80.104\n2026-09-29,80.102\n2026-09-30,80.073\n2026-10-01,79.966\n2026-10-02,79.908\n2026-10-03,79.918\n2026-10-04,79.730\n2026-10-05,79.529\n2026-10-06,79.333\n2026-10-07,79.185\n2026-10-08,79.232\n2026-10-09,79.244\n2026-10-10,79.186\n2026-10-11,79.161\n2026-10-12,79.082\n2026-10-13,79.093\n2026-10-14,79.219\n2026-10-15,79.260\n2026-10-16,79.213\n2026-10-17,79.363\n2026-10-18,79.274\n2026-10-19,79.297\n2026-10-20,79.428\n2026-10-21,79.380\n2026-10-22,79.226\n2026-10-23,79.198\n2026-10-24,79.142\n2026-10-25,79.058\n2026-10-26,78.993\n2026-10-27,78.919\n2026-10-28,78.858\n2026-10-29,78.848\n2026-10-30,78.938'.split('\n').map((l) => { const [d, v] = l.split(','); return [d, +v]; });

const SEASONAL_HEADER = ['Date', 'Analyte (mg/L)'];
const SULFATE_HEADER = ['Date', 'Sulfate (ppm)'];
const ILLINOIS_HEADER = ['Date', 'Depth to water (ft)'];

export const EXAMPLES = [
  {
    label: 'Seasonal example (USEPA 2009)', name: 'usepa-2009-example-14-10.csv',
    csv: toCsv(SEASONAL_HEADER, seasonalRows),
    choices: { test: 'smk', seasons: 'months', direction: 'up', alpha: '0.01', cols: ['Analyte (mg/L)'] },
    about: 'Monthly concentrations for 1983 to 1985 from USEPA (2009) Unified Guidance, Example 14-8, tested in Example 14-10 at a 0.01 significance level for an increasing trend. The guidance gives only the month, so each date is the first of its month. Its published answer: S = 35, SD[S] = 6.558, Z = 5.18, a significant increasing trend.',
  },
  {
    label: 'Sulfate example (USEPA 2009)', name: 'usepa-2009-example-17-6.csv',
    csv: toCsv(SULFATE_HEADER, sulfateRows),
    choices: { test: 'mk', direction: 'up', cols: ['Sulfate (ppm)'] },
    about: 'Sulfate at one well, 1989 to 1996, from USEPA (2009) Unified Guidance, Example 17-6, a test for an increasing trend. The guidance gives dates as year.month, so each date is the first of its month. Its published answer: S = 194, SD[S] = 37.79, Z = 5.11.',
    needs: 'The guidance names no significance level, so none is set: choose a Significance level below, then Run.',
  },
  {
    label: 'Water level example (USGS)', name: 'usgs-well-WOOD-08-01-daily.csv',
    csv: toCsv(ILLINOIS_HEADER, illinoisRows),
    choices: { test: 'mk', cols: ['Depth to water (ft)'] },
    about: 'Daily means of the 15-minute depth to water readings at USGS well WOOD-08-01, Illinois, 29 June to 30 October 2026; the last day, with one reading, is left out. Real data with no published answer. Daily readings are not independent of each other, so read the result with the caution in the notes.',
    needs: 'With no published test to follow, no trend direction or significance level is set: choose Trend to test for and Significance level below, then Run.',
  },
];

/** Every example as a spreadsheet to copy, named as on its button. The USGS record is public data. */
export const SPEC_EXAMPLES = [
  { label: EXAMPLES[0].label, name: 'trend-example-seasonal.xlsx', header: SEASONAL_HEADER, rows: seasonalRows },
  { label: EXAMPLES[1].label, name: 'trend-example-sulfate.xlsx', header: SULFATE_HEADER, rows: sulfateRows },
  { label: EXAMPLES[2].label, name: 'trend-example-water-level.xlsx', header: ILLINOIS_HEADER, rows: illinoisRows },
];
