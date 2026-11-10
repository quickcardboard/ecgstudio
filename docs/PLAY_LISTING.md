# Google Play: store listing and forms (drafts for the author)

Copy each answer into Play Console. Wording is a draft: change anything. The screenshots and feature graphic are made by
the session that wrote this (phone screenshots 1080×1920; the 512×512 icon is `icons/logo/play-store-512.png`).

## Store listing (Grow users → Store presence → Main store listing)

**App name** (30 characters max): `ECG Studio`

**Short description** (80 max):

> A beating 3D heart that writes its own 12-lead ECG. Learn, explore and practise.

**Full description** (4000 max):

> ECG Studio is a 3D heart that computes its own 12-lead ECG. Every wave on the paper comes from the simulated heart:
> activation spreads through tens of thousands of tissue cells, and the twelve leads are calculated from the electrical
> field they produce. Change the heart and watch the ECG change with it.
>
> SIMULATOR (free)
> • Rhythms: sinus, atrial fibrillation and flutter, ectopic beats, SVT, ventricular tachycardia and fibrillation, and more
> • Conduction blocks: AV blocks, bundle branch and fascicular blocks, WPW
> • Ischemia and infarction: block a coronary artery and follow the ECG from the first hour to an old infarct
> • Conditions: hypertrophy, atrial enlargement, pericarditis, Brugada and others
> • Rotate the heart, look inside it, and see the wave of activation spread
> • The full 12-lead on standard ECG paper, with measured intervals and axis
>
> TRAINING
> • Read freshly generated 12-lead ECGs and name the rhythm and every finding
> • A rating for each skill: rhythm, conduction, ischemia and conditions
> • ECGs chosen for your level, reviews of the ones you missed, and a daily ECG
> • See what produced each ECG: open it in the simulator with one tap
>
> Works offline. No account, no ads, and your progress stays on your phone.
>
> For education only. ECG Studio is a teaching simulator, not a medical device: it is not for diagnosing or treating
> patients.

**App icon**: `icons/logo/play-store-512.png`.
**Feature graphic** (1024×500): `feature-graphic.png` (from this session): logo, "ECG Studio", "3D Heart Simulator / Learn, Explore, Practice".
**Phone screenshots** (2–8, 1080×1920): the six `1-…` to `6-…` PNGs (from this session).
**Tablet screenshots**: optional; leave until the tablet layout (phase 4).

## App category and contact (Store settings)

- **App category:** Education (Medical also fits; Education keeps it clearly a learning tool).
- **Tags:** pick the closest offered (e.g. Medical education, Science).
- **Email:** tlioudevelop@gmail.com (shown publicly). **Website:** https://ecgstudio.app

## Policy → App content

| Form | Answer |
|---|---|
| **Privacy policy** | https://ecgstudio.app/privacy/ |
| **App access** | **No** (nothing is restricted yet). **Change to Yes when the Training purchase ships**, before uploading that release, and give the reviewers a way in (e.g. a Play promo code for Training, or instructions to a tester-only unlock). |
| **Ads** | No, the app does not contain ads. |
| **Content rating** | Questionnaire category: *Reference, News, or Educational*. Answer **No** to everything (violence, sexuality, language, drugs, gambling, user interaction, sharing location, digital purchases: **No** for now; change to **Yes** when the Training purchase is added). Expected rating: Everyone / PEGI 3. |
| **Target audience** | **18 and over** (medical students, nurses, doctors). Not designed for children; "Appeals to children": No. |
| **Data safety** | Does the app collect or share user data? **No.** (Progress is stored only on the device; nothing is sent to the developer or third parties. Purchases, once added, are handled by Google Play.) Data encrypted in transit: not applicable. Deletion requests: not applicable (no data collected). |
| **Advertising ID** | No, the app does not use the advertising ID. |
| **Government app** | No. |
| **Financial features** | None. |
| **Health** | Health apps declaration: choose the medical **education / reference** feature, and state that it is not a medical device, makes no diagnosis or treatment, and does not connect to health devices or collect health data. |
| **News app** | No. |

## Closed test (Test and release → Testing → Closed testing)

1. Create the track (default "Closed testing - Alpha"), **Testers**: an email list with 13–15 Gmail addresses.
2. **Countries:** all, or the testers' countries.
3. Create a release: upload the newest `ecgstudio-release-aab`, notes "First closed test".
4. Send to review (the first review of a new app can take several days).
5. When approved: copy the opt-in link and send it to the testers; each opens it on their Android phone and installs
   from the Play Store. They must stay opted in for 14 days in a row.
