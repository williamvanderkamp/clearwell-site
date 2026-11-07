// The pumping test charts. Log-time charts plot averaged points, so each log cycle
// counts the same, as the fits do.
import { theisCurve } from '../engine/index.js';
import { axis, blanks } from './charts.js';

const positive = (a) => a.map((v) => (Number.isFinite(v) && v > 0 ? v : null));
const dots = (label, stroke, size = 5) => ({ label, stroke, fill: stroke, width: 0, paths: () => null, points: { show: true, size, stroke, fill: stroke } });
const curve = (label, stroke, width = 2) => ({ label, stroke, width, points: { show: false } });

const axesFor = (c, xLabel, yLabel) => [axis(c, { label: xLabel, labelSize: 22 }), axis(c, { label: yLabel, size: 66, labelSize: 22 })];

// Merges several { x, y } series onto one sorted x axis, which is what uPlot takes.
function merged(series) {
  const xs = [...new Set(series.flatMap((s) => s.x))].sort((a, b) => a - b);
  const index = new Map(xs.map((x, i) => [x, i]));
  return [xs, ...series.map((s) => {
    const y = new Array(xs.length).fill(null);
    s.x.forEach((x, i) => { y[index.get(x)] = s.y[i]; });
    return y;
  })];
}

// A dashed line where the pump stopped. Drawn on the canvas, so saved charts have it too.
const stopMark = (minute, color) => (u) => {
  const x = u.valToPos(minute, 'x', true), { top, height } = u.bbox, ctx = u.ctx, px = u.pxRatio || 1;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.setLineDash([4 * px, 4 * px]);
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `${12 * px}px "IBM Plex Sans", Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('Pumping stopped', x - 6 * px, top + height - 8 * px);
  ctx.restore();
};

function thinned(r, keys) {
  const n = r.t.length, step = Math.max(1, Math.ceil(n / 8000));
  const take = (a) => a.filter((_, i) => i % step === 0);
  return keys.map((a) => blanks(take(a)));
}

export function pumpingDefinitions(r, c) {
  const m = r.method, a = r.analysis, u = m.lengthUnit, L = m.lengthToM;
  const lu = m.levelUnit, depth = m.levelKind === 'depth' || m.levelKind === 'drawdown';
  const minutes = (t) => t.map((x) => x * 1440);
  const inLength = (y) => y.map((v) => (Number.isFinite(v) ? v / L : null));
  // A fitted straight line against log time, in the file's length unit.
  const onLine = (fit, x) => (fit.slope * Math.log10(x) + fit.intercept) / L;
  const defs = {};
  // Drawdown increases downward against linear or log time, as a hydrograph reads and
  // as on the other tools. On log-log plots it increases upward, as on type curves.
  const down = -1;

  // With nothing removed there is one record, so it is shown once, as measured.
  const corrected = Boolean(r.rawAnalysis);
  const [hours, raw, clean] = thinned(r, [r.elapsedMin.map((x) => x / 60), r.level, r.cleanLevel]);
  const levelLegend = corrected ? [['Raw', c.raw], ['Corrected', c.corrected]] : [['Measured', c.corrected]];
  defs.level = {
    title: 'Water level through the test', legend: levelLegend, height: 320,
    opts: {
      scales: { x: { time: false }, y: { dir: depth ? -1 : 1 } },
      series: [{ label: 'Hours' }, ...(corrected ? [curve('Raw', c.raw, 1), curve('Corrected', c.corrected, 1.5)] : [curve('Measured', c.corrected, 1.5)])],
      axes: axesFor(c, 'Hours since pumping began', `${{ depth: 'Depth to water', drawdown: 'Drawdown' }[m.levelKind] || 'Water level'} (${lu})`),
    },
    data: corrected ? [hours, raw, clean] : [hours, raw],
  };

  if (r.baroEffect) {
    const parts = [['Barometric effect', c.baro, r.baroEffect]];
    if (r.tideEffect) parts.push(['Earth tide effect', c.tide, r.tideEffect]);
    const [x, ...ys] = thinned(r, [r.elapsedMin.map((v) => v / 60), ...parts.map((p) => p[2])]);
    defs.removed = {
      title: 'What was removed', legend: parts, height: 220,
      opts: {
        scales: { x: { time: false } },
        series: [{ label: 'Hours' }, ...parts.map(([label, stroke]) => curve(label, stroke, 1))],
        axes: axesFor(c, 'Hours since pumping began', `Effect (${lu})`),
      },
      data: [x, ...ys],
    };
  }

  const ext = a.extended && a.extended.t.length ? a.extended : null;
  const pumpMin = minutes(a.pump.t);
  if (ext) {
    const times = [...a.pump.t, ...ext.t];
    const series = [{ x: pumpMin, y: inLength(a.pump.y) }, { x: minutes(ext.t), y: inLength(ext.y) }];
    const extDefs = [dots('Measured during pumping', c.corrected), dots('Extended from recovery', c.constant)];
    const legend = [['Measured during pumping', c.corrected], ['Extended from recovery', c.constant]];
    if (a.line) {
      const ends = [a.line.from, ext.t[ext.t.length - 1]];
      series.push({ x: minutes(ends), y: ends.map((t) => onLine(a.line, t)) });
      extDefs.push({ ...curve('Cooper and Jacob line, carried forward', c.tide, 1.5), dash: [8, 5], spanGaps: true });
      legend.push(['Cooper and Jacob line, carried forward', c.tide]);
    }
    if (a.theis) {
      series.push({ x: minutes(times), y: inLength(theisCurve(a.theis, times)) });
      extDefs.push(curve('Theis curve, carried forward', c.baro, 1.5));
      legend.push(['Theis curve, carried forward', c.baro]);
    }
    defs.extended = {
      title: 'Extended drawdown: if pumping had continued', legend, height: 360, synced: false,
      opts: {
        scales: { x: { time: false, distr: 3 }, y: { dir: down } },
        series: [{ label: 'Minutes' }, ...extDefs],
        axes: axesFor(c, 'Minutes since pumping began', `Drawdown (${u})`),
        hooks: { draw: [stopMark(m.durationDays * 1440, c.axis)] },
      },
      data: merged(series),
    };
  }
  const logSeries = [{ x: pumpMin, y: positive(inLength(a.pump.y)) }, { x: pumpMin, y: positive(inLength(a.derivative)) }];
  const logLegend = [['Drawdown', c.corrected], ['Log derivative', c.tide]];
  const logDefs = [dots('Drawdown', c.corrected), dots('Log derivative', c.tide, 4)];
  if (a.theis) {
    logSeries.push({ x: pumpMin, y: positive(inLength(theisCurve(a.theis, a.pump.t))) });
    logLegend.push(['Theis curve', c.baro]);
    logDefs.push(curve('Theis curve', c.baro, 1.5));
  }
  defs.diagnostic = {
    title: 'Diagnostic: drawdown and its log derivative', legend: logLegend, height: 360, synced: false,
    opts: {
      scales: { x: { time: false, distr: 3 }, y: { distr: 3 } },
      series: [{ label: 'Minutes' }, ...logDefs],
      axes: axesFor(c, 'Minutes since pumping began', `Drawdown (${u})`),
    },
    data: merged(logSeries),
  };

  const semi = [{ x: pumpMin, y: inLength(a.pump.y) }];
  const semiName = corrected ? 'Corrected' : 'Measured';
  const semiDefs = [dots(semiName, c.corrected)];
  const semiLegend = [[semiName, c.corrected]];
  // The raw points go first, so the corrected ones are drawn over them.
  if (corrected) {
    semi.unshift({ x: minutes(r.rawAnalysis.pump.t), y: inLength(r.rawAnalysis.pump.y) });
    semiDefs.unshift(dots('Raw', c.raw, 4));
    semiLegend.unshift(['Raw', c.raw]);
  }
  if (a.line) {
    const ends = [a.line.from, a.line.to];
    semi.push({ x: minutes(ends), y: ends.map((t) => onLine(a.line, t)) });
    semiDefs.push({ ...curve('Fitted line', c.baro, 2), spanGaps: true });
    semiLegend.push(['Fitted line', c.baro]);
  }
  defs.semilog = {
    title: 'Drawdown against log time', legend: semiLegend, height: 320, synced: false,
    opts: {
      scales: { x: { time: false, distr: 3 }, y: { dir: down } },
      series: [{ label: 'Minutes' }, ...semiDefs],
      axes: axesFor(c, 'Minutes since pumping began', `Drawdown (${u})`),
    },
    data: merged(semi),
  };

  if (a.recoveryBins && a.recoveryBins.t.length) {
    const tp = m.durationDays;
    const ratio = (t) => (tp + t) / t;
    const rec = a.recoveryBins;
    const order = rec.t.map((_, i) => i).reverse();
    const series = [{ x: order.map((i) => ratio(rec.t[i])), y: order.map((i) => rec.y[i] / L) }];
    const lineDefs = [dots('Residual drawdown', c.corrected)];
    const legend = [['Residual drawdown', c.corrected]];
    if (a.recovery) {
      const ends = [ratio(a.recovery.to), ratio(a.recovery.from)];
      series.push({ x: ends, y: ends.map((x) => onLine(a.recovery, x)) });
      lineDefs.push({ ...curve('Fitted line', c.baro, 2), spanGaps: true });
      legend.push(['Fitted line', c.baro]);
    }
    defs.recovery = {
      title: 'Theis recovery', legend, height: 300, synced: false,
      opts: {
        scales: { x: { time: false, distr: 3 }, y: { dir: down } },
        series: [{ label: "t/t'" }, ...lineDefs],
        axes: axesFor(c, "t/t', time since pumping began over time since it stopped", `Residual drawdown (${u})`),
      },
      data: merged(series),
    };
  }
  return defs;
}
