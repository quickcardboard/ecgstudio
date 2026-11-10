// The loading animation: the app's voxel heart (icons/logo/logo.svg, made by tools/logo/iso.js: the 9-wide upright
// heart, its wavefront raised one voxel) drawn live on a canvas. Each cycle one depolarisation wave flows down from the
// upper-left lobe (resting pink → front blue → depolarised → repolarising green → resting pink), then the heart turns
// once about its vertical axis at an even pace (no overshoot) with a hop, and lands with a small bounce. With reduced
// motion: the wave only.
// ECGLoader.mount(element, cssSize): fills the element with the animation; it runs only while the element is showing.
(function () {
  'use strict';
  const PAL = { rest: '#f4a3bd', front: '#2f6bff', dep: '#7aa2ff', rep: '#2fcf8a' };
  const MASK = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
  const HOP = 2.2;   // voxels
  const BEAT = 1000, SPIN = 550, LAND = 240, REST = 250, CYCLE = BEAT + SPIN + LAND + REST;   // ms
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const C = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));
  const rgb = (c, k) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, k > 0 ? v + (255 - v) * k : v * (1 + k))))).join(',')})`;

  // cells, and each one's wave phase 0..1 (distance from the pacing site at the upper-left lobe), as in tools/logo/gen.js
  const cells = [];
  MASK.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') cells.push({ i, j }); }));
  const W = MASK[0].length, H = MASK.length;
  { const r = cells.map((c) => Math.hypot(c.i + 0.5, c.j + 0.8)), lo = Math.min(...r), hi = Math.max(...r); cells.forEach((c, k) => { c.ph = (r[k] - lo) / (hi - lo); }); }
  // tissue colour d (wave units) behind the front, then back to rest so the beat ends where it started
  function state(d) {
    if (d < 0) return C.rest;
    if (d < 0.11) return C.front;
    if (d < 0.30) return C.dep;
    if (d < 0.36) return mix(C.dep, C.rep, 0.5);
    if (d < 0.75) return C.rep;
    if (d < 0.95) return mix(C.rep, C.rest, (d - 0.75) / 0.2);
    return C.rest;
  }

  // unit-cube faces: outward normal and corners
  const FACES = [
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]],
    [[1, 0, 0], [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [[0, -1, 0], [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]]],
  ];
  const C30 = Math.cos(Math.PI / 6), CX = 1, CY = W / 2, CZ = H / 2;   // (turns about the slab's middle)
  // the logo's heart (uprightR, depth 2, rise 1): standing in the y–z plane; the wavefront one voxel thicker
  function voxels(front) {
    const v = [];
    for (const c of cells) {
      const d = front - c.ph, crest = Math.exp(-Math.pow((d - 0.05) / 0.07, 2)), col = state(d);
      for (let x = 0; x < 2 + Math.round(crest); x++) v.push({ x, y: W - 1 - c.i, z: H - 1 - c.j, col });
    }
    return v;
  }
  // draw: yaw (radians) about the vertical axis, isometric view from +x +y +z as the logo; hop in voxels
  const R = Math.hypot(2.5, W / 2) + 0.2, SPAN = Math.max(2 * Math.SQRT2 * R * C30, 2 * (R / Math.SQRT2 + H / 2)) + 1.6 + HOP;
  function draw(g, size, front, yaw, hop) {
    const vox = voxels(front), occ = new Set(vox.map((v) => `${v.x},${v.y},${v.z}`)), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const sc = size / SPAN, ox = size / 2, oy = size / 2 - hop * sc + (0.4 + HOP / 2) * sc;
    const faces = [];
    for (const v of vox) for (const [n, q] of FACES) {
      if (occ.has(`${v.x + n[0]},${v.y + n[1]},${v.z + n[2]}`)) continue;
      const nx = cs * n[0] - sn * n[1], ny = sn * n[0] + cs * n[1], nz = n[2];
      if (nx + ny + nz <= 1e-6) continue;   // (facing away)
      let dep = 0; const pts = [];
      for (const p of q) {
        const X = v.x + p[0] - CX, Y = v.y + p[1] - CY, Z = v.z + p[2] - CZ, x = cs * X - sn * Y, y = sn * X + cs * Y;
        pts.push(ox + (x - y) * C30 * sc, oy + ((x + y) * 0.5 - Z) * sc); dep += x + y + Z;
      }
      // light fixed to the view, as the logo: top +0.32, the right-hand side 0, the left-hand side −0.32
      const k = nz > 0.5 ? 0.32 : nz < -0.5 ? -0.5 : -0.16 + 0.16 * (nx - ny);
      faces.push({ dep, pts, fill: rgb(v.col, k) });
    }
    faces.sort((a, b) => a.dep - b.dep);
    g.clearRect(0, 0, size, size);
    for (const f of faces) {
      g.beginPath(); g.moveTo(f.pts[0], f.pts[1]);
      for (let i = 2; i < 8; i += 2) g.lineTo(f.pts[i], f.pts[i + 1]);
      g.closePath(); g.fillStyle = f.fill; g.fill();
      g.strokeStyle = f.fill; g.lineWidth = 0.6; g.stroke();   // (closes hairline gaps between faces)
    }
  }
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function mount(el, css = 96) {
    if (!el || el.dataset.loader) return;
    el.dataset.loader = '1';
    const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(css * dpr); cv.style.width = cv.style.height = `${css}px`; cv.style.display = 'block';
    cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let t0 = performance.now();
    const frame = (now) => {
      if (!el.isConnected) return;
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') { t0 = now; setTimeout(() => requestAnimationFrame(frame), 250); return; }   // (hidden: wait)
      const t = (api.at === null ? now - t0 : api.at) % CYCLE, spun = BEAT + SPIN;
      let front = 2, yaw = 0, hop = 0;
      if (t < BEAT) front = -0.1 + 2.1 * easeInOut(t / BEAT);                       // the wave, back to pink
      else if (still.matches) { /* (reduced motion: no turn) */ }
      else if (t < spun) { const u = (t - BEAT) / SPIN; yaw = 2 * Math.PI * easeInOut(u); hop = HOP * Math.sin(Math.PI * u); }   // one turn, even pace, with a hop
      else if (t < spun + LAND) hop = 0.35 * HOP * Math.sin(Math.PI * (t - spun) / LAND);   // a small bounce on landing
      draw(g, css, front, yaw, hop);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  const api = window.ECGLoader = { mount, CYCLE, at: null };   // (at: a fixed time in the cycle, ms, for recording frames)
  // any element marked data-ecg-loader="size" gets the animation
  const auto = () => { for (const el of document.querySelectorAll('[data-ecg-loader]')) mount(el, +el.dataset.ecgLoader || 96); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
