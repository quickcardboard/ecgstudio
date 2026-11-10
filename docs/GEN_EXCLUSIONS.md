# Training generator: what it never makes, and what it throws away

Reference for the next engine round (2026-11-09). Source: `src/training_gen.js` (rules) and an audit of 240 random
scenarios (`node tools/trainlive.js 60 <seed>` for seeds 11–14, ratings 1200–2100): **177 kept (74%), 63 discarded**.

## A. Combinations never generated (fixed rules)

| Rule | Why (as written in the code) | Kind |
|---|---|---|
| Hypertrophy (LVH/RVH) + acute STEMI, narrowing or hyperacute T | hypertrophy amplifies the injury current: ST elevation far too tall | engine |
| LBBB + any ischemia or pericarditis | clinical call (LBBB hides them; Sgarbossa not taught) | design |
| RBBB + old/recent infarct, hyperacute T, narrowing, pericarditis | "RBBB's own T waves" | engine/reader |
| LAFB + inferior or circumflex infarct; LPFB + LAD or circumflex infarct | the infarct moves the axis | engine |
| Fascicular block + hyperacute T | the territory repolarises in two waves: notched, M-shaped T | engine |
| First-degree AV block + RCA infarct | proximal RCA slows the AV node: P sinks into the T | engine |
| WPW + circumflex infarct | the left-lateral pathway sits in that territory: pre-excitation disappears | engine |
| WPW + AV block, fascicular/bundle branch block, hypertrophy, pericarditis, Brugada, atrial enlargement, ectopy, pauses | P runs into the delta wave; P on the previous T | design/engine |
| At most one QRS-changing condition (except RBBB + LAFB/LPFB) | readability | design |
| Pericarditis only with the rhythm, atrial enlargement or first-degree block | design | design |
| Non-specific ST-T not with ischemia, pericarditis, Brugada, bundle branch block, hypertrophy, WPW | would not be "non-specific" | design |
| Flutter + any infarct pattern, narrowing, hyperacute T, non-specific ST-T | flutter waves sit on the ST segment | design |
| Sinus tachycardia + 1st-degree block, WPW, LBBB, RBBB, pericarditis, biatrial enlargement | P on the previous T | engine |
| Junctional escape + LBBB, RBBB, non-specific ST-T | wide QRS passes for ventricular escape; retrograde P on the ST-T | design |
| Ectopy, pauses, SA block only on sinus rhythm / sinus bradycardia | timed from sinus beats | engine |
| AVNRT, AVRT, VT, VF, idioventricular: no other findings | design | design |
| Infarct sites: only proximal/mid LAD, proximal/mid RCA, proximal circumflex. Narrowing not at mid LAD (< 1 mm); hyperacute T not at circumflex or proximal RCA (T too small) | engine |

## B. Discarded after building (audit)

Pass rate by item (each discard counts against everything in that ECG): MAT 22%, RAE 25%, LPFB 29%, sinus pause 40%,
junctional 44%, hyperacute 46%, narrowing 47%, non-specific ST-T 47%, LAFB 50%, AF 50%, CHB 50%, old MI 56%,
sinus tachycardia 58%. VT, VF, AVNRT, AVRT, 2:1 block, LVH, PVC, LBBB, flutter ≥ 84%.

| Cause | n | Examples |
|---|---|---|
| **Narrowing (ST depression)**: too shallow (< 1 mm), or ST elevation as well | 12 | proximal LAD narrowing: ST depression I/aVL/V4/V5 with ST elevation elsewhere (6); none ≥ 1 mm with junctional rhythm, sinus tachycardia or a fascicular block (6) |
| **Blind read sees something not put in** | 12 | AF/flutter + RBBB → "RVH" (3); sinus tachycardia + old inferior MI → "RAE" (2); AF + narrowing → "old anterior MI" (2); AF + LBBB → "Brugada"; AF + Brugada → "anterior STEMI"; LBBB + 1st-degree → "LAE"; junctional + old LCx MI → "IVCD"; LPFB → "old inferior MI" |
| **Rhythm**: MAT read as AF or sinus tachycardia (4); P waves hidden (7: MAT ×3, fast rates, couplets, pauses) | 11 | |
| **Non-specific ST-T**: T inverted or ST depressed instead of flat, or no flat T at all | 7 | |
| **Hyperacute T** not tall enough (mid RCA ×3, proximal LAD ×2) | 5 | |
| **Fascicular block axis** just outside the range (LAFB −43°, LPFB 88°/91° in flutter) | 4 | |
| **Old/recent infarct without Q waves** (proximal/mid RCA, mid LAD) | 4 | |
| **Proximal RCA STEMI without ST elevation** | 2 | |
| **Sinus pause did not happen** (longest RR 1250 ms) | 2 | likely a timing bug, not the engine |
| Other single cases: AF pericarditis ST not concave; RBBB QRS 126 ms with CHB; PVC timing | 3 | |
