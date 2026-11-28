// ECG library images: open each topic of src/learn/topics.json in the simulator (index.html, file://), let it acquire
// a full 10 s page, then save the ECG sheet (the app's "Save ECG image") to ecg/<slug>/ecg.png and the simulator's read
// to src/learn/shots.json (the share link with coronary node numbers resolved, rhythm line and findings).
// Also the site's link preview (icons/og-image.png, 1200x630). Then `python3 tools/build.py` writes the pages.
//   node tools/seo_shots.js [slug,slug…]      (all topics when none named; ~15 s each)
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const topics = JSON.parse(fs.readFileSync(path.join(root, 'src/learn/topics.json'), 'utf8')).topics;
const shotsFile = path.join(root, 'src/learn/shots.json');
const shots = fs.existsSync(shotsFile) ? JSON.parse(fs.readFileSync(shotsFile, 'utf8')) : {};
const only = process.argv[2] ? process.argv[2].split(',') : null;
const url = 'file://' + path.join(root, 'index.html');

// "LAD@0.22" → the coronary node that far along the branch (as tools/ischaudit.js names its sites)
async function resolveHash(page, hash) {
  return page.evaluate((h) => h.replace(/\b([A-Za-z0-9]+)@([\d.]+)/g, (_, br, f) => {
    const ids = window.ECGStudioApp.model.coronary.branches[br];
    if (!ids) throw new Error('no branch ' + br);
    return ids[Math.round(ids.length * +f)] ?? ids[ids.length - 1];
  }), hash);
}
async function open(page, hash) {
  await page.goto('about:blank');
  await page.goto(url + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => window.ECGStudioApp && document.getElementById('loading').hidden, null, { timeout: 120000 });
  try { localStorage.setItem('ecgstudio.tourSeen', '1'); } catch (e) { /* (file://) */ }
}
async function dismiss(page) {   // first-visit tip / tutorial offer, if any
  await page.keyboard.press('Escape').catch(() => {});
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await open(page, '');
  for (const tp of topics) {
    if (only && !only.includes(tp.slug)) continue;
    const t0 = Date.now();
    const hash = await resolveHash(page, tp.hash || '');
    await open(page, hash);
    await dismiss(page);
    // a full page after the last change, and the read
    await page.waitForFunction(() => { const t = document.getElementById('rhythm').textContent; return t && t !== 'Acquiring…'; }, null, { timeout: 240000, polling: 500 });
    const s0 = await page.evaluate(() => window.ECGStudioApp.sim.t);
    await page.waitForFunction((s0) => window.ECGStudioApp.sim.t > s0 + 600, s0, { timeout: 60000, polling: 300 });
    // (and a full 10 s page since the scenario loaded: VF is read at once, with no acquisition, and its image was ~1 s of trace)
    await page.waitForFunction(() => window.ECGStudioApp.sim.t > 10500, null, { timeout: 240000, polling: 500 });
    await page.click('#btnPause').catch(() => {});   // (still, so the sheet and the read match)
    const read = await page.evaluate(() => ({
      rhythm: document.getElementById('rhythm').textContent.trim(),
      chips: [...document.getElementById('chips').children].map((c) => [...c.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ')),
      findings: [...document.getElementById('findings').querySelectorAll('li')].map((li) => li.textContent.trim()),
    }));
    // (the on-screen ECG hidden, so the app draws its fixed-size sheet offscreen: wide, as phones save it)
    const click = () => page.evaluate(() => { const c = document.getElementById('cecg'), d = c.style.display; c.style.display = 'none'; document.getElementById('btnSavePng').click(); c.style.display = d; });
    const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
    const dir = path.join(root, 'ecg', tp.slug); fs.mkdirSync(dir, { recursive: true });
    await dl.saveAs(path.join(dir, 'ecg.png'));
    // smaller file: 1400 px wide, 64 colours (PIL)
    require('child_process').execFileSync('python3', ['-c', "import sys; from PIL import Image; f=sys.argv[1]; i=Image.open(f).convert('RGB'); i=i.resize((1400, round(i.height*1400/i.width)), Image.LANCZOS); i.quantize(64).save(f, optimize=True)", path.join(dir, 'ecg.png')]);
    shots[tp.slug] = { hash, ...read };
    fs.writeFileSync(shotsFile, JSON.stringify(shots, null, 1) + '\n');
    console.log(`${tp.slug.padEnd(28)} ${((Date.now() - t0) / 1000).toFixed(0)}s  ${read.rhythm}  |  ${read.findings.join(' / ')}`);
  }
  if (!only || only.includes('og')) {   // link preview: an evolving anterior STEMI, heart and ECG side by side
    const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const p = await og.newPage();
    const tp = topics.find((t) => t.slug === 'anterior-stemi');
    await open(p, await resolveHash(page, tp.hash));
    await dismiss(p);
    await p.waitForFunction(() => { const t = document.getElementById('rhythm').textContent; return t && t !== 'Acquiring…'; }, null, { timeout: 240000, polling: 500 });
    await p.screenshot({ path: path.join(root, 'icons', 'og-image.png') });
    console.log('icons/og-image.png');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
