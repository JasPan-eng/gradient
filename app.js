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

  const TYPES = ['linear', 'radial', 'conic'];
  const SPACES = ['oklab', 'srgb'];

  const state = {
    type: 'linear',
    angle: 135,
    cx: 50,
    cy: 50,
    space: 'oklab',
    stops: [mkStop('#ffc56b', 0), mkStop('#f2617a', 50), mkStop('#5b3fd6', 100)],
    selected: null,
  };
  state.selected = state.stops[0].id;

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
    const plain = sorted();
    if (state.space === 'srgb') return `background: ${cssGradient(plain)};`;
    return [
      '/* fallback for older browsers */',
      `background: ${cssGradient(plain)};`,
      `background: ${cssGradient(plain, 'oklab')};`,
    ].join('\n');
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
    if (state.type === 'conic') {
      return '<!-- SVG has no conic gradients. Download a PNG instead, or switch the type to linear or radial. -->';
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
    const out = { type: state.type };
    if (state.type !== 'radial') out.angle = state.angle;
    if (state.type !== 'linear') out.center = { x: state.cx, y: state.cy };
    out.interpolation = state.space;
    out.stops = sorted().map((s) => ({ color: s.color, position: s.pos }));
    out.css = cssGradient(sorted(), state.space === 'oklab' ? 'oklab' : '');
    return JSON.stringify(out, null, 2);
  }

  function paint(canvas, w, h) {
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
  };

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
    els.angleRow.hidden = state.type === 'radial';
    els.centerRows.hidden = state.type === 'linear';
    els.angleLabel.textContent = state.type === 'conic' ? 'Start' : 'Angle';
    setValue(els.angle, state.angle);
    setValue(els.angleNum, state.angle);
    setValue(els.cx, state.cx);
    setValue(els.cy, state.cy);
    els.cxOut.textContent = state.cx;
    els.cyOut.textContent = state.cy;
    els.hint.textContent =
      (state.type === 'linear' ? 'Drag the preview to turn the gradient.' : 'Drag the preview to move the center.') +
      ' Click the bar to add a stop.';
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
    els.dlSvg.disabled = state.type === 'conic';
    els.dlSvg.title = state.type === 'conic' ? 'SVG has no conic gradients' : '';
  }

  function render(opts) {
    const res = resolved();
    els.preview.style.background = cssGradient(res);
    els.track.style.background = `linear-gradient(90deg, ${stopList(res)})`;
    renderHandles();
    renderList(opts && opts.forceOrder);
    renderControls();
    renderCode();
    scheduleCommit();
  }

  /* ------------------------------------------------------------------ *
   * History, link sharing
   * ------------------------------------------------------------------ */

  const serialize = () =>
    `t=${state.type}&a=${fmt(state.angle)}&x=${fmt(state.cx)}&y=${fmt(state.cy)}&m=${state.space}` +
    `&s=${sorted().map((s) => `${s.color.slice(1)}:${fmt(s.pos)}`).join(',')}`;

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
    return true;
  }

  const history = [];
  let committed = '';
  let commitTimer;

  function commit() {
    clearTimeout(commitTimer);
    const now = serialize();
    if (now === committed) return;
    if (committed) history.push(committed);
    if (history.length > 100) history.shift();
    committed = now;
    try { window.history.replaceState(null, '', '#' + now); } catch (e) { /* file:// in some browsers */ }
  }

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 400);
  }

  function undo() {
    clearTimeout(commitTimer);
    let target;
    if (serialize() !== committed) target = committed;       // drop uncommitted edits
    else if (history.length) target = history.pop();
    else return toast('Nothing to undo');
    committed = target;
    deserialize(target);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    render({ forceOrder: true });
    try { window.history.replaceState(null, '', '#' + target); } catch (e) { /* ignore */ }
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
    if (e.button) return;
    e.preventDefault();
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

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const t = e.target;
      if (t.matches && t.matches('input[type="text"], input[type="number"]')) return; // native undo
      e.preventDefault();
      undo();
    }
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
    const [w, h] = els.size.value.split('x');
    els.w.value = w;
    els.h.value = h;
    renderCode();
  });
  for (const el of [els.w, els.h]) {
    el.addEventListener('input', () => {
      const match = [...els.size.options].find((o) => o.value === `${+els.w.value}x${+els.h.value}`);
      els.size.value = match ? match.value : 'custom';
      renderCode();
    });
    el.addEventListener('change', () => {
      const s = exportSize();
      els.w.value = s.w;
      els.h.value = s.h;
      renderCode();
    });
  }

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
   * Start
   * ------------------------------------------------------------------ */

  if (location.hash.length > 1) deserialize(location.hash.slice(1));
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== serialize() && deserialize(location.hash.slice(1))) render({ forceOrder: true });
  });

  placeLine();
  render({ forceOrder: true });
  committed = serialize();
})();
