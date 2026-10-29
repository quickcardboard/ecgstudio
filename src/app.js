/* =============================================================================
 * LiveHeart app — Three.js heart view, ECG paper, interpretation, controls
 * ========================================================================== */
(function () {
  'use strict';
  const LH = window.LiveHeart;
  const $ = (id) => document.getElementById(id);

  const PAGE = 10000;        // ms of ECG on one sheet (10 s)
  const ERASE = 140;         // ms blank gap ahead of the sweep cursor
  const SCALES = [0.02, 0.05, 0.1, 0.2, 1 / 3, 0.5, 1];
  const SCALE_LABEL = ['1/50×', '1/20×', '1/10×', '1/5×', '1/3×', '1/2×', '1×'];
  const MAX_STEPS_PER_FRAME = 90;

  // Tissue state colours (linear RGB 0..1): spec — pink resting, blue
  // depolarizing, green repolarizing; the conduction system rests in gold.
  const C = {
    rest: [0.95, 0.62, 0.71], front: [0.10, 0.30, 1.00], dep: [0.30, 0.47, 0.90],
    rep: [0.14, 0.72, 0.38], cs: [0.93, 0.71, 0.16],
  };
  const STATIC = { 5: 0xb86e60, 6: 0x6f82ad, 7: 0xe8dcc0, 8: 0xe8dcc0, 9: 0xe8dcc0, 10: 0xe8dcc0, 11: 0x7d6f9c };

  let A, M, S;
  const ui = { scaleIdx: 6, paused: false, view: 'external', rate: 72, acc: 0, last: 0 };
  const ecg = { buf: LH.LEADS.map(() => new Float32Array(PAGE).fill(NaN)) };
  const g3 = {};

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function setLoading(msg) { $('loadMsg').textContent = msg; }
  const tick = () => new Promise((r) => setTimeout(r, 30));

  async function boot() {
    if (!window.THREE) { setLoading('The 3D library could not load. Check your connection and reload.'); return; }
    await tick();
    A = new LH.Anatomy(JSON.parse($('anatomy-data').textContent));
    setLoading('Building tissue graph and conduction system…'); await tick();
    M = new LH.Model(A);
    setLoading('Tuning repolarization to the sinus beat…'); await tick();
    newSim();
    try { init3D(); } catch (e) { setLoading('WebGL is not available in this browser, so the 3D view cannot start.'); console.error(e); return; }
    initECG(); initUI();
    $('loading').hidden = true;
    ui.last = performance.now();
    requestAnimationFrame(loop);
  }

  function newSim() {
    S = new LH.Sim(M, { seed: 1 });
    S.setRate(ui.rate);
    for (const b of ecg.buf) b.fill(NaN);
    S.onSample((t, L) => { const i = t % PAGE; for (let k = 0; k < 12; k++) ecg.buf[k][i] = L[k]; });
    ui.acc = 0;
    $('rhythm').textContent = 'Acquiring…'; $('chips').innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Main loop: advance simulated time by wall time × time scale (1 ms steps)
  // ---------------------------------------------------------------------------
  let interpTimer = 0;
  function loop(now) {
    const dt = Math.min(100, now - ui.last); ui.last = now;
    if (!ui.paused) {
      ui.acc += dt * SCALES[ui.scaleIdx];
      let n = Math.floor(ui.acc); ui.acc -= n;
      if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; ui.acc = 0; }
      for (let i = 0; i < n; i++) S.step();
    }
    update3D();
    drawECG();
    if ((interpTimer += dt) > 300) { interpTimer = 0; interpret(); }
    $('clock').textContent = `t ${(S.t / 1000).toFixed(3)} s · ${SCALE_LABEL[ui.scaleIdx]}${ui.paused ? ' · paused' : ''}`;
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // 3D view
  // ---------------------------------------------------------------------------
  function init3D() {
    const canvas = $('c3d');
    const R = g3.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    R.localClippingEnabled = true;
    R.setClearColor(0x13202b, 1);
    const scene = g3.scene = new THREE.Scene();
    const cam = g3.camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3040, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.65); key.position.set(150, 220, 300); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 0.3); rim.position.set(-200, -80, -250); scene.add(rim);

    // heart frame -> display: centre on the ventricles, apply the same chest
    // rotation the ECG lead fields use
    const outer = g3.outer = new THREE.Group();
    outer.rotation.z = -M.P.heartRotation * Math.PI / 180;
    const inner = g3.inner = new THREE.Group();
    inner.position.set(-M.center[0], -M.center[1], -M.center[2]);
    outer.add(inner); scene.add(outer);

    buildSurfaces();
    buildConduction();
    buildCutPlane();

    const ctl = g3.controls = new THREE.OrbitControls(cam, canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.enablePan = false;
    ctl.minDistance = 140; ctl.maxDistance = 700;
    setView('external');
    new ResizeObserver(resize3D).observe($('pane3d'));
    resize3D();
  }

  function resize3D() {
    const el = $('pane3d'), w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    g3.renderer.setSize(w, h, false);
    g3.camera.aspect = w / h;
    // keep the heart clear of the floating control panel
    const panel = $('controls'), shift = panel.classList.contains('collapsed') || w < 560 ? 0 : Math.min(130, panel.offsetWidth / 2);
    if (shift) g3.camera.setViewOffset(w, h, -shift, 0, w, h); else g3.camera.clearViewOffset();
    g3.camera.updateProjectionMatrix();
  }

  function decodeB64(s, Type) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Type(u8.buffer);
  }

  // nearest excitable voxel to a heart-frame point (within 2 voxels)
  function nearestTissue(x, y, z) {
    const h = A.h, o = A.origin;
    const i0 = Math.floor((x - o[0]) / h), j0 = Math.floor((y - o[1]) / h), k0 = Math.floor((z - o[2]) / h);
    let best = -1, bd = Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) {
      const c = A.at(i0 + a, j0 + b, k0 + e); if (c < 0 || !M.kind[c]) continue;
      const dx = A.pos[3 * c] - x, dy = A.pos[3 * c + 1] - y, dz = A.pos[3 * c + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function buildSurfaces() {
    const span = A.dims.map((d) => d * A.h);
    g3.tissueMeshes = []; g3.clipMats = [];
    for (const s of A.json.surfaces) {
      const q = decodeB64(s.pos, Uint16Array), idx = decodeB64(s.idx, Uint32Array);
      const pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) pos[i] = A.origin[i % 3] + (q[i] / 65535) * span[i % 3];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      let mat;
      if (s.label <= 4) {
        const nv = pos.length / 3, col = new Float32Array(pos.length), vmap = new Int32Array(nv);
        for (let v = 0; v < nv; v++) vmap[v] = nearestTissue(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: 0x222222, side: THREE.DoubleSide });
        g3.tissueMeshes.push({ geo, vmap, col });
      } else {
        const valve = s.label >= 7 && s.label <= 10;
        mat = new THREE.MeshPhongMaterial({ color: STATIC[s.label], shininess: 15, side: THREE.DoubleSide, transparent: valve, opacity: valve ? 0.55 : 1 });
      }
      const mesh = new THREE.Mesh(geo, mat);
      g3.clipMats.push(mat);
      g3.inner.add(mesh);
    }
    g3.voxCol = new Float32Array(M.nCells * 3);
  }

  // direction from a voxel toward the chamber cavity it faces (for drawing the
  // conduction system just proud of the endocardium)
  function towardCavity(c) {
    const d = [0, 0, 0]; const i = A.ii[c], j = A.jj[c], k = A.kk[c];
    const [nx, ny, nz] = A.dims;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const ii = i + a, jj = j + b, kk = k + e;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      if (A.cavityComp[(ii * ny + jj) * nz + kk] > 0) { d[0] += a; d[1] += b; d[2] += e; }
    }
    const l = Math.hypot(d[0], d[1], d[2]);
    return l ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 0];
  }
  function nodePos(id, lift = 1.6) {
    const p = [M.x[id], M.y[id], M.z[id]];
    const c = nearestTissue(p[0], p[1], p[2]);
    if (c < 0) return p;
    const d = towardCavity(c);
    return [p[0] + d[0] * lift, p[1] + d[1] * lift, p[2] + d[2] * lift];
  }

  function buildConduction() {
    const grp = g3.cs = new THREE.Group(); g3.inner.add(grp);
    g3.tubes = [];
    const segs = M.csSegments;
    const last = (a) => a[a.length - 1];
    const paths = [
      { ids: segs.AVN, r: 1.5 },
      { ids: [last(segs.AVN)].concat(segs.HIS), r: 1.4 },
      { ids: [last(segs.HIS)].concat(segs.LBB), r: 1.2 },
      { ids: [last(segs.LBB)].concat(segs.LAF), r: 0.9 },
      { ids: [last(segs.LBB)].concat(segs.LPF), r: 0.9 },
      { ids: [last(segs.LBB)].concat(segs.LSF), r: 0.8 },
      { ids: [last(segs.HIS)].concat(segs.RBB), r: 0.9 },
    ];
    for (const p of paths) {
      const pts = p.ids.map((id) => new THREE.Vector3(...nodePos(id, id === p.ids[0] && p !== paths[0] ? 1.6 : 1.6)));
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tub = Math.max(4, (pts.length - 1) * 3), rad = 6;
      const geo = new THREE.TubeGeometry(curve, tub, p.r, rad, false);
      const nv = geo.attributes.position.count, col = new Float32Array(nv * 3), map = new Int32Array(nv);
      for (let v = 0; v < nv; v++) { const ring = Math.floor(v / (rad + 1)); map[v] = p.ids[Math.round(ring / tub * (p.ids.length - 1))]; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 50, emissive: 0x222222 }));
      grp.add(mesh); g3.tubes.push({ geo, col, map });
    }
    // Purkinje network as points
    const ids = M.purkLV.concat(M.purkRV);
    const pp = new Float32Array(ids.length * 3);
    ids.forEach((id, i) => { const q = nodePos(id, 1.2); pp[3 * i] = q[0]; pp[3 * i + 1] = q[1]; pp[3 * i + 2] = q[2]; });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const pc = new Float32Array(ids.length * 3); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    grp.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 1.9, vertexColors: true, sizeAttenuation: true })));
    g3.purk = { ids, pc, geo: pg };
    // sinus node marker (visible in both views)
    const san = g3.san = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x333333 }));
    const sp = nodePos(M.sanCell, -1.0); san.position.set(sp[0], sp[1], sp[2]);
    g3.inner.add(san);
  }

  // Four-chamber cut: plane through the LV apex and both AV-valve centres;
  // the anterior half is removed and the cut face filled with tissue voxels.
  function buildCutPlane() {
    const lm = A.landmarks, mv = lm.MV.c, tv = lm.TV.c;
    let apex = [0, 0, 0], n = 0;
    for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.zuvc[c] >= 0 && A.zuvc[c] < 0.04 && A.epi[c]) { apex[0] += A.pos[3 * c]; apex[1] += A.pos[3 * c + 1]; apex[2] += A.pos[3 * c + 2]; n++; }
    apex = apex.map((v) => v / n);
    const a = new THREE.Vector3(mv[0] - apex[0], mv[1] - apex[1], mv[2] - apex[2]);
    const b = new THREE.Vector3(tv[0] - mv[0], tv[1] - mv[1], tv[2] - mv[2]);
    const nrm = new THREE.Vector3().crossVectors(a, b).normalize();
    if (nrm.z < 0) nrm.negate();                               // point anterior
    const p0 = new THREE.Vector3((mv[0] + tv[0]) / 2, (mv[1] + tv[1]) / 2, (mv[2] + tv[2]) / 2);
    g3.cutN = nrm; g3.cutP = p0;
    // Cap: a flat grid of quads on the cut plane wherever it passes through
    // myocardium, each coloured live from the voxel underneath.
    const u = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(u, nrm).normalize();
    const step = 1.0, half = 0.5 * step, R0 = 110, back = -0.25;
    const pos = [], cells = [];
    for (let i = -R0; i < R0; i += step) for (let j = -R0; j < R0; j += step) {
      const q = p0.clone().addScaledVector(u, i + half).addScaledVector(v, j + half);
      const c = A.at(Math.floor((q.x - A.origin[0]) / A.h), Math.floor((q.y - A.origin[1]) / A.h), Math.floor((q.z - A.origin[2]) / A.h));
      if (c < 0 || !M.kind[c]) continue;
      const corner = (di, dj) => p0.clone().addScaledVector(u, i + di).addScaledVector(v, j + dj).addScaledVector(nrm, back);
      const q00 = corner(0, 0), q10 = corner(step, 0), q11 = corner(step, step), q01 = corner(0, step);
      for (const qq of [q00, q10, q11, q00, q11, q01]) pos.push(qq.x, qq.y, qq.z);
      cells.push(c);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const ccol = new Float32Array(pos.length);
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    cg.computeVertexNormals();
    const cap = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    g3.inner.add(cap);
    g3.slab = { im: cap, ids: cells, col: ccol, geo: cg };
    g3.plane = new THREE.Plane();
  }

  function worldCutPlane() {
    g3.scene.updateMatrixWorld(true);
    const mw = g3.inner.matrixWorld;
    const p = g3.cutP.clone().applyMatrix4(mw);
    const n = g3.cutN.clone().transformDirection(mw);
    return { p, n };
  }

  function setView(v) {
    ui.view = v;
    const cut = v === 'cutaway';
    const { p, n } = worldCutPlane();
    g3.plane.setFromNormalAndCoplanarPoint(n.clone().negate(), p);   // keep the posterior half
    // clip tissue only: the conduction system stays whole so it can be seen (and later clicked)
    for (const m of g3.clipMats) { m.clippingPlanes = cut ? [g3.plane] : null; m.needsUpdate = true; }
    g3.cs.visible = cut; g3.slab.im.visible = cut;
    $('legendCs').hidden = !cut;
    $('viewName').textContent = cut ? 'anterior cutaway (four-chamber)' : 'external view';
    $('hint').textContent = cut ? 'Fixed anterior cutaway · scroll to zoom' : 'Drag to rotate · scroll to zoom';
    const ctl = g3.controls, cam = g3.camera;
    ctl.target.set(0, 0, 0);
    if (cut) {
      const dir = n.clone(); dir.y *= 0.6; dir.normalize();
      cam.position.copy(dir.multiplyScalar(360));
      ctl.enableRotate = false;
    } else {
      cam.position.set(40, 30, 380);
      ctl.enableRotate = true;
    }
    cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); ctl.update();
  }

  // colour of a cell from its action-potential phase
  function stateColor(c, t, out, o, restCol) {
    const s = t - S.tAct[c], apd = S.apd[c], w = S.repW[c] || 100;
    let r, g, b;
    if (s < 0 || s >= apd + 0.35 * w) { [r, g, b] = restCol; }
    else if (s < apd - 0.35 * w) {
      const k = Math.min(1, s / 35);
      r = C.front[0] + (C.dep[0] - C.front[0]) * k; g = C.front[1] + (C.dep[1] - C.front[1]) * k; b = C.front[2] + (C.dep[2] - C.front[2]) * k;
    } else {
      const k = Math.max(0, (s - (apd - 0.35 * w)) / (0.7 * w)), kk = k * k;
      r = C.rep[0] + (restCol[0] - C.rep[0]) * kk; g = C.rep[1] + (restCol[1] - C.rep[1]) * kk; b = C.rep[2] + (restCol[2] - C.rep[2]) * kk;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }

  function update3D() {
    const t = S.t, vc = g3.voxCol;
    for (let c = 0; c < M.nVox; c++) if (M.kind[c]) stateColor(c, t, vc, 3 * c, C.rest);
    for (const m of g3.tissueMeshes) {
      const { vmap, col } = m;
      for (let v = 0; v < vmap.length; v++) {
        const c = vmap[v];
        if (c < 0) { col[3 * v] = 0.8; col[3 * v + 1] = 0.6; col[3 * v + 2] = 0.65; continue; }
        col[3 * v] = vc[3 * c]; col[3 * v + 1] = vc[3 * c + 1]; col[3 * v + 2] = vc[3 * c + 2];
      }
      m.geo.attributes.color.needsUpdate = true;
    }
    const sc = [0, 0, 0];
    stateColor(M.sanCell, t, sc, 0, [1, 1, 1]); g3.san.material.color.setRGB(sc[0], sc[1], sc[2]);
    if (ui.view === 'cutaway') {
      const sl = g3.slab, cc = sl.col;
      for (let i = 0; i < sl.ids.length; i++) {
        const c = sl.ids[i], o = 18 * i, r = vc[3 * c] * 0.9, g = vc[3 * c + 1] * 0.9, b = vc[3 * c + 2] * 0.9;   // cut face slightly darker
        for (let k = 0; k < 18; k += 3) { cc[o + k] = r; cc[o + k + 1] = g; cc[o + k + 2] = b; }
      }
      sl.geo.attributes.color.needsUpdate = true;
      for (const tb of g3.tubes) {
        for (let v = 0; v < tb.map.length; v++) stateColor(tb.map[v], t, tb.col, 3 * v, C.cs);
        tb.geo.attributes.color.needsUpdate = true;
      }
      const pk = g3.purk;
      for (let i = 0; i < pk.ids.length; i++) stateColor(pk.ids[i], t, pk.pc, 3 * i, C.cs);
      pk.geo.attributes.color.needsUpdate = true;
    }
    g3.controls.update();
    g3.renderer.render(g3.scene, g3.camera);
  }

  // ---------------------------------------------------------------------------
  // ECG paper: 3×4 layout (2.5 s per column) + 10 s lead II rhythm strip,
  // standard calibration 25 mm/s and 10 mm/mV, white paper with pink grid.
  // ---------------------------------------------------------------------------
  const LAYOUT = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']];
  const PAPER = { w: 262, h: 128, left: 9, rowH: 31, top: 3 };   // mm; rowH grows with space

  function initECG() {
    ecg.canvas = $('cecg'); ecg.ctx = ecg.canvas.getContext('2d');
    ecg.grid = document.createElement('canvas');
    new ResizeObserver(resizeECG).observe($('ecgWrap'));
    resizeECG();
  }

  function resizeECG() {
    const wrap = $('ecgWrap'), W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of [ecg.canvas, ecg.grid]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    // width sets the scale (25 mm/s); spare height goes to taller rows
    const mmCss = Math.min(W / PAPER.w, H / (4 * 31 + 4));
    PAPER.rowH = Math.min(52, Math.max(31, (H / mmCss - 4) / 4));
    PAPER.h = 4 * PAPER.rowH + 4;
    const mm = mmCss * dpr;
    ecg.mm = mm; ecg.W = W * dpr; ecg.H = H * dpr;
    ecg.ox = (ecg.W - PAPER.w * mm) / 2; ecg.oy = (ecg.H - PAPER.h * mm) / 2;
    // grid aligned to the paper origin, covering the whole canvas
    const g = ecg.grid.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, ecg.W, ecg.H);
    const startX = ecg.ox - Math.ceil(ecg.ox / mm) * mm, startY = ecg.oy - Math.ceil(ecg.oy / mm) * mm;
    const line = (major) => {
      g.beginPath();
      g.strokeStyle = major ? '#ec8fa3' : '#f7d3da'; g.lineWidth = major ? Math.max(1, 0.9 * dpr) : Math.max(0.6, 0.5 * dpr);
      const step = major ? 5 * mm : mm;
      const sx = major ? ecg.ox - Math.ceil(ecg.ox / step) * step : startX, sy = major ? ecg.oy - Math.ceil(ecg.oy / step) * step : startY;
      for (let x = sx; x <= ecg.W; x += step) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, ecg.H); }
      for (let y = sy; y <= ecg.H; y += step) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(ecg.W, Math.round(y) + 0.5); }
      g.stroke();
    };
    if (mm >= 2.2) line(false);
    line(true);
    // calibration pulses and labels
    g.strokeStyle = '#111'; g.lineWidth = Math.max(1.2, 1.1 * dpr); g.fillStyle = '#111';
    g.font = `600 ${Math.max(10, 3.2 * mm)}px "IBM Plex Sans", system-ui, sans-serif`;
    for (let r = 0; r < 4; r++) {
      const y = rowBase(r), x = ecg.ox + 1.5 * mm;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1.5 * mm, y); g.lineTo(x + 1.5 * mm, y - 10 * mm); g.lineTo(x + 6.5 * mm, y - 10 * mm); g.lineTo(x + 6.5 * mm, y); g.lineTo(x + 8 * mm, y); g.stroke();
      const names = r < 3 ? LAYOUT[r] : ['II'];
      names.forEach((n, c) => g.fillText(n, ecg.ox + (PAPER.left + c * 62.5 + 1.2) * mm, y - 10.5 * mm));
      if (r < 3) for (let c = 1; c < 4; c++) {
        const x2 = ecg.ox + (PAPER.left + c * 62.5) * mm;
        g.beginPath(); g.moveTo(x2, y - 3 * mm); g.lineTo(x2, y + 3 * mm); g.stroke();
      }
    }
  }
  function rowBase(r) { return ecg.oy + (PAPER.top + PAPER.rowH * r + PAPER.rowH * 0.6) * ecg.mm; }

  // draw samples [t0, t1) of one lead into an x-range, min/max per pixel column
  function trace(ctx, buf, t0, t1, x0, y0, cursor) {
    const mm = ecg.mm, pxPerMs = 0.025 * mm, gain = 10 * mm;
    const cols = Math.max(1, Math.round((t1 - t0) * pxPerMs));
    let pen = false, lastY = 0;
    for (let px = 0; px < cols; px++) {
      const a = t0 + Math.floor(px / pxPerMs), b = Math.min(t1, t0 + Math.floor((px + 1) / pxPerMs));
      let mn = Infinity, mx = -Infinity, first = NaN;
      for (let s = a; s < b; s++) {
        const ahead = (s - cursor + PAGE) % PAGE;
        if (ahead > 0 && ahead < ERASE) continue;           // erase bar ahead of the cursor
        const v = buf[s]; if (v !== v) continue;
        if (first !== first) first = v;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      if (mn === Infinity) { pen = false; continue; }
      const x = x0 + px, yMin = y0 - mx * gain, yMax = y0 - mn * gain, yF = y0 - first * gain;
      if (!pen) { ctx.moveTo(x, yF); pen = true; } else ctx.lineTo(x, yF);
      if (Math.abs(lastY - yMin) < Math.abs(lastY - yMax)) { ctx.lineTo(x, yMin); ctx.lineTo(x, yMax); lastY = yMax; }
      else { ctx.lineTo(x, yMax); ctx.lineTo(x, yMin); lastY = yMin; }
    }
  }

  function drawECG() {
    if (!ecg.mm) return;
    const ctx = ecg.ctx, mm = ecg.mm;
    ctx.drawImage(ecg.grid, 0, 0);
    const cursor = S.t % PAGE;
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.1, 0.32 * mm); ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const k = LH.LEADS.indexOf(LAYOUT[r][c]);
      trace(ctx, ecg.buf[k], c * 2500, (c + 1) * 2500, ecg.ox + (PAPER.left + c * 62.5) * mm, rowBase(r), cursor);
    }
    trace(ctx, ecg.buf[1], 0, PAGE, ecg.ox + PAPER.left * mm, rowBase(3), cursor);
    ctx.stroke();
    // sweep cursor
    const x = ecg.ox + (PAPER.left + cursor * 0.025) * mm;
    ctx.fillStyle = 'rgba(194,48,79,0.18)'; ctx.fillRect(x, ecg.oy, Math.max(2, 0.6 * mm), PAPER.h * mm);
  }

  // ---------------------------------------------------------------------------
  // Interpretation banner (ground truth from the simulator + measurements)
  // ---------------------------------------------------------------------------
  function interpret() {
    const V = S.log.vent.filter((b) => S.t > b.repEnd + 60), Aa = S.log.atrial;
    if (V.length < 2) return;
    const vb = V[V.length - 1];
    const rr = V.slice(-4).map((b, i, a) => (i ? b.on - a[i - 1].on : null)).filter(Boolean);
    const RR = rr.reduce((s, v) => s + v, 0) / rr.length, rate = 60000 / RR;
    const ab = Aa.filter((a) => a.on < vb.on - 40 && a.on > vb.on - 450).pop();
    const PR = ab ? vb.on - ab.on : null;
    const QRS = vb.last - vb.on + 4;
    const QT = vb.repEnd + 40 - vb.on, QTc = QT / Math.sqrt(RR / 1000);
    // QRS axis from net QRS areas in I and aVF
    let aI = 0, aF = 0; const base = Math.floor(vb.on - 15) % PAGE;
    for (let t = Math.floor(vb.on); t <= Math.ceil(vb.on + QRS); t++) {
      const i = t % PAGE; aI += ecg.buf[0][i] - ecg.buf[0][base]; aF += ecg.buf[5][i] - ecg.buf[5][base];
    }
    const axis = Math.round(Math.atan2(aF, aI) * 180 / Math.PI);
    // what drove the last ventricular beat?
    const fired = S.fireLog.filter((f) => f.t > vb.on - 160 && f.t <= vb.on + 1).pop();
    let rhythm;
    if (fired && fired.name === 'ventricular') rhythm = 'Ventricular escape rhythm';
    else if (fired && fired.name === 'junctional') rhythm = 'Junctional escape rhythm';
    else if (PR !== null) rhythm = rate < 60 ? 'Sinus bradycardia' : rate > 100 ? 'Sinus tachycardia' : 'Normal sinus rhythm';
    else rhythm = 'Rhythm being analysed';
    if (PR !== null && PR > 200) rhythm += ' with 1st-degree AV block';
    const axisTxt = axis < -30 ? 'left axis deviation' : axis > 90 ? 'right axis deviation' : 'normal axis';
    $('rhythm').textContent = rhythm;
    const chip = (k, v, flag) => `<span class="chip${flag ? ' flag' : ''}"><em>${k}</em>${v}</span>`;
    $('chips').innerHTML = [
      chip('Rate', `${Math.round(rate)} bpm`, rate < 60 || rate > 100),
      chip('PR', PR !== null ? `${Math.round(PR)} ms` : '—', PR !== null && (PR > 200 || PR < 120)),
      chip('QRS', `${Math.round(QRS)} ms`, QRS >= 120),
      chip('QT/QTc', `${Math.round(QT)}/${Math.round(QTc)} ms`, QTc > 460),
      chip('Axis', `${axis > 0 ? '+' : ''}${axis}° · ${axisTxt}`, axis < -30 || axis > 90),
    ].join('');
  }

  // ---------------------------------------------------------------------------
  // Controls, focus and divider
  // ---------------------------------------------------------------------------
  function initUI() {
    const rate = $('rate');
    rate.addEventListener('input', () => { ui.rate = +rate.value; $('rateVal').textContent = `${ui.rate} bpm`; S.setRate(ui.rate); });
    const ts = $('timescale');
    ts.addEventListener('input', () => { ui.scaleIdx = +ts.value; $('tsVal').textContent = SCALE_LABEL[ui.scaleIdx]; });
    for (const id of ['viewExt', 'viewCut']) $(id).addEventListener('change', (e) => setView(e.target.value));
    $('btnPause').addEventListener('click', () => { ui.paused = !ui.paused; $('btnPause').textContent = ui.paused ? 'Resume' : 'Pause'; });
    $('btnReset').addEventListener('click', () => { newSim(); });
    const toggle = () => {
      const c = $('controls').classList.toggle('collapsed');
      $('ctlChevron').textContent = c ? 'Show' : 'Hide'; $('ctlHead').setAttribute('aria-expanded', String(!c));
      resize3D();
    };
    $('ctlHead').addEventListener('click', toggle);
    if (window.matchMedia('(max-width: 760px)').matches) toggle();   // start collapsed on phones
    $('ctlHead').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    $('btnGuide').addEventListener('click', () => { $('guide').hidden = false; });
    $('guideClose').addEventListener('click', () => { $('guide').hidden = true; });
    $('guide').addEventListener('click', (e) => { if (e.target.id === 'guide') $('guide').hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('guide').hidden = true; });

    // split: focus buttons and draggable divider
    const split = $('split');
    const setSplit = (pct) => split.style.setProperty('--split', `${Math.max(18, Math.min(82, pct))}%`);
    $('focus3d').addEventListener('click', () => setSplit(split.style.getPropertyValue('--split') === '70%' ? 50 : 70));
    $('focusEcg').addEventListener('click', () => setSplit(split.style.getPropertyValue('--split') === '30%' ? 50 : 30));
    const div = $('divider');
    div.addEventListener('dblclick', () => setSplit(50));
    div.addEventListener('pointerdown', (e) => {
      div.setPointerCapture(e.pointerId); div.classList.add('drag');
      const vertical = getComputedStyle(split).flexDirection === 'column';
      const move = (ev) => {
        const r = split.getBoundingClientRect();
        setSplit(vertical ? (ev.clientY - r.top) / r.height * 100 : (ev.clientX - r.left) / r.width * 100);
      };
      const up = () => { div.classList.remove('drag'); div.removeEventListener('pointermove', move); div.removeEventListener('pointerup', up); };
      div.addEventListener('pointermove', move); div.addEventListener('pointerup', up);
    });
    div.addEventListener('keydown', (e) => {
      const cur = parseFloat(split.style.getPropertyValue('--split')) || 50;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSplit(cur - 4);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSplit(cur + 4);
    });
  }

  boot();
})();
