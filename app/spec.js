// What each tool asks of a spreadsheet. The page's table, the example workbooks and a
// test all read this, so the headings shown are ones the page really recognises.
const UNIT_NOTE = 'Put a unit in the heading, in brackets, and the page reads it from there. Otherwise it asks.';

export const SPEC = {
  record: {
    columns: [
      { name: 'Date and time', need: 'Required', what: 'One reading per row, with the date and time together, such as 2026-06-29 14:30.', headings: ['Date and time'] },
      { name: 'Water level', need: 'Required', what: 'Elevation or height, depth to water, or absolute pressure at the sensor.', headings: ['Water elevation (m)', 'Depth to water (ft)', 'Absolute pressure (kPa)'] },
      { name: 'Barometric pressure', need: 'Required', what: 'Air pressure at or near the well, on the same row as the water level.', headings: ['Barometric pressure (hPa)'] },
    ],
    notes: [UNIT_NOTE, 'Keep the headings in the row above the first reading. Column order doesn\'t matter, and other columns are ignored and kept in your download.'],
    examples: [{ file: 'well-record-example.xlsx', label: 'Well record example' }],
  },
  pumping: {
    columns: [
      { name: 'Time', need: 'Required', what: 'Dates and times, or time since pumping began.', headings: ['Date and time', 'Time (min)', 'Time (hours)', 'Time (days)'] },
      { name: 'Water level', need: 'Required', what: 'Elevation or height, depth to water, drawdown, or absolute pressure at the sensor.', headings: ['Water elevation (m)', 'Depth to water (ft)', 'Drawdown (m)', 'Absolute pressure (kPa)'] },
      { name: 'Barometric pressure', need: 'Optional', what: 'Air pressure at or near the well. With at least a day of record before pumping, it lets the page remove barometric effects.', headings: ['Barometric pressure (hPa)'] },
    ],
    notes: [
      UNIT_NOTE,
      'Keep the headings in the row above the first reading. Column order doesn\'t matter, and other columns are ignored.',
      'Keep logging after the pump stops if you can. Those recovery readings are what give the recovery analysis and extended drawdown.',
      'A spreadsheet can\'t tell the page how the test was run, so you enter these on the next step: when pumping started and stopped, the pumping rate, and the distance from the pumped well.',
    ],
    examples: [
      { file: 'pumping-test-example.xlsx', label: 'Dates, barometer and recovery' },
      { file: 'pumping-test-minutes-example.xlsx', label: 'Elapsed minutes and drawdown only' },
    ],
  },
};

// Every heading the table offers, with what the page should take from it.
export const HEADING_MEANS = {
  'Date and time': { timeKind: 'date' },
  'Time (min)': { timeKind: 'min' },
  'Time (hours)': { timeKind: 'hour' },
  'Time (days)': { timeKind: 'day' },
  'Water elevation (m)': { levelKind: 'head', levelUnit: 'm' },
  'Depth to water (ft)': { levelKind: 'depth', levelUnit: 'ft' },
  'Drawdown (m)': { levelKind: 'drawdown', levelUnit: 'm' },
  'Absolute pressure (kPa)': { levelKind: 'absolute', levelUnit: 'kPa' },
  'Barometric pressure (hPa)': { baroUnit: 'hPa' },
};
