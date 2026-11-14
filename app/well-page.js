// What the well record and pumping test pages share beyond ui.js: the columns chosen,
// the checks on the fields both forms have, the result panels and the downloads.
import { picture } from './charts.js';
import { columnValues } from './kit.js';
import { parseStamp, timeFraction } from './read-file.js';
import { $, XLSX_TYPE, baseName, numberIn, saveFile, state } from './ui.js';

/** The columns chosen in the form, -1 for none. */
export const chosenColumns = () => ({ time: +$('colTime').value, time2: +$('colTime2').value, level: +$('colLevel').value, baro: +$('colBaro').value });

/** The numbers in one column of the loaded table, NaN where a cell isn't a number. */
export const column = (i) => columnValues(state.table, i);

/** Each row's date and time as ms, with the time of day from a second column when one is chosen. */
export function stampTimes(col, dayFirst) {
  const date1904 = state.sheet && state.sheet.date1904;
  return state.table.rows.map((r) => {
    const d = parseStamp(r[col.time], dayFirst, date1904);
    return col.time2 >= 0 ? d + timeFraction(r[col.time2]) : d;
  });
}

// Entries that can't be right, named by their field. Each returns the problem, or ''.
export function efficiencyProblem() {
  const userBE = numberIn('userBE');
  return userBE !== undefined && (userBE < 0 || userBE > 1) ? 'Your barometric efficiency must be between 0 and 1.' : '';
}

export function siteProblem() {
  const lat = numberIn('lat'), lon = numberIn('lon'), utc = numberIn('utcOffset');
  if (lat !== undefined && Math.abs(lat) > 90) return 'Well latitude must be between −90 and 90 degrees.';
  if (lon !== undefined && Math.abs(lon) > 180) return 'Well longitude must be between −180 and 180 degrees.';
  if (utc !== undefined && Math.abs(utc) > 14) return 'The file clock must be between −14 and +14 hours from UTC.';
  return '';
}

/** A tool's result panels, by id. */
export function resultPanels(ids) {
  const hide = () => ids.forEach((id) => { $(id).hidden = true; });
  return {
    hide,
    show() {
      delete document.body.dataset.stale;
      ids.forEach((id) => { $(id).hidden = false; });
    },
    // A run that can't go ahead says why next to the Run button, and takes down the
    // results of the last run, which no longer match the form.
    fail(msg) {
      hide();
      $('runError').textContent = msg;
      $('runError').hidden = false;
    },
  };
}

/** Chart hosts by key, from element ids that end in the key: chart-level, chart-p-level. */
export const chartHosts = (keys, prefix) => Object.fromEntries(keys.map((k) => [k, $(`${prefix}${k}`)]));

/** Writes rows of text into a table's body. */
export function fillBody(table, rows) {
  const body = table.tBodies[0];
  body.textContent = '';
  rows.forEach((row) => {
    const tr = body.insertRow();
    row.forEach((v) => { tr.insertCell().textContent = String(v); });
  });
}

/** The charts as pictures for the workbook, in the order given. */
export async function chartImages(r, keys, definitionsOf) {
  const images = [];
  for (const key of keys) {
    const p = await picture(r, key, $('exportStage'), definitionsOf);
    images.push({ buffer: await p.blob.arrayBuffer(), width: p.width, height: p.height });
  }
  return images;
}

/**
 * The spreadsheet button: build() gives the workbook, saved as name_suffix.xlsx. The
 * status beside the button says how it went.
 */
export function wireWorkbook(buttonId, statusId, suffix, build) {
  const btn = $(buttonId), status = $(statusId);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Building the spreadsheet';
    try {
      saveFile(`${baseName()}_${suffix}.xlsx`, new Blob([await build()], { type: XLSX_TYPE }));
      status.textContent = 'Spreadsheet saved.';
    } catch (e) {
      status.textContent = `The spreadsheet could not be built. ${e.message}`;
    }
    btn.disabled = false;
  });
}

/** The Save chart buttons, marked data-<attr>="key", each saving its chart as a PNG. */
export function wireCharts(attr, statusId, definitionsOf) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', async () => {
    const key = b.getAttribute(`data-${attr}`);
    const p = await picture(state.result, key, $('exportStage'), definitionsOf);
    saveFile(`${baseName()}_${key}.png`, p.blob);
    $(statusId).textContent = 'Chart saved.';
  }));
}
