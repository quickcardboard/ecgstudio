"""ECG library: static, crawlable pages at ecgstudio.app/ecg/ from src/learn/topics.json (text) and src/learn/shots.json
(the simulator's read and share link, written by tools/seo_shots.js with the images ecg/<slug>/ecg.png). Also writes
sitemap.xml and llms.txt. Called by tools/build.py."""
import datetime, html, json, pathlib, re

SITE = 'https://ecgstudio.app'
esc = html.escape


def page_css():
    return """
:root { --bg: #f5f7f9; --surface: #ffffff; --fg: #1d2a36; --muted: #5d6b78; --line: #d3dae1; --accent: #c2304f; --accent-fg: #fff; --soft: #fbecef; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #0b131a; --surface: #121d27; --fg: #e3eaf0; --muted: #93a3b1; --line: #24323f; --accent: #ef5b7a; --accent-fg: #160a0d; --soft: #2a1820; color-scheme: dark; }
}
:root[data-theme="dark"] { --bg: #0b131a; --surface: #121d27; --fg: #e3eaf0; --muted: #93a3b1; --line: #24323f; --accent: #ef5b7a; --accent-fg: #160a0d; --soft: #2a1820; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; }
a { color: var(--accent); }
header.top { border-bottom: 1px solid var(--line); background: var(--surface); }
header.top div { max-width: 960px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 12px; }
header.top a.brand { display: flex; align-items: center; gap: 8px; color: var(--fg); text-decoration: none; font: 600 18px/1 "IBM Plex Sans Condensed", "Arial Narrow", sans-serif; }
header.top a.brand span { color: var(--accent); }
header.top svg.logo { width: 28px; height: 28px; }
header.top nav { margin-left: auto; display: flex; gap: 16px; font-size: 15px; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
.crumbs { font-size: 14px; color: var(--muted); margin: 0 0 8px; }
.crumbs a { color: var(--muted); }
h1 { font: 600 32px/1.15 "IBM Plex Sans Condensed", "Arial Narrow", sans-serif; margin: 0 0 12px; }
h2 { font: 600 20px/1.25 "IBM Plex Sans Condensed", "Arial Narrow", sans-serif; margin: 32px 0 8px; }
.lede { font-size: 18px; margin: 0 0 20px; }
figure { margin: 0 0 8px; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
figure img { display: block; width: 100%; height: auto; }
figcaption { font-size: 14px; color: var(--muted); padding: 0 0 4px; }
.cta { display: inline-block; margin: 16px 0 8px; padding: 12px 20px; background: var(--accent); color: var(--accent-fg); border-radius: 8px; text-decoration: none; font-weight: 600; }
.read { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
.read h2 { margin: 0 0 4px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.read p { margin: 0 0 4px; }
.read .m { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 14px; color: var(--muted); }
ul { padding-left: 22px; }
li { margin: 2px 0; }
.note { font-size: 14px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 40px; padding-top: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; padding: 0; list-style: none; }
.grid li { margin: 0; }
.grid a { display: block; height: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; color: var(--fg); text-decoration: none; }
.grid a:hover { border-color: var(--accent); }
.grid b { display: block; color: var(--accent); }
.grid span { font-size: 14px; color: var(--muted); }
iframe { display: block; width: 100%; height: 1100px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.small { font-size: 14px; color: var(--muted); }
a.cta.play { margin-bottom: 4px; }
.apphero { display: flex; gap: 40px; align-items: center; }
.apptext { flex: 1 1 380px; }
.apptext .lede { margin-bottom: 12px; }
ul.feat { margin: 0 0 18px; }
.shots { display: flex; gap: 20px; justify-content: center; }
figure.phone { width: 230px; background: #05090d; border: 0; border-radius: 36px; padding: 10px; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
figure.phone img { border-radius: 28px; }
figure.phone figcaption { color: #c9d3dc; text-align: center; padding: 10px 6px 4px; font-size: 15px; }
header.top nav a { white-space: nowrap; }
@media (max-width: 860px) { .shots { display: none; } .apphero { display: block; } }
@media (max-width: 400px) { .apptext h1 { font-size: 24px; margin-bottom: 8px; } .apptext .lede { font-size: 16px; } ul.feat li { margin: 3px 0; } .apptext .cta { margin: 10px 0 6px; } }
ul.feat { padding-left: 20px; } ul.feat li { margin: 6px 0; }
@media (max-width: 600px) { h1 { font-size: 26px; } header.top nav a.hide { display: none; } }
"""


def shell(title, desc, canonical, body, logo, image=None, ld=None, author='Thomas Liou', contact=False, note=None):
    img = image or f'{SITE}/icons/og-image.png'
    lds = ''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n' for x in (ld or []))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ECG Studio">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#121b26">
<link rel="icon" href="/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600&display=swap">
<style>{page_css()}</style>
{lds}</head>
<body>
<header class="top"><div><a class="brand" href="/">{logo}ECG <span>Studio</span></a>
<nav><a href="/ecg/">ECG library</a><a class="hide" href="/">3D simulator</a>{'<a class="hide" href="/contact/">Contact</a>' if contact else ''}<a href="/training/">Get the app</a></nav></div></header>
<main>
{body}
<p class="note">{note or f'''ECG Studio is an educational simulator, not a medical device. Its ECGs are computed by a model of the heart,
not recorded from patients; some features are simplified for teaching. Do not use them for diagnosis or treatment.
Created by {esc(author)}. © {datetime.date.today().year}.'''}</p>
</main>
</body>
</html>
"""


def form_urls(url):
    # a Google Form link -> (link to open, embeddable URL or None). Short forms.gle links cannot be embedded.
    url = (url or '').strip()
    if not url:
        return None, None
    m = re.match(r'(https://docs\.google\.com/forms/(?:u/\d+/)?d/(?:e/)?[\w-]+)/', url)
    return url, (m.group(1) + '/viewform?embedded=true' if m else None)


def build(root, logo_inline, author, contact_form=''):
    root = pathlib.Path(root)
    data = json.loads((root / 'src/learn/topics.json').read_text())
    shots_f = root / 'src/learn/shots.json'
    shots = json.loads(shots_f.read_text()) if shots_f.exists() else {}
    groups = dict(data['groups'])
    form_link, form_embed = form_urls(contact_form)
    topics = data['topics']
    logo = logo_inline
    out = root / 'ecg'
    urls = []
    for tp in topics:
        slug, sh = tp['slug'], shots.get(tp['slug'], {})
        canonical = f'{SITE}/ecg/{slug}/'
        hash_ = sh.get('hash', tp.get('hash', ''))
        sim = f'/#{hash_}' if hash_ else '/'
        has_img = (out / slug / 'ecg.png').exists()
        findings = sh.get('findings', [])
        alt = f"Simulated 12-lead ECG: {tp['name']}." + (' ' + '; '.join(findings) + '.' if findings else '')
        fig = (f'<figure><a href="ecg.png" title="Full size"><img src="ecg.png" width="1400" height="{img_h(out / slug / "ecg.png")}" alt="{esc(alt)}"></a></figure>\n'
               f'<figcaption>{esc(tp["name"])}: a 12-lead ECG computed by the ECG Studio heart model (25 mm/s, 10 mm/mV). Tap or click to enlarge.</figcaption>\n') if has_img else ''
        read = ''
        if sh.get('rhythm'):
            read = ('<section class="read"><h2>What the simulator reads</h2>'
                    f'<p><b>{esc(sh["rhythm"])}</b></p>'
                    + (f'<p class="m">{esc(" · ".join(sh.get("chips", [])))}</p>' if sh.get('chips') else '')
                    + (''.join(f'<p>{esc(f)}</p>' for f in findings))
                    + '</section>\n')
        related = [t for t in topics if t['group'] == tp['group'] and t['slug'] != slug]
        body = f"""<p class="crumbs"><a href="/ecg/">ECG library</a> › {esc(groups[tp['group']])}</p>
<h1>{esc(tp['name'])}</h1>
<p class="lede">{esc(tp['summary'])}</p>
{fig}<a class="cta" href="{esc(sim)}">Open this ECG in the 3D heart simulator →</a>
{read}<h2>ECG criteria</h2>
<ul>{''.join(f'<li>{esc(c)}</li>' for c in tp['criteria'])}</ul>
<h2>Why it looks like this</h2>
<p>{esc(tp['mechanism'])}</p>
<h2>Differential diagnosis</h2>
<ul>{''.join(f'<li>{esc(c)}</li>' for c in tp['ddx'])}</ul>
<h2>Try it yourself</h2>
<p>{esc(tp['try'])} In <a href="{esc(sim)}">ECG Studio</a> the 12-lead ECG is calculated from the electrical activity of
a 3D heart as you watch, so you can see which part of the heart makes each wave.</p>
<h2>More {esc(groups[tp['group']].lower())}</h2>
<ul class="grid">{''.join(f'<li><a href="/ecg/{t["slug"]}/"><b>{esc(t["name"])}</b></a></li>' for t in related)}</ul>
"""
        ld = [{
            '@context': 'https://schema.org', '@type': 'MedicalWebPage', 'name': tp['name'], 'headline': tp['title'],
            'description': tp['summary'], 'url': canonical, 'inLanguage': 'en',
            'audience': {'@type': 'MedicalAudience', 'audienceType': 'Clinician'},
            'about': {'@type': 'MedicalCondition', 'name': tp['name']},
            'author': {'@type': 'Person', 'name': author},
            'isPartOf': {'@type': 'WebSite', 'name': 'ECG Studio', 'url': SITE + '/'},
            **({'image': canonical + 'ecg.png'} if has_img else {}),
            'lastReviewed': datetime.date.today().isoformat(),
        }, {
            '@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'ECG library', 'item': SITE + '/ecg/'},
                {'@type': 'ListItem', 'position': 2, 'name': tp['name'], 'item': canonical}]}]
        (out / slug).mkdir(parents=True, exist_ok=True)
        (out / slug / 'index.html').write_text(shell(tp['title'] + ' | ECG Studio', tp['summary'], canonical, body, logo,
                                                     canonical + 'ecg.png' if has_img else None, ld, author, bool(form_link)))
        urls.append(canonical)
    # the library index
    secs = ''
    for g, gname in data['groups']:
        items = [t for t in topics if t['group'] == g]
        secs += (f'<h2>{esc(gname)}</h2>\n<ul class="grid">'
                 + ''.join(f'<li><a href="/ecg/{t["slug"]}/"><b>{esc(t["name"])}</b><span>{esc(first_sentence(t["summary"]))}</span></a></li>' for t in items)
                 + '</ul>\n')
    desc = ('Free ECG library: criteria, mechanisms and differential diagnosis for '
            f'{len(topics)} rhythms, blocks, infarcts and conditions, each with a 12-lead ECG computed by a 3D heart model.')
    body = f"""<h1>ECG library</h1>
<p class="lede">{len(topics)} common ECG patterns, each with its criteria, why it looks the way it does, what it can be
confused with, and a 12-lead ECG computed by the ECG Studio heart model. Open any of them in the
<a href="/">3D simulator</a> to see the heart that produced it.</p>
{secs}"""
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': 'ECG library', 'url': SITE + '/ecg/', 'description': desc,
           'hasPart': [{'@type': 'MedicalWebPage', 'name': t['name'], 'url': f'{SITE}/ecg/{t["slug"]}/'} for t in topics]}]
    (out / 'index.html').write_text(shell('ECG Library: 12-Lead ECG Examples and Criteria | ECG Studio', desc, SITE + '/ecg/', body, logo, None, ld, author, bool(form_link)))
    # sitemap and llms.txt
    today = datetime.date.today().isoformat()
    # contact (site.json "contactForm": a Google Form); no page without one
    cdir = root / 'contact'
    if form_link:
        frame = (f'<iframe src="{esc(form_embed)}" title="Contact form" loading="lazy">Loading…</iframe>\n'
                 f'<p class="small">Form not showing? <a href="{esc(form_link)}">Open it in a new page</a>.</p>' if form_embed
                 else f'<p><a class="cta" href="{esc(form_link)}">Open the contact form →</a></p>')
        body = f"""<h1>Contact</h1>
<p class="lede">Questions, ideas, errors in a simulated ECG, or plans to use ECG Studio in your teaching: write to
{esc(author)} here. Educators are especially welcome.</p>
{frame}
<p class="small">The form is run by Google Forms. What you send is used only to reply to you; see the
<a href="/privacy/">privacy policy</a>.</p>
"""
        cdir.mkdir(exist_ok=True)
        (cdir / 'index.html').write_text(shell('Contact | ECG Studio', 'Contact the creator of ECG Studio, the free 3D heart and 12-lead ECG simulator: questions, feedback and teaching use.',
                                               SITE + '/contact/', body, logo, None, [{'@context': 'https://schema.org', '@type': 'ContactPage', 'name': 'Contact ECG Studio', 'url': SITE + '/contact/'}], author, True))
    elif cdir.exists():
        (cdir / 'index.html').unlink(missing_ok=True)
        if not any(cdir.iterdir()): cdir.rmdir()
    app_page(root, logo, author, bool(form_link))
    allurls = [SITE + '/', SITE + '/training/', SITE + '/ecg/'] + urls + [SITE + '/privacy/'] + ([SITE + '/contact/'] if form_link else [])
    (root / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                      + ''.join(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n' for u in allurls) + '</urlset>\n')
    llms = ['# ECG Studio', '',
            '> ECG Studio (https://ecgstudio.app) is a free, browser-based 3D heart and 12-lead ECG simulator for medical, nursing and '
            'paramedic education. A 3D model of the heart (built from CT-derived anatomy) beats in real time, and the 12-lead ECG is computed '
            'from its electrical activity, so learners can see which part of the heart produces each wave and how rhythms, conduction blocks, '
            'coronary occlusions, hypertrophy and electrolyte disturbances change the ECG.', '',
            'Key facts:',
            '- Free to use in any modern browser on desktop or phone; no account or sign-up; no ads or tracking.',
            '- Simulates: sinus rhythm, atrial fibrillation and flutter, MAT, AVNRT, AVRT, VT, torsades de pointes, VF; first-, second- '
            '(Mobitz I, Mobitz II, 2:1) and third-degree AV block, sinoatrial block, LBBB, RBBB, LAFB, LPFB; occlusion of any coronary '
            'artery with the ECG evolving from 15 minutes to 1 month (hyperacute T, STEMI, Q waves); LVH, RVH, atrial enlargement, WPW, '
            'pericarditis, Brugada, Wellens, hyperkalemia, hypokalemia, hypocalcemia, hypercalcemia and hypothermia.',
            '- Every scenario can be shared as a link, and the ECG can be saved as an image.',
            f'- Educational only, not a medical device. Created by {author}.', '',
            '## Pages', '',
            '- [3D heart and 12-lead ECG simulator](https://ecgstudio.app/): the interactive simulator',
            '- [ECG Studio for Android](https://ecgstudio.app/training/): the free Android app on Google Play: the simulator on a phone, plus Training (unlimited ECGs from the heart model, scored and matched to the learner\'s level; an optional in-app upgrade)',
            '- [ECG library](https://ecgstudio.app/ecg/): criteria, mechanism and differential diagnosis for each pattern, with a simulated 12-lead ECG', '',
            '## ECG library', '']
    for g, gname in data['groups']:
        llms.append(f'### {gname}')
        llms += [f'- [{t["name"]}]({SITE}/ecg/{t["slug"]}/): {t["summary"]}' for t in topics if t['group'] == g]
        llms.append('')
    llms += ['## Optional', '']
    if form_link:
        llms.append('- [Contact](https://ecgstudio.app/contact/): questions, feedback and teaching use')
    llms += ['- [Privacy policy](https://ecgstudio.app/privacy/): no personal data is collected by the simulator', '']
    (root / 'llms.txt').write_text('\n'.join(llms))
    print(f'ecg/ ({len(topics)} pages), sitemap.xml, llms.txt')


PLAY_URL = 'https://play.google.com/store/apps/details?id=com.ecgstudio.app'


def app_page(root, logo, author, contact):
    """ecgstudio.app/training: what the Android app adds to the free web simulator, and the Google Play link
    (screenshots: training/img/, from tools/app_shots.js)."""
    out = root / 'training'
    out.mkdir(exist_ok=True)
    play = f'<a class="cta play" href="{PLAY_URL}">Get it on Google Play</a>'
    shot = lambda f, alt, cap: (f'<figure class="phone"><img src="img/{f}" width="600" height="{img_h(out / "img" / f) * 600 // 1400}" alt="{esc(alt)}" loading="lazy">'
                                f'<figcaption>{esc(cap)}</figcaption></figure>') if (out / 'img' / f).exists() else ''
    body = f"""<div class="apphero"><div class="apptext">
<h1>ECG Studio for Android</h1>
<p class="lede">Free on Google Play: the 3D heart and 12-lead ECG on your phone, plus <b>Training</b>.</p>
<ul class="feat">
<li>A new ECG every time, matched to your level</li>
<li>Scored like a real read: see what you missed, lead by lead</li>
<li>Practice by skill, a daily ECG, works offline</li>
</ul>
{play}
<p class="small">Free download · Training is an optional upgrade in the app.<br>iPhone or computer? The <a href="/">3D simulator</a> is free on the web.</p>
</div><div class="shots">{shot('question.jpg', 'ECG Studio Training: a 12-lead ECG with the answer being typed', 'A new ECG every time')}
{shot('result.jpg', 'ECG Studio Training: the result, with the missed finding highlighted on the leads', 'What you missed, lead by lead')}</div></div>
"""
    ld = [{'@context': 'https://schema.org', '@type': 'MobileApplication', 'name': 'ECG Studio', 'operatingSystem': 'Android',
           'applicationCategory': 'EducationalApplication', 'url': SITE + '/training/', 'installUrl': PLAY_URL,
           'description': 'A 3D heart that computes its own 12-lead ECG, with Training: unlimited ECGs matched to your level.',
           'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'}, 'author': {'@type': 'Person', 'name': author}}]
    img = SITE + '/training/img/question.jpg' if (out / 'img' / 'question.jpg').exists() else None
    (out / 'index.html').write_text(shell('ECG Studio for Android: ECG Training App | ECG Studio',
                                          'Free on Google Play: the 3D heart and 12-lead ECG simulator on your phone, plus Training, unlimited ECGs '
                                          'generated by the heart model and matched to your level.',
                                          SITE + '/training/', body, logo, img, ld, author, contact,
                                          f'Educational simulator, not a medical device. © {datetime.date.today().year} {esc(author)}.'))


def first_sentence(s):
    i = s.find('. ')
    return s if i < 0 else s[:i + 1]


def img_h(p):
    try:   # PNG IHDR: width at 16, height at 20
        b = p.read_bytes()[16:24]
        w, h = int.from_bytes(b[:4], 'big'), int.from_bytes(b[4:], 'big')
        return round(h * 1400 / w)
    except OSError:
        return 800
