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
torso = (src / 'torso_leadfield.json').read_text()
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
