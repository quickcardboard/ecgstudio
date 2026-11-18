# Simulator diagnosis text

The analysis the simulator shows above the ECG (`interpret()`, `structFindings()`, `ischFindings()` in `src/app.js`),
trimmed on 2026-11-18 to the findings alone: no mechanism, criteria or advice (those are in the Learn tab), and no
measured values (those are in the measurement chips).
The first line is the **rhythm**; below it the **measurement chips**, then the **findings**, one per line.
‹Angle quotes› are filled from the ECG; [square brackets] appear only when that applies.

## 1. Rhythm line

| When | Text |
|---|---|
| While a new rhythm settles | Acquiring… |
| Ventricular fibrillation | Ventricular fibrillation |
| Adenosine, nothing conducted | Transient AV block (adenosine) |
| Atrial fibrillation | Atrial fibrillation with ‹slow / controlled / rapid› ventricular response |
| AF over an accessory pathway | Pre-excited atrial fibrillation |
| Atrial flutter | Atrial flutter with ‹n:1 / variable› AV conduction |
| Ectopic atrial | Ectopic atrial ‹rhythm / tachycardia› |
| MAT / WAP | Multifocal atrial tachycardia (over 100) / Wandering atrial pacemaker |
| VT | Monomorphic ventricular tachycardia |
| Torsades | Torsades de pointes |
| AVNRT | AVNRT |
| AVRT | Orthodromic AVRT |
| Sinus arrest | Sinus arrest with ‹junctional / ventricular› escape rhythm |
| Complete AV block | Complete AV block[ (bilateral bundle branch block) / (trifascicular block)] with ‹junctional / ventricular / idioventricular› escape rhythm |
| Sinus pause | Sinus rhythm with sinus pause[ and junctional escape beats] |
| SA exit block | Sinus rhythm with 2nd-degree SA exit block |
| Wenckebach | Sinus rhythm with 2nd-degree AV block, Mobitz I (Wenckebach) |
| 2:1 block | Sinus rhythm with 2:1 AV block |
| Mobitz II | Sinus rhythm with 2nd-degree AV block, Mobitz II |
| Junctional / ventricular escape | Junctional escape rhythm / Ventricular escape rhythm |
| Sinus | Normal sinus rhythm / Sinus bradycardia / Sinus tachycardia |

Added when they apply: … with 1st-degree AV block · ; right bundle branch block (and the other bundle and fascicular
blocks, bifascicular block (RBBB + LAFB / LPFB)) · ; transient AV block (adenosine) · … with ‹n› PAC(s), ‹n› non-conducted
PAC(s) and ‹n› PVC(s).

## 2. Measurement chips (unchanged)

Rate (or Ventricular and Atrial) · Atrial (fibrillatory, or the flutter rate) · PR (or RP in AVRT) · QRS · QT/QTcF ·
Axis ‹±deg›° · ‹normal axis / left axis deviation / right axis deviation›. VF: QRS none.

## 3. Findings: structure and conditions

Biatrial enlargement · Right atrial enlargement · Left atrial enlargement · WPW pattern · Left ventricular hypertrophy[
with strain] · Right ventricular hypertrophy[ with strain] · Acute pericarditis · Brugada type 1 pattern · Hyperkalemia
pattern / Severe hyperkalemia pattern · Hypokalemia pattern · Hypocalcemia pattern · Hypercalcemia pattern · Hypothermia
pattern (Osborn waves) · Acute STEMI in LBBB (Sgarbossa positive) / Sgarbossa negative · Wellens pattern type A / B ·
Non-specific ST-T changes

## 4. Findings: ischemia (the first line is the headline)

| When | Text |
|---|---|
| Settling after a change | Updating… |
| Subendocardial (narrowing) | ST depression in ‹leads› [then: ST elevation in ‹leads›] |
| STEMI | ‹Acute / Evolving› ‹anterior / anterolateral / inferior / inferolateral / lateral› STEMI: ST elevation in ‹leads› |
| …with | Reciprocal ST depression in ‹leads› · Possible right ventricular involvement · Possible posterior extension |
| Posterior only | Possible posterior STEMI: ST depression in ‹leads› |
| Infarct, ST resolved | Old ‹wall› infarct: ‹Q waves in …, R waves lost in …, T inversion in …› — or, with T inversion: Infarct ‹wall›, age undetermined: ‹…› |
| Hyperacute | Hyperacute T waves in ‹leads› |
| ST depression only | ST depression in ‹leads›[, ST elevation in aVR] |
| Nothing diagnostic | No diagnostic ST change |
| Extra lines | Hyperacute T waves in ‹leads› · Q waves in ‹leads› · R waves lost in ‹leads› · T-wave inversion in ‹leads› |

Removed: the sinus-node / AV-node artery notes ("The occlusion is proximal to …").
