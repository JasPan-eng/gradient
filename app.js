(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (n) => String(+(+n).toFixed(1));

  /* ------------------------------------------------------------------ *
   * Color math
   * ------------------------------------------------------------------ */

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (rgb) =>
    '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  const toLinear = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const toGamma = (c) => {
    c = clamp(c, 0, 1);
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  };

  function rgbToOklab([r, g, b]) {
    r = toLinear(r); g = toLinear(g); b = toLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }

  function oklabToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
  }

  function mix(hexA, hexB, t, space) {
    const A = hexToRgb(hexA), B = hexToRgb(hexB);
    if (space === 'srgb') return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
    const a = rgbToOklab(A), b = rgbToOklab(B);
    return rgbToHex(oklabToRgb(a.map((v, i) => v + (b[i] - v) * t)));
  }

  function normalizeHex(str) {
    let s = String(str).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, '$&$&');
    return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  let uid = 1;
  const mkStop = (color, pos) => ({ id: uid++, color, pos: clamp(+(+pos).toFixed(1), 0, 100) });

  const TYPES = ['linear', 'radial', 'conic', 'shape', 'rd'];
  const FIELD_TYPES = ['shape', 'rd']; // drawn on a canvas from a field of values, not by CSS
  const SPACES = ['oklab', 'srgb'];
  const defaultHotspots = () => [{ x: 0.25, y: 0.62 }, { x: 0.5, y: 0.36 }, { x: 0.75, y: 0.62 }];

  const state = {
    type: 'linear',
    angle: 135,
    cx: 50,
    cy: 50,
    space: 'oklab',
    stops: [mkStop('#ffc56b', 0), mkStop('#f2617a', 50), mkStop('#5b3fd6', 100)],
    selected: null,
    hot: { mode: 'points', pts: defaultHotspots(), spread: 60, soft: 45 },
    rd: { f: 0.0545, k: 0.062, speed: 10, detail: 320 },
    grain: 0,
  };
  state.selected = state.stops[0].id;
  const isField = () => FIELD_TYPES.includes(state.type);

  const byId = (id) => state.stops.find((s) => s.id === id);
  const sorted = () => [...state.stops].sort((a, b) => a.pos - b.pos || a.id - b.id);

  /** Stops as plain sRGB. In "smooth" mode, extra stops are inserted so the
   *  OKLab blend looks the same in CSS, canvas and SVG. */
  function resolved() {
    const s = sorted();
    if (state.space === 'srgb') return s.map(({ color, pos }) => ({ color, pos }));
    const out = [];
    for (let i = 0; i < s.length; i++) {
      out.push({ color: s[i].color, pos: s[i].pos });
      const next = s[i + 1];
      if (!next) break;
      const span = next.pos - s[i].pos;
      if (span <= 0 || s[i].color === next.color) continue;
      const steps = clamp(Math.round((span / 100) * 16), 2, 16);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        out.push({ color: mix(s[i].color, next.color, t, 'oklab'), pos: s[i].pos + span * t });
      }
    }
    return out;
  }

  function colorAt(pos) {
    const s = sorted();
    if (pos <= s[0].pos) return s[0].color;
    if (pos >= s[s.length - 1].pos) return s[s.length - 1].color;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (pos >= a.pos && pos <= b.pos) {
        return b.pos === a.pos ? a.color : mix(a.color, b.color, (pos - a.pos) / (b.pos - a.pos), state.space);
      }
    }
    return s[0].color;
  }

  /* ------------------------------------------------------------------ *
   * Output builders
   * ------------------------------------------------------------------ */

  const stopList = (stops) => stops.map((s) => `${s.color} ${fmt(s.pos)}%`).join(', ');

  function cssGradient(stops, interp) {
    const i = interp ? ` in ${interp}` : '';
    const list = stopList(stops);
    if (state.type === 'linear') return `linear-gradient(${fmt(state.angle)}deg${i}, ${list})`;
    const at = `at ${fmt(state.cx)}% ${fmt(state.cy)}%`;
    if (state.type === 'radial') return `radial-gradient(circle farthest-corner ${at}${i}, ${list})`;
    return `conic-gradient(from ${fmt(state.angle)}deg ${at}${i}, ${list})`;
  }

  function cssCode() {
    if (isField()) {
      return [
        '/* Hotspot and reaction gradients cannot be written as a CSS gradient.',
        '   Download a PNG or JPG below and use it as an image: */',
        'background: url("gradient.png") center / cover;',
      ].join('\n');
    }
    const plain = sorted();
    const lines = state.space === 'srgb'
      ? [`background: ${cssGradient(plain)};`]
      : [
        '/* fallback for older browsers */',
        `background: ${cssGradient(plain)};`,
        `background: ${cssGradient(plain, 'oklab')};`,
      ];
    if (state.grain) lines.push('/* Grain is not part of the CSS. It is baked into PNG and JPG downloads. */');
    return lines.join('\n');
  }

  /** Geometry shared by canvas and SVG, in pixels. */
  function geometry(w, h) {
    if (state.type === 'linear') {
      const a = (state.angle * Math.PI) / 180;
      const dx = Math.sin(a), dy = -Math.cos(a);
      const len = Math.abs(w * dx) + Math.abs(h * dy);
      return {
        x1: w / 2 - (dx * len) / 2, y1: h / 2 - (dy * len) / 2,
        x2: w / 2 + (dx * len) / 2, y2: h / 2 + (dy * len) / 2,
      };
    }
    const cx = (w * state.cx) / 100, cy = (h * state.cy) / 100;
    const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    return { cx, cy, r };
  }

  function svgCode(w, h) {
    if (state.type === 'conic' || isField()) {
      return '<!-- SVG can only hold linear and radial gradients. Download a PNG instead, or switch the type. -->';
    }
    const g = geometry(w, h);
    const n = (v) => String(+v.toFixed(2));
    const stops = resolved()
      .map((s) => `      <stop offset="${fmt(s.pos)}%" stop-color="${s.color}"/>`)
      .join('\n');
    const def =
      state.type === 'linear'
        ? `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}">\n${stops}\n    </linearGradient>`
        : `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${n(g.cx)}" cy="${n(g.cy)}" r="${n(g.r)}">\n${stops}\n    </radialGradient>`;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      '  <defs>',
      `    ${def}`,
      '  </defs>',
      `  <rect width="${w}" height="${h}" fill="url(#g)"/>`,
      '</svg>',
    ].join('\n');
  }

  function jsonCode() {
    const out = { type: { shape: 'hotspots', rd: 'reaction-diffusion' }[state.type] || state.type };
    if (state.type === 'linear' || state.type === 'conic') out.angle = state.angle;
    if (state.type === 'radial' || state.type === 'conic') out.center = { x: state.cx, y: state.cy };
    out.interpolation = state.space;
    out.stops = sorted().map((s) => ({ color: s.color, position: s.pos }));
    if (state.grain) out.grain = state.grain;
    if (isField()) {
      out.hotspots = {
        shape: state.hot.mode,
        points: state.hot.pts.map((p) => ({ x: +(p.x * 100).toFixed(1), y: +(p.y * 100).toFixed(1) })),
      };
      if (state.type === 'shape') {
        out.hotspots.spread = state.hot.spread;
        if (state.hot.mode === 'points') out.hotspots.softness = state.hot.soft;
      } else {
        out.reaction = { model: 'gray-scott', feed: state.rd.f, kill: state.rd.k, diffusionA: 1, diffusionB: 0.5 };
      }
    } else {
      out.css = cssGradient(sorted(), state.space === 'oklab' ? 'oklab' : '');
    }
    return JSON.stringify(out, null, 2);
  }

  /* Grain: one fixed tile of grey noise, laid over the gradient with the
     "overlay" blend. The same tile is used on screen and in downloads. */
  let grainTile = null;
  function grainCanvas() {
    if (grainTile) return grainTile;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const im = ctx.createImageData(256, 256);
    let s = 0x9e3779b9;
    for (let i = 0; i < im.data.length; i += 4) {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const v = ((t ^ (t >>> 14)) >>> 0) & 255;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return (grainTile = c);
  }
  const grainAlpha = () => (state.grain / 100) * 0.55;

  function paint(canvas, w, h) {
    paintBase(canvas, w, h);
    if (!state.grain) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalAlpha = grainAlpha();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(grainCanvas(), 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function paintBase(canvas, w, h) {
    if (isField()) {
      const lutNow = buildLut();
      if (state.type === 'shape') {
        const [fw, fh] = gridDims(Math.min(900, Math.max(w, h)));
        drawField(canvas, shapeField(fw, fh), fw, fh, w, h, lutNow);
      } else {
        if (rdKey() !== rd.key) rdInit();
        drawField(canvas, rdOutput(), rd.w, rd.h, w, h, lutNow);
      }
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const g = geometry(w, h);
    let grad;
    if (state.type === 'linear') grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    else if (state.type === 'radial') grad = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r);
    else grad = ctx.createConicGradient(((state.angle - 90) * Math.PI) / 180, g.cx, g.cy);
    for (const s of resolved()) grad.addColorStop(clamp(s.pos / 100, 0, 1), s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /* ------------------------------------------------------------------ *
   * Elements
   * ------------------------------------------------------------------ */

  const els = {
    preview: $('#preview'), track: $('#track'), handles: $('#handles'), hint: $('#hint'),
    angle: $('#angle'), angleNum: $('#angle-num'), angleRow: $('#angle-row'), angleLabel: $('#angle-label'),
    centerRows: $('#center-rows'), cx: $('#cx'), cy: $('#cy'), cxOut: $('#cx-out'), cyOut: $('#cy-out'),
    list: $('#stops'), code: $('#code'), dlSvg: $('#dl-svg'),
    size: $('#size'), w: $('#w'), h: $('#h'), toast: $('#toast'),
    canvas: $('#canvas'), gl: $('#gl'), overlay: $('#overlay'), hotHandles: $('#hot-handles'),
    curves: [$('#curve-shadow'), $('#curve-main')],
    hotCard: $('#hot-card'), rdCard: $('#rd-card'), hotNote: $('#hot-note'),
    spreadRow: $('#spread-row'), softRow: $('#soft-row'),
    spread: $('#spread'), soft: $('#soft'), spreadOut: $('#spread-out'), softOut: $('#soft-out'),
    rdPreset: $('#rd-preset'), rdF: $('#rd-f'), rdK: $('#rd-k'), rdSpeed: $('#rd-speed'), rdDetail: $('#rd-detail'),
    rdFOut: $('#rd-f-out'), rdKOut: $('#rd-k-out'), rdSpeedOut: $('#rd-speed-out'), rdDetailOut: $('#rd-detail-out'),
    rdPlay: $('#rd-play'), canvasPlay: $('#canvas-play'),
    grain: $('#grain-range'), grainOut: $('#grain-out'), grainLayer: $('#grain'), hud: $('#hud'),
    undo: $('#undo'), redo: $('#redo'),
  };
  const root = document.documentElement;

  let hudTimer;
  function hud(text) {
    els.hud.textContent = text;
    els.hud.classList.add('is-on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => els.hud.classList.remove('is-on'), 900);
  }

  const fillRange = (el) =>
    el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
  const fillRanges = () => document.querySelectorAll('input[type="range"]').forEach(fillRange);
  document.addEventListener('input', (e) => { if (e.target.type === 'range') fillRange(e.target); });

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 1800);
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  const handleEls = new Map();
  const rowEls = new Map();
  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const setRadio = (name, value) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  };
  const setValue = (el, v) => { if (document.activeElement !== el) el.value = v; };

  function renderHandles() {
    const ids = new Set(state.stops.map((s) => s.id));
    for (const [id, el] of handleEls) if (!ids.has(id)) { el.remove(); handleEls.delete(id); }
    for (const s of state.stops) {
      let el = handleEls.get(s.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'handle';
        el.dataset.id = s.id;
        el.tabIndex = 0;
        el.setAttribute('role', 'slider');
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', '100');
        els.handles.append(el);
        handleEls.set(s.id, el);
      }
      el.style.left = s.pos + '%';
      el.style.setProperty('--c', s.color);
      el.classList.toggle('is-selected', s.id === state.selected);
      el.setAttribute('aria-valuenow', String(Math.round(s.pos)));
      el.setAttribute('aria-label', `Color stop ${s.color}`);
    }
  }

  function renderList(forceOrder) {
    const ids = new Set(state.stops.map((s) => s.id));
    for (const [id, el] of rowEls) if (!ids.has(id)) { el.remove(); rowEls.delete(id); }
    for (const s of state.stops) {
      let row = rowEls.get(s.id);
      if (!row) {
        row = document.createElement('div');
        row.className = 'stop-row';
        row.dataset.id = s.id;
        row.innerHTML =
          '<input type="color" aria-label="Color">' +
          '<input type="text" class="hex" spellcheck="false" autocomplete="off" maxlength="7" aria-label="Hex color">' +
          '<label class="pos"><input type="number" min="0" max="100" step="1" aria-label="Position"><span>%</span></label>' +
          '<button type="button" class="icon-btn" aria-label="Remove stop" title="Remove stop"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>';
        els.list.append(row);
        rowEls.set(s.id, row);
      }
      const [color, hex, pos] = row.querySelectorAll('input');
      setValue(color, s.color);
      setValue(hex, s.color);
      setValue(pos, fmt(s.pos));
      row.classList.toggle('is-selected', s.id === state.selected);
    }
    // Keep rows in position order, but never shuffle them under the user's cursor.
    if (forceOrder || !els.list.contains(document.activeElement)) {
      const want = sorted().map((s) => s.id);
      const have = [...els.list.children].map((el) => +el.dataset.id);
      if (want.join() !== have.join()) want.forEach((id) => els.list.append(rowEls.get(id)));
    }
  }

  function renderControls() {
    setRadio('type', state.type);
    setRadio('space', state.space);
    const field = isField();
    const isRd = state.type === 'rd';
    els.angleRow.hidden = state.type === 'radial' || field;
    els.centerRows.hidden = state.type === 'linear' || field;
    els.angleLabel.textContent = state.type === 'conic' ? 'Start' : 'Angle';

    els.hotCard.hidden = !field;
    els.rdCard.hidden = !isRd;
    els.spreadRow.hidden = isRd;
    els.softRow.hidden = isRd || state.hot.mode !== 'points';
    setRadio('hot-mode', state.hot.mode);
    setValue(els.spread, state.hot.spread);
    setValue(els.soft, state.hot.soft);
    els.spreadOut.textContent = state.hot.spread;
    els.softOut.textContent = state.hot.soft;
    els.hotNote.textContent =
      (isRd
        ? 'The reaction grows from these. Moving them restarts the growth. '
        : 'The gradient starts at the hotspots and spreads outward. ') +
      'Click the canvas to add a point, drag to move it, double-click to remove it.';

    setValue(els.rdF, state.rd.f);
    setValue(els.rdK, state.rd.k);
    setValue(els.rdSpeed, state.rd.speed);
    setValue(els.rdDetail, state.rd.detail);
    els.rdFOut.textContent = state.rd.f.toFixed(4);
    els.rdKOut.textContent = state.rd.k.toFixed(4);
    els.rdSpeedOut.textContent = state.rd.speed;
    els.rdDetailOut.textContent = state.rd.detail;
    const preset = Object.keys(RD_PRESETS).find(
      (name) => RD_PRESETS[name][0] === state.rd.f && RD_PRESETS[name][1] === state.rd.k);
    els.rdPreset.value = preset || 'custom';
    els.rdPlay.textContent = rd.playing ? 'Pause' : 'Play';
    els.canvasPlay.hidden = !isRd;
    els.preview.classList.toggle('is-playing', rd.playing);
    setValue(els.grain, state.grain);
    els.grainOut.textContent = state.grain;
    setValue(els.angle, state.angle);
    setValue(els.angleNum, state.angle);
    setValue(els.cx, state.cx);
    setValue(els.cy, state.cy);
    els.cxOut.textContent = state.cx;
    els.cyOut.textContent = state.cy;
    els.hint.textContent =
      (field
        ? 'Click the canvas to place hotspots.'
        : state.type === 'linear'
          ? 'Drag the canvas to turn the gradient.'
          : 'Drag the canvas to move the center.') + ' Click the bar to add a color stop.';
    fillRanges();
    els.undo.disabled = !history.length && serialize() === committed;
    els.redo.disabled = !future.length;
  }

  function exportSize() {
    return {
      w: clamp(Math.round(+els.w.value) || 1, 1, 8192),
      h: clamp(Math.round(+els.h.value) || 1, 1, 8192),
    };
  }

  function currentCode() {
    const f = radio('fmt');
    if (f === 'css') return cssCode();
    if (f === 'json') return jsonCode();
    const { w, h } = exportSize();
    return svgCode(w, h);
  }

  function renderCode() {
    els.code.textContent = currentCode();
    const noSvg = state.type === 'conic' || isField();
    els.dlSvg.disabled = noSvg;
    els.dlSvg.title = noSvg ? 'SVG can only hold linear and radial gradients' : '';
  }

  function render(opts) {
    const res = resolved();
    renderPreview(res);
    els.track.style.background = `linear-gradient(90deg, ${stopList(res)})`;
    root.style.setProperty('--stops', stopList(res));
    root.style.setProperty('--c0', res[0].color);
    root.style.setProperty('--c1', res[res.length - 1].color);
    renderHandles();
    renderList(opts && opts.forceOrder);
    renderControls();
    renderCode();
    scheduleCommit();
  }

  /* ------------------------------------------------------------------ *
   * History, link sharing
   * ------------------------------------------------------------------ */

  const serialize = () => {
    let out =
      `t=${state.type}&a=${fmt(state.angle)}&x=${fmt(state.cx)}&y=${fmt(state.cy)}&m=${state.space}` +
      `&s=${sorted().map((s) => `${s.color.slice(1)}:${fmt(s.pos)}`).join(',')}`;
    if (isField()) {
      const pts = state.hot.pts.map((p) => `${Math.round(p.x * 1000)}-${Math.round(p.y * 1000)}`).join('_');
      out += `&hm=${state.hot.mode}&p=${pts}&sp=${state.hot.spread}&so=${state.hot.soft}`;
    }
    if (state.type === 'rd') out += `&f=${state.rd.f}&k=${state.rd.k}&v=${state.rd.speed}&d=${state.rd.detail}`;
    if (state.grain) out += `&g=${state.grain}`;
    return out;
  };

  function deserialize(str) {
    const p = new URLSearchParams(str);
    const stops = (p.get('s') || '')
      .split(',')
      .map((part) => {
        const [c, pos] = part.split(':');
        const color = normalizeHex(c || '');
        const n = parseFloat(pos);
        return color && Number.isFinite(n) ? mkStop(color, n) : null;
      })
      .filter(Boolean);
    if (stops.length < 2) return false;
    const num = (key, lo, hi, fallback) => {
      const n = parseFloat(p.get(key));
      return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
    };
    state.type = TYPES.includes(p.get('t')) ? p.get('t') : 'linear';
    state.space = SPACES.includes(p.get('m')) ? p.get('m') : 'oklab';
    state.angle = num('a', 0, 360, 90);
    state.cx = num('x', 0, 100, 50);
    state.cy = num('y', 0, 100, 50);
    state.stops = stops.slice(0, 32);
    state.selected = sorted()[0].id;
    state.grain = Math.round(num('g', 0, 100, 0));

    if (p.has('p')) {
      const pts = p.get('p').split('_').map((pair) => {
        const [x, y] = pair.split('-').map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x / 1000, 0, 1), y: clamp(y / 1000, 0, 1) } : null;
      }).filter(Boolean).slice(0, 12);
      if (pts.length) state.hot.pts = pts;
      state.hot.mode = p.get('hm') === 'curve' ? 'curve' : 'points';
      state.hot.spread = Math.round(num('sp', 5, 150, 60));
      state.hot.soft = Math.round(num('so', 0, 100, 45));
    }
    if (p.has('f')) {
      state.rd.f = num('f', 0.01, 0.1, 0.0545);
      state.rd.k = num('k', 0.045, 0.07, 0.062);
      state.rd.speed = Math.round(num('v', 1, 30, 10));
      state.rd.detail = clamp(Math.round(num('d', 160, 480, 320) / 40) * 40, 160, 480);
    }
    return true;
  }

  const history = [];
  const future = [];
  let committed = '';
  let commitTimer;

  function commit() {
    clearTimeout(commitTimer);
    const now = serialize();
    if (now === committed) return;
    if (committed) history.push(committed);
    if (history.length > 100) history.shift();
    future.length = 0;
    committed = now;
    els.undo.disabled = false;
    els.redo.disabled = true;
    try { window.history.replaceState(null, '', '#' + now); } catch (e) { /* file:// in some browsers */ }
  }

  function restore(target) {
    committed = target;
    deserialize(target);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    render({ forceOrder: true });
    try { window.history.replaceState(null, '', '#' + target); } catch (e) { /* ignore */ }
  }

  function redo() {
    clearTimeout(commitTimer);
    if (!future.length || serialize() !== committed) return toast('Nothing to redo');
    history.push(committed);
    restore(future.pop());
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 400);
  }

  function undo() {
    clearTimeout(commitTimer);
    let target;
    const now = serialize();
    if (now !== committed) target = committed;       // drop uncommitted edits
    else if (history.length) target = history.pop();
    else return toast('Nothing to undo');
    future.push(now);
    restore(target);
  }

  /* ------------------------------------------------------------------ *
   * Stops: bar
   * ------------------------------------------------------------------ */

  function removeStop(id) {
    if (state.stops.length <= 2) return toast('A gradient needs at least two stops');
    const gone = byId(id);
    state.stops = state.stops.filter((s) => s.id !== id);
    const nearest = [...state.stops].sort((a, b) => Math.abs(a.pos - gone.pos) - Math.abs(b.pos - gone.pos))[0];
    state.selected = nearest.id;
    render({ forceOrder: true });
  }

  function addStop(pos) {
    if (state.stops.length >= 32) { toast('That is plenty of stops'); return null; }
    const stop = mkStop(colorAt(pos), pos);
    state.stops.push(stop);
    state.selected = stop.id;
    return stop;
  }

  function drag(onMove) {
    const up = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const trackPos = (e) => {
    const r = els.track.getBoundingClientRect();
    return clamp(+(((e.clientX - r.left) / r.width) * 100).toFixed(1), 0, 100);
  };

  els.track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    const h = e.target.closest('.handle');
    const stop = h ? byId(+h.dataset.id) : addStop(trackPos(e));
    if (!stop) return;
    state.selected = stop.id;
    render();
    handleEls.get(stop.id).focus();
    drag((ev) => { stop.pos = trackPos(ev); render(); });
  });

  els.handles.addEventListener('focusin', (e) => {
    const h = e.target.closest('.handle');
    if (h && state.selected !== +h.dataset.id) { state.selected = +h.dataset.id; render(); }
  });

  els.handles.addEventListener('keydown', (e) => {
    const h = e.target.closest('.handle');
    if (!h) return;
    const stop = byId(+h.dataset.id);
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') stop.pos = clamp(stop.pos - step, 0, 100);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') stop.pos = clamp(stop.pos + step, 0, 100);
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeStop(stop.id);
      const next = handleEls.get(state.selected);
      if (next) next.focus();
      return;
    } else return;
    e.preventDefault();
    render();
  });

  /* ------------------------------------------------------------------ *
   * Stops: list
   * ------------------------------------------------------------------ */

  const rowStop = (e) => {
    const row = e.target.closest('.stop-row');
    return row ? byId(+row.dataset.id) : null;
  };

  els.list.addEventListener('focusin', (e) => {
    const stop = rowStop(e);
    if (stop && state.selected !== stop.id) { state.selected = stop.id; render(); }
  });

  els.list.addEventListener('input', (e) => {
    const stop = rowStop(e);
    if (!stop) return;
    const t = e.target;
    if (t.type === 'color') stop.color = t.value.toLowerCase();
    else if (t.type === 'text') {
      const hex = normalizeHex(t.value);
      if (!hex) return;
      stop.color = hex;
    } else if (t.type === 'number') {
      const n = parseFloat(t.value);
      if (!Number.isFinite(n)) return;
      stop.pos = clamp(+n.toFixed(1), 0, 100);
    }
    render();
  });

  els.list.addEventListener('change', (e) => {
    const stop = rowStop(e);
    if (!stop) return;
    // Snap the field back to the canonical value once the user is done typing.
    if (e.target.type === 'text') e.target.value = stop.color;
    if (e.target.type === 'number') e.target.value = fmt(stop.pos);
  });

  els.list.addEventListener('focusout', () => {
    // Re-sort once focus has left the list.
    setTimeout(() => { if (!els.list.contains(document.activeElement)) renderList(true); }, 0);
  });

  els.list.addEventListener('click', (e) => {
    if (!e.target.closest('.icon-btn')) return;
    const stop = rowStop(e);
    if (stop) removeStop(stop.id);
  });

  $('#add-stop').addEventListener('click', () => {
    // Drop the new stop into the widest gap.
    const s = sorted();
    let pos = 50, best = -1;
    for (let i = 0; i < s.length - 1; i++) {
      const gap = s[i + 1].pos - s[i].pos;
      if (gap > best) { best = gap; pos = s[i].pos + gap / 2; }
    }
    if (addStop(pos)) render({ forceOrder: true });
  });

  /* ------------------------------------------------------------------ *
   * Gradient controls
   * ------------------------------------------------------------------ */

  $('#type').addEventListener('change', () => { state.type = radio('type'); render(); });
  $('#space').addEventListener('change', () => { state.space = radio('space'); render(); });

  const onAngle = (e) => {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n)) return;
    state.angle = clamp(Math.round(n), 0, 360);
    render();
  };
  els.angle.addEventListener('input', onAngle);
  els.angleNum.addEventListener('input', onAngle);
  els.angleNum.addEventListener('change', () => { els.angleNum.value = state.angle; });
  els.cx.addEventListener('input', () => { state.cx = +els.cx.value; render(); });
  els.cy.addEventListener('input', () => { state.cy = +els.cy.value; render(); });

  els.preview.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('.canvas-btn')) return;
    e.preventDefault();
    if (isField()) return hotPointer(e);
    const apply = (ev) => {
      const r = els.preview.getBoundingClientRect();
      if (state.type === 'linear') {
        const dx = ev.clientX - (r.left + r.width / 2);
        const dy = ev.clientY - (r.top + r.height / 2);
        if (Math.hypot(dx, dy) < 4) return;
        let a = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        state.angle = (a + 360) % 360;
      } else {
        state.cx = clamp(Math.round(((ev.clientX - r.left) / r.width) * 100), 0, 100);
        state.cy = clamp(Math.round(((ev.clientY - r.top) / r.height) * 100), 0, 100);
      }
      hud(state.type === 'linear' ? `${state.angle}°` : `${state.cx}% · ${state.cy}%`);
      render();
    };
    apply(e);
    drag(apply);
  });

  /* ------------------------------------------------------------------ *
   * Header actions
   * ------------------------------------------------------------------ */

  function setStops(colors, positions) {
    state.stops = colors.map((c, i) => mkStop(c, positions ? positions[i] : (i / (colors.length - 1)) * 100));
    state.selected = state.stops[0].id;
  }

  $('#random').addEventListener('click', () => {
    const n = 2 + Math.floor(Math.random() * 3);
    const h0 = Math.random() * 360;
    const spread = (40 + Math.random() * 100) * (Math.random() < 0.5 ? -1 : 1);
    const l0 = 0.86 + Math.random() * 0.08;
    const l1 = 0.36 + Math.random() * 0.22;
    const chroma = 0.1 + Math.random() * 0.09;
    const colors = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const h = ((h0 + spread * t) * Math.PI) / 180;
      const c = chroma * (0.75 + 0.25 * Math.sin(Math.PI * t) + 0.25 * t);
      colors.push(rgbToHex(oklabToRgb([l0 + (l1 - l0) * t, c * Math.cos(h), c * Math.sin(h)])));
    }
    setStops(colors);
    render({ forceOrder: true });
  });

  $('#reverse').addEventListener('click', () => {
    for (const s of state.stops) s.pos = +(100 - s.pos).toFixed(1);
    render({ forceOrder: true });
  });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);

  /* presets */
  const PRESETS = [
    ['Sunset', 'ffc56b', 'f2617a', '5b3fd6'], ['Peach', 'ffe3c2', 'ff9a8b', 'ff5f7e'],
    ['Ember', 'fceabb', 'f8a100', 'd1451e', '4a1414'], ['Rose', 'fbd3e9', 'e96aa8', '7a1f5c'],
    ['Candy', 'ff9a9e', 'fad0c4', 'a18cd1'], ['Plum', 'f6d5f7', 'b06ab3', '4568dc'],
    ['Dusk', 'f7b267', 'c3507b', '2b1055'], ['Ice', 'f4f7ff', 'c9d6ff', '6b8cff'],
    ['Ocean', 'a8edea', '3fa7d6', '1b3a8f'], ['Lagoon', '43e97b', '38d9d7', '2f6fed'],
    ['Aurora', '7bf2c8', '1e7d92', '3b1f7a'], ['Mint', 'e3fc9c', '96e6a1', '2ba784'],
    ['Forest', 'e9f5a1', '5fa55a', '0b3d2e'], ['Neon', 'f9f047', '0fd850', '0a6a5c'],
    ['Sand', 'f5e6ca', 'd9b382', '8c5a3c'], ['Mono', 'f4f4f1', '8a8a86', '1a1a18'],
  ];
  const presetsEl = $('#presets');
  for (const [name, ...cols] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.title = name;
    b.setAttribute('aria-label', `${name} preset`);
    b.dataset.colors = cols.join(',');
    b.style.background = `linear-gradient(135deg, ${cols.map((c) => '#' + c).join(', ')})`;
    presetsEl.append(b);
  }
  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.preset');
    if (!b) return;
    commit();
    setStops(b.dataset.colors.split(',').map((c) => '#' + c));
    render({ forceOrder: true });
  });

  /* focus mode, theme, shortcuts */
  const keysDialog = $('#keys');
  function toggleZen() {
    const on = document.body.classList.toggle('is-zen');
    if (on) toast('Focus mode. Press F or Esc to bring the controls back.');
  }
  $('#zen').addEventListener('click', toggleZen);
  $('#keys-open').addEventListener('click', () => keysDialog.showModal());
  keysDialog.addEventListener('click', (e) => { if (e.target === keysDialog) keysDialog.close(); });

  $('#theme').addEventListener('click', () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('gradient-theme', root.dataset.theme); } catch (e) { /* private mode */ }
  });

  function togglePlay() { rd.playing = !rd.playing; render(); }
  els.canvasPlay.addEventListener('click', togglePlay);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = !!(t.matches && t.matches('input[type="text"], input[type="number"], select, textarea'));
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (typing || (key !== 'z' && key !== 'y')) return; // text fields keep their own undo
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.altKey || typing || keysDialog.open) return;
    if (key === 'escape' && document.body.classList.contains('is-zen')) return toggleZen();
    if (key === ' ') {
      if (state.type !== 'rd' || (t.matches && t.matches('button, input, label, [role="button"]'))) return;
      e.preventDefault();
      return togglePlay();
    }
    const type = TYPES[+key - 1];
    if (type) { state.type = type; return render(); }
    const action = { r: '#random', x: '#reverse', c: '#copy-code', f: '#zen', '?': '#keys-open' }[key];
    if (action) { e.preventDefault(); $(action).click(); }
  });

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
      if (!ok) return toast('Could not copy. Select the text and copy it by hand.');
    }
    toast(msg);
  }

  $('#share').addEventListener('click', () => {
    commit();
    copy(location.href.split('#')[0] + '#' + serialize(), 'Link copied');
  });

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */

  $('#fmt').addEventListener('change', renderCode);
  $('#copy-code').addEventListener('click', () => copy(currentCode(), `${radio('fmt').toUpperCase()} copied`));

  els.size.addEventListener('change', () => {
    if (els.size.value === 'custom') return;
    if (els.size.value === 'fit') fitSize();
    else [els.w.value, els.h.value] = els.size.value.split('x');
    render();
  });
  for (const el of [els.w, els.h]) {
    el.addEventListener('input', () => {
      const match = [...els.size.options].find((o) => o.value === `${+els.w.value}x${+els.h.value}`);
      els.size.value = match ? match.value : 'custom';
      render();
    });
    el.addEventListener('change', () => {
      const s = exportSize();
      els.w.value = s.w;
      els.h.value = s.h;
      render();
    });
  }

  /** "Fit window": the canvas fills the space it has, at screen resolution. */
  function fitSize() {
    const area = $('.canvas-area');
    if (!area.clientWidth || !area.clientHeight) return; // page not laid out yet (hidden tab)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.w.value = clamp(Math.round(area.clientWidth * dpr), 1, 8192);
    els.h.value = clamp(Math.round(area.clientHeight * dpr), 1, 8192);
  }

  let fitTimer;
  new ResizeObserver(() => {
    sizeGrain();
    if (els.size.value !== 'fit') return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const before = `${els.w.value}x${els.h.value}`;
      fitSize();
      if (before !== `${els.w.value}x${els.h.value}`) render();
    }, 150);
  }).observe($('.canvas-area'));

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dl]');
    if (!btn) return;
    const kind = btn.dataset.dl;
    const { w, h } = exportSize();
    if (kind === 'svg') {
      download(new Blob([svgCode(w, h)], { type: 'image/svg+xml' }), 'gradient.svg');
      return;
    }
    const canvas = document.createElement('canvas');
    try {
      paint(canvas, w, h);
    } catch (err) {
      return toast('This browser cannot draw that gradient type');
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) return toast('That size is too large for this browser');
        download(blob, `gradient-${w}x${h}.${kind}`);
      },
      kind === 'jpg' ? 'image/jpeg' : 'image/png',
      0.95
    );
  });

  /* ------------------------------------------------------------------ *
   * From image
   * ------------------------------------------------------------------ */

  const img = {
    data: null, w: 0, h: 0, url: null,
    a: { x: 0.12, y: 0.5 }, b: { x: 0.88, y: 0.5 },
  };
  const imgEls = {
    card: $('#image-card'), drop: $('#drop'), file: $('#file'), ui: $('#image-ui'),
    wrap: $('#img-wrap'), img: $('#img'), count: $('#img-count'), countOut: $('#img-count-out'),
    a: $('#pt-a'), b: $('#pt-b'), lines: [$('#line-shadow'), $('#line-main')],
  };

  function sampleAt(u, v) {
    const { data, w, h } = img;
    const x0 = Math.round(u * (w - 1)), y0 = Math.round(v * (h - 1));
    const rad = Math.max(1, Math.round(Math.max(w, h) * 0.02));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, y0 - rad); y <= Math.min(h - 1, y0 + rad); y++) {
      for (let x = Math.max(0, x0 - rad); x <= Math.min(w - 1, x0 + rad); x++) {
        const o = (y * w + x) * 4;
        if (data[o + 3] < 128) continue;
        r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
      }
    }
    return n ? rgbToHex([r / n, g / n, b / n]) : '#ffffff';
  }

  /** k-means in OKLab, returned as a smooth chain starting from the lightest color. */
  function mainColors(k) {
    const { data, w, h } = img;
    const total = w * h;
    const pts = [];
    const want = Math.min(total, 4000);
    for (let i = 0; i < want; i++) {
      const o = (Math.floor((i * total) / want)) * 4;
      if (data[o + 3] < 128) continue;
      pts.push(rgbToOklab([data[o], data[o + 1], data[o + 2]]));
    }
    if (!pts.length) return null;
    pts.sort((p, q) => p[0] - q[0]);
    let cents = Array.from({ length: k }, (_, i) =>
      pts[Math.min(pts.length - 1, Math.floor(((i + 0.5) / k) * pts.length))].slice());
    for (let it = 0; it < 14; it++) {
      const sum = cents.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const q = cents[c];
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (d < bd) { bd = d; best = c; }
        }
        const s = sum[best];
        s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      }
      cents = cents.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
    }
    // Order as a chain: start at the lightest, then always step to the closest
    // remaining color, so neighbours in the gradient are neighbours in color.
    cents.sort((p, q) => q[0] - p[0]);
    const chain = [cents.shift()];
    while (cents.length) {
      const last = chain[chain.length - 1];
      let best = 0, bd = Infinity;
      cents.forEach((c, i) => {
        const d = (c[0] - last[0]) ** 2 + (c[1] - last[1]) ** 2 + (c[2] - last[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      chain.push(cents.splice(best, 1)[0]);
    }
    return chain.map((c) => rgbToHex(oklabToRgb(c)));
  }

  function placeLine() {
    const { a, b } = img;
    imgEls.a.style.left = a.x * 100 + '%';
    imgEls.a.style.top = a.y * 100 + '%';
    imgEls.b.style.left = b.x * 100 + '%';
    imgEls.b.style.top = b.y * 100 + '%';
    for (const line of imgEls.lines) {
      line.setAttribute('x1', a.x * 100); line.setAttribute('y1', a.y * 100);
      line.setAttribute('x2', b.x * 100); line.setAttribute('y2', b.y * 100);
    }
    if (img.data) {
      imgEls.a.style.setProperty('--c', sampleAt(a.x, a.y));
      imgEls.b.style.setProperty('--c', sampleAt(b.x, b.y));
    }
  }

  function extract() {
    if (!img.data) return;
    const n = +imgEls.count.value;
    const mode = radio('img-mode');
    imgEls.wrap.classList.toggle('mode-palette', mode === 'palette');
    imgEls.countOut.textContent = n;
    placeLine();
    let colors;
    if (mode === 'palette') {
      colors = mainColors(n);
      if (!colors) return toast('That image is fully transparent');
    } else {
      colors = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        colors.push(sampleAt(img.a.x + (img.b.x - img.a.x) * t, img.a.y + (img.b.y - img.a.y) * t));
      }
    }
    setStops(colors);
    render({ forceOrder: true });
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return toast('That file is not an image');
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const scale = Math.min(1, 320 / Math.max(el.naturalWidth, el.naturalHeight));
      const w = Math.max(1, Math.round(el.naturalWidth * scale));
      const h = Math.max(1, Math.round(el.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(el, 0, 0, w, h);
      img.data = ctx.getImageData(0, 0, w, h).data;
      img.w = w; img.h = h;
      if (img.url) URL.revokeObjectURL(img.url);
      img.url = url;
      imgEls.img.src = url;
      imgEls.drop.hidden = true;
      imgEls.ui.hidden = false;
      commit(); // so Undo brings back the gradient from before the image
      extract();
    };
    el.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image'); };
    el.src = url;
  }

  imgEls.file.addEventListener('change', () => {
    if (imgEls.file.files[0]) loadImage(imgEls.file.files[0]);
    imgEls.file.value = '';
  });
  $('#img-replace').addEventListener('click', () => imgEls.file.click());
  $('#img-remove').addEventListener('click', () => {
    img.data = null;
    if (img.url) URL.revokeObjectURL(img.url);
    img.url = null;
    imgEls.img.removeAttribute('src');
    imgEls.ui.hidden = true;
    imgEls.drop.hidden = false;
  });
  $('#img-mode').addEventListener('change', extract);
  imgEls.count.addEventListener('input', extract);

  for (const [el, pt] of [[imgEls.a, img.a], [imgEls.b, img.b]]) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      el.focus();
      drag((ev) => {
        const r = imgEls.img.getBoundingClientRect();
        pt.x = clamp((ev.clientX - r.left) / r.width, 0, 1);
        pt.y = clamp((ev.clientY - r.top) / r.height, 0, 1);
        extract();
      });
    });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      pt.x = clamp(pt.x + d[0], 0, 1);
      pt.y = clamp(pt.y + d[1], 0, 1);
      extract();
    });
  }

  // Drop anywhere on the page, or paste.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    document.body.classList.add('is-dragover');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragover');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragover');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    loadImage(file);
  });
  window.addEventListener('paste', (e) => {
    const file = e.clipboardData && [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); loadImage(file); }
  });

  /* ------------------------------------------------------------------ *
   * Field gradients: hotspots and reaction-diffusion
   *
   * Both make a grid of values from 0 to 1 (a "field") and color it
   * through the gradient. Hotspots: distance from points or a curve.
   * Reaction: a Gray-Scott simulation seeded at the hotspots.
   * ------------------------------------------------------------------ */

  let lut = null;

  /** 1024-step color ramp built from the stops. */
  function buildLut() {
    const s = sorted();
    const ok = state.space === 'oklab';
    const cols = s.map((st) => (ok ? rgbToOklab(hexToRgb(st.color)) : hexToRgb(st.color)));
    const out = new Uint8ClampedArray(1024 * 3);
    let j = 0;
    for (let i = 0; i < 1024; i++) {
      const p = (i / 1023) * 100;
      while (j < s.length - 2 && p > s[j + 1].pos) j++;
      const a = s[j], b = s[j + 1];
      const t = b.pos === a.pos ? (p >= b.pos ? 1 : 0) : clamp((p - a.pos) / (b.pos - a.pos), 0, 1);
      const c = cols[j].map((v, n) => v + (cols[j + 1][n] - v) * t);
      const rgb = ok ? oklabToRgb(c) : c;
      out[i * 3] = rgb[0]; out[i * 3 + 1] = rgb[1]; out[i * 3 + 2] = rgb[2];
    }
    return out;
  }

  /** Grid size with the export's proportions and the given long side. */
  function gridDims(long) {
    const { w, h } = exportSize();
    return w >= h
      ? [long, Math.max(4, Math.round((long * h) / w))]
      : [Math.max(4, Math.round((long * w) / h)), long];
  }

  /** Smooth curve through the points, as cubic Bezier segments [p1, c1, c2, p2]. */
  function bezierSegs(P) {
    const segs = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      segs.push([
        p1,
        [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
        [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
        p2,
      ]);
    }
    return segs;
  }

  /** The curve flattened to a polyline, in grid pixels. */
  function curvePoly(pts, sx, sy) {
    const out = [];
    for (const [p1, c1, c2, p2] of bezierSegs(pts.map((p) => [p.x * sx, p.y * sy]))) {
      for (let k = 0; k < 14; k++) {
        const t = k / 14, u = 1 - t;
        out.push([
          u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
          u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
        ]);
      }
    }
    const last = pts[pts.length - 1];
    out.push([last.x * sx, last.y * sy]);
    return out;
  }

  /** Distance from the hotspots, 0 on them and 1 at the edge of the spread. */
  function shapeField(fw, fh) {
    const out = new Float32Array(fw * fh);
    const { mode, pts, spread, soft } = state.hot;
    const maxDim = Math.max(fw, fh);
    const reach = Math.max(1e-6, (spread / 100) * maxDim);

    if (mode === 'curve' && pts.length > 1) {
      const poly = curvePoly(pts, fw, fh);
      const n = poly.length - 1;
      const ax = new Float32Array(n), ay = new Float32Array(n);
      const dx = new Float32Array(n), dy = new Float32Array(n), inv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        ax[i] = poly[i][0]; ay[i] = poly[i][1];
        dx[i] = poly[i + 1][0] - ax[i]; dy[i] = poly[i + 1][1] - ay[i];
        inv[i] = 1 / Math.max(1e-9, dx[i] * dx[i] + dy[i] * dy[i]);
      }
      for (let y = 0, o = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++, o++) {
          const px = x + 0.5, py = y + 0.5;
          let best = Infinity;
          for (let i = 0; i < n; i++) {
            const rx = px - ax[i], ry = py - ay[i];
            let t = (rx * dx[i] + ry * dy[i]) * inv[i];
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = rx - dx[i] * t, ey = ry - dy[i] * t;
            const d2 = ex * ex + ey * ey;
            if (d2 < best) best = d2;
          }
          out[o] = Math.min(1, Math.sqrt(best) / reach);
        }
      }
      return out;
    }

    // Points. Softness melts neighbouring hotspots into each other (a smooth minimum).
    const n = pts.length;
    const qx = pts.map((p) => p.x * fw), qy = pts.map((p) => p.y * fh);
    const melt = (soft / 100) * 0.22 * maxDim;
    for (let y = 0, o = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++, o++) {
        const px = x + 0.5, py = y + 0.5;
        let best = Infinity, sum = 0;
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(px - qx[i], py - qy[i]);
          if (d < best) best = d;
          if (melt > 0) sum += Math.exp(-d / melt);
        }
        const d = melt > 0 && sum > 0 ? Math.max(0, -melt * Math.log(sum)) : best;
        out[o] = Math.min(1, d / reach);
      }
    }
    return out;
  }

  /** Color a field into a canvas of any size (bicubic when the sizes differ). */
  function drawField(canvas, field, fw, fh, W, H, ramp) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const im = ctx.createImageData(W, H);
    const d = im.data;
    const put = (o, v) => {
      const i = ((v <= 0 ? 0 : v >= 1 ? 1 : v) * 1023 + 0.5 | 0) * 3;
      d[o] = ramp[i]; d[o + 1] = ramp[i + 1]; d[o + 2] = ramp[i + 2]; d[o + 3] = 255;
    };
    if (W === fw && H === fh) {
      for (let i = 0, o = 0; i < field.length; i++, o += 4) put(o, field[i]);
    } else {
      const taps = (outN, srcN, stride) => {
        const idx = new Int32Array(outN * 4), wt = new Float32Array(outN * 4);
        for (let i = 0; i < outN; i++) {
          const s = ((i + 0.5) * srcN) / outN - 0.5;
          const i0 = Math.floor(s), t = s - i0, t2 = t * t, t3 = t2 * t;
          const w = [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
          for (let k = 0; k < 4; k++) {
            idx[i * 4 + k] = clamp(i0 - 1 + k, 0, srcN - 1) * stride;
            wt[i * 4 + k] = w[k];
          }
        }
        return [idx, wt];
      };
      const [xi, xw] = taps(W, fw, 1);
      const [yi, yw] = taps(H, fh, fw);
      for (let y = 0, o = 0; y < H; y++) {
        const y4 = y * 4;
        for (let x = 0; x < W; x++, o += 4) {
          const x4 = x * 4;
          let v = 0;
          for (let k = 0; k < 4; k++) {
            const r = yi[y4 + k];
            v += yw[y4 + k] * (
              xw[x4] * field[r + xi[x4]] + xw[x4 + 1] * field[r + xi[x4 + 1]] +
              xw[x4 + 2] * field[r + xi[x4 + 2]] + xw[x4 + 3] * field[r + xi[x4 + 3]]);
          }
          put(o, v);
        }
      }
    }
    ctx.putImageData(im, 0, 0);
  }

  /* ---------- reaction-diffusion (Gray-Scott, as in Karl Sims's tutorial) ---------- */

  // [feed, kill]
  const RD_PRESETS = {
    coral: [0.0545, 0.062],
    mitosis: [0.0367, 0.0649],
    spots: [0.03, 0.062],
    maze: [0.029, 0.057],
    holes: [0.039, 0.058],
    worms: [0.078, 0.061],
    waves: [0.014, 0.045],
  };

  const rd = {
    w: 0, h: 0, A: null, B: null, A2: null, B2: null, out: null, key: '', raf: 0, gpu: undefined,
    playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  const hotKey = () =>
    `${state.hot.mode}|${state.hot.pts.map((p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`).join(';')}`;
  const rdKey = () => `${gridDims(state.rd.detail).join('x')}|${hotKey()}`;

  /* The simulation runs on the GPU (WebGL2) when it can, and in plain
     JavaScript on a smaller budget when it cannot. Same equations either way. */

  const GL_VERT = `#version 300 es
in vec2 p;
out vec2 v;
void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const GL_SIM = `#version 300 es
precision highp float;
uniform sampler2D s;
uniform vec2 px;
uniform float f;
uniform float k;
in vec2 v;
out vec4 o;
void main() {
  vec2 c = texture(s, v).rg;
  vec2 lap =
    (texture(s, v + vec2(px.x, 0.0)).rg + texture(s, v - vec2(px.x, 0.0)).rg +
     texture(s, v + vec2(0.0, px.y)).rg + texture(s, v - vec2(0.0, px.y)).rg) * 0.2 +
    (texture(s, v + px).rg + texture(s, v - px).rg +
     texture(s, v + vec2(px.x, -px.y)).rg + texture(s, v + vec2(-px.x, px.y)).rg) * 0.05 - c;
  float abb = c.r * c.g * c.g;
  o = vec4(c.r + lap.r - abb + f * (1.0 - c.r), c.g + 0.5 * lap.g + abb - (k + f) * c.g, 0.0, 1.0);
}`;

  // Smooth (bicubic) upscale of the grid, then color through the ramp.
  const GL_SHOW = `#version 300 es
precision highp float;
uniform sampler2D s;
uniform sampler2D ramp;
uniform vec2 res;
in vec2 v;
out vec4 o;
vec2 field(vec2 uv) {
  vec2 st = uv * res - 0.5;
  vec2 i = floor(st);
  vec2 t = st - i;
  vec2 w0 = (1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0;
  vec2 w1 = (4.0 - 6.0 * t * t + 3.0 * t * t * t) / 6.0;
  vec2 w2 = (1.0 + 3.0 * t + 3.0 * t * t - 3.0 * t * t * t) / 6.0;
  vec2 w3 = t * t * t / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / res;
  vec2 h1 = (i + 1.5 + w3 / g1) / res;
  return g0.y * (g0.x * texture(s, vec2(h0.x, h0.y)).rg + g1.x * texture(s, vec2(h1.x, h0.y)).rg) +
         g1.y * (g0.x * texture(s, vec2(h0.x, h1.y)).rg + g1.x * texture(s, vec2(h1.x, h1.y)).rg);
}
void main() {
  vec2 c = field(vec2(v.x, 1.0 - v.y));
  float t = clamp(1.0 - c.r + c.g, 0.0, 1.0);
  o = vec4(texture(ramp, vec2(t * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5)).rgb, 1.0);
}`;

  function gpuInit() {
    if (rd.gpu !== undefined) return rd.gpu;
    rd.gpu = null;
    try {
      const gl = els.gl.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const program = (frag) => {
        const pr = gl.createProgram();
        gl.attachShader(pr, compile(gl.VERTEX_SHADER, GL_VERT));
        gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, frag));
        gl.bindAttribLocation(pr, 0, 'p');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        const u = {};
        for (const name of ['s', 'ramp', 'px', 'res', 'f', 'k']) u[name] = gl.getUniformLocation(pr, name);
        return { pr, u };
      };
      const texture = (wrap) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        return t;
      };
      const sim = program(GL_SIM), show = program(GL_SHOW);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      rd.gpu = {
        gl, sim, show, cur: 0,
        tex: [texture(gl.REPEAT), texture(gl.REPEAT)],
        fbo: [gl.createFramebuffer(), gl.createFramebuffer()],
        ramp: texture(gl.CLAMP_TO_EDGE),
      };
      els.gl.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        rd.gpu = null;   // carry on in JavaScript
        rd.key = '';
        render();
      });
    } catch (err) {
      rd.gpu = null;
    }
    return rd.gpu;
  }

  /** Send the freshly seeded grid to the GPU. */
  function gpuUpload() {
    const g = gpuInit();
    if (!g) return;
    const { gl } = g, { w, h } = rd;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = rd.A[i]; data[i * 4 + 1] = rd.B[i]; data[i * 4 + 3] = 1; }
    for (const j of [0, 1]) {
      gl.bindTexture(gl.TEXTURE_2D, g.tex[j]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, j === 0 ? data : null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[j]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.tex[j], 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { rd.gpu = null; return; }
    }
    g.cur = 0;
  }

  function gpuStep(n) {
    const g = rd.gpu, { gl } = g;
    gl.useProgram(g.sim.pr);
    gl.viewport(0, 0, rd.w, rd.h);
    gl.uniform1i(g.sim.u.s, 0);
    gl.uniform2f(g.sim.u.px, 1 / rd.w, 1 / rd.h);
    gl.uniform1f(g.sim.u.f, state.rd.f);
    gl.uniform1f(g.sim.u.k, state.rd.k);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < n; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[1 - g.cur]);
      gl.bindTexture(gl.TEXTURE_2D, g.tex[g.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      g.cur = 1 - g.cur;
    }
  }

  function gpuShow() {
    const g = rd.gpu, { gl } = g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = clamp(Math.round(els.preview.clientWidth * dpr), 16, 2400);
    const ch = clamp(Math.round(els.preview.clientHeight * dpr), 16, 2400);
    if (els.gl.width !== cw || els.gl.height !== ch) { els.gl.width = cw; els.gl.height = ch; }
    const rgba = new Uint8Array(1024 * 4);
    for (let i = 0; i < 1024; i++) {
      rgba[i * 4] = lut[i * 3]; rgba[i * 4 + 1] = lut[i * 3 + 1]; rgba[i * 4 + 2] = lut[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(g.show.pr);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex[g.cur]);
    gl.uniform1i(g.show.u.s, 0);
    gl.uniform1i(g.show.u.ramp, 1);
    gl.uniform2f(g.show.u.res, rd.w, rd.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Read the grid back from the GPU, for export. */
  function gpuRead() {
    const g = rd.gpu, { gl } = g;
    const buf = new Float32Array(rd.w * rd.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo[g.cur]);
    gl.readPixels(0, 0, rd.w, rd.h, gl.RGBA, gl.FLOAT, buf);
    for (let i = 0; i < rd.out.length; i++) rd.out[i] = 1 - buf[i * 4] + buf[i * 4 + 1];
    return rd.out;
  }

  /** Start over: chemical A everywhere, chemical B only on the hotspots. */
  function rdInit() {
    const [w, h] = gridDims(state.rd.detail);
    const n = w * h;
    rd.w = w; rd.h = h;
    rd.A = new Float32Array(n).fill(1);
    rd.B = new Float32Array(n);
    rd.A2 = new Float32Array(n);
    rd.B2 = new Float32Array(n);
    rd.out = new Float32Array(n);
    const stamp = (cx, cy, r) => {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          rd.B[(((y % h) + h) % h) * w + (((x % w) + w) % w)] = 1;
        }
      }
    };
    const { mode, pts } = state.hot;
    if (mode === 'curve' && pts.length > 1) {
      const poly = curvePoly(pts, w, h);
      for (let i = 0; i < poly.length - 1; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
        for (let s = 0; s <= steps; s++) stamp(x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps, 2.5);
      }
    } else {
      for (const p of pts) stamp(p.x * w, p.y * h, 5);
    }
    gpuUpload();
    rd.key = rdKey();
  }

  /** n steps of the two equations. The grid wraps, so the result tiles. */
  function rdStep(n) {
    if (rd.gpu) return gpuStep(n);
    const w = rd.w, h = rd.h, f = state.rd.f, kf = state.rd.k + state.rd.f;
    let A = rd.A, B = rd.B, A2 = rd.A2, B2 = rd.B2;
    for (let it = 0; it < n; it++) {
      for (let y = 0; y < h; y++) {
        const r = y * w, u = (y === 0 ? h - 1 : y - 1) * w, dn = (y === h - 1 ? 0 : y + 1) * w;
        for (let x = 0; x < w; x++) {
          const l = x === 0 ? w - 1 : x - 1, rt = x === w - 1 ? 0 : x + 1;
          const i = r + x, a = A[i], b = B[i];
          const la = (A[r + l] + A[r + rt] + A[u + x] + A[dn + x]) * 0.2 +
            (A[u + l] + A[u + rt] + A[dn + l] + A[dn + rt]) * 0.05 - a;
          const lb = (B[r + l] + B[r + rt] + B[u + x] + B[dn + x]) * 0.2 +
            (B[u + l] + B[u + rt] + B[dn + l] + B[dn + rt]) * 0.05 - b;
          const abb = a * b * b;
          A2[i] = a + la - abb + f * (1 - a);
          B2[i] = b + 0.5 * lb + abb - kf * b;
        }
      }
      let t = A; A = A2; A2 = t;
      t = B; B = B2; B2 = t;
    }
    rd.A = A; rd.B = B; rd.A2 = A2; rd.B2 = B2;
  }

  function rdOutput() {
    if (rd.gpu) return gpuRead();
    const { A, B, out } = rd;
    for (let i = 0; i < out.length; i++) out[i] = 1 - A[i] + B[i];
    return out;
  }

  function rdDraw() {
    if (rd.gpu) return gpuShow();
    const scale = Math.max(rd.w, rd.h) * 2 <= 960 ? 2 : 1;
    drawField(els.canvas, rdOutput(), rd.w, rd.h, rd.w * scale, rd.h * scale, lut);
  }

  function rdFrame() {
    rd.raf = 0;
    if (state.type !== 'rd' || !rd.playing) return;
    rdStep(state.rd.speed);
    rdDraw();
    rd.raf = requestAnimationFrame(rdFrame);
  }

  /* ---------- preview ---------- */

  const shapeCache = { key: '', field: null, fw: 0, fh: 0 };

  /** Scale the grain so a tile covers the same share of the picture as in the download. */
  function sizeGrain() {
    if (!state.grain) return;
    const pw = els.preview.clientWidth;
    const size = pw ? (256 * pw) / exportSize().w : 256;
    els.grainLayer.style.backgroundSize = `${size.toFixed(2)}px`;
  }

  function renderPreview(res) {
    const field = isField();
    const { w, h } = exportSize();
    els.preview.style.setProperty('--ar', (w / h).toFixed(5));
    els.grainLayer.hidden = !state.grain;
    if (state.grain) {
      if (!els.grainLayer.style.backgroundImage) {
        els.grainLayer.style.backgroundImage = `url(${grainCanvas().toDataURL()})`;
      }
      els.grainLayer.style.opacity = grainAlpha();
      sizeGrain();
    }
    els.overlay.hidden = !field;
    if (!field) els.canvas.hidden = els.gl.hidden = true;
    if (!field) {
      els.preview.style.background = cssGradient(res);
      return;
    }
    els.preview.style.background = 'none';
    lut = buildLut();
    if (state.type === 'shape') {
      const [fw, fh] = gridDims(360);
      const key = `${fw}x${fh}|${hotKey()}|${state.hot.spread}|${state.hot.soft}`;
      if (key !== shapeCache.key) Object.assign(shapeCache, { key, fw, fh, field: shapeField(fw, fh) });
      drawField(els.canvas, shapeCache.field, fw, fh, fw, fh, lut);
      els.canvas.hidden = false;
      els.gl.hidden = true;
    } else {
      if (rdKey() !== rd.key) rdInit();
      els.gl.hidden = !rd.gpu;
      els.canvas.hidden = !!rd.gpu;
      if (rd.playing) { if (!rd.raf) rd.raf = requestAnimationFrame(rdFrame); }
      else rdDraw();
    }
    renderOverlay();
  }

  /* ---------- hotspot handles on the canvas ---------- */

  const hotEls = [];
  let hotSel = -1;

  function renderOverlay() {
    const pts = state.hot.pts;
    while (hotEls.length > pts.length) hotEls.pop().remove();
    while (hotEls.length < pts.length) {
      const el = document.createElement('div');
      el.className = 'hot';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      els.hotHandles.append(el);
      hotEls.push(el);
    }
    pts.forEach((p, i) => {
      const el = hotEls[i];
      el.dataset.i = i;
      el.style.left = p.x * 100 + '%';
      el.style.top = p.y * 100 + '%';
      el.classList.toggle('is-selected', i === hotSel);
      el.setAttribute('aria-label', `Hotspot ${i + 1} of ${pts.length}. Arrow keys move it, Delete removes it.`);
    });
    const xy = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    const d = state.hot.mode === 'curve' && pts.length > 1
      ? bezierSegs(pts.map((p) => [p.x * 100, p.y * 100]))
        .map((s, i) => `${i ? '' : 'M' + xy(s[0])}C${xy(s[1])} ${xy(s[2])} ${xy(s[3])}`).join('')
      : '';
    for (const path of els.curves) path.setAttribute('d', d);
  }

  function hotPointer(e) {
    const where = (ev) => {
      const r = els.preview.getBoundingClientRect();
      return { x: clamp((ev.clientX - r.left) / r.width, 0, 1), y: clamp((ev.clientY - r.top) / r.height, 0, 1) };
    };
    const h = e.target.closest('.hot');
    let i;
    if (h) i = +h.dataset.i;
    else {
      if (state.hot.pts.length >= 12) return toast('Twelve hotspots is the limit');
      state.hot.pts.push(where(e));
      i = state.hot.pts.length - 1;
    }
    hotSel = i;
    render();
    hotEls[i].focus();
    const pt = state.hot.pts[i];
    drag((ev) => { Object.assign(pt, where(ev)); render(); });
  }

  function removeHotspot(i) {
    if (state.hot.pts.length <= 1) return toast('Keep at least one hotspot');
    state.hot.pts.splice(i, 1);
    hotSel = Math.min(i, state.hot.pts.length - 1);
    render();
    hotEls[hotSel].focus();
  }

  els.hotHandles.addEventListener('dblclick', (e) => {
    const h = e.target.closest('.hot');
    if (h) removeHotspot(+h.dataset.i);
  });

  els.hotHandles.addEventListener('focusin', (e) => {
    const h = e.target.closest('.hot');
    if (h && hotSel !== +h.dataset.i) { hotSel = +h.dataset.i; renderOverlay(); }
  });

  els.hotHandles.addEventListener('keydown', (e) => {
    const h = e.target.closest('.hot');
    if (!h) return;
    const i = +h.dataset.i, pt = state.hot.pts[i];
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      pt.x = clamp(pt.x + d[0], 0, 1);
      pt.y = clamp(pt.y + d[1], 0, 1);
      render();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeHotspot(i);
    }
  });

  /* ---------- hotspot and reaction controls ---------- */

  $('#hot-mode').addEventListener('change', () => { state.hot.mode = radio('hot-mode'); render(); });
  els.spread.addEventListener('input', () => { state.hot.spread = +els.spread.value; render(); });
  els.soft.addEventListener('input', () => { state.hot.soft = +els.soft.value; render(); });
  $('#hot-reset').addEventListener('click', () => { state.hot.pts = defaultHotspots(); hotSel = -1; render(); });

  els.rdPreset.addEventListener('change', () => {
    const preset = RD_PRESETS[els.rdPreset.value];
    if (!preset) return;
    [state.rd.f, state.rd.k] = preset;
    render();
  });
  els.rdF.addEventListener('input', () => { state.rd.f = +els.rdF.value; render(); });
  els.rdK.addEventListener('input', () => { state.rd.k = +els.rdK.value; render(); });
  els.rdSpeed.addEventListener('input', () => { state.rd.speed = +els.rdSpeed.value; render(); });
  els.rdDetail.addEventListener('input', () => { state.rd.detail = +els.rdDetail.value; render(); });
  els.rdPlay.addEventListener('click', togglePlay);
  els.grain.addEventListener('input', () => { state.grain = +els.grain.value; render(); });
  $('#rd-restart').addEventListener('click', () => { rdInit(); render(); });

  /* ------------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------------ */

  if (location.hash.length > 1) deserialize(location.hash.slice(1));
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== serialize() && deserialize(location.hash.slice(1))) render({ forceOrder: true });
  });

  els.size.value = 'fit';
  fitSize();
  placeLine();
  render({ forceOrder: true });
  committed = serialize();
  els.undo.disabled = true;
})();
