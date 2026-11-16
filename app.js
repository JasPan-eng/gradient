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
  const defaultFx = () => ({
    lut: '', lutMix: 100, blur: 'none', blurAmt: 35, blurAngle: 0,
    half: 'none', halfSize: 10, halfAngle: 30, print: 0,
  });
  const defaultText = () => ({
    str: '', font: 'sans', size: 12, spacing: 0, color: '#fafaf7', blend: 'normal', x: 50, y: 50, under: false,
  });
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
    steps: 0, // 0 is a smooth blend; 2 and up cuts the gradient into that many flat bands
    fx: defaultFx(),
    text: defaultText(),
  };
  state.selected = state.stops[0].id;
  const isField = () => FIELD_TYPES.includes(state.type);

  const byId = (id) => state.stops.find((s) => s.id === id);
  const sorted = () => [...state.stops].sort((a, b) => a.pos - b.pos || a.id - b.id);

  /** Stops as plain sRGB. In "smooth" mode, extra stops are inserted so the
   *  OKLab blend looks the same in CSS, canvas and SVG. */
  function resolved(raw) {
    const g = raw ? null : grade();
    const tone = (hex) => (g ? rgbToHex(g(hexToRgb(hex))) : hex);
    if (state.steps > 1) {
      const n = state.steps, out = [];
      for (let i = 0; i < n; i++) {
        const color = tone(colorAt((i / (n - 1)) * 100));
        out.push({ color, pos: (i / n) * 100 }, { color, pos: ((i + 1) / n) * 100 });
      }
      return out;
    }
    const s = sorted();
    if (g) {
      // a grade can bend the colors between two stops, so sample the gradient densely
      const at = new Set(s.map((st) => st.pos));
      for (let i = 0; i <= 40; i++) at.add(i * 2.5);
      return [...at].sort((p, q) => p - q).map((pos) => ({ color: tone(colorAt(pos)), pos }));
    }
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
    const stepped = state.steps > 1 || !!grade();
    const plain = stepped ? resolved() : sorted();
    const lines = state.space === 'srgb' || stepped
      ? [`background: ${cssGradient(plain)};`]
      : [
        '/* fallback for older browsers */',
        `background: ${cssGradient(plain)};`,
        `background: ${cssGradient(plain, 'oklab')};`,
      ];
    if (state.grain || fxActive()) {
      lines.push('/* Blur, halftone, print texture, grain and type are not part of the CSS.', '   They are in PNG and JPG downloads. */');
    }
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
    const note = state.grain || fxActive()
      ? ['<!-- Blur, halftone, print texture, grain and type are only in PNG and JPG downloads. -->'] : [];
    const stops = resolved()
      .map((s) => `      <stop offset="${fmt(s.pos)}%" stop-color="${s.color}"/>`)
      .join('\n');
    const def =
      state.type === 'linear'
        ? `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}">\n${stops}\n    </linearGradient>`
        : `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${n(g.cx)}" cy="${n(g.cy)}" r="${n(g.r)}">\n${stops}\n    </radialGradient>`;
    return [
      ...note,
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
    if (state.steps > 1) out.steps = state.steps;
    const f = state.fx, fxOut = {};
    if (f.lut && f.lutMix) fxOut.grade = { look: f.lut.replace(/^u:/, ''), strength: f.lutMix };
    if (f.blur !== 'none') fxOut.blur = { kind: f.blur, amount: f.blurAmt };
    if (f.half !== 'none') fxOut.halftone = { kind: f.half, size: f.halfSize, angle: f.halfAngle };
    if (f.print) fxOut.printTexture = f.print;
    if (Object.keys(fxOut).length) out.effects = fxOut;
    if (hasText()) {
      const t = state.text;
      out.text = { content: t.str, font: t.font, size: t.size, color: t.color, blend: t.blend, x: t.x, y: t.y };
    }
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
      out.css = state.steps > 1 || grade()
        ? cssGradient(resolved())
        : cssGradient(sorted(), state.space === 'oklab' ? 'oklab' : '');
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
    finishFx(canvas);
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
    steps: $('#steps'), stepsOut: $('#steps-out'),
    guide: $('#guide'), guideDots: $('#guide-dots'), guideLines: [$('#guide-shadow'), $('#guide-main')],
    saved: $('#saved'), savedNote: $('#saved-note'),
    fx: $('#fx'), lut: $('#lut'), lutMix: $('#lut-mix'), lutMixOut: $('#lut-mix-out'), lutMixRow: $('#lut-mix-row'),
    lutFile: $('#lut-file'), lutRemove: $('#lut-remove'),
    blur: $('#blur'), blurAmt: $('#blur-amt'), blurAmtOut: $('#blur-amt-out'), blurAmtRow: $('#blur-amt-row'),
    blurAngle: $('#blur-angle'), blurAngleOut: $('#blur-angle-out'), blurAngleRow: $('#blur-angle-row'),
    half: $('#half'), halfSize: $('#half-size'), halfSizeOut: $('#half-size-out'), halfSizeRow: $('#half-size-row'),
    halfAngle: $('#half-angle'), halfAngleOut: $('#half-angle-out'), halfAngleRow: $('#half-angle-row'),
    print: $('#print'), printOut: $('#print-out'),
    text: $('#text'), textRows: $('#text-rows'), textFont: $('#text-font'),
    textSize: $('#text-size'), textSizeOut: $('#text-size-out'),
    textSpacing: $('#text-spacing'), textSpacingOut: $('#text-spacing-out'),
    textColor: $('#text-color'), textBlend: $('#text-blend'), typeHandle: $('#type-handle'),
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
    setValue(els.steps, state.steps > 1 ? state.steps : 1);
    els.stepsOut.textContent = state.steps > 1 ? state.steps : 'Off';
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
    renderFxControls();
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
    els.track.style.background = `linear-gradient(90deg, ${stopList(resolved(true))})`;
    root.style.setProperty('--stops', stopList(res));
    root.style.setProperty('--c0', res[0].color);
    root.style.setProperty('--c1', res[res.length - 1].color);
    renderHandles();
    renderGuide();
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
    if (state.steps > 1) out += `&n=${state.steps}`;
    const f = state.fx, t = state.text;
    if (f.lut) out += `&l=${encodeURIComponent(f.lut)}&lm=${f.lutMix}`;
    if (f.blur !== 'none') out += `&b=${f.blur},${f.blurAmt},${f.blurAngle}`;
    if (f.half !== 'none') out += `&h=${f.half},${f.halfSize},${f.halfAngle}`;
    if (f.print) out += `&pt=${f.print}`;
    if (hasText()) {
      out += `&tx=${encodeURIComponent(t.str)}&ts=` +
        [t.font, t.size, t.spacing, t.color.slice(1), t.blend, fmt(t.x), fmt(t.y), t.under ? 1 : 0].join(',');
    }
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
    state.steps = Math.round(num('n', 0, 24, 0));
    if (state.steps < 2) state.steps = 0;

    const fx = defaultFx();
    const look = p.get('l') || '';
    if (LOOKS[look] || look.startsWith('u:')) fx.lut = look.slice(0, 64);
    fx.lutMix = Math.round(num('lm', 0, 100, 100));
    const b = (p.get('b') || '').split(',');
    if (['soft', 'motion', 'zoom', 'spin'].includes(b[0])) {
      fx.blur = b[0];
      fx.blurAmt = clamp(Math.round(+b[1]) || 35, 1, 100);
      fx.blurAngle = clamp(Math.round(+b[2]) || 0, 0, 180);
    }
    const hf = (p.get('h') || '').split(',');
    if (['color', 'ink', 'cmyk', 'lines'].includes(hf[0])) {
      fx.half = hf[0];
      fx.halfSize = clamp(Math.round(+hf[1]) || 10, 4, 40);
      fx.halfAngle = clamp(Math.round(+hf[2]) || 0, 0, 90);
    }
    fx.print = Math.round(num('pt', 0, 100, 0));
    state.fx = fx;

    const text = defaultText();
    if (p.has('tx')) {
      text.str = p.get('tx').slice(0, 400);
      const ts = (p.get('ts') || '').split(',');
      if (FONTS[ts[0]]) text.font = ts[0];
      text.size = clamp(parseFloat(ts[1]) || 12, 2, 40);
      text.spacing = clamp(Math.round(parseFloat(ts[2])) || 0, -10, 50);
      text.color = normalizeHex(ts[3] || '') || text.color;
      if (BLENDS.includes(ts[4])) text.blend = ts[4];
      text.x = clamp(Number.isFinite(parseFloat(ts[5])) ? parseFloat(ts[5]) : 50, 0, 100);
      text.y = clamp(Number.isFinite(parseFloat(ts[6])) ? parseFloat(ts[6]) : 50, 0, 100);
      text.under = ts[7] === '1';
    }
    state.text = text;

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

  function drag(onMove, onUp) {
    const up = () => {
      if (onUp) onUp();
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
    const el = handleEls.get(stop.id);
    el.focus();
    let leaving = false;
    drag((ev) => {
      const r = els.track.getBoundingClientRect();
      const away = Math.max(r.top - ev.clientY, ev.clientY - r.bottom);
      leaving = state.stops.length > 2 && away > 56;
      el.classList.toggle('is-leaving', leaving);
      if (!leaving) stop.pos = trackPos(ev);
      hud(leaving ? 'Release to remove' : `${fmt(stop.pos)}%`);
      render();
    }, () => {
      el.classList.remove('is-leaving');
      if (leaving) removeStop(stop.id);
    });
  });

  /** Open the browser's color picker for a stop. */
  function pickColor(id) {
    const row = rowEls.get(id);
    const input = row && row.querySelector('input[type="color"]');
    if (!input) return;
    try {
      if (input.showPicker) input.showPicker(); else input.click();
    } catch (err) {
      toast('Open the controls to pick a color');
    }
  }
  els.handles.addEventListener('dblclick', (e) => {
    const h = e.target.closest('.handle');
    if (h) pickColor(+h.dataset.id);
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
    if (e.target === els.typeHandle) return typePointer(e);
    if (isField()) return hotPointer(e);
    const dot = e.target.closest('.gdot');
    if (dot) return guidePointer(e, +dot.dataset.id);
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
    const action = { r: '#random', x: '#reverse', c: '#copy-code', s: '#save', f: '#zen', '?': '#keys-open' }[key];
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

  let fitTimer, fxTimer;
  new ResizeObserver(() => {
    sizeGrain();
    if (fxActive()) { clearTimeout(fxTimer); fxTimer = setTimeout(render, 160); }
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
    const out = buildRamp();
    const g = grade();
    if (g) {
      for (let i = 0; i < out.length; i += 3) {
        const c = g([out[i], out[i + 1], out[i + 2]]);
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
      }
    }
    return out;
  }

  function buildRamp() {
    const s = sorted();
    const ok = state.space === 'oklab';
    const cols = s.map((st) => (ok ? rgbToOklab(hexToRgb(st.color)) : hexToRgb(st.color)));
    const out = new Uint8ClampedArray(1024 * 3);
    if (state.steps > 1) {
      const n = state.steps;
      const bands = Array.from({ length: n }, (_, b) => hexToRgb(colorAt((b / (n - 1)) * 100)));
      for (let i = 0; i < 1024; i++) out.set(bands[Math.min(n - 1, Math.floor((i * n) / 1024))], i * 3);
      return out;
    }
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
    if (rd.gpu) gpuShow();
    else {
      const scale = Math.max(rd.w, rd.h) * 2 <= 960 ? 2 : 1;
      drawField(els.canvas, rdOutput(), rd.w, rd.h, rd.w * scale, rd.h * scale, lut);
    }
    if (fxActive()) fxPreview(rd.gpu ? els.gl : els.canvas);
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
    const fxOn = fxActive();
    els.fx.hidden = !fxOn;
    if (!field) els.canvas.hidden = els.gl.hidden = true;
    if (!field) {
      els.preview.style.background = cssGradient(res);
      if (fxOn) fxPreview();
      return;
    }
    els.preview.style.background = 'none';
    lut = buildLut();
    if (state.type === 'shape') {
      const [fw, fh] = gridDims(360);
      const key = `${fw}x${fh}|${hotKey()}|${state.hot.spread}|${state.hot.soft}`;
      if (key !== shapeCache.key) Object.assign(shapeCache, { key, fw, fh, field: shapeField(fw, fh) });
      drawField(els.canvas, shapeCache.field, fw, fh, fw, fh, lut);
      if (fxOn) fxPreview(els.canvas);
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
  els.steps.addEventListener('input', () => {
    const v = +els.steps.value;
    state.steps = v > 1 ? v : 0;
    render();
  });
  $('#rd-restart').addEventListener('click', () => { rdInit(); render(); });

  /* ---------- the gradient's line on the canvas ---------- */

  const guideEls = new Map();
  let guideGeo = null; // in percent of the canvas

  function guideDot(key) {
    let el = guideEls.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'gdot';
      if (key === 'pivot') el.classList.add('is-pivot');
      else el.dataset.id = key;
      els.guideDots.append(el);
      guideEls.set(key, el);
    }
    return el;
  }

  function renderGuide() {
    els.guide.hidden = isField();
    if (isField()) return;
    const { w, h } = exportSize();
    const g = geometry(w, h);
    const px = (x) => (x / w) * 100, py = (y) => (y / h) * 100;
    let line, at;
    if (state.type === 'linear') {
      line = [px(g.x1), py(g.y1), px(g.x2), py(g.y2)];
      at = (t) => [line[0] + (line[2] - line[0]) * t, line[1] + (line[3] - line[1]) * t];
    } else if (state.type === 'radial') {
      // from the center to the farthest corner, which is where the last stop lands
      line = [state.cx, state.cy, state.cx < 50 ? 100 : 0, state.cy < 50 ? 100 : 0];
      at = (t) => [line[0] + (line[2] - line[0]) * t, line[1] + (line[3] - line[1]) * t];
    } else {
      const r = Math.min(w, h) * 0.3;
      at = (t) => {
        const a = ((state.angle + t * 360) * Math.PI) / 180;
        return [px(g.cx + r * Math.sin(a)), py(g.cy - r * Math.cos(a))];
      };
      line = [state.cx, state.cy, ...at(0)];
    }
    guideGeo = { line };
    for (const el of els.guideLines) {
      el.setAttribute('x1', line[0]); el.setAttribute('y1', line[1]);
      el.setAttribute('x2', line[2]); el.setAttribute('y2', line[3]);
    }
    const keys = new Set(state.stops.map((s) => s.id));
    if (state.type !== 'linear') keys.add('pivot');
    for (const [key, el] of guideEls) if (!keys.has(key)) { el.remove(); guideEls.delete(key); }
    if (state.type !== 'linear') {
      const pivot = guideDot('pivot');
      pivot.style.left = state.cx + '%';
      pivot.style.top = state.cy + '%';
    }
    for (const s of state.stops) {
      const el = guideDot(s.id);
      const [x, y] = at(s.pos / 100);
      el.style.left = x + '%';
      el.style.top = y + '%';
      el.style.setProperty('--c', s.color);
      el.classList.toggle('is-selected', s.id === state.selected);
    }
  }

  /** Drag a stop along the line on the canvas. */
  function guidePointer(e, id) {
    const stop = byId(id);
    if (!stop) return;
    state.selected = id;
    render();
    drag((ev) => {
      const r = els.preview.getBoundingClientRect();
      const [x1, y1, x2, y2] = guideGeo.line;
      const ax = r.left + (x1 / 100) * r.width, ay = r.top + (y1 / 100) * r.height;
      const dx = ev.clientX - ax, dy = ev.clientY - ay;
      if (state.type === 'conic') {
        if (Math.hypot(dx, dy) < 4) return;
        const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
        stop.pos = +(((((a - state.angle) % 360) + 360) % 360) / 3.6).toFixed(1);
      } else {
        const lx = ((x2 - x1) / 100) * r.width, ly = ((y2 - y1) / 100) * r.height;
        stop.pos = clamp(+(((dx * lx + dy * ly) / (lx * lx + ly * ly)) * 100).toFixed(1), 0, 100);
      }
      hud(`${fmt(stop.pos)}%`);
      render();
    });
  }

  els.guideDots.addEventListener('dblclick', (e) => {
    const dot = e.target.closest('.gdot');
    if (dot && dot.dataset.id) pickColor(+dot.dataset.id);
  });

  /* ---------- saved gradients (kept in this browser) ---------- */

  const SAVED_KEY = 'gradient-saved';
  let saved = [];
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY));
    if (Array.isArray(raw)) saved = raw.filter((v) => typeof v === 'string').slice(0, 24);
  } catch (e) { /* private mode, or nothing saved */ }

  function storeSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch (e) { /* private mode */ }
  }

  function renderSaved() {
    els.saved.textContent = '';
    els.savedNote.hidden = saved.length > 0;
    els.saved.hidden = !saved.length;
    saved.forEach((str, i) => {
      const stops = (new URLSearchParams(str).get('s') || '').split(',')
        .map((part) => { const [c, pos] = part.split(':'); return [normalizeHex(c || ''), parseFloat(pos)]; })
        .filter(([c, pos]) => c && Number.isFinite(pos));
      if (stops.length < 2) return;
      const item = document.createElement('div');
      item.className = 'saved-item';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.i = i;
      b.setAttribute('aria-label', `Saved gradient ${i + 1}`);
      b.style.background = `linear-gradient(135deg, ${stops.map(([c, pos]) => `${c} ${pos}%`).join(', ')})`;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'saved-x';
      x.dataset.i = i;
      x.title = 'Remove';
      x.setAttribute('aria-label', `Remove saved gradient ${i + 1}`);
      x.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
      item.append(b, x);
      els.saved.append(item);
    });
  }

  $('#save').addEventListener('click', () => {
    commit();
    const now = serialize();
    if (saved.includes(now)) return toast('Already saved');
    saved.unshift(now);
    saved = saved.slice(0, 24);
    storeSaved();
    renderSaved();
    toast('Saved in this browser');
  });

  els.saved.addEventListener('click', (e) => {
    const x = e.target.closest('.saved-x');
    if (x) {
      saved.splice(+x.dataset.i, 1);
      storeSaved();
      renderSaved();
      return;
    }
    const b = e.target.closest('.preset');
    if (!b) return;
    commit();
    if (deserialize(saved[+b.dataset.i])) render({ forceOrder: true });
  });

  /* ------------------------------------------------------------------ *
   * Effects: color grade, blur, halftone, print texture, type
   *
   * The color grade changes the gradient's colors themselves, so it shows
   * in every export. The rest is drawn on a canvas on top of the gradient
   * and is only in PNG and JPG downloads.
   * Sizes are in thousandths of the picture's long side ("u"), so the
   * preview and a download of any size look the same.
   * ------------------------------------------------------------------ */

  /* ---------- color grade ---------- */

  // name, then: sat (saturation), sh / hi (tint added to shadows / highlights),
  // con (contrast), fade (lifted blacks), swap (rotate the channels), neg (invert)
  const LOOKS = {
    film: ['Warm film', { sh: [-0.02, 0, 0.04], hi: [0.06, 0.02, -0.06], con: 1.08, sat: 0.95, fade: 0.05 }],
    teal: ['Teal and orange', { sh: [-0.07, 0.02, 0.09], hi: [0.09, 0.02, -0.09], con: 1.1, sat: 1.1 }],
    matte: ['Faded matte', { con: 0.88, sat: 0.8, fade: 0.14 }],
    bleach: ['Bleach bypass', { con: 1.3, sat: 0.45 }],
    cross: ['Cross process', { sh: [0, 0.05, 0.12], hi: [0.08, 0.07, -0.12], con: 1.15, sat: 1.15 }],
    cold: ['Cold night', { sh: [-0.04, 0, 0.08], hi: [-0.04, 0.01, 0.06], con: 1.05, sat: 0.85 }],
    sepia: ['Sepia', { sat: 0, sh: [0.05, 0, -0.05], hi: [0.09, 0.03, -0.08] }],
    noir: ['Noir', { sat: 0, con: 1.25 }],
    acid: ['Acid', { swap: true, sat: 1.15 }],
    neg: ['Negative', { neg: true }],
  };

  function lookFn(p) {
    const sh = p.sh || [0, 0, 0], hi = p.hi || [0, 0, 0];
    const con = p.con === undefined ? 1 : p.con, sat = p.sat === undefined ? 1 : p.sat, fade = p.fade || 0;
    return (r, g, b) => {
      if (p.neg) { r = 1 - r; g = 1 - g; b = 1 - b; }
      if (p.swap) { const t = r; r = g; g = b; b = t; }
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const ws = (1 - l) * (1 - l), wh = l * l;
      return [r, g, b].map((v, i) => {
        v = l + (v - l) * sat;
        v += sh[i] * ws + hi[i] * wh;
        v = (v - 0.5) * con + 0.5;
        return clamp(fade * 0.6 + v * (1 - fade), 0, 1);
      });
    };
  }

  /** A .cube file: a grid of n x n x n colors, red changing fastest. */
  function parseCube(text) {
    let n = 0;
    const vals = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      if (/^LUT_3D_SIZE/i.test(line)) { n = parseInt(line.split(/\s+/)[1], 10); continue; }
      if (/^[A-Za-z_]/.test(line)) continue; // TITLE, DOMAIN_MIN and the like
      const p = line.split(/\s+/);
      if (p.length >= 3) vals.push(+p[0], +p[1], +p[2]);
    }
    if (!(n >= 2 && n <= 65) || vals.length !== n * n * n * 3) return null;
    const data = Float32Array.from(vals);
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) return null;
    return { n, data };
  }

  function cubeFn({ n, data }) {
    const m = n - 1;
    return (r, g, b) => {
      const x = clamp(r, 0, 1) * m, y = clamp(g, 0, 1) * m, z = clamp(b, 0, 1) * m;
      const x0 = Math.min(m - 1, Math.floor(x)), y0 = Math.min(m - 1, Math.floor(y)), z0 = Math.min(m - 1, Math.floor(z));
      const fx = x - x0, fy = y - y0, fz = z - z0;
      const out = [0, 0, 0];
      for (let dz = 0; dz < 2; dz++) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const wt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
            const i = ((x0 + dx) + (y0 + dy) * n + (z0 + dz) * n * n) * 3;
            out[0] += wt * data[i]; out[1] += wt * data[i + 1]; out[2] += wt * data[i + 2];
          }
        }
      }
      return out;
    };
  }

  const userLuts = new Map(); // name -> { n, data }
  let gradeCache = { key: null, fn: null };

  /** The current color grade as a function on [r, g, b] in 0..255, or null. */
  function grade() {
    const { lut, lutMix } = state.fx;
    if (!lut || !lutMix) return null;
    const key = `${lut}|${lutMix}`;
    if (gradeCache.key === key) return gradeCache.fn;
    let core = null;
    if (lut.startsWith('u:')) {
      const found = userLuts.get(lut.slice(2));
      if (found) core = cubeFn(found);
    } else if (LOOKS[lut]) core = lookFn(LOOKS[lut][1]);
    const m = lutMix / 100;
    const fn = core && ((rgb) => {
      const o = core(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
      return [rgb[0] + (o[0] * 255 - rgb[0]) * m, rgb[1] + (o[1] * 255 - rgb[1]) * m, rgb[2] + (o[2] * 255 - rgb[2]) * m];
    });
    gradeCache = { key, fn };
    return fn;
  }

  /* loaded LUTs are kept in the browser's own database */
  const lutDb = () => new Promise((res, rej) => {
    const rq = indexedDB.open('gradient', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('luts', { keyPath: 'name' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  async function lutStore(mode, fn) {
    try {
      const db = await lutDb();
      return await new Promise((res, rej) => {
        const tx = db.transaction('luts', mode);
        const rq = fn(tx.objectStore('luts'));
        tx.oncomplete = () => res(rq && rq.result);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {
      return null; // private mode: LUTs last until the page closes
    }
  }

  function renderLutOptions() {
    els.lut.textContent = '';
    const opt = (value, label, parent) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      parent.append(o);
    };
    opt('', 'None', els.lut);
    const built = document.createElement('optgroup');
    built.label = 'Built in';
    for (const key of Object.keys(LOOKS)) opt(key, LOOKS[key][0], built);
    els.lut.append(built);
    if (userLuts.size) {
      const mine = document.createElement('optgroup');
      mine.label = 'Your LUTs';
      for (const name of [...userLuts.keys()].sort()) opt('u:' + name, name, mine);
      els.lut.append(mine);
    }
  }

  lutStore('readonly', (s) => s.getAll()).then((rows) => {
    if (!rows || !rows.length) return;
    for (const row of rows) {
      if (row && typeof row.name === 'string' && row.data && row.n) userLuts.set(row.name, { n: row.n, data: row.data });
    }
    renderLutOptions();
    gradeCache.key = null;
    render();
  });

  $('#lut-load').addEventListener('click', () => els.lutFile.click());
  els.lutFile.addEventListener('change', async () => {
    const files = [...els.lutFile.files].slice(0, 80);
    els.lutFile.value = '';
    if (!files.length) return;
    toast(files.length > 1 ? `Reading ${files.length} LUTs` : 'Reading the LUT');
    let ok = 0, last = '';
    for (const file of files) {
      if (file.size > 16e6) continue;
      let parsed = null;
      try { parsed = parseCube(await file.text()); } catch (e) { /* unreadable */ }
      if (!parsed) continue;
      const name = file.name.replace(/\.cube$/i, '').replace(/_+/g, ' ').trim().slice(0, 60) || 'LUT';
      userLuts.set(name, parsed);
      await lutStore('readwrite', (s) => s.put({ name, n: parsed.n, data: parsed.data }));
      ok++;
      last = name;
    }
    if (!ok) return toast('None of those were usable 3D .cube files');
    renderLutOptions();
    commit();
    state.fx.lut = 'u:' + last;
    gradeCache.key = null;
    render();
    toast(ok === 1 ? `Loaded ${last}` : `Loaded ${ok} LUTs`);
  });
  $('#lut-remove').addEventListener('click', () => {
    if (!state.fx.lut.startsWith('u:')) return;
    const name = state.fx.lut.slice(2);
    userLuts.delete(name);
    lutStore('readwrite', (s) => s.delete(name));
    state.fx.lut = '';
    renderLutOptions();
    render();
  });

  /* ---------- canvas helpers ---------- */

  const scratchPool = new Map();
  /** A reusable off-screen canvas. Setting its size also clears it. */
  function scratch(slot, w, h) {
    let c = scratchPool.get(slot);
    if (!c) { c = document.createElement('canvas'); scratchPool.set(slot, c); }
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** A copy of the canvas with its edge pixels stretched outward, so a blur has something to pull in. */
  function padded(src, pad) {
    const w = src.width, h = src.height;
    const c = scratch('pad', w + pad * 2, h + pad * 2);
    const t = c.getContext('2d');
    t.drawImage(src, pad, pad);
    if (pad) {
      t.drawImage(src, 0, 0, w, 1, pad, 0, w, pad);
      t.drawImage(src, 0, h - 1, w, 1, pad, pad + h, w, pad);
      t.drawImage(src, 0, 0, 1, h, 0, pad, pad, h);
      t.drawImage(src, w - 1, 0, 1, h, pad + w, pad, pad, h);
      t.drawImage(src, 0, 0, 1, 1, 0, 0, pad, pad);
      t.drawImage(src, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
      t.drawImage(src, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
      t.drawImage(src, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);
    }
    return c;
  }

  /* ---------- blur ---------- */

  function blurFx(canvas, ctx, w, h, u) {
    const { blur, blurAmt, blurAngle } = state.fx;
    const k = blurAmt / 100;
    const canFilter = typeof ctx.filter === 'string';
    const centered = state.type === 'radial' || state.type === 'conic';
    const cx = ((centered ? state.cx : 50) / 100) * w, cy = ((centered ? state.cy : 50) / 100) * h;
    const N = 32;
    ctx.save();
    if (blur === 'soft') {
      const r = Math.max(0.5, k * k * 90 * u);
      const pad = Math.ceil(r * 2.5);
      const src = padded(canvas, pad);
      if (canFilter) {
        ctx.filter = `blur(${r}px)`;
        ctx.drawImage(src, -pad, -pad);
      } else {
        // no canvas filters here (older Safari): shrink the picture and grow it back
        const f = Math.max(1, r / 1.5);
        const small = scratch('small', src.width / f, src.height / f);
        const sc = small.getContext('2d');
        sc.imageSmoothingQuality = 'high';
        sc.drawImage(src, 0, 0, small.width, small.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(small, -pad, -pad, src.width, src.height);
      }
    } else if (blur === 'motion') {
      const d = Math.max(1, k * 150 * u), a = (blurAngle * Math.PI) / 180;
      const pad = Math.ceil(d) + 2;
      const src = padded(canvas, pad);
      if (canFilter) ctx.filter = `blur(${Math.max(0.5, d / N)}px)`;
      for (let i = 0; i < N; i++) {
        const off = (i / (N - 1) - 0.5) * 2 * d;
        ctx.globalAlpha = 1 / (i + 1); // a running average of all the copies
        ctx.drawImage(src, -pad + Math.cos(a) * off, -pad + Math.sin(a) * off);
      }
    } else if (blur === 'zoom') {
      const src = padded(canvas, 0);
      for (let i = 0; i < N; i++) {
        const s = 1 + k * 0.45 * (i / (N - 1));
        ctx.globalAlpha = 1 / (i + 1);
        ctx.setTransform(s, 0, 0, s, cx * (1 - s), cy * (1 - s));
        ctx.drawImage(src, 0, 0);
      }
    } else if (blur === 'spin') {
      const ang = k * 0.7;
      const pad = Math.ceil(Math.hypot(w, h) * Math.sin(ang / 2)) + 2;
      const src = padded(canvas, pad);
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1) - 0.5) * ang, co = Math.cos(t), si = Math.sin(t);
        ctx.globalAlpha = 1 / (i + 1);
        ctx.setTransform(co, si, -si, co, cx - cx * co + cy * si, cy - cx * si - cy * co);
        ctx.drawImage(src, -pad, -pad);
      }
    }
    ctx.restore();
  }

  /* ---------- halftone ---------- */

  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const PAPER = '#f4f0e6';

  function halftoneFx(canvas, ctx, w, h, u) {
    const { half, halfSize, halfAngle } = state.fx;
    const cell = Math.max(3, halfSize * u);
    // a small copy of the picture to read colors from, about two samples per cell
    const sw = clamp(Math.round((w / cell) * 2), 2, 1400), sh = clamp(Math.round((h / cell) * 2), 2, 1400);
    const small = scratch('small', sw, sh);
    const sc = small.getContext('2d', { willReadFrequently: true });
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(canvas, 0, 0, sw, sh);
    const px = sc.getImageData(0, 0, sw, sh).data;
    const cx = w / 2, cy = h / 2;
    const reach = Math.ceil((Math.hypot(w, h) / 2 + cell) / cell) * cell;

    /** Visit every cell of a grid turned by `deg`, with the picture's color there. */
    const each = (deg, fn) => {
      const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
      for (let gy = -reach; gy <= reach; gy += cell) {
        for (let gx = -reach; gx <= reach; gx += cell) {
          const x = cx + gx * co - gy * si, y = cy + gx * si + gy * co;
          if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
          const o = (clamp(Math.floor((y / h) * sh), 0, sh - 1) * sw + clamp(Math.floor((x / w) * sw), 0, sw - 1)) * 4;
          fn(x, y, px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, gx, gy);
        }
      }
    };
    /** One ink: a dot per cell, its area set by `amount` (0 to 1). Drawn as a single path. */
    const dots = (deg, amount) => {
      ctx.beginPath();
      each(deg, (x, y, r, g, b) => {
        const v = amount(r, g, b);
        if (v <= 0.004) return;
        const rad = cell * 0.72 * Math.sqrt(v);
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, 6.2832);
      });
      ctx.fill();
    };

    ctx.save();
    if (half === 'color') {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, w, h);
      each(halfAngle, (x, y, r, g, b) => {
        const rad = cell * 0.68 * Math.sqrt(0.3 + 0.7 * (1 - luma(r, g, b)));
        ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, 6.2832);
        ctx.fill();
      });
    } else if (half === 'cmyk') {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'multiply';
      const key = (r, g, b) => 1 - Math.max(r, g, b);
      const part = (v, k) => (k >= 0.999 ? 0 : (1 - v - k) / (1 - k));
      ctx.fillStyle = '#00a6e4'; dots(halfAngle + 15, (r, g, b) => part(r, key(r, g, b)));
      ctx.fillStyle = '#ea0a8c'; dots(halfAngle + 75, (r, g, b) => part(g, key(r, g, b)));
      ctx.fillStyle = '#ffe800'; dots(halfAngle, (r, g, b) => part(b, key(r, g, b)));
      ctx.fillStyle = '#26221f'; dots(halfAngle + 45, (r, g, b) => key(r, g, b) * 0.9);
    } else {
      // two inks: the gradient's lightest color is the paper, its darkest is the ink
      const cols = resolved().map((s) => s.color);
      const lum = (hex) => { const c = hexToRgb(hex); return luma(c[0] / 255, c[1] / 255, c[2] / 255); };
      cols.sort((p, q) => lum(q) - lum(p));
      let paper = cols[0];
      const ink = cols[cols.length - 1];
      let hiL = lum(paper);
      const loL = lum(ink);
      if (hiL - loL < 0.2) { paper = PAPER; hiL = lum(PAPER); }
      const amount = (r, g, b) => clamp((hiL - luma(r, g, b)) / Math.max(0.05, hiL - loL), 0, 1);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      if (half === 'ink') dots(halfAngle, amount);
      else {
        // lines: each cell adds a short piece of a stripe, thicker where the picture is darker
        const a = (halfAngle * Math.PI) / 180;
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        each(halfAngle, (x, y, r, g, b, gx, gy) => {
          const t = cell * 0.96 * amount(r, g, b);
          if (t > 0.05) ctx.rect(gx - cell / 2 - 0.3, gy - t / 2, cell + 0.6, t);
        });
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---------- print texture: uneven paper, a warm tint, specks where the ink missed ---------- */

  let printCache = null;
  function printTiles() {
    if (printCache) return printCache;
    const N = 512;
    let seed = 0x2545f491;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // smooth noise that repeats at the tile's edges
    const layer = (cells) => {
      const g = new Float32Array(cells * cells);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      return (x, y) => {
        const fx = (x / N) * cells, fy = (y / N) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
        const top = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * tx;
        const bot = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * tx;
        return top + (bot - top) * ty;
      };
    };
    const big = layer(6), mid = layer(28), fine = layer(120);
    const paper = scratch('print-paper', N, N), specks = scratch('print-specks', N, N);
    const pc = paper.getContext('2d'), sc = specks.getContext('2d');
    const pim = pc.createImageData(N, N), sim = sc.createImageData(N, N);
    for (let y = 0, o = 0; y < N; y++) {
      for (let x = 0; x < N; x++, o += 4) {
        const v = 0.45 * big(x, y) + 0.3 * mid(x, y) + 0.25 * fine(x, y);
        const shade = 255 * (0.74 + 0.26 * v) + (rnd() - 0.5) * 16;
        pim.data[o] = pim.data[o + 1] = pim.data[o + 2] = shade;
        pim.data[o + 3] = 255;
        // ink drops out where the fine noise peaks
        const miss = fine(x + 37, y + 91) * 0.6 + rnd() * 0.4;
        if (miss > 0.83) {
          sim.data[o] = 246; sim.data[o + 1] = 242; sim.data[o + 2] = 232;
          sim.data[o + 3] = clamp((miss - 0.83) * 2600, 0, 235);
        }
      }
    }
    pc.putImageData(pim, 0, 0);
    sc.putImageData(sim, 0, 0);
    return (printCache = [paper, specks]);
  }

  function printFx(ctx, w, h) {
    const k = state.fx.print / 100;
    const [paper, specks] = printTiles();
    const s = Math.max(w, h) / 1500;
    const fill = (tile) => {
      const p = ctx.createPattern(tile, 'repeat');
      if (p.setTransform) p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, w, h);
    };
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = k;
    fill(paper);
    ctx.globalAlpha = k * 0.3;
    ctx.fillStyle = '#efe2c6';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = k * 0.85;
    fill(specks);
    ctx.restore();
  }

  /* ---------- type ---------- */

  // label, then a canvas font with % where the size goes
  const FONTS = {
    sans: ['Sans bold', '700 %px "Neue Haas Unica Pro", "Neue Haas Unica", "Helvetica Neue", Helvetica, Arial, sans-serif'],
    light: ['Sans light', '300 %px "Neue Haas Unica Pro", "Neue Haas Unica", "Helvetica Neue", Helvetica, Arial, sans-serif'],
    serif: ['Serif', '400 %px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'],
    italic: ['Serif italic', 'italic 400 %px Georgia, "Times New Roman", serif'],
    mono: ['Mono', '500 %px ui-monospace, "SF Mono", "Cascadia Code", Consolas, Menlo, monospace'],
    poster: ['Poster', '400 %px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'],
  };
  const BLENDS = ['normal', 'overlay', 'soft-light', 'difference', 'multiply', 'screen'];
  const hasText = () => state.text.str.trim().length > 0;

  function drawType(ctx, w, h) {
    const t = state.text;
    const size = (t.size / 100) * w;
    const lines = t.str.split('\n');
    const lh = size * 1.05;
    ctx.save();
    ctx.font = FONTS[t.font][1].replace('%', size.toFixed(2));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = `${((t.spacing / 100) * size).toFixed(2)}px`; } catch (e) { /* not in this browser */ }
    ctx.fillStyle = t.color;
    ctx.globalCompositeOperation = t.blend === 'normal' ? 'source-over' : t.blend;
    const y0 = (h * t.y) / 100 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => ctx.fillText(line, (w * t.x) / 100, y0 + i * lh));
    ctx.restore();
  }

  /* ---------- putting it together ---------- */

  const fxActive = () =>
    state.fx.blur !== 'none' || state.fx.half !== 'none' || state.fx.print > 0 || hasText();

  /** Everything that goes over the gradient, except grain, which is laid on last. */
  function finishFx(canvas) {
    if (!fxActive()) return;
    const w = canvas.width, h = canvas.height, u = Math.max(w, h) / 1000;
    const ctx = canvas.getContext('2d');
    const text = hasText();
    if (text && state.text.under) drawType(ctx, w, h);
    if (state.fx.blur !== 'none') blurFx(canvas, ctx, w, h, u);
    if (state.fx.half !== 'none') halftoneFx(canvas, ctx, w, h, u);
    if (state.fx.print) printFx(ctx, w, h);
    if (text && !state.text.under) drawType(ctx, w, h);
  }

  /** Draw the effects into the preview. `src` is the canvas holding a field gradient, if any. */
  function fxPreview(src) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let pw = els.preview.clientWidth * dpr, ph = els.preview.clientHeight * dpr;
    if (!pw || !ph) return;
    const f = Math.min(1, 1400 / Math.max(pw, ph));
    pw = Math.round(pw * f);
    ph = Math.round(ph * f);
    const c = els.fx;
    if (src) {
      c.width = pw;
      c.height = ph;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, pw, ph);
    } else {
      paintBase(c, pw, ph);
    }
    finishFx(c);
  }

  /* ---------- effect controls ---------- */

  renderLutOptions();
  for (const key of Object.keys(FONTS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = FONTS[key][0];
    els.textFont.append(o);
  }

  // ready-made looks: effect settings, then grain and steps
  const FX_PRESETS = [
    ['Dreamy', { blur: 'soft', blurAmt: 45, lut: 'film', lutMix: 70 }, { grain: 22 }],
    ['Riso', { half: 'ink', halfSize: 9, halfAngle: 30, print: 60 }, { grain: 18 }],
    ['Newsprint', { half: 'cmyk', halfSize: 8, halfAngle: 15, print: 45 }, {}],
    ['Poster', { print: 40 }, { grain: 12, steps: 6 }],
    ['Film', { lut: 'film', blur: 'soft', blurAmt: 10 }, { grain: 38 }],
    ['Speed', { blur: 'motion', blurAmt: 60, blurAngle: 20 }, { grain: 14 }],
    ['Warp', { blur: 'zoom', blurAmt: 65 }, { grain: 10 }],
    ['Engraved', { half: 'lines', halfSize: 8, halfAngle: 35, print: 30 }, {}],
    ['Pop dots', { half: 'color', halfSize: 14, halfAngle: 45 }, {}],
  ];
  const looksEl = $('#looks');
  FX_PRESETS.forEach(([name], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.i = i;
    b.textContent = name;
    looksEl.append(b);
  });
  looksEl.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const [, fx, extra] = FX_PRESETS[+b.dataset.i];
    commit();
    state.fx = Object.assign(defaultFx(), fx);
    state.grain = extra.grain || 0;
    state.steps = extra.steps || 0;
    render();
  });
  $('#fx-clear').addEventListener('click', () => {
    commit();
    state.fx = defaultFx();
    state.grain = 0;
    render();
  });

  const fxInput = (el, key, event) => el.addEventListener(event || 'input', () => {
    state.fx[key] = el.type === 'range' ? +el.value : el.value;
    render();
  });
  fxInput(els.lut, 'lut', 'change');
  fxInput(els.lutMix, 'lutMix');
  fxInput(els.blur, 'blur', 'change');
  fxInput(els.blurAmt, 'blurAmt');
  fxInput(els.blurAngle, 'blurAngle');
  fxInput(els.half, 'half', 'change');
  fxInput(els.halfSize, 'halfSize');
  fxInput(els.halfAngle, 'halfAngle');
  fxInput(els.print, 'print');

  els.text.addEventListener('input', () => { state.text.str = els.text.value.slice(0, 400); render(); });
  els.textFont.addEventListener('change', () => { state.text.font = els.textFont.value; render(); });
  els.textSize.addEventListener('input', () => { state.text.size = +els.textSize.value; render(); });
  els.textSpacing.addEventListener('input', () => { state.text.spacing = +els.textSpacing.value; render(); });
  els.textColor.addEventListener('input', () => { state.text.color = els.textColor.value.toLowerCase(); render(); });
  els.textBlend.addEventListener('change', () => { state.text.blend = els.textBlend.value; render(); });
  $('#text-under').addEventListener('change', () => { state.text.under = radio('text-under') === '1'; render(); });

  function renderFxControls() {
    const f = state.fx, t = state.text;
    els.lut.value = f.lut;
    if (els.lut.value !== f.lut) els.lut.value = ''; // a LUT this browser does not have
    els.lutMixRow.hidden = !f.lut;
    setValue(els.lutMix, f.lutMix);
    els.lutMixOut.textContent = f.lutMix;
    els.lutRemove.hidden = !f.lut.startsWith('u:');
    els.blur.value = f.blur;
    els.blurAmtRow.hidden = f.blur === 'none';
    els.blurAngleRow.hidden = f.blur !== 'motion';
    setValue(els.blurAmt, f.blurAmt);
    setValue(els.blurAngle, f.blurAngle);
    els.blurAmtOut.textContent = f.blurAmt;
    els.blurAngleOut.textContent = f.blurAngle;
    els.half.value = f.half;
    els.halfSizeRow.hidden = els.halfAngleRow.hidden = f.half === 'none';
    setValue(els.halfSize, f.halfSize);
    setValue(els.halfAngle, f.halfAngle);
    els.halfSizeOut.textContent = f.halfSize;
    els.halfAngleOut.textContent = f.halfAngle;
    setValue(els.print, f.print);
    els.printOut.textContent = f.print;

    setValue(els.text, t.str);
    els.textRows.hidden = !hasText();
    els.textFont.value = t.font;
    setValue(els.textSize, t.size);
    setValue(els.textSpacing, t.spacing);
    els.textSizeOut.textContent = fmt(t.size);
    els.textSpacingOut.textContent = t.spacing;
    setValue(els.textColor, t.color);
    els.textBlend.value = t.blend;
    setRadio('text-under', t.under ? '1' : '0');

    // the T handle sits just under the text block
    els.typeHandle.hidden = !hasText();
    if (hasText()) {
      const { w, h } = exportSize();
      const half = (t.str.split('\n').length * t.size * 1.05) / 2; // in % of the width
      els.typeHandle.style.left = t.x + '%';
      els.typeHandle.style.top = t.y + (half * w) / h + '%';
    }
  }

  function typePointer(e) {
    els.typeHandle.focus();
    const t = state.text;
    const r = els.preview.getBoundingClientRect();
    const dx = e.clientX - (r.left + (t.x / 100) * r.width), dy = e.clientY - (r.top + (t.y / 100) * r.height);
    drag((ev) => {
      t.x = clamp(+((((ev.clientX - dx) - r.left) / r.width) * 100).toFixed(1), 0, 100);
      t.y = clamp(+((((ev.clientY - dy) - r.top) / r.height) * 100).toFixed(1), 0, 100);
      hud(`${fmt(t.x)}% · ${fmt(t.y)}%`);
      render();
    });
  }
  els.typeHandle.addEventListener('dblclick', () => els.text.focus());
  els.typeHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    state.text.x = clamp(state.text.x + d[0], 0, 100);
    state.text.y = clamp(state.text.y + d[1], 0, 100);
    render();
  });

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
  renderSaved();
  render({ forceOrder: true });
  committed = serialize();
  els.undo.disabled = true;
})();
