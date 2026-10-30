/* =============================================================================
 * LiveHeart app — Three.js heart view, ECG paper, interpretation, controls
 * ========================================================================== */
(function () {
  'use strict';
  const LH = window.LiveHeart;
  const $ = (id) => document.getElementById(id);
  const PHONE = '(max-width: 743px), (max-height: 500px)';   // one pane at a time below an iPad mini

  const PAGE = 10000;        // ms of ECG on one sheet (10 s)
  const ERASE = 140;         // ms blank gap ahead of the sweep cursor
  const SCALES = [0.02, 0.05, 0.1, 0.2, 1 / 3, 0.5, 1];
  const SCALE_LABEL = ['1/50×', '1/20×', '1/10×', '1/5×', '1/3×', '1/2×', '1×'];
  const MAX_STEPS_PER_FRAME = 40;   // a slow frame drops simulated time instead of catching up (no stutter spiral)

  // Tissue state colours (linear RGB 0..1): spec — pink resting, blue
  // depolarizing, green repolarizing; the conduction system rests in gold.
  const C = {
    rest: [0.95, 0.62, 0.71], front: [0.10, 0.30, 1.00], dep: [0.30, 0.47, 0.90],
    rep: [0.14, 0.72, 0.38], cs: [0.93, 0.71, 0.16],
    blocked: [0.88, 0.19, 0.25], partial: [1.0, 0.54, 0.12],
    ischemic: [0.56, 0.36, 0.80], necrotic: [0.40, 0.33, 0.37],
    artery: [0.84, 0.17, 0.20], occluded: [0.30, 0.24, 0.32],
  };
  const STATIC = { 5: 0xb86e60, 6: 0x6f82ad, 7: 0xe8dcc0, 8: 0xe8dcc0, 9: 0xe8dcc0, 10: 0xe8dcc0, 11: 0x7d6f9c };

  let A, M, S;
  const ui = { tab: 'rhythm', cutFrac: 0, strips: ['II'], rateMode: 'sinus', struct: { rae: false, lae: false, lvh: false, rvh: false, ap: '', dual: true }, ischH: 0, ischPending: null, cutDepth: 0, action: 'stimulate', labels: false, leads: false, scaleIdx: 6, paused: false, view: 'external', rate: 72, acc: 0, last: 0 };
  const bufIdx = (t) => (((Math.round(t) + ecg.t0) % PAGE) + PAGE) % PAGE;   // sim time → paper sample
  const ecg = { t0: 0, buf: LH.LEADS.map(() => new Float32Array(PAGE).fill(NaN)) };
  const g3 = {};

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function setLoading(msg) { $('loadMsg').textContent = msg; }
  const tick = () => new Promise((r) => setTimeout(r, 30));

  async function boot() {
    if (!window.THREE) { setLoading('The 3D library could not load. Check your connection and reload.'); return; }
    await tick();
    LH.setDefaultTorso(JSON.parse($('torso-data').textContent));
    await buildHeart();
    try { init3D(); } catch (e) { setLoading('WebGL is not available in this browser, so the 3D view cannot start.'); console.error(e); return; }
    initECG(); initUI();
    $('loading').hidden = true;
    // handle for automation (tests, future quiz mode): simulator, model and a projector
    window.LiveHeartApp = {
      get sim() { return S; }, model: M, perf,
      ischemia: {
        occlude(node) { captureRef(); const id = S.addOcclusion(node); if (!ui.ischH) setIschTime(1); else S.setIschemiaTime(ui.ischH); recolorIschemia(); renderIschList(); return id; },
        subendo(cell, r = 55) { captureRef(); const id = S.addSubendocardial(cell, r); if (!ui.ischH) setIschTime(1); else S.setIschemiaTime(ui.ischH); recolorIschemia(); renderIschList(); return id; },
        hours(h) { setIschTime(h); recolorIschemia(); },
        clear() { S.clearIschemia(); recolorIschemia(); renderIschList(); },
        segmentName: (id) => segmentName(id),
      },
      interpret: () => interpret(),
      screenOf(id) {
        const p = new THREE.Vector3(M.x[id], M.y[id], M.z[id]).applyMatrix4(g3.inner.matrixWorld).project(g3.camera);
        const r = $('c3d').getBoundingClientRect();
        return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
      },
    };
    ui.last = performance.now();
    requestAnimationFrame(loop);
  }

  // anatomy + model for the current structural options (hypertrophy rebuilds both)
  async function buildHeart(keepEcg = false) {
    const ho = LH.hypertrophyOptions(ui.struct);
    setLoading(ui.struct.lvh || ui.struct.rvh ? 'Growing the hypertrophied wall…' : 'Reading anatomy…'); await tick();
    A = new LH.Anatomy(JSON.parse($('anatomy-data').textContent), ho.anatomy);
    setLoading('Building tissue graph and conduction system…'); await tick();
    M = new LH.Model(A, ho.params);
    setLoading('Tuning repolarization to the sinus beat…'); await tick();
    newSim(keepEcg);
  }
  // Each hypertrophy configuration (anatomy, model and its 3D scene) is kept
  // once built, so switching back to it is immediate.
  const heartCache = new Map();
  const G3_FIXED = new Set(['renderer', 'scene', 'camera', 'outer', 'inner', 'controls', 'planeDirty']);
  const heartKey = () => `${+ui.struct.lvh}${+ui.struct.rvh}`;
  function storeHeart(key) {
    if (heartCache.has(key)) return;
    const fields = {}; for (const k of Object.keys(g3)) if (!G3_FIXED.has(k)) fields[k] = g3[k];
    heartCache.set(key, { A, M, fields, children: g3.inner.children.slice(), labels: [...$('labels').childNodes] });
  }
  async function rebuildHeart(prevKey) {
    storeHeart(prevKey);
    const hit = heartCache.get(heartKey());
    g3.inner.clear();
    if (hit) {
      A = hit.A; M = hit.M; newSim(true);
      Object.assign(g3, hit.fields); g3.inner.add(...hit.children); $('labels').replaceChildren(...hit.labels);
    } else {
      // (a small note instead of the full-screen overlay, so the ECG stays in view)
      $('rebuildNote').hidden = false; await tick();
      await buildHeart(true);
      $('labels').innerHTML = '';
      buildSurfaces(); buildConduction(); buildCoronaries(); buildCutPlane(); buildOverlays();
    }
    placeAPMarker(); recolorIschemia();
    const v = ui.view; setView(v);
    renderBlockList(); setIschTime(0); renderIschList(); ui.ref = null; ui.normalAxis = undefined;
    $('rebuildNote').hidden = true; syncRate();
  }

  // keepEcg: carry on writing the paper where the previous simulation stopped
  // (structure rebuilds), so the old complexes stay beside the new ones
  function newSim(keepEcg = false) {
    if (keepEcg && S) ecg.t0 = (ecg.t0 + S.t) % PAGE; else ecg.t0 = 0;
    S = new LH.Sim(M, { seed: 1 });
    S.setRate(ui.rate);
    S.setAtrialEnlargement({ ra: ui.struct.rae, la: ui.struct.lae });
    S.setAccessoryPathway(ui.struct.ap || null);
    S.setDualAVN(ui.struct.dual);
    if (!keepEcg) for (const b of ecg.buf) b.fill(NaN);
    if (g3.apMark) placeAPMarker();
    const t0 = ecg.t0;
    S.onSample((t, L) => { const i = (t + t0) % PAGE; for (let k = 0; k < 12; k++) ecg.buf[k][i] = L[k]; });
    ui.acc = 0; ui.ischPending = null;
    $('rhythm').textContent = 'Acquiring…'; $('chips').innerHTML = ''; $('findings').innerHTML = '';
    if (g3.cor) { recolorIschemia(); renderIschList(); }
  }

  // ---------------------------------------------------------------------------
  // Main loop: advance simulated time by wall time × time scale (1 ms steps)
  // ---------------------------------------------------------------------------
  let interpTimer = 0;
  const perf = { frames: 0, steps: 0, tSim: 0, t3d: 0, tEcg: 0 };
  function loop(now) {
    const dt = Math.min(100, now - ui.last); ui.last = now;
    if (ui.ischPending !== null) { S.setIschemiaTime(ui.ischPending); ui.ischPending = null; recolorIschemia(); interpret(true); }
    if (!ui.paused) {
      ui.acc += dt * SCALES[ui.scaleIdx];
      let n = Math.floor(ui.acc); ui.acc -= n;
      if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; ui.acc = 0; }
      const t0 = performance.now();
      // frame budget: the QRS costs several times a diastolic step, so stop at
      // ~9 ms and carry the rest into the next frames (caught up in diastole)
      for (let i = 0; i < n; i++) {
        S.step();
        if ((i & 3) === 3 && performance.now() - t0 > 9) { ui.acc = Math.min(ui.acc + n - i - 1, 120); break; }
      }
      perf.tSim += performance.now() - t0; perf.steps += n;
      checkAvnrt();
    }
    const t1 = performance.now();
    update3D();
    const t2 = performance.now();
    drawECG();
    perf.t3d += t2 - t1; perf.tEcg += performance.now() - t2; perf.frames++;
    if ((interpTimer += dt) > 300) { interpTimer = 0; syncRate(); interpret(); }
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
    const R9 = M.rot;   // same heart-to-torso rotation the lead fields use
    outer.setRotationFromMatrix(new THREE.Matrix4().set(R9[0], R9[1], R9[2], 0, R9[3], R9[4], R9[5], 0, R9[6], R9[7], R9[8], 0, 0, 0, 0, 1));
    const inner = g3.inner = new THREE.Group();
    inner.position.set(-M.center[0], -M.center[1], -M.center[2]);
    outer.add(inner); scene.add(outer);

    buildSurfaces();
    buildConduction();
    buildCoronaries();
    buildCutPlane();
    buildOverlays();

    const ctl = g3.controls = new THREE.OrbitControls(cam, canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.enablePan = false;
    ctl.minDistance = 140; ctl.maxDistance = 900;
    setView('external'); setCut(0); cameraPreset('front');
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

  // nearest excitable voxel to a heart-frame point (within r voxels)
  function nearestTissue(x, y, z, r = 2) {
    const h = A.h, o = A.origin;
    const i0 = Math.floor((x - o[0]) / h), j0 = Math.floor((y - o[1]) / h), k0 = Math.floor((z - o[2]) / h);
    let best = -1, bd = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let e = -r; e <= r; e++) {
      const c = A.at(i0 + a, j0 + b, k0 + e); if (c < 0 || !M.kind[c]) continue;
      const dx = A.pos[3 * c] - x, dy = A.pos[3 * c + 1] - y, dz = A.pos[3 * c + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // The simulated LV free wall is thickened by whole voxel layers on its outer
  // surface; push the displayed epicardium out by the same amount so the
  // picture matches the tissue. The offset fades out at the septal junctions,
  // the base and near other structures, which keeps the surface set closed.
  function thickenLV(geo, dist, others, label = 1, weight = LH.lvThickenWeight) {
    const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, nv = pos.length / 3;
    const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const isOutside = (x, y, z) => {
      const i = Math.floor((x - A.origin[0]) / A.h), j = Math.floor((y - A.origin[1]) / A.h), k = Math.floor((z - A.origin[2]) / A.h);
      const c = A.at(i, j, k); if (c === -2) return true; if (c >= 0) return false;
      const [nx, ny, nz] = A.dims; return A.cavityComp[(i * ny + j) * nz + k] === 0;
    };
    // 1. raw weight from the shared thickness map (epicardial vertices only)
    const w = new Float32Array(nv), epi = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) {
      const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2], ax = nrm[3 * v], ay = nrm[3 * v + 1], az = nrm[3 * v + 2];
      if (!isOutside(x + ax * (dist + 2), y + ay * (dist + 2), z + az * (dist + 2))) continue;   // endocardial face
      epi[v] = 1;
      const c = nearestTissue(x, y, z); if (c < 0 || A.label[c] !== label) continue;
      w[v] = weight(A.phi[c], A.zuvc[c]) * smooth((others.nearest(x, y, z) - 3) / 9);
    }
    // 2. smooth the weight over the mesh so neighbouring vertices agree (no voxel-scale noise)
    const idx = geo.index.array, nbr = Array.from({ length: nv }, () => []);
    for (let f = 0; f < idx.length; f += 3) for (let e = 0; e < 3; e++) { const a = idx[f + e], b = idx[f + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
    let cur = w;
    for (let it = 0; it < 25; it++) {
      const nx = new Float32Array(nv);
      for (let v = 0; v < nv; v++) {
        if (!epi[v]) continue;
        let s = cur[v], n = 1; for (const u of nbr[v]) if (epi[u]) { s += cur[u]; n++; }
        nx[v] = s / n;
      }
      cur = nx;
    }
    for (let v = 0; v < nv; v++) {
      const d = dist * cur[v]; if (!d) continue;
      pos[3 * v] += nrm[3 * v] * d; pos[3 * v + 1] += nrm[3 * v + 1] * d; pos[3 * v + 2] += nrm[3 * v + 2] * d;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // spatial hash of vertices of every non-LV surface (distance queries)
  function vertexIndex(list) {
    const cell = 6, map = new Map(), key = (a, b, c) => `${a},${b},${c}`;
    for (const p of list) { const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)); if (!map.has(k)) map.set(k, []); map.get(k).push(p); }
    return { nearest(x, y, z) {
      const i = Math.floor(x / cell), j = Math.floor(y / cell), k = Math.floor(z / cell); let best = 40;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
        const l = map.get(key(i + a, j + b, k + c)); if (l) for (const p of l) { const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z); if (d < best) best = d; }
      }
      return best;
    } };
  }

  function buildSurfaces() {
    const span = A.dims.map((d) => d * A.h);
    const othersOf = (label) => {
      const list = [];
      for (const s of A.json.surfaces) {
        if (s.label === label) continue;
        const q = decodeB64(s.pos, Uint16Array);
        for (let i = 0; i < q.length; i += 9) list.push([0, 1, 2].map((d) => A.origin[d] + (q[i + d] / 65535) * span[d]));
      }
      return vertexIndex(list);
    };
    const otherVerts = othersOf(1), otherRV = A.rvWallLayers ? othersOf(2) : null, otherRA = A.raWallLayers ? othersOf(4) : null;
    g3.tissueMeshes = []; g3.clipMats = []; g3.allGeos = []; g3.pickTissue = [];
    for (const s of A.json.surfaces) {
      const q = decodeB64(s.pos, Uint16Array), idx = decodeB64(s.idx, Uint32Array);
      const pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) pos[i] = A.origin[i % 3] + (q[i] / 65535) * span[i % 3];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      if (s.label === 1 && A.lvWallLayers) thickenLV(geo, A.lvWallLayers * A.h, otherVerts);
      if (s.label === 2 && A.rvWallLayers) thickenLV(geo, A.rvWallLayers * A.h, otherRV, 2, LH.rvThickenWeight);
      if (s.label === 4 && A.raWallLayers) thickenLV(geo, A.raWallLayers * A.h, otherRA, 4, () => 1);
      let mat;
      if (s.label <= 4) {
        const nv = pos.length / 3, col = new Float32Array(pos.length), vmap = new Int32Array(nv);
        for (let v = 0; v < nv; v++) {
          vmap[v] = nearestTissue(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
          if (vmap[v] < 0) vmap[v] = nearestTissue(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], 4);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: 0x222222, side: THREE.DoubleSide });
        g3.tissueMeshes.push({ geo, vmap, col });
      } else {
        const valve = s.label >= 7 && s.label <= 10;
        mat = new THREE.MeshPhongMaterial({ color: STATIC[s.label], shininess: 15, side: THREE.DoubleSide, transparent: valve, opacity: valve ? 0.55 : 1 });
      }
      const mesh = new THREE.Mesh(geo, mat);
      if (s.label <= 4) g3.pickTissue.push(mesh);
      g3.clipMats.push(mat);
      g3.inner.add(mesh);
      g3.allGeos.push(geo);
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
    g3.tubes = []; g3.pickTubes = [];
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
      // invisible, thicker twin for easy clicking
      const pgeo = new THREE.TubeGeometry(curve, tub, 3.2, rad, false);
      const pick = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      pick.userData.map = map; grp.add(pick); g3.pickTubes.push(pick);
    }
    // accessory pathway marker (shown when one is set)
    g3.apMark = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 10), new THREE.MeshPhongMaterial({ color: 0x38c6e8, emissive: 0x0a3a48 }));
    g3.inner.add(g3.apMark); placeAPMarker();
    // sinus node marker (visible in both views)
    const san = g3.san = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x333333 }));
    const sp = nodePos(M.sanCell, -1.0); san.position.set(sp[0], sp[1], sp[2]);
    g3.inner.add(san);
    const sanPick = g3.sanPick = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    sanPick.position.copy(san.position); g3.inner.add(sanPick);
  }

  function placeAPMarker() {
    const m = g3.apMark; if (!m) return;
    m.visible = !!(S.ap); $('legendAP').hidden = !S.ap;
    if (!S.ap) return;
    const a = new THREE.Vector3(...A.p(S.ap.a)), v = new THREE.Vector3(...A.p(S.ap.v)), d = v.clone().sub(a);
    const len = Math.max(4, d.length() + 4);
    m.scale.set(1, len, 1); m.position.copy(a).add(v).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }

  // Epicardial coronary arteries: one tube per branch through the tree nodes,
  // lifted just off the surface, coloured red (perfused) or dusky
  // (downstream of an occlusion). Clicking one occludes it there.
  function outwardOf(c) {
    const d = [0, 0, 0], [nx, ny, nz] = A.dims, i = A.ii[c], j = A.jj[c], k = A.kk[c];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) {
      const ii = i + a, jj = j + b, kk = k + e;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) { d[0] += a; d[1] += b; d[2] += e; continue; }
      if (A.at(ii, jj, kk) < 0 && A.cavityComp[(ii * ny + jj) * nz + kk] <= 0) { d[0] += a; d[1] += b; d[2] += e; }
    }
    const l = Math.hypot(d[0], d[1], d[2]);
    return l ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 0];
  }
  const MAJOR = { LM: 1.7, LAD: 1.45, LCx: 1.45, RCA: 1.5 };
  function buildCoronaries() {
    const cor = M.coronary, grp = g3.cor = new THREE.Group(); g3.inner.add(grp);
    g3.corTubes = []; g3.corPick = [];
    const posOf = cor.nodes.map((n) => { const o = outwardOf(n.vox); return new THREE.Vector3(n.x + o[0] * 2.4, n.y + o[1] * 2.4, n.z + o[2] * 2.4); });
    for (const [name, ids0] of Object.entries(cor.branches)) {
      const par = cor.nodes[ids0[0]].parent, ids = par >= 0 ? [par].concat(ids0) : ids0;
      if (ids.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(ids.map((id) => posOf[id]));
      const tub = Math.max(6, (ids.length - 1) * 4), rad = 6, r = MAJOR[name] || 1.0;
      const geo = new THREE.TubeGeometry(curve, tub, r, rad, false);
      const nv = geo.attributes.position.count, col = new Float32Array(nv * 3), map = new Int32Array(nv);
      // the joint with the parent belongs to this branch, so occluding a branch's origin greys it
      for (let v = 0; v < nv; v++) { const ring = Math.floor(v / (rad + 1)); map[v] = ids[Math.max(par >= 0 ? 1 : 0, Math.round(ring / tub * (ids.length - 1)))]; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x553333 }));
      g3.clipMats.push(mesh.material);
      grp.add(mesh); g3.corTubes.push({ geo, col, map });
      const pick = new THREE.Mesh(new THREE.TubeGeometry(curve, tub, 3.6, rad, false), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      pick.userData.map = map; grp.add(pick); g3.corPick.push(pick);
    }
    g3.corPos = posOf;
    g3.clots = new THREE.Group(); grp.add(g3.clots);
    g3.restCol = new Float32Array(M.nVox * 3);
    recolorIschemia();
  }

  // artery segment name for a tree node, e.g. "proximal LAD"
  const BRANCH_NAME = { LM: 'left main', LAD: 'LAD', D1: 'first diagonal', D2: 'second diagonal', LCx: 'circumflex', OM1: 'first obtuse marginal', OM2: 'second obtuse marginal', RCA: 'RCA', AM: 'acute marginal', PDA: 'posterior descending', PLV: 'posterolateral branch' };
  function segmentName(id) {
    const cor = M.coronary, b = cor.nodes[id].branch, list = cor.branches[b], k = list.indexOf(id), f = k / Math.max(1, list.length - 1);
    if (b === 'LM') return 'left main';
    if (!['LAD', 'LCx', 'RCA'].includes(b)) return BRANCH_NAME[b];
    // proximal = up to the first side branch (D1, OM1, acute marginal)
    let firstK = Infinity;
    for (const n of cor.nodes) if (n.parent >= 0 && n.branch !== b && cor.nodes[n.parent].branch === b) firstK = Math.min(firstK, list.indexOf(n.parent));
    const pos = k <= firstK || f < 0.25 ? 'proximal' : f < 0.65 ? 'mid' : 'distal';
    return `${pos} ${BRANCH_NAME[b]}`;
  }

  // territory tint (resting colour per voxel) and artery colours after any change
  function recolorIschemia() {
    ui.ischChangedAt = S.t;                                       // beats before this no longer reflect the tissue
    const rc = g3.restCol, lv = S.ischLevel, occl = S.insults.filter((x) => x.kind === 'occlusion');
    for (let c = 0; c < M.nVox; c++) {
      const l = lv ? lv[c] : 0, o = 3 * c;
      if (l >= 2) { rc[o] = C.necrotic[0]; rc[o + 1] = C.necrotic[1]; rc[o + 2] = C.necrotic[2]; continue; }
      const k = Math.min(1, l * 1.4);
      for (let d = 0; d < 3; d++) rc[o + d] = C.rest[d] + (C.ischemic[d] - C.rest[d]) * k;
    }
    for (const tb of g3.corTubes) {
      for (let v = 0; v < tb.map.length; v++) {
        const dn = occl.some((x) => M.isDownstream(tb.map[v], x.node)), cc = dn ? C.occluded : C.artery;
        tb.col[3 * v] = cc[0]; tb.col[3 * v + 1] = cc[1]; tb.col[3 * v + 2] = cc[2];
      }
      tb.geo.attributes.color.needsUpdate = true;
    }
    g3.clots.clear();
    for (const x of occl) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(2.8, 14, 10), new THREE.MeshPhongMaterial({ color: 0xffd84a, emissive: 0x6a5200 }));
      m.position.copy(g3.corPos[x.node]); g3.clots.add(m);
    }
    const any = S.insults.length > 0;
    $('legendIsch').hidden = !any;
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
    g3.plane = new THREE.Plane();
    // short-axis cut: perpendicular to the LV long axis at mid-ventricular
    // (papillary) level, apical half removed, viewed from the apex
    const lax = new THREE.Vector3(apex[0] - mv[0], apex[1] - mv[1], apex[2] - mv[2]);
    const saN = lax.clone().normalize();                        // points toward the removed (apical) side
    const saP = new THREE.Vector3(mv[0], mv[1], mv[2]).addScaledVector(lax, 0.55);
    // cut presets (heart frame): plane normal points toward the viewer (removed side)
    const lvc = [0, 0, 0]; let nl = 0;
    for (let c = 0; c < A.n; c++) if (A.label[c] === 1) { lvc[0] += A.pos[3 * c]; lvc[1] += A.pos[3 * c + 1]; lvc[2] += A.pos[3 * c + 2]; nl++; }
    g3.lvCenter = new THREE.Vector3(lvc[0] / nl, lvc[1] / nl, lvc[2] / nl);
    g3.lax = lax.clone().normalize();
    g3.cutPresets = {
      anterior: { n: nrm, p: p0, up: [0, 1, 0], dist: 360 },
      lateral: { world: [1, 0.05, 0.1], p: g3.lvCenter, up: [0, 1, 0], dist: 340 },   // from the patient's left
      short: { n: saN, p: saP, up: [0, 0, 1], dist: 300 },
    };
    // Cut face by stencil capping. Every surface (which together bound the
    // heart wall as one closed solid) is drawn into the stencil buffer only:
    // back faces +1, front faces −1, both clipped by the cut plane. Where the
    // plane lies inside the wall the count is non-zero, so the cap below is
    // drawn exactly inside the smooth contour of the sliced mesh.
    const sg = g3.stencil = new THREE.Group(); g3.inner.add(sg);
    const sMat = (side, op) => new THREE.MeshBasicMaterial({
      side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [g3.plane],
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
    });
    const back = sMat(THREE.BackSide, THREE.IncrementWrapStencilOp), front = sMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
    for (const geo of g3.allGeos) {
      const mb = new THREE.Mesh(geo, back), mf = new THREE.Mesh(geo, front);
      mb.renderOrder = mf.renderOrder = 1; sg.add(mb, mf);
    }
    buildGridMap();
    g3.slab = buildCap();
    const stat = {}; for (const [k, hex] of Object.entries(STATIC)) { const cc = new THREE.Color(hex); stat[k] = [cc.r, cc.g, cc.b]; }
    g3.slab.stat = stat;
  }

  // What the cut face shows at every grid cell: the excitable voxel there, a
  // static structure (−label), or for empty cells next to tissue the nearest
  // excitable voxel (the smooth surface reaches a little beyond the voxels).
  // Precomputed once so a moved cut plane can be re-capped in a few ms.
  function buildGridMap() {
    const [nx, ny, nz] = A.dims, gm = new Int32Array(nx * ny * nz).fill(-1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const c = A.at(i, j, k), g = (i * ny + j) * nz + k;
      if (c >= 0) { gm[g] = M.kind[c] ? c : -A.label[c]; continue; }
      let best = -1, bd = 99;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) {
        const w = A.at(i + a, j + b, k + e); if (w < 0 || !M.kind[w]) continue;
        const d = a * a + b * b + e * e; if (d < bd) { bd = d; best = w; }
      }
      gm[g] = best;
    }
    g3.gridMap = gm;
  }

  // The cap: a fine grid lying on the current cut plane, vertex-coloured from
  // the tissue underneath, drawn only where the stencil says the plane lies
  // inside the heart wall. The grid is re-laid whenever the plane moves.
  const CAP_R = 120, CAP_STEP = 1.25, CAP_N = Math.ceil(2 * CAP_R / CAP_STEP) + 1;
  function buildCap() {
    const nV = CAP_N * CAP_N, pos = new Float32Array(nV * 3), map = new Int32Array(nV).fill(-1), idx = [];
    for (let i = 1; i < CAP_N; i++) for (let j = 1; j < CAP_N; j++) {
      const a0 = (i - 1) * CAP_N + j - 1, a1 = i * CAP_N + j - 1, a2 = i * CAP_N + j, a3 = (i - 1) * CAP_N + j;
      idx.push(a0, a1, a2, a0, a2, a3);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ccol = new Float32Array(nV * 3);
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    cg.setIndex(idx);
    const cap = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    }));
    cap.renderOrder = 2;
    cap.onAfterRender = (r) => r.clearStencil();
    g3.inner.add(cap); cap.visible = false;
    return { im: cap, map, col: ccol, geo: cg };
  }

  // lay the cap grid on a plane given in the heart frame (n toward the removed side)
  function layCap(nL, pL) {
    const cap = g3.slab, pos = cap.geo.attributes.position.array, map = cap.map, gm = g3.gridMap;
    const ref = Math.abs(nL.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(nL, ref).normalize(), v = new THREE.Vector3().crossVectors(u, nL).normalize();
    // centre the grid on the heart centre's projection onto the plane
    const hc = new THREE.Vector3(...M.center), c0 = hc.clone().addScaledVector(nL, pL.clone().sub(hc).dot(nL)).addScaledVector(nL, -0.05);
    const [nx, ny, nz] = A.dims, o = A.origin, h = A.h;
    for (let i = 0; i < CAP_N; i++) for (let j = 0; j < CAP_N; j++) {
      const a = -CAP_R + i * CAP_STEP, b = -CAP_R + j * CAP_STEP, q = i * CAP_N + j;
      const x = c0.x + u.x * a + v.x * b, y = c0.y + u.y * a + v.y * b, z = c0.z + u.z * a + v.z * b;
      pos[3 * q] = x; pos[3 * q + 1] = y; pos[3 * q + 2] = z;
      const gi = Math.floor((x - o[0]) / h), gj = Math.floor((y - o[1]) / h), gk = Math.floor((z - o[2]) / h);
      map[q] = gi < 0 || gj < 0 || gk < 0 || gi >= nx || gj >= ny || gk >= nz ? -1 : gm[(gi * ny + gj) * nz + gk];
    }
    cap.geo.attributes.position.needsUpdate = true;
    cap.geo.computeBoundingSphere();
  }

  // The cut plane always faces the viewer: its normal is the camera's viewing
  // direction and the depth slider slides it along that axis.
  function applyCutPlane() {
    g3.planeDirty = false;
    const cam = g3.camera, tgt = g3.controls.target;
    const dir = cam.position.clone().sub(tgt).normalize();
    const pW = tgt.clone().addScaledVector(dir, ui.cutDepth);
    g3.plane.setFromNormalAndCoplanarPoint(dir.clone().negate(), pW);
    g3.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g3.inner.matrixWorld).invert();
    const pL = pW.clone().applyMatrix4(inv), nL = dir.clone().transformDirection(inv);
    layCap(nL, pL);
    placeCutLabels(nL, pL, cam.position.clone().applyMatrix4(inv));
    $('viewName').textContent = `cutaway · ${cutViewName(dir, nL)}`;
  }

  // Name the current cut from the viewing direction (world = torso frame:
  // X patient left, Y superior, Z anterior): short axis when looking along the
  // LV long axis, the four-chamber cut near the anterior preset, otherwise the
  // side the heart is seen from.
  function cutViewName(dir, nL) {
    const ax = Math.abs(nL.dot(g3.lax));
    if (ax > 0.85) return nL.dot(g3.lax) > 0 ? 'short axis (from the apex)' : 'short axis (from the base)';
    if (nL.dot(g3.cutPresets.anterior.n) > 0.93) return 'anterior (four-chamber)';
    const parts = [[dir.z, 'anterior', 'posterior'], [dir.x, 'left lateral', 'right lateral'], [dir.y, 'superior', 'inferior']]
      .map(([v, pos, neg]) => ({ w: Math.abs(v), name: v > 0 ? pos : neg })).sort((a, b) => b.w - a.w);
    if (parts[1].w > 0.45 * parts[0].w + 0.15) {
      const n0 = parts[0].name, n1 = parts[1].name.replace(' lateral', '');
      return `${n0.replace(' lateral', '')}–${n1}${/lateral/.test(n0 + parts[1].name) ? '' : ''} oblique`;
    }
    return parts[0].name;
  }

  function cutPreset(name) {
    const pr = g3.cutPresets[name], cam = g3.camera, ctl = g3.controls;
    g3.scene.updateMatrixWorld(true);
    const mw = g3.inner.matrixWorld;
    const dir = pr.world ? new THREE.Vector3(...pr.world).normalize() : pr.n.clone().transformDirection(mw);
    ctl.target.set(0, 0, 0);
    cam.position.copy(dir).multiplyScalar(ui.leads ? 660 : pr.dist);
    cam.up.set(...pr.up); cam.lookAt(0, 0, 0); ctl.update();
    g3.planeDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Overlays: anatomical labels and ECG lead vectors
  // ---------------------------------------------------------------------------
  function buildOverlays() {
    const layer = $('labels');
    const Cv = M.center, V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const voxCentroid = (f) => { const s = [0, 0, 0]; let n = 0; for (let c = 0; c < A.n; c++) if (f(c)) { s[0] += A.pos[3 * c]; s[1] += A.pos[3 * c + 1]; s[2] += A.pos[3 * c + 2]; n++; } return n ? s.map((x) => x / n) : null; };
    const farthest = (f, d) => {
      let best = -1, bs = -Infinity; const l = Math.hypot(...d);
      for (let c = 0; c < A.n; c++) { if (!f(c)) continue; const sc = ((A.pos[3 * c] - Cv[0]) * d[0] + (A.pos[3 * c + 1] - Cv[1]) * d[1] + (A.pos[3 * c + 2] - Cv[2]) * d[2]) / l; if (sc > bs) { bs = sc; best = c; } }
      return A.p(best);
    };
    const lab = (L) => (c) => A.label[c] === L;
    const epiOf = (L) => (c) => A.label[c] === L && A.epi[c];
    const mid = (ids, f = 0.5) => { const id = ids[Math.floor((ids.length - 1) * f)]; return [M.x[id], M.y[id], M.z[id]]; };
    g3.labels = [];
    const add = (text, p, view, kind = 'anat', nrm = null) => {
      const el = document.createElement('div'); el.className = `tag ${kind}`; el.textContent = text; layer.appendChild(el);
      const pos = V3(p);
      g3.labels.push({ el, pos, view, nrm: nrm || pos.clone().sub(V3(Cv)).normalize(), space: 'heart' });
    };
    // external view: surface anchors, hidden when they face away from the camera
    add('Right atrium', farthest(epiOf(4), [-1, 0.2, 0.3]), 'external');
    add('Left atrium', farthest(epiOf(3), [0.2, 0.3, -1]), 'external');
    add('Right ventricle', farthest(epiOf(2), [-0.3, -0.3, 1]), 'external');
    add('Left ventricle', farthest(epiOf(1), [1, -0.2, -0.2]), 'external');
    add('Apex', farthest(epiOf(1), [0.5, -0.64, 0.58]), 'external');
    add('Aorta', farthest(lab(5), [0, 1, 0]), 'external');
    add('Pulmonary trunk', farthest(lab(6), [0.2, 0.7, 0.7]), 'external');
    add('SVC', A.landmarks.SVC.c, 'external');
    add('IVC', A.landmarks.IVC.c, 'external');
    add('SA node', [M.x[M.sanCell], M.y[M.sanCell], M.z[M.sanCell]], 'both', 'cs');
    // cut views: chamber/wall names are placed on the current plane by placeCutLabels()
    for (const key of ['RA', 'LA', 'RV', 'LV', 'Septum', 'Anterior wall', 'Lateral wall', 'Inferior wall', 'Mitral valve', 'Tricuspid valve']) {
      const el = document.createElement('div'); el.className = `tag ${key.length <= 2 ? 'chamber' : 'anat'}`; el.textContent = key; layer.appendChild(el);
      g3.labels.push({ el, pos: new THREE.Vector3(), view: 'cut-dyn', key, off: true, space: 'heart' });
    }
    // cavity cells per ventricle (for chamber-centre labels), collected once
    g3.cavCells = { 1: [], 2: [] };
    { const [nx, ny, nz] = A.dims;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
        const cid = A.cavityComp[(i * ny + j) * nz + k], L = cid > 0 ? A.cavityLabel[cid] : 0;
        if (L === 1 || L === 2) g3.cavCells[L].push(A.origin[0] + (i + 0.5) * A.h, A.origin[1] + (j + 0.5) * A.h, A.origin[2] + (k + 0.5) * A.h);
      } }
    const S_ = M.csSegments;
    add('AV node', mid(S_.AVN), 'cutaway', 'cs');
    add('His bundle', mid(S_.HIS, 0.7), 'cutaway', 'cs');
    add('Left bundle', mid(S_.LBB), 'cutaway', 'cs');
    add('Left anterior fascicle', mid(S_.LAF, 0.75), 'cutaway', 'cs');
    add('Left posterior fascicle', mid(S_.LPF, 0.75), 'cutaway', 'cs');
    if (S_.LSF.length) add('Septal fascicle', mid(S_.LSF, 0.9), 'cutaway', 'cs');
    add('Right bundle', mid(S_.RBB, 0.45), 'cutaway', 'cs');
    add('Moderator band', mid(S_.RBB, 0.85), 'cutaway', 'cs');

    // lead vectors, drawn in the torso frame shifted to the heart centre
    const grp = g3.leads = new THREE.Group(); grp.visible = false; g3.scene.add(grp);
    const hc = M.heartCenterTorso;
    const arrowMat = (hex) => new THREE.MeshBasicMaterial({ color: hex, depthTest: false, transparent: true, opacity: 0.95 });
    const arrow = (dir, len, hex, head = 7) => {
      const a = new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(), len, hex, head, head * 0.55);
      a.line.material.depthTest = false; a.line.material.transparent = true; a.cone.material.depthTest = false;
      a.renderOrder = 10; a.line.renderOrder = 10; a.cone.renderOrder = 10;
      grp.add(a); return a;
    };
    const leadTag = (text, p, kind) => {
      const el = document.createElement('div'); el.className = `tag ${kind}`; el.textContent = text; layer.appendChild(el);
      g3.labels.push({ el, pos: p, view: 'leads', space: 'scene' });
      return g3.labels[g3.labels.length - 1];
    };
    // limb leads: the torso's own heart-averaged lead vectors (a computed
    // Burger triangle) when available, else Einthoven's hexaxial directions
    const lv = M.limbLeadVectors, V3v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    let LIMB;
    if (lv) {
      const LI = V3v(lv.I), LII = V3v(lv.II), LIII = LII.clone().sub(LI);
      LIMB = [['I', LI], ['II', LII], ['III', LIII], ['aVR', LI.clone().add(LII).multiplyScalar(-0.5)],
        ['aVL', LI.clone().sub(LIII).multiplyScalar(0.5)], ['aVF', LII.clone().add(LIII).multiplyScalar(0.5)]];
    } else {
      LIMB = [['I', 0], ['II', 60], ['III', 120], ['aVR', -150], ['aVL', -30], ['aVF', 90]].map(([n, deg]) => { const a = deg * Math.PI / 180; return [n, new THREE.Vector3(Math.cos(a), -Math.sin(a), 0)]; });
    }
    const Lmax = Math.max(...LIMB.map((x) => x[1].length())), Rl = 95;
    for (const [name, vec] of LIMB) {
      const len0 = vec.length(), d = vec.clone().normalize(), Rk = Rl * (0.55 + 0.45 * len0 / Lmax);
      const neg = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), d.clone().multiplyScalar(-Rk)]),
        new THREE.LineDashedMaterial({ color: 0xf0b429, dashSize: 4, gapSize: 3, depthTest: false, transparent: true, opacity: 0.45 }));
      neg.computeLineDistances(); neg.renderOrder = 10; grp.add(neg);
      arrow(d, Rk, 0xf0b429);
      leadTag(name, d.clone().multiplyScalar(Rk + 9), 'lead limb');
    }
    for (const k of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
      const e = M.electrodes[k], q = new THREE.Vector3(e[0] - hc[0], e[1] - hc[1], e[2] - hc[2]);
      arrow(q, q.length() - 3, 0x38c6e8, 6);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 10), arrowMat(0x38c6e8)); dot.position.copy(q); dot.renderOrder = 11; grp.add(dot);
      leadTag(k, q.clone().multiplyScalar(1.07), 'lead chest');
    }
    g3.heartVec = arrow(new THREE.Vector3(1, 0, 0), 10, 0xffffff, 9);
    g3.heartVecTag = leadTag('Heart vector', new THREE.Vector3(), 'lead hv');
  }

  // put chamber and wall names at the centre of each region's cross-section
  // on the current cut plane; LV wall names only for short-axis-like cuts
  function placeCutLabels(nL, pL, camL) {
    const d = (x, y, z) => (x - pL.x) * nL.x + (y - pL.y) * nL.y + (z - pL.z) * nL.z;
    const acc = {}, put = (k, x, y, z) => { const a = acc[k] || (acc[k] = [0, 0, 0, 0]); a[0] += x; a[1] += y; a[2] += z; a[3]++; };
    const shortish = Math.abs(nL.dot(g3.lax)) > 0.7;
    for (let c = 0; c < A.n; c++) {
      const x = A.pos[3 * c], y = A.pos[3 * c + 1], z = A.pos[3 * c + 2];
      if (Math.abs(d(x, y, z)) > 3) continue;
      const L = A.label[c];
      if (L === 3) put('LA', x, y, z); else if (L === 4) put('RA', x, y, z);
      else if (L === 1) {
        const ph = A.phi[c];
        if (Math.abs(ph) < 0.4 && A.zuvc[c] > 0.2 && A.zuvc[c] < 0.8) put('Septum', x, y, z);
        if (shortish) {
          if (ph > 0.7 && ph < 2.2) put('Anterior wall', x, y, z);
          else if (Math.abs(ph) >= 2.4) put('Lateral wall', x, y, z);
          else if (ph < -0.7 && ph > -2.2) put('Inferior wall', x, y, z);
        }
      }
    }
    for (const L of [1, 2]) { const a = g3.cavCells[L]; for (let q = 0; q < a.length; q += 3) if (Math.abs(d(a[q], a[q + 1], a[q + 2])) < 3) put(L === 1 ? 'LV' : 'RV', a[q], a[q + 1], a[q + 2]); }
    const valve = { 'Mitral valve': A.landmarks.MV.c, 'Tricuspid valve': A.landmarks.TV.c };
    for (const l of g3.labels) {
      if (l.view !== 'cut-dyn') continue;
      if (valve[l.key]) {
        const v = valve[l.key], dd = d(v[0], v[1], v[2]);
        l.off = Math.abs(dd) > 12;
        if (!l.off) l.pos.set(v[0], v[1], v[2]).addScaledVector(nL, -dd);
        continue;
      }
      const a = acc[l.key];
      l.off = !a || a[3] < 25;
      if (!l.off) l.pos.set(a[0] / a[3], a[1] / a[3], a[2] / a[3]);
    }
    // conduction-system labels: hidden when their structure is behind remaining wall
    // (march through the voxel grid toward the camera, ignoring the removed half)
    const [gx, gy, gz] = A.dims, o = A.origin, h = A.h;
    const solid = (x, y, z) => {
      const i = Math.floor((x - o[0]) / h), j = Math.floor((y - o[1]) / h), k = Math.floor((z - o[2]) / h);
      if (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz) return false;
      const c = A.grid[(i * gy + j) * gz + k]; return c >= 0 && A.label[c] <= 6;
    };
    for (const l of g3.labels) {
      if (l.view !== 'cutaway' && l.view !== 'both') continue;
      const dir = camL.clone().sub(l.pos).normalize();
      let blocked = false;
      for (let t = 4; t < 160; t += 1.5) {
        const x = l.pos.x + dir.x * t, y = l.pos.y + dir.y * t, z = l.pos.z + dir.z * t;
        if (d(x, y, z) > 0) break;                       // reached the removed half: nothing in front
        if (solid(x, y, z)) { blocked = true; break; }
      }
      l.off = blocked;
    }
  }

  function updateOverlays() {
    const showLabels = ui.labels, showLeads = ui.leads;
    g3.leads.visible = showLeads;
    if (showLeads) {
      const D = S.dipole || [0, 0, 0], mag = Math.hypot(D[0], D[1], D[2]);
      const on = mag > 0.04;
      g3.heartVec.visible = on; g3.heartVecTag.hidden = !on;
      if (on) {
        g3.heartVec.setDirection(new THREE.Vector3(D[0] / mag, D[1] / mag, D[2] / mag));
        const L = Math.min(150, 12 + mag * 75); g3.heartVec.setLength(L, 9, 5);
        g3.heartVecTag.pos.set(D[0] / mag, D[1] / mag, D[2] / mag).multiplyScalar(L + 10);
      }
    }
    if (!showLabels && !showLeads) { for (const l of g3.labels) l.el.hidden = true; return; }
    const cam = g3.camera, el = $('pane3d'), w = el.clientWidth, h = el.clientHeight;
    const mw = g3.inner.matrixWorld, nmat = new THREE.Matrix3().getNormalMatrix(mw);
    const tmp = new THREE.Vector3(), nw = new THREE.Vector3(), toCam = new THREE.Vector3();
    const cut = ui.view === 'cutaway';
    for (const l of g3.labels) {
      let vis;
      if (l.view === 'leads') vis = showLeads && !(l.hidden);
      else if (l.view === 'cut-dyn') vis = showLabels && ui.view === 'cutaway' && !l.off;
      else if (l.view === 'cutaway') vis = showLabels && ui.view === 'cutaway' && !l.off;
      else if (l.view === 'both' && ui.view === 'cutaway') vis = showLabels && !l.off;
      else vis = showLabels && (l.view === 'both' || l.view === ui.view);
      if (l === g3.heartVecTag) vis = showLeads && !g3.heartVecTag.hidden;
      if (vis) {
        if (l.space === 'heart') tmp.copy(l.pos).applyMatrix4(mw); else tmp.copy(l.pos);
        if (l.view === 'external' || (l.view === 'both' && !cut)) {
          nw.copy(l.nrm).applyMatrix3(nmat).normalize(); toCam.copy(cam.position).sub(tmp);
          if (nw.dot(toCam) < 0) vis = false;                 // anchor faces away from the viewer
        }
        if (vis) {
          tmp.project(cam);
          if (tmp.z > 1) vis = false;
          else { l.sx = (tmp.x + 1) / 2 * w; l.sy = (1 - tmp.y) / 2 * h; }
        }
      }
      l.el.hidden = !vis;
      l.vis = vis;
    }
    // simple de-overlap: place labels in order, nudging each clear of those already placed
    const placed = [];
    for (const l of g3.labels) {
      if (!l.vis) continue;
      if (!l.w) { l.w = l.el.offsetWidth; l.hh = l.el.offsetHeight; }
      let y = l.sy;
      const hit = (yy) => placed.some((q) => l.sx < q.x + q.w && l.sx + l.w > q.x && yy - 9 < q.y - 9 + q.h + 2 && yy - 9 + l.hh + 2 > q.y - 9);
      for (let k = 1; k <= 6 && hit(y); k++) y = l.sy + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (l.hh + 3);
      placed.push({ x: l.sx, y, w: l.w, h: l.hh });
      l.el.style.transform = `translate(${l.sx.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // 'external' when nothing is cut away, 'cutaway' otherwise (set by the Cut away slider)
  function setView(v) {
    ui.view = v;
    const cut = v === 'cutaway';
    g3.slab.im.visible = cut;
    // clip tissue and arteries; the conduction system stays whole so it can be seen (and clicked)
    for (const m of g3.clipMats) { m.clippingPlanes = cut ? [g3.plane] : null; m.needsUpdate = true; }
    g3.cs.visible = cut; g3.stencil.visible = cut; g3.cor.visible = true;
    $('legendCs').hidden = !cut;
    $('legendBlock').hidden = !cut || !Object.keys(S.blocks).length;
    updateActionNote(); hideBlockMenu();
    $('hint').textContent = cut ? 'Drag to rotate · the cut always faces you' : 'Drag to rotate · scroll to zoom';
    g3.controls.enableRotate = true;
    if (cut) g3.planeDirty = true; else $('viewName').textContent = 'external view';
  }
  const CUT_R = 85;   // mm from the centre at which the cut plane clears the heart
  function setCut(f) {
    ui.cutFrac = f; ui.cutDepth = (1 - f / 100) * CUT_R;
    $('cutDepth').value = f; $('cutExt').setAttribute('aria-pressed', String(f === 0)); $('cutFull').setAttribute('aria-pressed', String(f === 100));
    const v = f > 0 ? 'cutaway' : 'external';
    if (v !== ui.view) setView(v);
    g3.planeDirty = true;
  }
  // camera presets: directions in the torso frame (X patient left, Y superior, Z anterior)
  const CAM = { front: [[0.1, 0.08, 1], [0, 1, 0]], inferior: [[0.05, -1, 0.25], [0, 0, 1]], back: [[-0.1, 0.08, -1], [0, 1, 0]] };
  function cameraPreset(name) {
    if (name === 'short') { cutPreset('short'); return; }
    if (name === 'left') { cutPreset('lateral'); return; }
    if (name === 'front') { cutPreset('anterior'); return; }   // anterior = the four-chamber direction, cut or not
    const [d, up] = CAM[name], cam = g3.camera, ctl = g3.controls;
    ctl.target.set(0, 0, 0);
    cam.position.set(...d).normalize().multiplyScalar(ui.leads ? 660 : 380);
    cam.up.set(...up); cam.lookAt(0, 0, 0); ctl.update();
    g3.planeDirty = true;
  }

  // colour of a cell from its action-potential phase
  // (no allocation: called for every cell every frame)
  function stateColor(c, t, out, o, restArr, ro = 0) {
    const s = t - S.tAct[c], apd = S.apd[c], w = S.repW[c] || 100;
    const r0 = restArr[ro], g0 = restArr[ro + 1], b0 = restArr[ro + 2];
    if (s < 0 || s >= apd + 0.35 * w) { out[o] = r0; out[o + 1] = g0; out[o + 2] = b0; return; }
    if (s < apd - 0.35 * w) {
      const k = Math.min(1, s / 35), F = C.front, D = C.dep;
      out[o] = F[0] + (D[0] - F[0]) * k; out[o + 1] = F[1] + (D[1] - F[1]) * k; out[o + 2] = F[2] + (D[2] - F[2]) * k;
      return;
    }
    const k = Math.max(0, (s - (apd - 0.35 * w)) / (0.7 * w)), kk = k * k, P = C.rep;
    out[o] = P[0] + (r0 - P[0]) * kk; out[o + 1] = P[1] + (g0 - P[1]) * kk; out[o + 2] = P[2] + (b0 - P[2]) * kk;
  }

  function update3D() {
    const t = S.t, vc = g3.voxCol;
    const ischemic = S.insults.length > 0, rc = g3.restCol;
    for (let c = 0; c < M.nVox; c++) if (M.kind[c]) {
      if (ischemic) stateColor(c, t, vc, 3 * c, rc, 3 * c); else stateColor(c, t, vc, 3 * c, C.rest);
    }
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
    stateColor(M.sanCell, t, sc, 0, S.blocks.SAN ? blockColour('SAN') : [1, 1, 1]); g3.san.material.color.setRGB(sc[0], sc[1], sc[2]);
    if (ui.view === 'cutaway') {
      if (g3.planeDirty) applyCutPlane();
      const sl = g3.slab, cc = sl.col, mp = sl.map;
      for (let i = 0; i < mp.length; i++) {
        const c = mp[i], o = 3 * i;
        if (c >= 0) { cc[o] = vc[3 * c] * 0.88; cc[o + 1] = vc[3 * c + 1] * 0.88; cc[o + 2] = vc[3 * c + 2] * 0.88; }   // cut face slightly darker
        else { const st = sl.stat[-c] || C.rest; cc[o] = st[0] * 0.88; cc[o + 1] = st[1] * 0.88; cc[o + 2] = st[2] * 0.88; }
      }
      sl.geo.attributes.color.needsUpdate = true;
      for (const tb of g3.tubes) {
        for (let v = 0; v < tb.map.length; v++) stateColor(tb.map[v], t, tb.col, 3 * v, restColourOf(tb.map[v]));
        tb.geo.attributes.color.needsUpdate = true;
      }
    }
    g3.controls.update();
    g3.renderer.render(g3.scene, g3.camera);
    updateOverlays();
  }

  // ---------------------------------------------------------------------------
  // Blocks and stimulation by clicking
  // ---------------------------------------------------------------------------
  const SITE_NAME = { SAN: 'SA node', AVN: 'AV node', HIS: 'His bundle', LBB: 'Left bundle branch', RBB: 'Right bundle branch', LAF: 'Left anterior fascicle', LPF: 'Left posterior fascicle', LSF: 'Septal fascicle' };
  const BLOCK_MENU = {
    SAN: [['sa-exit', '2nd-degree SA exit block (3:2)', { n: 3 }], ['pause', 'Sinus pause (2.8 s)', { ms: 2800 }], ['arrest', 'Sinus arrest']],
    AVN: [['first', '1st-degree AV block'], ['wenckebach', '2nd-degree AV block, Mobitz I (Wenckebach)'], ['two-to-one', '2:1 AV block'], ['complete', '3rd-degree (complete) AV block']],
    HIS: [['mobitz2', '2nd-degree AV block, Mobitz II (4:3)', { n: 4 }], ['complete', '3rd-degree (complete) block in the His bundle']],
    LBB: [['complete', 'Left bundle branch block']], RBB: [['complete', 'Right bundle branch block']],
    LAF: [['complete', 'Left anterior fascicular block']], LPF: [['complete', 'Left posterior fascicular block']],
    LSF: [['complete', 'Septal fascicular block']],
  };
  const SEG_SITE = { [LH.SEG.AVN]: 'AVN', [LH.SEG.HIS]: 'HIS', [LH.SEG.LBB]: 'LBB', [LH.SEG.RBB]: 'RBB', [LH.SEG.LAF]: 'LAF', [LH.SEG.LPF]: 'LPF', [LH.SEG.LSF]: 'LSF' };
  const isComplete = (b) => b && (b.type === 'complete' || b.type === 'arrest');
  function blockColour(site) { const b = S.blocks[site]; return isComplete(b) ? C.blocked : C.partial; }
  function restColourOf(id) { const site = SEG_SITE[M.seg[id]]; return site && S.blocks[site] ? blockColour(site) : C.cs; }
  function blockLabel(site) {
    const b = S.blocks[site]; if (!b) return '';
    const item = BLOCK_MENU[site].find((x) => x[0] === b.type);
    return item ? item[1] : `${SITE_NAME[site]} block`;
  }

  function renderBlockList() {
    const sites = Object.keys(S.blocks);
    $('noBlocks').hidden = !!sites.length;
    $('legendBlock').hidden = !sites.length || ui.view === 'external';
    $('blockList').innerHTML = sites.map((s) => `<div class="bchip${isComplete(S.blocks[s]) ? '' : ' partial'}"><span>${SITE_NAME[s]}: ${blockLabel(s)}</span><button type="button" data-site="${s}" aria-label="Remove ${SITE_NAME[s]} block">×</button></div>`).join('');
    for (const b of $('blockList').querySelectorAll('button')) b.addEventListener('click', () => { S.setBlock(b.dataset.site, null); renderBlockList(); interpret(true); });
  }

  function showBlockMenu(site, defType, x, y) {
    const menu = $('blockMenu'), pane = $('pane3d');
    $('blockMenuTitle').textContent = SITE_NAME[site];
    const cur = S.blocks[site];
    const items = BLOCK_MENU[site].map(([type, label, opts]) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.textContent = (cur && cur.type === type ? '✓ ' : '') + label;
      if (type === defType) b.classList.add('default');
      b.addEventListener('click', () => { S.setBlock(site, type, opts || {}); hideBlockMenu(); renderBlockList(); interpret(true); });
      return b;
    });
    if (cur) {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'remove'; r.textContent = 'Remove block';
      r.addEventListener('click', () => { S.setBlock(site, null); hideBlockMenu(); renderBlockList(); interpret(true); });
      items.push(r);
    }
    $('blockMenuItems').replaceChildren(...items);
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(pane.clientWidth - w - 8, x + 12))}px`;
    menu.style.top = `${Math.max(46, Math.min(pane.clientHeight - h - 8, y - 20))}px`;
    (items.find((b) => b.classList.contains('default')) || items[0]).focus();
  }
  function hideBlockMenu() { $('blockMenu').hidden = true; }

  function flash(x, y, text) {
    const f = $('flash'); $('flashText').textContent = text;
    f.hidden = true; void f.offsetWidth; f.hidden = false;
    f.style.transform = `translate(${x}px, ${y}px)`;
    clearTimeout(flash.timer); flash.timer = setTimeout(() => { f.hidden = true; }, 1200);
  }

  function updateActionNote() {
    const cut = ui.view !== 'external';
    $('actionNote').textContent = ui.action === 'block'
      ? (cut ? 'Click the SA node, AV node, His bundle, a bundle branch or a fascicle to choose a block.'
        : 'Cut the heart open (Cut slider below) to reach the conduction system. The SA node (white dot) can be clicked now.')
      : ui.action === 'ischemia'
        ? 'Click a coronary artery to occlude it there.' + (cut ? ' Click muscle on the cut face for subendocardial ischemia.' : ' Cut the heart open (Cut slider below) to click muscle for subendocardial ischemia.')
        : ui.action === 'stimulate' ? 'Click the atria for a PAC or the ventricles for a PVC. A well-timed PAC can start AVNRT (or AVRT with an accessory pathway); a PVC on the T wave of an acutely ischemic heart starts VF.'
          : 'Drag to turn the heart. Clicks on the heart do nothing in this tab.';
  }

  // pointer handling on the 3D canvas: a click (not a drag) acts
  function initPicking() {
    const canvas = $('c3d'), ray = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), g3.camera);
      hideBlockMenu();
      if (ui.action === 'block') pickBlock(ray, x, y); else if (ui.action === 'ischemia') pickIschemia(ray, x, y); else if (ui.action === 'stimulate') pickStimulus(ray, x, y);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBlockMenu(); });
    $('blockMenuCancel').addEventListener('click', hideBlockMenu);
  }

  function pickBlock(ray, x, y) {
    const targets = [g3.sanPick].concat(ui.view === 'cutaway' ? g3.pickTubes : []);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) { flash(x, y, ui.view === 'cutaway' ? 'Click the conduction system' : 'Use Cutaway for blocks'); return; }
    if (hit.object === g3.sanPick) { showBlockMenu('SAN', 'sa-exit', x, y); return; }
    const id = hit.object.userData.map[hit.face.a], site = SEG_SITE[M.seg[id]];
    if (!site) return;
    let def = BLOCK_MENU[site][0][0];
    if (site === 'AVN') def = M.avn.indexOf(id) <= 1 ? 'first' : 'wenckebach';   // proximal node: 1st degree; distal: Wenckebach
    showBlockMenu(site, def, x, y);
  }

  function pickStimulus(ray, x, y) {
    const cut = ui.view !== 'external';
    const targets = g3.pickTissue.concat(cut ? [g3.slab.im] : []);
    for (const hit of ray.intersectObjects(targets, false)) {
      if (cut && hit.object !== g3.slab.im && g3.plane.distanceToPoint(hit.point) < -0.3) continue;   // clipped away
      const p = g3.inner.worldToLocal(hit.point.clone());
      const c = nearestTissue(p.x, p.y, p.z, hit.object === g3.slab.im ? 1 : 3);
      if (c < 0) continue;
      const rec = S.stimulate(c);
      const refractory = S.t < S.refEnd[c];
      flash(x, y, refractory ? 'No capture (refractory)' : rec.ronT ? 'R-on-T!' : rec.kind === 'atrial' ? 'PAC' : 'PVC');
      return;
    }
  }

  function pickIschemia(ray, x, y) {
    const cut = ui.view !== 'external';
    let added = null;
    // first surface the ray meets (tissue or cut face, ignoring what the cut removed)
    const front = ray.intersectObjects(g3.pickTissue.concat(cut ? [g3.slab.im] : []), false)
      .find((h) => !cut || h.object === g3.slab.im || g3.plane.distanceToPoint(h.point) >= -0.3);
    const corHit = ray.intersectObjects(g3.corPick, false)
      .find((h) => (!cut || g3.plane.distanceToPoint(h.point) >= -0.3) && (!front || h.distance <= front.distance + 3));
    if (corHit || !front || front.object !== g3.slab.im) {
      let node = -1;
      if (corHit) node = corHit.object.userData.map[corHit.face.a];
      else if (front) {                                         // a click on the surface near an artery counts
        const p = g3.inner.worldToLocal(front.point.clone()); let bd = 100;
        g3.corPos.forEach((q, i) => { const d = q.distanceToSquared(p); if (d < bd) { bd = d; node = i; } });
      }
      if (node < 0) { flash(x, y, 'Click a coronary artery'); return; }
      if (S.insults.some((v) => v.kind === 'occlusion' && v.node === node)) { flash(x, y, 'Already occluded here'); return; }
      captureRef(); added = S.addOcclusion(node);
      flash(x, y, `Occluded: ${segmentName(node)}`);
    } else {
      for (const hit of ray.intersectObjects(g3.pickTissue.concat([g3.slab.im]), false)) {
        if (hit.object !== g3.slab.im && g3.plane.distanceToPoint(hit.point) < -0.3) continue;
        const p = g3.inner.worldToLocal(hit.point.clone());
        const c = nearestTissue(p.x, p.y, p.z, hit.object === g3.slab.im ? 1 : 3);
        if (c < 0) continue;
        if (A.label[c] !== 1 && A.label[c] !== 2) { flash(x, y, 'Click ventricular muscle'); return; }
        captureRef(); added = S.addSubendocardial(c, 55);
        flash(x, y, 'Subendocardial ischemia');
        break;
      }
      if (!added) { flash(x, y, 'Click ventricular muscle'); return; }
    }
    if (ui.ischH === 0) setIschTime(1);                         // start an hour in, so the change is visible
    else S.setIschemiaTime(ui.ischH);
    recolorIschemia(); renderIschList(); interpret(true);
  }

  function insultLabel(v) {
    if (v.kind === 'occlusion') return `Occlusion: ${segmentName(v.node)}`;
    const c = v.cell, wall = A.label[c] === 2 ? 'RV' : Math.abs(A.phi[c]) < 0.4 ? 'septal' : A.phi[c] > 0.7 && A.phi[c] < 2.2 ? 'anterior' : A.phi[c] < -0.7 && A.phi[c] > -2.2 ? 'inferior' : 'lateral';
    return `Subendocardial: ${wall} wall`;
  }
  function renderIschList() {
    const list = S.insults;
    $('ischWrap').hidden = !list.length;
    $('ischList').innerHTML = list.map((v) => `<div class="bchip isch"><span>${insultLabel(v)}</span><button type="button" data-id="${v.id}" aria-label="Remove">×</button></div>`).join('');
    for (const b of $('ischList').querySelectorAll('button')) b.addEventListener('click', () => {
      S.removeInsult(+b.dataset.id); recolorIschemia(); renderIschList(); interpret(true);
    });
    $('ischStage').textContent = ischStage(ui.ischH);
  }
  // the time slider stops only where the ECG changes character
  const ISCH_STOPS = [
    [0, 'Onset', 'No electrical change yet.'],
    [0.25, '15 min', 'Hyperacute: K-ATP channels shorten the action potential. Tall, broad T waves over the territory with early, modest ST elevation; the injury current is only starting.'],
    [1, '1 h', 'Acute injury: depolarised ischemic cells drive an injury current. ST elevation over the territory, reciprocal depression opposite.'],
    [4, '4 h', 'Necrosis spreads from endocardium toward epicardium. ST elevation still near its peak; Q waves starting to form.'],
    [12, '12 h', 'Evolving infarct: Q waves established, ST elevation still clear but past its peak.'],
    [48, '2 days', 'Recent infarct: ST elevation partly resolved, T waves inverting over the infarct, Q waves persist. Nodal ischemia recovering.'],
    [720, '1 month', 'Old infarct: ST back to baseline (persisting elevation would suggest aneurysm). Q waves remain; T inversion often persists for months.'],
  ];
  const stopOf = (h) => ISCH_STOPS.reduce((b, s, i) => (Math.abs(Math.log1p(s[0]) - Math.log1p(h)) < Math.abs(Math.log1p(ISCH_STOPS[b][0]) - Math.log1p(h)) ? i : b), 0);
  // subendocardial ischemia alone follows a different course (ST depression, no Q waves)
  const SUBENDO_STAGE = [
    'No electrical change yet.',
    'Minutes: the inner wall is starved first. ST depression starts in the leads facing it, with ST elevation in aVR.',
    'Subendocardial injury: horizontal or down-sloping ST depression over the region, ST elevation in aVR. No STEMI pattern.',
    'The inner layer starts to die (non-Q-wave infarct). ST depression persists; no Q waves, because the outer wall still conducts.',
    'ST depression easing; T waves flatten.',
    'ST depression easing toward baseline over the next days. No Q waves: a non-Q-wave (NSTEMI) infarct.',
    'Old subendocardial infarct: the ECG can look almost normal.',
  ];
  function ischStage(h) {
    if (!S.insults.length) return '';
    return S.insults.every((x) => x.kind === 'subendo') ? SUBENDO_STAGE[stopOf(h)] : ISCH_STOPS[stopOf(h)][2];
  }
  function fmtHours(h) { return ISCH_STOPS[stopOf(h)][1]; }
  function setIschTime(h) {
    ui.ischH = h; $('ischTime').value = stopOf(h); $('ischVal').textContent = fmtHours(h);
    S.setIschemiaTime(h); $('ischStage').textContent = ischStage(h);
  }

  function toggleControls() {
    const c = $('controls').classList.toggle('collapsed');
    $('ctlChevron').textContent = c ? 'Show' : 'Hide'; $('ctlHead').setAttribute('aria-expanded', String(!c));
    resize3D();
  }
  // tabs: the open tab also sets what a click on the heart does
  function setTab(t) {
    ui.tab = t; ui.action = t === 'blocks' ? 'block' : t === 'ischemia' ? 'ischemia' : t === 'rhythm' ? 'stimulate' : 'none';
    for (const b of document.querySelectorAll('#controls .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const p of document.querySelectorAll('#controls .tabpanel')) p.hidden = p.dataset.panel !== t;
    if ($('controls').classList.contains('collapsed')) toggleControls();
    updateActionNote(); hideBlockMenu();
  }

  // The rate slider sets the sinus rate, or, while AF or flutter runs, the
  // ventricular response (AF: mean of an irregular response; flutter: N:1).
  function syncRate() {
    const arr = S.arrhythmia && S.arrhythmia.type, vent = arr === 'af' || arr === 'flutter', r = $('rate');
    const atr = arr === 'ectopic' || arr === 'mat', mode = vent ? 'ventricular' : atr ? 'atrial' : 'sinus';
    if (mode === ui.rateMode && !(vent && S.vResponse == null && ui.vRate)) return;
    if (ui.rateMode === 'atrial' && ui.preAtrRate) { ui.rate = ui.preAtrRate; S.setRate(ui.rate); }   // back to the sinus rate set before MAT
    ui.preAtrRate = mode === 'atrial' ? ui.preAtrRate : null;
    ui.rateMode = mode;
    if (vent) {
      if (ui.vRate) S.setVentricularResponse(ui.vRate);
      const v = S.vResponse || (arr === 'af' ? LH.DEFAULTS.afDefaultRate : 170);
      $('rateLab').textContent = 'Ventricular rate'; r.min = 30; r.max = 180; r.value = v; $('rateVal').textContent = `${Math.round(v)} bpm`;
    } else {
      $('rateLab').textContent = atr ? 'Atrial rate' : 'Sinus rate'; r.min = 30; r.max = 180; r.value = ui.rate; $('rateVal').textContent = `${ui.rate} bpm`;
    }
  }

  // rhythm strips: up to three leads, chosen under the interpretation
  function initStrips() {
    const box = $('strips');
    for (const n of LH.LEADS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.dataset.lead = n;
      b.setAttribute('aria-pressed', String(ui.strips.includes(n)));
      b.addEventListener('click', () => {
        const i = ui.strips.indexOf(n);
        if (i >= 0) { if (ui.strips.length > 1) ui.strips.splice(i, 1); }
        else { ui.strips.push(n); if (ui.strips.length > 3) ui.strips.shift(); }
        for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', String(ui.strips.includes(x.dataset.lead)));
        $('calnote').textContent = `${ui.strips.join(', ')} rhythm strip${ui.strips.length > 1 ? 's' : ''} · 10 s`;
        resizeECG();
      });
      box.appendChild(b);
    }
  }

  // AVNRT induction as in the EP lab: a PAC after a sinus beat, each one more
  // premature than the last, until one blocks in the fast pathway, conducts
  // down the slow one and re-enters (the window moves with the sinus rate)
  function avnrtTrial(c) {
    const t0 = S.nextSinus();
    S.stimulateAt(A.nearest(A.landmarks.SVC.c, (x) => A.label[x] === 4), t0 + c);
    ui.avnrt = { c, checkAt: t0 + c + 1600 };
  }
  function checkAvnrt() {
    if (!ui.avnrt || S.t < ui.avnrt.checkAt) return;
    const V = S.log.vent.filter((v) => v.on > ui.avnrt.checkAt - 1200), rr = V.slice(1).map((v, i) => v.on - V[i].on);
    const tachy = rr.length >= 2 && rr.every((x) => x < 450);
    if (tachy || ui.avnrt.c <= 160 || S.arrhythmia) ui.avnrt = null; else avnrtTrial(ui.avnrt.c - 20);
  }
  // the Arrhythmias buttons
  function startRhythm(type) {
    ui.avnrt = null;
    if (type === 'avnrt') {
      if (S.ap) { ui.struct.ap = ''; $('stAP').value = ''; S.setAccessoryPathway(null); placeAPMarker(); }
      S.stopArrhythmia();
      avnrtTrial(280);
      return;
    }
    if (type === 'avrt') {
      if (!S.ap || S.apLocation !== 'left-lateral') { ui.struct.ap = 'left-lateral'; $('stAP').value = 'left-lateral'; S.setAccessoryPathway('left-lateral'); placeAPMarker(); }
      S.stopArrhythmia();
      S.stimulateAt(A.nearest(A.landmarks.LAA.c, (c) => A.label[c] === 3), S.nextSinus() + 270);
      return;
    }
    if (type === 'vt') { let best = -1; for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.epi[c] && A.zuvc[c] > 0.35 && A.zuvc[c] < 0.45 && A.phi[c] < -2.2) { best = c; break; } S.startArrhythmia('vt', { cell: best }); return; }
    if (type === 'mat' && ui.rate < 110) { ui.preAtrRate = ui.preAtrRate || ui.rate; ui.rate = 120; S.setRate(120); ui.rateMode = ''; }   // MAT starts tachycardic; the slider then sets it
    S.startArrhythmia(type);
    syncRate();
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
    const NR = 3 + ui.strips.length;
    const mmCss = Math.min(W / PAPER.w, H / (NR * 27 + 4));
    PAPER.rowH = Math.min(52, Math.max(27, (H / mmCss - 4) / NR));
    PAPER.h = NR * PAPER.rowH + 4;
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
    for (let r = 0; r < NR; r++) {
      const y = rowBase(r), x = ecg.ox + 1.5 * mm;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1.5 * mm, y); g.lineTo(x + 1.5 * mm, y - 10 * mm); g.lineTo(x + 6.5 * mm, y - 10 * mm); g.lineTo(x + 6.5 * mm, y); g.lineTo(x + 8 * mm, y); g.stroke();
      const names = r < 3 ? LAYOUT[r] : [ui.strips[r - 3]];
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
    const cursor = (S.t + ecg.t0) % PAGE;
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.1, 0.32 * mm); ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const k = LH.LEADS.indexOf(LAYOUT[r][c]);
      trace(ctx, ecg.buf[k], c * 2500, (c + 1) * 2500, ecg.ox + (PAPER.left + c * 62.5) * mm, rowBase(r), cursor);
    }
    ui.strips.forEach((n, i) => trace(ctx, ecg.buf[LH.LEADS.indexOf(n)], 0, PAGE, ecg.ox + PAPER.left * mm, rowBase(3 + i), cursor));
    ctx.stroke();
    // sweep cursor
    const x = ecg.ox + (PAPER.left + cursor * 0.025) * mm;
    ctx.fillStyle = 'rgba(194,48,79,0.18)'; ctx.fillRect(x, ecg.oy, Math.max(2, 0.6 * mm), PAPER.h * mm);
  }

  // ---------------------------------------------------------------------------
  // Interpretation banner (ground truth from the simulator + measurements)
  // ---------------------------------------------------------------------------
  // The rhythm statement is the simulator's ground truth (which pacemaker
  // fired, which blocks are active, which beats were stimulated); intervals
  // and the axis are measured from the simulated activation and ECG.
  function interpret() {
    const arr = S.arrhythmia ? S.arrhythmia.type : null;
    if (arr === 'vf') {
      $('rhythm').textContent = `Ventricular fibrillation${S.arrhythmia.trigger ? ' (R-on-T PVC in ischemic myocardium)' : ''}: shock now`;
      $('chips').innerHTML = '<span class="chip flag"><em>Rhythm</em>chaotic, no QRS complexes</span>'; $('findings').innerHTML = ''; return;
    }
    const V = S.log.vent.filter((b) => S.t > b.repEnd + 60), Aa = S.log.atrial;
    if (V.length < 2) return;
    const vb = V[V.length - 1];
    // orthodromic AVRT: every beat returns to the atria through the pathway
    const apWin = (S.apLog || []).filter((x) => x.t > S.t - 3000);
    const avrt = S.ap && apWin.filter((x) => x.dir === 'retrograde').length >= 4 && !apWin.some((x) => x.dir === 'antegrade');
    // typical AVNRT: every beat returns to the atria up the fast pathway
    const avnrt = !arr && !avrt && S.dualAVN && (S.retroLog || []).filter((x) => x.t > S.t - 3000).length >= 4;
    const tachy = avrt || avnrt || arr;
    // window: the last few seconds, never reaching back past a change of rhythm (start, shock)
    const since = (S.rhythmChangedAt || -1e9) + 400;
    const recent = V.filter((b) => b.on > Math.max(since, S.t - (tachy ? (arr === 'af' || arr === 'mat' ? 6000 : 3000) : 10000)));
    if (recent.length < 2) { $('rhythm').textContent = S.adenosine ? 'Adenosine: transient AV-nodal block, no QRS conducted' : 'Acquiring…'; $('chips').innerHTML = ''; $('findings').innerHTML = ''; return; }
    const rrs = recent.slice(1).map((b, i) => b.on - recent[i].on);
    const RR = rrs.length ? rrs.reduce((a, c) => a + c, 0) / rrs.length : vb.on - V[V.length - 2].on, rate = 60000 / RR;
    const aRecent = Aa.filter((a) => a.on > Math.max(since, S.t - (tachy ? 3000 : 10000)));
    const aRate = aRecent.length > 1 ? 60000 * (aRecent.length - 1) / (aRecent[aRecent.length - 1].on - aRecent[0].on) : 0;
    const prOf = (v) => { const a = Aa.filter((x) => x.on < v.on - 40 && x.on > v.on - 480).pop(); return a ? v.on - a.on : null; };
    const PRs = recent.map(prOf).filter((x) => x !== null);
    const PR = prOf(vb);
    const prVar = PRs.length > 1 && Math.max(...PRs) - Math.min(...PRs) > 25;
    const E = S.beatEnds(vb), QRS = E.last - vb.on + 4;
    const lastRR = vb.on - V[V.length - 2].on;
    const QT = E.repEnd + 40 - vb.on, QTc = QT / Math.sqrt(Math.max(lastRR, 300) / 1000);
    // QRS axis from net areas in I and aVF. With RBBB the delayed terminal RV
    // forces are excluded (clinical convention: first 60 ms of the QRS).
    const B = S.blocks;
    const escapeOnly = B.RBB && (B.LBB || (B.LAF && B.LPF)) || (B.HIS && B.HIS.type === 'complete') || (B.AVN && B.AVN.type === 'complete');
    const axisWin = B.RBB && !B.LBB && !escapeOnly && QRS >= 110 ? 60 : QRS;
    // (QRS areas against the level at QRS onset, so a P or atrial T wave running into the QRS does not tilt them)
    // baseline: straight line from QRS onset to J point (removes the slow atrial T wave underneath)
    let aI = 0, aF = 0; const t0 = Math.floor(vb.on), tJ = Math.ceil(E.last + 6), b = (k, t) => ecg.buf[k][bufIdx(t)];
    const lin = (k, t) => b(k, t0) + (b(k, tJ) - b(k, t0)) * (t - t0) / (tJ - t0);
    for (let t = t0; t <= Math.ceil(vb.on + axisWin); t++) { aI += b(0, t) - lin(0, t); aF += b(5, t) - lin(5, t); }
    let axis = Math.round(Math.atan2(aF, aI) * 180 / Math.PI);
    // Isolated RBBB leaves the LV forces, and so the frontal axis, unchanged;
    // in this model the missing early RV forces still tilt the first 60 ms,
    // so the axis shown is that of the heart's own conducted (LV) beat.
    const plain = !Object.keys(B).length && !S.arrhythmia && !S.ap && !S.insults.length;
    if (plain && V.length > 2) ui.normalAxis = axis;
    const rbbOnly = B.RBB && !B.LBB && !B.LAF && !B.LPF && !escapeOnly && !S.ap && !S.insults.length;
    if (rbbOnly && ui.normalAxis !== undefined) axis = ui.normalAxis;

    // ---- rhythm (ground truth)
    const recentFires = S.fireLog.filter((f) => f.t > S.t - 10000);
    const fired = (name) => recent.some((v) => recentFires.some((f) => f.name === name && f.t > v.on - 160 && f.t <= v.on + 1));
    const stims = S.stimLog.filter((x) => x.captured && x.t > S.t - 10000);
    const nPVC = stims.filter((x) => x.kind === 'ventricular').length;
    // a PAC with no QRS within 450 ms was blocked in the AV node (non-conducted PAC)
    const pacs = stims.filter((x) => x.kind === 'atrial' && x.t < S.t - 450);
    const nBlockedPAC = pacs.filter((x) => !S.log.vent.some((v) => v.on > x.t + 40 && v.on < x.t + 450)).length;
    const nPAC = stims.filter((x) => x.kind === 'atrial').length - nBlockedPAC;
    const sinusLabel = (r) => r < 60 ? 'Sinus bradycardia' : r > 100 ? 'Sinus tachycardia' : 'Normal sinus rhythm';
    // complete AV block at any level: AV node, His, or every ventricular route
    // (RBB + LBB, or RBB + both left fascicles = bilateral/trifascicular block)
    const distal = B.RBB && (B.LBB || (B.LAF && B.LPF));
    const avComplete = (B.AVN && B.AVN.type === 'complete') || (B.HIS && B.HIS.type === 'complete') || distal;
    let rhythm;
    const vr = Math.round(rate), rrSd = rrs.length > 2 ? Math.sqrt(rrs.reduce((a, c) => a + (c - RR) ** 2, 0) / rrs.length) : 0;
    const flutterCl = arr === 'flutter' && S.drivers[0] && S.drivers[0].cls.length ? S.drivers[0].cls.reduce((a, c) => a + c, 0) / S.drivers[0].cls.length : 0;
    if (arr === 'af') {
      const pre = S.ap && QRS >= 110;
      rhythm = `Atrial fibrillation with ${vr < 60 ? 'slow' : vr > 100 ? 'rapid' : 'controlled'} ventricular response (${vr} bpm, irregularly irregular)${pre ? ', pre-excited: conducting over the accessory pathway' : ''}`;
    } else if (arr === 'flutter') {
      const ar = flutterCl ? 60000 / flutterCl : 0, ratio = ar ? ar / rate : 0, fixed = rrSd < 25 && Math.abs(ratio - Math.round(ratio)) < 0.2;
      rhythm = `Atrial flutter (${S.arrhythmia.clockwise ? 'atypical, clockwise' : 'typical, counterclockwise'}), atrial ${Math.round(ar)}/min with ${fixed ? Math.round(ratio) + ':1' : 'variable'} AV conduction`;
    } else if (arr === 'ectopic') rhythm = `Ectopic atrial ${vr > 100 ? 'tachycardia' : 'rhythm'}: low right-atrial focus, ${vr} bpm, inverted P in II, III and aVF`;
    else if (arr === 'mat') rhythm = vr > 100 ? `Multifocal atrial tachycardia: ${vr} bpm, irregular, three or more P-wave shapes` : `Multifocal atrial rhythm (wandering atrial pacemaker): ${vr} bpm, irregular, three or more P-wave shapes`;
    else if (arr === 'vt') rhythm = `Monomorphic ventricular tachycardia, ${vr} bpm, with AV dissociation`;
    else if (avnrt) rhythm = `AVNRT (typical slow–fast): ${vr} bpm, narrow QRS, retrograde P hidden at the end of the QRS`;
    else if (avrt) {
      const SITE = { 'left-lateral': 'left lateral', 'left-posterior': 'left posterior', posteroseptal: 'posteroseptal', 'right-free-wall': 'right free wall', 'right-anteroseptal': 'right anteroseptal' };
      rhythm = `Orthodromic AVRT: down the AV node, back up the ${SITE[S.apLocation] || ''} accessory pathway (narrow QRS, no pre-excitation)`;
    } else if (avComplete) {
      const esc = fired('idioventricular') ? 'idioventricular' : fired('ventricular') ? 'ventricular' : 'junctional';
      const level = distal && !(B.HIS && B.HIS.type === 'complete') && !(B.AVN && B.AVN.type === 'complete')
        ? (B.LBB ? ' (bilateral bundle branch block)' : ' (trifascicular block)') : '';
      rhythm = `3rd-degree (complete) AV block${level} with ${esc} escape rhythm`;
    } else if (B.SAN && B.SAN.type === 'arrest') rhythm = 'Sinus arrest with junctional escape rhythm';
    else if (B.SAN && B.SAN.type === 'pause' && S.t < S.sinusPauseUntil + 6000) rhythm = `Sinus rhythm with sinus pause${fired('junctional') ? ' and junctional escape beats' : ''}`;
    else if (B.SAN && B.SAN.type === 'sa-exit') rhythm = 'Sinus rhythm with 2nd-degree SA exit block';
    else if (B.AVN && B.AVN.type === 'wenckebach') rhythm = 'Sinus rhythm with 2nd-degree AV block, Mobitz I (Wenckebach)';
    else if (B.AVN && B.AVN.type === 'two-to-one') rhythm = 'Sinus rhythm with 2:1 AV block';
    else if (B.HIS && B.HIS.type === 'mobitz2') rhythm = 'Sinus rhythm with 2nd-degree AV block, Mobitz II';
    else if (fired('junctional')) rhythm = 'Junctional escape rhythm';
    else if (fired('ventricular') || fired('idioventricular')) rhythm = 'Ventricular escape rhythm';
    else rhythm = sinusLabel(aRate || rate);
    if ((B.AVN && B.AVN.type === 'first') || (!B.AVN && !avComplete && !tachy && PR !== null && PR > 200 && !prVar)) rhythm += ' with 1st-degree AV block';
    // ventricular conduction
    const iv = [];
    if (!avComplete) {
      if (B.LBB) iv.push('left bundle branch block');
      else {
        if (B.RBB && B.LAF) iv.push('bifascicular block (RBBB + LAFB)');
        else if (B.RBB && B.LPF) iv.push('bifascicular block (RBBB + LPFB)');
        else {
          if (B.RBB) iv.push('right bundle branch block');
          if (B.LAF) iv.push('left anterior fascicular block');
          if (B.LPF) iv.push('left posterior fascicular block');
        }
      }
    }
    if (iv.length) rhythm += `; ${iv.join(', ')}`;
    const ect = [];
    if (nPAC) ect.push(`${nPAC} PAC${nPAC > 1 ? 's' : ''}`);
    if (nBlockedPAC) ect.push(`${nBlockedPAC} non-conducted PAC${nBlockedPAC > 1 ? 's' : ''}`);
    if (nPVC) ect.push(`${nPVC} PVC${nPVC > 1 ? 's' : ''}`);
    if (S.adenosine && S.t >= S.adenosine.start) rhythm += ' · adenosine: transient AV-nodal block';
    if (ect.length && !tachy) rhythm += ` with ${ect.join(' and ')}`;

    const axisTxt = axis < -30 ? 'left axis deviation' : axis > 90 ? 'right axis deviation' : 'normal axis';
    $('rhythm').textContent = rhythm;
    const chip = (k, v, flag) => `<span class="chip${flag ? ' flag' : ''}"><em>${k}</em>${v}</span>`;
    const dissociated = !tachy && (avComplete || Math.abs(aRate - rate) > 4);
    $('chips').innerHTML = [
      chip(dissociated ? 'Ventricular' : 'Rate', `${Math.round(rate)} bpm`, rate < 60 || rate > 100),
      dissociated && aRate ? chip('Atrial', `${Math.round(aRate)} bpm`, aRate < 60 || aRate > 100) : '',
      arr === 'af' ? chip('Atrial', 'fibrillatory', true) : arr === 'flutter' && flutterCl ? chip('Atrial', `${Math.round(60000 / flutterCl)}/min`, true) : '',
      arr === 'af' || arr === 'flutter' || arr === 'vt' ? '' : avrt ? chip('RP', (() => { const a = Aa.find((x) => x.on > vb.on); return a ? `${Math.round(a.on - vb.on)} ms (retrograde P)` : '—'; })()) : chip('PR', avComplete ? 'dissociated' : prVar ? `${Math.round(Math.min(...PRs))}–${Math.round(Math.max(...PRs))} ms` : PR !== null ? `${Math.round(PR)} ms` : '—', !avComplete && PR !== null && (PR > 200 || PR < 120 || prVar)),
      chip('QRS', `${Math.round(QRS)} ms`, QRS >= 120),
      chip('QT/QTc', `${Math.round(QT)}/${Math.round(QTc)} ms`, QTc > 460),
      chip(rbbOnly && ui.normalAxis !== undefined ? 'Axis (LV forces)' : axisWin === 60 ? 'Axis (first 60 ms)' : 'Axis', `${axis > 0 ? '+' : ''}${axis}° · ${axisTxt}`, axis < -30 || axis > 90),
    ].join('');
    const f = tachy ? [] : structFindings(vb).concat(ischFindings(vb));
    $('findings').innerHTML = f.map((x, i) => `<li${i === 0 && x.head ? ' class="head"' : ''}>${x.text || x}</li>`).join('');
  }

  // ST, Q and T measurements on the last complete beat, read off the ECG
  // like a reader would: ST at J + 40 ms against the PR segment, pathological
  // Q (≥ 30 ms and ≥ 0.1 mV), T polarity and size against this heart's own
  // healthy T waves.
  const L_IDX = Object.fromEntries(LH.LEADS.map((n, k) => [n, k]));
  const CONTIG = [['II', 'III', 'aVF'], ['I', 'aVL'], ['V1', 'V2'], ['V2', 'V3'], ['V3', 'V4'], ['V4', 'V5'], ['V5', 'V6'], ['I', 'V6'], ['aVL', 'I']];
  // baseline for QRS/ST measurements: the PR segment, or just before the P
  // wave when a long P (LA enlargement) runs into the QRS
  function qrsBaseT(vb) {
    const ab = S.log.atrial.filter((x) => x.on < vb.on - 30 && x.on > vb.on - 450).pop();
    return ab && ab.last + 20 > vb.on - 15 ? ab.on - 8 : vb.on - 15;
  }
  function measureBeat(vb) {
    const at = (k, t) => ecg.buf[k][bufIdx(t)];
    const out = {};
    for (const [n, k] of Object.entries(L_IDX)) {
      const base = at(k, qrsBaseT(vb)), E = S.beatEnds(vb), J = E.last + 6;
      // ST deviation must hold from early ST (J+20) to J+40, so the upstroke of an early tall T is not read as ST shift
      const s20 = at(k, J + 20) - base, s40 = at(k, J + 40) - base;
      const st = s20 * s40 > 0 ? Math.sign(s40) * Math.min(Math.abs(s20), Math.abs(s40)) : 0;
      let qDur = 0, qAmp = 0, rMax = 0;
      for (let t = vb.on; t < vb.on + 60; t++) { const v = at(k, t) - base; if (v > 0.05) break; if (v < -0.04) qDur = t - vb.on + 1; qAmp = Math.min(qAmp, v); }
      for (let t = vb.on; t <= J; t++) rMax = Math.max(rMax, at(k, t) - base);
      let tv = 0; for (let t = J + 60; t < E.repEnd + 40; t++) { const v = at(k, t) - base; if (Math.abs(v) > Math.abs(tv)) tv = v; }
      let sMin = 0, r40 = 0; for (let t = vb.on; t <= J; t++) { const v = at(k, t) - base; sMin = Math.min(sMin, v); if (t < vb.on + 40) r40 = Math.max(r40, v); }
      out[n] = { st, qDur, qAmp, rMax, r40, s: -sMin, t: tv };
    }
    return out;
  }
  // Structural findings read off the ECG: P-wave size and duration, voltage
  // criteria, dominant R in V1, pre-excitation (short PR + delta wave).
  function structFindings(vb) {
    if (!vb || !isFinite(vb.repEnd)) return [];
    const out = [], m = measureBeat(vb);
    const at = (k, t) => ecg.buf[k][bufIdx(t)];
    const ab = S.log.atrial.filter((x) => x.on < vb.on - 30 && x.on > vb.on - 400).pop();
    if (ab && S.t > ab.on + 400) {
      const base = at(1, ab.on - 8); let pII = 0;
      const pw = [];
      for (let t = ab.on; t < Math.min(ab.last + 25, vb.on - 2); t++) { const v = at(1, t) - base; pw.push(v); pII = Math.max(pII, v); }
      // notch: two humps at least 40 ms apart with a dip between them
      const pk = []; for (let i = 3; i < pw.length - 3; i++) if (pw[i] > 0.05 && pw[i] >= pw[i - 3] && pw[i] >= pw[i + 3] && pw[i] >= pw[i - 1] && pw[i] >= pw[i + 1]) pk.push(i);
      let notch = 0;
      for (let a = 0; a < pk.length; a++) for (let b = a + 1; b < pk.length; b++) {
        if (pk[b] - pk[a] < 40) continue;
        const dip = Math.min(...pw.slice(pk[a], pk[b])), lo = Math.min(pw[pk[a]], pw[pk[b]]);
        if (lo - dip > 0.015) notch = Math.max(notch, pk[b] - pk[a]);
      }
      const pDur = ab.last - ab.on + 12;                          // atrial activation plus the last front's own width
      const tall = pII >= 0.25, broad = pDur >= 120;
      const notchTxt = notch ? `, notched in II (humps ${Math.round(notch)} ms apart)` : '';
      if (tall && broad) out.push(`Biatrial enlargement: P ${pII.toFixed(2)} mV in II and ${Math.round(pDur)} ms wide${notchTxt}`);
      else if (tall) out.push(`Right atrial enlargement (P pulmonale): P ${pII.toFixed(2)} mV in II`);
      else if (broad) out.push(`Left atrial enlargement (P mitrale): P ${Math.round(pDur)} ms wide${notchTxt}`);
    }
    const PR = ab ? vb.on - ab.on : null, QRS = S.beatEnds(vb).last - vb.on + 4;
    if (S.ap && PR !== null && PR < 120) out.push(`Ventricular pre-excitation (WPW pattern): short PR (${Math.round(PR)} ms), delta wave, QRS ${Math.round(QRS)} ms. Repolarization changes are secondary.`);
    if (!S.ap && !Object.keys(S.blocks).length) {
      const sok = m.V1.s + Math.max(m.V5.rMax, m.V6.rMax), corn = m.aVL.rMax + m.V3.s;
      const strainLat = ['I', 'aVL', 'V5', 'V6'].filter((n) => m[n].t < -0.08).length >= 2;
      const domR = m.V1.rMax > m.V1.s && m.V1.rMax >= 0.5;
      // (Cornell's deep S in V3 is not left-sided when the right ventricle dominates)
      if (sok >= 3.5 || (corn >= 2.8 && !domR)) out.push(`Left ventricular hypertrophy by voltage (Sokolow–Lyon ${sok.toFixed(1)} mV, Cornell ${corn.toFixed(1)} mV)${strainLat ? ' with repolarization abnormality (strain)' : ''}`);
      if (domR) out.push(`Right ventricular hypertrophy: dominant R in V1 (R ${m.V1.rMax.toFixed(2)} mV)${['V1', 'V2'].every((n) => m[n].t < -0.1) ? ' with T inversion in V1–V2 (RV strain)' : ''}`);
    }
    return out;
  }

  // the healthy reference beat, taken just before the first ischemic insult
  function captureRef() {
    if (S.insults.length || Object.keys(S.blocks).length) return;
    const V = S.log.vent.filter((b) => S.t > b.repEnd + 60 && b.on > (ui.ischChangedAt || 0) + 1500);
    if (V.length) ui.ref = measureBeat(V[V.length - 1]);
  }
  function ischFindings(vb) {
    if (!vb || !isFinite(vb.repEnd)) return [];
    if (vb.on < (ui.ischChangedAt || 0) + 1500) return S.insults.length ? [{ head: true, text: 'Updating…' }] : [];   // wait for a beat (and the baseline filter) to settle
    const m = measureBeat(vb);
    if (!S.insults.length) {                                      // remember this heart's healthy beat
      if (!Object.keys(S.blocks).length) ui.ref = m;
      return [];
    }
    const ste = (n) => m[n].st >= (n === 'V2' || n === 'V3' ? 0.15 : 0.1);
    const std = (n) => m[n].st <= -0.08;
    const contiguous = (pred) => { const hit = new Set(); for (const g of CONTIG) if (g.filter(pred).length >= 2) g.filter(pred).forEach((n) => hit.add(n)); return hit; };
    const order = (set) => LH.LEADS.filter((n) => set.has(n));
    const span = (list) => {                                      // "V2–V4", "II, III, aVF"
      const v = list.filter((n) => n[0] === 'V').map((n) => +n.slice(1)), limb = list.filter((n) => n[0] !== 'V');
      const parts = limb.slice();
      if (v.length) {
        let a = v[0], b = v[0];
        const flush = () => parts.push(a === b ? `V${a}` : b === a + 1 ? `V${a}, V${b}` : `V${a}–V${b}`);
        for (const x of v.slice(1)) { if (x === b + 1) b = x; else { flush(); a = b = x; } }
        flush();
      }
      return parts.join(', ');
    };
    const E = contiguous(ste), D = new Set(LH.LEADS.filter(std));
    const inf = ['II', 'III', 'aVF'].filter((n) => E.has(n)).length >= 2;
    const ant = ['V1', 'V2', 'V3', 'V4'].filter((n) => E.has(n)).length >= 2;
    const lat = ['I', 'aVL', 'V5', 'V6'].filter((n) => E.has(n)).length >= 2;
    const post = ['V1', 'V2', 'V3'].filter((n) => D.has(n) && !E.has(n)).length >= 2;
    // new findings only: compared with this heart's own healthy beat
    // (without a healthy reference yet, leads with normal Q/negative T are skipped)
    const ref = ui.ref, NORMQ = ['aVR', 'aVL', 'III', 'V1'], was = (n, f) => (ref ? f(ref[n]) : NORMQ.includes(n));
    // pathological Q: ≥30 ms and ≥1 mm deep, or ≥40 ms wide whatever its depth (≥0.5 mm)
    const isQ = (v) => (v.qDur >= 30 && v.qAmp <= -0.1) || (v.qDur >= 40 && v.qAmp <= -0.05);
    // QS: the initial R has shrunk to ≤1 mm (from ≥2 mm) and the complex is mainly negative
    const isQS = (n) => ref && ref[n].r40 >= 0.2 && m[n].r40 < 0.1 && m[n].s >= 0.3 && m[n].s > 2 * m[n].rMax;
    // new: absent from the healthy beat, or at least 0.2 mV deeper than its physiological q
    const newQ = (n) => isQ(m[n]) && (!was(n, isQ) || (ref && m[n].qAmp < ref[n].qAmp - 0.2));
    // (not in leads with reciprocal ST depression: the depressed ST pulls the whole complex down)
    const Q = order(new Set(LH.LEADS.filter((n) => n !== 'aVR' && !std(n) && (newQ(n) || isQS(n)))));
    // R waves lost over the infarct (the precordial Q-wave equivalent)
    const rLoss = ref ? ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'I', 'aVL', 'II', 'III', 'aVF'].filter((n) => ref[n].rMax > 0.2 && m[n].rMax < 0.65 * ref[n].rMax && ref[n].rMax - m[n].rMax > 0.1 && !Q.includes(n)) : [];
    const rLossC = order(contiguous((n) => rLoss.includes(n)));
    const twi = order(new Set(LH.LEADS.filter((n) => !['aVR', 'V1', 'III'].includes(n) && m[n].t < -0.1 && !was(n, (r) => r.t < -0.05))));
    const hyper = ref && !Q.length && !twi.length ? order(new Set(LH.LEADS.filter((n) => ref[n].t > 0.15 && m[n].t > ref[n].t * 1.35 && m[n].t > 0.3 && Math.abs(m[n].st) < 0.25))) : [];
    const out = [];
    const sub = S.insults.every((x) => x.kind === 'subendo');
    if (sub) {
      // subendocardial injury points into the cavity: ST depression over the
      // region (elevation in the opposite leads is its mirror image, not a STEMI)
      const Ds = order(new Set(LH.LEADS.filter((n) => m[n].st <= -0.05))), Es = order(new Set(LH.LEADS.filter((n) => m[n].st >= 0.08)));
      if (Ds.length >= 2) {
        out.push({ head: true, text: `ST depression in ${span(Ds)}: subendocardial ischemia (NSTEMI pattern)` });
        if (Es.length) out.push(`ST elevation in ${span(Es)} mirrors the depression (no transmural injury)`);
      } else if (ui.ischH > 0.04) out.push({ head: true, text: 'Subendocardial ischemia here produces no diagnostic ST change' });
      if (twi.length) out.push(`T-wave inversion in ${span(twi)}`);
      return out;
    }
    if (inf || ant || lat) {
      const where = [ant && (lat ? 'anterolateral' : 'anterior'), inf && (lat && !ant ? 'inferolateral' : 'inferior'), lat && !ant && !inf && 'lateral'].filter(Boolean).join(' and ');
      const stage = Q.length ? (twi.length ? 'evolving' : 'acute') : 'acute';
      out.push({ head: true, text: `${stage[0].toUpperCase() + stage.slice(1)} ${where} STEMI: ST elevation in ${span(order(E))}` });
      const recip = order(new Set([...D].filter((n) => n !== 'aVR' || !inf)));
      if (recip.length) out.push(`Reciprocal ST depression in ${span(recip)}`);
      if (inf && E.has('V1')) out.push('ST elevation in V1 with an inferior STEMI suggests right ventricular involvement (record right-sided leads)');
      if (post && !ant) out.push('ST depression in V1–V3 suggests posterior extension');
    } else if (post) {
      out.push({ head: true, text: `ST depression in ${span(['V1', 'V2', 'V3'].filter((n) => D.has(n)))}: consider posterior STEMI (record V7–V9)` });
    } else if (Q.length || rLossC.length || twi.length >= 2) {
      // ST resolved: an infarct read from its Q waves, lost R waves and T waves
      const leads = new Set(Q.concat(twi, rLossC)), has = (g) => g.filter((n) => leads.has(n)).length >= 2;
      const where = [has(['V1', 'V2', 'V3', 'V4']) && 'anterior', has(['II', 'III', 'aVF']) && 'inferior', has(['I', 'aVL', 'V5', 'V6']) && 'lateral'].filter(Boolean).join(' and ');
      // (T inversion with Q waves is seen days to months after an infarct: the age cannot be read)
      const age = twi.length >= 2 ? 'Q-wave' : 'Old';
      out.push({ head: true, text: `${age}${where ? ' ' + where : ''} infarct${twi.length >= 2 ? ' (age undetermined: recent or old)' : ''}: ${[Q.length && `Q/QS waves in ${span(Q)}`, rLossC.length && `R waves lost in ${span(rLossC)}`, twi.length && `T inversion in ${span(twi)}`].filter(Boolean).join(', ')}, ST at baseline` });
      return out.concat(nodalNote());
    } else if (hyper.length >= 2) {
      out.push({ head: true, text: `Hyperacute T waves in ${span(hyper)}: earliest sign of coronary occlusion` });
      if (D.size) out.push(`ST depression in ${span(order(D))}`);
    } else if (D.size >= 2) {
      out.push({ head: true, text: `ST depression in ${span(order(D))}${m.aVR.st >= 0.08 ? ', ST elevation in aVR' : ''}: ischemia` });
    } else if (ui.ischH > 0.04) {
      out.push({ head: true, text: 'No diagnostic ST change in the 12 leads' });
    }
    const hyperE = hyper.filter((n) => E.has(n));
    if (hyperE.length >= 2 && out.length && !out[0].text.startsWith('Hyperacute')) out.push(`Hyperacute T waves in ${span(hyperE)}`);
    if (Q.length) out.push(`Pathological Q/QS waves in ${span(Q)}`);
    if (rLossC.length) out.push(`R waves lost in ${span(rLossC)}`);
    if (twi.length) out.push(`T-wave inversion in ${span(twi)}`);
    return out.concat(nodalNote());
  }
  function nodalNote() {
    const san = S.insults.some((x) => x.nodal && x.nodal.san), avn = S.insults.some((x) => x.nodal && x.nodal.avn);
    if (!(ui.ischH > 0.1 && ui.ischH < 100 && (san || avn))) return [];
    return [san && avn
      ? 'The occlusion is proximal to the sinus-node and AV-node arteries: sinus slowing and a longer PR'
      : san ? 'The occlusion is proximal to the sinus-node artery: sinus slowing'
        : 'The occlusion is proximal to the AV-node artery at the crux: slower AV conduction, longer PR'];
  }

  // ---------------------------------------------------------------------------
  // Controls, focus and divider
  // ---------------------------------------------------------------------------
  function initUI() {
    const rate = $('rate');
    rate.addEventListener('input', () => {
      if (ui.rateMode === 'ventricular') { ui.vRate = +rate.value; S.setVentricularResponse(ui.vRate); $('rateVal').textContent = `${ui.vRate} bpm`; return; }
      ui.rate = +rate.value; $('rateVal').textContent = `${ui.rate} bpm`; S.setRate(ui.rate);
    });
    const ts = $('timescale');
    ts.addEventListener('input', () => { ui.scaleIdx = +ts.value; $('tsVal').textContent = SCALE_LABEL[ui.scaleIdx]; });
    $('ovLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; });
    // phones: one pane at a time
    for (const b of $('viewsw').querySelectorAll('button')) b.addEventListener('click', () => {
      document.body.classList.toggle('show-ecg', b.dataset.pane === 'ecg');
      for (const x of $('viewsw').querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
    });
    $('ovLegend').checked = !matchMedia(PHONE).matches; $('legend').hidden = !$('ovLegend').checked;
    $('ovLegend').addEventListener('change', (e) => { $('legend').hidden = !e.target.checked; });
    $('ovLeads').addEventListener('change', (e) => {
      ui.leads = e.target.checked;
      $('legendLeads').hidden = !ui.leads;
      // pull back so the chest electrodes fit in view
      if (ui.leads && g3.camera.position.length() < 600) { g3.camera.position.setLength(660); g3.controls.update(); }
    });
    $('btnPause').addEventListener('click', () => { ui.paused = !ui.paused; $('btnPause').textContent = ui.paused ? 'Resume' : 'Pause'; });
    $('btnReset').addEventListener('click', () => { ui.avnrt = null; newSim(); renderBlockList(); hideBlockMenu(); setIschTime(0); renderIschList(); syncRate(); });
    $('ischTime').addEventListener('input', (e) => {
      ui.ischH = ISCH_STOPS[+e.target.value][0]; $('ischVal').textContent = fmtHours(ui.ischH); $('ischStage').textContent = ischStage(ui.ischH);
      ui.ischPending = ui.ischH;                                  // applied once per frame
    });
    for (const [id, key] of [['stRAE', 'rae'], ['stLAE', 'lae']]) $(id).addEventListener('change', (e) => {
      ui.struct[key] = e.target.checked; S.setAtrialEnlargement({ ra: ui.struct.rae, la: ui.struct.lae }); interpret();
    });
    for (const [id, key] of [['stLVH', 'lvh'], ['stRVH', 'rvh']]) $(id).addEventListener('change', async (e) => {
      const prev = heartKey();
      ui.struct[key] = e.target.checked;
      for (const x of ['stLVH', 'stRVH']) $(x).disabled = true;
      await rebuildHeart(prev);
      for (const x of ['stLVH', 'stRVH']) $(x).disabled = false;
    });
    for (const b of $('arrButtons').querySelectorAll('button')) b.addEventListener('click', () => { startRhythm(b.dataset.arr); syncRate(); interpret(); });
    $('btnAdeno').addEventListener('click', () => { S.giveAdenosine(); });
    $('btnShock').addEventListener('click', () => { ui.avnrt = null; S.shock(); syncRate(); interpret(); });
    $('stAP').addEventListener('change', (e) => { ui.struct.ap = e.target.value; S.setAccessoryPathway(ui.struct.ap || null); placeAPMarker(); interpret(); });
    $('btnClearIsch').addEventListener('click', () => { S.clearIschemia(); recolorIschemia(); renderIschList(); interpret(true); });
    for (const b of document.querySelectorAll('#controls .tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
    initPicking(); updateActionNote();
    for (const b of $('presets').querySelectorAll('button')) b.addEventListener('click', () => cameraPreset(b.dataset.cam));
    $('cutDepth').addEventListener('input', (e) => setCut(+e.target.value));
    $('cutExt').addEventListener('click', () => setCut(0));
    $('cutFull').addEventListener('click', () => setCut(100));
    initStrips();
    g3.controls.addEventListener('change', () => { if (ui.view === 'cutaway') g3.planeDirty = true; });
    const toggle = toggleControls;
    $('ctlHead').addEventListener('click', toggle);
    if (window.matchMedia(PHONE).matches) toggle();   // start collapsed on phones
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
