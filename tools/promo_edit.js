// Edit the promo clips for social video: captions, a flash on the shock and an end card over the camera clips of
// tools/promo_clips.js (PROMO_CAM=1), from the storyboards in tools/promo_story.json. The captions are drawn as
// transparent 1080x1920 PNGs by Chromium (brand fonts), then composited with ffmpeg; a silent audio track is added
// (some apps expect one). Also writes <name>-script.txt: voice-over lines with times, title, post text and hashtags.
//   node tools/promo_edit.js <dir with ecgstudio-<name>-cam.mp4> [stemi,af,chb]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || '.');
const which = (process.argv[3] || 'stemi,af,chb').split(',');
const STORY = JSON.parse(fs.readFileSync(path.join(__dirname, 'promo_story.json'), 'utf8'));
const LOGO = fs.readFileSync(path.join(__dirname, '..', 'icons', 'logo', 'logo.svg'), 'utf8');
const W = 1080, H = 1920, FADE = 0.2;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=IBM+Plex+Sans+Condensed:wght@700&display=block');
html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; overflow: hidden; }
body { font-family: 'IBM Plex Sans', 'DejaVu Sans', sans-serif; color: #fff; }
/* captions sit below the apps' top bar and well above their bottom controls */
.cap { position: absolute; left: 50%; top: 250px; transform: translateX(-50%); max-width: 860px; width: max-content;
  box-sizing: border-box; padding: 26px 40px 28px; border-radius: 28px; background: rgba(9, 15, 22, 0.86);
  box-shadow: 0 10px 40px rgba(0,0,0,0.35); text-align: center; font-weight: 700; font-size: 56px; line-height: 1.18;
  border-bottom: 8px solid #ef5b7a; }
.hook { font-family: 'IBM Plex Sans Condensed', 'DejaVu Sans Condensed', sans-serif; font-size: 78px; line-height: 1.08;
  padding: 34px 46px 38px; max-width: 920px; }
.big { top: 760px; font-family: 'IBM Plex Sans Condensed', sans-serif; font-size: 170px; letter-spacing: 0.04em;
  color: #ffd23f; background: rgba(9, 15, 22, 0.7); border-bottom: none; padding: 20px 70px; }
.end { position: absolute; inset: 0; background: rgba(9, 15, 22, 0.9); display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; gap: 30px; }
.end svg { width: 260px; height: 260px; }
.end h1 { margin: 0; font: 700 120px/1 'IBM Plex Sans Condensed', sans-serif; }
.end h1 span { color: #ef5b7a; }
.end p { margin: 0; font-size: 52px; font-weight: 500; color: #c9d3dc; max-width: 860px; line-height: 1.25; }
.end .url { margin-top: 30px; padding: 26px 56px; border-radius: 999px; background: #ef5b7a; color: #160a0d;
  font-size: 76px; font-weight: 700; }
.end .free { font-size: 44px; color: #93a3b1; }`;

async function render(page, html, file) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true });
}
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const name of which) {
    const sb = STORY[name], src = path.join(dir, `ecgstudio-${name}-cam.mp4`), out = path.join(dir, `ecgstudio-${name}-edited.mp4`);
    const tmp = fs.mkdtempSync(path.join(dir, '.edit-'));
    const total = dur(src);
    // overlays: [png, t0, t1]
    const ov = [];
    for (const [i, [t0, t1, text, style]] of sb.captions.entries()) {
      const f = path.join(tmp, `cap${i}.png`);
      await render(page, `<div class="cap ${style === 'cap' ? '' : style}">${esc(text)}</div>`, f);
      ov.push([f, t0, Math.min(t1, sb.end ?? total)]);
    }
    if (sb.end != null) {
      const f = path.join(tmp, 'end.png');
      await render(page, `<div class="end">${LOGO.replace(/\s(width|height)="\d+"/g, '')}<h1>ECG <span>Studio</span></h1>
        <p>A 3D heart that computes its own 12-lead ECG</p><div class="url">ecgstudio.app</div><div class="free">Free · no sign-up · any browser</div></div>`, f);
      ov.push([f, sb.end, total]);
    }
    const args = ['-y', '-loglevel', 'error', '-i', src];
    for (const [f, t0, t1] of ov) args.push('-loop', '1', '-framerate', '60', '-t', String(t1 - t0), '-i', f);
    args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo');
    const g = [];
    let base = '[0:v]';
    ov.forEach(([, t0, t1], i) => {
      const d = t1 - t0, fo = Math.max(0, d - FADE);
      g.push(`[${i + 1}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1${fo > FADE ? `,fade=t=out:st=${fo}:d=${FADE}:alpha=1` : ''},setpts=PTS-STARTPTS+${t0}/TB[o${i}]`);
      g.push(`${base}[o${i}]overlay=0:0:eof_action=pass[v${i}]`);
      base = `[v${i}]`;
    });
    // flash: white, fading over ~0.25 s
    for (const [j, f] of (sb.flash || []).entries()) {
      g.push(`${base}drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=fill:enable='between(t,${f},${f + 0.07})',` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.55:t=fill:enable='between(t,${f + 0.07},${f + 0.15})',` +
        `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.25:t=fill:enable='between(t,${f + 0.15},${f + 0.25})'[f${j}]`);
      base = `[f${j}]`;
    }
    g.push(`${base}format=yuv420p[vout]`);
    args.push('-filter_complex', g.join(';'), '-map', '[vout]', '-map', `${ov.length + 1}:a`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', '60', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out);
    execFileSync('ffmpeg', args, { stdio: 'inherit' });
    fs.rmSync(tmp, { recursive: true, force: true });
    // the script
    const fmt = (t) => `0:${String(Math.floor(t)).padStart(2, '0')}.${Math.round((t % 1) * 10)}`;
    fs.writeFileSync(path.join(dir, `ecgstudio-${name}-script.txt`),
      `${sb.title}\n\nVOICE-OVER (start each line at its time)\n${sb.vo.map(([t, l]) => `${fmt(t)}  ${l}`).join('\n')}\n\nPOST TEXT\n${sb.post}\n\n${sb.tags}\n`);
    console.log(out);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
