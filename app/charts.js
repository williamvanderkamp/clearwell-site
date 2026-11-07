// Interactive charts, and the same charts as pictures for the workbook.
const uPlot = window.uPlot;

function colors(forExport) {
  if (forExport) {
    return { raw: '#8d9ba3', corrected: '#1e6fc4', constant: '#c9860a', baro: '#d9531e', tide: '#128a60', user: '#7a4bb0', axis: '#47606b', grid: '#e1e8ea', ink: '#10222b' };
  }
  const css = getComputedStyle(document.documentElement);
  const get = (k) => css.getPropertyValue(k).trim();
  return {
    raw: get('--series-raw'), corrected: get('--series-corrected'), constant: get('--series-constant'), baro: get('--series-baro'),
    tide: get('--series-tide'), user: get('--series-user'), axis: get('--ink-2'), grid: get('--rule'), ink: get('--ink'),
  };
}

function thinIndex(n, max) {
  if (n <= max) return null;
  const step = Math.ceil(n / max), idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  return idx;
}
const pick = (a, idx) => (idx ? idx.map((i) => a[i]) : a);
export const blanks = (a) => a.map((v) => (Number.isFinite(v) ? v : null));
/** One axis in the chart colours, with its label and size in extra. */
export const axis = (c, extra = {}) => ({ stroke: c.axis, grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.grid }, ...extra });
const pad = (share) => (_, a, b) => { const p = (b - a) * share || 0.01; return [a - p, b + p]; };

function definitions(r, c) {
  const u = r.method.levelUnit;
  const depth = r.method.levelKind === 'depth';
  const idx = thinIndex(r.t.length, 8000);
  const xs = pick(r.t, idx).map((ms) => ms / 1000);
  const tzDate = (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC');
  const axes = (label) => [axis(c), axis(c, { label, size: 66, labelSize: 22 })];
  // [label, colour, values, line width]
  const levelSeries = [
    ['Raw', c.raw, r.level, 1], ['Corrected, standard', c.corrected, r.standard.corrected, 1.5], ['Corrected, constant BE', c.constant, r.constant.corrected, 1],
  ];
  if (r.user) levelSeries.push([`Corrected, BE ${r.user.be}`, c.user, r.user.corrected, 1]);
  const removedSeries = [
    ['Barometric effect, standard', c.baro, r.standard.baroEffect], ['Earth tide effect', c.tide, r.standard.tideEffect],
    ['Barometric effect, constant BE', c.constant, r.constant.effect],
  ];
  const m = r.method;
  const lags = m.stepResponse.map((s) => s.lagH);
  const be = m.stepResponse.map((s) => -s.step);
  const responseSeries = [['Barometric efficiency by lag', c.baro, be, 2], ['Constant BE', c.constant, lags.map(() => m.constant.be), 1.25]];
  if (r.user) responseSeries.push([`BE ${r.user.be}`, c.user, lags.map(() => r.user.be), 1.25]);

  return {
    level: {
      title: 'Water level before and after', legend: levelSeries, height: 340,
      opts: {
        tzDate, scales: { x: { time: true }, y: { dir: depth ? -1 : 1, range: pad(0.06) } },
        series: [{}, ...levelSeries.map(([label, stroke, , width]) => ({ label, stroke, width }))],
        axes: axes(`${depth ? 'Depth to water' : 'Water level'} (${u})`),
      },
      data: [xs, ...levelSeries.map(([, , a]) => blanks(pick(a, idx)))],
    },
    removed: {
      title: 'What was removed', legend: removedSeries, height: 230,
      opts: {
        tzDate, scales: { x: { time: true }, y: { range: pad(0.08) } },
        series: [{}, ...removedSeries.map(([label, stroke]) => ({ label, stroke, width: 1 }))],
        axes: axes(`Effect (${u})`),
      },
      data: [xs, ...removedSeries.map(([, , a]) => blanks(pick(a, idx)))],
    },
    response: {
      title: 'Barometric response', legend: responseSeries, height: 260,
      opts: {
        scales: { x: { time: false }, y: { range: (_, a, b) => [Math.min(0, a) - 0.02, Math.max(0.1, b) * 1.1] } },
        series: [{ label: 'Hours' }, ...responseSeries.map(([label, stroke, , width]) => ({ label, stroke, width, points: { show: false } }))],
        axes: [axis(c, { label: 'Hours after a step in pressure', labelSize: 22 }), axis(c, { label: 'Barometric efficiency', size: 54, labelSize: 22 })],
      },
      data: [lags, ...responseSeries.map(([, , a]) => a)],
    },
  };
}

const live = {};

export function draw(r, hosts, definitionsOf = definitions) {
  Object.values(live).forEach((u) => u.destroy());
  for (const k of Object.keys(live)) delete live[k];
  const defs = definitionsOf(r, colors(false));
  const sync = uPlot.sync('clearwell');
  for (const [key, def] of Object.entries(defs)) {
    const host = hosts[key];
    if (!host) continue;
    host.textContent = '';
    const opts = { ...def.opts, width: Math.max(260, host.clientWidth), height: def.height };
    if (def.synced !== false && key !== 'response') opts.cursor = { sync: { key: sync.key, setSeries: false }, drag: { x: true, y: false, setScale: true } };
    live[key] = new uPlot(opts, def.data, host);
  }
}

export function resize(hosts) {
  for (const [key, u] of Object.entries(live)) u.setSize({ width: Math.max(260, hosts[key].clientWidth), height: u.height });
}

// A clean, light-background picture of one chart.
export async function picture(r, key, stage, definitionsOf = definitions) {
  const c = colors(true);
  const def = definitionsOf(r, c)[key];
  const opts = { ...def.opts, width: 1400, height: def.height * 2, pxRatio: 1, legend: { show: false }, cursor: { show: false } };
  const u = new uPlot(opts, def.data, stage);
  await new Promise((res) => { setTimeout(res, 30); }); // not rAF, which stalls in background tabs
  const src = u.ctx.canvas;
  const out = document.createElement('canvas');
  out.width = src.width + 40; out.height = src.height + 90;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = c.ink;
  ctx.font = '600 24px Barlow, Arial, sans-serif';
  ctx.fillText(def.title, 20, 34);
  ctx.font = '15px "IBM Plex Sans", Arial, sans-serif';
  let x = 20;
  for (const [label, color] of def.legend) {
    ctx.fillStyle = color; ctx.fillRect(x, 54, 22, 4);
    ctx.fillStyle = c.ink; ctx.fillText(label, x + 28, 61);
    x += 28 + ctx.measureText(label).width + 26;
  }
  ctx.drawImage(src, 20, 76);
  u.destroy();
  stage.textContent = '';
  const blob = await new Promise((res) => { out.toBlob(res, 'image/png'); });
  return { blob, width: out.width, height: out.height };
}
