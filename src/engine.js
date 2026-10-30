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
    cvBundle: 3.03,        // bundle branches and fascicles
    // Spec: conduction system ~3x faster than ventricular myocardium
    cvPurkinje: 1.82,
    avnSegDelay: 17,       // ms per AV-node segment (5 segments ≈ 85 ms AH)
    avnSegments: 5,
    slowPathSegments: 4, slowPathSegDelay: 50, slowPathErpExtra: 20, slowPathCvK: 1,   // dual AV-node pathways (AVNRT)
    avnFirstDegreeMul: 2.6, // AV-nodal delay factor for 1st-degree block
    // Wenckebach AV node recovery curve: AH = AHmin + α·exp(−(R − Reff)/τ), R = time since last His activation
    wkAHmin: 110, wkAlpha: 260, wkTau: 180, wkReff: 520,
    avnToneExp: 0.45,      // AV-nodal delay ∝ (72/rate)^exp (autonomic coupling)
    rbbSeptalFrac: 0,   // distal fraction of septal RBB giving off RV septal Purkinje
    rbbSeptalDelay: 20.31,    // ms extra delay into the RV septal Purkinje

    lafPhi: 2.75, lafZ: 0.54, lpfPhi: -2.23, lpfZ: 0.29, lsfPhi: 0.05, lsfZ: 0.42,
    septalFascicle: false,  // optional left septal fascicle (anatomically debated; off)
    fascConnectFrac: 0.59,  // distal fraction of LAF/LPF giving off Purkinje branches
    lbbSplitZ: 0.84, lbbSplitPhi: 0.0,  // where the LBB divides (apicobasal / rotational UVC)
    septalTerrHalf: 0,    // half-width (rad) of the mid-septal Purkinje territory
    lbbSeptalFrac: 0,           // distal fraction of the LBB trunk giving off septal Purkinje
    lpfApexZ: 0.25,            // apical cap (apicobasal UVC below this) belongs to the LPF territory
    lpfTerrLo: -1.54, lpfTerrHi: 0.56,  // LPF territory in rotational UVC (inferior/posterior wall)
    purkCrossApexZ: 0,      // cross-territory links below this apicobasal level are unslowed
    purkCrossSlow: 6.8,     // conduction-time factor on Purkinje links between fascicle territories
    ventSourceGain: 1.6,        // ventricular source strength relative to atrial (restores QRS:P ratio with anisotropy)
    precordialGain: 0.52,        // overall chest-lead gain
    sigmaRatio: 10,          // intracellular conductivity along:across fibres (1 = isotropic sources)
    brody: 0,               // radial source enhancement by intracavitary blood (Brody effect)
    heartPitch: -10,          // degrees about the left–right axis (+ tips the anterior wall upward)
    heartYaw: 8,           // degrees about the vertical axis (+ = apex swung from anterior toward the left)
    heartRotation: 14,    // degrees about the AP axis (+ = more vertical heart)
    apexX: 72, apexY: -34.83,  // apex position in the chest (mm from midline / from V4 level)
    chestGap: 15,          // closest heart–anterior chest wall distance (mm)
    purkLinkR: 3.2,        // Purkinje node link radius (× node spacing)
    purkZmaxLV: 0.94, purkZmaxRV: 0.93,   // basal limit of Purkinje networks (apicobasal UVC)
    pmjAntero: 2,          // Purkinje -> muscle junction delay (ms)
    pmjRetro: 20,          // muscle -> Purkinje (retrograde) junction delay (ms)
    pmjRetroRV: 35,        // retrograde PMJ delay in the RV (thin wall, sparse junctions)

    // Action potential durations (ms) at long diastolic interval
    apdVent: 295,          // modulated by transmural / apicobasal gradients below
    atrialFrontalRot: 30,   // degrees the atrial sources are turned back (frontal plane) against the ventricular rotation
    atrialSourceGain: 0.31, // atrial source strength (P-wave size; the atria sit high and close to the limb-lead fields)
    lvStrain: 0, rvStrain: 0, lvSourceGain: 1, rvSourceGain: 1,   // 0–1, set with hypertrophy (reverses the transmural gradient)
    apdVentEndoExtra: 85,  // endocardium longer than epicardium (upright T waves)
    apdVentApexExtra: 20,  // apicobasal APD gradient (+: apex longer; sized so limb-lead T stays within textbook height)
    apdRVoffset: 0,        // RV and LV action potentials of similar length (a longer RV APD gave a dip before the T wave)
    apdAtrial: 190, apdMinAtrial: 135, flutterApdMin: 185,
    apdPurk: 340,
    apdBundle: 360,        // His bundle, LBB and fascicles
    apdRBB: 400,           // right bundle branch: longest refractoriness
    apdAVN: 160,
    // APD restitution: APD = APDmax * (1 - a * exp(-DI/tau))
    restA: 0.70, restTau: 450,
    // CV restitution (slowing in partially recovered tissue)
    cvRestK: 0.6, cvRestTau: 30,
    avnCvRestK: 4, avnCvRestTau: 150,  // AV-node decremental conduction
    avnErpExtra: 180,      // post-repolarisation refractoriness of AV node (ms)
    electrotonicK: 1.4,    // APD shortening per ms of later activation (cardiac memory)
    erpFrac: 0.92,         // ERP as fraction of APD (myocardium)

    // Transmembrane potential shape
    vRest: -85, vAmp: 105,
    plateauDecline: 0.05,  // fractional fall in plateau over the APD
    repWVent: 180, repWAtrial: 220,   // width of phase-3 repolarisation window (ms)
    upW: 2.0,                        // width of phase-0 upstroke (ms)

    // Arrhythmia drivers (see Sim.startArrhythmia)
    afFociLA: 8, afFociRA: 3, afClMin: 110, afClMax: 230,
    afDefaultRate: 110, afIrregularity: 0.45, afAvnToV: 110,   // AF ventricular response: mean rate, ±fraction of RR
    flutterRingSlow: 1.1, flutterIsthmusSlow: 2.8, flutterGateTol: 0.03, flutterRadius: 25, flutterBachmannSlow: 40,
    matClMin: 380, matClMax: 640,
    ectopicDist: 25,        // ectopic atrial focus: distance (mm) from the AV node, low in the right atrium
    vtCl: 330,
    vfFoci: 12, vfClMin: 140, vfClMax: 240,
    adenosineDelay: 1000, adenosineBlock: 3000, shockRefractory: 160,

    // Accessory pathway (see Sim.setAccessoryPathway)
    apDelay: 6, apErp: 280,

    // Atrial enlargement (see Sim.setAtrialEnlargement)
    raeGain: 2.4, raeSlow: 0.85,
    laeGain: 2.6, laeSlow: 0.85, laeBachmannSlow: 1, laeInteratrialSlow: 1, laeInteratrialMm: 10, laeInteratrialEdgeSlow: 28,

    // Ischaemia (see Sim._ischemicState)
    ischBorderMm: 9,       // border-zone width over which severity rises to the core value
    ischKatpH: 0.15,       // hours for K-ATP APD shortening to develop (hyperacute T)
    ischInjuryOnset: 0.15, // hours before the injury current starts (the first minutes show hyperacute T only)
    ischInjuryH: 0.6,      // hours for the injury current (resting depolarisation) to develop
    ischApdShort: 0.45, ischApdLate: 0.9, ischLateH: 3,
    ischSubendoGain: 1.6, subendoInj: 0.6, subendoRVGain: 0.5, subendoSpanPhi: 1.6, subendoSpanZ: 0.5,  // demand ischaemia: the inner wall is the most severely injured
    ischStResolve: 0.6,    // subendocardial: fraction of the injury current gone by 8 h
    ischTRecover: 0.35,    // fraction of the late T-wave inversion that recovers by ~1 month (it often persists)
    ischDvRest: 22,        // mV resting depolarisation at full injury (and in dead cells)
    ischAmpDrop: 0.55, ischCvSlow: 0.15,
    septalSpread: 0.15,    // septal perforators supply up to this far (apicobasal fraction) above their LAD origin
    ischDeadS: 0.38,       // severity above which a cell dies once the necrosis front reaches it
    ischFrontMax: 1.05,    // how far through the LV wall necrosis reaches (<1 leaves a surviving epicardial rim)
    pericardDepth: 0.7, pericardDv: 10, pericardAmpDrop: 0.4, pericardSag: -0.55, pericardAtrialDv: 12, pericardAtrialDecline: 0.5,   // pericarditis: outer 30% of the LV wall, RV and atrial epicardium
    brugadaMm: 32, brugadaDomeLoss: 0.8, brugadaApdLong: 0.5,                       // Brugada: RVOT epicardium within 32 mm of the pulmonary valve
    ischBlockInj: 0.7,     // injury level above which living ischaemic muscle (after 2 h) no longer conducts
    ischHaloMm: 10, ischHaloLate: 0.45,   // zone of ischaemia around the infarct: width (mm) and late APD prolongation (T inversion)
    ischNecrosisH: 5.6,    // hours for necrosis to advance from endocardium to epicardium
    ischUncouple: 0.7,     // fraction of necrotic/living coupling lost early on (all of it once the scar forms)
    ischSanSlow: 0.25, ischAvnSlow: 1.2, ischAvnErp: 0.6,

    // Automaticity (cycle lengths, ms)
    sinusRate: 72,
    junctionalRate: 48,
    ventEscapeRate: 40,
    idioventricularRate: 34,

    // ECG
    ecgGain: 0.0174,      // converts Σ W·Vm into mV (calibrated once on sinus rhythm)
    precordialDipoleW: 0.7,     // share of the precordial signal from the heart-vector projection
    precordialDipoleGain: 1.7,  // precordial lead-vector length relative to the limb leads
    leadDistExp: 1.5,           // lead-vector length ∝ (mean distance / distance)^exp
    ecgHighpass: 0.05,          // Hz, diagnostic-ECG high-pass (baseline restoration)
    ecgLowpass: 40,             // Hz, ECG machine low-pass (0 = off; diagnostic carts use up to 150)
    torsoUniform: 0,            // share of the heart-averaged torso lead vector in place of the per-cell field
    limbRotation: 8,            // extra frontal rotation of the heart as seen by the limb leads (degrees, + = more vertical)
    torsoIIGain: 0.6,           // lead II length of the torso (Burger) triangle relative to its computed value
    atrialTorsoII: 0.92,        // torso lead II for atrial sources (keeps the P-wave calibration made at torsoBlend 0.6)
    torsoBlend: 0.7,            // limb leads: share of the bounded-torso lead field (rest: Einthoven projection)
    dipoleGain: 3.0,            // heart-vector scale for the limb leads (mV per unit dipole)
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

  // RV free wall growth map: full over the body of the wall, tapering at the
  // base (valve rings, outflow) and the apex
  function rvThickenWeight(phi, z) {
    if (!(z >= 0)) return 0;
    const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    return sm((0.92 - z) / 0.2) * sm((z - 0.05) / 0.2);
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
      // ventricular hypertrophy (opts.rvWallLayers: RV free wall, outward)
      this.rvWallLayers = opts.rvWallLayers || 0;
      if (this.rvWallLayers) this._editLVWall(V, this.rvWallLayers, LAB.RV, rvThickenWeight);
      // atrial wall thickening (opts.raWallLayers / laWallLayers, outward)
      this.raWallLayers = opts.raWallLayers !== undefined ? opts.raWallLayers : 1;   // one extra layer by default (RA force ≈ LA force, see LAE)
      this.laWallLayers = opts.laWallLayers || 0;
      if (this.raWallLayers) this._editLVWall(V, this.raWallLayers, LAB.RA, () => 1);
      if (this.laWallLayers) this._editLVWall(V, this.laWallLayers, LAB.LA, () => 1);
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

    _editLVWall(V, layers, label = LAB.LV, weight = lvThickenWeight) {
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
      const free = (v, L) => v.l === label && weight(v.phi, v.z) >= (L + 0.5) / nL;
      for (let L = 0; L < Math.abs(layers); L++) {
        const { occ, out } = outside();
        if (layers > 0) {
          const add = new Map();
          for (const v of V) {
            if (!free(v, L)) continue;
            for (const w of nb(v.g)) if (out[w] && !add.has(w)) {
              // keep clear of other structures (atria, great vessels, the other ventricle)
              if (nb(w).some((x) => occ[x] >= 0 && V[occ[x]].l !== label)) continue;
              add.set(w, { g: w, l: label, rho: 1, z: v.z, phi: v.phi, vs: v.vs, f: v.f.slice() });
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
      this._buildCoronaries();
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

      // Slow AV-nodal pathway (dual AV-node physiology): from the CS-ostium
      // side of the triangle of Koch, slow but quickly recovering, joining
      // the compact node. Present in every heart model but blocked unless
      // Sim.setDualAVN(true): it is the substrate of typical AVNRT.
      const csP = P2(this.csCell), joinP = this.pt(avn[nAvn - 2]);
      const slow = [];
      for (let s = 0; s < P.slowPathSegments; s++) {
        const id = this.addNode(KIND.AVN, SEG.AVN, lerp(csP, joinP, (s + 0.5) / P.slowPathSegments));
        if (s) this.edge(slow[s - 1], id, P.slowPathSegDelay, false);
        slow.push(id);
      }
      // antegrade only (typical slow–fast AVNRT; retrograde slow conduction, the
      // substrate of atypical fast–slow AVNRT, is not modelled)
      this.edge(slow[slow.length - 1], avn[nAvn - 2], P.slowPathSegDelay, false);
      for (let c = 0; c < A.n; c++) if (isRA(c) && len(sub(P2(c), csP)) < 6) this.edge(c, slow[0], 3, false);
      this.avnSlow = slow;

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
      // idioventricular: an LV Purkinje node in the inferior wall, mid-level
      this.idioCell = this.purkLV.reduce((best, id) => {
        const c = A.nearest([this.x[id], this.y[id], this.z[id]]), sc = Math.abs(A.zuvc[c] - 0.5) + Math.abs(A.phi[c] + 1.5);
        return !best || sc < best.sc ? { id, sc } : best;
      }, null).id;

      // conduction-system node lists for rendering/picking
      this.csSegments = {
        AVN: avn, HIS: his, LBB: lbb, LAF: this.laf, LPF: this.lpf, LSF: this.lsf, RBB: this.rbb,
      };
    }

    // ---- Coronary arteries (right-dominant) and perfusion territories ----
    // Branches are routed over the ventricular epicardium between anatomical
    // targets: the LAD and PDA in the interventricular grooves, the LCx round
    // the mitral annulus (left AV groove), the RCA round the tricuspid annulus
    // (right AV groove) to the crux. Every ventricular voxel is assigned the
    // node that supplies it (septum: anterior 2/3 LAD, inferior 1/3 PDA; apex:
    // LAD; RV: RCA/acute marginal; free wall: nearest surface branch).
    _buildCoronaries() {
      const A = this.A, P = this.P, lm = A.landmarks;
      const epiV = (c) => A.epi[c] && (A.label[c] === LAB.LV || A.label[c] === LAB.RV);
      const lvEpi = (phi, zz) => this._nearestWhere((c) => A.label[c] === LAB.LV && A.epi[c] && A.zuvc[c] >= 0, (c) => {
        let dp = Math.abs(A.phi[c] - phi); if (dp > Math.PI) dp = 2 * Math.PI - dp;
        return dp * 25 + Math.abs(A.zuvc[c] - zz) * 80;
      });
      const nodes = [], branches = {};
      const addBranch = (name, parentNode, targets) => {
        const ids = []; let prevVox = parentNode >= 0 ? A.nearest([nodes[parentNode].x, nodes[parentNode].y, nodes[parentNode].z], epiV) : targets[0];
        let parent = parentNode, acc = 99;
        for (let k = parentNode >= 0 ? 0 : 1; k < targets.length; k++) {
          const path = A.path(prevVox, targets[k], epiV) || [prevVox, targets[k]];
          for (const c of path) {
            const p = A.p(c);
            if (parent >= 0) { const q = nodes[parent]; acc = Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z); }
            if (acc < 3 && c !== targets[k]) continue;                 // ~3 mm node spacing
            nodes.push({ x: p[0], y: p[1], z: p[2], parent, branch: name, vox: c });
            parent = nodes.length - 1; ids.push(parent);
          }
          prevVox = targets[k];
        }
        branches[name] = ids; return ids;
      };
      const along = (ids, f) => ids[Math.min(ids.length - 1, Math.floor(f * (ids.length - 1)))];
      const ao = lm.AoV.c;
      // left main: from the left-posterior aortic sinus to the LAD/LCx split
      const lmStart = A.nearest(add(ao, [12, -4, -6]), epiV), split = lvEpi(1.55, 0.95);
      const LM = addBranch('LM', -1, [lmStart, split]);
      const LAD = addBranch('LAD', LM[LM.length - 1], [lvEpi(1.6, 0.75), lvEpi(1.65, 0.5), lvEpi(1.6, 0.25), lvEpi(1.0, 0.06), lvEpi(-0.4, 0.1)]);
      addBranch('D1', along(LAD, 0.18), [lvEpi(2.1, 0.62), lvEpi(2.4, 0.4)]);
      addBranch('D2', along(LAD, 0.42), [lvEpi(2.0, 0.35), lvEpi(2.2, 0.15)]);
      const LCX = addBranch('LCx', LM[LM.length - 1], [lvEpi(2.2, 0.93), lvEpi(2.8, 0.9), lvEpi(-2.9, 0.88), lvEpi(-2.3, 0.88)]);
      addBranch('OM1', along(LCX, 0.45), [lvEpi(2.9, 0.55), lvEpi(3.0, 0.25)]);
      addBranch('OM2', along(LCX, 0.85), [lvEpi(-2.6, 0.5), lvEpi(-2.5, 0.25)]);
      // RCA round the tricuspid annulus: right-anterior sinus -> acute margin -> crux
      const tv = lm.TV; let tn = norm(tv.n); if (dot(tn, sub(lm.SVC.c, tv.c)) < 0) tn = mul(tn, -1);
      const toAo = sub(ao, tv.c), u0 = norm(sub(toAo, mul(tn, dot(toAo, tn))));
      const w0 = norm([tn[1] * u0[2] - tn[2] * u0[1], tn[2] * u0[0] - tn[0] * u0[2], tn[0] * u0[1] - tn[1] * u0[0]]);
      const Rr = 2 * tv.r / 1.41 + 9;
      const ring = (ang, sgn) => add(tv.c, add(mul(u0, Math.cos(ang) * Rr), mul(w0, sgn * Math.sin(ang) * Rr)));
      const sgn = ring(Math.PI / 2, 1)[0] < ring(Math.PI / 2, -1)[0] ? 1 : -1;   // sweep through the rightmost (acute) margin first
      const rcaStart = A.nearest(add(ao, [-10, -4, 8]), epiV);
      const ringPts = [0.35, 0.9, 1.5, 2.1, 2.6].map((a) => A.nearest(ring(a * 1.0, sgn), (c) => epiV(c)));
      const crux = lvEpi(-0.45, 0.92);
      const RCA = addBranch('RCA', -1, [rcaStart].concat(ringPts, [crux]));
      const acuteIdx = RCA.reduce((b, id) => (nodes[id].x < nodes[b].x ? id : b), RCA[0]);
      addBranch('AM', acuteIdx, [A.nearest(add([nodes[acuteIdx].x, nodes[acuteIdx].y, nodes[acuteIdx].z], [8, -45, 10]), (c) => A.label[c] === LAB.RV && A.epi[c])]);
      const PDA = addBranch('PDA', RCA[RCA.length - 1], [lvEpi(-0.7, 0.7), lvEpi(-0.75, 0.45), lvEpi(-0.7, 0.2)]);
      addBranch('PLV', RCA[RCA.length - 1], [lvEpi(-1.5, 0.8), lvEpi(-1.9, 0.65)]);
      // node UVC (for LV territory assignment)
      for (const n of nodes) { const c = n.vox; n.phi = A.phi[c]; n.zz = A.zuvc[c]; n.lv = A.label[c] === LAB.LV; }
      // ---- territories
      const lvSurface = ['LAD', 'D1', 'D2', 'LCx', 'OM1', 'OM2', 'PDA', 'PLV'].flatMap((b) => branches[b]);
      const rvNodes = branches.RCA.concat(branches.AM);
      const uvcDist = (c, id) => { let dp = Math.abs(A.phi[c] - nodes[id].phi); if (dp > Math.PI) dp = 2 * Math.PI - dp; return dp * 25 + Math.abs(A.zuvc[c] - nodes[id].zz) * 80; };
      const nearestOf = (list, c, metric) => { let b = -1, bd = Infinity; for (const id of list) { const d = metric(c, id); if (d < bd) { bd = d; b = id; } } return b; };
      const zOnly = (c, id) => Math.abs(A.zuvc[c] - nodes[id].zz);
      const euc = (c, id) => { const n = nodes[id]; return (A.pos[3 * c] - n.x) ** 2 + (A.pos[3 * c + 1] - n.y) ** 2 + (A.pos[3 * c + 2] - n.z) ** 2; };
      // Septal perforators run from the LAD into the septum and fan out a
      // little: the septum at apicobasal level z is supplied from the LAD at
      // level z − septalSpread (a perforator reaches ~1.3 cm above its origin
      // and everything below it). The drawn LAD and the septum stay consistent:
      // the further up the LAD an occlusion, the more septum (and septal Q waves).
      const voxNode = new Int32Array(A.n).fill(-1);
      for (let c = 0; c < A.n; c++) {
        const L = A.label[c]; if (L !== LAB.LV && L !== LAB.RV) continue;
        const ph = A.phi[c], zz = A.zuvc[c];
        if (L === LAB.RV) voxNode[c] = nearestOf(rvNodes, c, euc);
        else if (zz >= 0 && zz < 0.2) voxNode[c] = nearestOf(branches.LAD, c, euc);                 // apex: wrap-around LAD
        else if (ph > 0.1 && ph < 1.7) voxNode[c] = nearestOf(branches.LAD, c, (x, id) => Math.abs(nodes[id].zz - (zz - P.septalSpread)));   // septum (LAD perforators)
        else if (ph > -0.7 && ph <= 0.1) voxNode[c] = nearestOf(branches.PDA, c, zOnly);                                   // inferior septum (PDA)
        else voxNode[c] = nearestOf(lvSurface, c, uvcDist);
      }
      // nodal arteries (right-dominant): SA-node artery from the proximal RCA, AV-node artery from the crux
      // Only the main vessels are offered (LM trunk, LAD, LCx, RCA, PDA): the
      // side branches' territories go to the point where each branch leaves
      // its parent, so an occlusion proximal to that point still takes them.
      const MAIN = ['LM', 'LAD', 'LCx', 'RCA', 'PDA'];
      const mainOf = (id) => { while (id >= 0 && !MAIN.includes(nodes[id].branch)) id = nodes[id].parent; return id; };
      for (let c = 0; c < A.n; c++) if (voxNode[c] >= 0) voxNode[c] = mainOf(voxNode[c]);
      for (const b of Object.keys(branches)) if (!MAIN.includes(b)) delete branches[b];
      this.coronary = { nodes, branches, voxNode, sanNode: RCA[Math.min(2, RCA.length - 1)], avnNode: RCA[RCA.length - 1] };
    }

    // Flutter circuit geometry: every right-atrial voxel's angle around the
    // tricuspid annulus axis, measured from the cavotricuspid isthmus (the
    // IVC side) and increasing toward the septum (counterclockwise seen from
    // the apex); the isthmus cells; the start cells of the circuit.
    flutterGeometry() {
      if (this._flutter) return this._flutter;
      const A = this.A, lm = A.landmarks, tv = lm.TV, c0 = tv.c, n = tv.n;
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const inPlane = (v) => { const d = dot(v, n); const w = [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]; const l = Math.hypot(...w); return w.map((x) => x / l); };
      const e1 = inPlane(sub(lm.IVC.c, c0));                     // θ = 0 at the isthmus
      const sep = inPlane(sub(lm.MV.c, c0));
      let e2 = cross(n, e1); if (dot(e2, sep) < 0) e2 = e2.map((x) => -x);   // θ grows toward the septum
      const ang = new Float32Array(this.nVox).fill(NaN), radius = new Float32Array(this.nVox), isthmus = new Uint8Array(this.nVox), start = [];
      for (let c = 0; c < this.nVox; c++) {
        if (A.label[c] !== LAB.RA || this.kind[c] !== KIND.ATRIAL) continue;
        const d = sub(A.p(c), c0);
        let th = Math.atan2(dot(d, e2), dot(d, e1)); if (th < 0) th += 2 * Math.PI;
        ang[c] = th;
        const rr = Math.hypot(...sub(d, n.map((x) => x * dot(d, n)))); radius[c] = rr;
        if ((th < 0.5 || th > 2 * Math.PI - 0.3) && rr < tv.r + 14) isthmus[c] = 1;
        if (th > 0.05 && th < 0.2 && rr < tv.r + 10) start.push(c);
      }
      // LA cells away from the coronary-sinus ostium (entered over Bachmann's
      // bundle and the roof rather than from below)
      const upperLA = new Uint8Array(this.nVox), cs = A.p(this.csCell);
      for (let c = 0; c < this.nVox; c++) {
        if (A.label[c] !== LAB.LA || this.kind[c] !== KIND.ATRIAL) continue;
        if ((A.pos[3 * c] - cs[0]) ** 2 + (A.pos[3 * c + 1] - cs[1]) ** 2 + (A.pos[3 * c + 2] - cs[2]) ** 2 > 22 * 22) upperLA[c] = 1;
      }
      return (this._flutter = { ang, radius, isthmus, start, upperLA });
    }

    // Accessory pathway endpoints: the ventricular voxel on the AV ring in the
    // named direction from the valve centre (torso frame), and the nearest
    // voxel of the atrium across the ring.
    accessorySite(loc) {
      this._apSites = this._apSites || {};
      if (this._apSites[loc]) return this._apSites[loc];
      const A = this.A, lm = A.landmarks;
      const D = {   // torso-frame directions: X left, Y superior, Z anterior
        'left-lateral': ['MV', [1, 0, 0.1], LAB.LV, LAB.LA],
        'left-posterior': ['MV', [0.3, -0.2, -1], LAB.LV, LAB.LA],
        'posteroseptal': ['TV', [0.6, -0.3, -1], LAB.LV, LAB.RA],
        'right-free-wall': ['TV', [-1, 0, 0], LAB.RV, LAB.RA],
        'right-anteroseptal': ['TV', [0.5, 0.4, 1], LAB.RV, LAB.RA],
      }[loc];
      if (!D) throw new Error('unknown accessory pathway site ' + loc);
      const [valve, dir, vl, al] = D, ctr = this.toTorso(lm[valve].c), dl = Math.hypot(...dir);
      const nearAtrium = (c, r) => { const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let e = -r; e <= r; e++) { const w = A.at(i + a, j + b, k + e); if (w >= 0 && A.label[w] === al) return true; } return false; };
      let best = -1, bs = -Infinity;
      for (let c = 0; c < A.n; c++) {
        if (A.label[c] !== vl || A.zuvc[c] < 0.8) continue;
        const p = this.toTorso(A.p(c)), sc = ((p[0] - ctr[0]) * dir[0] + (p[1] - ctr[1]) * dir[1] + (p[2] - ctr[2]) * dir[2]) / dl;
        if (sc > bs && nearAtrium(c, 3)) { bs = sc; best = c; }
      }
      const a = A.nearest(A.p(best), (c) => A.label[c] === al);
      return (this._apSites[loc] = { v: best, a });
    }

    // is node `id` at or downstream of node `occl`?
    isDownstream(id, occl) {
      const N = this.coronary.nodes;
      for (let k = id; k >= 0; k = N[k].parent) if (k === occl) return true;
      return false;
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
        this.edge(c, id, seg === SEG.PURK_RV ? P.pmjRetroRV : P.pmjRetro, false);    // retrograde PMJ
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
      const R0 = new Array(9).fill(0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R0[3 * i + j] += Rz[3 * i + k] * Rx[3 * k + j];
      // then yaw about the torso's vertical axis (+ swings the apex from anterior toward the left)
      const ya = (P.heartYaw || 0) * Math.PI / 180, cy = Math.cos(ya), sy = Math.sin(ya);
      const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
      const Rm = new Array(9).fill(0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) Rm[3 * i + j] += Ry[3 * i + k] * R0[3 * k + j];
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
      let tfSample = null, tfScale = 1, tfMean = null;
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
        // heart-averaged (uniform) torso lead vectors, blended into the per-cell field by torsoUniform
        let nv = 0; for (let c = 0; c < n; c += 7) if (this.kind[c] === KIND.VENT) nv++;
        tfMean = [mul(mI, 1 / nv), mul(mII, 1 / nv)];
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
      this._lw = { TF, tfSample, tfScale, tfMean, E, axes, B, rhat, aniso, anorm, fwd, NE };
      const cc = new Float64Array(NE);
      for (let c = 0; c < n; c++) {
        const kc = this.kind[c]; if (!kc) continue;
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (let a = 0; a < 3; a++) {
          const w = A.at(i + (a === 0), j + (a === 1), k + (a === 2));
          if (w < 0 || this.kind[w] !== kc) continue;
          this.pairCoef(c, w, a, cc);
          for (let e = 0; e < NE; e++) { W[w * NE + e] += cc[e]; W[c * NE + e] -= cc[e]; }
        }
      }
      this.W = W; this.NE = NE;
    }

    // Lead-field coefficient of the voxel pair (c, w = c + axis a): the pair
    // adds out[e]·(Vm_w − Vm_c) to lead e (summation by parts of −σi∇Vm·∇L).
    pairCoef(c, w, a, out) {
      const A = this.A, h = A.h, kc = this.kind[c];
      const { TF, tfSample, tfScale, tfMean, E, axes, B, rhat, aniso, anorm, fwd } = this._lw;
      let sc = kc === KIND.VENT ? (aniso ? anorm : 1) * this.P.ventSourceGain : this.P.atrialSourceGain;
      // hypertrophied myocytes carry more intracellular current (source
      // strength ∝ conductance); scaling the pair keeps uniform plateaus silent
      if (kc === KIND.VENT && (this.P.lvSourceGain !== 1 || this.P.rvSourceGain !== 1)) {
        const g = (x) => (A.label[x] === LAB.RV ? this.P.rvSourceGain : this.P.lvSourceGain);
        sc *= Math.sqrt(g(c) * g(w));
      }
      const m = this.toTorso(lerp(A.p(c), A.p(w), 0.5));   // pair midpoint, torso frame
      let ex = axes[a];                                       // pair direction, torso frame
      // The heart turns in the chest by its apex swinging about the base, so the
      // atria (at the base) turn less than the ventricles: atrial source
      // directions are turned back by atrialFrontalRot in the frontal plane.
      if (kc !== KIND.VENT && this.P.atrialFrontalRot) {
        const al = this.P.atrialFrontalRot * Math.PI / 180, ca = Math.cos(al), sa = Math.sin(al);
        ex = [ca * ex[0] - sa * ex[1], sa * ex[0] + ca * ex[1], ex[2]];
      }
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
        out[9 + d] = cc;
      }
      // limb leads see the heart turned a further limbRotation degrees about the
      // AP axis (+ = more vertical), applied to source directions only
      let lex = ex, lff = ff, lrr = rr;
      // (ventricles only: the atrial P-wave calibration already has its own atrialFrontalRot)
      if (TF && this.P.limbRotation && kc === KIND.VENT) {
        const th = -this.P.limbRotation * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
        const rot = (v) => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
        lex = rot(ex); lff = rot(ff); lrr = rot(rr);
      }
      if (TF) for (let q = 0; q < 2; q++) {                    // bounded-torso limb leads I, II
        let Lv = tfSample(q ? TF._II : TF._I, m);
        const u = this.P.torsoUniform;
        if (u) Lv = [0, 1, 2].map((d) => (1 - u) * Lv[d] + u * tfMean[q][d]);
        if (q && kc !== KIND.VENT) Lv = Lv.map((x) => x * this.P.atrialTorsoII / this.P.torsoIIGain);   // torsoIIGain shortens lead II for ventricular sources only
        const cc = tfScale * h * h * sc * ((Lv[0] * lex[0] + Lv[1] * lex[1] + Lv[2] * lex[2]) + re * (Lv[0] * lrr[0] + Lv[1] * lrr[1] + Lv[2] * lrr[2]) + fe * (Lv[0] * lff[0] + Lv[1] * lff[1] + Lv[2] * lff[2]));
        out[12 + q] = cc;
      }
      for (let e = 0; e < 9; e++) {
        const rx = E[e][0] - m[0], ry = E[e][1] - m[1], rz = E[e][2] - m[2];
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const cc = h * h * sc * ((rx * ex[0] + ry * ex[1] + rz * ex[2]) + re * (rx * rr[0] + ry * rr[1] + rz * rr[2]) + fe * (rx * ff[0] + ry * ff[1] + rz * ff[2])) / (r * r * r);
        out[e] = cc;
      }
    }
  }

  // ST elevation of a transmural (not reperfused) infarct: maximal over the
  // first hours, still clear at 12 h, partly resolved at 2 days and back to
  // baseline within about two weeks (log-time interpolation)
  const ST_RESIDUAL = [[1, 1], [4, 0.95], [12, 0.8], [48, 0.45], [168, 0.15], [360, 0]];
  function stResidual(h) {
    if (h <= ST_RESIDUAL[0][0]) return 1;
    for (let i = 1; i < ST_RESIDUAL.length; i++) if (h <= ST_RESIDUAL[i][0]) {
      const [h0, v0] = ST_RESIDUAL[i - 1], [h1, v1] = ST_RESIDUAL[i];
      return v0 + (v1 - v0) * Math.log(h / h0) / Math.log(h1 / h0);
    }
    return 0;
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
  const RING = 8192;
  const HRING = 2048;   // repolarisation histogram ring (ms): ≥ longest APD + window
  const FLAT = 100;     // piece/event id: flat plateau after the APD (convolution path); FLAT + 1: end
  const REP_SEG = 8;  // straight segments per repolarisation (ECG running sums)  // ms horizon of the arrival queue

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
      this.apdMax0 = this.apdMax.slice(); this.vAmp0 = this.vAmp.slice();               // healthy values, restored when ischemia changes
      this.vRest0 = this.vRest.slice();
      this.pDecl = new Float32Array(N).fill(this.P.plateauDecline);                       // per-cell plateau slope (Brugada: delayed dome)
      this._apdBase = this.apdMax0.slice(); this._vAmpBase = this.vAmp0.slice();           // before pericarditis / Brugada
      this.pericarditis = false; this.brugada = false;
      this.insults = []; this.ischemiaHours = 0; this._ischCells = new Set(); this._nextInsult = 1;
      // ECG bookkeeping. Cells in upstroke or repolarisation are summed
      // explicitly ("dynamic" list); cells on the plateau have Vm linear in t
      // and are folded into two running sums per electrode (see _ecg).
      this.dyn = new Int32Array(N); this.nDyn = 0; this.dynPos = new Int32Array(N).fill(-1);
      this.piece = new Uint8Array(N);                 // current linear piece: 0 none, 1 plateau, 2+j repolarisation segment j
      this.pk0 = new Float64Array(N); this.pk1 = new Float64Array(N);
      this.gen = new Uint32Array(N);                  // activation counter (stale-event guard)
      // repolarisation by convolution: each cell adds W·a once at its repolarisation
      // start τ (histogram per kernel); every step convolves with the fixed smoothstep
      this.hTau = new Int32Array(N).fill(-1e9); this.hAmp = new Float32Array(N); this.hKer = new Uint8Array(N);
      this.H = [new Float64Array(HRING * model.NE), new Float64Array(HRING * model.NE)];   // [ventricular, atrial]
      const ker = (w) => Float64Array.from({ length: w }, (_, x) => { const u = x / w; return u * u * (3 - 2 * u); });
      this.K = [ker(Math.round(this.P.repWVent)), ker(Math.round(this.P.repWAtrial))];
      this.tbuckets = Array.from({ length: RING }, () => []);
      this.W = model.W;                                  // lead weights (copied when necrosis uncouples tissue)
      this.S0 = new Float64Array(model.NE); this.S1 = new Float64Array(model.NE);
      this.leadsLatest = new Float32Array(12);
      this.listeners = [];
      this.pacemakers = []; this.drivers = [];
      this.setRate(this.P.sinusRate);
      // Subsidiary pacemakers are source-dependent: each takes over only when
      // conduction from above it is interrupted, never because the sinus rate
      // is merely slow.
      //   junctional  — sinus node blocked/arrested, or block within the AV node
      //   ventricular — block below the AV node (His bundle, or both bundle branches)
      const anyBlocked = (ids) => ids.some((c) => this.blocked[c]);
      const M = model, cs = M.csSegments;
      this._addPacemaker(M.junctionalCell, 60000 / this.P.junctionalRate, 'junctional',
        () => this.blocked[M.sanCell] || this.sinusArrest || this.t < this.sinusPauseUntil || anyBlocked(M.avn));
      // Conduction to the ventricles is lost with His block or block of every
      // ventricular route: RBB plus LBB, or RBB plus both left fascicles.
      const allDistal = () => anyBlocked(cs.RBB) && (anyBlocked(cs.LBB) || (anyBlocked(cs.LAF) && anyBlocked(cs.LPF)));
      this._addPacemaker(M.ventEscapeCell, 60000 / this.P.ventEscapeRate, 'ventricular',
        () => anyBlocked(cs.HIS) || (anyBlocked(cs.LBB) && anyBlocked(cs.RBB)));
      // idioventricular pacemaker in the LV Purkinje network, below every blockable segment
      this._addPacemaker(M.idioCell, 60000 / this.P.idioventricularRate, 'idioventricular',
        () => allDistal() && anyBlocked(cs.LPF));
      // beat bookkeeping for interval measurement
      this.log = { atrial: [], vent: [] };
      this.blockLog = [];  // impulses stopped by a fixed-ratio/intermittent block {t, at}
      this.fireLog = [];   // spontaneous pacemaker discharges {name, t}
      this.stimLog = [];   // external stimuli {t, cell, kind, captured}
      this.blocks = {};    // active conduction blocks by structure: {SAN, AVN, HIS, LBB, RBB, LAF, LPF}
      this.gates = new Map();   // cell -> {mode, n, count}: fixed-ratio / pattern conduction
      this.sinusPauseUntil = -1; this.saExit = null; this.avnBlockMul = 1;
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
          // hypertrophy "strain": the transmural repolarisation gradient
          // reverses (epicardium repolarises last), inverting the T wave
          const strain = A.label[c] === LAB.RV ? P.rvStrain : P.lvStrain;
          apd = P.apdVent + P.apdVentEndoExtra * (1 - 2 * strain) * (0.5 - tm) + P.apdVentApexExtra * (0.5 - zz);
          if (A.label[c] === LAB.RV) apd += P.apdRVoffset;
          this.repW[c] = P.repWVent;
        } else if (k === KIND.ATRIAL) { apd = P.apdAtrial; this.repW[c] = P.repWAtrial; }
        else if (k === KIND.PURK || k === KIND.BUNDLE || k === KIND.HIS) {
          // His–Purkinje refractoriness: right bundle longest (classic RBBB aberrancy)
          apd = M.seg[c] === SEG.RBB ? P.apdRBB : k === KIND.PURK ? P.apdPurk : P.apdBundle;
          this.repW[c] = P.repWVent;
        }
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
      // the reference beat depends only on the model: compute once, reuse for every Sim (Reset)
      const memo = this.M._memory;
      if (memo) { this.refAT = memo.refAT; for (let c = 0; c < memo.refAT.length; c++) if (memo.refAT[c] >= 0) this.apdMax[c] -= memo.delta[c]; return; }
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
      const delta = new Float32Array(M.nVox);
      for (let c = 0; c < M.nVox; c++) if (this.refAT[c] >= 0) delta[c] = k * (this.refAT[c] - mean);
      M._memory = { refAT: this.refAT, delta };
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
      this._avnTone = Math.pow(72 / bpm, this.P.avnToneExp);
      this._applyAvn();
      const cl = 60000 / bpm * (1 + this.P.ischSanSlow * (this._sanIschemia || 0));   // SA-node ischaemia slows the sinus rate
      const pm = this.pacemakers.find((p) => p.name === 'sinus');
      if (pm) pm.cl = cl; else this.pacemakers.unshift({ cell: this.M.sanCell, cl, name: 'sinus' });
    }

    // ---- Conduction blocks ---------------------------------------------------
    // Block types by structure (the UI offers the ones listed for each site):
    //   SAN: 'sa-exit' (2nd-degree SA exit block, n:n−1), 'pause' (one sinus pause), 'arrest'
    //   AVN: 'first' (1st degree), 'wenckebach' (Mobitz I), 'two-to-one', 'complete'
    //   HIS: 'mobitz2' (infranodal intermittent, n:n−1), 'complete'
    //   LBB, RBB, LAF, LPF: 'complete'
    setBlock(site, type, opts = {}) {
      const M = this.M, P = this.P, cs = M.csSegments;
      const cells = site === 'SAN' ? [M.sanCell] : site === 'AVN' ? M.avn : cs[site];
      // clear what this site had
      for (const c of cells) { this.blocked[c] = 0; this.gates.delete(c); }
      if (site === 'SAN') { this.saExit = null; this.sinusArrest = false; this.sinusPauseUntil = -1; }
      if (site === 'AVN') { this.avnBlockMul = 1; for (const c of M.avn) { this.erpExtra[c] = P.avnErpExtra; this.cvK[c] = P.avnCvRestK; this.cvTau[c] = P.avnCvRestTau; } }
      delete this.blocks[site];
      if (!type) { this._applyAvn(); return; }
      this.blocks[site] = { type, ...opts };
      const gate = (cell, mode, n) => this.gates.set(cell, { mode, n, count: 0, site });
      if (site === 'SAN') {
        if (type === 'sa-exit') this.saExit = { n: opts.n || 3, count: 0 };
        else if (type === 'pause') { this.sinusPauseUntil = this.t + (opts.ms || 2800); }
        else if (type === 'arrest') this.sinusArrest = true;
      } else if (site === 'AVN') {
        if (type === 'first') this.avnBlockMul = P.avnFirstDegreeMul;
        else if (type === 'wenckebach') {
          // Diseased AV node described by its recovery curve: nodal conduction
          // time grows as the recovery time since the previous His activation
          // shortens, and fails below R_eff. Longer conduction leaves less
          // recovery for the next beat, so PR lengthens until a P is blocked.
          this.gates.set(M.avn[0], { mode: 'av-recovery', site: 'AVN', count: 0 });
        } else if (type === 'two-to-one') gate(M.avn[0], 'conduct-1-of', 2);
        else if (type === 'complete') for (const c of M.avn) this.blocked[c] = 1;
      } else if (site === 'HIS') {
        if (type === 'mobitz2') gate(cs.HIS[1], 'drop-1-of', opts.n || 4);
        else if (type === 'complete') for (const c of cs.HIS) this.blocked[c] = 1;
      } else if (type === 'complete') for (const c of cells) this.blocked[c] = 1;
      this._applyAvn();
    }
    clearBlocks() { for (const s of Object.keys(this.blocks)) this.setBlock(s, null); }
    _applyAvn() {
      const tone = this._avnTone || 1;
      for (const c of this.M.avn) {
        this.cvMul[c] = tone * (this.avnBlockMul || 1) * (1 + this.P.ischAvnSlow * (this._avnIschemia || 0));
        // nodal refractoriness also follows autonomic tone (vagal lengthens, sympathetic shortens)
        // (AV-nodal ischaemia also lengthens nodal refractoriness: 1st-degree block, Wenckebach)
        if (this.erpExtra) this.erpExtra[c] = this.P.avnErpExtra * tone * (1 + this.P.ischAvnErp * (this._avnIschemia || 0));
      }
      // slow pathway: same autonomic coupling, short refractoriness; open only
      // with dual AV-node physiology and no AV-nodal block
      for (const c of this.M.avnSlow || []) {
        this.cvMul[c] = tone * (1 + this.P.ischAvnSlow * (this._avnIschemia || 0));
        if (this.erpExtra) this.erpExtra[c] = this.P.slowPathErpExtra * tone;
        if (this.cvK) this.cvK[c] = this.P.slowPathCvK;
        // (an ischaemic AV node conducts no slow-pathway echoes: inferior MI gives AV block, not AVNRT)
        this.blocked[c] = this.dualAVN && !this.blocks.AVN && !(this._avnIschemia > 0.05) ? 0 : 1;
      }
    }
    setDualAVN(on) { this.dualAVN = !!on; this._applyAvn(); }
    // One decision per beat: a site is reached by several converging
    // wavelets within a few ms; they all share the first one's fate.
    _gatePass(g, ta) {
      if (g.lastT !== undefined && ta - g.lastT < 120) return g.last;
      if (g.mode === 'av-recovery') {
        const P = this.P, M = this.M, R = ta - this.tAct[M.his[0]];   // recovery since last nodal output
        g.lastT = ta;
        if (R < P.wkReff) { g.last = false; return false; }
        const ah = P.wkAHmin + P.wkAlpha * Math.exp(-(R - P.wkReff) / P.wkTau);
        // spread the required nodal delay over the AV-node segments for this beat
        const mul = ah / (P.avnSegDelay * (M.avn.length - 1));
        for (const c of M.avn) this.cvMul[c] = mul;
        g.last = true; return true;
      }
      g.count++; g.lastT = ta;
      g.last = g.mode === 'conduct-1-of' ? g.count % g.n === 1 % g.n    // conducts 1 of every n
        : g.count % g.n !== 0;                                            // drops 1 of every n
      return g.last;
    }

    // ---- Atrial enlargement -------------------------------------------------
    // A dilated, hypertrophied atrium carries more electrically active muscle
    // (stronger sources) over a longer path (later activation). RA enlargement
    // raises the early (right-atrial) part of the P wave: tall, peaked P in II.
    // LA enlargement adds slow interatrial conduction through Bachmann's bundle
    // and a slower, stronger LA: broad notched P in II and a deep terminal
    // negative P in V1.
    setAtrialEnlargement({ ra = false, la = false } = {}) {
      const M = this.M, A = M.A, P = this.P;
      this.atria = { ra, la };
      // LA enlargement: slow conduction from the right atrium into the left
      // across every connection (Bachmann's bundle and the inferior ones), so
      // the LA fires later as a separate wave: the second hump of a notched P
      // wave. (Only RA→LA: the way back meets refractory RA, so no re-entry.)
      if (!this._atrialSide) { this._atrialSide = new Int8Array(M.nVox); for (let c = 0; c < M.nVox; c++) if (M.kind[c] === KIND.ATRIAL) this._atrialSide[c] = A.label[c] === LAB.RA ? 1 : -1; }
      this._iaSlow = la ? P.laeInteratrialEdgeSlow : 0;
      for (let c = 0; c < M.nVox; c++) {
        if (M.kind[c] !== KIND.ATRIAL) continue;
        const isRA = A.label[c] === LAB.RA, on = isRA ? ra : la;
        this.vAmp[c] = P.vAmp * (on ? (isRA ? P.raeGain : P.laeGain) : 1);
        let cv = on ? (isRA ? P.raeSlow : P.laeSlow) : 1;
        // interatrial conduction delay: Bachmann's bundle and any fast tract tissue on the LA side
        if (la && (M.seg[c] === SEG.BACHMANN || (!isRA && M.seg[c] === SEG.CRISTA))) cv *= P.laeBachmannSlow;
        if (la && this._interatrial()[c]) cv *= P.laeInteratrialSlow;
        this.cvMul[c] = cv;
      }
      this._rebuildPlateauSums();
    }

    // atrial cells near the inferior interatrial connections (CS ostium / fossa)
    _interatrial() {
      const M = this.M, A = M.A;
      if (M._interatrialNear) return M._interatrialNear;
      const near = new Uint8Array(M.nVox), r2 = this.P.laeInteratrialMm ** 2;
      for (const site of M.interatrialSites) for (const c of site) {
        const p = A.p(c);
        for (let q = 0; q < M.nVox; q++) {
          if (A.label[q] !== LAB.LA || M.seg[q] === SEG.BACHMANN) continue;   // LA side only (the AV-node approaches stay normal)
          if ((A.pos[3 * q] - p[0]) ** 2 + (A.pos[3 * q + 1] - p[1]) ** 2 + (A.pos[3 * q + 2] - p[2]) ** 2 < r2) near[q] = 1;
        }
      }
      return (M._interatrialNear = near);
    }

    // ---- Myocardial ischemia ------------------------------------------------
    // Insults: a coronary occlusion (everything downstream of a tree node,
    // transmural) or a subendocardial region around a clicked cell. Each
    // affected cell gets a severity s (1 in the core, tapering to the border
    // zone). setIschemiaTime(h) then sets each cell's electrophysiology for
    // h hours after onset (see _ischemicState); the ECG follows on its own.
    addOcclusion(node) {
      const M = this.M, A = M.A, vn = M.coronary.voxNode, aff = new Uint8Array(A.n);
      for (let c = 0; c < A.n; c++) if (vn[c] >= 0 && M.isDownstream(vn[c], node)) aff[c] = 1;
      const ins = this._makeInsult('occlusion', aff, this.P.ischBorderMm);
      ins.node = node; ins.branch = M.coronary.nodes[node].branch;
      ins.nodal = { san: M.isDownstream(M.coronary.sanNode, node), avn: M.isDownstream(M.coronary.avnNode, node) };
      return this._addInsult(ins);
    }
    // a patch of the clicked wall (same chamber, nearby in the ventricular
    // coordinates, so the opposite wall across the cavity is not included)
    addSubendocardial(cell, radiusMm = 28) {
      const A = this.M.A, aff = new Uint8Array(A.n), p = A.p(cell), L = A.label[cell], ph0 = A.phi[cell], z0 = A.zuvc[cell];
      for (let c = 0; c < A.n; c++) {
        if (A.label[c] !== L) continue;
        if ((A.pos[3 * c] - p[0]) ** 2 + (A.pos[3 * c + 1] - p[1]) ** 2 + (A.pos[3 * c + 2] - p[2]) ** 2 > radiusMm * radiusMm) continue;
        let dp = Math.abs(A.phi[c] - ph0); if (dp > Math.PI) dp = 2 * Math.PI - dp;
        if (dp < this.P.subendoSpanPhi && Math.abs(A.zuvc[c] - z0) < this.P.subendoSpanZ) aff[c] = 1;
      }
      const ins = this._makeInsult('subendo', aff, radiusMm * 0.45);
      if (L === LAB.RV) for (let q = 0; q < ins.sev.length; q++) ins.sev[q] *= this.P.subendoRVGain;   // thin, low-pressure RV: milder demand ischaemia
      ins.cell = cell;
      return this._addInsult(ins);
    }
    // ---- Pericarditis and Brugada syndrome ------------------------------------
    // Acute pericarditis: the inflamed epicardium (outer ventricular layer and
    // the atrial epicardium) is injured: depolarised at rest and with a lower
    // plateau. The injury current points outward everywhere: diffuse ST
    // elevation with ST depression in aVR (and V1), and PR depression from the
    // atrial injury current (PR elevation in aVR).
    // Brugada type 1: the right-ventricular outflow-tract epicardium loses the
    // dome of its action potential (Ito-mediated) and repolarises late: coved
    // ST elevation in V1–V2 descending into a negative T wave.
    setPericarditis(on) { this.pericarditis = !!on; this._applyMyocardialDisease(); }
    setBrugada(on) { this.brugada = !!on; this._applyMyocardialDisease(); }
    _applyMyocardialDisease() {
      const M = this.M, A = M.A, P = this.P;
      // Brugada substrate: the anterior RV outflow epicardium under V1–V2
      // (the RV epicardial cell nearest the V1–V2 midpoint, in the torso frame)
      if (!this._brugadaC) {
        const e1 = M.electrodes.V1, e2 = M.electrodes.V2, mid = [0, 1, 2].map((i) => (e1[i] + e2[i]) / 2);
        let best = -1, bd = Infinity;
        for (let c = 0; c < M.nVox; c++) if (A.label[c] === LAB.RV && A.epi[c]) { const t = M.toTorso(A.p(c)); const d = Math.hypot(t[0] - mid[0], t[1] - mid[1], t[2] - mid[2]); if (d < bd) { bd = d; best = c; } }
        this._brugadaC = A.p(best);
      }
      const puv = this._brugadaC;
      for (let c = 0; c < M.nVox; c++) {
        const k = M.kind[c]; if (!k) continue;
        let amp = 1, apd = 1, dv = 0;
        if (k === KIND.VENT) {
          const outer = A.label[c] === LAB.RV ? (A.epi[c] ? 1 : 0) : Math.max(0, Math.min(1, (A.tm[c] - P.pericardDepth) / (1 - P.pericardDepth)));
          const peri = this.pericarditis && outer > 0;
          if (peri) { dv += P.pericardDv * outer; amp *= 1 - P.pericardAmpDrop * outer; }
          if (this.brugada && A.label[c] === LAB.RV && A.epi[c]) {
            const d = Math.hypot(A.pos[3 * c] - puv[0], A.pos[3 * c + 1] - puv[1], A.pos[3 * c + 2] - puv[2]);
            const w = Math.max(0, Math.min(1, (P.brugadaMm - d) / 8));
            amp *= 1 - P.brugadaDomeLoss * w; apd *= 1 + P.brugadaApdLong * w;
          }
          // notch with a delayed dome: the plateau starts low and climbs back to
          // near-normal height (negative slope), so the ST gap closes into a coved shape
          // (pericarditis: the inflamed epicardial plateau starts low and partly recovers
          // (negative slope), so ST elevation is highest at the J point, sags mid-ST and
          // rises again into the T wave: the concave-upward "saddle")
          this.pDecl[c] = amp < 1 && this.brugada && A.label[c] === LAB.RV ? 1 - (1 - P.plateauDecline) / amp
            : peri ? P.plateauDecline + P.pericardSag * outer : P.plateauDecline;
          this.vAmp0[c] = this._vAmpBase[c] * amp; this.apdMax0[c] = this._apdBase[c] * apd;
          if (!this._ischCells.has(c)) { this.vAmp[c] = this.vAmp0[c]; this.apdMax[c] = this.apdMax0[c]; }
        } else if (k === KIND.ATRIAL) {
          // inflamed atrial epicardium: depolarised, with a sagging plateau (atrial injury current → PR depression)
          const on = this.pericarditis && A.epi[c];
          if (on) dv += P.pericardAtrialDv;
          this.pDecl[c] = on ? P.pericardAtrialDecline : P.plateauDecline;
        }
        this.vRest0[c] = P.vRest + dv;
        if (!this._ischCells.has(c)) this.vRest[c] = this.vRest0[c];
      }
      this._applyIschemia();
    }

    removeInsult(id) { this.insults = this.insults.filter((x) => x.id !== id); this._applyIschemia(); }
    clearIschemia() { this.insults = []; this._applyIschemia(); }
    setIschemiaTime(h) { this.ischemiaHours = h; this._applyIschemia(); }

    // severity: distance (mm) into the affected region from its edge, smoothed
    _makeInsult(kind, aff, borderMm) {
      const A = this.M.A, n = A.n, dist = new Float32Array(n).fill(Infinity), q = [];
      for (let c = 0; c < n; c++) {
        if (!aff[c]) continue;
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (const [a, b, e] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const w = A.at(i + a, j + b, k + e);
          if (w >= 0 && !aff[w] && (A.label[w] === LAB.LV || A.label[w] === LAB.RV)) { dist[c] = A.h; q.push(c); break; }
        }
      }
      for (let qi = 0; qi < q.length; qi++) {               // BFS inward from the edge
        const c = q[qi], i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (const [a, b, e] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const w = A.at(i + a, j + b, k + e);
          if (w >= 0 && aff[w] && dist[w] > dist[c] + A.h) { dist[w] = dist[c] + A.h; q.push(w); }
        }
      }
      const cells = [], sev = [];
      for (let c = 0; c < n; c++) if (aff[c]) {
        const d = isFinite(dist[c]) ? dist[c] : borderMm * 2, x = Math.min(1, d / borderMm);
        cells.push(c); sev.push(0.35 + 0.65 * x * x * (3 - 2 * x));
      }
      // the zone of ischaemia around an infarct (living muscle within ischHaloMm
      // of the territory): its prolonged repolarisation inverts the T waves
      const halo = [], hw = [];
      if (kind === 'occlusion' && this.P.ischHaloMm > 0) {
        const hd = new Float32Array(n).fill(Infinity), hq = [];
        for (let c = 0; c < n; c++) if (aff[c]) { hd[c] = 0; hq.push(c); }
        for (let qi = 0; qi < hq.length; qi++) {
          const c = hq[qi], i = A.ii[c], j = A.jj[c], k = A.kk[c];
          for (const [a, b, e] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const w = A.at(i + a, j + b, k + e);
            if (w < 0 || aff[w] || (A.label[w] !== LAB.LV && A.label[w] !== LAB.RV)) continue;
            const d = hd[c] + A.h; if (d >= hd[w] || d > this.P.ischHaloMm) continue;
            hd[w] = d; hq.push(w);
          }
        }
        for (let c = 0; c < n; c++) if (!aff[c] && isFinite(hd[c])) { halo.push(c); hw.push(1 - hd[c] / this.P.ischHaloMm); }
      }
      return { kind, cells: Int32Array.from(cells), sev: Float32Array.from(sev), halo: Int32Array.from(halo), haloW: Float32Array.from(hw) };
    }
    _addInsult(ins) { ins.id = this._nextInsult++; this.insults.push(ins); this._applyIschemia(); return ins.id; }

    // Cell state h hours after onset for severity s and transmural depth tm.
    // Returns {apd, vRest, amp, cv, dead} multipliers/values.
    _ischemicState(s, tm, h, kind) {
      const P = this.P, sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      if (kind === 'subendo') s *= 1 - sm((tm - 0.12) / 0.2);                // confined to the inner wall
      if (s <= 0.01) return null;
      // minutes: K-ATP APD shortening (hyperacute T), gone once the cells have died or recovered (~1 day)
      const katp = sm(h / P.ischKatpH) * (1 - sm((h - 6) / 18));
      // injury current: develops over half an hour, eases after a few hours, gone by ~2 days (ST back to baseline)
      const inj = Math.min(1, s * (kind === 'subendo' ? P.ischSubendoGain : 1)) * (kind === 'subendo' ? P.subendoInj : 1) * sm((h - P.ischInjuryOnset) / P.ischInjuryH)
        * (kind === 'subendo' ? (1 - P.ischStResolve * sm((h - 3) / 5)) * (1 - sm((h - 12) / 30)) : stResidual(h));
      let apd = 1 - P.ischApdShort * s * katp;
      // prolonged repolarisation in the surviving border: T inversion from ~6 h, deepest at 1–3 days,
      // fading over the following weeks (T waves upright again in an old infarct)
      const late = sm((h - P.ischLateH) / 3) * (1 + 0.8 * sm((h - 12) / 30)) * (1 - P.ischTRecover * sm((h - 200) / 400));
      if (kind !== 'subendo') apd *= 1 + P.ischApdLate * Math.min(1, s + 0.3) * late;   // (inner-wall prolongation would only steepen the normal gradient: tall T)
      // necrosis advances from endocardium to epicardium (wavefront phenomenon)
      // (the innermost layer, fed from the cavity blood, survives with the Purkinje junctions)
      const front = sm((h - 0.4) / P.ischNecrosisH) * (kind === 'subendo' ? 0.4 : P.ischFrontMax);
      const dead = s > P.ischDeadS && (tm > 0.06 || (h > 8 && kind !== 'subendo')) && tm < front;   // (the inner layer is lost too once a transmural infarct is complete; under a subendocardial one it survives on cavity blood)
      // the surviving epicardial rim over a completed infarct is drawn as part of
      // the infarct (it stays electrically alive)
      const rim = !dead && kind !== 'subendo' && s > P.ischDeadS && tm >= front && sm((h - 0.4) / P.ischNecrosisH) > 0.98;
      // severely injured (depolarised) muscle ahead of the necrosis front stops
      // conducting (sodium-channel inactivation) while it still drives injury current
      const unexcitable = !dead && kind !== 'subendo' && h >= 2 && s > P.ischDeadS && inj > P.ischBlockInj;
      return {
        apd, dead, rim, unexcitable, level: Math.max(inj, 0.5 * s * katp),
        // necrotic muscle stays depolarised (and partly coupled, see _uncoupleDead) until it turns to scar
        vRest: dead ? P.vRest + P.ischDvRest * (kind === 'subendo' ? 0 : stResidual(h)) : P.vRest + P.ischDvRest * inj,
        amp: dead ? 0 : 1 - P.ischAmpDrop * inj,
        cv: 1 + P.ischCvSlow * inj,
      };
    }

    _applyIschemia() {
      const M = this.M, A = M.A, P = this.P, h = this.ischemiaHours;
      const lvl = this.ischLevel || (this.ischLevel = new Float32Array(A.n));   // display: 0 healthy, (0,1] ischaemic, 2 necrotic
      for (const c of this._ischCells) {                                     // restore healthy values
        lvl[c] = 0; this.apdMax[c] = this.apdMax0[c]; this.vRest[c] = this.vRest0[c]; this.vAmp[c] = this.vAmp0[c]; this.cvMul[c] = 1; this.blocked[c] = 0;
      }
      this._ischCells = new Set();
      const best = new Map();                                                // strongest insult per cell
      for (const ins of this.insults) for (let q = 0; q < ins.cells.length; q++) {
        // transmural depth: the thin RV wall has none in the model; occlusions treat
        // it as mid-wall (it dies through its thickness), subendocardial patches
        // take its inner layers (everything off the epicardial surface)
        const c = ins.cells[q], rv = A.label[c] === LAB.RV, tm = rv ? (ins.kind === 'subendo' ? (A.epi[c] ? 1 : 0.05) : 0.5) : A.tm[c] < 0 ? 0.5 : A.tm[c];
        const st = this._ischemicState(ins.sev[q], tm, h, ins.kind);
        if (!st) continue;
        const prev = best.get(c);
        if (!prev || st.vRest > prev.vRest || st.dead) best.set(c, st);
      }
      // Living ischaemic muscle cut off from healthy tissue by necrosis cannot
      // be activated and does not survive: it joins the infarct (otherwise it
      // would sit at rest beside depolarised tissue as a permanent injury current).
      if (h > 0.4) {
        const reach = new Uint8Array(M.nCells), q = [];
        for (let c = 0; c < M.nVox; c++) if (M.kind[c] === KIND.VENT && !best.has(c)) { reach[c] = 1; q.push(c); }
        for (let qi = 0; qi < q.length; qi++) {
          const c = q[qi];
          for (let e = M.start[c]; e < M.start[c + 1]; e++) {
            const w = M.nbr[e]; if (reach[w] || w >= M.nVox) continue;
            const st = best.get(w); if (!st || st.dead) continue;
            reach[w] = 1; q.push(w);
          }
        }
        for (const [c, st] of best) if (!st.dead && !reach[c] && M.kind[c] === KIND.VENT) { st.dead = true; st.vRest = P.vRest; st.amp = 0; }
      }
      let nDead = 0;
      for (const [c, st] of best) {
        this.apdMax[c] = this.apdMax0[c] * st.apd; this.vRest[c] = st.vRest; this.vAmp[c] = this.vAmp0[c] * st.amp;
        this.cvMul[c] = st.cv; this.blocked[c] = st.dead || st.unexcitable ? 1 : 0; this._ischCells.add(c);
        lvl[c] = st.dead || st.rim ? 2 : st.level;   // (display only: 2 = necrotic)
        if (st.dead) nDead++;
      }
      this.nDead = nDead;
      // zone of ischaemia around the infarct: late APD prolongation (T inversion), same time course
      const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      const lateF = sm((h - P.ischLateH) / 3) * (1 + 0.8 * sm((h - 12) / 30)) * (1 - P.ischTRecover * sm((h - 200) / 400));
      if (lateF > 0) for (const ins of this.insults) if (ins.halo) for (let q = 0; q < ins.halo.length; q++) {
        const c = ins.halo[q]; if (best.has(c)) continue;
        const f = 1 + P.ischHaloLate * ins.haloW[q] * lateF;
        if (this.apdMax0[c] * f > this.apdMax[c]) { this.apdMax[c] = this.apdMax0[c] * f; this._ischCells.add(c); }
      }
      this._uncoupleDead();
      // nodal arteries: proximal RCA occlusion slows the sinus node and the AV node
      // (nodal ischaemia recovers over the first days)
      const nodalT = Math.min(1, h / 0.5) * (1 - Math.min(1, Math.max(0, (h - 48) / 96)));
      const inj = this.insults.some((x) => x.nodal && x.nodal.san) ? nodalT : 0;
      const avn = this.insults.some((x) => x.nodal && x.nodal.avn) ? nodalT : 0;
      this._sanIschemia = inj; this._avnIschemia = avn;
      this.setRate(this.sinusBpm);
      this.invalidateBaseline(); this._rebuildPlateauSums(); this._hpReset = true;
    }

    // Necrotic cells lose their gap junctions. A cell that cannot fire but is
    // still coupled would act as a current sink next to every depolarised
    // neighbour (a permanent injury source); uncoupled, it is electrically
    // silent and its absence from the QRS leaves a Q wave. The coupling of
    // each necrotic/living voxel pair is removed from the lead weights
    // (fraction ischUncouple; the remainder keeps some ST elevation).
    _uncoupleDead() {
      // coupling loss grows as the necrotic zone turns to scar (complete by ~2 days)
      const h = this.ischemiaHours, sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      const M = this.M, A = M.A, NE = M.NE, u = 1 - (1 - this.P.ischUncouple) * stResidual(h);
      if (!this.nDead) { this.W = M.W; return; }
      const W = this.W = M.W.slice(), cc = new Float64Array(NE);
      for (const c of this._ischCells) {
        if (!this.blocked[c]) continue;
        const i = A.ii[c], j = A.jj[c], k = A.kk[c];
        for (let a = 0; a < 3; a++) for (const sg of [1, -1]) {
          const w = A.at(i + sg * (a === 0), j + sg * (a === 1), k + sg * (a === 2));
          if (w < 0 || M.kind[w] !== KIND.VENT || this.blocked[w]) continue;
          const lo = sg > 0 ? c : w, hi = sg > 0 ? w : c;           // pairs are stored low → high along the axis
          M.pairCoef(lo, hi, a, cc);
          for (let e = 0; e < NE; e++) { W[hi * NE + e] -= u * cc[e]; W[lo * NE + e] += u * cc[e]; }
        }
      }
    }

    // plateau running sums use per-cell amplitude: rebuild after parameters change
    _rebuildPlateauSums() {
      this.S0.fill(0); this.S1.fill(0);
      this.pk0.fill(0); this.pk1.fill(0);
      for (let c = 0; c < this.M.nVox; c++) if (this.piece[c]) this._setPiece(c, this.piece[c]);
      for (const H of this.H) H.fill(0);
      for (let c = 0; c < this.M.nVox; c++) if (this.hTau[c] + this.K[this.hKer[c]].length > this.t) this._histAdd(c, 1);
    }

    // ---- External stimulation (clicks now; pacing leads later) ---------------
    // Captures only if the tissue is excitable; logged so the interpreter can
    // label the beat (PAC / PVC) and the UI can flash the site.
    stimulate(c, time = this.t) {
      const t = Math.max(time, this.t), k = this.M.kind[c];
      const kind = k === KIND.ATRIAL ? 'atrial' : k === KIND.VENT ? 'ventricular' : 'conduction';
      const rec = { t, cell: c, kind, captured: false };
      this.stimLog.push(rec); if (this.stimLog.length > 40) this.stimLog.shift();
      if (this.blocked[c] || t < this.refEnd[c]) return rec;      // refractory: no capture
      this.schedule(c, t); this._pendingStim = rec;
      if (k === KIND.VENT && this.vulnerable()) {
        const vb = this.log.vent[this.log.vent.length - 1];
        if (vb && t > vb.on + 0.6 * (vb.repEnd - vb.on) && t < vb.repEnd + 20) { this._pendingRonT = c; rec.ronT = true; }
      }
      return rec;
    }

    // ---- Arrhythmias ---------------------------------------------------------
    // Sustained arrhythmias are produced by drivers placed in the tissue: the
    // activation they launch spreads, collides, meets refractory tissue and
    // reaches the ventricles through the AV node like any other wave, so the
    // ventricular response, the ECG and the AV relationship all emerge.
    //   af      — many left- and right-atrial foci firing at random short cycle
    //             lengths: multiple wavelets, irregular AV-nodal penetration
    //   flutter — a stimulus circulating around the tricuspid ring (typical,
    //             counterclockwise: up the septum, down the free wall)
    //   ectopic — one low right-atrial focus (near the coronary-sinus ostium)
    //             replacing the sinus node at the sinus rate: inverted P in the
    //             inferior leads, short PR
    //   mat     — four atrial foci taking turns irregularly at the set atrial rate (±25%)
    //   vt      — one ventricular focus at a fixed fast rate (monomorphic VT)
    //   vf      — many ventricular foci at random short cycle lengths
    startArrhythmia(type, opts = {}) {
      const M = this.M, A = M.A, P = this.P, r = this.rand;
      this.stopArrhythmia();
      const pick = (f, n) => { const pool = []; for (let c = 0; c < M.nVox; c++) if (f(c)) pool.push(c); const out = []; for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return out; };
      const atrial = (lab) => (c) => M.kind[c] === KIND.ATRIAL && A.label[c] === lab && !M.seg[c];
      const vent = (c) => M.kind[c] === KIND.VENT;
      const rand = (a, b) => () => a + (b - a) * r();
      if (type === 'af') {
        const foci = pick(atrial(LAB.LA), P.afFociLA).concat(pick(atrial(LAB.RA), P.afFociRA));
        for (const c of foci) this.drivers.push({ kind: 'focus', cell: c, next: this.t + r() * 150, cl: rand(P.afClMin, P.afClMax) });
      } else if (type === 'flutter') {
        // Typical flutter is macro-re-entry around the tricuspid annulus. The
        // circuit is enforced by letting right-atrial tissue conduct only one
        // way around the annulus (counterclockwise seen from the apex: up the
        // septum, down the free wall; clockwise reverses it), with slower
        // conduction in the circuit (most of all in the cavotricuspid
        // isthmus). One stimulus at the isthmus then circulates by itself;
        // the left atrium follows passively through the interatrial routes.
        const fl = M.flutterGeometry();
        const side = new Int8Array(M.nVox); for (let c = 0; c < M.nVox; c++) if (M.kind[c] === KIND.ATRIAL) side[c] = A.label[c] === LAB.RA ? 1 : -1;
        this._flutterGate = { ang: fl.ang, side, upperLA: fl.upperLA, dir: opts.clockwise ? -1 : 1, tol: P.flutterGateTol };
        const slowed = [];
        // (conduction near the annulus axis is slowed in proportion, so no short
        // cut around the axis outruns the circuit's angular speed)
        for (let c = 0; c < M.nVox; c++) if (isFinite(fl.ang[c])) {
          slowed.push([c, this.cvMul[c]]);
          this.cvMul[c] *= (fl.isthmus[c] ? P.flutterIsthmusSlow : P.flutterRingSlow) * Math.max(1, P.flutterRadius / fl.radius[c]);
        }
        this.drivers.push({ kind: 'watch', slowed, cell: fl.start[0], lastAct: this.tAct[fl.start[0]], cls: [] });
        for (const c of fl.start) this.schedule(c, this.t);
      } else if (type === 'ectopic') {
        // nearest right-atrial cell to the AV node at least ectopicDist mm away from it
        const a0 = M.avn[0]; let c = -1, best = Infinity;
        for (let q = 0; q < M.nVox; q++) {
          if (!atrial(LAB.RA)(q)) continue;
          const d = Math.hypot(M.x[q] - M.x[a0], M.y[q] - M.y[a0], M.z[q] - M.z[a0]);
          if (d >= P.ectopicDist && d < best) { best = d; c = q; }
        }
        if (opts.cell !== undefined) c = opts.cell;
        const sinus = this.pacemakers.find((pm) => pm.name === 'sinus');
        this.drivers.push({ kind: 'focus', cell: c, next: this.t + 100, cl: () => (sinus ? sinus.cl : 800) });
      } else if (type === 'mat') {
        const foci = opts.cells && opts.cells.length >= 3 ? opts.cells : pick((c) => M.kind[c] === KIND.ATRIAL && !M.seg[c], 4);
        // cycle lengths vary ±25% around the atrial rate (the sinus rate setting)
        const sinus = this.pacemakers.find((pm) => pm.name === 'sinus');
        this.drivers.push({ kind: 'rotate', cells: foci, next: this.t + 200, cl: () => (sinus ? sinus.cl : 500) * (0.75 + 0.5 * r()) });
      } else if (type === 'vt') {
        const c = opts.cell !== undefined ? opts.cell : pick(vent, 1)[0];
        this.drivers.push({ kind: 'focus', cell: c, next: this.t, cl: () => opts.cl || P.vtCl });
      } else if (type === 'vf') {
        for (const c of pick(vent, P.vfFoci)) this.drivers.push({ kind: 'focus', cell: c, next: this.t + r() * 120, cl: rand(P.vfClMin, P.vfClMax) });
      } else throw new Error('unknown arrhythmia ' + type);
      this.arrhythmia = { type, t: this.t, cell: opts.cell, clockwise: !!opts.clockwise };
      this.rhythmChangedAt = this.t;
    }
    // substrate for R-on-T ventricular fibrillation: acute ischaemia (minutes
    // to ~2 days after onset)
    vulnerable() { return this.insults.length > 0 && this.ischemiaHours >= 0.1 && this.ischemiaHours <= 48; }

    // ventricular response in AF and flutter (bpm; null = natural for flutter, default for AF)
    setVentricularResponse(bpm) {
      this.vResponse = bpm || null;
      if (this.arrhythmia && this.arrhythmia.type === 'flutter') this._setFlutterRatio();
    }
    // flutter: the AV node conducts one in N flutter waves (N from the set ventricular rate)
    _setFlutterRatio() {
      const d = this.drivers.find((x) => x.kind === 'watch');
      const cl = d && d.cls.length ? d.cls.reduce((a, b) => a + b, 0) / d.cls.length : 175;
      const n = this.vResponse ? Math.max(2, Math.round(60000 / this.vResponse / cl)) : 0;
      this._flutterRatio = n ? { cell: this.M.avn[this.M.avn.length - 2], n, count: 0, lastT: -1e9, last: true } : null;
    }
    _flutterPass(ta) {
      const g = this._flutterRatio;
      if (ta - g.lastT < 60) return g.last;                    // converging wavelets share one decision
      g.lastT = ta; g.last = (++g.count % g.n) === 0; return g.last;
    }

    stopArrhythmia() {
      for (const d of this.drivers) if (d.slowed) for (const [c, v] of d.slowed) this.cvMul[c] = v;
      if (this.drivers.length) this.rhythmChangedAt = this.t;
      this.drivers = []; this.arrhythmia = null; this._flutterGate = null; this._flutterRatio = null;
    }

    _runDrivers(t) {
      for (const d of this.drivers) {
        if (d.kind === 'watch') {                                // flutter: measure the circuit's cycle length
          const a = this.tAct[d.cell];
          if (a !== d.lastAct) {
            if (a - d.lastAct < 400) { d.cls.push(a - d.lastAct); if (d.cls.length > 12) d.cls.shift(); }
            d.lastAct = a;
            if (this.vResponse && d.cls.length === 4) this._setFlutterRatio();
          }
          continue;
        }
        if (t >= d.next) {
          const c = d.kind === 'rotate' ? d.cells[Math.floor(this.rand() * d.cells.length)] : d.cell;
          if (t >= this.refEnd[c] && !this.blocked[c]) this.schedule(c, t);
          d.next = t + d.cl();
        }
      }
    }

    // DC shock: every excitable cell is depolarised at once, so no wavefront
    // can find excitable tissue ahead of it; drivers stop; the sinus node
    // (reset by the shock) takes over again.
    shock() {
      this.stopArrhythmia();
      const M = this.M, t = this.t;
      // (tissue already refractory has its refractoriness prolonged by the
      // shock, and pending wavefronts are cancelled, so no wave survives)
      for (let c = 0; c < M.nCells; c++) {
        if (!M.kind[c] || this.blocked[c]) continue;
        if (t >= this.refEnd[c]) this.schedule(c, t);
        else { this.refEnd[c] = Math.max(this.refEnd[c], t + this.P.shockRefractory); this.arrive[c] = Infinity; }
      }
      this.shockLog = (this.shockLog || []).concat([{ t }]).slice(-10);
      this.rhythmChangedAt = t;
    }

    // Adenosine (IV bolus): after ~1 s, transient complete AV-nodal block for
    // a few seconds. Terminates re-entry that uses the AV node (AVNRT,
    // AVRT) and exposes atrial activity in flutter and AF; accessory
    // pathways are not affected.
    giveAdenosine() { this.adenosine = { start: this.t + this.P.adenosineDelay, end: this.t + this.P.adenosineDelay + this.P.adenosineBlock }; this.rhythmChangedAt = this.adenosine.start; }

    // a stimulus delivered at a set (future) time; refractory tissue ignores it
    stimulateAt(c, time) { (this.timedStims = this.timedStims || []).push({ c, time: Math.round(time) }); }
    // time of the next sinus discharge
    nextSinus() { const pm = this.pacemakers.find((p) => p.name === 'sinus'); return pm ? Math.max(this.t, this.tAct[pm.cell] + pm.cl) : this.t; }

    schedule(c, time) {
      if (time >= this.arrive[c] && this.arrive[c] > this.tAct[c]) return;  // already sooner
      this.arrive[c] = time;
      const b = Math.floor(time);
      if (b - this.t >= RING) return;
      this.buckets[((b % RING) + RING) % RING].push(c, time);
    }


    _activate(c, ta) {
      const P = this.P;
      // diastolic interval since previous repolarisation
      const DI = ta - this.repEnd[c];
      let apd = this.apdMax[c] * (1 - P.restA * Math.exp(-Math.max(DI, 0) / P.restTau));
      // atrial refractoriness floor at the fastest rates; in flutter the circuit
      // turns with an excitable gap at ~200 ms (≈300/min), not at the refractory limit of AF
      const apdMinA = this._flutterGate ? P.flutterApdMin : P.apdMinAtrial;
      if (apd < apdMinA && this.M.kind[c] === KIND.ATRIAL) apd = apdMinA;
      this.tAct[c] = ta; this.apd[c] = apd;
      this.repEnd[c] = ta + apd;
      this.refEnd[c] = ta + apd * P.erpFrac + this.erpExtra[c];
      this.arrive[c] = Infinity;
      if (this._pendingStim && this._pendingStim.cell === c) { this._pendingStim.captured = true; this._pendingStim = null; }
      if (c < this.M.nVox && this.M.kind[c]) this._ecgEnter(c, ta, apd);
      this._logActivation(c, ta);
      // propagate
      const M = this.M, st = M.start, nb = M.nbr, w0 = M.w0, nVox = M.nVox;
      const blocked = this.blocked, cvMul = this.cvMul, refEnd = this.refEnd, repEnd = this.repEnd, cvK = this.cvK, cvTau = this.cvTau, arrive = this.arrive, tAct = this.tAct;
      const fg = this._flutterGate, iaSlow = this._iaSlow;
      for (let e = st[c]; e < st[c + 1]; e++) {
        const j = nb[e];
        if (blocked[j]) continue;
        let tau = w0[e] * cvMul[j];
        if (fg && j < nVox && c < nVox) {          // one-way conduction around the annulus (flutter circuit)
          const a = fg.ang[c], b = fg.ang[j];
          if (a === a && b === b) { let d = b - a; if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; if (d * fg.dir < -fg.tol) continue; }
          else if (fg.side[c] < 0 && fg.side[j] > 0) continue;   // LA back into RA: no short cut around the circuit
          else if (fg.side[c] > 0 && fg.side[j] < 0 && fg.upperLA[j]) tau *= P.flutterBachmannSlow;   // LA driven from below (CS), not over Bachmann's bundle
        }
        if (iaSlow && j < nVox && c < nVox && this._atrialSide[c] > 0 && this._atrialSide[j] < 0) tau *= iaSlow;   // RA→LA delay (LAE)
        const tEst = ta + tau;
        if (tEst < refEnd[j]) continue;               // will meet refractory tissue
        const dij = tEst - repEnd[j], ct = cvTau[j];
        if (dij < 12 * ct) tau *= 1 + cvK[j] * Math.exp(-Math.max(dij, 0) / ct);   // (fully recovered tissue: no slowing)
        const tArr = ta + tau;
        if (tArr < arrive[j] || arrive[j] <= tAct[j]) this.schedule(j, tArr);
      }
      // AF: concealed conduction. Fibrillatory impulses that penetrate the AV
      // node leave its lower part (where fast and slow pathways join)
      // refractory for a random time around the target RR, so the response
      // is irregularly irregular at the ventricular rate set by the user.
      const avnJoin = this.M.avn[this.M.avn.length - 2];
      if (c === avnJoin && this.arrhythmia && this.arrhythmia.type === 'af') {
        const rr = 60000 / (this.vResponse || P.afDefaultRate);
        this.refEnd[c] = Math.max(this.refEnd[c], ta + rr * (1 - P.afIrregularity + 2 * P.afIrregularity * this.rand()) - P.afAvnToV);
      }
      // retrograde fast-pathway conduction (AVNRT bookkeeping): the top of the
      // AV node fired from below
      if (c === this.M.avn[0] && this.tAct[this.M.avn[1]] < ta && this.tAct[this.M.avn[1]] > ta - 60) {
        const log = this.retroLog || (this.retroLog = []); log.push({ t: ta }); if (log.length > 40) log.shift();
      }
      // vulnerable period: a ventricular stimulus captured on the T wave of an
      // ischaemic heart degenerates into ventricular fibrillation
      if (this._pendingRonT && c === this._pendingRonT) { this._pendingRonT = null; this.startArrhythmia('vf'); this.arrhythmia.trigger = 'R-on-T'; }
      // accessory pathway: fast, non-decremental, conducts both ways
      const ap = this.ap;
      if (ap && (c === ap.a || c === ap.v) && ta >= ap.refEnd) {
        ap.refEnd = ta + ap.erp;
        this.schedule(c === ap.a ? ap.v : ap.a, ta + ap.delay);
        const log = this.apLog || (this.apLog = []);
        log.push({ t: ta, dir: c === ap.a ? 'antegrade' : 'retrograde' }); if (log.length > 60) log.shift();
      }
    }

    // ---- Accessory pathway (Wolff–Parkinson–White) ---------------------------
    // A strand of working muscle bridging the AV ring at one site. It conducts
    // without the AV node's decrement, so the ventricle near its insertion is
    // pre-excited (short PR, delta wave) and the rest is activated by the
    // normal system: a fusion beat. Locations around the mitral and tricuspid rings.
    setAccessoryPathway(loc) {
      this.ap = null; this.apLocation = null;
      if (!loc) return;
      const site = this.M.accessorySite(loc);
      this.ap = { a: site.a, v: site.v, delay: this.P.apDelay, erp: this.P.apErp, refEnd: -Infinity };
      this.apLocation = loc;
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
          const old = this.log.vent[this.log.vent.length - 6]; if (old) { delete old.ts; delete old.rs; }
        }
        this._curV.last = ta; this._curV.n++;
        this._curV.repEnd = Math.max(this._curV.repEnd, this.repEnd[c]);
        if (this.insults.length) { (this._curV.ts || (this._curV.ts = [])).push(ta); (this._curV.rs || (this._curV.rs = [])).push(this.repEnd[c]); }
      }
    }

    // End of the QRS and of repolarisation for a logged beat. With ischaemia a
    // few cells, reached late around necrosis or with greatly prolonged action
    // potentials, set the absolute extremes without showing on the ECG: the
    // ends are then the 99.5th activation percentile + 10 ms (the normal tail) and
    // the 98th repolarisation percentile.
    beatEnds(vb) {
      if (!vb.ts || vb.ts.length < 200) return { last: vb.last, repEnd: vb.repEnd };
      if (vb._ends && vb._ends.n === vb.ts.length) return vb._ends;
      const pc = (a, q) => { const b = Float64Array.from(a).sort(); return b[Math.floor(q * (b.length - 1))]; };
      return (vb._ends = { last: Math.min(vb.last, pc(vb.ts, 0.995) + 10), repEnd: pc(vb.rs, 0.98), n: vb.ts.length });
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
      const pl = 1 - this.pDecl[c] * (s < apd ? s / apd : 1);
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
    // Linear pieces: outside its upstroke a cell's Vm − Vrest is carried as a
    // straight line k0 − t·k1 in the running sums S0/S1 (exact on the plateau;
    // repolarisation is split into REP_SEG straight segments through the exact
    // AP shape). Only cells in their upstroke are summed sample by sample.
    _setPiece(c, piece) {
      const M = this.M, NE = M.NE, o = c * NE, W = this.W;
      let k0 = 0, k1 = 0;
      if (piece === FLAT) {                                  // plateau after the APD (pl = 1 − p), cancelled by the convolution
        k0 = this.vAmp[c] * (1 - this.pDecl[c]);
      } else if (piece === 1) {                              // plateau
        const A = this.vAmp[c], p = this.pDecl[c], apd = this.apd[c];
        k0 = A * (1 + p * this.tAct[c] / apd); k1 = A * p / apd;
      } else if (piece >= 2) {                               // repolarisation segment piece − 2
        const ta = this._segT(c, piece - 2), tb = this._segT(c, piece - 1), va = this.vm(c, ta) - this.vRest[c], vb = this.vm(c, tb) - this.vRest[c];
        const b = (vb - va) / Math.max(1, tb - ta); k0 = va - b * ta; k1 = -b;
      }
      const d0 = k0 - this.pk0[c], d1 = k1 - this.pk1[c];
      if (d0 || d1) for (let e = 0; e < NE; e++) { this.S0[e] += W[o + e] * d0; this.S1[e] += W[o + e] * d1; }
      this.pk0[c] = k0; this.pk1[c] = k1; this.piece[c] = piece;
    }
    // start of repolarisation segment j (j = REP_SEG: end of repolarisation)
    _segT(c, j) {
      const x = this.tAct[c] + this.apd[c], h = 0.5 * this.repW[c], r0 = Math.floor(x - h), r1 = Math.ceil(x + h);
      return r0 + Math.round((r1 - r0) * j / REP_SEG);
    }
    // Each phase-transition event schedules the next one (plateau → segment 0 →
    // … → rest), so the work is spread over the T wave rather than all queued
    // during the QRS.
    // The 2-ms upstroke is not summed sample by sample: the cell goes straight
    // onto its plateau piece (the ECG's 40 Hz low-pass cannot tell a 2-ms rise
    // from a step), which keeps fast rhythms (VT, VF) in real time.
    _ecgEnter(c, ta, apd) {
      if (this.piece[c]) this._setPiece(c, 0);
      const g = ++this.gen[c];
      const tPl = Math.ceil(ta + this.P.upW), tRep = Math.floor(ta + apd - 0.5 * this.repW[c]);
      this._histRemove(c);
      if (tRep <= tPl) { this._dynAdd(c); return; }             // (very short APD: summed explicitly)
      this._dynRemove(c);
      this._setPiece(c, 1);
      const p = this.pDecl[c];
      if (Math.abs(p) > 0.1) {                                  // unusual plateau (Brugada dome, inflamed atria): exact segments
        this.tbuckets[Math.max(this._segT(c, 0), this.t + 1) % RING].push(c, g, 2);
        return;
      }
      // Vm − Vrest = A·pl(s)·(1 − R) ≈ A·pl(s) − A(1 − p)·R (error < 1% of the T wave for |p| ≤ 0.1):
      // a linear/flat plateau piece minus a(=A(1 − p))·R from the convolution
      const k = this.M.kind[c] === KIND.ATRIAL ? 1 : 0, w = this.K[k].length;
      const tau = Math.round(ta + apd - 0.5 * this.repW[c]), a = this.vAmp[c] * (1 - p);
      this.hTau[c] = tau; this.hAmp[c] = a; this.hKer[c] = k;
      this._histAdd(c, 1);
      this.tbuckets[Math.max(Math.ceil(ta + apd), this.t + 1) % RING].push(c, g, FLAT);
      this.tbuckets[Math.max(tau + w, this.t + 1) % RING].push(c, g, FLAT + 1);
    }
    _histAdd(c, sign) {
      const NE = this.M.NE, H = this.H[this.hKer[c]], o = (((this.hTau[c] % HRING) + HRING) % HRING) * NE, W = this.W, ow = c * NE, a = sign * this.hAmp[c];
      for (let e = 0; e < NE; e++) H[o + e] += W[ow + e] * a;
    }
    _histRemove(c) {
      if (this.hTau[c] + this.K[this.hKer[c]].length > this.t) this._histAdd(c, -1);
      this.hTau[c] = -1e9;
    }    // Advance one millisecond
    step() {
      const t = this.t;
      // 1. automaticity: a pacemaker fires when its cycle length has elapsed
      //    since it was last activated (being activated resets it: overdrive suppression)
      for (const pm of this.pacemakers) {
        if (pm.cl <= 0 || this.blocked[pm.cell] || (pm.armed && !pm.armed())) continue;
        if (pm.name === 'sinus' && (this.sinusArrest || t < this.sinusPauseUntil || (this.arrhythmia && (this.arrhythmia.type === 'ectopic' || this.arrhythmia.type === 'mat')))) continue;
        if (t - this.tAct[pm.cell] >= pm.cl && t >= this.refEnd[pm.cell]) {
          // SA exit block: the node keeps its rhythm, but every nth impulse fails to exit
          if (pm.name === 'sinus' && this.saExit && ++this.saExit.count % this.saExit.n === 0) {
            this.tAct[pm.cell] = t; this.fireLog.push({ name: 'sinus-blocked', t });
            continue;
          }
          this.schedule(pm.cell, t);
          this.fireLog.push({ name: pm.name, t }); if (this.fireLog.length > 40) this.fireLog.shift();
        }
      }
      // 1b. arrhythmia drivers (fibrillatory foci, flutter circuit, MAT, VT)
      if (this.drivers.length) this._runDrivers(t);
      if (this.timedStims && this.timedStims.length) {
        for (const q of this.timedStims) if (q.time <= t) this.stimulate(q.c, t);
        this.timedStims = this.timedStims.filter((q) => q.time > t);
      }
      if (this.adenosine && t >= this.adenosine.end) this.adenosine = null;
      const adeno = this.adenosine && t >= this.adenosine.start;
      // 2. process arrivals in [t, t+1)
      const bucket = this.buckets[t % RING];
      for (let q = 0; q < bucket.length; q += 2) {
        const c = bucket[q], ta = bucket[q + 1];
        if (ta !== this.arrive[c]) continue;          // superseded
        if (this.blocked[c] || ta < this.refEnd[c] || (adeno && this.M.kind[c] === KIND.AVN)) { this.arrive[c] = Infinity; continue; }
        if (this._flutterRatio && c === this._flutterRatio.cell && !this._flutterPass(ta)) { this.arrive[c] = Infinity; continue; }
        const gate = this.gates.get(c);
        if (gate && !this._gatePass(gate, ta)) { this.arrive[c] = Infinity; this.blockLog.push({ t: ta, at: gate.site }); if (this.blockLog.length > 40) this.blockLog.shift(); continue; }
        this._activate(c, ta);
      }
      bucket.length = 0;
      this.t = t + 1;
      // 3. phase transitions for the ECG sum (upstroke→plateau→repolarisation)
      const tb = this.tbuckets[this.t % RING];
      for (let q = 0; q < tb.length; q += 3) {
        const c = tb[q]; if (tb[q + 1] !== this.gen[c]) continue;
        const kind = tb[q + 2];
        if (kind === FLAT) { this._setPiece(c, FLAT); continue; }
        if (kind === FLAT + 1) { this._setPiece(c, 0); this.hTau[c] = -1e9; continue; }   // window over: plateau piece and R = 1 cancel
        if (kind === 1) this._dynRemove(c);
        this._setPiece(c, kind < 2 + REP_SEG ? kind : 0);    // last event: back at rest
        if (kind < 2 + REP_SEG) { const tn = this._segT(c, kind - 1); this.tbuckets[Math.max(tn, this.t) % RING].push(c, tb[q + 1], kind + 1); }
      }
      // histogram slots that left every kernel window are cleared for reuse
      { const NE = this.M.NE, o = ((((this.t - 400) % HRING) + HRING) % HRING) * NE; for (const H of this.H) for (let e = 0; e < NE; e++) H[o + e] = 0; }
      tb.length = 0;
      this._ecg(this.t);
    }

    run(ms) { for (let i = 0; i < ms; i++) this.step(); }

    // 4. ECG: φ_e = −K [Σ_dyn W_ei (Vm_i − Vrest_i) + (S0_e − t·S1_e) + baseline_e]
    _ecg(t) {
      const M = this.M, W = this.W, NE = M.NE, phi = this._phi || (this._phi = new Float64Array(NE));
      for (let e = 0; e < NE; e++) phi[e] = this.S0[e] - t * this.S1[e];
      for (let k = 0; k < 2; k++) {                            // − Σ_x K(x)·H(t − x): cells repolarising now
        const H = this.H[k], K = this.K[k];
        for (let x = 0; x < K.length; x++) {
          const kx = K[x], o = ((((t - x) % HRING) + HRING) % HRING) * NE;
          if (kx === 0) continue;
          for (let e = 0; e < NE; e++) phi[e] -= kx * H[o + e];
        }
      }
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
        // bounded-torso lead fields (a computed Burger triangle), optionally
        // blended with the Einthoven projection (torsoBlend = torso share)
        const b = this.P.torsoBlend, g = this.P.dipoleGain, lr = this._limbRot || (this._limbRot = [Math.cos(this.P.limbRotation * Math.PI / 180), Math.sin(this.P.limbRotation * Math.PI / 180)]);
        const dx = lr[0] * D[0] + lr[1] * D[1], dy = -lr[1] * D[0] + lr[0] * D[1];   // heart vector turned by limbRotation
        L[0] = b * v(12) * g + (1 - b) * dx;
        L[1] = b * this.P.torsoIIGain * v(13) * g + (1 - b) * (c60 * dx - s60 * dy);
        L[2] = L[1] - L[0];
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
      // 0.05 Hz high-pass (diagnostic ECG): removes the DC offset of injury
      // currents so ST deviation reads against the TP segment, as on a cart
      if (this.P.ecgHighpass > 0) {
        const a = this._hpA || (this._hpA = 1 / (1 + 2 * Math.PI * this.P.ecgHighpass / 1000));
        const hx = this._hpX || (this._hpX = Float64Array.from(L)), hy = this._hpY || (this._hpY = new Float64Array(12));
        if (this._hpReset) { hx.set(L); this._hpReset = false; }   // absorb the step when ischaemia changes
        for (let k = 0; k < 12; k++) { const y = a * (hy[k] + L[k] - hx[k]); hx[k] = L[k]; hy[k] = y; L[k] = y; }
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
      const M = this.M, W = this.W, NE = M.NE, b = new Float64Array(NE);
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

  // Ventricular hypertrophy presets: thicker free wall (anatomy), stronger
  // sources (lead fields) and a reversed transmural repolarisation gradient
  // (strain). Validated with tools/hyper.js.
  function hypertrophyOptions({ lvh = false, rvh = false } = {}) {
    return {
      anatomy: { lvWallLayers: lvh ? 6 : 3, rvWallLayers: rvh ? 5 : 0 },
      params: { lvStrain: lvh ? 1 : 0, lvSourceGain: lvh ? 1.5 : 1, rvStrain: rvh ? 0.7 : 0, rvSourceGain: rvh ? 1.8 : 1 },
    };
  }

  const api = { hypertrophyOptions, Anatomy, Model, Sim, DEFAULTS, LAB, KIND, SEG, SEG_NAME, PHASE, LEADS, rng, setDefaultTorso, lvThickenWeight, rvThickenWeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiveHeart = api;
})(typeof window !== 'undefined' ? window : globalThis);
