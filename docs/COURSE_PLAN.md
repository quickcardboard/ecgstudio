# ECG course ("Learn"): plan

Status: planning. Last updated 2026-11-21: the author's edits of 2026-11-20 reconciled, then the rhythm units reordered, the lead overlay left out, the author's decisions on teaching and layout added, and the model audit summarised. Pricing is still open.

## The concept

Most ECG teaching starts from criteria and shapes to memorise. This course starts from the heart. The student sees the wave of activation move through the app's own 3D heart, predicts what a lead will draw, then watches the heart draw it. Every pattern is explained by what the heart is doing, so a student who understands the normal beat can work out an abnormal one before being told its name.

The course is practical: ECGs are read the way clinicians read them, by eye and in a fixed order (rhythm, then the QRS, then ischaemia and the ST-T).

- **Audience:** complete beginners.
- **Where:** a Learn mode inside Training.
- **Visuals:** the 3D heart, with overlays. No separate diagram model (an arrow-diagram mock-up was tried on 2026-11-20 and rejected: a second model to learn, and too busy). Graphs such as an action potential curve sit in the lesson sheet below the heart.
- **Product:** premium with a trial. How it relates to Training's purchase is open (see Pricing).

## Teaching style

What every lesson does, whatever its topic. This is what sets the course apart from other ECG courses.

- **Heart first, paper second.** Every pattern is first seen happening on the 3D heart, then on the strip. The student never meets a tracing without having watched what made it.
- **Teach, then ask; never guess.** Every question uses only what has already been taught. The theory comes first, in small steps, and a question follows only when the student has everything needed to work out the answer. Questions start easy and build slowly.
- **Commit before you see.** Once the student has what they need, each new pattern is a prediction about one named lead, answered before anything moves. The prediction is a reasoned step, not a guess.
- **The student causes it.** Wherever possible the student makes the change: cuts the bundle, blocks the artery, taps the muscle. It is their heart doing it, not a picture being shown.
- **The name comes last.** A lesson explains what happened before it names it. Lesson titles are plain topic names ("The right bundle"), never riddles; the diagnosis ("RBBB") is given at the end of the lesson and shown in the lesson list once the lesson is done.
- **Every abnormal beat is a change to a normal one.** Each pattern is explained as a difference from the normal beat or from something learned earlier, never as a new thing to memorise.
- **Both directions.** Forward: from the heart to the strip (predict). Backward: from the strip to the heart (pick the structure). Reading an ECG is the backward direction, so the course trains both.
- **Why it matters, and what next.** Every finding ends with its clinical weight and the logical next step (for example: VT is an emergency, check for a pulse and prepare to shock; a new STEMI goes to the cath lab). Unit tests ask about the next step where it matters.
- **Real strips, read by eye.** Choices are real three-beat strips on ECG paper at the usual scale. Numbers are used only where a clinician would reach for them.
- **The same heart everywhere.** The heart, colours and gestures are the simulator's. What is learned in a lesson works straight away in the simulator and in Training.

## How a lesson works

Each lesson teaches one thing in 3–5 minutes on a phone, in five steps. The student always knows where they are.

- **Set-up.** One or two sentences and the heart in the view the lesson needs, the target ringed. Example: "This is the right bundle. It carries the wave to the right ventricle."
- **Teach.** The theory the question needs, in short steps on the heart: what this structure does, which way the wave goes, what the lead sees. Several small steps where the idea is new.
- **Predict.** A question about one named lead or strip, answered by picking one of three or four tracings, using only what was just taught. Example: "The right bundle is cut. What will V1 draw?" Nothing moves until the student commits.
- **Watch.** The change is made, by the student where possible (cut the bundle, block the artery, tap the muscle), and plays in slow motion. A time bar scrubs through one beat; the heart vector arrow shows where the wave is heading and how strong it is.
- **Explain.** A few sentences linking what was seen to the physiology, with the relevant part of the strip highlighted. A wrong prediction gets its own short explanation here. The lesson ends with the name of the finding, why it matters and what to do next.

There is no quiz at the end of a lesson. A single lesson is too narrow to test on its own (an RBBB quiz before LBBB and the fascicular blocks only asks "RBBB or not?"). Predict already makes the student commit to an answer in every lesson. Testing happens at the end of each unit, where findings can be mixed.

### Unit tests

- At the end of every unit, about 10 questions, cumulative: the findings of this unit mixed with everything learned before. Not all questions are ECG interpretation: theory questions (what happens in the heart, why) and next-step questions are part of every test.
- From unit 4 (normal sinus rhythm) on, the questions are whole ECGs from Training's generator, limited to the findings already taught (each finding has its own key in the generator, so the limit is a list per unit).
- Units 1–3 (anatomy, electrophysiology, the ECG) have no ECGs to read yet. Their tests use the other question types: pick the structure, pick the lead, which way will it deflect, which event of the beat is this wave.
- A test shows a score and, for each miss, the lesson to revisit. It does not lock the next unit and does not change Training's ratings.

### Question and interaction types

- **Pick the strip** (the main one): three or four strips of the same named lead, three beats each, drawn by the engine. The right one is the scenario's own output; the others are the same lead from other scenarios (for V1: normal, RBBB, LBBB). Three-beat strips read like a real ECG; single beats were rejected (hard to read, no sense of scale).
- **Pick the baseline:** for rhythms, 3-second strips of lead II. Example: the atria flutter on the heart; pick the baseline (sawtooth, wavy and irregular, flat with P waves).
- **Pick the leads:** a tappable 12-lead map. "The LAD is blocked. Which leads will show ST elevation?"
- **Pick the structure:** the reverse of Predict. The student sees an ECG and taps where it comes from on the heart: the origin of an ectopic beat, the blocked bundle, the occluded artery or its territory, the side of an accessory pathway.
- **Make it happen:** the student acts on the heart: tap the muscle for an ectopic beat, cut a bundle, block an artery, drag the ischaemia time.
- **Scrub one beat:** drag through a single beat in slow motion and see the wave and the overlays move with it.

### Overlays on the 3D heart

- **Wavefront colours:** already in the simulator (resting pink, the blue wavefront, green recovery).
- **Heart vector arrow:** the sum of everything active at that moment, drawn as a moving 3D arrow from the centre of the heart whose length is its size: it grows, turns and shrinks through the beat, like the simulator's heart vector but as a solid 3D arrow. The student turns the heart to see its direction.
- **The leads:** the simulator's existing lead layer, which shows where each lead looks from. No extra 3D lead objects: many moving arrows distract and cover the heart.
- **Point targets:** the current pulsing ring, for something to tap (a bundle, the sinus node, an artery).
- **Area targets:** a tint over a region, dimming the rest (an artery's territory, the RV free wall, a fascicle's territory), close to the ischaemia view.

Not planned: a trace cursor on the strip and a close-up of individual cells (a close-up only shows a blue patch and does not explain electrophysiology; that unit uses the whole heart plus a graph in the sheet). Left out: a lead drawn in 3D with the arrow's shadow on it, and any other moving 3D arrows besides the heart vector.

## Curriculum

Fourteen units following clinical categories, matching Training's skills. Each unit lists its lessons, what the student does in them, and notes. Roughly 60 lessons, 4–5 hours.

**Lesson 0, the teaser (2 minutes, before unit 1):** the heart beats; tap the muscle and an extra wide beat appears on the strip; block an artery and the ST segment rises. "By the end of this course you will know exactly why." This is the "wow" moment, and it belongs in the free trial.

### 1. The heart and its wiring

Anatomy taught by touching the 3D heart. Tap a structure to learn it; quick "find it" questions reinforce.

- **Chambers and valves:** the four chambers, the valves, the order blood flows through them. A lesson-only view cuts across the heart at the valve level, seen from above (short axis from the base), so the four valves can be tapped and named. (Today the valves are drawn but cannot be tapped; making them tappable is a small change.)
- **The fibrous skeleton:** the ring between atria and ventricles that does not conduct. This is why the AV node is normally the only way through (it sets up the AV delay and, later, the accessory pathway).
- **The coronary arteries:** LAD, circumflex, RCA and their main branches, and the wall each one feeds. This is what the ischaemia unit builds on.
- **The conduction system:** sinus node, atria, AV node, His bundle, the bundle branches and fascicles, the Purkinje network. Fast wiring under the inner surface.
- **The wall:** endocardium (inside) to epicardium (outside); the wave goes inside to outside.

Test: pick the structure (chambers, valves, arteries, wiring).

### 2. How a beat starts and spreads (electrophysiology, brief)

Only what is needed to understand why there is a stimulus and a wave at all, and to come back to in the electrolyte unit. No phase numbers or channel names to memorise. The heart shows where; the sheet shows a simple voltage curve.

- **Starting:** pacemaker cells drift upward by themselves until they fire. The sinus node is the fastest, so it sets the rate; the AV node and the ventricles are slower back-ups. (Nodal versus muscle cells.)
- **Firing and recovering:** a muscle cell fires fast (sodium in), stays charged for a while (calcium, the plateau, which is also the contraction), then recovers (potassium out). While charged it cannot fire again (refractory).
- **Spreading:** each cell fires its neighbour, so the beat travels as a wave. Wiring is fast, muscle is slow; watch the same heart with the wiring and with a wave started in the muscle.

Test: which way the curve goes next; where the beat starts; which is faster.

### 3. The ECG: what a lead sees

The core of the course. Toward and away is taught with many short Predict questions, one lead and one wave at a time, until it is automatic.

- **A lead is a viewpoint:** each lead has a positive electrode and looks at the heart from that side. The limb leads (frontal plane), then the chest leads (the horizontal plane, V1 over the right ventricle to V6 at the left side).
- **Toward and away:** a wave of activation moving toward a lead's positive electrode draws upward; away, downward; across it, a small up-and-down. Many predictions: the same wave seen from different leads; different waves seen from one lead.
- **Recovery seen by a lead:** a wave of recovery draws the opposite way: moving toward the electrode it draws downward. In the ventricles recovery runs outside to inside, so it moves away from the electrode and draws upward: the normal T is upright. This explains later why the T flips when activation is abnormal (bundle branch blocks, hypertrophy) and in ischaemia.
- **The sum:** a lead draws the sum of everything active at that moment, often a tug of war between the left and right ventricles (and between parts of the left ventricle). The bigger left ventricle usually wins. The heart vector arrow is introduced here.
- **Which wall each lead faces:** inferior (II, III, aVF), lateral (I, aVL, V5–V6), anterior (V1–V4); the groups used later for ischaemia.
- **The paper:** time across, voltage up; small and big squares; read by eye.

Test: pick the deflection for a wave and a lead; pick the lead that would see a wave best; which wall a lead faces.

### 4. The cardiac cycle and normal sinus rhythm

The sequence of one heartbeat, mechanical and electrical side by side: what the heart is doing during each wave. The heart does not move (a contraction animation would slow the app); highlights on the chambers and arrows for the blood flow show which part of the cycle the beat is in. Normal sinus rhythm is taught here, as the rhythm this cycle makes.

- **The sequence:** the atria fire (P) and then squeeze; the AV node holds the beat (PR) so the ventricles can fill; the ventricles fire (QRS) and then squeeze through the ST and T; they relax after the T.
- **The normal beat wave by wave:** P, PR, the septal q, R, S, ST, T, each linked to the wave on the heart, with R growing from V1 to V6.
- **Rate and intervals by eye:** rate from the big squares; a normal PR, a narrow QRS and a QT that ends before halfway to the next beat, judged by eye. The few numbers worth knowing are listed under Numbers below.
- **Sinus rhythm:** every beat starts at the sinus node, a P before every QRS; slow and fast sinus rhythm; sinus arrhythmia with breathing.

Test: match each wave to its event; normal or not by eye; the first whole ECGs (sinus rhythms, from Training's generator).

### 5. Supraventricular rhythms

- **Premature atrial beats.**
- **Atrial fibrillation:** many small wavelets, no organised atrial beat; an irregularly irregular rhythm.
- **Atrial flutter:** one wave circling the right atrium; the sawtooth; the AV node lets only some waves through (often every second one).
- **Multifocal atrial rhythm (WAP and MAT).**
- **Re-entry: AVNRT and AVRT:** a loop through the AV node, or through an accessory pathway across the fibrous skeleton (unit 1). Regular narrow tachycardias, and why they are hard to tell apart (SVT is an acceptable answer).

Test: supraventricular rhythms mixed with sinus rhythms.

### 6. Ventricular rhythms

- **Premature ventricular beats:** tap the muscle; wide because they travel through muscle (unit 2). Couplets, bigeminy, trigeminy. Pick the structure: where did it start.
- **Ventricular tachycardia:** a run of wide beats; why it is wide and regular; an emergency (its origin does not matter at this level).
- **Ventricular fibrillation:** no organised activation at all.

Test: all rhythms so far mixed.

### 7. Sinus pauses and SA block

- **Sinus pause and arrest:** the sinus node stops.
- **SA exit block:** the node fires but the beat does not get out; the pause is an exact multiple of the cycle.
- **Escape rhythms:** the back-ups from unit 2 take over: junctional (narrow, no P) and ventricular (wide, slow).

Test: pauses mixed with the rhythms of units 5–6.

### 8. The PR interval and AV block

- **First-degree block:** the AV node holds every beat too long.
- **Wenckebach (Mobitz I):** the hold grows until a beat is dropped. Watch the AV node tire beat by beat.
- **Mobitz II and 2:1:** sudden drops below the AV node; why this one is more dangerous.
- **Complete heart block:** atria and ventricles each at their own rate; the escape rhythms from unit 7.
- **A short PR: WPW.** A second path through the fibrous skeleton (unit 1). The wave leaks early into the ventricle: short PR, delta wave, wide QRS. Pick the structure: tap the extra path (one site, on the left side).

Test: AV blocks mixed with all the rhythms.

### 9. Bundle branch and fascicular blocks

- **RBBB:** the left side fires as normal, the right ventricle late and alone: R′ in V1, broad S in I and V6, wide QRS. Uses the rbbb lesson preset; the axis is not shown (see Model accuracy).
- **LBBB:** the septum fires from the right, the left ventricle late: no septal q, broad R in I and V6, deep QS in V1; the T turns against the QRS.
- **The axis:** the direction of the heart vector in the frontal plane, read by eye from leads I and aVF. Taught here because the fascicular blocks are what move it.
- **LAFB:** left axis deviation; **LPFB:** right axis deviation (uses the lpfb preset).
- **Bifascicular block:** RBBB with LAFB (uses the rbbb preset).
- **Non-specific widening:** a wide QRS that fits neither bundle.

### 10. Hypertrophy and enlargement

- **Atrial enlargement:** right (tall P in II) and left (broad, notched P; deep negative end in V1).
- **LVH:** bigger muscle, bigger voltage; the strain pattern when the T turns over.
- **RVH:** the right ventricle wins the tug of war: tall R in V1, right axis.

### 11. Ischaemia and infarction

- **Occlusion and territory:** block an artery (unit 1) and pick the leads that will show ST elevation; then see the territory light up.
- **Reciprocal changes:** the leads facing the opposite wall show ST depression.
- **Posterior and right-ventricular infarcts, through reciprocal changes:** no standard lead faces the back of the heart or the right ventricle, so they are seen in mirror image or by clues: a posterior infarct as ST depression in V1–V3 (later a tall R in V1–V2); a right-ventricular infarct with an inferior one, as ST elevation in III more than II and in V1. Next step for both: do a 15-lead ECG (V4R, V7–V9).
- **The time course:** hyperacute T, ST elevation, Q waves, T inversion: drag the time bar.
- **Inferior, lateral and anterior infarcts** by territory.
- **Old infarct:** the Q wave as a window onto the far wall (the dead wall is silent, so the lead sees the opposite wall moving away).
- **Wellens:** the warning T waves of a critical LAD narrowing.
- **STEMI in LBBB (advanced):** why LBBB hides ischaemia, and the concordance clue.

Pick the structure is the natural test here: see the ECG, tap the artery.

### 12. Electrolytes

Back to the action potential of unit 2: what changes in the cell, then what the ECG shows.

- **Potassium high:** tall peaked T, then wider QRS and flatter P.
- **Potassium low:** flat T, U waves, a long QT-U.
- **Calcium high and low:** a short or long ST segment.

### 13. Other causes of ST-T changes

Working title; other names: "Not a heart attack", "Mimics".

- **Pericarditis:** ST elevation everywhere, without a territory.
- **Brugada pattern.**
- **Hypothermia:** the Osborn wave.
- **Long QT and torsades.**
- **Non-specific ST-T changes.**

### 14. Combinations and pitfalls

- **The full read:** rhythm, then the QRS, then ischaemia and the ST-T, on whole ECGs.
- **Common combinations:** an infarct with a bundle branch block, AF with a block, and so on.
- **Artefacts:** tremor and other noise that imitate rhythms.
- **Pacemakers** come with the planned pacemaker update (a virtual pacemaker, ICD and CRT programmer, with pacemaker failures).

Test: the final test, mixed from the whole course, leading into Training.

## Numbers

The course recognises by eye first. The numbers below are the only ones taught, each next to how to see it without measuring. Others (voltage criteria, Q-wave sizes, Sgarbossa) can sit in optional reference text inside a lesson, never in a question.

- **Rate:** count the big squares between beats; 300 ÷ big squares.
- **Wide QRS:** looks broad and blunt; more than 3 small squares.
- **Long PR:** the P sits far from the QRS; more than 1 big square.
- **ST elevation:** the segment sits above the baseline; 1 small square (2 in V2–V3).
- **Long QT:** the T ends past halfway to the next beat.
- **Axis:** I and aVF both upright is normal (unit 9).

## Phone layout

From the first mock-ups (2026-11-20) and the author's comments.

- Two panels: the heart on top, one lesson sheet below whose content changes with each step. Most interaction happens in the lower half, within thumb reach.
- When the student has to touch the heart, it gets most of the screen with one lead kept at the bottom, as the simulator's expanded heart view does, and returns to two panels once the action is done.
- One lead at a time, as three-beat strips. A whole 12-lead appears only in unit tests and in questions that need one.
- Short text per step; longer explanations behind a tap.
- The simulator's tabs, speed and menu are hidden during a lesson: close, the title and progress only.

## Model accuracy

The course must never teach a model quirk as fact. Every lesson scenario is checked with tools/scorecard.js and tools/reader.js before its text is written. Where the model is weak, the lesson avoids that feature or uses a lesson preset.

**Lesson presets** are extra engine settings used only inside one lesson and reset when it ends, never in the free simulator or in Training's ratings. They change conduction and source strength only, never the heart's position. Two exist (search of 2026-11-20; notes in docs/DEVELOPMENT.md):

- **lpfb:** axis 92° → 100° (the preset's normal beat 29°), a clear rS in I, R III 31 → 20 mm; its normal beat has low voltage. Settings: {"lpfTerrLo":-2.9,"lpfTerrHi":1.2,"purkCrossSlow":10,"lsfTie":"LPF","lsfTieDelay":3,"septalTerrHalf":0.2,"lpfApexZ":0.2,"lvSourceGain":0.6,"lpfPhi":-1.8,"lpfZ":0.4,"fascConnectFrac":0.35,"cvVentLong":0.45,"rvSourceGain":0.7,"purkCrossFastPhi":null}
- **rbbb:** V1 r 2.7 / R′ 4.9 → r 4.1 / R′ 6.2 mm, axis −51° → −19° (the preset's normal beat 63°), upright inferior leads. Settings: {"rvSourceGain":0.9,"pmjRetroRV":50,"purkZmaxRV":0.8,"septalTerrHalf":0.85,"lsfPhi":1.1,"lsfZ":0.25,"rvCvMul":1,"cvVentTrans":0.34,"cvVentSheet":0.25,"precordialDipoleW":0.6,"dowerChest":0,"rbbSeptalFrac":0}

Known gaps to design around (full list, unit by unit, in the "ECG course model audit" document of 2026-11-21):

- **Presets:** RBBB (the live model's late RV forces point up: axis −51°, QS in aVF) and LPFB (R III 31 mm). The RBBB lesson teaches V1, I and V6 and does not show the axis. The bifascicular lesson needs the rbbb preset.
- **Avoid:** the acute marginal branch (inferior pattern instead of RV), the first obtuse marginal branch (ST elevation spills into V4), the proximal circumflex as the old lateral example (adds inferior Q waves), and circumflex or left main occlusions for the time course (Q waves already at 1 hour). Flutter with 2:1 conduction does not show the sawtooth.
- **Check before the lesson:** the hyperacute T (not always tall), the recent infarct's T inversion, severe hyperkalaemia (the reader also sees an inferior Q), STEMI in LBBB, non-specific QRS widening, and PVC origin in V1.
- **Build:** tappable valves and a valve-level view, the fibrous skeleton ring, the cardiac-cycle highlights and arrows, the 3D heart vector arrow, an action-potential graph from a real model cell.
- **Unit tests:** Training's generator rarely makes Mobitz II, 2:1 AV block, regular 2:1 flutter and atrial tachycardia; tests that need them use fixed scenarios or a tuned generator.

## Where it lives

- **Training → Learn:** progress per unit; each skill rating in Training links to the lessons for that skill ("your bundle branch blocks are weak: RBBB lesson").
- Lessons and unit tests never change Training's ratings.
- Lesson content (text, steps, scenarios, choices) lives in one data file, like src/learn/topics.json, so the text can be edited without touching code.

### Pricing (to discuss)

- The author's idea: one purchase for the course that also unlocks Training (about $15), so there is a single unlock page instead of two locks on the same screen.
- Open: whether Training is still sold alone at $9.99; what people who already bought Training get (Learn free, or an upgrade product shown only to them; Google Play has no built-in upgrade pricing); a new product id for the combined purchase (the id "training" exists and cannot be changed).
- Trial: should include lesson 0 and reach at least one lesson with an abnormal ECG, so it shows what the course does.

## Build order

- **1. This plan.**
- **2. Prototype on a branch,** previewed on a phone at app/index.html: the lesson player (five steps, built on the tutorial's ring, card and step machinery), the expanded heart (one lead kept at the bottom) for touch steps, the 3D heart vector arrow, area tint, three-beat strip choices drawn by the engine, lesson presets. Two lessons: a theory-heavy one ("toward and away", unit 3) and an interpretation-heavy one (RBBB, unit 9).
- **3. Lesson 0 and units 1–4,** the foundation.
- **4. The other units,** a few lessons at a time, each checked against the model first, with their unit tests (Training's generator limited per unit).
- **5. The purchase and trial.**
