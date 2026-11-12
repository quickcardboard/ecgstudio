// Blind rhythm reader: reads a 12-lead strip (mV, 1 kHz, ≥ 6 s) the way a reader scans a rhythm strip.
//   QRS complexes: peaks of the spatial velocity (sum over leads of |dV/dt|), morphology correlation
//   P waves: the residual after subtracting each beat's average QRST, in II, aVF and V1
// Returns measurements and a rhythm label with AV and SA relations.
const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'], K = (n) => LEADS.indexOf(n);
const pct = (arr, p) => { const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

function readRhythm(rec) {
  const N = rec.length, NL = 12;
  const sv = new Float64Array(N); for (let t = 0; t < N - 1; t++) { let s = 0; for (let k = 0; k < NL; k++) s += Math.abs(rec[t + 1][k] - rec[t][k]); sv[t] = s; }
  // smoothed spatial velocity (8 ms) for QRS detection
  const svs = new Float64Array(N); { let acc = 0; for (let t = 0; t < N; t++) { acc += sv[t]; if (t >= 8) acc -= sv[t - 8]; svs[t] = acc / 8; } }
  const top = pct(svs, 0.995), th = 0.3 * top;
  // ---- QRS detection: local maxima above threshold, ≥ 200 ms apart (larger wins)
  let peaks = [];
  for (let t = 100; t < N - 100; t++) {
    if (svs[t] < th) continue;
    let isMax = true; for (let u = t - 60; u <= t + 60; u++) if (svs[u] > svs[t]) { isMax = false; break; }
    if (!isMax) continue;
    if (peaks.length && t - peaks[peaks.length - 1] < 200) { if (svs[t] > svs[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = t; continue; }
    peaks.push(t);
  }
  const quiet = (t, n, f) => { for (let i = 0; i < n; i++) if (svs[t + i] >= f * top) return false; return true; };
  const beats = peaks.map((p) => {
    let on = p; while (on > p - 120 && !quiet(on - 6, 6, 0.06)) on--;
    let off = p; while (off < p + 200 && !quiet(off, 8, 0.06)) off++;
    // (a slow late activation can pause briefly: the QRS goes on if activity at QRS speed resumes within 25 ms)
    for (let k = 0; k < 3; k++) { let u = off + 8; while (u < off + 33 && svs[u] < 0.12 * top) u++; if (u >= off + 33 || u >= p + 200) break; off = u; while (off < p + 200 && !quiet(off, 8, 0.06)) off++; }
    return { p, on, off, w: off - on };
  });
  const out = { beats: beats.length };
  if (beats.length < 3) return { ...out, rhythm: beats.length ? 'bradycardia (too few beats)' : 'asystole' };
  const rr = beats.slice(1).map((b, i) => b.on - beats[i].on), rrMean = mean(rr), rate = Math.round(60000 / rrMean);
  const rrCv = sd(rr) / rrMean, width = pct(beats.map((b) => b.w), 0.5);
  // morphology: correlation of each QRS (−40..+80 ms around the peak, all leads) with the median beat
  const seg = (b) => { const v = []; for (let t = b.p - 40; t <= b.p + 80; t++) for (let k = 0; k < NL; k++) v.push(rec[Math.max(0, Math.min(N - 1, t))][k]); return v; };
  const segs = beats.map(seg), med = segs[0].map((_, i) => pct(segs.map((s) => s[i]), 0.5));
  const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db || 1); };
  const cors = segs.map((s) => corr(s, med)), morph = mean(cors);
  // isoelectric share: time the signal is quiet (no activity) — VF has none
  let quietN = 0; for (let t = 0; t < N; t++) if (svs[t] < 0.04 * top) quietN++;
  Object.assign(out, { rate, rrCv: +rrCv.toFixed(3), width, morph: +morph.toFixed(2), iso: +(quietN / N).toFixed(2) });
  if (morph < 0.7) return { ...out, rhythm: 'ventricular fibrillation' };   // (no consistent QRS shape)
  // ---- QRST template subtraction → atrial residual
  // template window: from just before the QRS to the end of the T wave (from the median beat), so a
  // conducted P wave before the QRS, or the next beat's P after the T, is not part of it
  // (the window starts 15 ms before the QRS onset: with a slurred delta wave (WPW) the peak is late, and a
  // fixed 45 ms before it leaves the delta wave in the residual, larger than the P waves)
  const pre = Math.max(45, Math.round(pct(beats.map((b) => b.p - b.on), 0.5)) + 15), minRR = Math.min(...rr);
  const mb = (i) => { let s = 0; for (let k = 0; k < NL; k++) { const v = pct(beats.slice(1, -1).map((b) => rec[Math.max(0, Math.min(N - 1, b.p + i))][k]), 0.5) - pct(beats.slice(1, -1).map((b) => rec[Math.max(0, Math.min(N - 1, b.on - 20))][k]), 0.5); s += v * v; } return Math.sqrt(s); };
  const offRel = pct(beats.map((b) => b.off - b.p), 0.5);
  let tpk = offRel + 40, tmx = 0; for (let i = offRel + 40; i < Math.min(offRel + 420, minRR - 60); i += 4) { const v = mb(i); if (v > tmx) { tmx = v; tpk = i; } }
  let tEnd = tpk; while (tEnd < Math.min(tpk + 250, minRR - 60) && mb(tEnd) > 0.12 * tmx) tEnd += 4;
  const post = Math.max(offRel + 20, Math.min(tEnd + 20, minRR - 110));
  out.qt = tEnd + (beats[0].p - beats[0].on);
  const tmpl = []; for (let i = -pre; i <= post; i++) { const vals = []; for (let k = 0; k < NL; k++) vals.push(pct(beats.slice(1, -1).map((b) => rec[Math.max(0, Math.min(N - 1, b.p + i))][k]), 0.5)); tmpl.push(vals); }
  // (relative to the template's own baseline, its last sample after the T wave: a TP segment shifted off
  // zero, as by the injury current of pericarditis, would otherwise leave a step at the window edges)
  const t0f = post >= tEnd + 10 ? tmpl[tmpl.length - 1].slice() : new Array(NL).fill(0);
  for (const v of tmpl) for (let k = 0; k < NL; k++) v[k] -= t0f[k];
  const res = rec.map((r) => r.slice());
  for (const b of beats) {
    if (cors[beats.indexOf(b)] < 0.85) continue;
    // (edges tapered over 20 ms: an abrupt window edge leaves a step that reads as a wave)
    for (let i = -pre; i <= post; i++) { const t = b.p + i; if (t < 0 || t >= N) continue; const w = Math.min(1, (i + pre) / 20, (post - i) / 20); for (let k = 0; k < NL; k++) res[t][k] -= w * tmpl[i + pre][k]; }
  }
  // atrial lead set: II, aVF, V1; baseline removed by a 400 ms running median
  const AL = [K('II'), K('aVF'), K('V1')];
  const base = AL.map((k) => { const b = new Float64Array(N); for (let t = 0; t < N; t += 20) { const w = []; for (let u = Math.max(0, t - 200); u < Math.min(N, t + 200); u += 5) w.push(res[u][k]); const m = pct(w, 0.5); for (let v = t; v < Math.min(N, t + 20); v++) b[v] = m; } return b; });
  const aSig = (t, j) => res[t][AL[j]] - base[j][t];
  out._aSig = aSig;
  const amag = new Float64Array(N); for (let t = 0; t < N; t++) { let s = 0; for (let j = 0; j < 3; j++) s += aSig(t, j) ** 2; amag[t] = Math.sqrt(s); }
  const asm = new Float64Array(N); { let acc = 0; for (let t = 0; t < N; t++) { acc += amag[t]; if (t >= 15) acc -= amag[t - 15]; asm[t] = acc / 15; } }
  // QRS cores are not searched (residual is least reliable there)
  const inQrs = new Uint8Array(N); for (const b of beats) for (let t = b.on - 25; t <= b.off + 5; t++) if (t >= 0 && t < N) inQrs[t] = 1;
  // T-wave zones (QRS end to T end): the residual of a T wave changed by the preceding RR lives here
  // (to 40 ms past the measured T end: the tail of a long T wave leaves a residual that reads as a small P)
  const inT = new Uint8Array(N); for (const b of beats) for (let t = b.off + 5; t <= b.p + tEnd + 40; t++) if (t >= 0 && t < N) inT[t] = 1;
  const aTop = pct(Array.from(asm).filter((_, t) => !inQrs[t]), 0.98), ath = Math.max(0.03, 0.4 * aTop);
  const P = [];
  for (let t = 60; t < N - 60; t++) {
    if (inQrs[t] || asm[t] < ath) continue;
    let isMax = true; for (let u = t - 70; u <= t + 70; u++) if (asm[u] > asm[t]) { isMax = false; break; }
    if (!isMax) continue;
    if (P.length && t - P[P.length - 1].t < 140) continue;
    // polarity from the first lobe of the atrial complex (80 ms before the peak to 40 ms after): the
    // largest point can be the atrial repolarisation wave after the P (PR depression, opposite sign)
    const lobe = (j) => { const aS = (u, k) => aSig(Math.max(0, Math.min(N - 1, u)), k); let mx = 0; for (let u = t - 80; u <= t + 40; u++) mx = Math.max(mx, Math.abs(aS(u, j))); for (let u = t - 80; u <= t + 40; u++) if (Math.abs(aS(u, j)) >= 0.6 * mx) { let e = aS(u, j); for (let v = u; v <= t + 40 && Math.sign(aS(v, j)) === Math.sign(e); v++) if (Math.abs(aS(v, j)) > Math.abs(e)) e = aS(v, j); return e; } return aS(t, j); };
    P.push({ t, II: +lobe(0).toFixed(3), aVF: +lobe(1).toFixed(3), V1: +aSig(t, 2).toFixed(3), amp: +asm[t].toFixed(3), inT: !!inT[t] });
  }
  const Pall = P.slice();
  // a wave inside a T wave counts only when it is as large as the waves seen outside T waves
  { const outAmp = P.filter((p) => !p.inT).map((p) => p.amp), ref = outAmp.length ? pct(outAmp, 0.5) : 0;
    // (and has the shape of those waves: a changed T wave leaves a residual of another direction)
    const outs = P.filter((p) => !p.inT), mS = outs.length ? ['II', 'aVF', 'V1'].map((k) => pct(outs.map((p) => p[k]), 0.5)) : null;
    const far = (p) => mS && Math.hypot(p.II - mS[0], p.aVF - mS[1], p.V1 - mS[2]) > 0.5 * Math.hypot(...mS);
    for (let i = P.length - 1; i >= 0; i--) if (P[i].inT && (P[i].amp < 0.8 * ref || far(P[i]))) P.splice(i, 1); }
  const pp = P.slice(1).map((p, i) => p.t - P[i].t), ppMean = pp.length ? mean(pp) : null, aRate = ppMean ? Math.round(60000 / ppMean) : 0, ppCv = pp.length > 1 ? sd(pp) / ppMean : null;
  // P–QRS relation: the last P 80–350 ms before each QRS onset (PR), retrograde P 40–220 ms after the onset (RP)
  const prs = beats.map((b) => { const c = P.filter((p) => b.on - p.t >= 30 && b.on - p.t <= 380); return c.length ? b.on - c[c.length - 1].t : null; });
  const rps = beats.map((b, i) => { const nxt = beats[i + 1] ? beats[i + 1].on : N; const c = P.filter((p) => p.t - b.on >= 40 && p.t - b.on <= 260 && p.t < nxt - 60); return c.length ? c[0].t - b.on : null; });
  const prVals = prs.filter((x) => x !== null), prShare = prVals.length / beats.length, prSd = prVals.length > 1 ? sd(prVals) : null;
  const pII = mean(P.map((p) => p.II)), pAvf = mean(P.map((p) => p.aVF));
  // P morphologies: cluster by polarity/size in II, aVF, V1
  const shapes = []; for (const p of P) { const v = [p.II, p.aVF, p.V1]; if (!shapes.some((s) => Math.hypot(s[0] - v[0], s[1] - v[1], s[2] - v[2]) < 0.06)) shapes.push(v); }
  Object.assign(out, { aRate, ppCv: ppCv === null ? null : +ppCv.toFixed(3), pCount: P.length, prShare: +prShare.toFixed(2), pr: prVals.length ? Math.round(mean(prVals)) : null, prSd: prSd === null ? null : Math.round(prSd), rp: rps.filter((x) => x !== null).length ? Math.round(mean(rps.filter((x) => x !== null))) : null, rpShare: +(rps.filter((x) => x !== null).length / beats.length).toFixed(2), pII: +pII.toFixed(3), pAvf: +pAvf.toFixed(3), pShapes: shapes.length });
  out._P = P.map((p) => p.t); out._Q = beats.map((b) => b.on);
  // PR of every beat from all candidates (a conducted P can sit on the previous T at fast rates)
  const prAll = beats.map((b) => { const c = Pall.filter((p) => b.on - p.t >= 30 && b.on - p.t <= 380); return c.length ? b.on - c[c.length - 1].t : null; }).filter((x) => x !== null);
  out.prAllShare = +(prAll.length / beats.length).toFixed(2); out.prAllSd = prAll.length > 1 ? Math.round(sd(prAll)) : null;
  // atrial waves in the raw diastolic stretches (T end to the next QRS), where waves locked to the QRS
  // (flutter at a fixed ratio) survive: intervals between successive waves within one stretch
  const dI = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i].p + tEnd + 20, b = beats[i + 1].on - 25; if (b - a < 150) continue;
    const m = []; for (let t = a; t < b; t++) { let s2 = 0; for (const k of AL) { let mu = 0; for (let u = a; u < b; u += 5) mu += rec[u][k]; mu /= Math.ceil((b - a) / 5); s2 += (rec[t][k] - mu) ** 2; } m.push(Math.sqrt(s2)); }
    const pk = []; for (let j = 30; j < m.length - 30; j++) { if (m[j] < 0.025) continue; let mx = true; for (let u = j - 60; u <= j + 60; u++) if (u >= 0 && u < m.length && m[u] > m[j]) { mx = false; break; } if (mx && (!pk.length || j - pk[pk.length - 1] >= 120)) pk.push(j); }
    for (let j = 1; j < pk.length; j++) dI.push(pk[j] - pk[j - 1]);
  }
  // flutter: periodicity of the raw atrial leads in the diastolic stretches (T end to the next QRS):
  // the best lag (150–300 ms) of the windows' pooled autocorrelation. A sawtooth repeats; fibrillatory
  // waves, P waves and baseline do not.
  { let best = 0, bestL = 0;
    const wins = []; for (let i = 0; i + 1 < beats.length; i++) { const a = beats[i].p + tEnd + 20, b = beats[i + 1].on - 25; if (b - a >= 320) wins.push([a, b]); }
    if (wins.length) for (let L = 150; L <= 300; L += 2) {
      let num = 0, d1 = 0, d2 = 0;
      for (const [a, b] of wins) { const mu = AL.map((k) => { let m = 0; for (let t = a; t < b; t++) m += rec[t][k]; return m / (b - a); });
        for (let t = a; t + L < b; t++) for (let j = 0; j < 3; j++) { const u = rec[t][AL[j]] - mu[j], v = rec[t + L][AL[j]] - mu[j]; num += u * v; d1 += u * u; d2 += v * v; } }
      const r = num / Math.sqrt(d1 * d2 || 1); if (r > best) { best = r; bestL = L; }
    }
    out.flutterAc = wins.length ? { r: +best.toFixed(2), cl: bestL, windows: wins.length } : null; }
  out.aRate25 = pp.length ? Math.round(60000 / pct(pp, 0.25)) : 0;
  // (regularity: share of intervals within 15% of the median, robust to a missed or extra wave)
  out.diastAtrial = dI.length ? { n: dI.length, cl: Math.round(pct(dI, 0.5)), cv: +(sd(dI) / mean(dI)).toFixed(2), reg: +(dI.filter((v) => Math.abs(v - pct(dI, 0.5)) <= 0.15 * pct(dI, 0.5)).length / dI.length).toFixed(2) } : null;
  out.rhythm = classify(out, beats);
  return out;
}

// clinical reading order: QRS present and organised? wide or narrow, regular or irregular, rate, P waves
// and their relation to the QRS
function classify(o, beats) {
  const rateTxt = (base) => (o.rate < 60 ? `${base} bradycardia` : o.rate > 100 ? `${base} tachycardia` : `${base} rhythm`);
  const regular = o.rrCv < 0.08, pOk = o.prAllShare >= 0.8 && o.prAllSd !== null && o.prAllSd <= 35;
  // more atrial waves than QRS complexes (counted, or the atrial rate from the shorter P–P intervals)
  // (or as many found as QRS complexes but marching through at a faster rate with no fixed PR: the rest hide in the QRS/T)
  const dissoc = o.pCount >= beats.length * 1.25 || (o.aRate25 > o.rate * 1.2 && o.pCount > beats.length)
    || (o.aRate25 > o.rate * 1.3 && o.pCount >= beats.length && o.prAllShare < 0.8);
  const flutterWaves = o.flutterAc && o.flutterAc.r >= 0.6 && o.flutterAc.cl >= 170 && o.flutterAc.cl <= 280;
  if (o.width >= 120 && o.rate >= 100 && regular && !pOk) return 'ventricular tachycardia';
  if (flutterWaves) return 'atrial flutter';
  if (regular) {
    if (pOk && !dissoc) return o.pII >= 0 ? rateTxt('sinus').replace('sinus rhythm', 'sinus rhythm') : 'ectopic atrial rhythm';
    if (dissoc && o.prSd !== null && o.prSd <= 25 && Math.abs(o.pCount / beats.length - 2) < 0.4) return 'sinus rhythm, 2:1 AV block';
    if (dissoc) return `sinus rhythm, complete AV block (${o.width >= 120 ? 'ventricular' : 'junctional'} escape)`;
    // narrow regular tachycardia without a P before the QRS: told apart by rate (AVNRT typically 140–180,
    // orthodromic AVRT faster, above 200)
    if (o.rate >= 130 && o.prAllShare < 0.5) return o.rate >= 200 ? 'AVRT (SVT, no visible P, rate ≥ 200)' : 'AVNRT (SVT, no visible P, rate < 200)';
    return rateTxt('regular');
  }
  // irregular
  if (dissoc && o.prSd !== null) {
    // dropped beats: P waves not followed by a QRS; PR before each drop vs after it
    return o.prSd > 15 ? 'sinus rhythm, Mobitz I (Wenckebach) AV block' : 'sinus rhythm, Mobitz II AV block';
  }
  if (pOk) return o.rate > 100 ? 'sinus tachycardia (irregular)' : 'sinus rhythm with pauses (SA block or sinus arrhythmia)';
  // (MAT: a P before most QRS, PR varying with the focus; AF: no organised P and a more irregular RR)
  if (o.rate > 100 && o.pShapes >= 3 && o.prAllShare >= 0.6 && o.prAllSd !== null && o.prAllSd <= 95 && o.rrCv < 0.2) return 'multifocal atrial tachycardia';
  return 'atrial fibrillation';
}
module.exports = { readRhythm };
if (require.main === module) {
  const recs = JSON.parse(require('fs').readFileSync(process.argv[2]));
  for (const [n, rec] of Object.entries(recs)) { const r = readRhythm(rec); delete r._P; delete r._Q; console.log(n.padEnd(14), JSON.stringify(r)); }
}
