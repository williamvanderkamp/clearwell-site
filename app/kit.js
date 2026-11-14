// Shared parts for the tools in src/app/tools/: reading a file, a form with required
// and optional fields, charts, tables, method text and a workbook download. Each tool
// builds its own page from these, so every tool looks and behaves the same way.
import { TIME_NAMES } from '../engine/index.js';
import { corrText, countOf, fixed, listed, minus, sig, six, tenTo, toCsv, together, unit } from '../engine/format.js';
import { parseDelimited, readWorkbook, tidyTable } from './read-file.js';
import { renderMethod, renderNotes, saveFile, state, XLSX_TYPE } from './ui.js';

export { corrText, countOf, fixed, listed, minus, sig, six, tenTo, toCsv, together, unit };

/** el('p', { class: 'hint' }, 'text', child) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.flat().filter((c) => c !== undefined && c !== null && c !== false));
  return e;
}

export const panel = (...children) => el('section', { class: 'panel' }, ...children);

/** An error message, as every tool shows one. */
export const errorBox = (message) => el('div', { class: 'error', role: 'alert' }, message);

// Results on the page are out of date once the data or an input changes, until the next
// run: they are dimmed, and the browser test's done flag is cleared.
const markStale = (host) => {
  if (host.dataset.done) { delete host.dataset.done; host.dataset.stale = '1'; }
};

const UNREADABLE = 'It could not be opened as a spreadsheet. If it opens in Excel, save it again there, or save it as CSV.';

export async function readFile(file) {
  const isText = /\.(csv|tsv|txt|dat)$/i.test(file.name);
  let sheets;
  try {
    sheets = isText ? [{ name: file.name, rows: parseDelimited(await file.text()) }] : readWorkbook(await file.arrayBuffer(), window.XLSX);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!sheets.length) throw new Error(UNREADABLE);
  if (sheets[0].rows.length < 2) throw new Error('It has no rows of data under a heading row.');
  return { name: file.name, table: tidyTable(sheets[0].rows) };
}

/**
 * A drop zone with a file chooser and example buttons. onTable({ name, table }) gets
 * { header, rows }. examples: [{ label, name, csv }]. A file dropped anywhere on the
 * page comes here too. A file that cannot be read is reported directly under the drop
 * zone, where the user is looking, and whatever was loaded before stays in use.
 * Returns { status(...parts) }, which writes the line under the drop zone that says what
 * is loaded: "name.csv: 78 rows." and for an example its note. Parts are text or
 * elements, such as a bold word; with none, or only empty ones, the line is hidden.
 */
export function fileDrop(host, { text, examples = [], onTable }) {
  const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.dat,.xlsx,.xls,.xlsm', hidden: true });
  let buttons = [], before = false;
  const problem = errorBox('');
  problem.hidden = true;
  const line = el('p', { class: 'hint loaded', role: 'status', hidden: true });
  const loaded = (chosen) => {
    before = true;
    problem.hidden = true;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === chosen)));
    const spec = host.querySelector('details.spec');
    if (spec) spec.open = false;
    markStale(host);
  };
  const useExample = (x, i) => {
    loaded(i);
    onTable({ name: x.name, table: tidyTable(parseDelimited(x.csv)), example: x });
  };
  // Only a file that reads makes the old results stale; a failed one leaves the page as it was.
  const take = async (file) => {
    let read;
    try {
      read = await readFile(file);
    } catch (e) {
      problem.textContent = `${file.name} could not be read. ${e.message}${before ? ' The data loaded before it is still the data in use.' : ''}`;
      problem.hidden = false;
      return;
    }
    loaded(-1);
    onTable(read);
  };
  input.addEventListener('change', () => { if (input.files[0]) take(input.files[0]); input.value = ''; });
  state.extraDrop = take;
  host.append(el('section', { class: 'drop' },
    el('div', { class: 'strata', 'aria-hidden': 'true' }),
    el('div', {}, el('strong', {}, 'Drop a file anywhere on this page'), el('span', {}, text)),
    el('div', { class: 'drop-actions' }, input,
      el('button', { class: 'btn', type: 'button', onclick: () => input.click() }, 'Choose a file'),
      buttons = examples.map((x, i) => el('button', {
        class: 'btn quiet', type: 'button', 'data-example': String(i), 'aria-pressed': 'false', onclick: () => useExample(x, i),
      }, x.label)))),
    problem, line);
  return {
    status(...parts) {
      line.replaceChildren(...parts.filter((p) => p !== undefined && p !== null && p !== ''));
      line.hidden = !line.textContent;
    },
  };
}

/**
 * The columns a tool needs, as on the first two tools. columns: [{ name, need, what, headings }].
 * examples: [{ label, name, header, rows }] become .xlsx downloads built in the browser.
 */
export function columnSpec(host, { columns, notes = [], examples = [] }) {
  const row = (c) => el('tr', {},
    el('td', {}, c.name),
    el('td', { class: c.need === 'Required' ? 'need-yes' : 'need-no' }, c.need),
    el('td', {}, c.what),
    el('td', {}, (c.headings || []).map((h) => el('code', {}, h))));
  const download = (x) => el('button', {
    class: 'btn quiet', type: 'button', onclick: () => downloadWorkbook(x.name, [{ name: 'Data', header: x.header, rows: x.rows }]),
  }, x.label);
  host.append(el('details', { class: 'panel spec', open: true },
    el('summary', {}, 'What your spreadsheet needs'),
    el('div', { class: 'tablewrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Column', 'Needed', 'What goes in it', 'Heading to use'].map((h) => el('th', {}, h)))),
      el('tbody', {}, columns.map(row)))),
    notes.length ? el('ul', { class: 'notes' }, notes.map((n) => el('li', {}, n))) : null,
    examples.length ? el('div', { class: 'spec-examples' }, el('strong', {}, 'Download an example to copy'),
      el('span', { class: 'spec-buttons' }, examples.map(download))) : null));
}

// The whole entry must be a number: 250abc is not read as 250.
const numberOf = (v) => { const x = v === '' ? NaN : Number(v); return Number.isFinite(x) ? x : undefined; };

/**
 * A form split into Required and Optional, as on the first two tools. Nothing is
 * filled in that the user or the file did not give.
 * fields: [{ id, label, type: 'number'|'text'|'textarea'|'select'|'column', options?: [[value, label]],
 *   required?: boolean | (values) => boolean, hint?, placeholder?, show?: (values) => boolean }]
 * Missing fields are marked only once a file, an example or the user has filled
 * something in, so a fresh page does not open full of warnings. When an input
 * changes after a run, the old results are dimmed until the next run.
 * Returns { values(), set(id, value), reset(), setColumns(header), check() }. values()
 * has each field's value, undefined where it is blank or its show() hides it.
 */
export function form(host, { fields, onRun, runLabel = 'Run' }) {
  const inputs = {}, boxes = {};
  let started = false;
  const req = el('div', { class: 'fields' }), opt = el('div', { class: 'fields' });
  const needed = el('p', { class: 'needed', role: 'status' });
  const run = el('button', { class: 'btn', type: 'button', onclick: () => {
    started = true;
    if (!check()) return;
    delete host.dataset.stale;
    onRun(values());
  } }, runLabel);
  for (const f of fields) {
    const id = `x-${f.id}`;
    let input;
    if (f.type === 'select' || f.type === 'column') {
      input = el('select', { id },
        el('option', { value: '' }, f.type === 'column' ? 'Choose a column' : 'Choose'),
        (f.options || []).map(([v, l]) => el('option', { value: v }, l)));
    } else if (f.type === 'textarea') {
      input = el('textarea', { id, rows: f.rows || 3, spellcheck: 'false', placeholder: f.placeholder });
    } else {
      input = el('input', { id, inputmode: f.type === 'number' ? 'decimal' : undefined, placeholder: f.placeholder });
    }
    inputs[f.id] = input;
    boxes[f.id] = el('div', { class: 'field' }, el('label', { for: id }, f.label), input, f.hint ? el('span', { class: 'hint' }, f.hint) : null);
    (f.required === false || f.required === undefined ? opt : req).append(boxes[f.id]);
  }
  // What every field holds, shown or not. Whether a field shows is worked out from this.
  const held = () => Object.fromEntries(fields.map((f) => {
    const v = inputs[f.id].value.trim();
    if (f.type === 'number') return [f.id, numberOf(v)];
    if (f.type === 'column') return [f.id, v === '' ? undefined : +v];
    return [f.id, v === '' ? undefined : v];
  }));
  const showing = (f, v) => (f.show ? f.show(v) : true);
  // A hidden field keeps what was typed in it, for when it shows again, but is not used.
  const values = () => {
    const v = held();
    return Object.fromEntries(fields.map((f) => [f.id, showing(f, v) ? v[f.id] : undefined]));
  };
  function check() {
    const v = held(), missing = [], notNumbers = [];
    for (const f of fields) {
      const shown = showing(f, v);
      boxes[f.id].hidden = !shown;
      const need = typeof f.required === 'function' ? f.required(v) : f.required;
      const typed = inputs[f.id].value.trim() !== '';
      const bad = shown && f.type === 'number' && typed && v[f.id] === undefined;
      const empty = !typed && v[f.id] === undefined;
      boxes[f.id].classList.toggle('missing', started && (bad || Boolean(shown && need && empty)));
      if (bad) notNumbers.push(f.label);
      else if (shown && need && empty) missing.push(f.label);
    }
    const say = [];
    if (missing.length) say.push(`Still needed: ${missing.join('; ')}.`);
    if (notNumbers.length) say.push(`Not a number: ${notNumbers.join('; ')}.`);
    needed.textContent = started ? say.join(' ') : '';
    run.disabled = missing.length + notNumbers.length > 0;
    return !run.disabled;
  }
  // Only the user's own edits come through these events; set() from code does not fire them.
  const edited = () => {
    started = true;
    markStale(host);
    check();
  };
  const box = el('section', { class: 'panel form-panel', oninput: edited, onchange: edited },
    el('div', { class: 'group' }, el('h3', {}, 'Required'), req),
    opt.childElementCount ? el('div', { class: 'group' }, el('h3', {}, 'Optional'), el('p', { class: 'hint' }, 'Leave these blank to skip them.'), opt) : null,
    el('div', { class: 'setup-foot' }, el('span'), el('div', { class: 'run' }, run, needed)));
  host.append(box);
  check();
  return {
    values, check, element: box,
    set(id, value) {
      inputs[id].value = value === undefined || value === null ? '' : String(value);
      if (inputs[id].value !== '') started = true;
      check();
    },
    /**
     * Empties every field, so nothing from an earlier file or example carries over.
     * quiet: also hides the warnings again, as on a page that has just opened.
     */
    reset({ quiet = false } = {}) {
      for (const input of Object.values(inputs)) input.value = '';
      if (quiet) started = false;
      check();
    },
    setColumns(header) {
      for (const f of fields.filter((x) => x.type === 'column')) {
        const sel = inputs[f.id];
        sel.textContent = '';
        sel.add(new Option(f.required ? 'Choose a column' : 'None', ''));
        header.forEach((name, i) => sel.add(new Option(name || `Column ${i + 1}`, String(i))));
      }
      started = true;
      check();
    },
  };
}

/** Select options: [u, u] for each unit in a list, or [u, name] from a { unit: name } map. */
export const unitOptions = (units) => (Array.isArray(units) ? units.map((u) => [u, unit(u)]) : Object.entries(units));
export const TIME_OPTIONS = unitOptions(TIME_NAMES);

/** Index of the first heading matching rx, or undefined. Only for headings that say what they hold. */
export const findColumn = (header, rx) => { const i = header.findIndex((h) => rx.test(String(h))); return i < 0 ? undefined : i; };

/** The numbers in one column, NaN where a cell isn't a number. */
export const columnValues = (table, i) => table.rows.map((r) => (typeof r[i] === 'number' ? r[i] : NaN));

// What counts as a number when a column is aligned: < 0.001 does, and so do words that
// stand in for a number, such as none or n/a.
const PLACEHOLDER = /^(n\/a|none|not found|reference|—|-)$/i;
const NUMERIC = /^[<>]?\s?[-+−]?[\d.,]+(\s?[×x]\s?10\S*)?(\s?%)?$/;
const numberLike = (v) => v === null || v === undefined || typeof v === 'number' || NUMERIC.test(String(v).trim()) || PLACEHOLDER.test(String(v).trim());

/**
 * How a column of numbers is written. Where its plain numbers are within two powers of
 * ten of each other, they share one count of decimal places, enough for 4 significant
 * figures in the smallest (1.581, 1.042, 0.5789). A column of whole numbers stays
 * whole. Otherwise, as in a table of different quantities, each number has 4
 * significant figures with its trailing zeros. Below 0.001 or from a million up,
 * numbers are written 1.940 × 10⁻⁴.
 */
function columnFormat(values) {
  const plain = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0 && Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6);
  const mags = plain.map((v) => Math.floor(Math.log10(Math.abs(v))));
  const whole = plain.every((v) => Number.isInteger(v));
  const shared = plain.length > 0 && Math.max(...mags) - Math.min(...mags) <= 2;
  const places = whole ? 0 : shared ? Math.max(0, Math.min(3 - Math.min(...mags), 7 - Math.max(...mags), 6)) : null;
  return (v) => {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return 'n/a';
    // Text such as "-0.25 to 0.51" gets a typeset minus before each negative number.
    // A non-breaking hyphen inside dates keeps 2024-01-01 from splitting across lines.
    if (typeof v !== 'number') return String(v).replace(/(^|[\s(])-(?=\d|\.\d)/g, '$1−').replace(/(\d)-(?=\d)/g, '$1\u2011');
    const a = Math.abs(v);
    if (v !== 0 && (a < 1e-3 || a >= 1e6)) return sig(v, 4, true);
    if (places !== null) return minus(v.toFixed(places));
    return Number.isInteger(v) ? minus(String(v)) : sig(v, 4, true);
  };
}

/** One number as table() would write it on its own. */
export const cell = (v) => columnFormat([v])(v);

/**
 * Numbers are right aligned, each column written as columnFormat() says. A column
 * holding any text, such as a note, is left aligned in the body font and may wrap. A
 * two-column table of names and values keeps to a readable width, and writes each value
 * on its own, since each is a different quantity: 15 stays 15 beside a 0.0501.
 */
export function table(header, rows) {
  const pairs = header.length === 2;
  const formats = header.map((_, i) => (pairs ? cell : columnFormat(rows.map((r) => r[i]))));
  const textColumn = header.map((_, i) => i > 0 && rows.some((r) => !numberLike(r[i])));
  return el('div', { class: 'tablewrap' }, el('table', { class: pairs ? 'pairs' : header.length > 7 ? 'many' : undefined },
    el('thead', {}, el('tr', {}, header.map((h, i) => el('th', { class: textColumn[i] ? 'text' : undefined }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v, i) => el('td', { class: textColumn[i] ? 'text' : undefined }, formats[i](v))))))));
}

export function notes(list) {
  const ul = el('ul', { class: 'notes' });
  renderNotes(ul, list);
  return ul;
}

export function method(text) {
  const host = el('div');
  renderMethod(host, text);
  return host;
}

/** The panel of method text every tool ends with; before goes between its heading and the text. */
export const methodPanel = (text, ...before) => panel(el('h2', {}, 'Exactly what was done'), ...before, method(text));

/** The button that saves a result's workbook, and any extra buttons after it. */
export const downloads = (onclick, ...extra) => el('div', { class: 'downloads' }, el('button', { class: 'btn', type: 'button', onclick }, 'Download spreadsheet'), ...extra);

// Blue, orange, green, purple, amber, grey: no two warm colours next to each other.
const palette = () => {
  const css = getComputedStyle(document.documentElement);
  return ['--series-corrected', '--series-baro', '--series-tide', '--series-user', '--series-constant', '--series-raw'].map((k) => css.getPropertyValue(k).trim());
};
// After the six colours run out, lines repeat them dashed.
const DASHES = [undefined, [8, 5], [2, 4]];

// Tick labels: plain numbers in the middle range, powers of ten outside it, so a log
// axis shows 10⁻⁴ instead of rounding it to 0. Written as sig() writes them: real minus
// signs, and 2 × 10⁻⁴ with spaces.
const tick = (v) => {
  if (v === null || v === undefined) return '';
  const a = Math.abs(v);
  if (v === 0 || (a >= 1e-3 && a < 1e5)) return minus(String(Number(v.toPrecision(6))));
  const e = Math.floor(Math.log10(a)), m = Number((v / 10 ** e).toPrecision(3));
  return minus(m === 1 ? tenTo(e) : `${m}\u00a0×\u00a0${tenTo(e)}`);
};

// A log axis spans the data with a margin, not whole powers of ten, so points between
// 0.14 and 0.23 are not squeezed into the bottom of a 0.1 to 1 axis. Its ends snap
// outward to 1, 2, 3 or 5 times a power of ten, so they read as round values.
const STEPS = [1, 2, 3, 5, 10];
const snap = (v, up) => {
  const e = Math.floor(Math.log10(v)), m = v / 10 ** e;
  const k = up ? STEPS.find((x) => x >= m * (1 - 1e-9)) : [...STEPS].reverse().find((x) => x <= m * (1 + 1e-9));
  return Number((k * 10 ** e).toPrecision(6));
};
const logRange = (u, min, max) => (min > 0 && max > 0 ? [snap(min, false), snap(max, true)] : [min, max]);

// Ticks on a log axis at 1, 2, 3 and 5 times each power of ten, thinned to 1, 2 and 5,
// then fewer, until each label has about 64 px on a horizontal axis or 28 px on a
// vertical one. So a short axis still has several labels, and none run together.
const logSplits = (u, axis, min, max) => {
  const length = axis === 0 ? u.width : u.height, room = Math.max(2, Math.floor(length / (axis === 0 ? 64 : 28)));
  const ticks = (mults, every = 1) => {
    const out = [];
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
      if (e % every !== 0) continue;
      for (const m of mults) {
        const v = Number((m * 10 ** e).toPrecision(6));
        if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
      }
    }
    return out;
  };
  for (const [mults, every] of [[[1, 2, 3, 5], 1], [[1, 2, 5], 1], [[1, 3], 1], [[1], 1], [[1], 2], [[1], 3]]) {
    const out = ticks(mults, every);
    if (out.length <= room && out.length >= 2) return out;
  }
  return ticks([1], 1);
};
// uPlot labels only some log ticks by default; these splits are already spaced to fit.
const showAll = (u, splits) => splits;
// A point series with many readings is drawn as small plain dots, since rings would
// break the line under it into dashes.
const dense = (s) => s.x.length > 60;

// Charts on the page, redrawn in the new colours when the system turns dark or light.
const charts = new Set();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  for (const c of charts) if (c.host.isConnected) c.draw(); else charts.delete(c);
});

/**
 * A chart. series: [{ label, x: [], y: [], line?: true, points?: false, size? }]. Each
 * series keeps its own x values. logX/logY for log axes. Point series are drawn after
 * the lines, larger and ringed, so the readings a result rests on are not hidden.
 */
export function chart({ title, series: given, xLabel, yLabel, logX, logY, invertY, height = 320 }) {
  const host = el('div', { class: 'chart' });
  const box = el('div', { class: 'stack' }, el('h3', {}, title), host);
  const series = [...given.filter((s) => s.line !== false), ...given.filter((s) => s.line === false)];
  const ok = (v, log) => Number.isFinite(v) && (!log || v > 0);
  const xs = [...new Set(series.flatMap((s) => s.x.filter((v) => ok(v, logX))))].sort((a, b) => a - b);
  const at = new Map(xs.map((x, i) => [x, i]));
  const data = [xs, ...series.map((s) => {
    const y = new Array(xs.length).fill(null);
    s.x.forEach((x, i) => { if (at.has(x) && ok(s.y[i], logY)) y[at.get(x)] = s.y[i]; });
    return y;
  })];
  // Colours follow the order the tool gave, whatever order they are drawn in.
  const slot = (s) => given.indexOf(s);
  const options = () => {
    const colors = palette(), css = getComputedStyle(document.documentElement);
    const axis = css.getPropertyValue('--ink-2').trim(), grid = css.getPropertyValue('--rule').trim(), ring = css.getPropertyValue('--panel').trim();
    const look = { stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, values: (u, splits) => splits.map(tick) };
    const logAxis = { splits: logSplits, filter: showAll };
    return {
      height, width: Math.max(260, host.clientWidth || 600),
      scales: {
        x: { time: false, distr: logX ? 3 : 1, range: logX ? logRange : undefined },
        y: { distr: logY ? 3 : 1, dir: invertY ? -1 : 1, range: logY ? logRange : undefined },
      },
      legend: { live: false },
      series: [{ label: xLabel }, ...series.map((s) => {
        const i = slot(s), stroke = colors[i % colors.length];
        if (s.line !== false) {
          return { label: s.label, stroke, width: 2, dash: DASHES[Math.floor(i / colors.length) % DASHES.length], spanGaps: true, points: { show: s.points === true } };
        }
        const points = dense(s)
          ? { show: true, size: Math.min(s.size || 4, 5), width: 0, stroke, fill: stroke }
          : { show: true, size: s.size || 8, width: 1.5, stroke: ring, fill: stroke };
        return { label: s.label, stroke, fill: stroke, width: 0, paths: () => null, points };
      })],
      axes: [
        { ...look, label: xLabel, labelSize: 22, ...(logX ? logAxis : {}) },
        { ...look, label: yLabel, size: 70, labelSize: 22, ...(logY ? logAxis : {}) },
      ],
    };
  };
  let u = null;
  const entry = {
    host,
    draw() {
      if (u) u.destroy();
      u = new window.uPlot(options(), data, host);
    },
  };
  requestAnimationFrame(() => {
    entry.draw();
    charts.add(entry);
    new ResizeObserver(() => { if (u) u.setSize({ width: Math.max(260, host.clientWidth), height }); }).observe(host);
  });
  return box;
}

// A date or date and time written as text (2024-01-01, 2024-01-01 10:00) is saved as a
// real Excel date, so it sorts and plots as one. Times are as the file gave them.
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const asCell = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = typeof v === 'string' ? DATE_TEXT.exec(v.trim()) : null;
  if (!m) return v;
  const [, y, mo, d, h = 0, mi = 0, s = 0] = m;
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), timed: m[4] !== undefined };
};

/**
 * sheets: [{ name, header, rows }]. text: optional method text, written first, with
 * its notes (text.notes, the caveats shown on the page) at the top, so the workbook
 * carries the same warnings as the page.
 */
export async function downloadWorkbook(fileName, sheets, text) {
  const wb = new window.ExcelJS.Workbook();
  if (text) {
    const ws = wb.addWorksheet('Method');
    ws.columns = [{ width: 50 }, { width: 70 }];
    if (text.notes && text.notes.length) {
      ws.addRow(['Notes on this result']).font = { bold: true };
      text.notes.forEach((n) => { ws.addRow([n]).alignment = { wrapText: true }; });
      ws.addRow([]);
    }
    text.steps.forEach((s, i) => {
      ws.addRow([`${i + 1}. ${s.title}`]).font = { bold: true };
      s.lines.forEach((l) => { ws.addRow([l]).alignment = { wrapText: true }; });
      if (s.formula) ws.addRow([s.formula]).font = { name: 'Courier New' };
      (s.numbers || []).forEach((n) => ws.addRow(n));
      ws.addRow([]);
    });
    ws.addRow(['References']).font = { bold: true };
    text.references.forEach((r) => ws.addRow([r]));
  }
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(s.header).font = { bold: true };
    s.rows.forEach((r) => {
      const cells = r.map(asCell);
      const row = ws.addRow(cells.map((c) => (c && c.date ? c.date : c)));
      cells.forEach((c, i) => { if (c && c.date) row.getCell(i + 1).numFmt = c.timed ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd'; });
    });
    s.header.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(12, String(h).length + 2); });
  }
  saveFile(fileName, new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }));
}

/** Marks a tool's results as shown, which the browser test waits for. */
export const done = (host) => { host.dataset.done = '1'; };
