/* =============================================================================
 * LiveHeart engine — forward cardiac electrophysiology + 12-lead ECG
 *
 * Pipeline (all forward, nothing scripted on the ECG side):
 *   anatomy voxels ─► tissue graph (CSR) ─► event-driven cellular automaton
 *   ─► per-cell transmembrane potential Vm(t) ─► dipole sources (−σ∇Vm)
 *   ─► electrode potentials via precomputed lead weights ─► 12 leads
 *
 * Runs unchanged in the browser (window.LiveHeart) and in Node (module.exports)
 * so ECGs can be generated headlessly for validation and future quiz use.
 *
 * Units: mm, ms, mV.  Note 1 m/s == 1 mm/ms, so conduction velocities below
 * read directly in m/s.
 * Body frame: +X patient left, +Y superior, +Z anterior.
 * ========================================================================== */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------
  function b64bytes(s) {
    let out;
    if (typeof Buffer !== 'undefined') {
      const b = Buffer.from(s, 'base64');
      out = new Uint8Array(b.length); out.set(b);
    } else {
      const bin = atob(s);
      out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  function decode(s, Type) { return new Type(b64bytes(s).buffer); }

  // Deterministic PRNG (mulberry32) so any ECG can be reproduced from a seed.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Growable typed array
  class Vec {
    constructor(Type, cap = 1024) { this.T = Type; this.a = new Type(cap); this.n = 0; }
    push(v) {
      if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
      this.a[this.n++] = v;
    }
    view() { return this.a.subarray(0, this.n); }
  }

  // Binary min-heap keyed by Float64 priority (for Dijkstra path planning)
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  }

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => mul(a, 1 / (len(a) || 1));
  const lerp = (a, b, t) => add(a, mul(sub(b, a), t));

  // ---------------------------------------------------------------------------
  // Tissue labels (from tools/build_anatomy.py)
  // ---------------------------------------------------------------------------
  const LAB = { LV: 1, RV: 2, LA: 3, RA: 4, AO: 5, PA: 6, MV: 7, TV: 8, AOV: 9, PUV: 10, VEIN: 11 };

  // Cell kinds. Voxel cells are myocardium; the rest are "overlay" nodes of the
  // specialised conduction system, which is electrically insulated from the
  // myocardium except at explicit junctions (as the real His–Purkinje system is).
  const KIND = { NONE: 0, ATRIAL: 1, VENT: 2, AVN: 3, HIS: 4, BUNDLE: 5, PURK: 6 };

  // Conduction-system segments (used for blocks, rendering and picking)
  const SEG = {
    NONE: 0, SAN: 1, AVN: 2, HIS: 3, LBB: 4, LAF: 5, LPF: 6, LSF: 7, RBB: 8,
    PURK_LV: 9, PURK_RV: 10, BACHMANN: 11, CRISTA: 12
  };
  const SEG_NAME = Object.fromEntries(Object.entries(SEG).map(([k, v]) => [v, k]));

  // ---------------------------------------------------------------------------
  // Default physiological parameters (tunable; see validate tool)
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    // Conduction velocities, m/s (== mm/ms)
    cvVentLong: 0.62,      // ventricular myocardium along fibres
    cvVentTrans: 0.26,     // across fibres (incl. transmural)
    cvAtrial: 0.80,        // working atrial myocardium (isotropic)
    cvBachmann: 1.60,      // Bachmann's bundle
    cvCrista: 1.20,        // crista terminalis
    bachmannReach: 0.25,   // Bachmann insertion: fraction of the way SVC→LAA
    csPos: 0.45,           // CS-ostium interatrial connection: fraction CFB→IVC
    cvHis: 1.50,
    cvBundle: 2.56,        // bundle branches and fascicles
    // Spec: conduction system ~3x faster than ventricular myocardium
    cvPurkinje: 2.28,
    avnSegDelay: 17,       // ms per AV-node segment (5 segments ≈ 85 ms AH)
    avnSegments: 5,
    avnToneExp: 0.45,      // AV-nodal delay ∝ (72/rate)^exp (autonomic coupling)
    rbbSeptalFrac: 0.15,
    rbbSeptalDelay: 19.39,    // ms extra delay into the RV septal Purkinje

    lafPhi: 2.28, lafZ: 0.63, lpfPhi: -1.87, lpfZ: 0.27, lsfPhi: 0.05, lsfZ: 0.42,
    septalFascicle: false,  // optional left septal fascicle (anatomically debated; off)
    fascConnectFrac: 0.59,  // distal fraction of LAF/LPF giving off Purkinje branches
    lbbSplitZ: 0.84, lbbSplitPhi: 0.0,  // where the LBB divides (apicobasal / rotational UVC)
    septalTerrHalf: 0,    // half-width (rad) of the mid-septal Purkinje territory
    lbbSeptalFrac: 0,           // distal fraction of the LBB trunk giving off septal Purkinje
    lpfApexZ: 0.21,            // apical cap (apicobasal UVC below this) belongs to the LPF territory
    lpfTerrLo: -1.88, lpfTerrHi: 0.46,  // LPF territory in rotational UVC (inferior/posterior wall)
    purkCrossApexZ: 0,      // cross-territory links below this apicobasal level are unslowed
    purkCrossSlow: 11.85,     // conduction-time factor on Purkinje links between fascicle territories
    ventSourceGain: 1.6,        // ventricular source strength relative to atrial (restores QRS:P ratio with anisotropy)
    precordialGain: 0.625,        // overall chest-lead gain
    sigmaRatio: 8.42,          // intracellular conductivity along:across fibres (1 = isotropic sources)
    brody: 0,               // radial source enhancement by intracavitary blood (Brody effect)
    heartPitch: -4.6,          // degrees about the left–right axis (+ tips the anterior wall upward)
    heartRotation: 17.4,
    apexX: 72, apexY: -20,  // apex position in the chest (mm from midline / from V4 level)
    chestGap: 15,          // closest heart–anterior chest wall distance (mm)      // degrees about the AP axis (+ = more vertical heart)
    purkLinkR: 3.2,        // Purkinje node link radius (× node spacing)
    purkZmaxLV: 0.96, purkZmaxRV: 0.93,   // basal limit of Purkinje networks (apicobasal UVC)   // distal fraction of septal RBB giving off RV septal Purkinje
    pmjAntero: 2,          // Purkinje -> muscle junction delay (ms)
    pmjRetro: 20,           // muscle -> Purkinje (retrograde) junction delay (ms)

    // Action potential durations (ms) at long diastolic interval
    apdVent: 295,          // modulated by transmural / apicobasal gradients below
    apdVentEndoExtra: 85,  // endocardium longer than epicardium (upright T waves)
    apdVentApexExtra: 10, // apex shorter than base (apex repolarises first)
    apdRVoffset: 30,
    apdAtrial: 190,
    apdPurk: 340,
    apdAVN: 160,
    // APD restitution: APD = APDmax * (1 - a * exp(-DI/tau))
    restA: 0.70, restTau: 450,
    // CV restitution (slowing in partially recovered tissue)
    cvRestK: 0.6, cvRestTau: 30,
    avnCvRestK: 1.8, avnCvRestTau: 110,  // AV-node decremental conduction
    avnErpExtra: 110,      // post-repolarisation refractoriness of AV node (ms)
    electrotonicK: 1.4,    // APD shortening per ms of later activation (cardiac memory)
    erpFrac: 0.92,         // ERP as fraction of APD (myocardium)

    // Transmembrane potential shape
    vRest: -85, vAmp: 105,
    plateauDecline: 0.18,  // fractional fall in plateau over the APD
    repWVent: 140, repWAtrial: 120,   // width of phase-3 repolarisation window (ms)
    upW: 2.0,                        // width of phase-0 upstroke (ms)

    // Automaticity (cycle lengths, ms)
    sinusRate: 72,
    junctionalRate: 48,
    ventEscapeRate: 40,

    // ECG
    ecgGain: 0.0174,      // converts Σ W·Vm into mV (calibrated once on sinus rhythm)
    precordialDipoleW: 0.7,     // share of the precordial signal from the heart-vector projection
    precordialDipoleGain: 1.7,  // precordial lead-vector length relative to the limb leads
    leadDistExp: 1.5,           // lead-vector length ∝ (mean distance / distance)^exp
    ecgLowpass: 40,             // Hz, ECG machine low-pass (0 = off; diagnostic carts use up to 150)
    dipoleGain: 1.65,           // heart-vector scale for the limb leads (mV per unit dipole)
  };

  // Smooth LV free-wall thickening map (0..1) over rotational (phi) and
  // apicobasal (z) coordinates: zero at the septal junctions, ramping to full
  // over the free wall, tapering to the base and to the (normally thin) apex.
  // Shared by the voxel tissue and the displayed surface so they agree.
  function lvThickenWeight(phi, z) {
    if (!(z >= 0)) return 0;
    const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    return sm((Math.abs(phi) - 0.5) / 0.9) * sm((0.9 - z) / 0.25) * sm((z - 0.04) / 0.2);
  }

  // ---------------------------------------------------------------------------
  // Anatomy: decode the embedded voxel grid
  // ---------------------------------------------------------------------------
  class Anatomy {
    // opts.lvWallLayers: grow (+) or strip (−) whole voxel layers on the outer
    // (epicardial) surface of the LV free wall, leaving septum and base alone.
    constructor(json, opts = {}) {
      this.json = json;
      this.h = json.h;
      const [nx, ny, nz] = this.dims = json.dims;
      this.origin = json.origin;
      const n0 = json.count;
      const idx = decode(json.index, Uint32Array), lab = decode(json.label, Uint8Array);
      const q = (k) => { const a = decode(json[k], Int8Array), o = new Float32Array(n0); for (let i = 0; i < n0; i++) o[i] = a[i] / 127; return o; };
      const rho = q('rho'), zz = q('z'), ph = q('phi'), vs = decode(json.vside, Int8Array), fb = decode(json.fiber, Int8Array);
      const V = [];   // editable voxel list
      for (let c = 0; c < n0; c++) V.push({ g: idx[c], l: lab[c], rho: rho[c], z: zz[c], phi: ph[c] * Math.PI, vs: vs[c], f: [fb[3 * c] / 127, fb[3 * c + 1] / 127, fb[3 * c + 2] / 127] });
      // The averaged CT heart's LV free wall is thickened by 3 voxel layers
      // (~6 mm): with it the model reproduces normal, LAFB and LPFB axes
      // together (see tools/research and tools/data/fascicular_candidate_v2.json).
      const layers = opts.lvWallLayers !== undefined ? opts.lvWallLayers : 3;
      this.lvWallLayers = layers;
      if (layers) this._editLVWall(V, layers);
      this._materialize(V);
      this.landmarks = json.landmarks;
      this._classifySurfaces();
    }

    _materialize(V) {
      const [nx, ny, nz] = this.dims, h = this.h, n = this.n = V.length;
      this.label = new Uint8Array(n); this.rho = new Float32Array(n); this.zuvc = new Float32Array(n); this.phi = new Float32Array(n);
      this.vside = new Int8Array(n); this.fiber = new Float32Array(3 * n);
      this.ii = new Int16Array(n); this.jj = new Int16Array(n); this.kk = new Int16Array(n);
      this.pos = new Float32Array(3 * n);
      this.grid = new Int32Array(nx * ny * nz).fill(-1);
      V.forEach((v, c) => {
        const g = v.g, k = g % nz, j = ((g / nz) | 0) % ny, i = (g / (ny * nz)) | 0;
        this.label[c] = v.l; this.rho[c] = v.rho; this.zuvc[c] = v.z; this.phi[c] = v.phi; this.vside[c] = v.vs;
        this.fiber[3 * c] = v.f[0]; this.fiber[3 * c + 1] = v.f[1]; this.fiber[3 * c + 2] = v.f[2];
        this.ii[c] = i; this.jj[c] = j; this.kk[c] = k; this.grid[g] = c;
        this.pos[3 * c] = this.origin[0] + (i + 0.5) * h;
        this.pos[3 * c + 1] = this.origin[1] + (j + 0.5) * h;
        this.pos[3 * c + 2] = this.origin[2] + (k + 0.5) * h;
      });
    }

    _editLVWall(V, layers) {
      const [nx, ny, nz] = this.dims, N = nx * ny * nz;
      const nb = (g) => { const k = g % nz, j = ((g / nz) | 0) % ny, i = (g / (ny * nz)) | 0, out = [];
        if (i > 0) out.push(g - ny * nz); if (i < nx - 1) out.push(g + ny * nz);
        if (j > 0) out.push(g - nz); if (j < ny - 1) out.push(g + nz);
        if (k > 0) out.push(g - 1); if (k < nz - 1) out.push(g + 1); return out; };
      const outside = () => {           // flood-fill empty space from the grid corner
        const occ = new Int32Array(N).fill(-1); V.forEach((v, c) => { occ[v.g] = c; });
        const out = new Uint8Array(N), st = [0]; out[0] = 1;
        while (st.length) { const g = st.pop(); for (const w of nb(g)) if (!out[w] && occ[w] < 0) { out[w] = 1; st.push(w); } }
        return { occ, out };
      };
      const nL = Math.abs(layers);
      // a voxel joins growth layer L when the smooth thickness map asks for at least L of nL layers
      const free = (v, L) => v.l === LAB.LV && lvThickenWeight(v.phi, v.z) >= (L + 0.5) / nL;
      for (let L = 0; L < Math.abs(layers); L++) {
        const { occ, out } = outside();
        if (layers > 0) {
          const add = new Map();
          for (const v of V) {
            if (!free(v, L)) continue;
            for (const w of nb(v.g)) if (out[w] && !add.has(w)) {
              // keep clear of other structures (atria, great vessels, RV)
              if (nb(w).some((x) => occ[x] >= 0 && V[occ[x]].l !== LAB.LV)) continue;
              add.set(w, { g: w, l: LAB.LV, rho: 1, z: v.z, phi: v.phi, vs: v.vs, f: v.f.slice() });
            }
          }
          for (const v of add.values()) V.push(v);
        } else {
          const keep = V.filter((v) => !(free(v, L) && nb(v.g).some((w) => out[w])));
          V.length = 0; for (const v of keep) V.push(v);
        }
      }
    }

    at(i, j, k) {
      const [nx, ny, nz] = this.dims;
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -2; // outside grid
      return this.grid[(i * ny + j) * nz + k];
    }
    p(c) { return [this.pos[3 * c], this.pos[3 * c + 1], this.pos[3 * c + 2]]; }

    // Flood-fill empty space from the grid boundary to separate "outside"
    // from the enclosed chamber cavities (valve planes and vein caps seal them),
    // then tag every myocardial voxel that faces a cavity (endocardium) and
    // which chamber that cavity belongs to.
    _classifySurfaces() {
      const [nx, ny, nz] = this.dims, N = nx * ny * nz, g = this.grid;
      const comp = new Int32Array(N).fill(-1); // -1 tissue/unvisited, 0 outside, >0 cavity id
      const stack = new Int32Array(N);
      const fill = (start, id) => {
        let sp = 0; stack[sp++] = start; comp[start] = id; let count = 1;
        while (sp) {
          const v = stack[--sp], k = v % nz, j = ((v / nz) | 0) % ny, i = (v / (ny * nz)) | 0;
          const nb = [[i + 1, j, k], [i - 1, j, k], [i, j + 1, k], [i, j - 1, k], [i, j, k + 1], [i, j, k - 1]];
          for (const [a, b, c] of nb) {
            if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
            const w = (a * ny + b) * nz + c;
            if (comp[w] !== -1 || g[w] >= 0) continue;
            comp[w] = id; stack[sp++] = w; count++;
          }
        }
        return count;
      };
      fill(0, 0);
      let id = 1; const sizes = [];
      for (let v = 0; v < N; v++) if (comp[v] === -1 && g[v] < 0) { sizes[id] = fill(v, id); id++; }
      // Name each cavity by the majority myocardial label lining it
      const votes = [];
      const n = this.n;
      const faceNb = (c) => {
        const i = this.ii[c], j = this.jj[c], k = this.kk[c];
        return [[i + 1, j, k], [i - 1, j, k], [i, j + 1, k], [i, j - 1, k], [i, j, k + 1], [i, j, k - 1]];
      };
      for (let c = 0; c < n; c++) {
        const L = this.label[c]; if (L > 4) continue;
        for (const [a, b, cc] of faceNb(c)) {
          if (a < 0 || b < 0 || cc < 0 || a >= nx || b >= ny || cc >= nz) continue;
          const w = (a * ny + b) * nz + cc, cid = comp[w];
          if (cid > 0) { votes[cid] = votes[cid] || [0, 0, 0, 0, 0]; votes[cid][L]++; }
        }
      }
      const cavLabel = [];
      for (let cid = 1; cid < id; cid++) {
        const v = votes[cid] || [0, 0, 0, 0, 0];
        let best = 0; for (let L = 1; L <= 4; L++) if (v[L] > v[best]) best = L;
        cavLabel[cid] = sizes[cid] > 200 ? best : 0;   // ignore tiny pockets
      }
      this.cavityLabel = cavLabel; this.cavityComp = comp;
      // endoFace[c]: bitmask of chamber cavities this voxel faces (1<<label)
      this.endo = new Uint8Array(n); this.epi = new Uint8Array(n);
      for (let c = 0; c < n; c++) {
        if (this.label[c] > 4) continue;
        for (const [a, b, cc] of faceNb(c)) {
          if (a < 0 || b < 0 || cc < 0 || a >= nx || b >= ny || cc >= nz) { this.epi[c] = 1; continue; }
          const w = (a * ny + b) * nz + cc, cid = comp[w];
          if (cid === 0) this.epi[c] = 1;
          else if (cid > 0 && cavLabel[cid]) this.endo[c] |= 1 << cavLabel[cid];
        }
      }
      this.cavitySizes = sizes;
      this._transmural();
    }

    // Transmural depth tm ∈ [0,1] for ventricular voxels: geodesic distance to
    // the nearest endocardium (either ventricular cavity) relative to distance
    // to the true epicardium. Unlike the dataset's LV-based coordinate, the
    // septum is endocardial on both faces.
    _transmural() {
      const n = this.n, isV = (c) => this.label[c] === LAB.LV || this.label[c] === LAB.RV;
      const vmask = (1 << LAB.LV) | (1 << LAB.RV);
      const dist = (seed) => {
        const d = new Float32Array(n).fill(Infinity), heap = new Heap();
        for (let c = 0; c < n; c++) if (isV(c) && seed(c)) { d[c] = 0; heap.push(0, c); }
        while (heap.size) {
          const c = heap.pop(), i = this.ii[c], j = this.jj[c], k = this.kk[c];
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
            const w = this.at(i + a, j + b, k + e); if (w < 0 || !isV(w)) continue;
            const nd = d[c] + this.h * Math.sqrt(a * a + b * b + e * e);
            if (nd < d[w]) { d[w] = nd; heap.push(nd, w); }
          }
        }
        return d;
      };
      const dEndo = dist((c) => this.endo[c] & vmask), dEpi = dist((c) => this.epi[c]);
      this.tm = new Float32Array(n).fill(-1);
      for (let c = 0; c < n; c++) if (isV(c)) {
        const a = dEndo[c], b = dEpi[c];
        this.tm[c] = isFinite(a) && isFinite(b) ? (a + b > 0 ? a / (a + b) : 0.5) : 0;   // 0.5 where a voxel is both endo- and epicardial
      }
    }

    nearest(pt, filter) {
      let best = -1, bd = Infinity;
      for (let c = 0; c < this.n; c++) {
        if (filter && !filter(c)) continue;
        const dx = this.pos[3 * c] - pt[0], dy = this.pos[3 * c + 1] - pt[1], dz = this.pos[3 * c + 2] - pt[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }

    // Geodesic path between voxels through voxels passing `mask` (26-connected)
    path(from, to, mask) {
      const n = this.n, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
      const heap = new Heap(); dist[from] = 0; heap.push(0, from);
      const h = this.h;
      while (heap.size) {
        const c = heap.pop(); if (c === to) break;
        const i = this.ii[c], j = this.jj[c], k = this.kk[c], dc = dist[c];
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
          if (!a && !b && !e) continue;
          const w = this.at(i + a, j + b, k + e); if (w < 0 || !mask(w)) continue;
          const nd = dc + h * Math.sqrt(a * a + b * b + e * e);
          if (nd < dist[w]) { dist[w] = nd; prev[w] = c; heap.push(nd, w); }
        }
      }
      if (prev[to] < 0 && from !== to) return null;
      const out = []; for (let c = to; c >= 0; c = prev[c]) out.push(c);
      return out.reverse();
    }
  }

  // ---------------------------------------------------------------------------
  // Model: tissue graph + conduction system + lead fields
  // ---------------------------------------------------------------------------
  class Model {
    constructor(anatomy, params) {
      this.A = anatomy;
      this.P = Object.assign({}, DEFAULTS, params || {});
      this._buildCells();
      this._buildConductionSystem();
      this._buildGraph();
      this._placeInTorso();
      this._buildLeadWeights();
    }

    // ---- cells: one per myocardial voxel, plus overlay conduction nodes added later
    _buildCells() {
      const A = this.A, n = A.n;
      this.nVox = n;
      const cap = n + 4000;
      this.kind = new Uint8Array(cap);
      this.seg = new Uint8Array(cap);
      this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
      this.cvScale = new Float32Array(cap).fill(1);   // local speed multiplier for tracts
      for (let c = 0; c < n; c++) {
        const L = A.label[c];
        this.kind[c] = (L === LAB.LV || L === LAB.RV) ? KIND.VENT : (L === LAB.LA || L === LAB.RA) ? KIND.ATRIAL : KIND.NONE;
        this.x[c] = A.pos[3 * c]; this.y[c] = A.pos[3 * c + 1]; this.z[c] = A.pos[3 * c + 2];
      }
      this.nCells = n;
      this.extraEdges = [];   // [a, b, delayMs] directed edges for overlay nodes
    }

    addNode(kind, seg, p) {
      const id = this.nCells++;
      this.kind[id] = kind; this.seg[id] = seg;
      this.x[id] = p[0]; this.y[id] = p[1]; this.z[id] = p[2];
      return id;
    }
    edge(a, b, t, both = true) { this.extraEdges.push(a, b, t); if (both) this.extraEdges.push(b, a, t); }
    pt(c) { return [this.x[c], this.y[c], this.z[c]]; }

    // Turn a voxel path into a chain of overlay nodes ~every `step` mm
    chain(kind, seg, pts, cv, step = 2.0, startNode = -1) {
      const nodes = [];
      let prev = startNode, prevP = startNode >= 0 ? this.pt(startNode) : null, acc = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (prevP) { acc += len(sub(p, prevP)); }
        if (i === 0 && startNode >= 0) { prevP = p; continue; }
        if (i > 0 && acc < step && i < pts.length - 1) { prevP = p; continue; }
        const id = this.addNode(kind, seg, p);
        if (prev >= 0) this.edge(prev, id, len(sub(p, this.pt(prev))) / cv);
        nodes.push(id); prev = id; prevP = p; acc = 0;
      }
      return nodes;
    }

    _buildConductionSystem() {
      const A = this.A, P = this.P, Lm = A.landmarks, h = A.h;
      const isRA = (c) => A.label[c] === LAB.RA, isLA = (c) => A.label[c] === LAB.LA;
      const isAtr = (c) => isRA(c) || isLA(c);
      const endoLV = (c) => (A.endo[c] & (1 << LAB.LV)) && A.label[c] === LAB.LV;
      const endoRV = (c) => (A.endo[c] & (1 << LAB.RV)) && (A.label[c] === LAB.RV || A.label[c] === LAB.LV);
      const lm = (k) => Lm[k].c;
      const P2 = (c) => A.p(c);
      this.landmarkCells = {};

      // ---- Sinus node: anterolateral SVC–RA junction (top of crista terminalis)
      const svc = lm('SVC'), ivc = lm('IVC');
      const sanTarget = add(svc, [-4, -9, 7]);
      this.sanCell = A.nearest(sanTarget, isRA);
      this.seg[this.sanCell] = SEG.SAN;

      // ---- Crista terminalis: lateral RA ridge from SVC to IVC (fast tract)
      const ivcCell = A.nearest(add(ivc, [-2, 6, 6]), isRA);
      const crista = A.path(this.sanCell, ivcCell, isRA) || [];
      this._markTract(crista, SEG.CRISTA, P.cvCrista / P.cvAtrial, 1);

      // ---- Bachmann's bundle: anterior interatrial band, RA (near SVC) to LA roof/LAA
      const bbStart = A.nearest(add(svc, [6, -6, 10]), isRA);
      // inserts into the anterosuperior LA just across the interatrial groove
      const bbEnd = A.nearest(lerp(svc, lm('LAA'), P.bachmannReach), isLA);
      const bach = A.path(bbStart, bbEnd, isAtr) || [];
      this._markTract(bach, SEG.BACHMANN, P.cvBachmann / P.cvAtrial, 1);
      this.bachmann = bach;

      // ---- Triangle of Koch / central fibrous body.
      // Point on the tricuspid annulus closest to the mitral valve = AV junction.
      const tv = Lm.TV, mv = Lm.MV;
      let n = norm(tv.n);
      if (dot(n, sub(lm('SVC'), tv.c)) < 0) n = mul(n, -1);        // n points into RA
      const R = 2 * tv.r / 1.41;                                     // annulus radius
      let u = sub(mv.c, tv.c); u = norm(sub(u, mul(n, dot(u, n))));
      const cfb = add(tv.c, mul(u, R * 0.85));                       // central fibrous body
      this.cfb = cfb; this.avAxis = n;
      // CS ostium region (posterior-inferior septal RA) used for an interatrial connection
      const csPt = lerp(cfb, ivc, P.csPos);
      this.csCell = A.nearest(csPt, isRA);
      this.interatrialSites = [bach, [this.csCell]];

      // ---- AV node: compact node on the RA septum just atrial to the CFB.
      const avnCell = A.nearest(add(cfb, mul(n, 5)), isRA);
      const avnP = P2(avnCell);
      // His bifurcation: crest of the muscular septum on the ventricular side
      const hisEndCell = A.nearest(add(cfb, mul(n, -9)), (c) => A.label[c] === LAB.LV);
      const hisEndP = P2(hisEndCell);
      this.landmarkCells.avn = avnCell; this.landmarkCells.his = hisEndCell;

      // AV node: chain of slow, decremental segments.
      const nAvn = P.avnSegments;
      const avn = [];
      for (let s = 0; s < nAvn; s++) {
        const id = this.addNode(KIND.AVN, SEG.AVN, lerp(avnP, lerp(avnP, hisEndP, 0.35), s / (nAvn - 1)));
        if (s) this.edge(avn[s - 1], id, P.avnSegDelay);
        avn.push(id);
      }
      // atrial inputs: RA voxels around the compact node (transitional cells)
      for (let c = 0; c < A.n; c++) {
        if (!isRA(c)) continue;
        if (len(sub(P2(c), avnP)) < 6) this.edge(c, avn[0], 3);
      }
      this.avn = avn;

      // His bundle (penetrating + branching portion), insulated
      const hisPts = [];
      const hisStart = this.pt(avn[nAvn - 1]);
      for (let s = 1; s <= 6; s++) hisPts.push(lerp(hisStart, hisEndP, s / 6));
      const his = this.chain(KIND.HIS, SEG.HIS, hisPts, P.cvHis, 2.0, avn[nAvn - 1]);
      // the first His edge leaves the AV node: give it the normal His delay (chain() did)
      this.his = his;
      const hisEnd = his[his.length - 1];

      // ---- Left bundle branch down the LV septal endocardium, then fascicles
      const lbbStart = A.nearest(hisEndP, endoLV);
      const lbbSplit = this._uvcNearest(endoLV, P.lbbSplitPhi, P.lbbSplitZ);   // LBB length set by where it divides
      const lbbPath = A.path(lbbStart, lbbSplit, endoLV).map(P2);
      const lbb = this.chain(KIND.BUNDLE, SEG.LBB, lbbPath, P.cvBundle, 2.0, hisEnd);
      const lbbEnd = lbb[lbb.length - 1];

      const fasc = (seg, phi, zz) => {
        const tgt = this._uvcNearest(endoLV, phi, zz);
        const path = A.path(A.nearest(this.pt(lbbEnd), endoLV), tgt, endoLV).map(P2);
        return this.chain(KIND.BUNDLE, seg, path, P.cvBundle, 2.0, lbbEnd);
      };
      // Two-fascicle left bundle: terminals at Durrer's anterior and posterior
      // paraseptal early-activation sites; their Purkinje branches reach the
      // left septal surface, giving the normal left-to-right septal
      // depolarisation. A separate septal fascicle can be switched on.
      this.laf = fasc(SEG.LAF, P.lafPhi, P.lafZ);
      this.lpf = fasc(SEG.LPF, P.lpfPhi, P.lpfZ);
      this.lsf = P.septalFascicle ? fasc(SEG.LSF, P.lsfPhi, P.lsfZ) : [];
      this.lbb = lbb;

      // ---- Right bundle branch: RV side of septum, then moderator band to
      //      the anterior papillary muscle of the RV free wall
      const septRV = (c) => endoRV(c) && A.label[c] === LAB.LV;
      const rbbStart = A.nearest(hisEndP, septRV);
      const rbbMid = this._nearestWhere(septRV, (c) => Math.abs(A.zuvc[c] - 0.55) + 0.004 * len(sub(P2(c), hisEndP)));
      const rbbPath = A.path(rbbStart, rbbMid, (c) => endoRV(c)).map(P2);
      const rbbSept = this.chain(KIND.BUNDLE, SEG.RBB, rbbPath, P.cvBundle, 2.0, hisEnd);
      const rvFree = (c) => endoRV(c) && A.label[c] === LAB.RV;
      const rbbMidP = P2(rbbMid);
      const mbEnd = this._nearestWhere(rvFree, (c) => Math.abs(A.zuvc[c] - 0.40) * 60 - len(sub(P2(c), rbbMidP)) * 0.5 - P2(c)[2] * 0.3);
      const mbPts = []; const mbEndP = P2(mbEnd);
      const mbLen = len(sub(mbEndP, rbbMidP)); const nmb = Math.max(2, Math.round(mbLen / 2));
      for (let s = 1; s <= nmb; s++) mbPts.push(lerp(rbbMidP, mbEndP, s / nmb));
      const mb = this.chain(KIND.BUNDLE, SEG.RBB, mbPts, P.cvBundle, 2.0, rbbSept[rbbSept.length - 1]);
      this.rbb = rbbSept.concat(mb);

      // ---- Purkinje networks: sparse nodes over the endocardium (not basal)
      // each LV Purkinje node belongs to the territory of the nearer fascicle
      const fascs = [this.laf, this.lpf].concat(this.lsf.length ? [this.lsf] : []);
      // LPF supplies the inferior/posterior wall (rotational UVC between
      // lpfTerrLo and lpfTerrHi); LAF the anterior and lateral walls; an
      // optional septal fascicle takes the mid-septum.
      // The mid-septal surface is its own territory, fed by the LBB's septal
      // branches (or the septal fascicle when enabled).
      const territory = (c) => {
        const ph = A.phi[c];
        if (Math.abs(ph) < P.septalTerrHalf && A.zuvc[c] > 0.25) return 2;
        if (A.zuvc[c] >= 0 && A.zuvc[c] < P.lpfApexZ) return 1;          // the broad LPF fans to the apex
        return ph > P.lpfTerrLo && ph < P.lpfTerrHi ? 1 : 0;
      };
      this.purkLV = this._purkinjeNet(endoLV, P.purkZmaxLV, SEG.PURK_LV, territory);
      this.purkRV = this._purkinjeNet((c) => endoRV(c), P.purkZmaxRV, SEG.PURK_RV);

      // Fascicle terminals fan into the Purkinje network
      const inTerr = (k) => (b) => this.purkTerritory.get(b) === k;
      const connect = (nodes, net, frac, radius, extra = 0, ok = null) => {
        const from = Math.floor(nodes.length * (1 - frac));
        for (let s = from; s < nodes.length; s++) {
          const a = nodes[s], pa = this.pt(a);
          for (const b of net) {
            if (ok && !ok(b)) continue;
            const d = len(sub(pa, this.pt(b)));
            if (d < radius) this.edge(a, b, d / P.cvPurkinje + 0.5 + extra);
          }
        }
      };
      if (P.lbbSeptalFrac > 0) connect(lbb, this.purkLV, P.lbbSeptalFrac, 8, 0, inTerr(2));   // LBB fans over the left septal surface
      connect(this.laf, this.purkLV, P.fascConnectFrac, 6, 0, inTerr(0));
      connect(this.lpf, this.purkLV, P.fascConnectFrac, 6, 0, inTerr(1));
      if (this.lsf.length) connect(this.lsf, this.purkLV, 0.50, 6, 0, inTerr(2));
      connect(mb, this.purkRV, 0.30, 7);
      // apical septal RV Purkinje (thin RBB branches: activate the RV septal
      // surface shortly after the LV septum, giving the normal septal q/r)
      if (P.rbbSeptalFrac > 0) connect(rbbSept, this.purkRV, P.rbbSeptalFrac, 6, P.rbbSeptalDelay);

      // ---- Escape pacemakers (overdrive-suppressed by faster rhythms)
      this.junctionalCell = his[1];                         // proximal His (junctional)
      this.ventEscapeCell = this.lpf[Math.floor(this.lpf.length * 0.3)];  // fascicular/ventricular

      // conduction-system node lists for rendering/picking
      this.csSegments = {
        AVN: avn, HIS: his, LBB: lbb, LAF: this.laf, LPF: this.lpf, LSF: this.lsf, RBB: this.rbb,
      };
    }

    _markTract(path, seg, speedMul, radiusVox) {
      const A = this.A;
      for (const c of path) {
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (let a = -radiusVox; a <= radiusVox; a++) for (let b = -radiusVox; b <= radiusVox; b++) for (let e = -radiusVox; e <= radiusVox; e++) {
          const w = A.at(i + a, j + b, k + e);
          if (w < 0 || (A.label[w] !== LAB.RA && A.label[w] !== LAB.LA)) continue;
          if (this.seg[w] === SEG.SAN) continue;
          this.seg[w] = seg; this.cvScale[w] = Math.max(this.cvScale[w], speedMul);
        }
      }
    }

    _nearestWhere(filter, score) {
      let best = -1, bs = Infinity;
      for (let c = 0; c < this.A.n; c++) { if (!filter(c)) continue; const s = score(c); if (s < bs) { bs = s; best = c; } }
      return best;
    }
    _uvcNearest(filter, phi, zz) {
      const A = this.A;
      return this._nearestWhere(filter, (c) => {
        let dp = Math.abs(A.phi[c] - phi); if (dp > Math.PI) dp = 2 * Math.PI - dp;
        return dp * 1.0 + Math.abs(A.zuvc[c] - zz) * 3.0;
      });
    }

    // Poisson-disc sample endocardial voxels into Purkinje nodes; link nodes
    // within a radius (same chamber), and couple each node to the muscle it
    // lies on through a Purkinje–muscle junction (PMJ).
    _purkinjeNet(filter, zMax, seg, territory = null) {
      const A = this.A, P = this.P, R = 3.6, rnd = rng(1234 + seg);
      const cand = [];
      for (let c = 0; c < A.n; c++) if (filter(c) && A.zuvc[c] >= 0 && A.zuvc[c] < zMax) cand.push(c);
      for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
      const chosen = [];
      const hash = new Map(), cell = (p) => `${Math.floor(p[0] / R)},${Math.floor(p[1] / R)},${Math.floor(p[2] / R)}`;
      const near = (p, r) => {
        const out = [];
        const ci = Math.floor(p[0] / R), cj = Math.floor(p[1] / R), ck = Math.floor(p[2] / R), m = Math.ceil(r / R);
        for (let a = -m; a <= m; a++) for (let b = -m; b <= m; b++) for (let e = -m; e <= m; e++) {
          const l = hash.get(`${ci + a},${cj + b},${ck + e}`); if (l) for (const q of l) out.push(q);
        }
        return out;
      };
      for (const c of cand) {
        const p = A.p(c);
        if (near(p, R).some((q) => len(sub(A.p(q), p)) < R)) continue;
        chosen.push(c);
        const key = cell(p); if (!hash.has(key)) hash.set(key, []); hash.get(key).push(c);
      }
      const nodes = chosen.map((c) => {
        const id = this.addNode(KIND.PURK, seg, A.p(c));
        this.edge(id, c, P.pmjAntero, false);   // anterograde PMJ
        this.edge(c, id, P.pmjRetro, false);    // retrograde PMJ
        return id;
      });
      const idOf = new Map(chosen.map((c, i) => [c, nodes[i]]));
      const terr = new Map(chosen.map((c) => [c, territory ? territory(c) : 0]));
      this.purkTerritory = this.purkTerritory || new Map();
      for (const c of chosen) this.purkTerritory.set(idOf.get(c), terr.get(c));
      for (const c of chosen) {
        const p = A.p(c);
        for (const q of near(p, P.purkLinkR * R)) {
          if (q <= c) continue;
          const d = len(sub(A.p(q), p));
          if (d >= P.purkLinkR * R) continue;
          // Links between fascicle territories: normal Purkinje links near the
          // apex (the anastomoses through which a blocked division's territory
          // is reached), slowed by purkCrossSlow elsewhere.
          let f = 1;
          if (terr.get(c) !== terr.get(q)) {
            const apical = A.zuvc[c] >= 0 && A.zuvc[c] < P.purkCrossApexZ && A.zuvc[q] >= 0 && A.zuvc[q] < P.purkCrossApexZ;
            f = apical ? 1 : P.purkCrossSlow;
          }
          this.edge(idOf.get(c), idOf.get(q), d / P.cvPurkinje * f);
        }
      }
      return nodes;
    }

    // ---- CSR graph: myocardial voxel neighbours within radius √5·h, anisotropic
    _buildGraph() {
      const A = this.A, P = this.P, h = A.h, n = this.nVox, N = this.nCells;
      const offs = [];
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) {
        const r2 = a * a + b * b + e * e; if (r2 > 0 && r2 <= 5) offs.push([a, b, e, Math.sqrt(r2) * h]);
      }
      // Interatrial connections are restricted to Bachmann's bundle and the
      // CS-ostium/fossa region; elsewhere the atrial walls are not coupled.
      const interOK = new Uint8Array(n);
      for (const site of this.interatrialSites) for (const c of site) {
        const p = A.p(c);
        for (let q = 0; q < n; q++) {
          if (A.label[q] !== LAB.RA && A.label[q] !== LAB.LA) continue;
          const dx = A.pos[3 * q] - p[0], dy = A.pos[3 * q + 1] - p[1], dz = A.pos[3 * q + 2] - p[2];
          if (dx * dx + dy * dy + dz * dz < 36) interOK[q] = 1;
        }
      }
      const src = new Vec(Int32Array, 1 << 21), dst = new Vec(Int32Array, 1 << 21), wt = new Vec(Float32Array, 1 << 21);
      const fb = A.fiber;
      for (let c = 0; c < n; c++) {
        const kc = this.kind[c]; if (!kc) continue;
        const Lc = A.label[c];
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (const [a, b, e, d] of offs) {
          const w = A.at(i + a, j + b, k + e); if (w < 0) continue;
          const kw = this.kind[w]; if (!kw || kw !== kc) continue;   // fibrous AV insulation
          const Lw = A.label[w];
          if (Lc !== Lw && kc === KIND.ATRIAL && !(interOK[c] && interOK[w])) continue;
          let v;
          if (kc === KIND.VENT) {
            // ellipsoidal anisotropy around the (averaged, sign-aligned) fibre
            let fx = fb[3 * c], fy = fb[3 * c + 1], fz = fb[3 * c + 2];
            let gx = fb[3 * w], gy = fb[3 * w + 1], gz = fb[3 * w + 2];
            if (fx * gx + fy * gy + fz * gz < 0) { gx = -gx; gy = -gy; gz = -gz; }
            fx += gx; fy += gy; fz += gz;
            const fl = Math.hypot(fx, fy, fz) || 1;
            const cs = (a * fx + b * fy + e * fz) / (fl * Math.sqrt(a * a + b * b + e * e));
            const c2 = cs * cs;
            v = 1 / Math.sqrt(c2 / (P.cvVentLong * P.cvVentLong) + (1 - c2) / (P.cvVentTrans * P.cvVentTrans));
            src.push(c); dst.push(w); wt.push(d / v);
          } else {
            // atrial: isotropic; specialised tracts speed up via cvScale (harmonic mean)
            const t = 0.5 * d * (1 / (P.cvAtrial * this.cvScale[c]) + 1 / (P.cvAtrial * this.cvScale[w]));
            src.push(c); dst.push(w); wt.push(t);
          }
        }
      }
      const ex = this.extraEdges;
      for (let q = 0; q < ex.length; q += 3) { src.push(ex[q]); dst.push(ex[q + 1]); wt.push(ex[q + 2]); }
      // counting sort into CSR
      const E = src.n, S = src.view(), D = dst.view(), W = wt.view();
      const start = new Int32Array(N + 1);
      for (let q = 0; q < E; q++) start[S[q] + 1]++;
      for (let q = 0; q < N; q++) start[q + 1] += start[q];
      const fillp = start.slice(0, N), nbr = new Int32Array(E), w0 = new Float32Array(E);
      for (let q = 0; q < E; q++) { const s = S[q], at = fillp[s]++; nbr[at] = D[q]; w0[at] = W[q]; }
      this.start = start; this.nbr = nbr; this.w0 = w0; this.nEdges = E;
    }

    // ---- Torso and electrodes.  Elliptic-cylinder chest (half-width 160 mm,
    // half-depth 110 mm); the heart is translated so the LV apex sits behind
    // the 5th intercostal space in the mid-clavicular line, with the RV ~15 mm
    // behind the anterior chest wall.
    _placeInTorso() {
      const A = this.A, P = this.P, a = 160, b = 110;
      const surfZ = (x) => b * Math.sqrt(Math.max(0, 1 - (x / a) * (x / a)));
      // Heart position in the chest: rotation about the antero-posterior axis
      // through the ventricular centroid (positive = apex swung inferiorly,
      // i.e. a more vertical heart). Normal hearts vary by ±20–30° here.
      let C = [0, 0, 0], nc = 0;
      for (let c = 0; c < A.n; c++) if (A.label[c] === LAB.LV || A.label[c] === LAB.RV) { C = add(C, A.p(c)); nc++; }
      C = mul(C, 1 / nc);
      const th = -P.heartRotation * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
      // R = Rz(−θ) · Rx(pitch): pitch (about the left–right axis) tips the
      // anterior wall upward (+) or downward (−).
      const pa = (P.heartPitch || 0) * Math.PI / 180, cp = Math.cos(pa), sp = Math.sin(pa);
      const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp], Rz = [ct, -st, 0, st, ct, 0, 0, 0, 1];
      const Rm = new Array(9).fill(0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) Rm[3 * i + j] += Rz[3 * i + k] * Rx[3 * k + j];
      this.rot = Rm;   // row-major
      this.center = C;
      const rotP = (p) => { const x = p[0] - C[0], y = p[1] - C[1], z = p[2] - C[2];
        return [Rm[0] * x + Rm[1] * y + Rm[2] * z + C[0], Rm[3] * x + Rm[4] * y + Rm[5] * z + C[1], Rm[6] * x + Rm[7] * y + Rm[8] * z + C[2]]; };
      // apex = LV epicardial voxels with the lowest apicobasal coordinate
      let apex = [0, 0, 0], cnt = 0;
      for (let c = 0; c < A.n; c++) if (A.label[c] === LAB.LV && A.zuvc[c] >= 0 && A.zuvc[c] < 0.04 && A.epi[c]) { apex = add(apex, A.p(c)); cnt++; }
      apex = rotP(mul(apex, 1 / cnt));
      // apex behind the 5th intercostal space, mid-clavicular line
      const tx = P.apexX - apex[0], ty = P.apexY - apex[1];
      let tz = Infinity;
      for (let c = 0; c < A.n; c++) {
        const q = rotP(A.p(c));
        tz = Math.min(tz, surfZ(q[0] + tx) - P.chestGap - q[2]);   // gap between RV and chest wall
      }
      this.offset = [tx, ty, tz];
      this.toTorso = (p) => add(rotP(p), this.offset);
      this.apex = apex;
      const on = (x, y) => [x, y, surfZ(x) - 1];
      const V2 = on(26, 28), V4 = on(78, 0);
      const mid = lerp(V2, V4, 0.5);
      this.electrodes = {
        RA: [-170, 170, 0], LA: [170, 170, 0], LL: [60, -330, 0],
        V1: on(-26, 28), V2: V2, V3: on(mid[0], mid[1]), V4: V4,
        V5: on(124, 0), V6: [160, 0, 0],
      };
      this.torso = { a, b };
      // precordial lead directions (unit vectors heart centre -> electrode), torso frame
      const hc = add(C, this.offset);
      this.heartCenterTorso = hc;
      // Lead-vector length falls with electrode distance (torso image-surface
      // lead vectors are longest for V2–V4 and shorter for V1 and V6).
      const dist = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((k) => len(sub(this.electrodes[k], hc)));
      const ref = dist.reduce((a, b) => a + b, 0) / dist.length;
      this.leadDir = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((k, i) => mul(norm(sub(this.electrodes[k], hc)), Math.pow(ref / dist[i], P.leadDistExp)));
    }

    // ---- Lead weights.  Infinite homogeneous volume conductor:
    //   φ_e = (1/4πσ) ∫ J_i · (r_e − r)/|r_e − r|³ dV,  J_i = −σ_i ∇Vm
    // Discretising ∇Vm on face-adjacent voxel pairs (i,j) and summing by
    // parts gives φ_e = −K Σ_i W_ei · Vm_i, with
    //   W_ej += c_ij,  W_ei −= c_ij,   c_ij = h² · L_e(mid_ij) · ê_ij.
    // Σ_i W_ei = 0 exactly, so uniform Vm produces no signal (as it must),
    // while gradients of resting potential (ischaemia) produce injury current.
    _buildLeadWeights() {
      const A = this.A, h = A.h, n = this.nVox;
      const names = ['RA', 'LA', 'LL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
      this.eNames = names;
      // + three uniform-field "leads" giving the heart dipole vector (VCG X,Y,Z)
      // + optionally limb leads I and II from a bounded-torso lead field
      const TF = this.P.torsoField !== undefined ? this.P.torsoField : DEFAULT_TORSO;
      const NE = names.length + 3 + (TF ? 2 : 0);
      let tfSample = null, tfScale = 1;
      if (TF) {
        if (!TF._I) { TF._I = decode(TF.I, Float32Array); TF._II = decode(TF.II, Float32Array); }
        const [nx, ny, nz] = TF.dims, o = TF.origin, th = TF.h;
        // trilinear sample of a lead's gradient field at a torso-frame point
        tfSample = (F, p) => {
          const fx = (p[0] - o[0]) / th, fy = (p[1] - o[1]) / th, fz = (p[2] - o[2]) / th;
          const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(fy))), k0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
          const tx = Math.min(1, Math.max(0, fx - i0)), ty = Math.min(1, Math.max(0, fy - j0)), tz = Math.min(1, Math.max(0, fz - k0));
          const out = [0, 0, 0];
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let e = 0; e < 2; e++) {
            const wgt = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (e ? tz : 1 - tz);
            const q = 3 * (((i0 + a) * ny + (j0 + b)) * nz + (k0 + e));
            out[0] += wgt * F[q]; out[1] += wgt * F[q + 1]; out[2] += wgt * F[q + 2];
          }
          return out;
        };
        // scale so lead I has the same mean sensitivity over the heart as the
        // uniform-field (Einthoven) model; lead II keeps its relative length
        let sum = 0, cnt = 0;
        for (let c = 0; c < n; c += 7) { if (!this.kind[c]) continue; const v = tfSample(TF._I, this.toTorso(A.p(c))); sum += Math.hypot(v[0], v[1], v[2]); cnt++; }
        tfScale = 1e-4 / (sum / cnt);
        this.torsoLimb = true;
        // heart-averaged lead vectors of leads I and II (torso frame, lead I = unit length): Burger's triangle
        const mI = [0, 0, 0], mII = [0, 0, 0];
        for (let c = 0; c < n; c += 7) { if (this.kind[c] !== KIND.VENT) continue; const p = this.toTorso(A.p(c)); const a = tfSample(TF._I, p), b = tfSample(TF._II, p); for (let d = 0; d < 3; d++) { mI[d] += a[d]; mII[d] += b[d]; } }
        const lI = len(mI);
        this.limbLeadVectors = { I: mul(mI, 1 / lI), II: mul(mII, 1 / lI) };
      }
      const W = new Float32Array(n * NE);
      const E = names.map((k) => this.electrodes[k]);
      const R = this.rot;
      const axes = [0, 1, 2].map((j) => [R[j], R[3 + j], R[6 + j]]);   // columns of R
      // Brody effect: the highly conductive cavity blood amplifies radial
      // (transmural) ventricular sources relative to tangential ones. Model the
      // effective source as −(I + B·r̂r̂ᵀ)∇Vm, r̂ = local transmural direction.
      const B = this.P.brody || 0;
      const rhat = new Float32Array(3 * n);
      if (B) for (let c = 0; c < n; c++) {
        if (this.kind[c] !== KIND.VENT) continue;
        const i = A.ii[c], j = A.jj[c], k = A.kk[c], g = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          const o = [a === 0, a === 1, a === 2].map(Number);
          const p1 = A.at(i + o[0], j + o[1], k + o[2]), m1 = A.at(i - o[0], j - o[1], k - o[2]);
          const tp = p1 >= 0 && A.tm[p1] >= 0 ? A.tm[p1] : null, tq = m1 >= 0 && A.tm[m1] >= 0 ? A.tm[m1] : null;
          g[a] = tp !== null && tq !== null ? (tp - tq) / 2 : tp !== null ? tp - A.tm[c] : tq !== null ? A.tm[c] - tq : 0;
        }
        const gl = Math.hypot(g[0], g[1], g[2]);
        if (gl < 0.03) continue;                                   // mid-septum etc.: no defined radial direction
        for (let d = 0; d < 3; d++) rhat[3 * c + d] = (R[3 * d] * g[0] + R[3 * d + 1] * g[1] + R[3 * d + 2] * g[2]) / gl;   // torso frame
      }
      // Intracellular conductivity is anisotropic: σi = σt·I + (σl − σt)·f fᵀ
      // (f = fibre direction), so the source −σi∇Vm is stronger for gradients
      // along fibres than across them. Normalised by the mean diagonal so the
      // average source strength is unchanged; only the directional balance moves.
      const kap = this.P.sigmaRatio || 1, aniso = kap - 1, anorm = 1 / (1 + aniso / 3);
      const fb = A.fiber, fwd = new Float32Array(3 * n);
      if (aniso) for (let c = 0; c < n; c++) {
        if (this.kind[c] !== KIND.VENT) continue;
        const f = [fb[3 * c], fb[3 * c + 1], fb[3 * c + 2]], fl = Math.hypot(f[0], f[1], f[2]) || 1;
        for (let d = 0; d < 3; d++) fwd[3 * c + d] = (R[3 * d] * f[0] + R[3 * d + 1] * f[1] + R[3 * d + 2] * f[2]) / fl;   // torso frame
      }
      for (let c = 0; c < n; c++) {
        const kc = this.kind[c]; if (!kc) continue;
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        const sc = kc === KIND.VENT ? (aniso ? anorm : 1) * this.P.ventSourceGain : 1;
        for (let a = 0; a < 3; a++) {
          const w = A.at(i + (a === 0), j + (a === 1), k + (a === 2));
          if (w < 0 || this.kind[w] !== kc) continue;
          const m = this.toTorso(lerp(A.p(c), A.p(w), 0.5));   // pair midpoint, torso frame
          const ex = axes[a];                                     // pair direction, torso frame
          // midpoint radial direction and its component along the pair
          const rr = [0.5 * (rhat[3 * c] + rhat[3 * w]), 0.5 * (rhat[3 * c + 1] + rhat[3 * w + 1]), 0.5 * (rhat[3 * c + 2] + rhat[3 * w + 2])];
          const re = B * (rr[0] * ex[0] + rr[1] * ex[1] + rr[2] * ex[2]);
          // pair-midpoint fibre (sign-aligned average), and its component along the pair
          let ff = [0, 0, 0], fe = 0;
          if (aniso && kc === KIND.VENT) {
            const sgn = fwd[3 * c] * fwd[3 * w] + fwd[3 * c + 1] * fwd[3 * w + 1] + fwd[3 * c + 2] * fwd[3 * w + 2] < 0 ? -1 : 1;
            ff = [fwd[3 * c] + sgn * fwd[3 * w], fwd[3 * c + 1] + sgn * fwd[3 * w + 1], fwd[3 * c + 2] + sgn * fwd[3 * w + 2]];
            const fl = Math.hypot(ff[0], ff[1], ff[2]) || 1; ff = ff.map((v) => v / fl);
            fe = aniso * (ff[0] * ex[0] + ff[1] * ex[1] + ff[2] * ex[2]);
          }
          for (let d = 0; d < 3; d++) {                           // VCG: uniform lead fields
            const cc = 1e-4 * h * h * sc * (ex[d] + re * rr[d] + fe * ff[d]);
            W[w * NE + 9 + d] += cc; W[c * NE + 9 + d] -= cc;
          }
          if (TF) for (let q = 0; q < 2; q++) {                    // bounded-torso limb leads I, II
            const Lv = tfSample(q ? TF._II : TF._I, m);
            const cc = tfScale * h * h * sc * ((Lv[0] * ex[0] + Lv[1] * ex[1] + Lv[2] * ex[2]) + re * (Lv[0] * rr[0] + Lv[1] * rr[1] + Lv[2] * rr[2]) + fe * (Lv[0] * ff[0] + Lv[1] * ff[1] + Lv[2] * ff[2]));
            W[w * NE + 12 + q] += cc; W[c * NE + 12 + q] -= cc;
          }
          for (let e = 0; e < 9; e++) {
            const rx = E[e][0] - m[0], ry = E[e][1] - m[1], rz = E[e][2] - m[2];
            const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
            const cc = h * h * sc * ((rx * ex[0] + ry * ex[1] + rz * ex[2]) + re * (rx * rr[0] + ry * rr[1] + rz * rr[2]) + fe * (rx * ff[0] + ry * ff[1] + rz * ff[2])) / (r * r * r);
            W[w * NE + e] += cc; W[c * NE + e] -= cc;
          }
        }
      }
      this.W = W; this.NE = NE;
    }
  }

  // ---------------------------------------------------------------------------
  // Simulation: event-driven cellular automaton with per-cell action potentials
  // ---------------------------------------------------------------------------
  //
  // Each cell is in one of three phases, derived from its last activation time:
  //   RESTING (0)       — excitable, Vm = Vrest
  //   DEPOLARIZED (1)   — upstroke + plateau (absolutely refractory)
  //   REPOLARIZING (2)  — phase 3 back to rest (relatively refractory)
  // When a cell activates at time ta it schedules arrival at each neighbour j
  // at ta + τ_ij · f(DI_j), where τ_ij = distance / anisotropic CV and f()
  // slows conduction into incompletely recovered tissue (CV restitution).
  // Arrivals are kept in a 1-ms bucket queue with exact (sub-ms) times, so the
  // activation sequence matches an eikonal solution on the tissue graph and is
  // independent of the integration step.
  const PHASE = { REST: 0, DEP: 1, REP: 2 };
  const RING = 8192;  // ms horizon of the arrival queue

  class Sim {
    constructor(model, opts = {}) {
      this.M = model; this.P = model.P;
      const N = model.nCells;
      this.N = N;
      this.rand = rng(opts.seed || 1);
      this.t = 0;
      this.tAct = new Float64Array(N).fill(-1e9);
      this.apd = new Float32Array(N);
      this.refEnd = new Float64Array(N).fill(-1e9);  // end of effective refractory period
      this.repEnd = new Float64Array(N).fill(-1e9);  // end of APD
      this.arrive = new Float64Array(N).fill(Infinity);
      this.blocked = new Uint8Array(N);
      this.cvMul = new Float32Array(N).fill(1);       // >1 slows conduction (ischaemia)
      this.buckets = Array.from({ length: RING }, () => []);
      this._assignParams();
      if (!opts.noMemory && this.P.electrotonicK > 0) this._electrotonicMemory();
      // ECG bookkeeping. Cells in upstroke or repolarisation are summed
      // explicitly ("dynamic" list); cells on the plateau have Vm linear in t
      // and are folded into two running sums per electrode (see _ecg).
      this.dyn = new Int32Array(N); this.nDyn = 0; this.dynPos = new Int32Array(N).fill(-1);
      this.onPlateau = new Uint8Array(N);
      this.gen = new Uint32Array(N);                  // activation counter (stale-event guard)
      this.tbuckets = Array.from({ length: RING }, () => []);
      this.S0 = new Float64Array(model.NE); this.S1 = new Float64Array(model.NE);
      this.leadsLatest = new Float32Array(12);
      this.listeners = [];
      this.pacemakers = [];
      this.setRate(this.P.sinusRate);
      // Subsidiary pacemakers are source-dependent: each takes over only when
      // conduction from above it is interrupted, never because the sinus rate
      // is merely slow.
      //   junctional  — sinus node blocked/arrested, or block within the AV node
      //   ventricular — block below the AV node (His bundle, or both bundle branches)
      const anyBlocked = (ids) => ids.some((c) => this.blocked[c]);
      const M = model, cs = M.csSegments;
      this._addPacemaker(M.junctionalCell, 60000 / this.P.junctionalRate, 'junctional',
        () => this.blocked[M.sanCell] || this.sinusArrest || anyBlocked(M.avn));
      this._addPacemaker(M.ventEscapeCell, 60000 / this.P.ventEscapeRate, 'ventricular',
        () => anyBlocked(cs.HIS) || (anyBlocked(cs.LBB) && anyBlocked(cs.RBB)));
      // beat bookkeeping for interval measurement
      this.log = { atrial: [], vent: [] };
      this.fireLog = [];   // spontaneous pacemaker discharges {name, t}
      this._curA = null; this._curV = null;
    }

    _assignParams() {
      const M = this.M, P = this.P, A = M.A, N = this.N;
      this.apdMax = new Float32Array(N); this.vRest = new Float32Array(N).fill(P.vRest);
      this.vAmp = new Float32Array(N).fill(P.vAmp); this.repW = new Float32Array(N);
      this.cvK = new Float32Array(N); this.cvTau = new Float32Array(N).fill(P.cvRestTau);
      this.erpExtra = new Float32Array(N);
      for (let c = 0; c < N; c++) {
        const k = M.kind[c];
        let apd = 0;
        if (k === KIND.VENT) {
          // APD heterogeneity: endocardium > epicardium (tm), base > apex (zuvc)
          const tm = A.tm[c], zz = A.zuvc[c] < 0 ? 0.5 : A.zuvc[c];
          apd = P.apdVent + P.apdVentEndoExtra * (0.5 - tm) + P.apdVentApexExtra * (0.5 - zz);
          if (A.label[c] === LAB.RV) apd += P.apdRVoffset;
          this.repW[c] = P.repWVent;
        } else if (k === KIND.ATRIAL) { apd = P.apdAtrial; this.repW[c] = P.repWAtrial; }
        else if (k === KIND.PURK || k === KIND.BUNDLE || k === KIND.HIS) { apd = P.apdPurk; this.repW[c] = P.repWVent; }
        else if (k === KIND.AVN) { apd = P.apdAVN; this.repW[c] = P.repWAtrial; this.erpExtra[c] = P.avnErpExtra; }
        this.apdMax[c] = apd;
        this.cvK[c] = k === KIND.AVN ? P.avnCvRestK : P.cvRestK;
        if (k === KIND.AVN) this.cvTau[c] = P.avnCvRestTau;
      }
    }

    // Electrotonic modulation of repolarisation ("cardiac memory"): in the
    // intact heart APD is shorter where activation is later, so repolarisation
    // is more synchronous and the T wave concordant with the QRS. We record
    // the activation map of one reference sinus beat and set
    //   APDmax_i -= κ · (AT_i − mean AT).
    // Abnormal activation later (BBB, ectopy, pacing) keeps this sinus-tuned
    // map, so secondary (discordant) T-wave changes emerge on their own.
    _electrotonicMemory() {
      const ref = new Sim(this.M, { noMemory: true, seed: 1 });
      ref.run(Math.ceil(60000 / this.P.sinusRate) + 450);
      const vb = ref.log.vent[0];
      if (!vb) return;
      const M = this.M, k = this.P.electrotonicK;
      let sum = 0, n = 0;
      for (let c = 0; c < M.nVox; c++) if (M.kind[c] === KIND.VENT && ref.tAct[c] >= vb.on) { sum += ref.tAct[c] - vb.on; n++; }
      const mean = sum / n;
      this.refAT = new Float32Array(M.nVox).fill(-1);
      for (let c = 0; c < M.nVox; c++) {
        if (M.kind[c] !== KIND.VENT || ref.tAct[c] < vb.on) continue;
        const at = ref.tAct[c] - vb.on;
        this.refAT[c] = at;
        this.apdMax[c] -= k * (at - mean);
      }
    }

    _addPacemaker(cell, cl, name, armed = null) {
      // subsidiary pacemakers start their cycle at t=0 (they only escape if not overdriven)
      this.tAct[cell] = 0; this.repEnd[cell] = 0; this.refEnd[cell] = 0;
      this.pacemakers.push({ cell, cl, name, armed });
    }
    // The sinus-rate control stands in for autonomic tone: vagal tone slows the
    // sinus node and AV node together, sympathetic tone speeds both, so PR
    // shortens in sinus tachycardia and lengthens in sinus bradycardia.
    setRate(bpm) {
      this.sinusBpm = bpm;
      const tone = Math.pow(72 / bpm, this.P.avnToneExp);
      for (const c of this.M.avn) this.cvMul[c] = tone;
      const cl = 60000 / bpm;
      const pm = this.pacemakers.find((p) => p.name === 'sinus');
      if (pm) pm.cl = cl; else this.pacemakers.unshift({ cell: this.M.sanCell, cl, name: 'sinus' });
    }

    schedule(c, time) {
      if (time >= this.arrive[c] && this.arrive[c] > this.tAct[c]) return;  // already sooner
      this.arrive[c] = time;
      const b = Math.floor(time);
      if (b - this.t >= RING) return;
      this.buckets[((b % RING) + RING) % RING].push(c, time);
    }

    // External stimulus (used by pacemakers, clicks, future pacing leads)
    stimulate(c, time = this.t) { this.schedule(c, Math.max(time, this.t)); }

    _activate(c, ta) {
      const P = this.P;
      // diastolic interval since previous repolarisation
      const DI = ta - this.repEnd[c];
      const apd = this.apdMax[c] * (1 - P.restA * Math.exp(-Math.max(DI, 0) / P.restTau));
      this.tAct[c] = ta; this.apd[c] = apd;
      this.repEnd[c] = ta + apd;
      this.refEnd[c] = ta + apd * P.erpFrac + this.erpExtra[c];
      this.arrive[c] = Infinity;
      if (c < this.M.nVox && this.M.kind[c]) this._ecgEnter(c, ta, apd);
      this._logActivation(c, ta);
      // propagate
      const M = this.M, st = M.start, nb = M.nbr, w0 = M.w0;
      for (let e = st[c]; e < st[c + 1]; e++) {
        const j = nb[e];
        if (this.blocked[j]) continue;
        let tau = w0[e] * this.cvMul[j];
        const tEst = ta + tau;
        if (tEst < this.refEnd[j]) continue;          // will meet refractory tissue
        const dij = tEst - this.repEnd[j];
        tau *= 1 + this.cvK[j] * Math.exp(-Math.max(dij, 0) / this.cvTau[j]);
        const tArr = ta + tau;
        if (tArr < this.arrive[j] || this.arrive[j] <= this.tAct[j]) this.schedule(j, tArr);
      }
    }

    _logActivation(c, ta) {
      const k = this.M.kind[c];
      if (k === KIND.ATRIAL) {
        if (!this._curA || ta - this._curA.last > 60) { this._curA = { on: ta, last: ta, n: 0 }; this.log.atrial.push(this._curA); if (this.log.atrial.length > 50) this.log.atrial.shift(); }
        this._curA.last = ta; this._curA.n++;
      } else if (k === KIND.VENT) {
        if (!this._curV || ta - this._curV.last > 60) {
          this._curV = { on: ta, last: ta, n: 0, repEnd: 0, origin: c };
          this.log.vent.push(this._curV); if (this.log.vent.length > 50) this.log.vent.shift();
        }
        this._curV.last = ta; this._curV.n++;
        this._curV.repEnd = Math.max(this._curV.repEnd, this.repEnd[c]);
      }
    }

    // Transmembrane potential of cell c at time t. Parametric action potential
    // with compact phases so most of it is cheap to sum:
    //   phase 0  smoothstep upstroke over upW ms
    //   phase 2  plateau declining linearly by plateauDecline·Amp over the APD
    //   phase 3  smoothstep repolarisation over a window repW centred on the APD
    vm(c, t) {
      const s = t - this.tAct[c], vr = this.vRest[c];
      const apd = this.apd[c], w = this.repW[c], uw = this.P.upW;
      if (s <= 0 || s >= apd + 0.5 * w) return vr;
      let up = 1; if (s < uw) { const x = s / uw; up = x * x * (3 - 2 * x); }
      let rep = 1; const r0 = apd - 0.5 * w;
      if (s > r0) { const x = (s - r0) / w; rep = 1 - x * x * (3 - 2 * x); }
      const pl = 1 - this.P.plateauDecline * (s < apd ? s / apd : 1);
      return vr + this.vAmp[c] * up * pl * rep;
    }

    phase(c, t = this.t) {
      const s = t - this.tAct[c], apd = this.apd[c], w = this.repW[c];
      if (s < 0 || s >= apd + 0.3 * w) return PHASE.REST;
      return s < apd - 0.3 * w ? PHASE.DEP : PHASE.REP;
    }

    // --- ECG list management -------------------------------------------------
    _dynAdd(c) { if (this.dynPos[c] < 0) { this.dynPos[c] = this.nDyn; this.dyn[this.nDyn++] = c; } }
    _dynRemove(c) {
      const q = this.dynPos[c]; if (q < 0) return;
      const last = this.dyn[--this.nDyn]; this.dyn[q] = last; this.dynPos[last] = q; this.dynPos[c] = -1;
    }
    // Plateau: Vm − Vrest = A(1 − p·(t − ta)/apd) = A(1 + p·ta/apd) − t·A·p/apd
    _plateau(c, sign) {
      const M = this.M, NE = M.NE, o = c * NE, A = this.vAmp[c], p = this.P.plateauDecline, apd = this.apd[c];
      const k0 = sign * A * (1 + p * this.tAct[c] / apd), k1 = sign * A * p / apd;
      for (let e = 0; e < NE; e++) { this.S0[e] += M.W[o + e] * k0; this.S1[e] += M.W[o + e] * k1; }
      this.onPlateau[c] = sign > 0 ? 1 : 0;
    }
    _ecgEnter(c, ta, apd) {
      if (this.onPlateau[c]) this._plateau(c, -1);
      this._dynAdd(c);
      const g = ++this.gen[c];
      const tPl = Math.ceil(ta + this.P.upW), tRep = Math.floor(ta + apd - 0.5 * this.repW[c]);
      if (tRep > tPl) {
        this.tbuckets[tPl % RING].push(c, g, 1);
        this.tbuckets[tRep % RING].push(c, g, 2);
      }
    }    // Advance one millisecond
    step() {
      const t = this.t;
      // 1. automaticity: a pacemaker fires when its cycle length has elapsed
      //    since it was last activated (being activated resets it: overdrive suppression)
      for (const pm of this.pacemakers) {
        if (pm.cl <= 0 || this.blocked[pm.cell] || (pm.armed && !pm.armed())) continue;
        if (pm.name === 'sinus' && this.sinusArrest) continue;
        if (t - this.tAct[pm.cell] >= pm.cl && t >= this.refEnd[pm.cell]) {
          this.schedule(pm.cell, t);
          this.fireLog.push({ name: pm.name, t }); if (this.fireLog.length > 40) this.fireLog.shift();
        }
      }
      // 2. process arrivals in [t, t+1)
      const bucket = this.buckets[t % RING];
      for (let q = 0; q < bucket.length; q += 2) {
        const c = bucket[q], ta = bucket[q + 1];
        if (ta !== this.arrive[c]) continue;          // superseded
        if (this.blocked[c] || ta < this.refEnd[c]) { this.arrive[c] = Infinity; continue; }
        this._activate(c, ta);
      }
      bucket.length = 0;
      this.t = t + 1;
      // 3. phase transitions for the ECG sum (upstroke→plateau→repolarisation)
      const tb = this.tbuckets[this.t % RING];
      for (let q = 0; q < tb.length; q += 3) {
        const c = tb[q]; if (tb[q + 1] !== this.gen[c]) continue;
        if (tb[q + 2] === 1) { this._dynRemove(c); this._plateau(c, +1); }
        else { this._plateau(c, -1); this._dynAdd(c); }
      }
      tb.length = 0;
      this._ecg(this.t);
    }

    run(ms) { for (let i = 0; i < ms; i++) this.step(); }

    // 4. ECG: φ_e = −K [Σ_dyn W_ei (Vm_i − Vrest_i) + (S0_e − t·S1_e) + baseline_e]
    _ecg(t) {
      const M = this.M, W = M.W, NE = M.NE, phi = this._phi || (this._phi = new Float64Array(NE));
      for (let e = 0; e < NE; e++) phi[e] = this.S0[e] - t * this.S1[e];
      for (let q = 0; q < this.nDyn; q++) {
        const c = this.dyn[q];
        const dv = this.vm(c, t) - this.vRest[c];
        if (dv === 0 && t > this.tAct[c]) { this._dynRemove(c); q--; continue; }   // back at rest
        const o = c * NE;
        for (let e = 0; e < NE; e++) phi[e] += W[o + e] * dv;
      }
      const g = -this.P.ecgGain;
      const base = this._baseline || (this._baseline = this._computeBaseline());
      const v = (e) => g * (phi[e] + base[e]);
      // Heart vector (VCG), torso frame: X left, Y superior, Z anterior
      const D = this.dipole || (this.dipole = new Float32Array(3));
      for (let a = 0; a < 3; a++) D[a] = v(9 + a) * this.P.dipoleGain;
      // Limb leads: projection of the heart vector on Einthoven's frontal
      // lead axes (I 0°, II +60°, III +120°; +angles are inferior), then
      // Goldberger's augmented leads — the limb electrodes are far-field.
      const L = this.leadsLatest, c60 = 0.5, s60 = 0.8660254;
      if (this.M.torsoLimb) {
        // bounded-torso lead fields (a computed Burger triangle)
        L[0] = v(12) * this.P.dipoleGain; L[1] = v(13) * this.P.dipoleGain; L[2] = L[1] - L[0];
      } else {
        L[0] = D[0];
        L[1] = c60 * D[0] - s60 * D[1];
        L[2] = -c60 * D[0] - s60 * D[1];
      }
      L[3] = -(L[0] + L[1]) / 2; L[4] = (L[0] - L[2]) / 2; L[5] = (L[1] + L[2]) / 2;
      // Precordial leads: a blend of (a) the heart vector projected on each
      // lead's direction (the dominant, dipolar part of chest potentials) and
      // (b) the near-field electrode potential vs Wilson's central terminal,
      // which keeps each lead sensitive to the tissue beneath it.
      const wct = (v(0) + v(1) + v(2)) / 3, P = this.P, dir = this.M.leadDir;
      for (let k = 0; k < 6; k++) {
        const u = dir[k], proj = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
        L[6 + k] = P.precordialGain * (P.precordialDipoleW * P.precordialDipoleGain * proj + (1 - P.precordialDipoleW) * (v(3 + k) - wct));
      }
      // recording chain: 2nd-order Butterworth low-pass per lead (ECG machine filter)
      if (this.P.ecgLowpass > 0) {
        const bq = this._bq || (this._bq = this._makeLowpass(this.P.ecgLowpass));
        const st = this._bqState || (this._bqState = new Float64Array(12 * 2));
        for (let k = 0; k < 12; k++) {            // transposed direct form II
          const x = L[k], y = bq.b0 * x + st[2 * k];
          st[2 * k] = bq.b1 * x - bq.a1 * y + st[2 * k + 1];
          st[2 * k + 1] = bq.b2 * x - bq.a2 * y;
          L[k] = y;
        }
      }
      for (const f of this.listeners) f(t, L);
    }

    _makeLowpass(fc) {                             // bilinear-transform Butterworth, fs = 1 kHz
      const K = Math.tan(Math.PI * fc / 1000), q = Math.SQRT1_2, norm = 1 / (1 + K / q + K * K);
      const b0 = K * K * norm;
      return { b0, b1: 2 * b0, b2: b0, a1: 2 * (K * K - 1) * norm, a2: (1 - K / q + K * K) * norm };
    }
    // Contribution of heterogeneous resting potentials (zero unless ischaemic)
    _computeBaseline() {
      const M = this.M, W = M.W, NE = M.NE, b = new Float64Array(NE);
      for (let c = 0; c < M.nVox; c++) {
        if (!M.kind[c]) continue;
        const dv = this.vRest[c] - this.P.vRest; if (!dv) continue;
        for (let e = 0; e < NE; e++) b[e] += W[c * NE + e] * dv;
      }
      return b;
    }
    invalidateBaseline() { this._baseline = null; }

    onSample(f) { this.listeners.push(f); }
  }

  const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

  // Bounded-torso limb-lead fields (tools/torso_leadfield.py). Bundled next to
  // the engine in Node; the browser page passes the embedded copy in.
  let DEFAULT_TORSO = null;
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try { DEFAULT_TORSO = require(__dirname + '/torso_leadfield.json'); } catch (e) { DEFAULT_TORSO = null; }
  }
  const setDefaultTorso = (tf) => { DEFAULT_TORSO = tf; };

  const api = { Anatomy, Model, Sim, DEFAULTS, LAB, KIND, SEG, SEG_NAME, PHASE, LEADS, rng, setDefaultTorso, lvThickenWeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiveHeart = api;
})(typeof window !== 'undefined' ? window : globalThis);
