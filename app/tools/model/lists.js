// The boundary and observation lists under the map, for the period chosen: each entry's
// cell and values, which can be typed over, and a button to remove it.
import { el, sig, together } from '../../kit.js';
import { cellName, dropOwnList, evtArraysText, listIn, ownList, PACKAGE_IDS, PACKAGES, removeEntries, sourcePeriod } from './edit-model.js';
import { num } from './common.js';

/** The lists, in page.listHost; offers page.renderLists, renderListsNow and resetLists. */
export function mountLists(page) {
  const { view, notNumbers, blanks } = page;
  let listTimer = null;
  function renderLists() {
    clearTimeout(listTimer);
    listTimer = setTimeout(renderListsNow, 120);
  }
  page.signal.addEventListener('abort', () => clearTimeout(listTimer));
  // The names of list values typed in the lists: a rebuilt list shows the model's values
  // again, so what was typed there and not taken is no longer pending.
  const listKeys = new Set();
  function renderListsNow() {
    const { model, map, listHost } = page;
    listHost.textContent = '';
    let dropped = false;
    for (const k of listKeys) dropped = notNumbers.delete(k) || blanks.delete(k) || dropped;
    listKeys.clear();
    if (dropped) page.scheduleChecks();
    if (!model) return;
    const p = view.period;
    const blocks = [];
    for (const id of PACKAGE_IDS) {
      if (!model[id]) continue;
      const list = listIn(model, id, p);
      const from = sourcePeriod(model[id], p);
      const def = PACKAGES[id];
      const head = el('div', { class: 'chart-head' });
      let note;
      if (from === p) {
        note = el('p', { class: 'hint' }, `Period ${p + 1} has its own list, which stands until a later period gives another.`);
        if (p > 0) head.append(el('button', { class: 'btn quiet small', type: 'button', onclick: () => { dropOwnList(page.model, id, p); page.edited(); map.redraw(); } }, `Use the list in force before period ${p + 1}`));
      } else if (from >= 0) note = el('p', { class: 'hint' }, `Period ${p + 1} uses the list from period ${from + 1}. A change here gives period ${p + 1} its own copy.`);
      else note = el('p', { class: 'hint' }, `None before period ${from < 0 ? Object.keys(model[id]).map((x) => Number(x) + 1).sort((a, b) => a - b)[0] : p + 1}.`);
      const shown = list.slice(0, 100);
      const rows = shown.map((e, i) => el('tr', {},
        el('td', {}, String(e[0] + 1)), el('td', {}, String(e[1] + 1)), el('td', {}, String(e[2] + 1)),
        def.values.map(([key, label], v) => {
          const input = el('input', { inputmode: 'decimal', value: String(e[3 + v]), 'aria-label': `${def.label} ${i + 1}, ${label.toLowerCase()}` });
          const name = `${def.label} ${i + 1} ${label.toLowerCase()} in period ${p + 1}`;
          listKeys.add(name);
          input.addEventListener('input', () => {
            const x = num(input.value);
            // A blank value is still needed; only something typed that is not a number is "not a number".
            if (x === undefined || Number.isNaN(x)) { (x === undefined ? blanks : notNumbers).set(name, true); (x === undefined ? notNumbers : blanks).delete(name); input.classList.add('bad'); page.edited(false); return; }
            notNumbers.delete(name); blanks.delete(name); input.classList.remove('bad');
            ownList(page.model, id, p)[i][3 + v] = x;
            page.edited(false);
            map.redraw();
          });
          return el('td', {}, input);
        }),
        el('td', {}, el('button', { class: 'btn quiet small', type: 'button', 'aria-label': `Remove ${def.label.toLowerCase()} ${i + 1} (${cellName(e[0], e[1], e[2])}) in period ${p + 1}`, onclick: () => { removeEntries(page.model, id, p, [[e[0], e[1], e[2]]]); page.edited(); map.redraw(); } }, 'Remove'))));
      // A long list is folded, so the results are not pushed far down the page.
      blocks.push(el('details', { class: 'model-list', open: list.length <= 6 || undefined },
        el('summary', {}, `${def.plural} in period ${p + 1}: ${list.length}`), head, note, list.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'model-table' },
        el('thead', {}, el('tr', {}, ['Layer', 'Row', 'Column', ...def.values.map(([, l, u]) => `${l} (${u})`), ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows))) : null,
      list.length > shown.length ? el('p', { class: 'hint' }, `Showing the first 100 of ${list.length}. The others are on the map.`) : null));
    }
    if (model.obs.length) {
      blocks.push(el('details', { class: 'model-list', open: model.obs.length <= 6 || undefined }, el('summary', {}, `Observation points: ${model.obs.length}`),
        el('div', { class: 'tablewrap' }, el('table', { class: 'model-table' },
          el('thead', {}, el('tr', {}, ['Name', 'Layer', 'Row', 'Column', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, model.obs.map((o) => {
            const input = el('input', { value: o.name, 'aria-label': `Name of observation point ${o.name}`, spellcheck: 'false' });
            input.addEventListener('input', () => { o.name = input.value.trim(); page.edited(false); map.redraw(); });
            return el('tr', {}, el('td', {}, input), el('td', {}, String(o.lay + 1)), el('td', {}, String(o.row + 1)), el('td', {}, String(o.col + 1)),
              el('td', {}, el('button', { class: 'btn quiet small', type: 'button', 'aria-label': `Remove observation point ${o.name || '(no name)'} (${cellName(o.lay, o.row, o.col)})`, onclick: () => { page.model.obs.splice(page.model.obs.indexOf(o), 1); page.edited(); map.redraw(); } }, 'Remove')));
          }))))));
    }
    // ET arrays are not a list of cells, but are shown, so a model's ET is not unseen before a run.
    if (model.evt) blocks.push(el('p', { class: 'hint' }, together(evtArraysText(model, p, sig))));
    if (!blocks.length) blocks.push(el('p', { class: 'hint' }, 'No boundaries or observation points yet. Choose a tool above and click or tap the map; drag to draw a line of cells.'));
    listHost.append(el('h3', { class: 'model-list-head' }, 'Boundaries and observation points'), ...blocks);
  }

  // A new model: nothing typed in the lists is pending.
  function resetLists() {
    listKeys.clear();
  }

  Object.assign(page, { renderLists, renderListsNow, resetLists });
}
