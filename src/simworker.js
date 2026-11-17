// ECG Studio simulation worker: the engine steps here, off the page's main thread, so a phone can draw the heart and the
// ECG while another core keeps the simulation in real time. The page (src/app.js, "Simulation worker") keeps a replica
// Sim that never steps: commands run on the replica at once (for the controls and lists) and are forwarded here; every
// frame this worker steps the time it is owed and sends back a snapshot (time, per-cell activation for the 3D colours,
// the ECG samples, the beat and event logs, the rhythm state). Built into the page after the engine source
// (tools/build.py) and started from a blob URL.
/* global self */
(function () {
  'use strict';
  let LH = null, anatomyText = null, M = null, S = null, simId = 0;
  const hearts = new Map();                      // structural configurations already built (hypertrophy rebuilds)
  let samples = new Float32Array(12 * 1024), nS = 0, sT0 = 0, owed = 0;
  const pool = [];                               // Float32 buffers handed back by the page (no allocation per frame)
  const OWED_MAX = 250;                          // (behind by more than this: drop it, as the page did on its own thread)

  function onSample(t, L) {
    if (nS === 0) sT0 = t;
    if ((nS + 1) * 12 > samples.length) { const b = new Float32Array(samples.length * 2); b.set(samples); samples = b; }
    samples.set(L, nS * 12); nS++;
  }
  function buf(n) {
    for (let i = 0; i < pool.length; i++) if (pool[i].length === n) return pool.splice(i, 1)[0];
    return new Float32Array(n);
  }
  function snapshot(ms) {
    const N = S.tAct.length, ta = buf(N), ap = buf(N);
    ta.set(S.tAct); ap.set(S.apd);
    const vent = S.log.vent.map((v) => ({ on: v.on, last: v.last, n: v.n, repEnd: v.repEnd, origin: v.origin, ends: S.beatEnds(v) }));
    const atrial = S.log.atrial.map((a) => ({ on: a.on, last: a.last, n: a.n }));
    const arr = S.arrhythmia ? { type: S.arrhythmia.type, trigger: S.arrhythmia.trigger, clockwise: S.arrhythmia.clockwise } : null;
    const d = S.drivers && S.drivers[0];
    const snap = {
      type: 'snap', simId, t: S.t, ms, owed, tAct: ta, apd: ap, samples: samples.slice(0, nS * 12), sT0, nS,
      vent, atrial, fireLog: S.fireLog, stimLog: S.stimLog, apLog: S.apLog || null, retroLog: S.retroLog || null,
      rhythmChangedAt: S.rhythmChangedAt, sinusPauseUntil: S.sinusPauseUntil, adenosine: S.adenosine || null,
      dipole: S.dipole ? Array.from(S.dipole) : null, arr, cls: d && d.cls ? d.cls.slice() : null, vResponse: S.vResponse,
    };
    nS = 0;
    self.postMessage(snap, [ta.buffer, ap.buffer]);
  }
  function advance(ms, budget) {
    owed = Math.min(owed + ms, OWED_MAX);
    const t0 = performance.now(); let n = 0;
    while (owed >= 1) {
      S.step(); owed--; n++;
      if ((n & 7) === 7 && performance.now() - t0 > budget) break;
    }
    snapshot(performance.now() - t0);
  }

  self.onmessage = (e) => {
    const d = e.data;
    if (d.bufs) for (const b of d.bufs) pool.push(b);
    try {
      switch (d.type) {
        case 'init':
          LH = self.ECGStudio; LH.setDefaultTorso(null); LH.setDefaultTorso2(d.torso); anatomyText = d.anatomy;
          break;
        case 'heart': {
          let h = hearts.get(d.key);
          if (!h) { const A = new LH.Anatomy(JSON.parse(anatomyText), d.anatomy); h = { M: new LH.Model(A, d.params) }; hearts.set(d.key, h); }
          M = h.M;
          break;
        }
        case 'sim':
          S = new LH.Sim(M, d.opts); simId = d.simId; nS = 0; owed = 0; S.onSample(onSample);
          break;
        case 'cmd':
          if (S) S[d.m](...d.args);
          break;
        case 'advance':
          if (S) advance(d.ms, d.budget);
          else self.postMessage({ type: 'idle', simId });
          break;
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.stack || err) });
    }
  };
})();
