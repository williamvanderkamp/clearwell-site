// Plot water chemistry: major ions to meq/L, the charge balance, the water type, and
// Piper and Stiff diagrams drawn as SVG.
import { analyse, EQUIVALENT_WEIGHT, ionsFor, ION_NAMES, UNITS } from '../../engine/chem.js';
import { columnSpec, done, downloads, downloadWorkbook, el, errorBox, fileDrop, findColumn, form, methodPanel, notes, panel, sig, table } from '../kit.js';
import { fixed } from '../../engine/format.js';
import { parseDelimited } from '../read-file.js';
import { colours, PIPER_WIDTH, PRINT_COLOURS, piperSvg, savePng, saveSvg, STIFF_WIDTH, stiffMax, stiffSvg } from './chem-svg.js';
import { EXAMPLE } from './chem-example.js';
import { FREEZE_CHERRY_1979 } from '../../engine/refs.js';

// Fixed decimals for a column, set by 4 significant figures of its largest value, so
// 7.364, 5.140 and 5.700 line up instead of reading 7.364, 5.14 and 5.7.
function fixedColumn(values) {
  const big = Math.max(0, ...values.filter(Number.isFinite).map(Math.abs));
  const dp = big > 0 ? Math.min(6, Math.max(0, 3 - Math.floor(Math.log10(big)))) : 0;
  return values.map((v) => (Number.isFinite(v) ? v.toFixed(dp) : NaN));
}
// A charge balance error means something only to about 0.1 %.
const percentText = (v) => { const t = v.toFixed(1); return t === '-0.0' ? '0.0' : t; };

const BASIS = [['ions', 'HCO3 and CO3 as ions'], ['alk', 'Total alkalinity']];
const ION_COLUMNS = [
  ['Ca', 'Calcium', /^\s*(ca(?![a-z])|calcium)/i, ['Ca (mg/L)', 'Calcium']],
  ['Mg', 'Magnesium', /^\s*(mg(?![a-z/])|magnesium)/i, ['Mg (mg/L)', 'Magnesium']],
  ['Na', 'Sodium', /^\s*(na(?![a-z])(?!\s*\+\s*k)|sodium)/i, ['Na (mg/L)', 'Sodium']],
  ['K', 'Potassium', /^\s*(k(?![a-z])|potassium)/i, ['K (mg/L)', 'Potassium']],
  ['HCO3', 'Bicarbonate', /^\s*(hco3|bicarbonate)/i, ['HCO3 (mg/L)', 'Bicarbonate']],
  ['CO3', 'Carbonate', /^\s*(co3|carbonate)/i, ['CO3 (mg/L)', 'Carbonate']],
  ['Alk', 'Total alkalinity', /^\s*(alk(?![a-z])|alkalinity|total alkalinity)/i, ['Alkalinity (mg/L as CaCO3)', 'Alkalinity (meq/L)']],
  ['Cl', 'Chloride', /^\s*(cl(?![a-z])|chloride)/i, ['Cl (mg/L)', 'Chloride']],
  ['SO4', 'Sulfate', /^\s*(so4|sulfate|sulphate)/i, ['SO4 (mg/L)', 'Sulfate']],
];
const NAME_RX = /^\s*(sample|name|site|well|station|id)\b/i;
const CARBONATE = { HCO3: 'ions', CO3: 'ions', Alk: 'alk' };

const exampleRows = () => { const [header, ...rows] = parseDelimited(EXAMPLE.csv); return { header, rows }; };

// The unit only when every ion heading found says the same one.
function unitFromHeadings(names) {
  if (!names.length) return undefined;
  if (names.every((h) => /meq/i.test(h))) return 'meq/L';
  if (names.every((h) => /mg\s*\/\s*l/i.test(h) && !/meq/i.test(h))) return 'mg/L';
  return undefined;
}

// The works the method text cites, by key, in order by author.
const REF = {
  back: 'Back, W. (1966) Hydrochemical facies and ground-water flow patterns in northern part of Atlantic Coastal Plain. U.S. Geological Survey Professional Paper 498-A.',
  ciaaw: 'CIAAW (2024) Abridged standard atomic weights. Commission on Isotopic Abundances and Atomic Weights, ciaaw.org.',
  freeze: FREEZE_CHERRY_1979,
  lorenz: 'Lorenz, D.L. (2015) smwrData: an R package of example hydrologic data, version 1.1.1. U.S. Geological Survey Open-File Report 2015-1103, 5 p. doi:10.3133/ofr20151103.',
  piper: 'Piper, A.M. (1944) A graphic procedure in the geochemical interpretation of water-analyses. Transactions, American Geophysical Union 25(6), 914-928.',
  prohaska: 'Prohaska, T., Irrgeher, J., Benefield, J., Böhlke, J.K., Chesson, L.A., Coplen, T.B., Ding, T., Dunn, P.J.H., Gröning, M., Holden, N.E., Meijer, H.A.J., Moossen, H., Possolo, A., Takahashi, Y., Vogl, J., Walczyk, T., Wang, J., Wieser, M.E., Yoneda, S., Zhu, X.-K., and Meija, J. (2022) Standard atomic weights of the elements 2021 (IUPAC Technical Report). Pure and Applied Chemistry 94(5), 573-600. doi:10.1515/pac-2019-0603.',
  stiff: 'Stiff, H.A., Jr. (1951) The interpretation of chemical water analysis by means of patterns. Journal of Petroleum Technology 3(10), 15-17.',
};

function methodText(v, results, plotted, example) {
  const used = ionsFor(v.basis);
  const over = plotted.filter((s) => Math.abs(s.balance) > 5).length;
  const converted = v.unit === 'mg/L';
  const convert = converted
    ? { lines: ['Each concentration was divided by the equivalent weight of the ion: its formula weight over the size of its charge. Formula weights are sums of the abridged standard atomic weights (CIAAW 2024), which are based on the IUPAC standard atomic weights of 2021 (Prohaska et al. 2022).', v.basis === 'alk' ? 'Alkalinity in mg/L as CaCO3 was divided by half the formula weight of CaCO3.' : 'Bicarbonate and carbonate were converted as ions.'],
      formula: 'meq/L = (mg/L) / (equivalent weight),  equivalent weight = formula weight / |charge|',
      numbers: used.map((k) => [`${ION_NAMES[k]} equivalent weight (g/eq)`, fixed(EQUIVALENT_WEIGHT[k], 3)]) }
    : { lines: ['The concentrations were given in meq/L and used as they are.'], numbers: [] };
  return {
    steps: [
      { title: 'Concentrations to milliequivalents per litre', ...convert },
      { title: 'Charge balance error', lines: ['As defined by Freeze and Cherry (1979). The sums hold only the ions this tool takes; ions left out, such as nitrate, iron or H+, move the result.', v.basis === 'alk' ? 'Total alkalinity stands for the anion charge of bicarbonate and carbonate.' : 'Carbonate alkalinity is the sum of HCO3 and CO3.'], formula: 'E (%) = 100 (sum of cations − sum of anions) / (sum of cations + sum of anions),  in meq/L', numbers: [['Samples used', `${plotted.length} of ${results.length}`], ['Samples with |E| above 5%', String(over)]] },
      { title: 'Water type', lines: ['Hydrochemical facies after Back (1966): on each side, an ion group that is more than half of the meq/L sum names the type. Cations are grouped as Ca, Mg and Na+K; anions as HCO3+CO3, SO4 and Cl.', 'When no group is more than half, that side has no dominant type, and the water type writes it as "mixed cation" or "mixed anion": for example mixed cation-HCO3 is a water with no dominant cation and more than half HCO3+CO3. The spreadsheet gives each side\'s facies by name.'], numbers: [] },
      { title: 'Piper diagram', lines: ['Each sample is plotted three times, after Piper (1944): its cation percentages in the left triangle, its anion percentages in the right triangle, and the projection of both into the diamond along the triangle grid lines. Percentages are of the meq/L sum on each side.'], formula: 'cations: Ca + Mg + (Na + K) = 100 %,  anions: (HCO3 + CO3) + SO4 + Cl = 100 %', numbers: [] },
      { title: 'Stiff diagrams', lines: ['One pattern per sample after Stiff (1951): cations to the left of the centre line and anions to the right, in meq/L, with Na+K and Cl on the top line, Ca and HCO3+CO3 in the middle and Mg and SO4 at the bottom. All patterns share one scale so their sizes can be compared.'], numbers: [['Half width of each pattern (meq/L)', sig(stiffMax(plotted), 3)]] },
    ],
    // Atomic weights are cited only when mg/L were converted; the example's data set only
    // when the example, whose note cites it, is loaded.
    references: [
      REF.back, ...(converted ? [REF.ciaaw] : []), REF.freeze, ...(example ? [REF.lorenz] : []),
      REF.piper, ...(converted ? [REF.prohaska] : []), REF.stiff,
    ],
  };
}

function workbook(v, results, plotted, text) {
  const used = ionsFor(v.basis);
  const sheets = [
    { name: 'meq per L', header: ['Sample', ...used.map((k) => `${ION_NAMES[k]} (meq/L)`), 'Sum of cations (meq/L)', 'Sum of anions (meq/L)', 'Charge balance error (%)'],
      rows: plotted.map((s) => [s.name, ...used.map((k) => s.meq[k]), s.cations, s.anions, s.balance]) },
    { name: 'Percent', header: ['Sample', 'Ca (%)', 'Mg (%)', 'Na+K (%)', 'HCO3+CO3 (%)', 'SO4 (%)', 'Cl (%)', 'Cation facies', 'Anion facies', 'Water type'],
      rows: plotted.map((s) => [s.name, s.pct.Ca, s.pct.Mg, s.pct.NaK, s.pct.HCO3CO3, s.pct.SO4, s.pct.Cl, s.cationType, s.anionType, s.type]) },
  ];
  const skipped = results.filter((s) => !s.ok);
  if (skipped.length) {
    sheets.push({ name: 'Not plotted', header: ['Data row', 'Sample', 'Why'], rows: skipped.map((s) => [s.row, s.name, s.reasons.join('; ')]) });
  }
  downloadWorkbook('water-chemistry.xlsx', sheets, text);
}

/**
 * A diagram drawn at the width of its box, one unit to a pixel, so the text keeps its
 * size on a phone. It is drawn again when that width changes and when the system turns
 * dark or light. The downloads are drawn at full width in the light colours, whatever the screen.
 */
function diagramPanel(title, sub, draw, fullWidth, file, redraws) {
  const box = el('div', { class: 'chart' });
  let shownAt = 0;
  const show = () => { shownAt = box.clientWidth; box.replaceChildren(draw(shownAt || fullWidth, colours())); };
  const saved = () => draw(fullWidth, PRINT_COLOURS);
  redraws.push({ box, show, resized: () => { if (box.clientWidth && Math.abs(box.clientWidth - shownAt) > 1) show(); } });
  return panel(el('h2', {}, title), el('p', { class: 'chart-sub' }, sub), box,
    el('div', { class: 'downloads' },
      el('button', { class: 'btn quiet', type: 'button', onclick: () => saveSvg(saved(), `${file}.svg`) }, 'Download SVG'),
      el('button', { class: 'btn quiet', type: 'button', onclick: () => savePng(saved(), `${file}.png`) }, 'Download PNG')));
}

export default {
  id: 'chem',
  group: 'properties',
  title: 'Plot water chemistry',
  blurb: 'You have major ion analyses. Get meq/L, the charge balance error and water type, with Piper and Stiff diagrams to download.',
  lede: 'One row per sample, with calcium, magnesium, sodium, potassium, bicarbonate and carbonate or alkalinity, chloride and sulfate. Blank cells stay blank: a sample missing an ion is listed, not plotted.',
  mount(host, signal) {
    let data = null, example = null, redraws = [], watch = null;
    const out = el('div', { class: 'stack' });
    const ex = exampleRows();
    const { status } = fileDrop(host, { text: 'A CSV or Excel file with one row per sample and a column for each major ion.', examples: [EXAMPLE], onTable: load });
    columnSpec(host, {
      columns: [
        { name: 'Sample name', need: 'Required', what: 'A name or ID for each sample, one sample per row.', headings: ['Sample', 'Well', 'Site'] },
        ...ION_COLUMNS.map(([k, name, , headings]) => ({
          name, need: CARBONATE[k] ? 'Required, see note' : 'Required', headings,
          what: k === 'Alk' ? 'Total alkalinity, in place of HCO3 and CO3.' : `${name} concentration.`,
        })),
      ],
      notes: [
        'Give either HCO3 and CO3 as ions, or total alkalinity. A blank CO3 cell is not taken as zero. Enter 0 only where the lab reported 0.',
        'All ion columns must be in one unit, mg/L or meq/L. You choose which below; nothing is assumed. Alkalinity in mg/L is taken as mg/L as CaCO3.',
        'Text such as "<0.5" is not a number, so that sample is listed as not plotted.',
      ],
      examples: [{ label: EXAMPLE.label, name: 'water-chemistry-example.xlsx', header: ex.header, rows: ex.rows }],
    });
    // HCO3, CO3 and alkalinity are asked for only on the carbonate basis that uses them.
    const columnField = ([k, name]) => {
      const onBasis = CARBONATE[k] ? (v) => v.basis === CARBONATE[k] : undefined;
      return { id: k, label: `${name} column`, type: 'column', required: onBasis || true, show: onBasis };
    };
    const f = form(host, {
      fields: [
        { id: 'name', label: 'Sample name column', type: 'column', required: true },
        { id: 'unit', label: 'Unit of the ion columns', type: 'select', options: UNITS.map((u) => [u, u]), required: true },
        { id: 'basis', label: 'Carbonate given as', type: 'select', options: BASIS, required: true, hint: 'Total alkalinity in mg/L as CaCO3, or in meq/L.' },
        ...ION_COLUMNS.map(columnField),
      ],
      onRun(v) {
        out.textContent = '';
        try {
          if (!data) throw new Error('Choose a file or the example first.');
          run(v);
          done(host);
        } catch (e) {
          out.textContent = '';
          out.append(errorBox(e.message));
        }
      },
    });
    host.append(out);
    // Diagrams follow their box's width and the system's dark or light colours.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => redraws.forEach((d) => d.show()), { signal });
    signal.addEventListener('abort', () => { if (watch) watch.disconnect(); });

    // Everything from an earlier file or example is cleared first; then the columns the
    // headings name, the unit only where every heading says it, and the example's own values.
    function load({ name, table: t, example: x }) {
      f.reset();
      example = x || null;
      data = { name, ...t };
      out.textContent = '';
      f.setColumns(t.header);
      const nameCol = findColumn(t.header, NAME_RX);
      if (nameCol !== undefined) f.set('name', nameCol);
      const found = {};
      for (const [k, , rx] of ION_COLUMNS) {
        const i = findColumn(t.header, rx);
        if (i !== undefined) { found[k] = i; f.set(k, i); }
      }
      f.set('unit', example ? example.unit : unitFromHeadings(Object.values(found).map((i) => t.header[i])));
      // The basis only when the headings name one of the two, not both.
      const hasIons = 'HCO3' in found, hasAlk = 'Alk' in found;
      f.set('basis', example ? example.basis : hasIons !== hasAlk ? (hasAlk ? 'alk' : 'ions') : undefined);
      status(example ? example.about : `${name}: ${t.rows.length} ${t.rows.length === 1 ? 'sample' : 'samples'}.`);
    }

    function run(v) {
      const used = ionsFor(v.basis);
      const results = data.rows.map((r, i) => {
        const name = r[v.name] === null || r[v.name] === undefined || r[v.name] === '' ? `Data row ${i + 1}` : String(r[v.name]);
        return { ...analyse(name, Object.fromEntries(used.map((k) => [k, r[v[k]]])), { unit: v.unit, basis: v.basis }), row: i + 1 };
      });
      const plotted = results.filter((s) => s.ok), skipped = results.filter((s) => !s.ok);
      if (!plotted.length) throw new Error(`None of the ${results.length} samples has every ion needed. ${skipped.slice(0, 3).map((s) => `${s.name}: ${s.reasons.join(', ')}.`).join(' ')}`);
      const over = plotted.filter((s) => Math.abs(s.balance) > 5);
      const warn = [
        ...skipped.map((s) => `Not plotted: ${s.name} (data row ${s.row}). ${s.reasons.join(', ')}.`),
        over.length ? `${over.length} of ${plotted.length} ${plotted.length === 1 ? 'sample' : 'samples'} ${over.length === 1 ? 'has' : 'have'} a charge balance error beyond ±5%, a limit in common use: ${over.map((s) => s.name).join(', ')}. Check the analysis or look for an ion that is not in the file.` : '',
      ].filter(Boolean);
      // The workbook carries the example's note and the page's notes.
      const text = { ...methodText(v, results, plotted, example), notes: [...(example ? [example.about] : []), ...warn] };
      const cations = fixedColumn(plotted.map((s) => s.cations)), anions = fixedColumn(plotted.map((s) => s.anions));
      if (watch) watch.disconnect();
      redraws = [];
      const scale = sig(stiffMax(plotted), 3);
      out.append(
        panel(el('h2', {}, 'Charge balance and water type'),
          el('p', { class: 'chart-sub' }, `${plotted.length} of ${results.length} samples plotted, from ${data.name}. Concentrations in ${v.unit}.`),
          notes(warn),
          table(['Data row', 'Sample', 'Water type', 'Balance error (%)', 'Cations (meq/L)', 'Anions (meq/L)'],
            plotted.map((s, i) => [s.row, s.name, s.type, percentText(s.balance), cations[i], anions[i]])),
          downloads(() => workbook(v, results, plotted, text))),
        diagramPanel('Piper diagram', 'Percent of meq/L on each side. Each sample is numbered by its data row, as in the table above, with its key under the diagram.',
          (w, c) => piperSvg(plotted, c, w), PIPER_WIDTH, 'piper-diagram', redraws),
        diagramPanel('Stiff diagrams', `Cations left, anions right, in meq/L, all on one scale (${scale} meq/L from centre to edge).`,
          (w, c) => stiffSvg(plotted, c, w), STIFF_WIDTH, 'stiff-diagrams', redraws),
        methodPanel(text));
      redraws.forEach((d) => d.show());
      watch = new ResizeObserver(() => redraws.forEach((d) => d.resized()));
      redraws.forEach((d) => watch.observe(d.box));
    }
  },
};
