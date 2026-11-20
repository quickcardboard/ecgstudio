// Google Play promo video (30 s, landscape 1920x1080, 60 fps): one continuous camera move around and into the 3D heart, in
// slow motion so the depolarisation (blue) and repolarisation (green) waves can be followed cell by cell, with the scenario
// changing while the camera travels (sinus beat, the cut into the conduction system, left bundle branch block, VT, a shock,
// a coronary occlusion); then the view pulls back to reveal the whole app and glides to the 12-lead ECG that heart produces,
// the app slides away for Training on a phone, and the logo assembles: its voxels drop into place and the activation wave
// sweeps across them. The page is index.html from file:// with the panels hidden; time is stepped one frame
// per capture (any machine, smooth 60 fps). Captions, the shock flash and the logo animation are composited with ffmpeg.
// Not part of the build.
//   node tools/promo_store.js <outdir> [--skip-take]     (--skip-take: reuse the recorded parts in <outdir>, redo the rest)
// TAKE_SECONDS=n records only the take's first n s and logs the timing of each speed segment (for tuning).
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process'), { chromium } = require('playwright');
const G = require('./logo/gen.js');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '.');
const SKIP_TAKE = process.argv.includes('--skip-take');
const FPS = 60, CW = 1280, CH = 720, DSF = 1.5, TAKE = 21.6, APP = 3.8, XF = 0.4, TRAIN = 2.4, LOGO = 2.6;
const TOTAL = TAKE + APP - XF + TRAIN + LOGO;   // 30 s

// ---------------------------------------------------------------------------------------------------------------------
// The take. Camera keyframes [t, azimuth °, elevation °, distance (1: the app's framing), cut %], eased between consecutive
// keyframes. Azimuth and elevation are relative to the app's chest view; roll tilts the camera about its line of sight.
const CAM = [   // [t, azimuth, elevation, distance, cut %, roll °]
  [0.0, -60, 35, 1.7, 0, -18], [2.0, -18, 10, 0.84, 0, 6], [5.5, 6, -6, 0.74, 0, -4],     // swoop down from far above; a sinus beat
  [7.0, 0, 0, 0.86, 100, 0], [10.5, 8, 4, 0.78, 100, 3],                                    // level out as the cut opens: conduction
  [11.6, -35, -10, 0.82, 100, -8], [14.6, -48, 6, 0.78, 100, 5],                            // dip under while sweeping round: LBBB
  [16.0, -105, 25, 0.9, 0, -14], [18.4, -160, -12, 0.8, 0, 12],                             // rise over, then swing under, leaning: VT
  [19.4, -215, 8, 0.9, 0, -6], [21.6, -300, 4, 0.82, 0, 0],                                 // shock; level again for the reveal
];
// Simulated time per frame: [t0, t1, speed] (×real time), or [t0, t1, 'align', lead]: arrive lead ms before the next sinus
// beat (atrial onset) at t1, spread evenly over the frames
const SPEED = [
  [0, 2.0, 'align', 20], [2.0, 2.9, 0.13], [2.9, 5.5, 0.065],   // (outside: the atria, then the wave breaking through to the ventricular surface)
  [5.5, 7.0, 'align', 40], [7.0, 7.8, 0.15], [7.8, 10.5, 0.06],
  [10.5, 11.6, 'align', -90], [11.6, 14.6, 0.06],
  [14.6, 16.0, 1], [16.0, 18.4, 0.33], [18.4, 19.4, 0.5], [19.4, 99, 0.33],
];
// events at t: page code (window.ECGStudioApp is A)
const OCCLUDE = `A.ischemia.occlude(A.model.coronary.branches.LAD[0]); A.ischemia.hours(1)`;
const EVENTS = [
  [10.5, `A.sim.setBlock('LBB', 'complete', {})`],
  [14.6, `A.sim.setBlock('LBB', null); document.querySelector('#rhythmList button[data-arr="vt"]').click()`],
  [18.6, `document.getElementById('btnShock').click()`],
  [18.9, OCCLUDE],
];
// captions [t0, t1, text, colour legend] on the final timeline
const CAPTIONS = [
  [0.6, 5.3, 'Watch a heartbeat spread through the heart, cell by cell', true],
  [7.0, 10.4, 'The bundle branches activated the ventricles'],
  [11.7, 14.5, 'Block the left bundle branch, and the wave takes the long way'],
  [16.1, 18.4, 'Trigger a VT, then defibrillate'],
  [19.6, 21.5, 'Block a coronary artery and see the change on the ECG'],
  [22.6, 25.0, 'Every beat drives a live simulated ECG'],
];
const FLASH = [18.6];

const ease = (u) => u * u * (3 - 2 * u);
function camAt(t) {
  const k = CAM.findIndex((c) => c[0] > t);
  if (k < 0) return CAM[CAM.length - 1].slice(1);
  if (k === 0) return CAM[0].slice(1);
  const a = CAM[k - 1], b = CAM[k], e = ease((t - a[0]) / (b[0] - a[0]));
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * e);
}

async function take(browser, file) {
  const ctx = await browser.newContext({ viewport: { width: CW, height: CH }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('file://' + path.join(root, 'index.html') + '#r=72');
  await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.addStyleTag({ content: `#pane3d { position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; border-radius: 0 !important; margin: 0 !important; border: 0 !important; }
    #pane3d > :not(#c3d) { display: none !important; } #c3d { width: 100% !important; height: 100% !important; }` });
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.ECGStudioApp.tour.closeAll(); window.ECGStudioApp.tour.outside(); });
  await page.waitForTimeout(2500);   // (the view preset's camera move ends)
  await page.evaluate(() => {
    let q = []; window.__t = performance.now(); performance.now = () => window.__t;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    const A = window.ECGStudioApp, C = A.tour.controls(), cam = C.object, V = window.THREE.Vector3;
    const off0 = cam.position.clone().sub(C.target), up = cam.up.clone(), side = new V().crossVectors(up, off0).normalize();
    let cut = -1;
    window.__cam = (az, el, dist, c, roll = 0) => {
      const off = off0.clone().applyAxisAngle(side, -el * Math.PI / 180).applyAxisAngle(up, az * Math.PI / 180).multiplyScalar(dist);
      cam.position.copy(C.target).add(off); cam.up.copy(up); C.update();
      cam.up.copy(up).applyAxisAngle(off.clone().normalize(), roll * Math.PI / 180); cam.lookAt(C.target);   // (the tilt)
      C.dispatchEvent({ type: 'change' });
      const ci = Math.round(c);
      if (ci !== cut) { cut = ci; const s = document.getElementById('cutDepth'); s.value = ci; s.dispatchEvent(new Event('input')); }
    };
    window.__step = (dt, camv) => { window.__t += dt; if (camv) window.__cam(...camv); const cbs = q; q = []; for (const cb of cbs) cb(window.__t); };
    window.__nextBeat = (lead) => { const S = A.sim, per = 60000 / 72; let n = S.nextSinus(); while (n - lead < S.t + 30) n += per; return n - lead - S.t; };   // (the sinus node's next firing)
  });
  await page.waitForTimeout(100);
  const step = (dt, camv) => page.evaluate(([dt, camv]) => window.__step(dt, camv), [dt, camv]);
  // pre-roll (5 s) in steps under the app's 'falling behind' threshold (34 ms), so its adaptive quality never drops the
  // frame rate or resolution of the 3D view
  for (let i = 0; i < 160; i++) await step(1000 / 32, camAt(0));
  if (process.env.TAKE_SECONDS) console.log('quality', await page.evaluate(() => { const Q = window.ECGStudioApp.quality; return [Q.every, Q.dpr]; }));
  const cdp = await ctx.newCDPSession(page);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((+process.env.TAKE_SECONDS || TAKE) * FPS), ev = [...EVENTS];
  let seg = null, perFrame = 0;
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    while (ev.length && ev[0][0] <= t) { const [, js] = ev.shift(); await page.evaluate((js) => { const A = window.ECGStudioApp; eval(js); }, js); }
    const s = SPEED.find((x) => t >= x[0] && t < x[1]) || SPEED[SPEED.length - 1];
    if (s !== seg) {   // a new speed segment: an align spreads the time to the next beat over its frames
      seg = s;
      if (s[2] === 'align') { const ms = await page.evaluate((l) => window.__nextBeat(l), s[3]); perFrame = ms / Math.round((s[1] - s[0]) * FPS); }
      else perFrame = 1000 / FPS * s[2];
      if (process.env.TAKE_SECONDS) console.log('seg', s, 'S.t', await page.evaluate(() => [window.ECGStudioApp.sim.t, window.ECGStudioApp.sim.nextSinus()]), 'perFrame', perFrame);
    }
    await step(perFrame, camAt(t));
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
    if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
    if (f % (FPS * 5) === 0) console.log(`  take ${t} s`);
    if (process.env.TAKE_SECONDS && f % 12 === 0) console.log('f', f, await page.evaluate(() => [window.ECGStudioApp.sim.t, window.ECGStudioApp.quality.every]));
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// The logo animation: the mark's voxels (tools/logo/iso.js: the 9-wide upright heart, 2 deep, the wavefront raised one
// voxel) drop in, then the activation wave sweeps across them to the logo's own frame; the name and tagline follow.
const C30 = Math.cos(Math.PI / 6), proj = (x, y, z) => [(x - y) * C30, (x + y) * 0.5 - z];
const FACES = {
  top: { n: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 0.32 },
  left: { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: -0.32 },
  right: { n: [1, 0, 0], q: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], k: 0 },
};
const H9 = G.heartCells(9), PH = G.phases(H9.cells, [-0.5, -0.8]);
function logoSvg(lt, S = 420) {   // lt: seconds into the logo animation
  const front = lt < 0.75 ? -0.3 : Math.min(G.FRONT, -0.3 + (G.FRONT + 0.3) * ease(Math.min(1, (lt - 0.75) / 0.7)));
  const vox = [];
  H9.cells.forEach((c, k) => {
    const d = front - PH[k], col = G.state(d), crest = Math.exp(-Math.pow((d - 0.05) / 0.07, 2));
    const depth = 2 + Math.round(crest * 1), delay = 0.05 + (c.j * 0.05 + c.i * 0.025), u = (lt - delay) / 0.4;
    if (u <= 0) return;
    const fall = 9 * Math.pow(1 - Math.min(1, u), 3);   // (eased drop from above)
    for (let x = 0; x < depth; x++) vox.push({ x, y: H9.w - 1 - c.i, z: H9.h - 1 - c.j + fall, col, a: Math.min(1, u * 3) });
  });
  // fixed framing: the bounds of the finished mark
  const all = []; H9.cells.forEach((c) => { for (let x = 0; x < 3; x++) all.push({ x, y: H9.w - 1 - c.i, z: H9.h - 1 - c.j }); });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of all) for (const f of Object.values(FACES)) for (const q of f.q) { const [a, b] = proj(v.x + q[0], v.y + q[1], v.z + q[2]); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  const sc = (S - 12) / Math.max(x1 - x0, y1 - y0), ox = (S - (x1 - x0) * sc) / 2 - x0 * sc, oy = (S - (y1 - y0) * sc) / 2 - y0 * sc;
  const P = (x, y, z) => { const [a, b] = proj(x, y, z); return `${(ox + a * sc).toFixed(1)},${(oy + b * sc).toFixed(1)}`; };
  const occ = new Set(vox.filter((v) => v.z % 1 === 0).map((v) => `${v.x},${v.y},${v.z}`));
  let s = '';
  for (const v of [...vox].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.z - b.z)) {
    for (const f of Object.values(FACES)) {
      if (v.z % 1 === 0 && occ.has(`${v.x + f.n[0]},${v.y + f.n[1]},${v.z + f.n[2]}`)) continue;
      s += `<polygon points="${f.q.map((q) => P(v.x + q[0], v.y + q[1], v.z + q[2])).join(' ')}" fill="${G.shade(v.col, f.k)}" fill-opacity="${v.a.toFixed(2)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The app: the same heart and occlusion in the full desktop app; the view starts on the heart and pulls back to the whole
// window, then glides to the 12-lead ECG. The capture rectangle does the moving (sharp at every zoom).
async function appReveal(browser, file, lastPng) {
  const ctx = await browser.newContext({ viewport: { width: CW, height: CH }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('file://' + path.join(root, 'index.html') + '#r=72');
  await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.evaluate(() => { const T = window.ECGStudioApp.tour; T.closeAll(); T.outside(); const b = document.querySelector('#tabs [aria-selected="true"]'); if (b) b.click(); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    let q = []; window.__t = performance.now(); performance.now = () => window.__t;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    const A = window.ECGStudioApp, C = A.tour.controls(), cam = C.object, V = window.THREE.Vector3;
    const off0 = cam.position.clone().sub(C.target), up = cam.up.clone(), side = new V().crossVectors(up, off0).normalize();
    window.__cam = (az, el, dist) => {
      const off = off0.clone().applyAxisAngle(side, -el * Math.PI / 180).applyAxisAngle(up, az * Math.PI / 180).multiplyScalar(dist);
      cam.position.copy(C.target).add(off); cam.lookAt(C.target); C.update(); C.dispatchEvent({ type: 'change' });
    };
    window.__step = (dt) => { window.__t += dt; const cbs = q; q = []; for (const cb of cbs) cb(window.__t); };
  });
  await page.waitForTimeout(100);
  const [az, el, dist] = camAt(TAKE);
  await page.evaluate(([az, el, dist, js]) => { window.__cam(az, el, dist); const A = window.ECGStudioApp; eval(js); }, [az, el, dist, OCCLUDE]);
  for (let i = 0; i < 384; i++) await page.evaluate(() => window.__step(1000 / 32));   // 12 s: the ECG is acquired and read (small steps: full quality)
  const R = await page.evaluate(() => Object.fromEntries(['pane3d', 'cecg'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
  const fit = (cx, cy, w) => { w = Math.min(w, CW); const h = w * 9 / 16; return { x: Math.min(Math.max(cx - w / 2, 0), CW - w), y: Math.min(Math.max(cy - h / 2, 0), CH - h), w }; };
  const p = R.pane3d, e = R.cecg;
  const start = fit(p.x + p.w / 2, p.y + p.h * 0.5, p.h * 0.78 * 16 / 9),   // (the heart about as large as in the take)
    full = { x: 0, y: 0, w: CW }, ecg = fit(e.x + e.w * 0.69, e.y + e.h * 0.5, e.w * 0.62);
  const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u });
  const rectAt = (t) => t < 1.3 ? lerp(start, full, ease(t / 1.3)) : t < 2.1 ? full : t < 3.0 ? lerp(full, ecg, ease((t - 2.1) / 0.9)) : ecg;
  const cdp = await ctx.newCDPSession(page);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(APP * FPS);
  let last = null;
  for (let f = 0; f < n; f++) {
    await page.evaluate(() => window.__step(1000 / 60));
    const r = rectAt(f / FPS);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: r.x, y: r.y, width: r.w, height: r.w * 9 / 16, scale: 1920 / r.w } });
    last = Buffer.from(shot.data, 'base64');
    if (!ff.stdin.write(last)) await new Promise((res) => ff.stdin.once('drain', res));
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=1920:1080', lastPng], { input: last });
  await ctx.close();
}

// Training on a phone: a question as the trainee sees it
async function trainingShot(browser, file) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(root, 'training', 'index.html'));
  await page.waitForFunction(() => { const b = document.getElementById('btnTrain'); return b && b.offsetParent; }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.click('#btnTrain');
  await page.waitForTimeout(16000);   // (the first ECG is generated)
  await page.screenshot({ path: file });
  await ctx.close();
}

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=IBM+Plex+Sans+Condensed:wght@700&display=block');`;
const CSS = `${FONTS}
html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; font-family: 'IBM Plex Sans', sans-serif; color: #fff; }
.cap { position: absolute; left: 50%; bottom: 90px; transform: translateX(-50%); width: max-content; max-width: 1560px; text-align: center; }
.cap b { display: inline-block; padding: 22px 44px 24px; border-radius: 24px; background: rgba(9, 15, 22, 0.74); font: 700 52px/1.15 'IBM Plex Sans', sans-serif;
  border-bottom: 6px solid #ef5b7a; box-shadow: 0 10px 40px rgba(0,0,0,0.35); max-width: 1240px; text-wrap: balance; }
.cap i { display: block; margin-top: 14px; font-style: normal; font-size: 32px; font-weight: 500; color: #d6e0e8; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
.cap i span { display: inline-block; width: 22px; height: 22px; border-radius: 50%; vertical-align: -2px; margin: 0 8px 0 18px; }
#scene { position: absolute; inset: 0; background: radial-gradient(ellipse at 60% 50%, #172533, #0b131a 75%); overflow: hidden; }
#app { position: absolute; inset: 0; width: 1920px; height: 1080px; transform-origin: 50% 50%; box-shadow: 0 0 80px rgba(0,0,0,0.6); }
#phone { position: absolute; top: 70px; left: 1060px; width: 432px; height: 928px; border-radius: 64px; background: #05090d; padding: 14px;
  box-shadow: 0 30px 90px rgba(0,0,0,0.6), inset 0 0 0 2px #2a3947; }
#phone img { width: 432px; height: 928px; border-radius: 52px; display: block; }
#ttl { position: absolute; left: 170px; top: 380px; width: 800px; }
#ttl h2 { margin: 0 0 22px; font: 700 96px/1.02 'IBM Plex Sans Condensed', sans-serif; }
#ttl h2 span { color: #ef5b7a; }
#ttl p { margin: 0; font-size: 44px; line-height: 1.3; color: #c9d3dc; font-weight: 500; }
#veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, #121e29, #0b131a 70%); }
#mark { position: absolute; left: 50%; top: 112px; transform: translateX(-50%); width: 420px; height: 420px; }
#name { position: absolute; left: 0; right: 0; top: 590px; text-align: center; font: 700 150px/1 'IBM Plex Sans Condensed', sans-serif; letter-spacing: 0.01em; }
#name span { color: #ef5b7a; }
#tag { position: absolute; left: 0; right: 0; top: 780px; text-align: center; font-size: 52px; font-weight: 500; color: #d6e0e8; }
#sub { position: absolute; left: 0; right: 0; top: 862px; text-align: center; font-size: 36px; color: #93a3b1; letter-spacing: 0.04em; }`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const f = (n) => path.join(out, n), have = (n) => SKIP_TAKE && fs.existsSync(f(n));
  if (!have('store-take.mp4')) await take(browser, f('store-take.mp4'));
  if (!have('store-app.mp4') || !have('store-app-last.png')) await appReveal(browser, f('store-app.mp4'), f('store-app-last.png'));
  if (!have('store-training.png')) await trainingShot(browser, f('store-training.png'));
  console.log('  recorded');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const tmp = fs.mkdtempSync(path.join(out, '.store-'));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const setPage = async (html) => { await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`); await page.evaluate(() => document.fonts.ready); };
  // captions (transparent PNGs)
  const ov = [];
  for (const [i, [t0, t1, text, legend]] of CAPTIONS.entries()) {
    const fc = path.join(tmp, `cap${i}.png`);
    await setPage(`<div class="cap"><b>${esc(text)}</b>${legend ? '<i><span style="background:#2f63f0"></span>Depolarising<span style="background:#23b462"></span>Repolarising</i>' : ''}</div>`);
    await page.screenshot({ path: fc, omitBackground: true });
    ov.push([fc, t0, t1]);
  }
  // the closing scene, frame by frame: the app slides away, Training on a phone slides in, then the logo
  const dataUri = (p) => 'data:image/' + (p.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(p).toString('base64');
  await setPage(`<div id="scene"><div id="ttl"><h2>Then <span>test</span> yourself in training mode</h2><p>ECGs chosen for your level, with ratings and reviews</p></div>
    <div id="phone"><img src="${dataUri(f('store-training.png'))}"></div><img id="app" src="${dataUri(f('store-app-last.png'))}">
    <div id="veil"></div><div id="mark"></div><div id="name">ECG <span>Studio</span></div>
    <div id="tag">A 3D heart that computes its own 12-lead ECG</div><div id="sub">LEARN · EXPLORE · PRACTICE</div></div>`);
  const sdir = path.join(tmp, 'seq'); fs.mkdirSync(sdir);
  const nS = Math.round((TRAIN + LOGO) * FPS);
  for (let k = 0; k < nS; k++) {
    const t = k / FPS, lt = t - TRAIN, cl = (a, b, x = t) => Math.max(0, Math.min(1, (x - a) / (b - a)));
    await page.evaluate(([st, svg]) => {
      const $ = (id) => document.getElementById(id);
      $('app').style.transform = `translateX(${-st.app * 2050}px) scale(${1 - 0.12 * st.app})`;
      $('phone').style.transform = `translateX(${(1 - st.ph) * 1000}px) translateY(${Math.sin(st.t * 2.2) * 6}px) rotate(${(1 - st.ph) * 6}deg)`;
      $('ttl').style.opacity = st.ttl; $('ttl').style.transform = `translateY(${(1 - st.ttl) * 30}px)`;
      $('veil').style.opacity = st.veil; $('mark').innerHTML = svg;
      $('name').style.clipPath = `inset(0 ${(1 - st.nm) * 50}% 0 ${(1 - st.nm) * 50}%)`; $('name').style.transform = `translateY(${(1 - st.nm) * 24}px)`;
      $('tag').style.opacity = st.tg; $('tag').style.transform = `translateY(${(1 - st.tg) * 18}px)`; $('sub').style.opacity = st.sb;
    }, [{ t, app: ease(cl(0, 0.7)), ph: ease(cl(0.15, 0.85)), ttl: ease(cl(0.55, 1.0)), veil: ease(cl(0, 0.45, lt)),
      nm: ease(cl(1.3, 1.75, lt)), tg: ease(cl(1.6, 1.95, lt)), sb: ease(cl(1.8, 2.15, lt)) }, lt > 0 ? logoSvg(lt) : '']);
    await page.screenshot({ path: path.join(sdir, `s${String(k).padStart(4, '0')}.png`) });
  }
  await browser.close();
  // compose: take ⨯ app (crossfade), then the closing scene; captions, the shock flash; a silent audio track
  const args = ['-y', '-loglevel', 'error', '-i', f('store-take.mp4'), '-i', f('store-app.mp4'), '-framerate', String(FPS), '-i', path.join(sdir, 's%04d.png')];
  for (const [fc, t0, t1] of ov) args.push('-loop', '1', '-framerate', String(FPS), '-t', String(t1 - t0), '-i', fc);
  args.push('-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=48000:cl=stereo');
  const g = [`[0:v]settb=1/${FPS},fps=${FPS}[a0]`, `[1:v]settb=1/${FPS},fps=${FPS}[a1]`, `[2:v]format=yuv420p,settb=1/${FPS},fps=${FPS}[a2]`,
    `[a0][a1]xfade=transition=fade:duration=${XF}:offset=${TAKE - XF}[x1]`, `[x1][a2]concat=n=2:v=1:a=0[x2]`];
  let v = '[x2]';
  ov.forEach(([, t0, t1], j) => {
    const d = t1 - t0;
    g.push(`[${j + 3}:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${Math.max(0, d - 0.3)}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${t0}/TB[o${j}]`);
    g.push(`${v}[o${j}]overlay=0:0:eof_action=pass[v${j}]`); v = `[v${j}]`;
  });
  for (const [j, fl] of FLASH.entries()) {
    g.push(`${v}drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=fill:enable='between(t,${fl},${fl + 0.06})',drawbox=x=0:y=0:w=iw:h=ih:color=white@0.5:t=fill:enable='between(t,${fl + 0.06},${fl + 0.14})',drawbox=x=0:y=0:w=iw:h=ih:color=white@0.2:t=fill:enable='between(t,${fl + 0.14},${fl + 0.24})'[f${j}]`);
    v = `[f${j}]`;
  }
  g.push(`${v}format=yuv420p[vout]`);
  const final = f('ecgstudio-play-promo.mp4');
  args.push('-filter_complex', g.join(';'), '-map', '[vout]', '-map', `${ov.length + 3}:a`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-t', TOTAL.toFixed(3), '-movflags', '+faststart', final);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(final, TOTAL.toFixed(2) + ' s');
})().catch((e) => { console.error(e); process.exit(1); });
