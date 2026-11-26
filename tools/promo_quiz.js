// "Name this rhythm": a ~19.5 s portrait quiz (1080x1920, 60 fps) for TikTok / Shorts / Reels. Atrial flutter at about
// 75 bpm (4:1) at half speed: close on the right atrium from outside, then an orbit that cuts in to the full four-chamber
// cut. The heart then rises to the top half while a panel of three unlabelled lead II strips (A sinus 75, B AF ~75,
// C flutter 4:1, all computed by the engine) sweeps in below; captions; the animated logo end screen. No answer is shown.
// The page is the phone layout of index.html (?noworker: the engine steps on the page, one frame per capture) with
// everything but the 3D view hidden, drawn at 2.5x (canvas pixel-ratio caps raised) so a capture is 1080x1920.
//   node tools/promo_quiz.js <outdir> [--skip-take]          (~20 min; --skip-take reuses the recorded heart take)
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process'), { chromium } = require('playwright');
const { logoSvg, ease } = require('./promo_logo.js');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '.');
const SKIP = process.argv.includes('--skip-take');
const PREVIEW = process.env.QUIZ_PREVIEW ? process.env.QUIZ_PREVIEW.split(',').map(Number) : null;   // stills at these times (s), 1x, no video
const FPS = 60, VW = 432, VH = 768, DSF = PREVIEW ? 1 : 2.5;
const SPEED = 0.5;                       // simulated time per real time (half speed)
const TAKE = 17.0, END = 2.8, XF = 0.35, TOTAL = TAKE + END;
const HASH = 'r=72&a=flutter&v=75';

// heart camera keyframes [t, azimuth°, elevation°, distance, lift, shift] relative to the app's four-chamber view
// (tour.cut4()), joined by a smooth curve (monotone cubic: the camera never stops between keyframes, which per-segment
// easing did, a visible hitch); lift raises the heart on screen (a fraction of the screen height) to clear the strip
// panel, shift moves it left (a fraction of the screen width; the four-chamber cut sits right of centre full screen).
// CUT: the cut-away %, eased between its own keyframes [t, %].
const HEART = [
  [0.0, -92, -31, 0.52, 0, 0],      // close on the right atrium, outside
  [1.4, -84, -27, 0.56, 0, 0],      // (a slow creep, then the orbit)
  [4.6, 0, 0, 0.8, 0, 0.04],        // the four-chamber cut
  [6.0, 4, 0, 0.8, 0, 0.04],
  [6.8, 6, 0, 0.94, 0.23, 0.01],    // up into the top half as the strips come in
  [17.0, 16, 2, 0.94, 0.23, 0],     // a slow drift while the strips are read
];
const CUT = [[0, 0], [1.6, 0], [4.4, 100], [17.0, 100]];
const PANEL_IN = [6.0, 6.7], PEN = { start: 6.7, dur: 1.2, gap: 0.6 };   // strip panel slide, pen sweeps (s)
const CAPTIONS = [   // [t0, t1, html, class]
  [0.3, 5.8, 'Do you recognize this rhythm based on the depolarization pattern?<small>It has been slowed to half speed</small>', 'top'],
  [10.0, 16.8, 'Comment below with your answer!', 'mid'],
];
const STRIP_S = 6;   // seconds per strip

const lerpKeys = (keys, t) => {
  const k = keys.findIndex((c) => c[0] > t);
  if (k < 0) return keys[keys.length - 1].slice(1);
  if (k === 0) return keys[0].slice(1);
  const a = keys[k - 1], b = keys[k], e = ease((t - a[0]) / (b[0] - a[0]));
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * e);
};

// monotone cubic (Fritsch-Carlson) through keyframes [t, ...values]: smooth velocity, no overshoot
function smoothKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1].slice(1);
  const k = keys.findIndex((c) => c[0] > t) - 1, n = keys.length;
  return keys[0].slice(1).map((_, j) => {
    const x = keys.map((c) => c[0]), y = keys.map((c) => c[j + 1]);
    const d = x.slice(1).map((xi, i) => (y[i + 1] - y[i]) / (xi - x[i]));
    const m = x.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i])));
    if (k === 0) m[0] = 0;   // (starts from rest)
    if (k === n - 2) m[n - 1] = 0;
    const h = x[k + 1] - x[k], s = (t - x[k]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[k] + (s3 - 2 * s2 + s) * h * m[k] + (-2 * s3 + 3 * s2) * y[k + 1] + (s3 - s2) * h * m[k + 1];
  });
}
const camAt = (t) => { const [az, el, dist, lift, shift] = smoothKeys(HEART, t); return [az, el, dist, lerpKeys(CUT, t)[0], lift, shift]; };

// the three strips (lead II, mV at 1 kHz), from the engine
function makeStrips() {
  const LH = require('../src/engine.js');
  const A = new LH.Anatomy(JSON.parse(fs.readFileSync(path.join(root, 'src/anatomy.json')))), M = new LH.Model(A);
  const rec = (S, ms) => {
    const r = [], t0 = S.t; S.onSample((t, v) => r.push(v[1])); S.run(ms); S.listeners.pop();
    return { ii: r, vent: S.log.vent.filter((v) => v.on > t0).map((v) => v.on - t0) };
  };
  // a 6 s window starting 450 ms before a QRS; for AF the window whose rate is nearest 75 with an irregular rhythm
  const pick = (R, want) => {
    let best = null;
    for (const v of R.vent) {
      const s = v - 450; if (s < 0 || s + STRIP_S * 1000 > R.ii.length) continue;
      const inW = R.vent.filter((x) => x >= s && x < s + STRIP_S * 1000), rr = inW.slice(1).map((x, i) => x - inW[i]);
      const hr = 60000 / (rr.reduce((a, b) => a + b, 0) / rr.length), spread = Math.max(...rr) - Math.min(...rr);
      const score = Math.abs(hr - 75) - (want === 'irregular' ? Math.min(spread, 400) / 20 : 0);
      if (!best || score < best.score) best = { score, s, hr, spread };
    }
    console.log(`  strip ${want}: ${best.hr.toFixed(1)} bpm, RR spread ${Math.round(best.spread)} ms`);
    return R.ii.slice(best.s, best.s + STRIP_S * 1000).map((x) => Math.round(x * 1000) / 1000);
  };
  let S = new LH.Sim(M, { seed: 1 }); S.setRate(75); S.run(6000); const sinus = pick(rec(S, 12000), 'regular');
  S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('af'); S.run(3000); S.setVentricularResponse(90); S.run(5000);
  const af = pick(rec(S, 20000), 'irregular');
  S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('flutter'); S.run(3000); S.setVentricularResponse(75); S.run(5000);
  const flutter = pick(rec(S, 12000), 'regular');
  return [sinus, af, flutter];
}

async function openPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url + '?noworker#' + HASH);
  await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 180000 });
  // only the 3D view, full screen (the interpretation line and the Shock button would give the answer away)
  await page.addStyleTag({ content: `body > *:not(#split) { visibility: hidden !important; } #split > *:not(#pane3d) { visibility: hidden !important; }
    #pane3d { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; visibility: visible !important; z-index: 5;
      border-radius: 0 !important; margin: 0 !important; border: 0 !important; background: #0b131a !important; }
    #pane3d > *:not(#c3d) { display: none !important; } #c3d { width: 100% !important; height: 100% !important; }` });
  await page.evaluate(() => { const T = window.ECGStudioApp.tour; T.closeAll(); T.cut4(); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    let q = []; window.__t = performance.now(); performance.now = () => window.__t;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    const C = window.ECGStudioApp.tour.controls(), cam = C.object, V = window.THREE.Vector3;
    const tgt0 = C.target.clone(), off0 = cam.position.clone().sub(tgt0), up = cam.up.clone(), side = new V().crossVectors(up, off0).normalize();
    const cutEl = document.getElementById('cutDepth'); let cut = -1;
    window.__cam = (az, el, dist, cutPct, lift, shift) => {
      const c = Math.round(cutPct); if (c !== cut) { cut = c; cutEl.value = c; cutEl.dispatchEvent(new Event('input')); }
      const off = off0.clone().applyAxisAngle(side, -el * Math.PI / 180).applyAxisAngle(up, az * Math.PI / 180).multiplyScalar(dist);
      // lift: move the target down the screen (so the heart rises) by a fraction of the view's height at the target
      const camUp = up.clone().sub(off.clone().normalize().multiplyScalar(up.dot(off.clone().normalize()))).normalize();
      const h = 2 * off.length() * Math.tan(cam.fov * Math.PI / 360);
      const camRight = new V().crossVectors(off.clone().normalize().negate(), camUp).normalize();
      C.target.copy(tgt0).addScaledVector(camUp, -lift * h).addScaledVector(camRight, shift * h * cam.aspect);
      cam.position.copy(C.target).add(off); cam.up.copy(up); C.update(); cam.lookAt(C.target);
      C.dispatchEvent({ type: 'change' });
    };
    window.__step = (dt, camv) => { window.__t += dt; if (camv) window.__cam(...camv); const cbs = q; q = []; for (const cb of cbs) cb(window.__t); };
  });
  const step = (dt, camv) => page.evaluate(([dt, camv]) => window.__step(dt, camv), [dt, camv]);
  return { ctx, page, step, cdp: await ctx.newCDPSession(page) };
}
function encoder(file) {
  return spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-vf', 'scale=1080:1920:flags=lanczos,setsar=1',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
}

async function recordHeart(browser, url, file) {
  const P = await openPage(browser, url);
  for (let i = 0; i < 320; i++) await P.step(1000 / 32, camAt(0));   // 10 s of flutter first (steps under 34 ms: full quality)
  const ff = PREVIEW ? null : encoder(file), n = Math.round(TAKE * FPS);
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    await P.step(1000 / FPS * SPEED, camAt(t));
    if (PREVIEW) {
      if (PREVIEW.some((x) => Math.round(x * FPS) === f)) await P.page.screenshot({ path: path.join(out, `still-${t.toFixed(1)}.png`) });
      if (f > Math.max(...PREVIEW) * FPS) break;
      continue;
    }
    const r = await P.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 } });
    if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
    if (f % (FPS * 2) === 0) console.log(`  heart ${t.toFixed(1)} s`);
  }
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
  await P.ctx.close();
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=IBM+Plex+Sans+Condensed:wght@700&display=block');
html, body { margin: 0; width: 1080px; height: 1920px; background: transparent; overflow: hidden; font-family: 'IBM Plex Sans', sans-serif; color: #fff; }
.cap { position: absolute; left: 50%; transform: translateX(-50%); width: max-content; max-width: 920px; text-align: center; }
.cap.top { top: 150px; } .cap.mid { top: 862px; }
.cap b { display: inline-block; padding: 26px 44px 30px; border-radius: 28px; background: rgba(9,15,22,0.88); font: 700 64px/1.12 'IBM Plex Sans Condensed', sans-serif;
  border-bottom: 8px solid #ef5b7a; box-shadow: 0 10px 40px rgba(0,0,0,0.4); text-wrap: balance; }
.cap small { display: block; margin-top: 14px; font: 500 40px/1.2 'IBM Plex Sans', sans-serif; color: #d6e0e8; }
#panel { position: absolute; left: 0; right: 0; top: 960px; height: 960px; background: #0b131a; border-top: 3px solid #22313f; }
#panel canvas { position: absolute; left: 0; top: 0; }
#end { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 42%, #172533, #0b131a 72%); }
#mark { position: absolute; left: 50%; top: 470px; transform: translateX(-50%); width: 460px; height: 460px; }
#name { position: absolute; left: 0; right: 0; top: 990px; text-align: center; font: 700 150px/1 'IBM Plex Sans Condensed', sans-serif; }
#name span { color: #ef5b7a; }
#tag { position: absolute; left: 0; right: 0; top: 1175px; text-align: center; font-size: 50px; font-weight: 500; color: #d6e0e8; }
#url { position: absolute; left: 50%; top: 1300px; transform: translateX(-50%); padding: 26px 60px; border-radius: 999px; background: #ef5b7a; color: #160a0d; font-size: 78px; font-weight: 700; }`;

// the strip panel, drawn in the overlay page: ECG paper (25 mm/s, 10 mm/mV), a letter per strip, a pen sweep
const PANEL_JS = `
window.__strips = null;
window.__drawPanel = (prog) => {
  const W = 1080, H = 960, cv = document.getElementById('pc'), g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const X0 = 40, X1 = W - 40, rowH = 286, top = 92, mm = (X1 - X0) / (${STRIP_S} * 25);   // px per mm
  window.__strips.forEach((d, k) => {
    const y0 = top + k * rowH, h = rowH - 26, base = y0 + h * 0.62;
    g.save(); g.beginPath(); g.roundRect(X0, y0, X1 - X0, h, 14); g.clip();
    g.fillStyle = '#fff4f5'; g.fillRect(X0, y0, X1 - X0, h);
    for (let i = 0, x = X0; x <= X1 + 0.5; i++, x = X0 + i * mm) { g.strokeStyle = i % 5 ? '#f6c9d1' : '#eb8d9f'; g.lineWidth = i % 5 ? 1 : 2; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + h); g.stroke(); }
    for (let i = -40; i <= 40; i++) { const y = base + i * mm; if (y < y0 || y > y0 + h) continue; g.strokeStyle = i % 5 ? '#f6c9d1' : '#eb8d9f'; g.lineWidth = i % 5 ? 1 : 2; g.beginPath(); g.moveTo(X0, y); g.lineTo(X1, y); g.stroke(); }
    const p = Math.max(0, Math.min(1, prog[k])), n = Math.floor(p * (d.length - 1));
    if (n > 1) {
      g.strokeStyle = '#141414'; g.lineWidth = 3.2; g.lineJoin = 'round'; g.beginPath();
      for (let i = 0; i <= n; i++) { const x = X0 + (i / (d.length - 1)) * (X1 - X0), y = base - d[i] * 10 * mm; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      if (p < 1) { const x = X0 + (n / (d.length - 1)) * (X1 - X0), y = base - d[n] * 10 * mm; g.fillStyle = '#ef5b7a'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
    }
    g.restore();
    // the letter and the lead
    g.fillStyle = '#0b131a'; g.beginPath(); g.roundRect(X0 + 14, y0 + 14, 74, 74, 16); g.fill();
    g.fillStyle = '#fff'; g.font = "700 54px 'IBM Plex Sans Condensed'"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ABC'[k], X0 + 51, y0 + 53);
    g.fillStyle = '#5b2430'; g.font = "700 34px 'IBM Plex Sans Condensed'"; g.textAlign = 'left'; g.fillText('II', X0 + 104, y0 + 40);
  });
};`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const f = (n) => path.join(out, n);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (!SKIP || !fs.existsSync(f('quiz-heart.mp4'))) {
    const tmpPage = f('.quiz-index.html');
    fs.writeFileSync(tmpPage, fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .split('Math.min(1.5, window.devicePixelRatio').join('Math.min(4, window.devicePixelRatio').split('Math.min(2, window.devicePixelRatio').join('Math.min(4, window.devicePixelRatio'));
    await recordHeart(browser, 'file://' + tmpPage, f('quiz-heart.mp4'));
    fs.rmSync(tmpPage, { force: true });
  }
  const strips = makeStrips();
  // overlays: captions, the strip panel (slide-up and pen sweeps as a sequence, then held), the end screen
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const set = async (html) => {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}<script>${PANEL_JS}</script></body></html>`);
    await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load("700 54px 'IBM Plex Sans Condensed'") });
  };
  const tmp = fs.mkdtempSync(path.join(out, '.quiz-'));
  const ov = [];
  for (const [i, [t0, t1, text, cls]] of CAPTIONS.entries()) {
    await set(`<div class="cap ${cls || ''}"><b>${text}</b></div>`);
    const fc = path.join(tmp, `cap${i}.png`); await page.screenshot({ path: fc, omitBackground: true }); ov.push([fc, t0, t1]);
  }
  await set(`<div id="panel"><canvas id="pc" width="1080" height="960"></canvas></div>`);
  await page.evaluate((s) => { window.__strips = s; }, strips);
  const pdir = path.join(tmp, 'panel'); fs.mkdirSync(pdir);
  const pEnd = PEN.start + 2 * PEN.gap + PEN.dur, nP = Math.round((pEnd + 0.1 - PANEL_IN[0]) * FPS);
  for (let k = 0; k < nP; k++) {
    const t = PANEL_IN[0] + k / FPS, slide = ease(Math.max(0, Math.min(1, (t - PANEL_IN[0]) / (PANEL_IN[1] - PANEL_IN[0]))));
    const prog = [0, 1, 2].map((i) => (t - PEN.start - i * PEN.gap) / PEN.dur);
    await page.evaluate(([prog, y]) => { window.__drawPanel(prog); document.getElementById('panel').style.transform = `translateY(${y}px)`; }, [prog, (1 - slide) * 960]);
    await page.screenshot({ path: path.join(pdir, `p${String(k).padStart(4, '0')}.png`), omitBackground: true });
  }
  if (PREVIEW) { fs.copyFileSync(path.join(pdir, `p${String(nP - 1).padStart(4, '0')}.png`), f('still-panel.png')); for (const [fc] of ov) fs.copyFileSync(fc, f(path.basename(fc))); await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  const panelHold = path.join(tmp, 'panel-hold.png'); fs.copyFileSync(path.join(pdir, `p${String(nP - 1).padStart(4, '0')}.png`), panelHold);
  const panelHoldT0 = PANEL_IN[0] + nP / FPS;
  await set(`<div id="end"><div id="mark"></div><div id="name">ECG <span>Studio</span></div><div id="tag">A 3D heart that computes its own ECG</div><div id="url">ecgstudio.app</div></div>`);
  const sdir = path.join(tmp, 'end'); fs.mkdirSync(sdir);
  const nE = Math.round((END + XF) * FPS);
  for (let k = 0; k < nE; k++) {
    const lt = k / FPS - XF * 0.5, cl = (a, b) => Math.max(0, Math.min(1, (lt - a) / (b - a)));
    await page.evaluate(([svg, nm, tg, ur]) => {
      document.getElementById('mark').innerHTML = svg;
      const n = document.getElementById('name'); n.style.clipPath = `inset(0 ${(1 - nm) * 50}% 0 ${(1 - nm) * 50}%)`; n.style.transform = `translateY(${(1 - nm) * 24}px)`;
      const t = document.getElementById('tag'); t.style.opacity = tg;
      const u = document.getElementById('url'); u.style.opacity = ur; u.style.transform = `translateX(-50%) scale(${0.8 + 0.2 * ur})`;
    }, [logoSvg(Math.max(0, lt)), ease(cl(1.3, 1.75)), ease(cl(1.6, 1.95)), ease(cl(1.8, 2.15))]);
    await page.screenshot({ path: path.join(sdir, `e${String(k).padStart(4, '0')}.png`) });
  }
  await browser.close();
  // compose: heart take + panel (sequence, then held) + captions, a zoom-in into the end screen
  const args = ['-y', '-loglevel', 'error', '-i', f('quiz-heart.mp4'), '-framerate', String(FPS), '-i', path.join(sdir, 'e%04d.png'),
    '-framerate', String(FPS), '-i', path.join(pdir, 'p%04d.png'), '-loop', '1', '-framerate', String(FPS), '-t', String(TAKE - panelHoldT0 + XF), '-i', panelHold];
  for (const [fc, t0, t1] of ov) args.push('-loop', '1', '-framerate', String(FPS), '-t', String(t1 - t0), '-i', fc);
  args.push('-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=48000:cl=stereo');
  const g = [`[0:v]setsar=1,settb=1/${FPS},fps=${FPS}[h]`, `[1:v]format=yuv420p,setsar=1,settb=1/${FPS},fps=${FPS}[e]`,
    `[2:v]format=rgba,setpts=PTS-STARTPTS+${PANEL_IN[0]}/TB[pa]`, `[3:v]format=rgba,setpts=PTS-STARTPTS+${panelHoldT0.toFixed(4)}/TB[pb]`,
    `[h][pa]overlay=eof_action=pass[h1]`, `[h1][pb]overlay=eof_action=pass[h2]`];
  let v = '[h2]';
  ov.forEach(([, t0, t1], j) => {
    const d = t1 - t0;
    g.push(`[${j + 4}:v]format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0, d - 0.2)}:d=0.2:alpha=1,setpts=PTS-STARTPTS+${t0}/TB[o${j}]`);
    g.push(`${v}[o${j}]overlay=x=0:y='if(lt(t,${t0 + 0.22}),-60*(1-(t-${t0})/0.22),0)':eof_action=pass[v${j}]`); v = `[v${j}]`;
  });
  g.push(`${v}format=yuv420p,setsar=1,settb=1/${FPS},fps=${FPS}[hv]`, `[hv][e]xfade=transition=zoomin:duration=${XF}:offset=${(TAKE - XF).toFixed(3)},format=yuv420p[vout]`);
  const final = f('ecgstudio-quiz-flutter.mp4');
  args.push('-filter_complex', g.join(';'), '-map', '[vout]', '-map', `${ov.length + 4}:a`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-t', TOTAL.toFixed(3), '-movflags', '+faststart', final);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(final, TOTAL.toFixed(1) + ' s');
})().catch((e) => { console.error(e); process.exit(1); });
