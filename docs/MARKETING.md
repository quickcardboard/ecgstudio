# Marketing and discoverability

How ECG Studio gets found: by search engines, by AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot), and by the
people who teach and learn ECGs. Cost: none except time.

## What is in place (on the site)

| Piece | Where | What it does |
|---|---|---|
| ECG library | `ecg/<slug>/` (37 pages) + `ecg/index.html` | One crawlable page per pattern: summary, simulated 12-lead image, the simulator's own read, criteria, mechanism, differential, and a link that opens the scenario in the simulator. This is the content search engines and AI assistants quote. |
| Sitemap | `sitemap.xml` | Every public page, for Google and Bing. |
| robots.txt | `robots.txt` | Allows all crawlers, AI crawlers named explicitly; keeps the old-model previews out. |
| llms.txt | `llms.txt` | A plain summary of the site and links to every library page, for AI assistants. |
| Structured data | `src/template.html` (WebApplication), each library page (MedicalWebPage, BreadcrumbList), `ecg/` (CollectionPage) | Tells search engines what the site is: free, educational, the audience. |
| Link previews | `icons/og-image.png` + Open Graph and Twitter tags; each library page uses its own ECG image | A picture on every shared link (Reddit, Discord, X, WhatsApp, LinkedIn, Slack). |
| Library link in the app | Help → About (desktop and phone) | Lets people (and crawlers) get from the simulator to the library. |
| Verification codes | `site.json` `"verify"` | The build adds the Google and Bing ownership tags (see below). |
| Contact page | `/contact/`, from `site.json` `"contactForm"` | Your Google Form, embedded; linked from the library header, Help → About and llms.txt. Absent until the link is set. |

### Keeping it current

- The page text is in `src/learn/topics.json` (one entry per pattern; `hash` is the simulator scenario in share-link syntax,
  with `LAD@0.22` meaning the coronary node 22% along the LAD).
- After an engine change, re-render the images and the simulator reads, then rebuild:
  ```bash
  node tools/seo_shots.js            # all topics, ~15 min; or name some: node tools/seo_shots.js lbbb,inferior-stemi
  python3 tools/build.py
  ```
  The images come from the live model, so they stay honest; read the `shots.json` findings for each changed topic to
  confirm the simulator still reads it as the page says.
- To add a topic, add an entry to `topics.json` and run both commands.
- `node tools/promo_clips.js <outdir> [stemi,af,chb] [fps]` records short portrait clips (1080×1920, 60 fps, phone layout)
  for Shorts, TikTok and Reels: STEMI evolving, AF and a shock, complete heart block. Time is stepped one frame per
  capture, so the clips are smooth whatever the machine; about 0.3 s of rendering per frame.
- Edited versions (zooms, captions, shock flash, end card) for a general audience: the storyboards, captions and
  voice-over scripts are in `tools/promo_story.json`.
  ```bash
  PROMO_CAM=1 node tools/promo_clips.js <outdir>   # records ecgstudio-<name>-cam.mp4, zooming at capture (~20 min)
  node tools/promo_edit.js <outdir>                 # adds captions, flash and end card: ecgstudio-<name>-edited.mp4
  ```
  The editor also writes `ecgstudio-<name>-script.txt` (timed voice-over, title, post text, hashtags).

## Why this is the right first step

AI assistants answer from (1) what their search tools find right now (Bing for ChatGPT and Copilot, Google for Gemini,
their own indexes for Claude and Perplexity) and (2) what they learned from the web. Both reward the same things:

1. **Clear factual pages that answer a question**: "LBBB ECG criteria", "how does Wellens look". That is the library.
   The simulator itself is a WebGL canvas that crawlers cannot read.
2. **Other sites mentioning and linking to you**: Reddit threads, FOAMed blogs, course pages, YouTube descriptions.
   Being named in several independent places is what makes an assistant recommend a tool when someone asks
   "what is a good ECG simulator?".
3. **Consistent wording**: use the same one-line description everywhere (below), so every mention reinforces the others.

> **ECG Studio: a free 3D heart and 12-lead ECG simulator. The ECG is computed from the heart's own electrical activity,
> so you can watch what each wave means.**

Write both "ECG" and "EKG" somewhere in each post: Americans search EKG.

There are no analytics on the site (the privacy policy promises none). Google Search Console and Bing Webmaster Tools
give search impressions, clicks and queries without tracking visitors. Check them monthly.

---

## Your three tasks (each needs you, ~30–60 min)

### 1. Register with Google Search Console and Bing Webmaster Tools (15–30 min)

They need your accounts, and they are the only way to see which searches find you.

**Google**
1. Go to https://search.google.com/search-console and add a property.
2. Choose **Domain** and enter `ecgstudio.app`. Google shows a TXT record. Add it at your domain registrar (where you
   bought ecgstudio.app: DNS settings → add TXT record on `@`). Verification can take a few minutes to an hour.
   *Alternative:* choose **URL prefix** `https://ecgstudio.app/`, then **HTML tag**, and copy the `content="…"` code.
   Put it in `site.json` as `"verify": {"google-site-verification": "<code>"}` (or give it to Claude), rebuild, merge.
3. **Sitemaps** → submit `https://ecgstudio.app/sitemap.xml`.
4. **URL inspection** → paste `https://ecgstudio.app/ecg/` → **Request indexing**. Do the same for the home page and
   a few library pages (anterior-stemi, left-bundle-branch-block, atrial-fibrillation).

**Bing** (this feeds ChatGPT search and Copilot)
1. Go to https://www.bing.com/webmasters, sign in, and choose **Import from Google Search Console**: one click, once
   Google is verified. Otherwise add the site and use the XML-file or meta-tag method (meta name `msvalidate.01`, same
   `site.json` `"verify"` field).
2. Submit the sitemap there too.

Check back after 1–2 weeks: Search Console → Pages (indexed?) and Performance (queries).

### 2. Write to educators and FOAMed creators (1 hour to send ~10 emails)

One link from a well-known teaching site does more than months of posts, for people and for AI answers. This needs
your name, your background and your inbox. Personalise the first line every time (mention a post or video of theirs).

**Who** (find each one's contact page on their site):
- FOAMed ECG sites: Life in the Fast Lane (LITFL) ECG Library; Dr. Smith's ECG Blog; ECG Weekly; Medmastery; ECGpedia;
  the ECG teaching accounts on X and Instagram.
- YouTube educators who teach ECGs (cardiology, emergency medicine, paramedic and nursing channels).
- Teachers: paramedic and EMT programmes, nursing schools (telemetry and critical care courses), cardiac
  monitor-technician courses, medical school cardiology block or clerkship directors, emergency medicine and cardiology
  residency programme coordinators. Start with your own school or hospital.

**Template: educator or creator** (fill in the brackets)

> Subject: A free 3D heart that computes its own 12-lead ECG, for your [ECG teaching / channel]
>
> Hi [name],
>
> [One sentence about something specific of theirs you used or liked.]
>
> I'm [your name], [a medical student / resident / … at …]. I built ECG Studio (https://ecgstudio.app), a free
> browser-based 3D heart whose 12-lead ECG is calculated from its own electrical activity. You can occlude any coronary
> artery and drag the time from 15 minutes to a month, block any part of the conduction system, start AF, VT or AVNRT,
> and watch the heart and the 12 leads change together. Any scenario can be shared as a link, for example an anterior
> STEMI: [paste https://ecgstudio.app/ecg/anterior-stemi/].
>
> I'd be grateful for your opinion of it as a teaching tool, and if you find it useful, feel free to link it or use it in
> [your posts / videos / lectures]. It's free with no sign-up or ads.
>
> Thanks,
> [name]

**Template: programme director or course instructor**

> Subject: Free 3D ECG simulator for your [paramedic / nursing / cardiology] students
>
> Hi [name],
>
> I'm [your name], [background]. I've built ECG Studio (https://ecgstudio.app), a free 3D heart and 12-lead ECG simulator
> that runs in any browser, including phones. Students can see why the ECG looks the way it does: which part of the heart
> each wave comes from, and how blocks, infarcts in each coronary territory, hypertrophy and electrolyte disturbances change
> it. You can send a class a link that opens a specific scenario, and there is an ECG library with criteria for each
> pattern (https://ecgstudio.app/ecg/).
>
> Would it be useful in your [course]? I'd be happy to hear what would make it fit your teaching better.
>
> [name]

Keep a short list of who you wrote to and when; follow up once after two weeks, then stop.

### 3. Launch posts and short videos (1–2 hours, spread over a couple of weeks)

These need your accounts and a human voice. Post one or two a week rather than all at once, reply to every comment, and
read each community's self-promotion rules first. Several subreddits allow it only in weekly threads or with moderator
approval; ask the moderators when unsure. Lead with something useful to look at (a clip or an ECG), not the link.

**Video clips**: rendered with `tools/promo_clips.js` in portrait 1080×1920 at 60 fps (STEMI evolving over a month, AF and
a shock, complete heart block). The edited versions already carry captions, zooms and an end card; record the voice-over
from the script file in the app's editor (TikTok and Shorts both have a "Voiceover" tool), or post them with captions
only, since most people watch muted.
Post them natively (uploaded, not as links) to YouTube Shorts, Instagram Reels, TikTok and X, and on Reddit. Put the link
in the description, comment or bio.

**Reddit** (r/medicalschool, r/Residency, r/nursing, r/EMS, r/ECG, r/FOAMed, r/cardiology, r/step1, r/paramedics)

> Title: I built a free 3D heart that computes its own 12-lead ECG. Here's an LAD occlusion evolving from 15 min to 1 month
>
> [video]
>
> I'm a [background] and I kept wishing I could *see* why each ECG pattern happens, so I built ECG Studio. The ECG isn't
> drawn from templates: it's computed from the electrical activity of a 3D heart, so when you occlude an artery, block a
> bundle branch or start AVNRT, you see what the heart is doing and what each lead records.
>
> Free, runs in the browser (phone too), no sign-up: https://ecgstudio.app. There's also an ECG library with the criteria
> for each pattern: https://ecgstudio.app/ecg/
>
> It's a model, so some things are simplified. I'd really like to hear where it looks wrong to you, or what you'd want it
> to show.

**Hacker News** (Show HN; technical audience: the model is the story)

> Title: Show HN: ECG Studio – a 3D heart model that computes its own 12-lead ECG
>
> Text: ECG Studio simulates cardiac electrophysiology on a CT-derived 3D heart (an event-driven cellular automaton with
> fibre-dependent conduction, a conduction system and repolarisation gradients) and computes the 12-lead ECG from it with
> lead fields from a solved torso model. Everything runs in the browser in a single HTML file (Three.js + plain JS). You can
> occlude any coronary artery, block parts of the conduction system, or start arrhythmias, and watch the heart and the ECG
> change together. It was calibrated against textbook intervals, axes and infarct lead patterns; I'm happy to talk about
> what worked and what didn't. Free, no sign-up: https://ecgstudio.app

**Product Hunt**: tagline "A free 3D heart that computes its own 12-lead ECG"; 3–5 images (the og-image, two library
ECGs, a phone screenshot) and the STEMI clip; first comment as in the Reddit post. Launch on a Tuesday–Thursday.

**LinkedIn / X**: the Reddit text, shorter, with the clip. Tag #FOAMed #FOAMcc #ECG #EKG #MedEd.

**Directories** (submit once each; these help AI assistants list you): AlternativeTo (as an alternative to other ECG
simulators), Product Hunt, Indie Hackers, the free-resource threads of r/medicalschool and r/step1, and curated GitHub
"awesome" lists of medical-education tools. Not Wikipedia: self-promotion there is removed.

**Later**: once the Android app is public, put "ECG simulator", "EKG" and "12-lead" in its title and short description
(drafts in `docs/PLAY_LISTING.md`), and link the store page from the site. A poster at a medical-education or EMS
conference, or a short paper (MedEdPORTAL, JMIR Medical Education), gives lasting credibility with search engines and AI
assistants alike.
