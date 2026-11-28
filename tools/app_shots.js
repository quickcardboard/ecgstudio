// Phone screenshots for the app page (ecgstudio.app/training, tools/learn_pages.py): a Training question being answered
// and its result, from the built page (Training unlocked in a temporary copy). Writes training/img/{question,result}.jpg
// (600 px wide). Rerun after visible changes: node tools/app_shots.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'training', 'img');
const VIEW = { viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const jpg = (png, name) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=600:-1:flags=lanczos', '-q:v', '3', path.join(out, name + '.jpg')]);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(root, 'app', '.shots-'));
  const unlocked = path.join(tmp, 'training.html');   // (same folder depth as app/training.html, so its relative links hold)
  fs.writeFileSync(unlocked, fs.readFileSync(path.join(root, 'app', 'training.html'), 'utf8').replace('<meta name="premium" content="1">', '<meta name="premium" content="0">'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // Training: a question being answered, then its result
    const ctx = await browser.newContext(VIEW), p = await ctx.newPage();
    await p.goto('file://' + unlocked);
    await p.waitForFunction(() => { const b = document.getElementById('btnTrain'); return b && b.offsetParent; }, null, { timeout: 120000 });
    await p.waitForTimeout(1500);
    await p.tap('#btnTrain');
    // (the ECG is ready when the loading panel is gone and the keyboard is up)
    await p.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('kbd').hidden, null, { timeout: 180000, polling: 300 });
    await p.waitForTimeout(1500);
    for (const ch of 'sinus') { await p.locator('button[data-k="' + ch + '"]').first().tap(); await p.waitForTimeout(120); }
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(tmp, 'question.png') }); jpg(path.join(tmp, 'question.png'), 'question');
    await p.getByRole('button', { name: /^Sinus rhythm/ }).first().tap();
    await p.waitForTimeout(400);
    await p.tap('#submit');
    await p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(tmp, 'result.png') }); jpg(path.join(tmp, 'result.png'), 'result');
    await ctx.close();
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fs.readdirSync(out).map((f) => `training/img/${f} ${Math.round(fs.statSync(path.join(out, f)).size / 1024)} kB`).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
