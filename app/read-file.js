// Reads CSV text or workbook sheets into rows, and turns date cells into times.
// No page code here, so the tests can run it directly.

export function parseDelimited(text) {
  const first = text.split(/\r?\n/).slice(0, 30).join('\n');
  const count = (c) => first.split(c).length;
  const delim = ['\t', ';', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map(coerce));
}

function coerce(v) {
  const s = String(v).trim();
  if (s === '') return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? parseFloat(s) : s;
}

// Every sheet with content, largest first. date1904 marks old Mac workbooks.
export function readWorkbook(buffer, XLSX) {
  const wb = XLSX.read(buffer, { cellDates: false });
  const date1904 = Boolean(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const sheets = wb.SheetNames
    .map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }), date1904 }))
    .filter((s) => s.rows.length >= 3);
  return sheets.sort((a, b) => b.rows.length - a.rows.length);
}

// Logger exports often start with lines of metadata. The header is the first row
// of labels with numbers beneath it.
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length - 2, 60); i++) {
    const labels = rows[i].filter((c) => typeof c === 'string' && /[a-z]/i.test(c)).length;
    if (labels < 2 || labels < rows[i].filter((c) => c !== null).length * 0.7) continue;
    const below = rows.slice(i + 1, i + 6);
    const width = rows[i].filter((c) => c !== null).length;
    if (below.some((r) => r.filter((c) => c !== null).length > width)) continue;
    const numeric = below.filter((r) => r.filter((c) => typeof c === 'number').length >= 1).length;
    if (numeric >= Math.min(3, below.length)) return i;
  }
  return 0;
}

// Splits rows into a header and same-width data rows.
export function tidyTable(rows) {
  const headerRow = findHeader(rows);
  const header = Array.from(rows[headerRow], (h) => (h === null || h === undefined ? '' : String(h).trim()));
  const width = header.length;
  const data = rows.slice(headerRow + 1).filter((r) => r.some((c) => c !== null && c !== undefined)).map((r) => {
    const out = Array.from(r.slice(0, width), (c) => (c === undefined ? null : c));
    while (out.length < width) out.push(null);
    return out;
  });
  return { header, rows: data, skipped: headerRow };
}

const EXCEL_UNIX_DAYS = 25569;
const DATE1904_DAYS = 1462;

// An hour on the 24-hour clock, from one that may carry AM or PM.
function hour24(h, ampm) {
  if (!ampm) return h;
  const pm = /p/i.test(ampm);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

export function parseStamp(v, dayFirst, date1904) {
  if (typeof v === 'number') {
    const serial = date1904 ? v + DATE1904_DAYS : v;
    return serial > 20000 && serial < 80000 ? Math.round((serial - EXCEL_UNIX_DAYS) * 864e5 / 1000) * 1000 : NaN;
  }
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);
  if (!m) return NaN;
  let y = +m[3]; if (y < 100) y += 2000;
  const [day, month] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
  return Date.UTC(y, month - 1, day, hour24(+(m[4] || 0), m[7]), +(m[5] || 0), +(m[6] || 0));
}

export function timeFraction(v) {
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 86400) * 1000 : NaN;
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return NaN;
  return (hour24(+m[1], m[4]) * 3600 + +m[2] * 60 + +(m[3] || 0)) * 1000;
}

// True for 31/12/2026, false for 12/31/2026, and null when every date could be either.
export function detectDayFirst(values) {
  let either = false;
  for (const v of values) {
    const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (m && +m[1] > 12) return true;
    if (m && +m[2] > 12) return false;
    if (m) either = true;
  }
  return either ? null : false;
}
