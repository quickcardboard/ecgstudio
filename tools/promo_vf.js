// "Recipe for disaster": a ~20 s portrait promo (1080x1920, 60 fps) for TikTok / Shorts / Reels. A cold open on ventricular
// fibrillation, then the recipe on a healthy heart: a click blocks the LAD, the ischaemic muscle shows, and a click on that
// muscle during the T wave (the simulator's own R-on-T rule: a ventricular stimulus late in repolarisation of an acutely
// ischaemic heart, src/engine.js stimulate / vulnerable) starts VF. An on-screen pointer shows each click; the camera rolls,
// tilts and zooms; captions, flashes and the animated logo end screen are composited with ffmpeg.
// The page is the phone layout of index.html (?noworker: the engine steps on the page, so time can be stepped one frame per
// capture), drawn at 4x with the canvas pixel-ratio caps raised; each frame captures the zoom rectangle (sharp at any zoom).
//   node tools/promo_vf.js <outdir> [--skip-take]          (~10 min; --skip-take reuses the recorded parts)
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process'), { chromium } = require('playwright');
const { logoSvg, ease } = require('./promo_logo.js');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '.');
const SKIP = process.argv.includes('--skip-take');
const FPS = 60, VW = 432, VH = 768, OUT = 2.5, DSF = 4;   // (CSS px; frames 1080x1920)
const SEG1 = 3.0, SEG2 = 13.8, END = 2.8, XF = 0.35, TOTAL = SEG1 + SEG2 + END;   // 19.6 s

// keyframes, eased between consecutive ones: heart camera [t, azimuth°, elevation°, distance, roll°] (relative to the app's
// chest view) and the zoom rectangle [t, zoom, cx, cy] (CSS px of the phone page)
const SHOTS = {
  vf: {
    hash: 'r=72&a=vf', group: 0, speed: [[0, 9, 0.5]],
    heart: [[0, -30, 25, 0.72, -15], [1.4, 10, 8, 0.8, 4], [2.6, 40, -8, 0.8, 12], [3.0, 100, -5, 0.62, 32]],
    zoom: [[0, 1.35, 216, 250], [1.2, 1.0, 216, 384], [2.6, 1.0, 216, 384], [3.0, 1.6, 216, 250]],
  },
  recipe: {
    hash: 'r=72', group: 2,
    heart: [[0, -60, 20, 0.95, -24], [0.35, -15, 8, 0.95, 0], [1.6, 0, 4, 0.9, 0], [3.4, 0, 4, 0.9, 0], [4.6, -30, 18, 0.85, -10],
      [5.8, 25, -6, 0.85, 8], [6.6, 10, 0, 0.88, 0], [7.3, 0, 2, 0.85, 0], [8.9, 0, 2, 0.85, 0], [10.2, 20, 6, 0.85, 6], [13.8, 200, -10, 0.95, -15]],
    zoom: [[0, 1.3, 216, 250], [0.35, 1.0, 216, 384], [0.6, 1.0, 216, 384], [1.5, 1.6, 226, 238], [2.6, 1.6, 226, 238], [3.4, 1.15, 216, 300],
      [5.4, 1.15, 216, 300], [6.0, 1.45, 216, 545], [6.6, 1.45, 216, 545], [7.3, 1.5, 216, 255], [10.2, 1.5, 216, 255], [10.6, 1.0, 216, 384], [13.8, 1.08, 216, 384]],
    shake: [10.2, 13.8],   // (VF: the camera trembles)
  },
};
const CLICK_LAD = [1.5, 1.68], CLICK_PVC = 8.6;   // recipe-local times (s)
const LAD_AT = 0.2;   // the occlusion site: this far along the LAD
const CAPTIONS = [
  [0.15, 2.85, 'This is a recipe for disaster', 'hook'],
  [3.35, 6.35, '1 blocked artery'],
  [6.45, 9.5, 'A dash of damaged myocardium'],
  [9.65, 12.95, 'A well timed PVC'],
  [13.05, 16.6, 'and out comes ventricular fibrillation', 'hot'],
];

const lerpKeys = (keys, t) => {
  const k = keys.findIndex((c) => c[0] > t);
  if (k < 0) return keys[keys.length - 1].slice(1);
  if (k === 0) return keys[0].slice(1);
  const a = keys[k - 1], b = keys[k], e = ease((t - a[0]) / (b[0] - a[0]));
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * e);
};
function clipAt(keys, t) {
  const [z, cx, cy] = lerpKeys(keys, t), w = VW / z, h = VH / z;
  return { x: Math.min(Math.max(cx - w / 2, 0), VW - w), y: Math.min(Math.max(cy - h / 2, 0), VH - h), width: w, height: h, scale: OUT * z };
}

async function openPage(browser, url, hash, group) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url + '?noworker#' + hash);
  await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.evaluate(() => { const T = window.ECGStudioApp.tour; T.closeAll(); T.outside(); });
  await page.waitForTimeout(2500);
  // time by hand, the heart camera, the pointer and its click ripples (page elements, so they zoom with the capture)
  await page.evaluate(() => {
    let q = []; window.__t = performance.now(); performance.now = () => window.__t;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    const A = window.ECGStudioApp, C = A.tour.controls(), cam = C.object, V = window.THREE.Vector3;
    const off0 = cam.position.clone().sub(C.target), up = cam.up.clone(), side = new V().crossVectors(up, off0).normalize();
    window.__cam = (az, el, dist, roll) => {
      const off = off0.clone().applyAxisAngle(side, -el * Math.PI / 180).applyAxisAngle(up, az * Math.PI / 180).multiplyScalar(dist);
      cam.position.copy(C.target).add(off); cam.up.copy(up); C.update();
      cam.up.copy(up).applyAxisAngle(off.clone().normalize(), roll * Math.PI / 180); cam.lookAt(C.target);
      C.dispatchEvent({ type: 'change' });
    };
    window.__step = (dt, camv) => { window.__t += dt; if (camv) window.__cam(...camv); const cbs = q; q = []; for (const cb of cbs) cb(window.__t); };
    const css = document.createElement('style');
    css.textContent = `#vfPtr { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483647; pointer-events: none; display: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); }
      .vfRip { position: fixed; z-index: 2147483646; pointer-events: none; width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%;
        border: 4px solid #ffd23f; box-shadow: 0 0 18px rgba(255,210,63,0.8); display: none; }`;
    document.head.appendChild(css);
    const ptr = document.createElement('div'); ptr.id = 'vfPtr';
    ptr.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l15 7.5-6.5 1.8L9 18z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(ptr);
    window.__ptr = (x, y, on) => { ptr.style.display = on ? 'block' : 'none'; ptr.style.transform = `translate(${x - 4}px, ${y - 3}px)`; };
    window.__rip = (list) => {   // [{x, y, k (0..1 of the ripple's life)}]
      const els = document.querySelectorAll('.vfRip');
      list.forEach((r, i) => {
        let e = els[i]; if (!e) { e = document.createElement('div'); e.className = 'vfRip'; document.body.appendChild(e); }
        e.style.display = 'block'; e.style.left = r.x + 'px'; e.style.top = r.y + 'px';
        e.style.transform = `scale(${0.3 + 1.2 * r.k})`; e.style.opacity = String(1 - r.k);
      });
      for (let i = list.length; i < els.length; i++) els[i].style.display = 'none';
    };
  });
  await page.waitForTimeout(100);
  if (group) await page.evaluate((i) => { const d = document.querySelectorAll('#mDots button')[i]; if (d) d.click(); }, group);
  const step = (dt, camv) => page.evaluate(([dt, camv]) => window.__step(dt, camv), [dt, camv]);
  return { ctx, page, step, cdp: await ctx.newCDPSession(page) };
}
function encoder(file) {
  return spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-vf', 'scale=1080:1920:flags=lanczos,setsar=1',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
}
async function frame(P, ff, clip) {
  const r = await P.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip });
  if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
}
const close = async (ff) => { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); };

// 1: the cold open, VF
async function recordVF(browser, url, file) {
  const S = SHOTS.vf, P = await openPage(browser, url, S.hash, S.group);
  for (let i = 0; i < 352; i++) await P.step(1000 / 32, lerpKeys(S.heart, 0));   // 11 s: past the read; (steps under 34 ms: full quality)
  const ff = encoder(file);
  for (let f = 0; f < Math.round(SEG1 * FPS); f++) {
    const t = f / FPS;
    await P.step(1000 / FPS * 0.5, lerpKeys(S.heart, t));
    await frame(P, ff, clipAt(S.zoom, t));
  }
  await close(ff); await P.ctx.close();
}

// 2: the recipe. Returns the recipe-local time VF began.
async function recordRecipe(browser, url, file) {
  const S0 = SHOTS.recipe, P = await openPage(browser, url, S0.hash, S0.group), pg = P.page;
  for (let i = 0; i < 352; i++) await P.step(1000 / 32, lerpKeys(S0.heart, 0));
  // the occlusion: the LAD a fifth of the way along, where it runs down the front of the heart in plain view
  const ladNode = await pg.evaluate((f) => { const ids = window.ECGStudioApp.model.coronary.branches.LAD; return ids[Math.round(ids.length * f)]; }, LAD_AT);
  // turn the recipe so the LAD faces the camera: +55° from the app's chest view puts it down the middle of the front (checked
  // on screenshots: the chest view shows it to one side, negative angles show it through the heart from behind)
  const AZ0 = 55;
  const S = { ...S0, heart: S0.heart.map(([t, az, ...rest]) => [t, az + AZ0, ...rest]) };
  await pg.evaluate((c) => window.__cam(...c), lerpKeys(S.heart, 1.6));
  const ladView = await pg.evaluate((n) => window.ECGStudioApp.coronaryScreen(n), ladNode);
  S.zoom = S0.zoom.map((k) => (k[0] >= 1.5 && k[0] <= 2.6 ? [k[0], k[1], ladView.x, ladView.y] : k));
  console.log('  LAD facing the camera at azimuth', AZ0, '; on screen at', Math.round(ladView.x), Math.round(ladView.y));
  await pg.evaluate((c) => window.__cam(...c), lerpKeys(S.heart, 0));
  const ladAt = () => pg.evaluate((n) => window.ECGStudioApp.coronaryScreen(n), ladNode);
  // the PVC's target: the middle of the purple (ischaemic) muscle as drawn, so the click lands on damaged tissue in sight
  const zoneAt = async () => {
    const shot = await P.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 } });
    const png = path.join(out, '.vf-zone.png'); fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
    const r = execFileSync('python3', ['-I', path.join(__dirname, 'promo_purple.py'), png]).toString().trim().split(' ').map(Number);
    fs.rmSync(png, { force: true });
    return r.length === 3 && r[2] > 40 ? { x: r[0], y: r[1] } : null;
  };
  const ff = encoder(file), n = Math.round(SEG2 * FPS);
  const ptrFrom = { x: VW * 0.85, y: VH * 0.9 };
  let perFrame = 1000 / FPS, alignSet = false, slowSet = false, vfAt = null, pvcTarget = null, pvcDone = false, ladDone = false;
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    // simulated time: real time, then (to land the click on the T wave) an align and a slow-motion approach
    if (t < 6.6) perFrame = 1000 / FPS;
    else if (t < 8.0) {
      if (!alignSet) {
        alignSet = true;
        const ms = await pg.evaluate((slowMs) => {   // the end of the T wave of an upcoming beat, less a margin
          const S = window.ECGStudioApp.sim, v = S.log.vent[S.log.vent.length - 1], a = S.log.atrial[S.log.atrial.length - 1];
          // (the vulnerable window: from 60% of the way through the beat's repolarisation to 20 ms after its end; aim at 85%)
          const delta = v.on - a.on, rep = (v.repEnd || v.on + 0.8 * S.qtEnd()) - v.on, per = 60000 / 72;
          let tc = S.nextSinus() + delta + 0.85 * rep;
          while (tc - slowMs - S.t < 250) tc += per;
          return tc - slowMs - S.t;
        }, 0.25 * 0.6 * 1000);
        perFrame = ms / Math.round(1.4 * FPS);
      }
    } else if (t < 10.2) { if (!slowSet) { slowSet = true; } perFrame = 1000 / FPS * 0.25; }
    else perFrame = 1000 / FPS * Math.min(0.6, 0.25 + (t - 10.2) * 0.6);
    // the heart camera, with a tremor once VF runs
    const hc = lerpKeys(S.heart, t);
    if (t >= S.shake[0]) { const s = Math.min(1, (t - S.shake[0]) / 0.3); hc[3] += s * 4 * Math.sin(t * 37); hc[0] += s * 2.5 * Math.sin(t * 23); }
    await P.step(perFrame, hc);
    // the pointer: to the LAD, a double click; then to the ischaemic muscle, a click on the T wave
    let ptr = null; const rips = [];
    if (t >= 0.5 && t < 3.0) {
      const lad = await ladAt(), u = ease(Math.min(1, (t - 0.5) / 0.9));
      ptr = { x: ptrFrom.x + (lad.x - ptrFrom.x) * u, y: ptrFrom.y + (lad.y - ptrFrom.y) * u };
      for (const ct of CLICK_LAD) if (t >= ct && t < ct + 0.45) rips.push({ x: lad.x, y: lad.y, k: (t - ct) / 0.45 });
      if (!ladDone && t >= CLICK_LAD[1]) { ladDone = true; await pg.evaluate((nd) => { const A = window.ECGStudioApp; A.ischemia.occlude(nd); A.ischemia.hours(1); }, ladNode); }
    } else if (t >= 7.3 && t < 10.0 && (pvcTarget || t < 7.9 || (pvcTarget = { x: 216, y: 260, fallback: true }))) {
      // (the camera holds still from 7.3 s to after the click; while the ventricles are mid-beat no purple shows: try again)
      if (!pvcTarget) { pvcTarget = await zoneAt(); if (pvcTarget) { pvcTarget.t0 = t; console.log('  PVC target', JSON.stringify(pvcTarget)); } }
    }
    if (pvcTarget && t >= 7.3 && t < 10.0) {
      if (pvcTarget.fallback && !pvcTarget.t0) { pvcTarget.t0 = t; console.log('  WARNING: no purple found; clicking the default point'); }
      const from = { x: VW * 0.8, y: VH * 0.62 }, u = ease(Math.min(1, (t - pvcTarget.t0) / 0.9));
      ptr = { x: from.x + (pvcTarget.x - from.x) * u, y: from.y + (pvcTarget.y - from.y) * u };
      if (t >= CLICK_PVC && t < CLICK_PVC + 0.6) rips.push({ x: pvcTarget.x, y: pvcTarget.y, k: (t - CLICK_PVC) / 0.6 });
      if (!pvcDone && t >= CLICK_PVC) {
        pvcDone = true;
        await pg.touchscreen.tap(pvcTarget.x, pvcTarget.y);   // (the app's own tap: an ectopic beat from the muscle under the finger)
        await pg.waitForTimeout(700);
        const rec = await pg.evaluate(() => { const S = window.ECGStudioApp.sim, r = S.stimLog[S.stimLog.length - 1]; return r && { kind: r.kind, ronT: !!r.ronT, isch: S.ischLevel ? +S.ischLevel[r.cell].toFixed(2) : null, vuln: S.vulnerable() }; });
        console.log('  PVC click:', JSON.stringify(rec));
        if (!rec || !rec.ronT) console.log('  WARNING: the click did not fall in the vulnerable window; VF will not follow');
      }
    }
    await pg.evaluate(([p, r]) => { window.__ptr(p ? p.x : 0, p ? p.y : 0, !!p); window.__rip(r); }, [ptr, rips]);
    if (vfAt === null) { const vf = await pg.evaluate(() => { const a = window.ECGStudioApp.sim.arrhythmia; return !!(a && a.type === 'vf'); }); if (vf) vfAt = t; }
    await frame(P, ff, clipAt(S.zoom, t));
    if (f % (FPS * 2) === 0) console.log(`  recipe ${t.toFixed(1)} s`);
  }
  await close(ff); await P.ctx.close();
  return vfAt;
}

// the end screen: the logo builds, the wave sweeps it, the name and the address (a 1080x1920 PNG sequence)
const CSS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=IBM+Plex+Sans+Condensed:wght@700&display=block');
html, body { margin: 0; width: 1080px; height: 1920px; background: transparent; overflow: hidden; font-family: 'IBM Plex Sans', sans-serif; color: #fff; }
.cap { position: absolute; left: 50%; top: 260px; transform: translateX(-50%); width: max-content; max-width: 900px; text-align: center; }
.cap b { display: inline-block; padding: 26px 44px 30px; border-radius: 28px; background: rgba(9,15,22,0.86); font: 700 64px/1.12 'IBM Plex Sans Condensed', sans-serif;
  border-bottom: 8px solid #ef5b7a; box-shadow: 0 10px 40px rgba(0,0,0,0.4); text-wrap: balance; }
.cap.hook b { font-size: 84px; }
.cap.hot b { border-bottom-color: #ffd23f; }
#end { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 42%, #172533, #0b131a 72%); }
#mark { position: absolute; left: 50%; top: 470px; transform: translateX(-50%); width: 460px; height: 460px; }
#name { position: absolute; left: 0; right: 0; top: 990px; text-align: center; font: 700 150px/1 'IBM Plex Sans Condensed', sans-serif; }
#name span { color: #ef5b7a; }
#tag { position: absolute; left: 0; right: 0; top: 1175px; text-align: center; font-size: 50px; font-weight: 500; color: #d6e0e8; }
#url { position: absolute; left: 50%; top: 1300px; transform: translateX(-50%); padding: 26px 60px; border-radius: 999px; background: #ef5b7a; color: #160a0d; font-size: 78px; font-weight: 700; }`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const f = (n) => path.join(out, n);
  const tmpPage = f('.vf-index.html');
  fs.writeFileSync(tmpPage, fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .split('Math.min(1.5, window.devicePixelRatio').join('Math.min(4, window.devicePixelRatio').split('Math.min(2, window.devicePixelRatio').join('Math.min(4, window.devicePixelRatio'));
  const url = 'file://' + tmpPage;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const metaFile = f('vf-meta.json');
  if (!SKIP || !fs.existsSync(f('vf-1.mp4'))) await recordVF(browser, url, f('vf-1.mp4'));
  let meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  if (!SKIP || !fs.existsSync(f('vf-2.mp4'))) { meta.vfAt = await recordRecipe(browser, url, f('vf-2.mp4')); fs.writeFileSync(metaFile, JSON.stringify(meta)); }
  console.log('  VF began at recipe', meta.vfAt, 's');
  fs.rmSync(tmpPage, { force: true });
  // captions and the end screen
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const set = async (html) => { await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`); await page.evaluate(() => document.fonts.ready); };
  const tmp = fs.mkdtempSync(path.join(out, '.vf-'));
  const ov = [];
  for (const [i, [t0, t1, text, cls]] of CAPTIONS.entries()) {
    await set(`<div class="cap ${cls || ''}"><b>${text}</b></div>`);
    const fc = path.join(tmp, `cap${i}.png`); await page.screenshot({ path: fc, omitBackground: true }); ov.push([fc, t0, t1]);
  }
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
  // compose: VF | recipe (a hard cut on the whip, with a flash), a zoom-in into the end screen; captions; flashes
  const args = ['-y', '-loglevel', 'error', '-i', f('vf-1.mp4'), '-i', f('vf-2.mp4'), '-framerate', String(FPS), '-i', path.join(sdir, 'e%04d.png')];
  for (const [fc, t0, t1] of ov) args.push('-loop', '1', '-framerate', String(FPS), '-t', String(t1 - t0), '-i', fc);
  args.push('-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=48000:cl=stereo');
  const g = [`[0:v]setsar=1,settb=1/${FPS},fps=${FPS}[a0]`, `[1:v]setsar=1,settb=1/${FPS},fps=${FPS}[a1]`, `[2:v]format=yuv420p,setsar=1,settb=1/${FPS},fps=${FPS}[a2]`,   // (setsar: the zoomed captures' aspect ratios differ by a hair)
    `[a0][a1]concat=n=2:v=1:a=0,settb=1/${FPS},fps=${FPS}[ab]`, `[ab][a2]xfade=transition=zoomin:duration=${XF}:offset=${(SEG1 + SEG2 - XF).toFixed(3)}[x]`];
  let v = '[x]';
  ov.forEach(([, t0, t1], j) => {
    const d = t1 - t0;
    g.push(`[${j + 3}:v]format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0, d - 0.2)}:d=0.2:alpha=1,setpts=PTS-STARTPTS+${t0}/TB[o${j}]`);
    g.push(`${v}[o${j}]overlay=x=0:y='if(lt(t,${t0 + 0.22}),-60*(1-(t-${t0})/0.22),0)':eof_action=pass[v${j}]`); v = `[v${j}]`;
  });
  const flash = (t, col, a = 0.85) => `drawbox=x=0:y=0:w=iw:h=ih:color=${col}@${a}:t=fill:enable='between(t,${t},${t + 0.05})',drawbox=x=0:y=0:w=iw:h=ih:color=${col}@0.45:t=fill:enable='between(t,${t + 0.05},${t + 0.13})',drawbox=x=0:y=0:w=iw:h=ih:color=${col}@0.18:t=fill:enable='between(t,${t + 0.13},${t + 0.24})'`;
  // (VF starts the instant the PVC captures; the red flash comes with the last caption, as the fibrillation spreads, so the
  // click and the PVC's wave stay visible)
  const vfT = Math.max(CAPTIONS[4][0], SEG1 + (meta.vfAt != null ? meta.vfAt : 8.9));
  g.push(`${v}${flash(SEG1 - 0.04, 'white')},${flash(vfT, 'red', 0.6)},format=yuv420p[vout]`);
  const final = f('ecgstudio-vf-recipe.mp4');
  args.push('-filter_complex', g.join(';'), '-map', '[vout]', '-map', `${ov.length + 3}:a`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-t', TOTAL.toFixed(3), '-movflags', '+faststart', final);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(final, TOTAL.toFixed(1) + ' s');
})().catch((e) => { console.error(e); process.exit(1); });
