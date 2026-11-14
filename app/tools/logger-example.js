// Invented records for the logger tool, with a known answer. A non-vented logger
// hangs 15.250 m below the top of casing (elevation 312.400 m) in water at 10 °C.
// The water column rises 0.150 m over ten days with a small daily swing, and the
// sensor drifts upward by 1.2 mm a day. The barologger reads hourly and starts an
// hour after the logger and stops an hour before it, so those rows have no
// barometer. Between its hourly readings the invented air pressure runs in straight
// lines, so interpolating it is exact. No page code, so the tests can use it.
import { G, kellDensity } from '../../engine/logger.js';
import { DAY, HOUR } from '../../engine/numeric.js';

const START = Date.UTC(2026, 7, 3, 8, 0, 0);
export const EXAMPLE_TRUTH = {
  sensorDepth: 15.25, mpElevation: 312.4, tempC: 10, driftPerDay: 0.0012,
  readings: ['2026-08-03 10:00', '2026-08-08 10:00', '2026-08-13 06:00'],
};

const days = (t) => (t - START) / DAY;
export const trueColumn = (t) => 4 + 0.15 * days(t) / 10 + 0.02 * Math.sin(2 * Math.PI * days(t));
export const trueDepth = (t) => EXAMPLE_TRUTH.sensorDepth - trueColumn(t);
const drift = (t) => EXAMPLE_TRUTH.driftPerDay * days(t);
const airKPa = (t) => 101.3 + 0.6 * Math.sin(2 * Math.PI * days(t) / 3.1) + 0.12 * Math.sin(2 * Math.PI * days(t));
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const pad = (n) => String(n).padStart(2, '0');
const dateOf = (t) => new Date(t).toISOString().slice(0, 10);
const timeOf = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
};

function baroRows() {
  const rows = [];
  for (let t = START + HOUR; t <= START + 10 * DAY - HOUR; t += HOUR) rows.push([dateOf(t), timeOf(t), round(airKPa(t), 3)]);
  return rows;
}

// The barometer as the barologger recorded it, in straight lines between readings.
function airAt(rows, t) {
  const i = Math.floor((t - START - HOUR) / HOUR);
  if (i < 0 || i >= rows.length) return NaN;
  if (i === rows.length - 1) return rows[i][2];
  return rows[i][2] + (rows[i + 1][2] - rows[i][2]) * ((t - START - HOUR) / HOUR - i);
}

export function exampleRecords() {
  const baro = baroRows();
  const rho = kellDensity(EXAMPLE_TRUTH.tempC);
  const logger = [];
  for (let t = START; t <= START + 10 * DAY; t += 15 * 60e3) {
    const air = airAt(baro, t), base = Number.isFinite(air) ? air : airKPa(t);
    const kPa = base + (trueColumn(t) + drift(t)) * rho * G / 1000;
    logger.push([dateOf(t), timeOf(t), round(kPa, 3), round(10 + 0.05 * Math.sin(2 * Math.PI * days(t)), 2)]);
  }
  const readings = EXAMPLE_TRUTH.readings.map((when) => {
    const [d, h] = when.split(' ');
    const t = Date.parse(`${d}T${h}:00Z`);
    return { when, depth: round(trueDepth(t), 3) };
  });
  return {
    logger: { name: 'invented-logger.csv', header: ['Date', 'Time', 'Pressure (kPa)', 'Temperature (°C)'], rows: logger },
    baro: { name: 'invented-barologger.csv', header: ['Date', 'Time', 'Barometric pressure (kPa)'], rows: baro },
    readings,
  };
}
