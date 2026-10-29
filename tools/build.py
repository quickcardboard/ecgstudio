"""Assemble the single-file app: src/template.html + engine + app + anatomy -> index.html"""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
html = (src / 'template.html').read_text()
anatomy = (src / 'anatomy.json').read_text()
assert '</script' not in anatomy
html = html.replace('/*__ANATOMY__*/', anatomy, 1)
torso = (src / 'torso_leadfield.json').read_text()
assert '</script' not in torso
html = html.replace('/*__TORSO__*/', torso, 1)
html = html.replace('/*__ENGINE__*/', (src / 'engine.js').read_text(), 1)
html = html.replace('/*__APP__*/', (src / 'app.js').read_text(), 1)
(root / 'index.html').write_text(html)
print('index.html', round(len(html.encode()) / 1e6, 2), 'MB')
