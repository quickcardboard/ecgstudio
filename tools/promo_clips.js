// Short promotional clips of the simulator for TikTok / YouTube Shorts / Reels: the phone layout in portrait,
// 1080x1920 at 60 fps. The page clock is faked (Playwright clock) and advanced exactly one frame between screenshots,
// so the clip is smooth and in real time however slowly this machine renders; frames are piped into ffmpeg (H.264).
// The page's animation frames and performance.now are driven by hand (one frame per capture), and the page is a
// temporary copy of index.html with the canvas pixel-ratio caps (1.5 for 3D, 2 for the ECG) raised, so the frames are sharp.
// Not part of the build.
//   node tools/promo_clips.js <outdir> [stemi,af,chb] [fps]
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '.');
const which = (process.argv[3] || 'stemi,af,chb').split(',');
const FPS = +(process.argv[4] || 60);
const VW = 432, VH = 768, DSF = 2.5;   // (CSS px; 1080x1920 frames)

const CLIPS = {
  // an LAD occlusion evolving from 15 minutes to 1 month, chest leads V1–V3 shown
  stemi: {
    hash: '', group: 2,
    async run(c) {
      await c.rec(2500);
      const node = await c.page.evaluate(() => window.ECGStudioApp.model.coronary.branches.LAD[0]);
      await c.page.evaluate((n) => window.ECGStudioApp.ischemia.occlude(n), node);
      for (const [h, ms] of [[0.25, 4500], [1, 6000], [12, 4500], [48, 4500], [720, 5500]]) {
        await c.page.evaluate((h) => window.ECGStudioApp.ischemia.hours(h), h);
        await c.rec(ms);
      }
    },
  },
  // atrial fibrillation, then a shock back to sinus rhythm (lead II)
  af: {
    hash: 'r=72&a=af', group: 0,
    async run(c) { await c.rec(8000); await c.page.evaluate(() => document.getElementById('btnShock').click()); await c.rec(12500); /* (to the new read, 10 s after the shock) */ },
  },
  // complete heart block: P waves and QRS complexes each at their own rate
  chb: { hash: 'r=72&b=AVN.complete', group: 0, async run(c) { await c.rec(14000); } },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = path.join(out, '.promo-index.html');
  let h = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  h = h.split('Math.min(1.5, window.devicePixelRatio').join('Math.min(3, window.devicePixelRatio').split('Math.min(2, window.devicePixelRatio').join('Math.min(3, window.devicePixelRatio');
  fs.writeFileSync(tmp, h);
  const url = 'file://' + tmp;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of which) {
    const clip = CLIPS[name];
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(url + (clip.hash ? '#' + clip.hash : ''));
    await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 180000 });
    // drive time by hand: queued animation frames run only in step(), with performance.now at the frame's time
    await page.evaluate(() => {
      let q = []; window.__t = performance.now(); performance.now = () => window.__t;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__step = (dt) => { window.__t += dt; const cbs = q; q = []; for (const cb of cbs) cb(window.__t); };
    });
    await page.waitForTimeout(100);   // (the last real frame hands over to the queue)
    const step = (dt) => page.evaluate((dt) => window.__step(dt), dt);
    if (clip.group) { await page.evaluate((i) => document.querySelectorAll('#mDots button')[i].click(), clip.group); }
    for (let i = 0; i < 11 * 60; i++) await step(1000 / 60);   // pre-roll (11 s): past the 10 s acquisition, so the read is shown; tips fade
    await page.waitForTimeout(3000);
    const cdp = await ctx.newCDPSession(page);
    const mp4 = path.join(out, `ecgstudio-${name}-portrait.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
    let t = 0, frames = 0;
    const c = {
      page,
      async rec(ms) {                                // ms of simulated (= clip) time, one frame at a time
        const end = t + ms;
        while (t < end) {
          await step(1000 / FPS);
          t += 1000 / FPS; frames++;
          const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: VW, height: VH, scale: DSF } });
          if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
          if (frames % (FPS * 5) === 0) console.log(`  ${name} ${frames / FPS} s`);
        }
      },
    };
    await clip.run(c);
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    await ctx.close();
    console.log(mp4, `${frames} frames`);
  }
  await browser.close();
  fs.rmSync(tmp, { force: true });
})().catch((e) => { console.error(e); process.exit(1); });
