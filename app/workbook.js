// Builds the output workbook. Everything the page shows is in here too, so the file
// stands on its own when it is passed along.
const NEW_COLUMN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0F4' } };
const num = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

function newBook(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Clearwell';
  wb.created = new Date(0);
  return wb;
}

// The heading row, bold and wrapped.
function boldHead(ws) {
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'top' };
  return head;
}

// The heading row of a data sheet, with the columns Clearwell added shaded.
function dataHead(ws, original, added) {
  const head = boldHead(ws);
  for (let c = original.length + 2; c <= original.length + added.length + 2; c++) head.getCell(c).fill = NEW_COLUMN_FILL;
}

// The file's own columns, carried through, apart from the time columns.
function keptColumns(table, col) {
  const used = new Set([col.time, col.time2]);
  return table.header.map((_, i) => i).filter((i) => !used.has(i));
}

function methodSheet(wb, text, notes) {
  const ws = wb.addWorksheet('Method');
  ws.columns = [{ width: 52 }, { width: 70 }];
  const title = ws.addRow(['What Clearwell did to this file']);
  title.font = { bold: true, size: 14 };
  ws.addRow(['Steps are in the order they were applied. The numbers are the ones fitted to this file.']);
  ws.addRow([]);
  const wrap = (row) => { row.alignment = { wrapText: true, vertical: 'top' }; return row; };
  const wide = (value, font) => {
    const row = ws.addRow([value]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    row.height = Math.max(15, Math.ceil(String(value).length / 118 + (String(value).match(/\n/g) || []).length) * 15);
    if (font) row.font = font;
  };
  text.steps.forEach((s, i) => {
    ws.addRow([`${i + 1}. ${s.title}`]).font = { bold: true };
    s.lines.forEach((l) => wide(l));
    if (s.formula) wide(s.formula, { name: 'Courier New', size: 10 });
    s.numbers.forEach(([k, v]) => wrap(ws.addRow([k, v])));
    ws.addRow([]);
  });
  if (notes.length) {
    ws.addRow(['Notes on this file']).font = { bold: true };
    notes.forEach((n) => wide(n));
    ws.addRow([]);
  }
  ws.addRow(['References']).font = { bold: true };
  text.references.forEach((c) => wide(c));
}

function dataSheet(wb, r, table, col) {
  const ws = wb.addWorksheet('Corrected data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const u = r.method.levelUnit;
  const original = keptColumns(table, col);
  const added = [
    [`Raw level (${u})`, r.level],
    [`Barometric effect, standard (${u})`, r.standard.baroEffect],
    [`Earth tide effect (${u})`, r.standard.tideEffect],
    [`Corrected level, standard (${u})`, r.standard.corrected],
    [`Barometric effect, constant BE (${u})`, r.constant.effect],
    [`Corrected level, constant BE (${u})`, r.constant.corrected],
  ];
  if (r.user) {
    added.push([`Barometric effect, BE ${r.user.be} (${u})`, r.user.effect], [`Corrected level, BE ${r.user.be} (${u})`, r.user.corrected]);
  }
  if (r.standard.tideMicrogal) added.push(['Computed earth tide (µGal)', r.standard.tideMicrogal]);
  ws.columns = [
    { header: 'Date and time', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    ...original.map((i) => ({ header: table.header[i] || `Column ${i + 1}`, width: 16 })),
    ...added.map(([header]) => ({ header, width: 20 })),
    { header: 'Flags', width: 26 },
  ];
  for (let i = 0; i < r.t.length; i++) {
    const src = table.rows[r.srcRow[i]];
    ws.addRow([new Date(r.t[i]), ...original.map((c) => src[c]), ...added.map(([, a]) => num(a[i])), r.flags[i]]);
  }
  dataHead(ws, original, added);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: original.length + added.length + 2 } };
}

function responseSheet(wb, r) {
  const m = r.method;
  const ws = wb.addWorksheet('Barometric response', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Lag (hours)', width: 12 }, { header: 'Coefficient u(k)', width: 18 },
    { header: 'Running sum', width: 14 }, { header: 'Barometric efficiency by this lag', width: 22 }, { header: 'Loading efficiency by this lag', width: 22 },
  ];
  m.stepResponse.forEach((s) => ws.addRow([s.lagH, s.u, s.step, -s.step, 1 + s.step]));
  boldHead(ws);
  if (m.tide.used) {
    ws.getColumn(7).width = 12; ws.getColumn(8).width = 28;
    ws.getCell('G1').value = 'Lag (hours)'; ws.getCell('H1').value = 'Tide coefficient v(j), mm of water per µGal';
    ws.getCell('G1').font = { bold: true }; ws.getCell('H1').font = { bold: true };
    ws.getCell('H1').alignment = { wrapText: true, vertical: 'top' };
    m.tide.coefficients.forEach((c, i) => { ws.getCell(i + 2, 7).value = c.lagH; ws.getCell(i + 2, 8).value = c.c; });
  }
}

function chartsSheet(wb, chartImages) {
  const ws = wb.addWorksheet('Charts');
  let top = 0;
  for (const chart of chartImages) {
    const width = 960, height = Math.round(chart.height * width / chart.width);
    ws.addImage(wb.addImage({ buffer: chart.buffer, extension: 'png' }), { tl: { col: 0, row: top }, ext: { width, height } });
    top += Math.ceil(height / 20) + 2;
  }
}

function pumpingDataSheet(wb, r, table, col) {
  const ws = wb.addWorksheet('Test data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const m = r.method, lu = m.levelUnit, u = m.lengthUnit;
  const original = keptColumns(table, col);
  const added = [
    ['Minutes since pumping began', r.elapsedMin],
    [`Raw level (${lu})`, r.level],
    ...(r.baroEffect ? [[`Barometric effect (${lu})`, r.baroEffect]] : []),
    ...(r.tideEffect ? [[`Earth tide effect (${lu})`, r.tideEffect]] : []),
    [`Level used (${lu})`, r.cleanLevel],
    // With nothing removed, raw and corrected drawdown are the same, so there is one column.
    ...(r.rawAnalysis ? [[`Drawdown, raw (${u})`, r.rawDrawdown], [`Drawdown, corrected (${u})`, r.drawdown]] : [[`Drawdown (${u})`, r.drawdown]]),
  ];
  ws.columns = [
    { header: 'Time', width: 18, style: m.elapsed ? {} : { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
    ...original.map((i) => ({ header: table.header[i] || `Column ${i + 1}`, width: 16 })),
    ...added.map(([header]) => ({ header, width: 18 })),
    { header: 'Flags', width: 26 },
  ];
  for (let i = 0; i < r.t.length; i++) {
    const src = table.rows[r.srcRow[i]];
    ws.addRow([m.elapsed ? src[col.time] : new Date(r.t[i]), ...original.map((c) => src[c]), ...added.map(([, a]) => num(a[i])), r.flags[i]]);
  }
  dataHead(ws, original, added);
}

function tableSheet(wb, name, header, rows, width = 18) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = header.map((h) => ({ header: h, width }));
  rows.forEach((row) => ws.addRow(row.map((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))));
  boldHead(ws);
}

/**
 * sheets: { results: { header, rows }, curves: { header, rows } }, tables already in
 * the units shown on the page. Everything else comes from pumpingTest().
 */
export async function buildPumpingWorkbook(ExcelJS, r, text, sheets, table, col, chartImages) {
  const wb = newBook(ExcelJS);
  methodSheet(wb, text, r.warnings);
  tableSheet(wb, 'Results', sheets.results.header, sheets.results.rows, 24);
  pumpingDataSheet(wb, r, table, col);
  tableSheet(wb, 'Log-time curves', sheets.curves.header, sheets.curves.rows);
  chartsSheet(wb, chartImages);
  return wb.xlsx.writeBuffer();
}

/**
 * ExcelJS: the library
 * r: result from correct(); text: from describe()
 * table: { header, rows }; col: { time, time2, ... }
 * chartImages: [{ buffer, width, height }]
 */
export async function buildWorkbook(ExcelJS, r, text, table, col, chartImages) {
  const wb = newBook(ExcelJS);
  methodSheet(wb, text, r.warnings);
  dataSheet(wb, r, table, col);
  responseSheet(wb, r);
  chartsSheet(wb, chartImages);
  return wb.xlsx.writeBuffer();
}

