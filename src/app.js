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
  const ui = { labels: false, leads: false, scaleIdx: 6, paused: false, view: 'external', rate: 72, acc: 0, last: 0 };
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
    LH.setDefaultTorso(JSON.parse($('torso-data').textContent));
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
    const R9 = M.rot;   // same heart-to-torso rotation the lead fields use
    outer.setRotationFromMatrix(new THREE.Matrix4().set(R9[0], R9[1], R9[2], 0, R9[3], R9[4], R9[5], 0, R9[6], R9[7], R9[8], 0, 0, 0, 0, 1));
    const inner = g3.inner = new THREE.Group();
    inner.position.set(-M.center[0], -M.center[1], -M.center[2]);
    outer.add(inner); scene.add(outer);

    buildSurfaces();
    buildConduction();
    buildCutPlane();
    buildOverlays();

    const ctl = g3.controls = new THREE.OrbitControls(cam, canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.enablePan = false;
    ctl.minDistance = 140; ctl.maxDistance = 900;
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
  function thickenLV(geo, dist, others) {
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
      const c = nearestTissue(x, y, z); if (c < 0 || A.label[c] !== 1) continue;
      w[v] = LH.lvThickenWeight(A.phi[c], A.zuvc[c]) * smooth((others.nearest(x, y, z) - 3) / 9);
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
    const otherList = [];
    for (const s of A.json.surfaces) {
      if (s.label === 1) continue;
      const q = decodeB64(s.pos, Uint16Array);
      for (let i = 0; i < q.length; i += 9) otherList.push([0, 1, 2].map((d) => A.origin[d] + (q[i + d] / 65535) * span[d]));
    }
    const otherVerts = vertexIndex(otherList);
    g3.tissueMeshes = []; g3.clipMats = []; g3.allGeos = [];
    for (const s of A.json.surfaces) {
      const q = decodeB64(s.pos, Uint16Array), idx = decodeB64(s.idx, Uint32Array);
      const pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) pos[i] = A.origin[i % 3] + (q[i] / 65535) * span[i % 3];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      if (s.label === 1 && A.lvWallLayers) thickenLV(geo, A.lvWallLayers * A.h, otherVerts);
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
    g3.plane = new THREE.Plane();
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
    // the cap itself: a fine grid on the plane, vertex-coloured from the tissue underneath
    const u = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(u, nrm).normalize();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let c = 0; c < A.n; c++) {
      const dx = A.pos[3 * c] - p0.x, dy = A.pos[3 * c + 1] - p0.y, dz = A.pos[3 * c + 2] - p0.z;
      const pu = dx * u.x + dy * u.y + dz * u.z, pv = dx * v.x + dy * v.y + dz * v.z;
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
    }
    u0 -= 4; v0 -= 4; u1 += 4; v1 += 4;
    const step = 1.0, nu = Math.ceil((u1 - u0) / step) + 1, nv = Math.ceil((v1 - v0) / step) + 1;
    const pos = new Float32Array(nu * nv * 3), map = new Int32Array(nu * nv), idx = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const q = p0.clone().addScaledVector(u, u0 + i * step).addScaledVector(v, v0 + j * step).addScaledVector(nrm, -0.05);
      const o = i * nv + j; pos[3 * o] = q.x; pos[3 * o + 1] = q.y; pos[3 * o + 2] = q.z;
      const c = A.at(Math.floor((q.x - A.origin[0]) / A.h), Math.floor((q.y - A.origin[1]) / A.h), Math.floor((q.z - A.origin[2]) / A.h));
      if (c >= 0 && M.kind[c]) map[o] = c;
      else if (c >= 0) map[o] = -A.label[c];                      // vessel / valve tissue: static colour
      else { const n2 = nearestTissue(q.x, q.y, q.z, 4); map[o] = n2 >= 0 ? n2 : -1; }
      if (i && j) { const a0 = (i - 1) * nv + j - 1, a1 = i * nv + j - 1, a2 = i * nv + j, a3 = (i - 1) * nv + j; idx.push(a0, a1, a2, a0, a2, a3); }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ccol = new Float32Array(pos.length);
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    cg.setIndex(idx);
    const cap = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    }));
    cap.renderOrder = 2;
    cap.onAfterRender = (r) => r.clearStencil();
    g3.inner.add(cap);
    const stat = {}; for (const [k, hex] of Object.entries(STATIC)) { const cc = new THREE.Color(hex); stat[k] = [cc.r, cc.g, cc.b]; }
    g3.slab = { im: cap, map, col: ccol, geo: cg, stat };
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
    // cutaway: chamber names at the centre of each chamber's cross-section on the cut plane
    const n = g3.cutN, p0 = g3.cutP;
    const dPlane = (c) => (A.pos[3 * c] - p0.x) * n.x + (A.pos[3 * c + 1] - p0.y) * n.y + (A.pos[3 * c + 2] - p0.z) * n.z;
    const inSlab = (f) => (c) => f(c) && Math.abs(dPlane(c)) < 3;
    const onPlane = (p) => { const q = V3(p); return q.addScaledVector(n, -q.clone().sub(p0).dot(n)).toArray(); };
    // ventricles: centre of the cavity's cross-section; atria: centre of the wall ring
    const cavCentroid = (L) => {
      const [nx, ny, nz] = A.dims, s3 = [0, 0, 0]; let cnt = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
        const cid = A.cavityComp[(i * ny + j) * nz + k]; if (cid <= 0 || A.cavityLabel[cid] !== L) continue;
        const x = A.origin[0] + (i + 0.5) * A.h, y = A.origin[1] + (j + 0.5) * A.h, z = A.origin[2] + (k + 0.5) * A.h;
        if (Math.abs((x - p0.x) * n.x + (y - p0.y) * n.y + (z - p0.z) * n.z) > 3) continue;
        s3[0] += x; s3[1] += y; s3[2] += z; cnt++;
      }
      return cnt ? s3.map((v) => v / cnt) : null;
    };
    for (const [L, name] of [[4, 'RA'], [3, 'LA'], [2, 'RV'], [1, 'LV']]) {
      const c = (L <= 2 && cavCentroid(L)) || voxCentroid(inSlab((x) => A.label[x] === L));
      if (c) add(name, c, 'cutaway', 'chamber');
    }
    const sept = voxCentroid(inSlab((x) => A.label[x] === 1 && Math.abs(A.phi[x]) < 0.4 && A.zuvc[x] > 0.3 && A.zuvc[x] < 0.6));
    if (sept) add('Septum', sept, 'cutaway');
    add('Mitral valve', onPlane(A.landmarks.MV.c), 'cutaway');
    add('Tricuspid valve', onPlane(A.landmarks.TV.c), 'cutaway');
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
      else vis = showLabels && (l.view === 'both' || (l.view === 'cutaway') === cut);
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
    g3.cs.visible = cut; g3.slab.im.visible = cut; g3.stencil.visible = cut;
    $('legendCs').hidden = !cut;
    $('viewName').textContent = cut ? 'anterior cutaway (four-chamber)' : 'external view';
    $('hint').textContent = cut ? 'Fixed anterior cutaway · scroll to zoom' : 'Drag to rotate · scroll to zoom';
    const ctl = g3.controls, cam = g3.camera;
    ctl.target.set(0, 0, 0);
    if (cut) {
      const dir = n.clone(); dir.y *= 0.6; dir.normalize();
      cam.position.copy(dir.multiplyScalar(ui.leads ? 660 : 360));
      ctl.enableRotate = false;
    } else {
      cam.position.set(40, 30, 380);
      if (ui.leads) cam.position.setLength(660);
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
      const sl = g3.slab, cc = sl.col, mp = sl.map;
      for (let i = 0; i < mp.length; i++) {
        const c = mp[i], o = 3 * i;
        if (c >= 0) { cc[o] = vc[3 * c] * 0.88; cc[o + 1] = vc[3 * c + 1] * 0.88; cc[o + 2] = vc[3 * c + 2] * 0.88; }   // cut face slightly darker
        else { const st = sl.stat[-c] || C.rest; cc[o] = st[0] * 0.88; cc[o + 1] = st[1] * 0.88; cc[o + 2] = st[2] * 0.88; }
      }
      sl.geo.attributes.color.needsUpdate = true;
      for (const tb of g3.tubes) {
        for (let v = 0; v < tb.map.length; v++) stateColor(tb.map[v], t, tb.col, 3 * v, C.cs);
        tb.geo.attributes.color.needsUpdate = true;
      }
    }
    g3.controls.update();
    g3.renderer.render(g3.scene, g3.camera);
    updateOverlays();
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
    $('ovLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; });
    $('ovLeads').addEventListener('change', (e) => {
      ui.leads = e.target.checked;
      $('legendLeads').hidden = !ui.leads;
      // pull back so the chest electrodes fit in view
      if (ui.leads && g3.camera.position.length() < 600) { g3.camera.position.setLength(660); g3.controls.update(); }
    });
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
