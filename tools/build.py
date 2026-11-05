"""Assemble the single-file app: src/template.html + Three.js + engine + app + anatomy -> index.html"""
import datetime, html as htmlmod, json, pathlib, subprocess
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
html = (src / 'template.html').read_text()
# author and version (site.json; version = build date + commit)
site = json.loads((root / 'site.json').read_text())
try:
    rev = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=root, capture_output=True, text=True).stdout.strip()
except OSError:
    rev = ''
contact = site.get('contact', '').strip()
contact_html = f' (<a href="{htmlmod.escape(contact)}">{htmlmod.escape(contact.removeprefix("mailto:"))}</a>)' if contact else ''
for k, v in (('{{AUTHOR}}', htmlmod.escape(site['author'])), ('{{CONTACT}}', contact_html), ('{{YEAR}}', htmlmod.escape(site.get('year', ''))),
             ('{{VERSION}}', datetime.date.today().isoformat() + (f' ({rev})' if rev else ''))):
    html = html.replace(k, v)   # (the page shell only: done before the scripts and data are inlined)
anatomy = (src / 'anatomy.json').read_text()
assert '</script' not in anatomy
html = html.replace('/*__ANATOMY__*/', anatomy, 1)
# limb leads: the solved torso's LA/LL reciprocity fields (limbTorso2); the older cylinder field
# (torso_leadfield.json) stays in src/ for Node experiments and is not shipped
torso = (src / 'torso_limb.json').read_text()
assert '</script' not in torso
html = html.replace('/*__TORSO__*/', torso, 1)
for key, f in (('/*__THREE__*/', 'three.min.js'), ('/*__ORBIT__*/', 'OrbitControls.js')):
    js = (root / 'vendor' / f).read_text()
    assert '</script' not in js
    html = html.replace(key, js, 1)
html = html.replace('/*__ENGINE__*/', (src / 'engine.js').read_text(), 1)
html = html.replace('/*__APP__*/', (src / 'app.js').read_text(), 1)
(root / 'index.html').write_text(html)
print('index.html', round(len(html.encode()) / 1e6, 2), 'MB')

# Training (prototype, phones): src/training.html + training.js + the vocabulary, and a background worker
# that generates the ECGs live (engine + blind readers + src/training_gen.js) -> training/index.html
# (ecgstudio.app/training)
def cjs(path, name):
    # a CommonJS tool module as a plain script: its exports under `name` (no require at load time)
    return (f'const {name} = (function () {{ const module = {{ exports: {{}} }}, exports = module.exports, require = () => ({{}});\n'
            + path.read_text() + '\nreturn module.exports; })();\n')
worker = ((src / 'engine.js').read_text() + '\n'
          + cjs(root / 'tools' / 'reader.js', 'TR_READER') + cjs(root / 'tools' / 'rhythmread.js', 'TR_RHYTHM')
          + (src / 'training_gen.js').read_text() + '\n' + '''
// worker: build the heart once, then make ECGs on request
let G = null;
self.onmessage = (e) => {
  const d = e.data, LH = self.ECGStudio;
  if (d.type === 'init') {
    LH.setDefaultTorso(null); LH.setDefaultTorso2(JSON.parse(d.torso));
    G = self.TrainGen(LH, { read: TR_READER.read, readRhythm: TR_RHYTHM.readRhythm }, JSON.parse(d.anatomy));
    G.model(null);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (d.type === 'make') {
    const t = performance.now(); let item = null, err = null;
    try { item = G.make({ target: d.target, focus: d.focus, seed: d.seed, tries: 12, log: (rec, res) => { if (!res.ok) self.postMessage({ type: 'log', msg: [rec.rhythm, ...rec.abn.map((a) => a.k)].join(' + ') + ': ' + res.why }); } }); }
    catch (x) { err = String((x && x.stack) || x); }
    self.postMessage({ type: 'item', req: d.req, item, err, ms: performance.now() - t });
  }
};
''')
t = (src / 'training.html').read_text().replace('{{AUTHOR}}', htmlmod.escape(site['author']))
for key, text in (('/*__VOCAB__*/', json.dumps((src / 'training_vocab.txt').read_text())),
                  ('/*__ANATOMY__*/', anatomy), ('/*__TORSO__*/', torso), ('/*__WORKER__*/', worker),
                  ('/*__TRAIN__*/', (src / 'training.js').read_text())):
    assert '</script' not in text
    t = t.replace(key, text, 1)
(root / 'training').mkdir(exist_ok=True)
(root / 'training' / 'index.html').write_text(t)
print('training/index.html', round(len(t.encode()) / 1e6, 2), 'MB')
