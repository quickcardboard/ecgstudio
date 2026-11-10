// The interactive tutorial (docs/TUTORIAL_PLAN.md). Learn by doing: each step dims the page except its target, which
// gets a pulsing ring and a one-line card; the step moves on when its result shows (a PVC, an occlusion, a block, the
// full ECG), however the user got there. Next appears after a few seconds if the user is stuck, and does the step for
// them; Skip is always there.
// Runs in the app (src/inapp.js; also ecgstudio.app/app/) on phones held upright: on the first open of the simulator,
// and from Help → Tutorial. Steps 1–6 run in the simulator; step 7 rings the shell's Training tab, and Training then
// walks through answering one fixed ECG (not rated). At the end, or on Skip, the simulator is back at the Reset state.
(function () {
  'use strict';
  const INAPP = !!(window.ECGInApp && window.ECGInApp.active);
  const KEY = 'ecgstudio.tour';                       // (set once the tutorial has been offered)
  const NEXT_MS = 6000;
  const TOTAL = 12;                                   // cards counted in the app: 1–6 simulator, 7 the Training tab, 8–12 Training                               // Next appears after this long on a step
  const $ = (id) => document.getElementById(id);
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch (e) { return true; } };
  const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch (e) { /* no storage */ } };

  // ------------------------------------------------------------------ all the text (edit here)
  const TEXT = {
    welcomeTitle: 'Welcome to ECG Studio',
    welcome: 'Your 3D heart simulator and ECG playground',
    rotate: 'Drag the heart to turn it. Two fingers zoom, pan and twist.',
    pac: 'The early beat on the ECG is a PAC because the atrium was tapped.',
    pvc: 'The early, wide beat on the ECG is a PVC because the ventricle was tapped.',
    tapMuscle: 'Tap the myocardium here to trigger an ectopic beat.',
    tapMuscleNoRing: 'Tap the heart muscle to trigger an ectopic beat.',
    stemi: 'Its territory turns purple, and the ST rises in V1–V4: an acute anterior STEMI. In the Ischemia tab, you can progress the time since onset.',
    narrowed: 'A single tap narrows it. Double tap quickly to block it.',
    tapLad: 'Double tap the ringed LAD to occlude it.',
    tapLadNoRing: 'Turn the heart to its front, then double tap the LAD to occlude it.',
    lbbb: 'The left ventricle now activates late, from the right.',
    tapLbb: 'Inside the heart, the conduction system is in gold. Tap the ringed left bundle branch to block it.',
    fullEcgOpen: 'All 12 leads are shown. Double tap again to go back.',
    fullEcg: 'Double tap the ECG to see all 12 leads.',
    trainingTab: 'Tap the training icon on the top to enter training mode.',
    preparing: 'Training mode builds a new ECG each time at your level. Preparing one right now...',
    anterior: 'Where is the elevation? Tap Anterior in the list, or tap those leads on the ECG (swipe the ECG to show those leads)',
    regionDone: 'Then tap Done.',
    tapSinus: 'Tap Sinus rhythm.',
    typeSinus: 'Read the ECG. You can swipe the ECG to show different leads. Name the rhythm first: type S, I.',
    tapSte: 'Tap ST elevation.',
    typeSte: 'Now type each abnormality you see. Type S, T.',
    submit: 'Submit your answer.',
    result: 'Your score, finding by finding: tap one to see its leads. Click on a finding to see an explanation. You\'ll be rated on each ECG in training.',
    endTitle: 'That’s the tour',
    otherBlock: (name) => `That blocked the ${name}. Tap the ringed left bundle branch.`,
    end: 'Replay it any time: Simulator → Help → Tutorial. Have fun and explore!',
    endSim: 'Replay it any time: Help → Tutorial.',   // (without the app's Training step; not used yet)
  };

  // ------------------------------------------------------------------ overlay: dim with a ringed hole, and a card
  const CSS = `
#tour { position: fixed; inset: 0; z-index: 40; pointer-events: none; font: 15px/1.4 var(--font-ui, system-ui, sans-serif); }
#tour .t-dim { position: absolute; inset: 0; background: rgba(5,10,15,0.6); pointer-events: auto; }
#tour .t-ring { position: absolute; box-sizing: border-box; border: 2px solid var(--accent, #ef5b7a); border-radius: 50%;
  box-shadow: 0 0 0 200vmax rgba(5,10,15,0.5); transition: left 0.25s, top 0.25s, width 0.25s, height 0.25s, border-radius 0.25s; }
#tour .t-ring.rect { border-radius: 12px; }
#tour .t-ring.bare { border-color: transparent; }
#tour .t-ring.bare::after { display: none; }
#tour .t-ring.nodim { box-shadow: none; }
#tour .t-card.compact { padding: 8px 12px 10px; font-size: 14px; }
#tour .t-card.compact .t-head { margin-bottom: 2px; }
#tour .t-hbtns { display: flex; gap: 6px; margin-left: auto; }
#tour .t-hbtns button { padding: 6px 11px; font-size: 13px; }
#tour .t-ring::after { content: ""; position: absolute; inset: -2px; border-radius: inherit; border: 2px solid var(--accent, #ef5b7a); animation: tPulse 1.4s ease-out infinite; }
@keyframes tPulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.35); opacity: 0; } }
#tour .t-ring.rect::after { animation-name: tPulseR; }
@keyframes tPulseR { from { inset: -2px; opacity: 0.9; } to { inset: -12px; opacity: 0; } }
#tour .t-card { position: absolute; left: 12px; right: 12px; margin: 0 auto; max-width: 460px; box-sizing: border-box; pointer-events: auto;
  background: var(--surface, #121d27); color: var(--fg, #e3eaf0); border: 1px solid #33434f; border-radius: 12px; padding: 12px 14px 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
#tour .t-card.center { top: 50%; transform: translateY(-50%); }
#tour .t-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
#tour .t-n { font: 500 12px/1 var(--font-data, var(--font-ui, monospace)); color: var(--muted, #93a3b1); letter-spacing: 0.04em; }
#tour h2 { margin: 2px 0 6px; font: 600 22px/1.2 var(--font-display, var(--font-ui, sans-serif)); }
#tour p { margin: 0; }
#tour .t-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
#tour .t-btns:empty { display: none; }
#tour button { font: 500 14px/1 var(--font-ui, sans-serif); color: inherit; background: var(--raised, #1b2834); border: 1px solid #33434f; border-radius: 8px;
  padding: 9px 14px; cursor: pointer; touch-action: manipulation; }
#tour button.primary { background: var(--accent, #ef5b7a); border-color: var(--accent, #ef5b7a); color: var(--accent-fg, #160a0d); font-weight: 600; }
#tour button.t-skip { background: none; border: 0; padding: 6px 2px 6px 10px; color: var(--muted, #93a3b1); }
#tour .t-next { animation: tIn 0.25s ease-out; }
@keyframes tIn { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #tour .t-ring, #tour .t-ring::after, #tour .t-next { animation: none; transition: none; } }
`;
  let root = null, els = null;
  function mount() {
    if (root) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'tour';
    root.innerHTML = '<div class="t-dim" hidden></div><div class="t-ring" hidden></div><div class="t-card" role="dialog" aria-live="polite"><div class="t-head"><span class="t-n"></span><span class="t-hbtns"></span><button type="button" class="t-skip">Skip</button></div><h2 hidden></h2><p></p><div class="t-btns"></div></div>';
    document.body.appendChild(root);
    els = { dim: root.querySelector('.t-dim'), ring: root.querySelector('.t-ring'), card: root.querySelector('.t-card'), n: root.querySelector('.t-n'),
      skip: root.querySelector('.t-skip'), hbtns: root.querySelector('.t-hbtns'), title: root.querySelector('h2'), text: root.querySelector('p'), btns: root.querySelector('.t-btns') };
    els.skip.addEventListener('click', () => run && run.skip());
  }
  function unmount() { if (root) { root.remove(); root = null; els = null; } }

  // a target: { x, y, r } (a point, ringed as a circle) or { rect } (ringed with rounded corners)
  function place(view) {
    const t = view.target, ring = els.ring, H = innerHeight;
    els.dim.hidden = !view.modal;
    ring.hidden = !t;
    ring.classList.toggle('bare', !!(t && t.bare));
    ring.classList.toggle('nodim', !!(t && t.noDim));   // (the rest stays bright and usable, e.g. the ECG to swipe)   // (a hole only: the shell rings its own tab)
    let ty = null;
    if (t && t.rect) {
      const p = t.pad === undefined ? 4 : t.pad, r = t.rect;
      Object.assign(ring.style, { left: `${r.left - p}px`, top: `${r.top - p}px`, width: `${r.width + 2 * p}px`, height: `${r.height + 2 * p}px` });
      ring.classList.add('rect'); ty = r.top + r.height / 2;
    } else if (t) {
      const r = t.r || 26;
      Object.assign(ring.style, { left: `${t.x - r}px`, top: `${t.y - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
      ring.classList.remove('rect'); ty = t.y;
    }
    // the card on the side away from the target (top: below the app's header bar)
    const c = els.card, where = view.modal || ty === null ? (view.where || 'center') : view.where || (ty > H * 0.45 ? 'top' : 'bottom');
    c.classList.toggle('center', where === 'center');
    c.style.top = where === 'top' ? 'calc(env(safe-area-inset-top, 0px) + 58px)' : '';
    c.style.bottom = where === 'bottom' ? 'calc(env(safe-area-inset-bottom, 0px) + 12px)' : '';
  }
  function show(view) {
    mount();
    els.n.textContent = view.n || '';
    els.title.hidden = !view.title; els.title.textContent = view.title || '';
    const key = JSON.stringify([view.title, view.text, !!view.compact, (view.buttons || []).map((b) => b.label)]);
    els.card.classList.toggle('compact', !!view.compact);
    if (els.card.dataset.key !== key) {
      els.card.dataset.key = key;
      els.text.textContent = view.text || '';
      els.btns.innerHTML = ''; els.hbtns.innerHTML = '';
      const box = view.compact ? els.hbtns : els.btns;   // (a compact card: its buttons on the header line)
      for (const b of view.buttons || []) {
        const e = document.createElement('button'); e.type = 'button'; e.textContent = b.label;
        if (b.primary) e.className = 'primary'; if (b.next) e.classList.add('t-next');
        e.addEventListener('click', b.fn); box.appendChild(e);
      }
    }
    els.skip.hidden = !!view.noSkip;
    place(view);
  }

  // ------------------------------------------------------------------ the runner: steps polled a few times a second
  // A step: { n, enter(), view() → { target, text, buttons, next() }, leave() }. view() may call go() to move on.
  let run = null;
  function runner(steps, finish) {
    const r = { i: -1, t0: 0, timer: 0, steps };
    r.go = (i) => {
      const cur = r.steps[r.i]; if (cur && cur.leave) cur.leave();
      r.i = i; r.t0 = performance.now();
      if (i >= r.steps.length) { r.stop(); finish(true); return; }
      const s = r.steps[i]; if (s.enter) s.enter();
      r.tick();
    };
    r.next = () => r.go(r.i + 1);
    r.tick = () => {
      if (run !== r) return;
      const s = r.steps[r.i]; if (!s) return;
      const v = s.view();
      if (run !== r || r.steps[r.i] !== s) return;   // (the step moved on)
      v.n = v.n || s.n;
      v.buttons = v.buttons || [];
      if (v.text !== r.text) { r.text = v.text; r.t0 = performance.now(); }   // (each new instruction gets its own few seconds)
      if (v.next && performance.now() - r.t0 > NEXT_MS) v.buttons = v.buttons.concat([{ label: 'Next', next: true, fn: v.next }]);
      show(v);
    };
    r.stop = () => { clearInterval(r.timer); if (run === r) run = null; unmount(); };
    r.skip = () => { r.stop(); finish(false); };
    run = r; r.timer = setInterval(r.tick, 200);
    return r;
  }

  // ------------------------------------------------------------------ simulator (steps 1–7)
  function simTour() {
    const app = window.ECGStudioApp, T = app.tour, sim = () => app.sim, total = INAPP ? TOTAL : 6;
    const n = (k) => `${k} / ${total}`;
    const heart = () => $('pane3d').getBoundingClientRect(), ecg = () => $('paneEcg').getBoundingClientRect();
    const near = (a, b) => a.dot(b) > 0.9985;   // (the camera has not moved: about 3°)
    const dirSpot = (fn) => { let at = 0, dir = null, spot = null; return () => { const d = T.camDir(); if (!dir || !near(d, dir) || performance.now() - at > 1500) { dir = d; at = performance.now(); spot = fn(); } return spot; }; };
    let rect = null;   // (the Training tab, from the shell)
    if (INAPP) window.ECGInApp.listen('tour', (d) => { if (d.step === 'rect') rect = { left: d.x, top: d.y, width: d.w, height: d.h }; });
    const steps = [
      { n: n(1), view: () => ({ modal: true, title: TEXT.welcomeTitle, text: TEXT.welcome,
        buttons: [{ label: 'Start', primary: true, fn: () => run.next() }] }) },
      (() => {
        let d0 = null;
        return { n: n(2), enter() { d0 = T.camDir(); },
          view() {
            if (T.camDir().dot(d0) < Math.cos(0.45)) { setTimeout(() => run && run.steps[run.i] === this && run.next(), 400); }
            const h = heart();
            return { target: { x: h.left + h.width / 2, y: h.top + h.height / 2, r: Math.min(h.width, h.height) * 0.36 }, text: TEXT.rotate, next: () => run.next() };
          } };
      })(),
      (() => {
        let beat = null; const spot = dirSpot(() => T.muscleSpot());
        const on = (d) => { if (run && run.steps[run.i] === step) beat = d.kind; };
        T.on('ectopic', on);
        const step = { n: n(3), enter() { beat = null; },
          view() {
            if (beat) return { target: { rect: ecg() }, text: beat === 'atrial' ? TEXT.pac : TEXT.pvc,
              buttons: [{ label: 'Next', primary: true, fn: () => run.next() }] };
            const s = spot();
            return { target: s && { x: s.x, y: s.y, r: 24 }, text: s ? TEXT.tapMuscle : TEXT.tapMuscleNoRing, next: () => { if (s) T.stimulate(s); else run.next(); } };
          } };
        return step;
      })(),
      (() => {
        let shown = false; const spot = dirSpot(() => T.arterySpot());
        return { n: n(4), enter() { shown = false; T.closeAll(); T.outside(); T.group(0); },
          view() {
            const ins = sim().insults, occ = ins.some((v) => v.kind === 'occlusion'), narrow = ins.some((v) => v.stenosis);
            if (occ) {
              if (!shown) { shown = true; T.group(2); }
              return { target: { rect: ecg() }, text: TEXT.stemi,
                buttons: [{ label: 'Next', primary: true, fn: () => run.next() }] };
            }
            const s = spot(), lad = app.model.coronary.branches.LAD;
            return { target: s && { x: s.x, y: s.y, r: 24 },
              text: narrow ? TEXT.narrowed : s ? TEXT.tapLad : TEXT.tapLadNoRing,
              next: () => T.occlude(s ? s.node : lad[Math.round(lad.length * 0.3)]) };
          } };
      })(),
      (() => {
        let shown = false; const spot = dirSpot(() => T.conductionSpot('LBB'));
        return { n: n(5), enter() { shown = false; T.clearIschemia(); T.closeAll(); T.cut4(); T.group(0); },
          view() {
            const b = sim().blocks;
            if (b.LBB) {
              if (!shown) { shown = true; T.group(3); }
              return { target: { rect: ecg() }, text: TEXT.lbbb,
                buttons: [{ label: 'Next', primary: true, fn: () => run.next() }] };
            }
            const other = Object.keys(b)[0], s = spot();
            return { target: s && { x: s.x, y: s.y, r: 22 },
              text: other ? TEXT.otherBlock(T.siteName(other).toLowerCase()) : TEXT.tapLbb,
              next: () => T.block('LBB') };
          } };
      })(),
      (() => {
        let opened = false;
        return { n: n(6), enter() { opened = false; T.closeAll(); },
          view() {
            if (T.fsEcg) { opened = true; return { where: 'top', text: TEXT.fullEcgOpen, next: () => T.setFsEcg(false) }; }
            if (opened) { run.next(); return {}; }
            return { target: { rect: ecg() }, text: TEXT.fullEcg, next: () => T.setFsEcg(true) };
          } };
      })(),
    ];
    if (INAPP) steps.push({ n: n(7),
      enter() { rect = null; T.closeAll(); window.ECGInApp.post('tour', { step: 'ring', module: 'training' }); },
      view: () => ({ target: rect && { rect, pad: 3, bare: true }, where: 'center', text: TEXT.trainingTab,
        next: () => window.ECGInApp.go('training') }) });
    else steps.push({ view: () => ({ modal: true, title: TEXT.endTitle, text: TEXT.endSim, noSkip: true, buttons: [{ label: 'Done', primary: true, fn: () => run.next() }] }) });
    return steps;
  }
  function startSim() {
    const app = window.ECGStudioApp; if (!app || run) return;
    const T = app.tour;
    markSeen();
    T.saveView(); T.closeAll(); T.reset();
    if (INAPP) window.ECGInApp.post('tour', { step: 'prep' });
    const r = runner(simTour(), (completed) => {
      // back to the Reset state (the hand-off to Training also ends here: the simulator is hidden by then)
      T.closeAll(); T.reset(); T.restoreView();
      if (INAPP && !completed) window.ECGInApp.post('tour', { step: 'end' });
    });
    r.go(0);
  }
  // in the app: the hand-off. Training showing (the ringed tab tapped) ends the simulator's part.
  if (INAPP) window.ECGInApp.listen('hide', () => { if (run && window.ECGStudioApp && run.steps.length === run.i + 1) { run.stop(); const T = window.ECGStudioApp.tour; T.closeAll(); T.reset(); T.restoreView(); } });

  // ------------------------------------------------------------------ Training (step 7: answer one ECG)
  function trainTour() {
    const TR = window.ECGTraining, st = TR.st, kind = (p) => TR.BY_ID[p.id].kind;
    const vis = (el) => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const R = (el, pad) => ({ rect: el.getBoundingClientRect(), pad });
    let answered = false;
    const n = (k) => `${k} / ${TOTAL}`;
    return [
      { view() {
        if (st.mode !== 'tutorial') { run.skip(); return {}; }   // (left for Training home or another mode)
        const ph = st.phase;
        if (ph === 'result') { answered = true; run.next(); return {}; }
        if (!st.item) return { n: n(8), text: TEXT.preparing };
        if (ph === 'region') {
          const b = document.querySelector('#regionGrid button[data-r="anterior"]');
          // (the card at the bottom, below the list, and no dim: the ECG stays clear to swipe and tap)
          const lone = (el) => vis(el) && Object.assign(R(el, 3), { noDim: true });
          if (!st.region.regions.includes('anterior')) return { target: lone(b), n: n(10), where: 'bottom', compact: true, text: TEXT.anterior, next: () => TR.toggleRegion('anterior') };
          return { target: lone($('regionDone')), n: n(10), where: 'bottom', compact: true, text: TEXT.regionDone, next: () => TR.endRegion(true) };
        }
        const rhythm = st.picked.find((p) => kind(p) === 'rhythm'), finding = st.picked.find((p) => kind(p) === 'finding');
        const kbd = $('kbd');
        if (!rhythm) {
          const b = document.querySelector('#suggest button[data-id="sinus"]');
          if (vis(b)) return { target: R(b, 3), n: n(8), text: TEXT.tapSinus, next: () => TR.pick('sinus') };
          return { target: vis(kbd) && R(kbd, 2), n: n(8), text: TEXT.typeSinus, next: () => TR.pick('sinus') };
        }
        if (!finding) {
          const b = document.querySelector('#suggest button[data-id="ste"]');
          if (vis(b)) return { target: R(b, 3), n: n(9), text: TEXT.tapSte, next: () => TR.pick('ste') };
          return { target: vis(kbd) && R(kbd, 2), n: n(9), text: TEXT.typeSte, next: () => TR.pick('ste') };
        }
        return { target: vis($('submit')) && R($('submit'), 3), n: n(11), text: TEXT.submit, next: () => TR.submit() };
      } },
      { view() {
        if (st.mode !== 'tutorial' || st.phase !== 'result') { run.skip(); return {}; }
        const res = $('result');
        return { target: vis(res) && R(res, 4), where: 'top', n: n(12), text: TEXT.result,
          buttons: [{ label: 'Next', primary: true, fn: () => run.next() }] };
      } },
      { view: () => ({ modal: true, title: TEXT.endTitle, text: TEXT.end, noSkip: true, buttons: [{ label: 'Done', primary: true, fn: () => run.next() }] }) },
    ].map((s) => Object.assign(s, { answered: () => answered }));
  }
  function startTraining() {
    const TR = window.ECGTraining; if (!TR) return;
    if (run) run.stop();
    for (const el of document.querySelectorAll('#menu, #help, .page:not(#home)')) el.hidden = true;
    TR.setFs(false); TR.startMode('tutorial');
    runner(trainTour(), () => {
      if (TR.st.mode === 'tutorial') TR.goHome();
      if (INAPP) window.ECGInApp.post('tour', { step: 'end' });
    }).go(0);
  }

  // ------------------------------------------------------------------ start
  // first open: the simulator in the app, on a phone held upright, not opened on a scenario link
  const upright = () => document.body.classList.contains('m') && !document.body.classList.contains('ml');
  let visible = true;
  if (INAPP) { window.ECGInApp.listen('hide', () => { visible = false; }); window.ECGInApp.listen('show', () => { visible = true; }); }
  const pending = () => INAPP && !seen() && !location.hash.slice(1) && !!$('pane3d');
  window.ECGTour = { pending, start: startSim, startTraining, get running() { return !!run; } };
  if (pending()) {
    const t0 = Date.now(), wait = setInterval(() => {
      if (Date.now() - t0 > 120000) { clearInterval(wait); return; }
      if (!window.ECGStudioApp || !visible || !upright()) return;
      clearInterval(wait); setTimeout(startSim, 600);
    }, 300);
  }
})();
