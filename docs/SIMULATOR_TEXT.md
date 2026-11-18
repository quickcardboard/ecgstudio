# Simulator diagnosis text for review

The interpretation the simulator shows above the ECG (`interpret()`, `structFindings()`, `ischFindings()` in `src/app.js`).
The first line is the **rhythm** (bold on screen); below it the **measurement chips**, then the **findings**, one per line.
Text in ‹angle quotes› is filled from the ECG; [square brackets] appear only when that applies.

## 1. Rhythm line

| When | Text |
|---|---|
| While a new rhythm settles | Acquiring… |
| Ventricular fibrillation | Ventricular fibrillation[ (R-on-T PVC in ischemic myocardium)]: shock now |
| Adenosine, nothing conducted | Adenosine: transient AV-nodal block, no QRS conducted |
| Atrial fibrillation | Atrial fibrillation with ‹slow / controlled / rapid› ventricular response (‹rate› bpm, irregularly irregular)[, pre-excited: conducting over the accessory pathway] |
| Atrial flutter | Atrial flutter (‹typical, counterclockwise / atypical, clockwise›), atrial ‹rate›/min with ‹n:1 / variable› AV conduction |
| Ectopic atrial | Ectopic atrial ‹rhythm / tachycardia›: low right-atrial focus, ‹rate› bpm, inverted P in II, III and aVF |
| MAT (over 100) | Multifocal atrial tachycardia: ‹rate› bpm, irregular, three or more P-wave shapes |
| WAP (100 or less) | Wandering atrial pacemaker: ‹rate› bpm, irregular, three or more P-wave shapes |
| VT | Monomorphic ventricular tachycardia, ‹rate› bpm, with AV dissociation |
| Torsades | Torsades de pointes: polymorphic ventricular tachycardia, ‹rate› bpm, the QRS axis twisting around the baseline (amplitude waxing and waning) |
| AVNRT | AVNRT (typical slow–fast): ‹rate› bpm, narrow QRS, retrograde P hidden at the end of the QRS |
| AVRT | **Orthodromic AVRT** (changed: was "Orthodromic AVRT: down the AV node, back up the ‹site› accessory pathway (narrow QRS, no pre-excitation)") |
| Sinus arrest | Sinus arrest with ‹junctional / ventricular› escape rhythm |
| Complete AV block | 3rd-degree (complete) AV block[ (bilateral bundle branch block) / (trifascicular block)] with ‹junctional / ventricular / idioventricular› escape rhythm |
| Sinus pause | Sinus rhythm with sinus pause[ and junctional escape beats] |
| SA exit block | Sinus rhythm with 2nd-degree SA exit block |
| Wenckebach | Sinus rhythm with 2nd-degree AV block, Mobitz I (Wenckebach) |
| 2:1 block | Sinus rhythm with 2:1 AV block |
| Mobitz II | Sinus rhythm with 2nd-degree AV block, Mobitz II |
| Junctional escape | Junctional escape rhythm |
| Ventricular escape | Ventricular escape rhythm |
| Sinus | Normal sinus rhythm / Sinus bradycardia (under 60) / Sinus tachycardia (over 100) |

Added to the rhythm line when they apply, in this order:

| When | Added text |
|---|---|
| PR over 200 ms, or the 1st-degree block set | … with 1st-degree AV block |
| Bundle and fascicle blocks | ; left bundle branch block · ; right bundle branch block · ; left anterior fascicular block · ; left posterior fascicular block · ; bifascicular block (RBBB + LAFB) · ; bifascicular block (RBBB + LPFB) |
| Adenosine given | · adenosine: transient AV-nodal block |
| Ectopic beats in the last 10 s (not in tachycardias) | … with ‹n› PAC(s) and ‹n› non-conducted PAC(s) and ‹n› PVC(s) |

## 2. Measurement chips

Rate (or Ventricular and Atrial when they differ) · Atrial: fibrillatory (AF) or ‹rate›/min (flutter) · PR (‹ms›, ‹min–max› ms when it varies, dissociated in complete block) or RP ‹ms› (retrograde P) in AVRT · QRS · QT/QTcF · Axis ‹±deg›° · ‹normal axis / left axis deviation / right axis deviation›, labelled "Axis (LV forces)" with RBBB alone and "Axis (first 60 ms)" with RBBB plus another block. VF shows one chip: Rhythm: chaotic, no QRS complexes.

## 3. Findings: structure and conditions

| Finding | Text |
|---|---|
| Biatrial enlargement | Biatrial enlargement: P ‹mV› mV in II and ‹ms› ms wide[, notched in II (humps ‹ms› ms apart)] |
| Right atrial enlargement | Right atrial enlargement (P pulmonale): P ‹mV› mV in II |
| Left atrial enlargement | Left atrial enlargement (P mitrale): P ‹ms› ms wide[, notched in II (humps ‹ms› ms apart)] |
| WPW | Ventricular pre-excitation (WPW pattern): short PR (‹ms› ms), delta wave, QRS ‹ms› ms. Repolarization changes are secondary. |
| LVH | Left ventricular hypertrophy by voltage (Sokolow–Lyon ‹mV› mV)[ with repolarization abnormality (strain)] |
| RVH | Right ventricular hypertrophy: dominant R in V1 (R ‹mV› mV)[ with T inversion in V1–V2 (RV strain)] |
| Pericarditis | Diffuse ST elevation (‹leads›) with ST depression in aVR[ and PR depression in II (‹mV› mV)]: acute pericarditis pattern |
| Brugada | Coved ST elevation ≥ 2 mm with T inversion in ‹V1, V2›: Brugada type 1 pattern |
| Hyperkalemia | Tall, narrow, peaked T waves (‹lead› ‹mm› mm)[, flattened P waves, long PR and a wide QRS]: hyperkalemia pattern |
| Hypokalemia | Flat T waves followed by U waves (best seen in V2–V3), slight ST sagging: hypokalemia pattern |
| Hypocalcemia | Long QTc (‹ms› ms) from a long, flat ST segment with a normal T wave: hypocalcemia pattern |
| Hypercalcemia | Short QTc (‹ms› ms): the T wave starts almost at the end of the QRS (short ST segment): hypercalcemia pattern |
| Hypothermia | J (Osborn) waves at the end of the QRS, long QT and bradycardia: hypothermia pattern |
| STEMI in LBBB | LBBB with ‹concordant ST elevation in …; concordant ST depression in …; discordant ST elevation ≥ 25% of the S wave in …›: Sgarbossa criteria (modified) positive, acute STEMI |
| LBBB, no STEMI | LBBB: ST changes within the expected discordance (Sgarbossa criteria negative) |
| Wellens A | Biphasic T waves (up, then down) in V2–V3, no Q waves, ST near baseline, R waves preserved: Wellens pattern type A |
| Wellens B | Deep, symmetric T-wave inversion in V2–V4, no Q waves, ST near baseline, R waves preserved: Wellens pattern type B |
| Non-specific ST-T | Flat T waves in ‹leads›: non-specific ST-T changes |

## 4. Findings: ischemia (the first line is the headline)

| When | Text |
|---|---|
| Settling after a change | Updating… |
| Subendocardial (narrowing) | ST depression in ‹leads›: subendocardial ischemia (NSTEMI pattern) |
| …with mirror elevation | ST elevation in ‹leads› mirrors the depression (no transmural injury) |
| …no change | Subendocardial ischemia here produces no diagnostic ST change |
| STEMI | ‹Acute / Evolving› ‹anterior / anterolateral / inferior / inferolateral / lateral› STEMI: ST elevation in ‹leads› |
| …reciprocal | Reciprocal ST depression in ‹leads› |
| …RV involvement | ST elevation in V1 with an inferior STEMI suggests right ventricular involvement (record right-sided leads) |
| …posterior | ST depression in V1–V3 suggests posterior extension |
| Posterior only | ST depression in ‹leads›: consider posterior STEMI (record V7–V9) |
| Infarct, ST resolved | ‹Old / Q-wave› ‹wall› infarct[ (age undetermined: recent or old)]: Q/QS waves in ‹leads›, R waves lost in ‹leads›, T inversion in ‹leads›, ST at baseline |
| Hyperacute | Hyperacute T waves in ‹leads›: earliest sign of coronary occlusion |
| ST depression only | ST depression in ‹leads›[, ST elevation in aVR]: ischemia |
| Nothing diagnostic | No diagnostic ST change in the 12 leads |
| Extra lines | Hyperacute T waves in ‹leads› · Pathological Q/QS waves in ‹leads› · R waves lost in ‹leads› · T-wave inversion in ‹leads› · ST depression in ‹leads› · T-wave inversion in ‹leads› (subendocardial) |
| Nodal arteries | The occlusion is proximal to the sinus-node and AV-node arteries: sinus slowing and a longer PR · The occlusion is proximal to the sinus-node artery: sinus slowing · The occlusion is proximal to the AV-node artery at the crux: slower AV conduction, longer PR |
