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

# Training (prototype, phones): src/training.html + training.js + the vocabulary + the pre-generated
# question bank (tools/trainbank.js) -> training/index.html (ecgstudio.app/training)
t = (src / 'training.html').read_text().replace('{{AUTHOR}}', htmlmod.escape(site['author']))
for key, text in (('/*__VOCAB__*/', json.dumps((src / 'training_vocab.txt').read_text())),
                  ('/*__BANK__*/', (src / 'training_bank.json').read_text()),
                  ('/*__TRAIN__*/', (src / 'training.js').read_text())):
    assert '</script' not in text
    t = t.replace(key, text, 1)
(root / 'training').mkdir(exist_ok=True)
(root / 'training' / 'index.html').write_text(t)
print('training/index.html', round(len(t.encode()) / 1e6, 2), 'MB')
