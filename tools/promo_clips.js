// Short promotional screen recordings of the simulator (for social posts): index.html from file://, recorded with
// Playwright and converted to MP4 with ffmpeg. Not part of the build; output goes to the directory given.
//   node tools/promo_clips.js <outdir> [stemi,af,chb]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2] || '.');
const which = (process.argv[3] || 'stemi,af,chb').split(',');
const url = 'file://' + path.join(root, 'index.html');
const W = 1280, H = 720;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// waits in simulated time (the recording runs at whatever speed the machine manages)
async function simWait(page, ms) {
  const t0 = await page.evaluate(() => window.ECGStudioApp.sim.t);
  await page.waitForFunction(([t0, ms]) => window.ECGStudioApp.sim.t >= t0 + ms, [t0, ms], { timeout: ms * 20 + 60000, polling: 100 });
}
const CLIPS = {
  // an LAD occlusion evolving from 15 minutes to 1 month (the time slider stops)
  async stemi(page) {
    await page.click('[data-tab="ischemia"]');
    await simWait(page, 4000);
    const node = await page.evaluate(() => window.ECGStudioApp.model.coronary.branches.LAD[0]);
    await page.evaluate((n) => window.ECGStudioApp.ischemia.occlude(n), node);
    for (const h of [0.25, 1, 12, 48, 720]) { await page.evaluate((h) => window.ECGStudioApp.ischemia.hours(h), h); await simWait(page, h === 1 ? 7000 : 5000); }
  },
  // atrial fibrillation, then a shock back to sinus rhythm
  async af(page) {
    await simWait(page, 9000);
    await page.click('#btnShock');
    await simWait(page, 7000);
  },
  // complete heart block in the cut view: the atria and ventricles each at their own rate
  async chb(page) {
    await simWait(page, 12000);
  },
};
const HASH = { stemi: '', af: 'r=72&a=af', chb: 'r=72&b=AVN.complete' };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of which) {
    const vdir = fs.mkdtempSync(path.join(out, '.rec-'));
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vdir, size: { width: W, height: H } } });
    const page = await ctx.newPage();
    const start = Date.now();
    await page.goto(url + (HASH[name] ? '#' + HASH[name] : ''));
    await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 120000 });
    await page.keyboard.press('Escape').catch(() => {});
    if (name === 'chb') await page.click('[data-tab="blocks"]');
    const skip = (Date.now() - start) / 1000 + 1;   // (the loading screen cut from the clip)
    await CLIPS[name](page);
    const video = page.video(); await ctx.close();
    const webm = await video.path(), mp4 = path.join(out, `ecgstudio-${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(skip), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
    fs.rmSync(vdir, { recursive: true, force: true });
    console.log(mp4);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
