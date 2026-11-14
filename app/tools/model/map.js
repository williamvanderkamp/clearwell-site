// The plan-view map of the model page: one canvas that draws a layer of the grid, its
// cell values on a colour scale, boundaries, observation points, contours and dry cells,
// and takes the user's brush, rectangle and point edits. It pans and zooms with a mouse
// wheel, a drag, two fingers or the keyboard. Colours come from the page's CSS custom
// properties, so the map follows light and dark as the kit charts do.
//
// The map knows only geometry. The page hands it a frame (what to draw) and gets back the
// cells the user chose (onApply), and says what to write about a cell (describe).
import { edges } from './edit-model.js';

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

/** The colour scale's stops, from the page's --model-ramp. */
export function rampStops(el) {
  return css(el, '--model-ramp').split(/\s+/).filter(Boolean);
}

/** The colour at fraction t (0 to 1) along the scale, as the map draws it. */
export function rampColour(el, t) {
  const c = lut(rampStops(el), 255)[Math.max(0, Math.min(255, Math.round(t * 255)))];
  return `rgb(${c & 255}, ${(c >> 8) & 255}, ${(c >> 16) & 255})`;
}

const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

// 256 colours along the stops, packed for a little-endian Uint32 view of ImageData.
function lut(stops, alpha) {
  const rgb = stops.map(hexToRgb), out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(t)), f = t - k;
    const c = [0, 1, 2].map((ch) => Math.round(rgb[k][ch] + (rgb[k + 1][ch] - rgb[k][ch]) * f));
    out[i] = ((alpha << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  }
  return out;
}
const pack = (hex, alpha) => { const [r, g, b] = hexToRgb(hex); return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0; };

// Index of the cell holding position v along edges e (n + 1 values), or -1 outside.
function locate(e, v) {
  if (!(v >= e[0] && v <= e[e.length - 1])) return -1;
  let lo = 0, hi = e.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (e[mid] <= v) lo = mid; else hi = mid; }
  return Math.min(lo, e.length - 2);
}

/**
 * host: the element to draw in. options:
 *   frame(): { model, values (nrow*ncol numbers, NaN for none, null entries for not given),
 *     scale: { toT(v) → 0..1 } or null (calc.js colourScale), active (nrow*ncol 1/0),
 *     boundaries: [{ row, col, pkg }], wells: [{ row, col }], obs: [{ row, col, name }],
 *     dry: [cell], contours: { levels, lines, labels } or null, faded, overlays: [draw] }
 *   tool(): 'look' | 'brush' | 'rect' | 'point'
 *   onApply(cells, stroke): cells as [[row, col], ...], chosen by the user with the tool;
 *     stroke is the same object for every call of one brush stroke, null otherwise
 *   describe(row, col): the text for the readout
 *   touchPaint(): true when one finger on a touch screen paints and draws; otherwise one
 *     finger pans and a tap uses the tool on one cell (a rectangle takes a tap at each corner)
 *   onTouch(): called once, at the first touch, so the page can offer touchPaint
 *   signal: aborted when the page leaves the map, which then draws no more
 */
export function modelMap(host, { frame, tool, onApply, describe, label, touchPaint = () => false, onTouch = () => {}, signal }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'model-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', label);
  canvas.setAttribute('aria-describedby', 'modelReadout');
  const readout = document.createElement('p');
  readout.className = 'model-readout';
  readout.id = 'modelReadout';
  readout.setAttribute('aria-live', 'polite');
  host.append(canvas, readout);
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');

  let geom = null;               // { ex, ey, W, H, nrow, ncol, xs, ys } for the current grid
  let scale = 1, ox = 0, oy = 0; // screen px = o + world * scale (CSS px)
  let cursor = null;             // [row, col] of the keyboard or tapped cell, where Enter acts
  let hover = null;              // [row, col] under the mouse, which only the readout follows
  let anchor = null;             // [row, col] where a rectangle started
  let rectEnd = null;
  let backdrop = null;           // { img, x0, y0, x1, y1 } in model coordinates (y up)
  let needFit = true;            // fit the grid in view at the next draw
  let autoFit = true;            // until the user pans or zooms, a resize fits the grid again

  function geometry(m) {
    const g = m.grid;
    if (geom && geom.delr === g.delr && geom.delc === g.delc) return geom;
    const ex = edges(g.delr), ey = edges(g.delc);
    const xs = new Float64Array(g.ncol), ys = new Float64Array(g.nrow);
    for (let j = 0; j < g.ncol; j++) xs[j] = (ex[j] + ex[j + 1]) / 2;
    for (let i = 0; i < g.nrow; i++) ys[i] = (ey[i] + ey[i + 1]) / 2;
    needFit = true;
    fitHeight(ex[g.ncol], ey[g.nrow]);
    let smallest = Infinity;
    for (const w of g.delr) if (w < smallest) smallest = w;
    for (const w of g.delc) if (w < smallest) smallest = w;
    geom = { delr: g.delr, delc: g.delc, ex, ey, xs, ys, W: ex[g.ncol], H: ey[g.nrow], nrow: g.nrow, ncol: g.ncol, smallest };
    return geom;
  }

  // The canvas is as tall as the grid's shape needs at this width, within limits, so a
  // wide grid on a phone does not sit in a tall empty box.
  // On a phone it leaves at least 40% of the screen, so the page can be scrolled past it.
  function fitHeight(W, H) {
    const most = window.innerWidth <= 620 ? Math.min(window.innerHeight * 0.6, 480) : 560;
    const want = Math.round((canvas.clientWidth || 300) * (H / W) + 24);
    canvas.style.height = `${Math.max(220, Math.min(most, want))}px`;
  }
  const size = () => ({ w: canvas.clientWidth || 300, h: canvas.clientHeight || 300 });
  const fitScale = () => { const { w, h } = size(); return Math.min((w - 24) / geom.W, (h - 24) / geom.H); };
  function fit() {
    if (!geom) return;
    const { w, h } = size();
    scale = fitScale();
    ox = (w - geom.W * scale) / 2;
    oy = (h - geom.H * scale) / 2;
    needFit = false;
  }
  // Zoom from half the fitted size up to 60 px for the smallest cell, and keep at least a
  // quarter of the grid's width and height in view, so the grid cannot be lost.
  function limits() {
    if (!geom) return;
    const { w, h } = size();
    const lo = fitScale() * 0.5, hi = Math.max(fitScale() * 2, 60 / geom.smallest);
    scale = Math.min(Math.max(scale, lo), hi);
    const gw = geom.W * scale, gh = geom.H * scale, kx = Math.min(gw, w) / 4, ky = Math.min(gh, h) / 4;
    ox = Math.min(Math.max(ox, kx - gw), w - kx);
    oy = Math.min(Math.max(oy, ky - gh), h - ky);
  }
  function zoomAt(f, px, py) {
    autoFit = false;
    const before = scale;
    scale *= f;
    limits();
    ox = px - (px - ox) * (scale / before);
    oy = py - (py - oy) * (scale / before);
    limits();
    draw();
  }

  function cellAt(px, py) {
    if (!geom) return null;
    const j = locate(geom.ex, (px - ox) / scale), i = locate(geom.ey, (py - oy) / scale);
    return i < 0 || j < 0 ? null : [i, j];
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const f = frame();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(host, '--panel');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!f || !f.model) return;
    const gm = geometry(f.model);
    if (needFit) fit();
    const X = (x) => ox + x * scale, Y = (y) => oy + y * scale;

    // The backdrop image, if any, under the cells.
    if (backdrop) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(backdrop.img, X(backdrop.x0), Y(gm.H - backdrop.y1), (backdrop.x1 - backdrop.x0) * scale, (backdrop.y1 - backdrop.y0) * scale);
    }

    // Cells: written straight into pixels, so a large grid draws as fast as a small one.
    const cw = canvas.width, ch = canvas.height;
    if (off.width !== cw || off.height !== ch) { off.width = cw; off.height = ch; }
    const img = offCtx.createImageData(cw, ch);
    const px = new Uint32Array(img.data.buffer);
    const alpha = backdrop ? 150 : 255;
    const colours = lut(rampStops(host), alpha);
    const inactive = pack(css(host, '--model-inactive'), backdrop ? 170 : 255);
    const needed = pack(css(host, '--bad'), 200);
    const plain = pack(css(host, '--model-cell'), backdrop ? 60 : 255);
    const dryColour = pack(css(host, '--bad'), 255);
    const j0 = Math.max(0, locate(gm.ex, Math.max(0, -ox / scale)));
    const j1 = Math.max(j0, locate(gm.ex, Math.min(gm.W, (w - ox) / scale)));
    const i0 = Math.max(0, locate(gm.ey, Math.max(0, -oy / scale)));
    const i1 = Math.max(i0, locate(gm.ey, Math.min(gm.H, (h - oy) / scale)));
    const colPx = new Int32Array(gm.ncol + 1), rowPx = new Int32Array(gm.nrow + 1);
    for (let j = j0; j <= j1 + 1; j++) colPx[j] = Math.max(0, Math.min(cw, Math.round(X(gm.ex[j]) * dpr)));
    for (let i = i0; i <= i1 + 1; i++) rowPx[i] = Math.max(0, Math.min(ch, Math.round(Y(gm.ey[i]) * dpr)));
    const toT = f.scale ? f.scale.toT : () => 0.5;
    const drySet = new Set(f.dry || []);
    const ncol = gm.ncol;
    for (let i = i0; i <= i1; i++) {
      const ya = rowPx[i], yb = rowPx[i + 1];
      if (yb <= ya) continue;
      for (let j = j0; j <= j1; j++) {
        const xa = colPx[j], xb = colPx[j + 1];
        if (xb <= xa) continue;
        const c = i * ncol + j;
        let colour, stripes = false;
        if (f.active && !f.active[c]) colour = inactive;
        else if (drySet.has(c)) colour = dryColour;
        else if (!f.values) colour = plain;
        else {
          const v = f.values[c];
          if (v === null || v === undefined) { colour = needed; stripes = true; }
          else if (!Number.isFinite(v)) colour = plain;
          else colour = colours[Math.max(0, Math.min(255, Math.round(toT(v) * 255)))];
        }
        for (let y = ya; y < yb; y++) {
          const row = y * cw;
          if (stripes) { for (let x = xa; x < xb; x++) if ((x + y) % 10 < 3) px[row + x] = colour; } else px.fill(colour, row + xa, row + xb);
        }
      }
    }
    offCtx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (f.faded) ctx.globalAlpha = 0.45;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Grid lines once cells are big enough to see, and always the outline.
    // A line is drawn only between cells at least 5 px wide, so the fine part of a
    // telescoping grid does not turn into a solid bar.
    ctx.strokeStyle = css(host, '--model-grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wide = (e, k) => k > 0 && k < e.length - 1 && (e[k] - e[k - 1]) * scale >= 5 && (e[k + 1] - e[k]) * scale >= 5;
    for (let j = j0; j <= j1 + 1; j++) if (wide(gm.ex, j)) { const x = Math.round(X(gm.ex[j])) + 0.5; ctx.moveTo(x, Y(gm.ey[i0])); ctx.lineTo(x, Y(gm.ey[i1 + 1])); }
    for (let i = i0; i <= i1 + 1; i++) if (wide(gm.ey, i)) { const y = Math.round(Y(gm.ey[i])) + 0.5; ctx.moveTo(X(gm.ex[j0]), y); ctx.lineTo(X(gm.ex[j1 + 1]), y); }
    ctx.stroke();
    ctx.strokeStyle = css(host, '--ink-2');
    ctx.strokeRect(X(0), Y(0), gm.W * scale, gm.H * scale);
    const cellBox = (r, c) => [X(gm.ex[c]), Y(gm.ey[r]), (gm.ex[c + 1] - gm.ex[c]) * scale, (gm.ey[r + 1] - gm.ey[r]) * scale];

    // Dry cells: a cross on each, where there is room.
    if (drySet.size) {
      ctx.strokeStyle = css(host, '--panel');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const c of drySet) {
        const [x, y, cwid, chei] = cellBox(Math.floor(c / ncol), c % ncol);
        if (cwid < 6 || chei < 6) continue;
        ctx.moveTo(x + cwid * 0.2, y + chei * 0.2); ctx.lineTo(x + cwid * 0.8, y + chei * 0.8);
        ctx.moveTo(x + cwid * 0.8, y + chei * 0.2); ctx.lineTo(x + cwid * 0.2, y + chei * 0.8);
      }
      ctx.stroke();
    }

    // Contours. Results from before the latest edit are faded, lines and all.
    const fade = f.faded ? 0.4 : 1;
    if (f.contours) {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = css(host, '--ink');
      ctx.lineWidth = 1.25;
      f.contours.lines.forEach((segs) => {
        ctx.beginPath();
        for (let s = 0; s < segs.length; s += 4) { ctx.moveTo(X(segs[s]), Y(segs[s + 1])); ctx.lineTo(X(segs[s + 2]), Y(segs[s + 3])); }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // Drawings from the page's panels, such as particle paths, over the contours.
    for (const fn of f.overlays || []) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = fade; fn(ctx, { X, Y }); ctx.restore(); }

    // Boundaries: an opaque inset square in each package's colour, ringed so it stands out
    // from the colour scale beneath; wells as dots.
    const ring = css(host, '--model-ring');
    const colourOf = { chd: css(host, '--model-chd'), riv: css(host, '--model-riv'), drn: css(host, '--model-drn'), ghb: css(host, '--model-ghb'), evtList: css(host, '--model-evt'), wel: css(host, '--model-wel') };
    const symbols = [];
    for (const b of f.boundaries || []) {
      const [x, y, bw, bh] = cellBox(b.row, b.col);
      const inset = Math.min(bw, bh) > 8 ? 2 : 0;
      const bx = x + inset, by = y + inset, ww = Math.max(1.5, bw - 2 * inset), hh = Math.max(1.5, bh - 2 * inset);
      ctx.fillStyle = colourOf[b.pkg];
      ctx.fillRect(bx, by, ww, hh);
      if (Math.min(bw, bh) >= 6) { ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.strokeRect(bx + 0.75, by + 0.75, ww - 1.5, hh - 1.5); }
      symbols.push([bx, by, ww, hh]);
    }
    ctx.lineWidth = 1.5;
    for (const wl of f.wells || []) {
      const [x, y, bw, bh] = cellBox(wl.row, wl.col);
      const r = Math.max(4, Math.min(9, Math.min(bw, bh) * 0.35));
      ctx.beginPath();
      ctx.arc(x + bw / 2, y + bh / 2, r, 0, 2 * Math.PI);
      ctx.fillStyle = colourOf.wel;
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.stroke();
      symbols.push([x + bw / 2 - r, y + bh / 2 - r, 2 * r, 2 * r]);
    }
    ctx.font = `600 11px ${css(host, '--font-body') || 'sans-serif'}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    // Names only where they do not run into one another.
    const labelBoxes = [];
    for (const o of f.obs || []) {
      const [x, y, bw, bh] = cellBox(o.row, o.col);
      const cx = x + bw / 2, cy = y + bh / 2, r = Math.max(4.5, Math.min(8, Math.min(bw, bh) * 0.35));
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
      ctx.fillStyle = css(host, '--model-obs');
      ctx.fill();
      ctx.strokeStyle = css(host, '--panel');
      ctx.stroke();
      symbols.push([cx - r, cy - r, 2 * r, 2 * r]);
      const tw = ctx.measureText(o.name).width, box = [cx + r + 2, cy - 13, tw, 13];
      if (!labelBoxes.some((b) => box[0] < b[0] + b[2] + 4 && b[0] < box[0] + box[2] + 4 && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) {
        labelBoxes.push(box);
        symbols.push(box);
        ctx.lineWidth = 3;
        ctx.strokeText(o.name, cx + r + 2, cy - 1);
        ctx.fillStyle = css(host, '--ink');
        ctx.fillText(o.name, cx + r + 2, cy - 1);
        ctx.lineWidth = 1.5;
      }
    }

    // Contour labels last, a few on each level spaced well apart, and none on a symbol.
    if (f.contours) {
      const ink = css(host, '--ink'), panel = css(host, '--panel');
      ctx.font = `11px ${css(host, '--font-data') || 'monospace'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = fade;
      const hits = (x0, y0, ww, hh) => symbols.some(([sx, sy, sw, sh]) => x0 < sx + sw && sx < x0 + ww && y0 < sy + sh && sy < y0 + hh);
      const placed = [];
      f.contours.lines.forEach((segs, li) => {
        const text = f.contours.labels[li];
        let n = 0;
        for (let s = 0; s < segs.length && n < 4; s += 4) {
          const x = (X(segs[s]) + X(segs[s + 2])) / 2, y = (Y(segs[s + 1]) + Y(segs[s + 3])) / 2;
          if (x < 20 || y < 12 || x > w - 20 || y > h - 12) continue;
          if (placed.some(([px2, py2]) => Math.hypot(px2 - x, py2 - y) < 110)) continue;
          const tw = ctx.measureText(text).width + 6;
          if (hits(x - tw / 2, y - 7, tw, 14)) continue;
          placed.push([x, y]);
          n++;
          ctx.fillStyle = panel;
          ctx.fillRect(x - tw / 2, y - 7, tw, 14);
          ctx.fillStyle = ink;
          ctx.fillText(text, x, y);
        }
      });
      ctx.globalAlpha = 1;
    }

    // The rectangle being drawn, and the cell under the keyboard or the mouse.
    const accent = css(host, '--accent');
    if (anchor && rectEnd) {
      const [r0, r1] = [Math.min(anchor[0], rectEnd[0]), Math.max(anchor[0], rectEnd[0])];
      const [c0, c1] = [Math.min(anchor[1], rectEnd[1]), Math.max(anchor[1], rectEnd[1])];
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(X(gm.ex[c0]), Y(gm.ey[r0]), (gm.ex[c1 + 1] - gm.ex[c0]) * scale, (gm.ey[r1 + 1] - gm.ey[r0]) * scale);
      ctx.setLineDash([]);
    }
    // The keyboard's cell in the focus-ring colour, 2 px, on a dark halo and a light edge,
    // so it shows over every colour of the scale in both schemes.
    for (const c of [cursor, hover]) {
      if (!c) continue;
      const [x, y, bw, bh] = cellBox(c[0], c[1]);
      const box = [x - 1, y - 1, Math.max(bw, 3) + 2, Math.max(bh, 3) + 2];
      if (c === cursor) {
        ctx.strokeStyle = css(host, '--model-halo') || '#10222b';
        ctx.lineWidth = 5;
        ctx.strokeRect(...box);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(...box);
        ctx.strokeStyle = css(host, '--model-ring') || '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(box[0] - 2.5, box[1] - 2.5, box[2] + 5, box[3] + 5);
      } else {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(...box);
      }
    }
  }

  // The animation frame a redraw waits for, or 0.
  let queued = 0;
  const redraw = () => {
    if (!queued) queued = requestAnimationFrame(() => { queued = 0; draw(); });
  };

  const IDLE = 'Hover over a cell, tap it, or move to it with the arrow keys to read its values.';
  function say(cell) {
    readout.textContent = cell ? describe(cell[0], cell[1]) : IDLE;
  }
  readout.textContent = IDLE;
  function setCursor(cell) {
    cursor = cell;
    say(cell);
    redraw();
  }

  // ---- pointer input: one pointer edits or pans, two pan and zoom ----
  const pointers = new Map();
  let gesture = null; // { kind: 'pan'|'stroke'|'rect'|'pinch'|'pending', ... }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // stroke: the brush stroke the cells belong to, so the page can total what a whole stroke did.
  const applyCells = (cells, stroke = null) => { if (cells.length) onApply(cells, stroke); };

  // The cells a brush passes through between two points, sampled at a quarter of the smaller cell.
  function strokeCells(from, to, seen) {
    const out = [];
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(d / 3));
    for (let s = 0; s <= steps; s++) {
      const c = cellAt(from[0] + (to[0] - from[0]) * (s / steps), from[1] + (to[1] - from[1]) * (s / steps));
      if (!c) continue;
      const key = c[0] * 1e7 + c[1];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  function begin(kind, p, e) {
    const t = tool();
    if (kind === 'pan' || t === 'look') { gesture = { kind: 'pan', start: p, last: p, moved: false }; return; }
    if (t === 'brush') {
      gesture = { kind: 'stroke', last: p, seen: new Set() };
      applyCells(strokeCells(p, p, gesture.seen), gesture);
    } else if (t === 'rect') {
      const c = cellAt(...p);
      gesture = { kind: 'rect' };
      anchor = c; rectEnd = c;
      redraw();
    } else if (t === 'point') {
      gesture = { kind: 'point', start: p };
    }
    void e;
  }

  // A tap with a tool: the point tools and the brush act on the cell; a rectangle takes a
  // tap at each corner, as the keyboard takes two presses.
  function tapTool(c) {
    if (!c) return;
    const t = tool();
    setCursor(c);
    if (t === 'rect') {
      if (!anchor) { anchor = c; rectEnd = c; readout.textContent = `${describe(c[0], c[1])} Corner set: tap the other corner.`; redraw(); } else { applyCells(rectCells(anchor, c)); anchor = rectEnd = null; redraw(); }
    } else if (t === 'brush' || t === 'point') applyCells([c]);
  }

  let touched = false;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (e.pointerType === 'touch' && !touched) { touched = true; onTouch(); }
    if (pointers.size === 2) {
      // A second finger: whatever the first started becomes a pinch, and a rectangle is dropped.
      if (gesture && gesture.timer) clearTimeout(gesture.timer);
      anchor = rectEnd = null;
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || e.button === 2) { begin('pan', p, e); return; }
    if (e.pointerType === 'touch' && tool() !== 'look' && !touchPaint()) {
      // One finger pans, as in Look and pan; a tap without moving uses the tool.
      gesture = { kind: 'pan', start: p, last: p, moved: false, tap: true };
      return;
    }
    if (e.pointerType === 'touch' && tool() !== 'look') {
      // Painting by dragging was asked for. Wait a moment, so a two-finger pinch does not
      // paint where the first finger landed.
      gesture = { kind: 'pending', start: p, timer: setTimeout(() => { if (gesture && gesture.kind === 'pending') begin('tool', gesture.start, e); }, 90) };
      return;
    }
    begin('tool', p, e);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      // Hover: the readout follows the mouse, but the keyboard's cell stays where it was.
      if (e.pointerType === 'mouse') { const c = cellAt(...p); if (String(c) !== String(hover)) { hover = c; say(c || cursor); redraw(); } }
      return;
    }
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ox += mid[0] - gesture.mid[0]; oy += mid[1] - gesture.mid[1];
      limits();
      if (gesture.dist > 0) zoomAt(dist / gesture.dist, mid[0], mid[1]); else redraw();
      gesture.dist = dist; gesture.mid = mid;
      return;
    }
    if (gesture.kind === 'pending') {
      if (Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > 6) { clearTimeout(gesture.timer); const s = gesture.start; begin('tool', s, e); if (gesture && gesture.kind === 'stroke') { applyCells(strokeCells(s, p, gesture.seen), gesture); gesture.last = p; } }
      return;
    }
    if (gesture.kind === 'pan') {
      ox += p[0] - gesture.last[0]; oy += p[1] - gesture.last[1];
      limits();
      autoFit = false;
      if (Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > (gesture.tap ? 8 : 4)) gesture.moved = true;
      gesture.last = p;
      redraw();
    } else if (gesture.kind === 'stroke') {
      applyCells(strokeCells(gesture.last, p, gesture.seen), gesture);
      gesture.last = p;
      const c = cellAt(...p);
      if (c) setCursor(c);
    } else if (gesture.kind === 'rect') {
      const c = cellAt(...p);
      if (c) { rectEnd = c; if (!anchor) anchor = c; say(c); redraw(); }
    }
  });

  function end(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') { if (!pointers.size) gesture = null; return; }
    if (e.type === 'pointercancel') { if (gesture.timer) clearTimeout(gesture.timer); anchor = rectEnd = null; gesture = null; redraw(); return; }
    if (gesture.kind === 'pending') {
      // A quick tap with a touch: do what a click does.
      clearTimeout(gesture.timer);
      const t = tool();
      begin('tool', gesture.start, e);
      if (t === 'point' || t === 'rect') { gesture.start = gesture.start || p; }
      if (t === 'rect') { const c = cellAt(...p); if (c) rectEnd = c; }
    }
    if (gesture.kind === 'pan' && !gesture.moved) { if (gesture.tap) tapTool(cellAt(...gesture.start)); else setCursor(cellAt(...p)); }
    if (gesture.kind === 'point') { const c = cellAt(...(gesture.start || p)); if (c) { setCursor(c); applyCells([c]); } }
    if (gesture.kind === 'rect') {
      if (anchor && rectEnd) applyCells(rectCells(anchor, rectEnd));
      anchor = rectEnd = null;
      redraw();
    }
    gesture = null;
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && hover) { hover = null; say(cursor); redraw(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), x, y);
  }, { passive: false });

  function rectCells(a, b) {
    const out = [];
    for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++) for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) out.push([r, c]);
    return out;
  }

  // ---- keyboard: arrows move the cell cursor, Enter or Space uses the tool there ----
  function keepInView(cell) {
    const [x, y, bw, bh] = [ox + geom.ex[cell[1]] * scale, oy + geom.ey[cell[0]] * scale, (geom.ex[cell[1] + 1] - geom.ex[cell[1]]) * scale, (geom.ey[cell[0] + 1] - geom.ey[cell[0]]) * scale];
    const { w, h } = size();
    autoFit = false;
    if (x < 8) ox += 8 - x; else if (x + bw > w - 8) ox -= x + bw - (w - 8);
    if (y < 8) oy += 8 - y; else if (y + bh > h - 8) oy -= y + bh - (h - 8);
    limits();
  }
  canvas.addEventListener('keydown', (e) => {
    if (!geom) return;
    const { w, h } = size();
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (move) {
      e.preventDefault();
      const by = e.shiftKey ? 10 : 1;
      const now = cursor || [Math.floor(geom.nrow / 2), Math.floor(geom.ncol / 2)];
      const next = cursor ? [Math.max(0, Math.min(geom.nrow - 1, now[0] + move[0] * by)), Math.max(0, Math.min(geom.ncol - 1, now[1] + move[1] * by))] : now;
      keepInView(next);
      if (anchor) rectEnd = next;
      hover = null;
      if (tool() === 'brush' && e.altKey) applyCells([next]);
      setCursor(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!cursor) { setCursor([Math.floor(geom.nrow / 2), Math.floor(geom.ncol / 2)]); return; }
      const t = tool();
      if (t === 'rect') {
        if (!anchor) { anchor = cursor; rectEnd = cursor; readout.textContent = `${describe(cursor[0], cursor[1])} Corner set: move to the other corner and press Enter.`; redraw(); } else { applyCells(rectCells(anchor, cursor)); anchor = rectEnd = null; redraw(); }
      } else if (t === 'brush' || t === 'point') applyCells([cursor]);
    } else if (e.key === 'Escape') {
      if (anchor) { anchor = rectEnd = null; redraw(); }
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      // About the keyboard's cell, so it stays in view.
      e.preventDefault();
      const at = cursor ? [ox + ((geom.ex[cursor[1]] + geom.ex[cursor[1] + 1]) / 2) * scale, oy + ((geom.ey[cursor[0]] + geom.ey[cursor[0] + 1]) / 2) * scale] : [w / 2, h / 2];
      zoomAt(e.key === '+' || e.key === '=' ? 1.25 : 0.8, at[0], at[1]);
    }
    else if (e.key === '0') { e.preventDefault(); needFit = true; autoFit = true; redraw(); }
  });
  canvas.addEventListener('focus', () => { if (!cursor && geom) setCursor([Math.floor(geom.nrow / 2), Math.floor(geom.ncol / 2)]); });

  let lastWidth = 0;
  const resized = new ResizeObserver(() => {
    if (geom && canvas.clientWidth !== lastWidth) { lastWidth = canvas.clientWidth; fitHeight(geom.W, geom.H); }
    if (autoFit) needFit = true;
    redraw();
  });
  resized.observe(canvas);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw, { signal });
  signal.addEventListener('abort', () => { resized.disconnect(); cancelAnimationFrame(queued); });

  return {
    canvas,
    redraw,
    /** Fits the whole grid in view, as after a new grid or model. */
    fit() { needFit = true; autoFit = true; redraw(); },
    zoom(f) { const { w, h } = size(); zoomAt(f, w / 2, h / 2); },
    refreshReadout() { say(hover || cursor); },
    setBackdrop(b) { backdrop = b; redraw(); },
    /** Model coordinates of the grid's extent, for the backdrop: x east, y north from the lower-left corner. */
    extent: () => (geom ? { W: geom.W, H: geom.H } : null),
  };
}
