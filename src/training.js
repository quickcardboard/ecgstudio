// ECG Studio Training (prototype). ECGs are generated live in a background worker (src/training_gen.js:
// a random scenario near the user's level, simulated, read blind and kept only when the reading matches);
// the user names the rhythm and the findings with an in-app keyboard and type-ahead, locates findings
// by tapping lead groups, and gets a one-screen result. Glicko-2 ratings per skill and the history are
// kept on the phone (localStorage).
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const INAPP = !!(window.ECGInApp && window.ECGInApp.active);   // (a module inside the app shell: src/inapp.js)
  const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

  // ------------------------------------------------------------------ vocabulary
  const VOCAB = [], BY_ID = {};
  {
    let kind = null;
    for (const raw of VOCAB_TXT.split('\n')) {
      const line = raw.trim();
      if (/^##\s*rhythms/i.test(line)) { kind = 'rhythm'; continue; }
      if (/^##\s*findings/i.test(line)) { kind = 'finding'; continue; }
      if (!line || line.startsWith('#') || !kind) continue;
      const [id, name, syn = '', flags = ''] = line.split('|').map((s) => s.trim());
      if (!id || !name) continue;
      const t = { id, name, kind, rank: VOCAB.length, syn: syn.split(',').map((s) => s.trim()).filter(Boolean), region: /\bregion\b/.test(flags) };
      VOCAB.push(t); BY_ID[id] = t;
    }
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // How well a term matches the typed text (lower tier = better), or null. A match starts at the start of a word
  // and may run across spaces ("tw" finds "T wave", "3avb" finds "3 AVB"):
  //   0 the typed text is the whole name or a whole synonym ("af", "chb")
  //   1 the name, or a one-word abbreviation of it, starts with it ("st" → ST elevation, "lb" → LBBB, "pa" → PAC)
  //   2 a whole word of the name is it ("st" → Non-specific ST-T)
  //   3 a later word of the name starts with it ("tw" → Hyperacute T waves)
  //   4 only a synonym matches
  // Suggestions are ordered by tier, then by how common the term is (file order). via: the synonym shown.
  function matchTerm(t, q) {
    const qs = q.replace(/ /g, ''), from = (n) => { const w = n.split(' '); return w.map((_, i) => w.slice(i).join('')); };
    const name = norm(t.name), nw = name.split(' ');
    let tier = null, via = '';
    if (name.replace(/ /g, '') === qs) tier = 0;
    else if (name.replace(/ /g, '').startsWith(qs)) tier = 1;
    else if (nw.includes(qs)) tier = 2;
    else if (from(name).some((x) => x.startsWith(qs))) tier = 3;
    for (const sy of t.syn) {
      const n = norm(sy), ns = n.replace(/ /g, '');
      if (ns === qs) return { tier: 0, via: sy, exact: true };
      if ((tier === null || tier > 1) && !n.includes(' ') && ns.startsWith(qs)) { tier = 1; via = sy; }
      if (tier === null && from(n).some((x) => x.startsWith(qs))) { tier = 4; via = sy; }
    }
    return tier === null ? null : { tier, via, exact: tier === 0 };
  }

  // ------------------------------------------------------------------ live ECGs (background worker)
  const decode = (it) => ({ ...it, data: it.leads.map((b) => { const bin = atob(b), a = new Int16Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16; return a; }) });
  const QUEUE_N = 2;
  // (two workers where the phone has the cores: the next ECGs are made side by side, and a slow or rejected one
  // does not hold up the other; each builds its own heart)
  const N_WORKERS = (navigator.hardwareConcurrency || 2) >= 4 ? 2 : 1;
  const gen = { workers: [], ready: false, queue: [], pending: 0, waiting: false, req: 0, failed: 0, dups: 0, cb: {}, tag: {}, by: {}, onReady: [] };
  // an ECG's combination: rhythm (the sinus family as one) and its abnormalities, from a recipe or a history entry's keys
  const SIN_FAM = ['sinus', 'sinusBrady', 'sinusTachy'];
  const sigOfKeys = (ks) => [SIN_FAM.includes(ks[0]) ? 'sinus' : ks[0], ...ks.slice(1).slice().sort()].join('+');
  const sigOf = (rec) => (rec ? sigOfKeys([rec.rhythm, ...rec.abn.map((a) => a.k)]) : '');
  const recentSigs = () => [st.item && sigOf(st.item.recipe), ...gen.queue.map((q) => sigOf(q.recipe)), ...st.hist.slice(-2).map((h) => sigOfKeys(h.keys || []))].filter(Boolean);
  // the ready worker with the least work (null: none ready yet); idle: only one with nothing to do
  const pickWorker = (idle) => { const r = gen.workers.filter((w) => w.ready && (!idle || !w.busy)).sort((a, b) => a.busy - b.busy); return r[0] || null; };
  function post(w, msg) { w.busy++; gen.by[msg.req] = w; w.w.postMessage(msg); }
  // one-off ECG (daily ECG, a review): msg = { type: 'make', … } or { type: 'build', recipe }; cb(item or null)
  function request(msg, cb) {
    if (!gen.ready) { gen.onReady.push(() => request(msg, cb)); return; }
    const req = ++gen.req; gen.cb[req] = cb; post(pickWorker(false), { ...msg, req });
  }
  function startWorker() {
    const src = document.getElementById('worker-src').textContent;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const add = (w) => { const o = { w, ready: false, busy: 0 }; gen.workers.push(o); w.onmessage = (e) => onWorker(e, o); return o; };
    let real = 0;
    for (let i = 0; i < N_WORKERS; i++) {
      let o; try { o = add(new Worker(url)); real++; } catch (e) { break; }
      o.w.onerror = (e) => {   // (a worker that cannot start: fall back to the same code on the page)
        console.warn('training worker', e.message);
        if (!o.ready) { gen.workers.splice(gen.workers.indexOf(o), 1); if (!gen.workers.length) initWorker(add(inlineWorker(src))); }
      };
      initWorker(o);
    }
    if (!real) initWorker(add(inlineWorker(src)));
  }
  function initWorker(o) { o.w.postMessage({ type: 'init', anatomy: $('anatomy-data').textContent, torso: $('torso-data').textContent }); }
  // (no Worker, as on some file:// pages: the same code on the page, between frames)
  function inlineWorker(src) {
    const w = { onmessage: null }, self = { postMessage: (d) => setTimeout(() => w.onmessage && w.onmessage({ data: d }), 0) };
    const scope = new Function('self', 'postMessage', `${src}\nreturn self;`)(self, self.postMessage);
    w.postMessage = (d) => setTimeout(() => scope.onmessage({ data: d }), 30);
    return w;
  }
  function onWorker(e, o) {
    const d = e.data;
    if (d.type === 'ready') { o.ready = true; gen.ready = true; gen.onReady.splice(0).forEach((f) => f()); fill(); return; }
    if (d.type === 'log') { console.debug('training gate:', d.msg); return; }
    if (d.type !== 'item') return;
    if (gen.by[d.req]) { gen.by[d.req].busy--; delete gen.by[d.req]; }
    if (gen.cb[d.req]) { const cb = gen.cb[d.req]; delete gen.cb[d.req]; if (d.err) console.warn('training generator', d.err); cb(d.item ? checkVocab(d.item) && decode(d.item) : null); fill(); return; }
    gen.pending--;
    const tag = gen.tag[d.req]; delete gen.tag[d.req];
    if (tag !== practiceTag()) { fill(); return; }   // (asked for another practice mode)
    if (d.err) console.warn('training generator', d.err);
    if (d.item && !checkVocab(d.item)) d.item = null;
    // (two ECGs are made at once from the same history, so both can draw the same combination: one that repeats the
    // ECG on screen, one in the queue or one of the last two answered is dropped and made again, up to 3 times running)
    if (d.item && gen.dups < 3 && recentSigs().includes(sigOf(d.item.recipe))) { gen.dups++; console.debug(`training: dropped a repeat (${d.item.title})`); fill(); return; }
    if (d.item) { gen.failed = 0; gen.dups = 0; gen.queue.push({ ...decode(d.item), tag }); console.debug(`training: ${d.item.title} (${Math.round(d.ms)} ms)`); }
    else gen.failed++;
    if (gen.waiting && gen.queue.length) { gen.waiting = false; nextItem(); }
    fill();
  }
  // the answer key must use the vocabulary (an unknown optional term is dropped; an unknown answer rejects)
  function checkVocab(item) {
    const k = item.key, unknown = [k.rhythm, ...k.findings.map((f) => f.id), ...k.optional, ...(k.alt || [])].filter((id) => !BY_ID[id]);
    if (!unknown.length) return true;
    console.warn('training: not in the vocabulary:', unknown.join(', '));
    k.optional = k.optional.filter((id) => BY_ID[id]); k.alt = (k.alt || []).filter((id) => BY_ID[id]);
    return !!BY_ID[k.rhythm] && k.findings.every((f) => BY_ID[f.id]);
  }
  // (on the home screen the queue already prepares Train ECGs, so Train starts at once)
  const practiceTag = () => (st.mode === 'skill' ? st.focus : st.mode === 'train' || st.mode === null ? '' : null);
  // keep two ECGs ready, chosen for this user's level: about 70–75% expected success (Glicko-2), half the
  // time on the weakest skill
  // weights for the next ECGs from this user's history: what was in the last 8 ECGs is much rarer (×0.15), in the
  // last 20 a little (×0.6), so the same rhythm does not come back soon; what was missed or partly right in the last 40 is more likely (up to 2.5×); what was right 3+
  // times and never missed is a little rarer (0.6×). (Sinus rhythm, the background of most ECGs, is not damped.)
  const GEN_ID = { sinus: 'sinus', sinusBrady: 'sinusBrady', sinusTachy: 'sinusTachy', stemi: 'ste', oldmi: 'qwaves', recent: 'qwaves', hyper: 'hyperacute', narrow: 'std', peri: 'pericarditis' };
  function adjustments() {
    const adj = {}, mul = (k, f) => { adj[k] = (adj[k] === undefined ? 1 : adj[k]) * f; };
    const SIN = ['sinus', 'sinusBrady', 'sinusTachy'];
    // (the ECG on screen and those queued count as just seen)
    const inFlight = [st.item, ...gen.queue].filter((x) => x && x.recipe).map((x) => ({ keys: [x.recipe.rhythm, ...x.recipe.abn.map((a) => a.k)] }));
    const recent = [...st.hist.slice(-20), ...inFlight].slice(-20);
    recent.forEach((h, i) => {
      const near = recent.length - i <= 8, ks = h.keys || [];
      for (const k of ks) if (!SIN.includes(k)) mul(k, near ? 0.15 : 0.6);
      if (ks.length === 1 && SIN.includes(ks[0])) mul('normal', near ? 0.3 : 0.8);   // (a normal ECG)
    });
    const seen = {}, missed = {};
    for (const h of st.hist.slice(-40)) for (const k of h.keys || []) {
      seen[k] = (seen[k] || 0) + 1;
      const id = GEN_ID[k] || k;
      if ((h.miss || []).includes(id) || (k === h.keys[0] && h.rhythm !== 'ok')) missed[k] = (missed[k] || 0) + 1;
    }
    for (const k of Object.keys(seen)) {
      if (missed[k]) mul(k, Math.min(2.5, 1 + 0.75 * missed[k]));
      else if (seen[k] >= 3 && !['sinus', 'sinusBrady', 'sinusTachy'].includes(k)) mul(k, 0.6);
    }
    for (const k of Object.keys(adj)) adj[k] = Math.max(0.08, adj[k]);
    return adj;
  }
  function fill() {
    if (!gen.ready || gen.failed > 4) { if (gen.failed > 4) setLoading('Could not prepare an ECG. Reload the page to try again.'); return; }
    const tag = practiceTag(); if (tag === null || !ownsTraining()) return;   // (locked: no Train ECGs are made)
    gen.queue = gen.queue.filter((x) => x.tag === tag);
    let w;
    while (gen.queue.length + gen.pending < QUEUE_N && (w = pickWorker(true))) {
      const weakest = SKILLS.slice().sort((a, b) => st.skills[a].r - st.skills[b].r)[0];
      const focus = tag || (Math.random() < 0.5 ? weakest : null), r = tag ? st.skills[tag].r : overall();
      const target = r - 168 + (Math.random() - 0.5) * 160;
      gen.pending++; const req = ++gen.req; gen.tag[req] = tag;
      post(w, { type: 'make', req, target, focus, seed: (Math.random() * 2 ** 31) | 0, adjust: adjustments() });
    }
  }
  function setLoading(msg) {
    const el = $('loading'); el.hidden = !msg; if (msg) $('loadingMsg').textContent = msg;
  }

  // ------------------------------------------------------------------ ratings (Glicko-2, one per skill)
  const SKILLS = ['rhythm', 'conduction', 'ischemia', 'conditions'];
  const SKILL_NAME = { rhythm: 'Rhythm', conduction: 'Conduction', ischemia: 'Ischemia', conditions: 'Conditions' };
  function glicko(p, opp, s) {
    const q = 173.7178, mu = (p.r - 1500) / q, phi = p.rd / q, muj = (opp.r - 1500) / q, phij = opp.rd / q, tau = 0.5;
    const g = 1 / Math.sqrt(1 + 3 * phij * phij / (Math.PI * Math.PI)), E = 1 / (1 + Math.exp(-g * (mu - muj)));
    const v = 1 / (g * g * E * (1 - E)), delta = v * g * (s - E), a = Math.log(p.v * p.v);
    const f = (x) => (Math.exp(x) * (delta * delta - phi * phi - v - Math.exp(x))) / (2 * (phi * phi + v + Math.exp(x)) ** 2) - (x - a) / (tau * tau);
    let A = a, B;
    if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v); else { let k = 1; while (f(a - k * tau) < 0 && k < 50) k++; B = a - k * tau; }
    let fA = f(A), fB = f(B);
    for (let i = 0; i < 60 && Math.abs(B - A) > 1e-6; i++) { const C = A + (A - B) * fA / (fB - fA), fC = f(C); if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2; B = C; fB = fC; }
    const vol = Math.exp(A / 2), phiStar = Math.sqrt(phi * phi + vol * vol), phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    return { r: (mu + phiNew * phiNew * g * (s - E)) * q + 1500, rd: Math.max(60, phiNew * q), v: vol };
  }
  const overall = () => SKILLS.reduce((a, k) => a + st.skills[k].r, 0) / SKILLS.length;

  // ------------------------------------------------------------------ ECG drawing
  const REGIONS = [
    { id: 'septal', name: 'Septal', leads: ['V1', 'V2'], colour: '#1aa6c8' },
    { id: 'anterior', name: 'Anterior', leads: ['V3', 'V4'], colour: '#d99a00' },
    { id: 'lateral', name: 'Lateral', leads: ['I', 'aVL', 'V5', 'V6'], colour: '#1f9d55' },
    { id: 'inferior', name: 'Inferior', leads: ['II', 'III', 'aVF'], colour: '#2f63f0' },
    { id: 'aVR', name: 'aVR', leads: ['aVR'], colour: '#7a6a8a' },
  ];
  const regionOf = (lead) => REGIONS.find((r) => r.leads.includes(lead));
  const PAGES = [
    { name: 'Limb leads', cols: [['I', 'II', 'III'], ['aVR', 'aVL', 'aVF']], t0: 0 },
    { name: 'Chest leads', cols: [['V1', 'V2', 'V3'], ['V4', 'V5', 'V6']], t0: 5000 },
  ];
  const FULL = { cols: [['I', 'II', 'III'], ['aVR', 'aVL', 'aVF'], ['V1', 'V2', 'V3'], ['V4', 'V5', 'V6']], t0: 0 };
  const COL_MS = 2500;

  function paperGrid(w, h, mm) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const lines = (step, colour, width) => {
      g.beginPath(); g.strokeStyle = colour; g.lineWidth = width;
      for (let x = 0; x <= w; x += step) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); }
      for (let y = 0; y <= h; y += step) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(w, Math.round(y) + 0.5); }
      g.stroke();
    };
    if (mm >= 2.4) lines(mm, '#f7d3da', 1);
    lines(5 * mm, '#ec8fa3', Math.max(1, mm / 3));
    return cv;
  }
  // cells of a layout (canvas pixels): three rows of lead cells and the lead II rhythm strip
  function cellsOf(layout, w, h) {
    const span = layout.cols.length * COL_MS, pxMs = w / span, rowH = h / 4, cells = [];
    layout.cols.forEach((col, c) => col.forEach((lead, r) => cells.push({ lead, x0: c * COL_MS * pxMs, x1: (c + 1) * COL_MS * pxMs, y0: r * rowH, y1: (r + 1) * rowH, t0: layout.t0 + c * COL_MS, t1: layout.t0 + (c + 1) * COL_MS })));
    cells.push({ lead: 'II', rhythm: true, x0: 0, x1: w, y0: 3 * rowH, y1: h, t0: layout.t0, t1: layout.t0 + span });
    return { cells, pxMs, rowH, span };
  }
  // opts: { regions: Set of selectable region ids or null, picked: Set, highlight: [leads], caliper }
  function drawEcg(cv, item, layout, opts = {}) {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H || !item) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1), w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const { cells, pxMs, rowH } = cellsOf(layout, w, h), mm = pxMs * 40, gain = 10 * mm;   // 25 mm/s, 10 mm/mV
    const key = `${w}x${h}:${mm.toFixed(3)}`;
    if (cv.gridKey !== key) { cv.grid = paperGrid(w, h, mm); cv.gridKey = key; }
    const g = cv.getContext('2d');
    g.drawImage(cv.grid, 0, 0);
    // region mode: tint the selectable lead groups
    if (opts.regions) for (const c of cells) {
      if (c.rhythm) continue;
      const r = regionOf(c.lead); if (!r) continue;
      g.fillStyle = r.colour + (opts.picked && opts.picked.has(r.id) ? '38' : '12'); g.fillRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0);
    }
    // traces
    g.strokeStyle = '#111'; g.lineWidth = Math.max(1.2 * dpr / 1.5, 0.28 * mm); g.lineJoin = 'round';
    for (const c of cells) {
      const d = item.data[LEADS.indexOf(c.lead)], hz = item.hz, y0 = c.y0 + rowH * 0.58;
      g.beginPath();
      const i0 = Math.max(0, Math.floor(c.t0 * hz / 1000)), i1 = Math.min(d.length - 1, Math.ceil(c.t1 * hz / 1000));
      for (let i = i0; i <= i1; i++) {
        const x = c.x0 + (i * 1000 / hz - c.t0) * pxMs, y = y0 - d[i] / 1000 * gain;
        if (i === i0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // column change: a short tick
      if (!c.rhythm && c.x0 > 0) { g.save(); g.lineWidth = Math.max(1, 0.3 * mm); g.beginPath(); g.moveTo(c.x0, y0 - 4 * mm); g.lineTo(c.x0, y0 + 4 * mm); g.stroke(); g.restore(); }
    }
    // labels
    g.font = `600 ${Math.round(11.5 * dpr)}px "IBM Plex Sans", system-ui, sans-serif`; g.textBaseline = 'top';
    for (const c of cells) {
      const label = c.rhythm ? 'II' : c.lead, x = c.x0 + 4 * dpr, y = c.y0 + 4 * dpr, tw = g.measureText(label).width;
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x - 2 * dpr, y - 2 * dpr, tw + 6 * dpr, 16 * dpr);
      g.fillStyle = '#111'; g.fillText(label, x + 1 * dpr, y);
    }
    // region outlines and names
    if (opts.regions) for (const c of cells) {
      if (c.rhythm) continue;
      const r = regionOf(c.lead); if (!r) continue;
      const on = opts.picked && opts.picked.has(r.id);
      g.save(); g.strokeStyle = r.colour; g.lineWidth = (on ? 3 : 1.5) * dpr; if (!on) g.setLineDash([5 * dpr, 4 * dpr]);
      const m = 2 * dpr; g.strokeRect(c.x0 + m, c.y0 + m, c.x1 - c.x0 - 2 * m, c.y1 - c.y0 - 2 * m); g.restore();
      g.font = `600 ${Math.round(10.5 * dpr)}px "IBM Plex Sans", system-ui, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
      const t = (on ? '✓ ' : '') + r.name, tw = g.measureText(t).width, x = c.x1 - 6 * dpr, y = c.y1 - 5 * dpr;
      g.fillStyle = on ? r.colour : 'rgba(255,255,255,0.9)'; g.fillRect(x - tw - 5 * dpr, y - 14 * dpr, tw + 10 * dpr, 16 * dpr);
      g.fillStyle = on ? '#fff' : r.colour; g.fillText(t, x, y); g.textAlign = 'left'; g.textBaseline = 'top';
    }
    // result: the leads that carry the finding, and the caliper on the interval that decides it
    if (opts.highlight) for (const c of cells) {
      if (c.rhythm || !opts.highlight.includes(c.lead)) continue;
      g.save(); g.strokeStyle = '#c2304f'; g.lineWidth = 2.5 * dpr; const m = 2 * dpr;
      g.fillStyle = 'rgba(194,48,79,0.07)'; g.fillRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0);
      g.strokeRect(c.x0 + m, c.y0 + m, c.x1 - c.x0 - 2 * m, c.y1 - c.y0 - 2 * m); g.restore();
    }
    const cal = opts.caliper;
    if (cal) {
      const c = cells.find((x) => (cal.lead === 'rhythm' ? x.rhythm : x.lead === cal.lead && !x.rhythm) && cal.t0 >= x.t0 && cal.t1 <= x.t1);
      if (c) {
        const xa = c.x0 + (cal.t0 - c.t0) * pxMs, xb = c.x0 + (cal.t1 - c.t0) * pxMs, ya = c.y0 + rowH * 0.12, yb = c.y1 - rowH * 0.06, ym = Math.max(c.y0 + rowH * 0.2, c.y0 + 20 * dpr);
        g.save(); g.strokeStyle = '#2f63f0'; g.lineWidth = 1.8 * dpr;
        g.beginPath(); g.moveTo(xa, ya); g.lineTo(xa, yb); g.moveTo(xb, ya); g.lineTo(xb, yb); g.moveTo(xa, ym); g.lineTo(xb, ym); g.stroke();
        g.font = `600 ${Math.round(11 * dpr)}px "IBM Plex Mono", ui-monospace, monospace`; g.textBaseline = 'bottom';
        const tw = g.measureText(cal.label).width, tx = Math.min(c.x1 - tw - 6 * dpr, Math.max(c.x0 + 4 * dpr, (xa + xb) / 2 - tw / 2));
        g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(tx - 3 * dpr, ym - 16 * dpr, tw + 6 * dpr, 15 * dpr);
        g.fillStyle = '#2f63f0'; g.fillText(cal.label, tx, ym - 2 * dpr); g.restore();
      }
    }
  }

  // ------------------------------------------------------------------ state
  const fresh = () => ({ r: 1500, rd: 350, v: 0.06 });
  const st = {
    item: null, page: 0, picked: [], typed: '', phase: 'answer',   // answer | region | result
    region: null, t0: 0, fs: false, hist: [], skills: Object.fromEntries(SKILLS.map((k) => [k, fresh()])),
    mode: null, focus: null,      // mode: train | skill (focus) | daily | review
    reviews: [], days: {}, reviewRun: [],
  };
  // progress on the phone: ratings, the last 300 answers, the review queue, days practised
  // (export/import comes later)
  const STORE = 'ecgTraining.v1';
  function saveProgress() { try { localStorage.setItem(STORE, JSON.stringify({ skills: st.skills, hist: st.hist.slice(-300), reviews: st.reviews, days: st.days })); } catch (e) { /* storage blocked */ } }
  try { const j = JSON.parse(localStorage.getItem(STORE) || 'null'); if (j) { st.hist = j.hist || []; for (const k of SKILLS) if (j.skills && j.skills[k]) st.skills[k] = j.skills[k]; st.reviews = j.reviews || []; st.days = j.days || {}; } } catch (e) { /* none */ }

  // ------------------------------------------------------------------ days, streak, levels, reviews
  const DAY = 864e5, dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = () => st.days[dayKey()] || (st.days[dayKey()] = { n: 0 });
  // a day counts for the streak with one ECG answered (the daily ECG or any other); today not yet done does
  // not break it
  function streak() {
    const done = (k) => st.days[k] && (st.days[k].daily !== undefined || st.days[k].n >= 1);
    let n = 0, t = Date.now(); if (!done(dayKey(t))) t -= DAY;
    while (done(dayKey(t))) { n++; t -= DAY; }
    return n;
  }
  // titles from the overall rating (like chess titles): a new user (1500) is a medical student; a title is
  // lost when the rating falls below its band. Bands are first guesses, to be tuned with real answers.
  const TITLES = [[-Infinity, 'Clerk'], [1300, 'Nursing student'], [1450, 'Medical student'], [1550, 'Intern'], [1650, 'Resident'], [1750, 'Cardiology fellow'], [1850, 'Cardiologist'], [1975, 'Electrophysiologist'], [2100, 'Professor of cardiology']];
  function title(r = overall()) { let i = 0; while (i + 1 < TITLES.length && r >= TITLES[i + 1][0]) i++; return { name: TITLES[i][1], next: TITLES[i + 1] ? TITLES[i + 1][1] : null, toNext: TITLES[i + 1] ? Math.ceil(TITLES[i + 1][0] - r) : 0 }; }
  // spaced repetition: a missed or partly right ECG returns after 1, 3, 7, 16 and 35 days (rebuilt from its recipe)
  const BOXES = [1, 3, 7, 16, 35];
  const dueReviews = () => st.reviews.filter((r) => r.due <= Date.now());
  function scheduleReview(item, score) {
    const i = st.reviews.findIndex((r) => r.id === item.id);
    if (st.mode === 'review' && i >= 0) {
      const r = st.reviews[i];
      if (score >= 0.8) { r.box++; if (r.box >= BOXES.length) st.reviews.splice(i, 1); else r.due = Date.now() + BOXES[r.box] * DAY; }
      else { r.box = 0; r.due = Date.now() + DAY; }
      return;
    }
    if (score < 0.8 && i < 0) st.reviews.push({ id: item.id, recipe: item.recipe, title: itemTitle(item.key), box: 0, due: Date.now() + DAY });
  }
  // ------------------------------------------------------------------ premium (docs/PREMIUM_PLAN.md)
  // The simulator and the daily ECG are free; Train, practice by skill and Reviews are unlocked by one purchase. While
  // the switch is off (the default until billing is ready) everything stays as before: nothing locked, the daily ECG not
  // rated. A preview turns it on for this device: ?premium=1 in the address (?premium=0 turns it off).
  const PREMIUM_KEY = 'ecgstudio.premiumPreview', OWNED_KEY = 'ecgstudio.owned.training';
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* no storage */ } } };
  // (opening the preview link again also locks this device again, to try the purchase flow once more)
  { const q = /[?&]premium=([01])/.exec(location.search); if (q) { store.set(PREMIUM_KEY, q[1] === '1' ? '1' : null); store.set(OWNED_KEY, null); } }
  // premium for everyone: site.json "premium" (the build's meta tag); a preview: this device only
  const premiumLive = ((document.querySelector('meta[name="premium"]') || {}).content || '') === '1';
  const premiumOn = () => premiumLive || store.get(PREMIUM_KEY) === '1';
  // what is owned: in the app, from Google Play through the shell ('ents'); elsewhere (previews) the stand-in purchase
  const shop = { app: false, dev: false, ents: {}, prices: {} };
  const ownsTraining = () => !premiumOn() || (shop.app ? shop.dev || !!shop.ents.training : store.get(OWNED_KEY) === '1');
  const PRICE = '$9.99', price = () => shop.prices.training || PRICE;   // (Play's price, in the local currency, once known)
  const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.ecgstudio.app';
  const webStore = () => !shop.app && premiumLive && !INAPP && store.get(PREMIUM_KEY) !== '1';   // (the website: Training is bought in the app)
  // the daily ECG is rated with the switch on: the first answer of the day counts, a second look does not
  const dailyRated = () => premiumOn() && !(st.days[dayKey()] && st.days[dayKey()].daily !== undefined);
  const PROVISIONAL_N = 20;   // (ratings settle after about 20 rated ECGs)
  const ratedCount = () => st.hist.filter((h) => h.rated || (h.mode !== 'daily' && h.mode !== 'tutorial')).length;
  // the daily ECG: the same for everyone on a date (seeded by the date, a mid-level target); rated with premium on
  const dailySeed = () => +dayKey().replace(/-/g, '');
  const rhythmPick = () => st.picked.find((p) => BY_ID[p.id].kind === 'rhythm');

  // start a mode from the home screen
  function startMode(mode, focus = null) {
    if (['train', 'skill', 'review'].includes(mode) && !ownsTraining()) { showPaywall(); return; }
    st.rateDaily = mode === 'daily' && dailyRated();
    st.mode = mode; st.focus = focus; st.reviewRun = mode === 'review' ? dueReviews().map((r) => r.id) : [];
    $('home').hidden = true; nextItem(); fill();
  }
  // the interactive tutorial (src/tutorial.js) answers one fixed ECG, not rated: sinus rhythm with an anterior STEMI
  // (mid LAD, as in the simulator's step), prepared in the background while the simulator's steps run
  const TOUR_RECIPE = { rhythm: 'sinus', rate: 75, seed: 7, abn: [{ k: 'stemi', site: 'mLAD' }] };
  const tour = { item: null, asked: false, wait: null };
  function prepTour(cb) {
    if (tour.item) { if (cb) cb(tour.item); return; }
    if (cb) tour.wait = cb;
    if (tour.asked) return;
    tour.asked = true;
    request({ type: 'build', recipe: TOUR_RECIPE }, (item) => { tour.asked = false; tour.item = item; const w = tour.wait; tour.wait = null; if (w) w(item); });
  }
  function goHome() { st.mode = null; st.item = null; gen.waiting = false; setLoading(null); renderHome(); $('home').hidden = false; fill(); }
  function showItem(item) {
    if (!item) { toast('Could not prepare that ECG'); goHome(); return; }
    setLoading(null); st.item = item; st.t0 = performance.now(); setPage(0, false); render();
  }
  function nextItem() {
    st.picked = []; st.typed = ''; st.phase = 'answer'; st.region = null; st.score = null; st.item = null;
    const loading = () => { setLoading(gen.ready ? 'Recording the ECG…' : 'Building the heart…'); render(); };
    if (st.mode === 'tutorial') { loading(); prepTour((item) => { if (st.mode === 'tutorial' && !st.item) showItem(item); }); return; }
    if (st.mode === 'daily') { loading(); request({ type: 'make', target: 1500, focus: null, seed: dailySeed() }, showItem); return; }
    if (st.mode === 'review') {
      const id = st.reviewRun.shift(), r = st.reviews.find((x) => x.id === id);
      if (!r) { toast('Reviews done for today'); goHome(); return; }
      loading(); request({ type: 'build', recipe: r.recipe }, showItem); return;
    }
    if (!gen.queue.length) { gen.waiting = true; setLoading(gen.ready ? 'Recording the ECG…' : 'Building the heart…'); render(); fill(); return; }
    setLoading(null);
    st.item = gen.queue.shift(); fill(); st.t0 = performance.now();
    setPage(0, false); render();
  }

  // ------------------------------------------------------------------ rendering
  function measChips(el) {
    // (rate in /min, intervals in ms)
    if (!st.item) { el.innerHTML = ''; return; }
    const m = st.item.m, v = (x, u = '') => (x === null || x === undefined ? '—' : `${x}${u}`);
    el.innerHTML = [['Rate', v(m.rate)], ['PR', v(m.pr)], ['QRS', v(m.qrs)], ['QTc', v(m.qtc)], ['Axis', v(m.axis, '°')]]
      .map(([k, x]) => `<span class="chip"><em>${k}</em>${x}</span>`).join('');
  }
  const regionText = (ids) => ids.map((r) => REGIONS.find((x) => x.id === r).name.toLowerCase()).join(', ');
  function chipLabel(p) {
    const t = BY_ID[p.id];
    return p.regions ? `${t.name}, ${p.regions.length ? regionText(p.regions) : '?'}` : t.name;
  }
  function renderPicked() {
    const el = $('picked');
    if (!st.picked.length && st.phase === 'answer') { el.innerHTML = '<span class="prompt">Rhythm first, then every abnormality you see.</span>'; }
    else el.innerHTML = st.picked.map((p, i) => `<button type="button" class="achip${BY_ID[p.id].kind === 'rhythm' ? ' rhythm' : ''}${p.pending ? ' pending' : ''}" data-i="${i}">${chipLabel(p)}<span class="x">✕</span></button>`).join('');
    $('fsPicked').innerHTML = st.picked.length ? st.picked.map((p) => `<span class="achip">${chipLabel(p)}</span>`).join('') : '<span class="prompt">Nothing yet</span>';
  }
  function suggestions() {
    const q = norm(st.typed);
    const wantRhythm = !rhythmPick(), kind = wantRhythm ? 'rhythm' : 'finding', taken = new Set(st.picked.map((p) => p.id));
    if (q.replace(/ /g, '').length < 2) return { list: [], q };
    const list = [];
    for (const t of VOCAB) { if (t.kind !== kind || taken.has(t.id)) continue; const m = matchTerm(t, q); if (m) list.push({ t, ...m }); }
    list.sort((a, b) => (a.tier - b.tier) || (a.t.rank - b.t.rank));   // the best match, then the most common
    return { list, q };
  }
  function renderField() {
    const wantRhythm = !rhythmPick();
    $('typed').textContent = st.typed;
    $('ph').textContent = st.typed ? '' : wantRhythm ? 'Type the rhythm' : 'Add a finding';
    const { list, q } = suggestions(), el = $('suggest');
    let html = '';
    // (the suggestions take the chips' place while typing)
    const typing = st.typed.length > 0; el.hidden = !typing; $('picked').hidden = typing;
    if (q.replace(/ /g, '').length < 2) {
      html += `<span class="hint">${q.length ? 'one more letter…' : ''}</span>`;
    } else if (!list.length) html = `<span class="hint">No ${wantRhythm ? 'rhythm' : 'finding'} starts with “${st.typed}”</span>`;
    else html = list.map(({ t, via }) => `<button type="button" data-id="${t.id}">${t.name}${via ? `<small>${via}</small>` : ''}</button>`).join('');
    el.innerHTML = html; el.scrollLeft = 0;
  }
  function renderRegion() {
    const p = st.region, t = BY_ID[p.id];
    $('regionTitle').innerHTML = `<b>${t.name}</b>: tap the lead groups on the ECG (swipe for the chest leads), or pick them here.`;
    $('regionGrid').innerHTML = REGIONS.map((r) => `<button type="button" data-r="${r.id}" aria-pressed="${p.regions.includes(r.id)}" style="border-color:${p.regions.includes(r.id) ? r.colour : 'var(--line)'}">${p.regions.includes(r.id) ? '✓ ' : ''}${r.name}<small>${r.leads.join(' ')}</small></button>`).join('');
    $('regionDone').disabled = !p.regions.length;
  }
  function drawAll() {
    if (!st.item) { for (const id of ['c0', 'c1']) { const c = $(id), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); } return; }
    const it = st.item, res = st.phase === 'result', reg = st.phase === 'region';
    // (a result chip tapped: only that finding's leads; the rhythm: the caliper alone)
    const sel = res && st.selRow, hlSel = sel ? (sel.rhythm ? [] : (it.hlBy || {})[sel.id] || []) : it.highlight;
    const opts = res ? { highlight: hlSel, caliper: !sel || sel.rhythm ? it.caliper : null } : reg ? { regions: true, picked: new Set(st.region.regions) } : {};
    drawEcg($('c0'), it, PAGES[0], opts); drawEcg($('c1'), it, PAGES[1], opts);
    if (st.fs || document.body.classList.contains('land')) drawEcg($('cfull'), it, FULL, res ? opts : {});
  }
  // the bottom area keeps the typing view's height (chips, field, keyboard) in every phase, so the ECG keeps its size
  function sizeBottom() {
    if (st.phase !== 'answer' || $('kbd').hidden) return;
    const b = $('bottom'); b.style.height = '';
    const h = $('answer').offsetHeight + $('kbd').offsetHeight; if (h > 100) b.style.height = `${h}px`;
  }
  function render() {
    measChips($('meas')); measChips($('fsMeas'));
    const ph = st.phase;
    $('answer').hidden = ph === 'result'; $('kbd').hidden = ph !== 'answer'; $('region').hidden = ph !== 'region'; $('result').hidden = ph !== 'result';
    renderPicked();
    if (ph === 'answer') renderField();
    if (ph !== 'answer') { $('suggest').hidden = true; $('picked').hidden = false; }
    if (ph === 'region') { $('suggest').innerHTML = ''; $('fieldRow').hidden = true; renderRegion(); } else $('fieldRow').hidden = false;
    if (ph === 'region') $('answer').hidden = false;
    if (ph === 'result') renderResult();
    requestAnimationFrame(drawAll);
  }


  // ------------------------------------------------------------------ statistics
  // a past ECG from Statistics: rebuilt from its recipe and shown with the answer given then (not rated again)
  function openPast(hi) {
    const h = st.hist[hi]; if (!h || !h.recipe) return;
    $('stats').hidden = true; $('home').hidden = true;
    st.mode = 'view'; st.fromStats = true; st.item = null; st.phase = 'answer'; st.picked = []; st.score = null; setLoading('Recording the ECG…'); render();
    request({ type: 'build', recipe: h.recipe }, (item) => {
      if (st.mode !== 'view') return;
      if (!item) { toast('Could not prepare that ECG'); goHome(); return; }
      setLoading(null); st.item = item;
      st.picked = (h.picked || []).filter((p) => BY_ID[p.id]).map((p) => ({ ...p }));
      st.score = score(item.key, st.picked, (k) => (st.skills[k || 'conditions'] || { r: 1500 }).r); st.selRow = null;
      st.delta = h.delta || 0; st.rated = h.rated !== undefined ? h.rated : h.mode !== 'daily'; st.time = h.time || 0;
      st.phase = 'result'; st.shownAt = performance.now();
      const hl = item.highlight || [], chest = hl.filter((l) => l.startsWith('V')).length;
      setPage(chest > hl.length - chest ? 1 : 0, false); render();
    });
  }
  function renderStats() {
    const h = st.hist, n = h.length, avg = (f) => (n ? h.reduce((a, x) => a + f(x), 0) / n : 0);
    const el = $('statsBody'), tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
    const recent = h.slice(-5).map((x, i) => [x, n - Math.min(5, n) + i]).reverse().map(([x, hi]) => {
      const d = (x.mode === 'daily' && !x.rated) || x.delta === undefined ? null : Math.round(x.delta);
      // (an ECG answered since its recipe and answer are kept: tap to see its result again)
      return `<div${x.recipe ? ` class="open" role="button" tabindex="0" data-h="${hi}"` : ''}><span>${x.title}</span><span class="pc" style="color:${x.score >= 0.8 ? 'var(--ok)' : x.score >= 0.4 ? 'var(--part)' : 'var(--bad)'}">${Math.round(x.score * 100)}%</span><span class="dl ${d === null ? '' : d >= 0 ? 'up' : 'down'}">${d === null ? 'daily' : `${d >= 0 ? '+' : '−'}${Math.abs(d)}`}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="tiles">${tile(Math.round(overall()), 'Rating')}${tile(`<small>${title().name}</small>`, 'Title')}${tile(n, 'ECGs answered')}${tile(n ? `${Math.round(avg((x) => x.score) * 100)}%` : '—', 'Average score')}${tile(n ? `${Math.round(avg((x) => (x.rhythm === 'ok' ? 1 : 0)) * 100)}%` : '—', 'Rhythm correct')}${tile(streak(), 'Day streak')}</div>`
      + `<h3>Skills</h3>${radar()}`
      + (n ? `<h3>Last ${Math.min(5, n)} ECGs</h3><div class="hist">${recent}</div>` : '<p class="empty">No answers yet.</p>')
      + '<p class="empty" style="margin-top:16px">Ratings start at 1500 and settle after about 20 ECGs. Progress is kept on this phone only.</p>';
  }
  // speed: the median time of the last 20 well-answered ECGs (score ≥ 80%), on the rating scale so it can sit
  // on the radar: 15 s or less = 2100 (the edge), 60 s or more = 1100 (the centre), log scale between
  function speed() {
    const t = st.hist.filter((x) => x.score >= 0.8 && x.time).slice(-20).map((x) => x.time).sort((a, b) => a - b);
    if (t.length < 3) return null;
    const med = t[t.length >> 1], f = Math.max(0, Math.min(1, Math.log(60 / med) / Math.log(4)));
    return { r: 1100 + 1000 * f, s: Math.round(med) };
  }
  // skill radar: one axis per skill plus speed, 1100 at the centre to 2100 at the edge (more is clamped);
  // 1500 (the start) dashed
  function radar() {
    const sp = speed(), AX = [...SKILLS.map((k) => ({ name: SKILL_NAME[k], r: st.skills[k].r, txt: Math.round(st.skills[k].r) })), { name: 'Speed', r: sp ? sp.r : 1100, txt: sp ? `${sp.s} s` : '—' }];
    const W = 360, H = 270, cx = W / 2, cy = H / 2, R = 84, lo = 1100, hi = 2100;
    const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / AX.length, pt = (i, v) => { const f = Math.max(0.04, Math.min(1, (v - lo) / (hi - lo))); return [cx + R * f * Math.cos(ang(i)), cy + R * f * Math.sin(ang(i))]; };
    const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    let svg = `<svg class="radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Skills: ${AX.map((a) => `${a.name} ${a.txt}`).join(', ')}">`;
    for (const v of [1350, 1600, 1850, 2100]) svg += `<polygon points="${poly(AX.map(() => v))}" fill="none" stroke="var(--line)"/>`;
    svg += `<polygon points="${poly(AX.map(() => 1500))}" fill="none" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
    AX.forEach((k, i) => { const [x, y] = pt(i, hi); svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`; });
    svg += `<polygon points="${poly(AX.map((a) => a.r))}" fill="rgba(239,91,122,0.25)" stroke="var(--accent)" stroke-width="2"/>`;
    AX.forEach((ax, i) => {
      const [x, y] = pt(i, ax.r); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--accent)"/>`;
      const a = ang(i), lx = cx + (R + 14) * Math.cos(a), ly = cy + (R + 18) * Math.sin(a) + (Math.sin(a) > 0.5 ? 8 : 0), anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      svg += `<text x="${lx.toFixed(1)}" y="${(ly - 2).toFixed(1)}" text-anchor="${anchor}" fill="var(--fg)" font-size="13" font-weight="600">${ax.name}</text><text x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="${anchor}" fill="var(--muted)" font-size="12" font-family="IBM Plex Mono, monospace">${ax.txt}</text>`;
    });
    return svg + '</svg>';
  }


  // ------------------------------------------------------------------ the ECG pages: swipe, double-tap, region taps
  function setPage(p, animate = true) {
    st.page = Math.max(0, Math.min(1, p));
    const tr = $('track'); tr.classList.toggle('slide', animate); tr.style.transform = `translateX(${-50 * st.page}%)`;
    [...$('pager').querySelectorAll('i')].forEach((d, i) => d.classList.toggle('on', i === st.page));
    $('pageName').textContent = PAGES[st.page].name;
  }
  function regionAt(e) {
    const cv = st.page ? $('c1') : $('c0'), r = cv.getBoundingClientRect(), { cells } = cellsOf(PAGES[st.page], r.width, r.height);
    const x = e.clientX - r.left, y = e.clientY - r.top, c = cells.find((k) => !k.rhythm && x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1);
    return c ? regionOf(c.lead) : null;
  }
  function initEcgTouch() {
    const view = $('ecgView'), tr = $('track');
    let down = null, lastTap = null;
    view.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: e.timeStamp, drag: false }; try { view.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } });
    view.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.drag && Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)) down.drag = true;
      if (!down.drag) return;
      const W = view.clientWidth, edge = (st.page === 0 && dx > 0) || (st.page === 1 && dx < 0);
      tr.classList.remove('slide'); tr.style.transform = `translateX(${-st.page * W + (edge ? dx / 3 : dx)}px)`;
    });
    view.addEventListener('pointerup', (e) => {
      const d = down; down = null; if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.drag) {
        const W = view.clientWidth, fast = Math.abs(dx) / Math.max(1, e.timeStamp - d.t) > 0.5 && Math.abs(dx) > 30;
        setPage(Math.abs(dx) > W / 4 || fast ? st.page + (dx < 0 ? 1 : -1) : st.page);
        lastTap = null; return;
      }
      if (Math.hypot(dx, dy) > 10) return;
      if (st.phase === 'region') { const r = regionAt(e); if (r) toggleRegion(r.id); return; }
      if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { lastTap = null; setFs(true); }
      else lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    view.addEventListener('pointercancel', () => { if (down && down.drag) setPage(st.page); down = null; });
    // full view: double-tap or ✕ to close
    let fsTap = null;
    $('fsPaper').addEventListener('pointerup', (e) => {
      if (e.target.closest('button')) return;
      if (fsTap && e.timeStamp - fsTap < 350) { fsTap = null; setFs(false); } else fsTap = e.timeStamp;
    });
    $('fsClose').addEventListener('click', () => setFs(false));
  }
  function setFs(on) {
    st.fs = on; syncFs();
  }
  function syncFs() {
    const land = innerWidth > innerHeight && innerHeight < 520;   // a phone held sideways: the full ECG upright, no keyboard
    document.body.classList.toggle('land', land);
    $('fs').hidden = !(st.fs || land);
    requestAnimationFrame(drawAll);
  }

  // ------------------------------------------------------------------ keyboard and type-ahead
  function buildKeyboard() {
    // letters, or numbers (1AVB, 3AVB, 2:1); bottom row: 123/abc, space, clear
    const el = $('kbd'), keys = (r) => [...r].map((c) => `<button type="button" data-k="${c}">${c}</button>`).join('');
    const draw = (num) => {
      el.innerHTML = (num ? `<div class="row">${keys('1234567890')}</div><div class="row">${keys(':/-')}</div>` : `<div class="row">${keys('qwertyuiop')}</div><div class="row">${keys('asdfghjkl')}</div>`)
        + `<div class="row"><button type="button" class="wide add" data-k="add" aria-label="Add the first suggestion">Add</button>${num ? '<span class="gap"></span>' : keys('zxcvbnm')}<button type="button" class="wide" data-k="del" aria-label="Delete">⌫</button></div>`
        + `<div class="row"><button type="button" class="wide fn" data-k="num">${num ? 'abc' : '123'}</button><button type="button" class="space" data-k=" ">space</button><button type="button" class="wide fn" data-k="clear">Clear</button></div>`;
      el.dataset.num = num ? '1' : '';
    };
    draw(false);
    // pointerdown (not click): typing feels immediate; holding delete repeats
    let rep = null;
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120);
      const k = b.dataset.k;
      if (k === 'add') { const first = $('suggest').querySelector('button[data-id]'); if (first) pick(first.dataset.id); return; }
      if (k === 'num') { draw(!el.dataset.num); return; }
      if (k === 'clear') { st.typed = ''; renderField(); return; }
      if (k === 'del') { del(); clearInterval(rep); const t0 = Date.now(); rep = setInterval(() => { if (Date.now() - t0 > 400) del(); }, 70); return; }
      type(k);
    });
    const stop = () => clearInterval(rep);
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('pointerleave', stop);
    // a hardware keyboard works too (desktop testing)
    addEventListener('keydown', (e) => {
      if (st.phase !== 'answer' || e.metaKey || e.ctrlKey || e.altKey || !$('menu').hidden) return;
      if (/^[a-z0-9 :/-]$/i.test(e.key)) type(e.key.toLowerCase());
      else if (e.key === 'Backspace') del();
      else if (e.key === 'Enter') { const first = $('suggest').querySelector('button[data-id]'); if (first) pick(first.dataset.id); else submit(); }
      else return;
      e.preventDefault();
    });
  }
  function type(k) {
    if (k === ' ' && (!st.typed || st.typed.endsWith(' '))) return;
    if (st.typed.length < 30) { st.typed += k; renderField(); }
  }
  function del() { if (!st.typed) return; st.typed = st.typed.slice(0, -1); renderField(); }
  function pick(id) {
    const t = BY_ID[id]; if (!t) return;
    st.typed = '';
    if (t.kind === 'rhythm') { st.picked = st.picked.filter((p) => BY_ID[p.id].kind !== 'rhythm'); st.picked.unshift({ id }); render(); return; }
    if (t.region) { const p = { id, regions: [], pending: true }; st.picked.push(p); st.region = p; st.phase = 'region'; render(); return; }
    st.picked.push({ id }); render();
  }
  function toggleRegion(id) {
    const p = st.region, i = p.regions.indexOf(id);
    if (i >= 0) p.regions.splice(i, 1); else p.regions.push(id);
    renderPicked(); renderRegion(); drawAll();
  }
  function endRegion(keep) {
    if (keep) st.region.pending = false; else st.picked = st.picked.filter((p) => p !== st.region);
    st.region = null; st.phase = 'answer'; render();
  }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('app').appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
  function submit() {
    if (st.phase !== 'answer' || !st.item) return;
    if (!rhythmPick()) { const f = $('field'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); toast('Name the rhythm first'); return; }
    st.time = (performance.now() - st.t0) / 1000;
    st.score = score(st.item.key, st.picked, (k) => (st.skills[k || 'conditions'] || { r: 1500 }).r); st.selRow = null;
    if (st.mode === 'tutorial') {   // (not rated, not kept)
      st.delta = 0; st.phase = 'result'; st.typed = ''; st.shownAt = performance.now();
      setPage(1); render(); return;
    }
    // Glicko-2 per skill against the item's rating (from its rhythm and the number and type of its
    // abnormalities): the rhythm skill on the rhythm, each other skill on its findings (location half)
    const before = overall(), opp = { r: st.item.rating, rd: 60 }, sub = st.score.skill;
    const rated = st.mode !== 'daily' || st.rateDaily; st.rated = rated;
    if (rated) for (const k of SKILLS) if (sub[k] !== undefined) st.skills[k] = glicko(st.skills[k], opp, sub[k]);   // (the daily ECG: only with premium on, the day's first answer)
    st.delta = overall() - before;
    const d = today(); if (st.mode === 'daily') d.daily = st.score.total; else d.n++;
    scheduleReview(st.item, st.score.total);
    st.phase = 'result'; st.typed = ''; st.shownAt = performance.now();
    const rk = st.item.recipe || { rhythm: st.item.key.rhythm, abn: [] };
    st.hist.push({ id: st.item.id, title: itemTitle(st.item.key), score: st.score.total, time: st.time, rhythm: st.score.rhythm, delta: st.delta, at: Date.now(), mode: st.mode,
      rated, recipe: st.item.recipe, picked: st.picked.map((p) => (p.regions ? { id: p.id, regions: p.regions.slice() } : { id: p.id })),
      keys: [rk.rhythm, ...rk.abn.map((a) => a.k)], miss: st.score.rows.filter((r) => r.cls === 'miss' || r.cls === 'part').map((r) => r.id) });
    saveProgress();
    // show the half of the ECG that carries the answer
    const hl = st.item.highlight || [], chest = hl.filter((l) => l.startsWith('V')).length, limb = hl.length - chest;
    setPage(st.item.caliper && st.item.caliper.lead.startsWith('V') ? 1 : chest > limb ? 1 : 0);
    render();
  }

  // ------------------------------------------------------------------ scoring
  // rhythm 40% (an accepted alternative: half); required findings share 60% (the region is half of a
  // finding's share); optional findings +5% each; a finding not present −10%; clamped to 0–100%. With no
  // abnormality besides the rhythm, the rhythm is 100% and a finding not present −20%.
  // answers that count as the key's own (full credit): a more specific or more serious reading of the same thing
  const SAME_FINDING = { lvh: ['lvhStrain'], rbbb: ['bifascicular'], lafb: ['bifascicular'] };
  const SAME_RHYTHM = { avb2to1: ['mobitz2'] };   // (2:1 block: go with the more serious reading, Mobitz II)
  // advanced findings (f.adv, a rating): below that rating in the finding's skill they are shown but not asked: no
  // miss for leaving one out, credited (as a true extra) when named
  function score(key, picked, ratingOf = () => 9999) {
    const out = { rows: [], total: 0, skill: {} }, rp = picked.find((p) => BY_ID[p.id].kind === 'rhythm'), fs = {};
    const credit = (f, v) => { const k = f.skill || 'conditions'; (fs[k] = fs[k] || []).push(v); };
    let s = 0;
    if (rp && (rp.id === key.rhythm || (SAME_RHYTHM[key.rhythm] || []).includes(rp.id))) { s += 0.4; out.rows.push({ id: rp.id, rhythm: true, cls: 'ok', label: BY_ID[rp.id].name }); out.rhythm = 'ok'; }
    else if (rp && (key.alt || []).includes(rp.id)) { s += 0.2; out.rows.push({ id: rp.id, rhythm: true, cls: 'part', label: BY_ID[rp.id].name, tag: `more exactly: ${BY_ID[key.rhythm].name}` }); out.rhythm = 'part'; }
    else { out.rows.push({ id: rp.id, rhythm: true, cls: 'bad', label: BY_ID[rp.id].name }); out.rows.push({ id: key.rhythm, rhythm: true, cls: 'miss', label: BY_ID[key.rhythm].name }); out.rhythm = 'bad'; out.wrongRhythm = rp.id; }
    const later = key.findings.filter((f) => f.adv && ratingOf(f.skill) < f.adv), req = key.findings.filter((f) => !later.includes(f));
    const share = req.length ? 0.6 / req.length : 0, opt = key.optional || [];
    const fp = picked.filter((p) => BY_ID[p.id].kind === 'finding');
    let wrong = 0;
    for (const f of req) {
      const p = fp.find((x) => x.id === f.id || (SAME_FINDING[f.id] || []).includes(x.id));
      if (p) p.matched = true;
      if (!p) { credit(f, 0); out.rows.push({ id: f.id, cls: 'miss', label: f.regions ? `${BY_ID[f.id].name}, ${regionText(f.regions)}` : BY_ID[f.id].name }); out.missed = out.missed || f; continue; }
      if (!f.regions) { credit(f, 1); s += share; out.rows.push({ id: f.id, cls: 'ok', label: chipLabel(p) }); continue; }
      const allowed = [...f.regions, ...(f.okRegions || [])], regOk = f.regions.every((r) => p.regions.includes(r)) && p.regions.every((r) => allowed.includes(r));
      s += regOk ? share : share / 2; credit(f, regOk ? 1 : 0.5);
      out.rows.push({ id: f.id, cls: regOk ? 'ok' : 'part', label: chipLabel(p), tag: regOk ? '' : `leads: ${regionText(f.regions)}` });
      if (!regOk) out.regionMiss = out.regionMiss || f;
    }
    for (const f of later) {
      const p = fp.find((x) => !x.matched && x.id === f.id);
      if (p) { p.matched = true; s += 0.05; out.rows.push({ id: f.id, cls: 'ok', label: chipLabel(p), tag: 'advanced' }); }
      else out.rows.push({ id: f.id, cls: 'info', label: f.regions ? `${BY_ID[f.id].name}, ${regionText(f.regions)}` : BY_ID[f.id].name, tag: `advanced: asked from ${f.adv}` });
    }
    for (const p of fp) {
      if (p.matched || req.some((f) => f.id === p.id)) { delete p.matched; continue; }
      if (opt.includes(p.id)) { s += 0.05; out.rows.push({ id: p.id, cls: 'ok', label: chipLabel(p), tag: 'also true' }); continue; }
      wrong++; out.rows.push({ id: p.id, cls: 'bad', label: chipLabel(p) }); out.wrong = out.wrong || p;
    }
    // (an ECG whose only abnormality is its rhythm: the rhythm is the whole answer, so it carries the score;
    // a finding that is not there costs 20%)
    if (!req.length) s = (out.rhythm === 'ok' ? 1 : out.rhythm === 'part' ? 0.5 : 0) + (s - (out.rhythm === 'ok' ? 0.4 : out.rhythm === 'part' ? 0.2 : 0)) - 0.2 * wrong;
    else s -= 0.1 * wrong;
    out.total = Math.max(0, Math.min(1, s));
    out.skill.rhythm = out.rhythm === 'ok' ? 1 : out.rhythm === 'part' ? 0.5 : 0;
    for (const [k, v] of Object.entries(fs)) out.skill[k] = v.reduce((a, b) => a + b, 0) / v.length;
    return out;
  }
  // the one line: the single most important miss (rhythm, then a missed finding, then its location,
  // then a finding that is not there); a short confirmation when all is right
  // (the findings that matter most first: acute infarct, then the rest in the key's order)
  function oneLine(sc, it) {
    const L = it.lines || {}, main = it.key.findings.slice().sort((a, b) => (b.id === 'ste') - (a.id === 'ste'))[0];
    const top = main ? L[main.id] : L.rhythm;
    if (sc.rhythm === 'bad') { const n = BY_ID[sc.wrongRhythm].name; return `Not ${/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n}. ${L.rhythm}`; }
    if (sc.missed) return L[sc.missed.id] || top;
    if (sc.regionMiss) return L[sc.regionMiss.id] || top;
    if (sc.rhythm === 'part') return L.rhythm;
    if (sc.wrong) return `${chipLabel(sc.wrong)}: not present. ${top}`;
    return `Correct. ${top}`;
  }
  // a readable name for the history: the key's rhythm and findings
  function itemTitle(key) {
    return [BY_ID[key.rhythm].name, ...key.findings.map((f) => (f.regions ? `${BY_ID[f.id].name} ${regionText(f.regions)}` : BY_ID[f.id].name))].join(' · ');
  }
  function renderResult() {
    const sc = st.score, pct = Math.round(sc.total * 100);
    $('rscore').textContent = `${pct}%`;
    $('rbar').style.width = '0%'; requestAnimationFrame(() => { $('rbar').style.width = `${pct}%`; $('rbar').style.background = pct >= 80 ? 'var(--ok)' : pct >= 40 ? 'var(--part)' : 'var(--bad)'; });
    const d = Math.round(st.delta), daily = st.mode === 'daily' || st.mode === 'tutorial', unrated = !st.rated;
    // the rating before this ECG, then the change ("1500+13")
    $('rdelta').innerHTML = unrated ? 'not rated' : st.mode === 'view' ? `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}</span>` : `${Math.round(overall() - st.delta)}<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}</span>`;
    $('share').hidden = st.mode !== 'daily';
    $('next').textContent = daily || st.mode === 'view' || (st.mode === 'review' && !st.reviewRun.length) ? 'Done' : 'Next';
    $('rtime').textContent = `${Math.round(st.time)} s`;
    $('rchips').innerHTML = sc.rows.map((r, i) => `<button type="button" class="achip ${r.cls}${st.selRow === r ? ' sel' : ''}" data-i="${i}">${r.label}${r.tag ? ` <span class="tag">${r.tag}</span>` : ''}</button>`).join('');
    $('rline').textContent = st.selRow ? rowLine(st.selRow, st.item) : oneLine(sc, st.item);
  }
  // a result chip tapped: what that finding is on this ECG (its own line; not present; a true secondary finding)
  function rowLine(r, it) {
    const L = it.lines || {}, name = BY_ID[r.id] ? BY_ID[r.id].name : r.label;
    if (r.rhythm) return r.cls === 'bad' ? `Not ${name.toLowerCase()}. ${L.rhythm}` : L.rhythm;
    if (r.cls === 'bad') return `${r.label}: not present on this ECG.`;
    if (L[r.id]) return L[r.id];
    return `${name}: also true on this ECG (a secondary finding), credited but not required.`;
  }
  function selectRow(i) {
    const r = st.score.rows[i]; st.selRow = st.selRow === r ? null : r;
    if (st.selRow && !st.selRow.rhythm && (st.item.hlBy || {})[r.id]) {   // (show the half of the ECG with its leads)
      const ls = st.item.hlBy[r.id], chest = ls.filter((l) => l.startsWith('V')).length; setPage(chest > ls.length - chest ? 1 : 0);
    }
    renderResult(); requestAnimationFrame(drawAll);
  }

  // ------------------------------------------------------------------ home
  function renderHome() {
    const ti = title(), due = dueReviews().length, dd = st.days[dayKey()], daily = dd && dd.daily !== undefined ? dd.daily : null;
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    $('hRating').textContent = Math.round(overall());
    $('hStreak').textContent = streak();
    $('hTitle').textContent = ti.name;
    $('hTitleNext').textContent = ti.next ? `${ti.toNext} points to ${ti.next}` : 'Highest title';
    $('hDailyDate').textContent = date;
    $('hDailyState').textContent = daily === null ? (premiumOn() ? 'Same ECG for everyone today · rated' : 'Same ECG for everyone today · not rated') : `Done today: ${Math.round(daily * 100)}% · tap to see it again`;
    // locked: Train, Reviews and the skills show a lock and open the unlock page; the rating is provisional at first
    const locked = !ownsTraining();
    document.body.classList.toggle('locked', locked);
    $('hTrainSub').textContent = locked ? `Unlock Training: ECGs at your level, practice by skill and reviews · ${price()}` : 'ECGs chosen for your level, mixed skills';
    $('hRatingLabel').textContent = premiumOn() && ratedCount() < PROVISIONAL_N ? 'Rating · provisional' : 'Rating';
    $('hStatsSub').textContent = locked ? 'Unlock Training for your ratings by skill' : 'Your ratings, statistics, and review recent ECGs';
    $('hReviews').textContent = due ? `${due} due` : st.reviews.length ? 'none due today' : 'none yet';
    $('btnReviews').disabled = !due && ownsTraining();   // (locked: it opens the unlock page)
    $('hSkills').innerHTML = SKILLS.map((k) => `<button type="button" data-skill="${k}"><b>${SKILL_NAME[k]}</b>${locked ? LOCK : `<small>${Math.round(st.skills[k].r)}</small>`}</button>`).join('');   // (locked: no ratings shown)
  }
  // the unlock page. The purchase itself comes with Google Play billing; until then, in the preview, it unlocks this device.
  const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-label="locked"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function payButtons(busy) {
    const web = webStore();
    $('payPrice').textContent = price();
    $('payBuy').textContent = busy ? 'Opening Google Play…' : web ? 'Get ECG Studio on Google Play' : `Unlock Training · ${price()}`;
    $('payBuy').disabled = !!busy; $('payRestore').hidden = web;
  }
  function showPaywall() { payButtons(false); $('paywall').hidden = false; }
  function unlocked() { $('paywall').hidden = true; renderHome(); }
  function buyTraining() {
    if (shop.app) { payButtons(true); window.ECGInApp.post('buy', { product: 'training' }); return; }   // (Google Play's own sheet)
    if (webStore()) { window.open(PLAY_URL, '_blank', 'noopener'); return; }
    store.set(OWNED_KEY, '1'); unlocked();
    toast('Preview: Training unlocked on this device');
  }
  function restoreTraining() {
    if (shop.app) { $('payRestore').disabled = true; window.ECGInApp.post('restore'); return; }
    toast(store.get(OWNED_KEY) === '1' ? 'Purchase restored' : 'No purchase found on this device (preview)');
  }
  if (INAPP) {
    window.ECGInApp.listen('ents', (d) => { shop.app = !!d.billing; shop.dev = !!d.dev; shop.ents = d.ents || {}; shop.prices = d.prices || {}; if (!$('home').hidden) renderHome(); if (!$('paywall').hidden) payButtons($('payBuy').disabled); });
    window.ECGInApp.listen('bought', (d) => {
      payButtons(false);
      if (d.ok) { unlocked(); toast('Training unlocked. Thank you!'); }
      else if (d.pending) toast('Payment pending: Training unlocks when Google Play confirms it');
      else if (!d.cancelled) toast('The purchase did not go through. Please try again.');
    });
    window.ECGInApp.listen('restored', (d) => {
      $('payRestore').disabled = false;
      if (ownsTraining()) { unlocked(); toast('Purchase restored'); } else toast('No Training purchase found for this Google account');
    });
  }
  function shareDaily() {
    const pct = Math.round(st.score.total * 100), text = `ECG Studio · Daily ECG ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}: ${pct}%${streak() > 1 ? ` · ${streak()}-day streak` : ''}\nhttps://ecgstudio.app/training`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Result copied: paste it to share'), () => toast(text));
    else toast(text);
  }

  // ------------------------------------------------------------------ bug report (testers)
  // Opens the share sheet (or copies to the clipboard) with everything needed to rebuild and check the ECG:
  // the simulator link, the key, the tester's answer, the reader's checks and the generator recipe.
  function helpPage(page) {
    for (const x of document.querySelectorAll('#help .toc button')) x.setAttribute('aria-selected', String(x.dataset.page === page));
    for (const pg of document.querySelectorAll('#help .hpage')) pg.hidden = pg.dataset.page !== page;
    $('help').querySelector('.sheet').scrollTop = 0;
  }
  function showHelp() { $('help').hidden = false; }
  // (in the app the shell opens the link in the phone's browser)
  function openExternal(url) { if (window.ECGInApp && ECGInApp.active) ECGInApp.post('open', { url }); else window.open(url, '_blank', 'noopener'); }
  function reportProblem() {
    const it = st.item;
    if (!it) { toast('No ECG on screen to report'); return; }
    const k = it.key, name = (id) => (BY_ID[id] ? BY_ID[id].name : id);
    const keyTxt = [name(k.rhythm), ...k.findings.map((f) => (f.regions ? `${name(f.id)} (${f.regions.join(', ')})` : name(f.id)))].join('; ');
    const ans = st.picked.map(chipLabel).join('; ') || '(no answer yet)';
    const link = INAPP ? `${window.ECGInApp.site}#${it.link}` : new URL(`../index.html#${it.link}`, location.href).href;
    const ver = (document.querySelector('meta[name="version"]') || {}).content || '';
    const text = ['ECG Studio Training: problem report', '', 'What looks wrong: ', '',
      `Scenario in the simulator: ${link}`, `Answer key: ${keyTxt}`, `Also accepted: ${(k.optional || []).map(name).join(', ') || 'none'}`,
      `My answer: ${ans}${st.score ? ` (score ${Math.round(st.score.total * 100)}%)` : ''}`, `Measurements: ${JSON.stringify(it.m)}`,
      `Reader: ${it.read.rhythm}; ${(it.read.dx || []).join(', ') || 'no findings'}; ${(it.read.checks || []).join('; ')}`,
      `Recipe: ${JSON.stringify(it.recipe)}`, `Mode: ${st.mode}; version ${ver}`].join('\n');
    // with a report form set (site.json reportForm: a Google Form's prefill link ending in "entry.<id>="), the report
    // opens there, filled in: anyone can send one and no address is shown. The recipe and measurements are left out
    // when the link would be too long (the scenario link rebuilds the ECG).
    const form = ((document.querySelector('meta[name="report-form"]') || {}).content || '').trim();
    if (/^https:\/\//.test(form)) {
      let body = text.replace('What looks wrong: \n\n', '');   // (the form asks this in its own field)
      if (encodeURIComponent(body).length > 6000) body = body.split('\n').filter((l) => !/^(Recipe|Measurements): /.test(l)).join('\n');
      if (encodeURIComponent(body).length > 6000) body = body.slice(0, 1800);
      openExternal(form + encodeURIComponent(body));
      return;
    }
    if (navigator.share) navigator.share({ title: 'ECG Studio Training: problem report', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Report copied: paste it into a message to the author'), () => toast('Could not copy the report'));
    else toast('Sharing is not available in this browser');
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    buildKeyboard(); initEcgTouch();
    $('suggest').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) pick(b.dataset.id); });
    $('picked').addEventListener('click', (e) => {
      const b = e.target.closest('.achip'); if (!b || st.phase !== 'answer') return;
      st.picked.splice(+b.dataset.i, 1); render();
    });
    $('regionGrid').addEventListener('click', (e) => { const b = e.target.closest('button[data-r]'); if (b) toggleRegion(b.dataset.r); });
    $('regionDone').addEventListener('click', () => endRegion(true));
    $('regionCancel').addEventListener('click', () => endRegion(false));
    // (the tap that submitted must not land on the result's buttons, which open under the finger)
    const justShown = () => performance.now() - (st.shownAt || 0) < 450;
    $('next').addEventListener('click', () => {
      if (justShown()) return;
      if ($('next').textContent !== 'Done') { nextItem(); return; }
      const back = st.mode === 'view' && st.fromStats; st.fromStats = false; goHome();
      if (back) { renderStats(); $('stats').hidden = false; }   // (a past ECG: back to Statistics)
    });
    $('statsBody').addEventListener('click', (e) => { const r = e.target.closest('[data-h]'); if (r) openPast(+r.dataset.h); });
    $('share').addEventListener('click', () => { if (!justShown()) shareDaily(); });
    $('rchips').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b && !justShown()) selectRow(+b.dataset.i); });
    $('report').addEventListener('click', () => { if (!justShown()) reportProblem(); });
    // (in the app: tapping the Training tab while it is showing returns to Training home; on the website: the menu)
    // Android back (in the app): close what is open, then back to Training home; at home the app leaves
    if (INAPP) window.ECGInApp.listen('back', () => {
      const pg = [...document.querySelectorAll('.page:not(#home)')].find((x) => !x.hidden);
      let handled = true;
      if (!$('menu').hidden) $('menu').hidden = true;
      else if (!$('help').hidden) $('help').hidden = true;
      else if (pg) pg.hidden = true;
      else if (st.fs) setFs(false);
      else if (st.phase === 'region') endRegion(false);
      else if ($('home').hidden) goHome();
      else handled = false;
      window.ECGInApp.post('back', { handled });
    });
    if (INAPP) window.ECGInApp.listen('tour', (d) => {
      if (d.step === 'prep') prepTour();
      if (d.step === 'train' && window.ECGTour) window.ECGTour.startTraining();
    });
    if (INAPP) window.ECGInApp.listen('reselect', () => { $('menu').hidden = true; $('help').hidden = true; for (const pg of document.querySelectorAll('.page:not(#home)')) pg.hidden = true; if ($('home').hidden) goHome(); });
    $('btnTrain').addEventListener('click', () => startMode('train'));
    $('btnDaily').addEventListener('click', () => startMode('daily'));
    $('btnReviews').addEventListener('click', () => startMode('review'));
    $('hSkills').addEventListener('click', (e) => { const b = e.target.closest('[data-skill]'); if (b) startMode('skill', b.dataset.skill); });
    $('btnStats').addEventListener('click', () => { if (!ownsTraining()) { showPaywall(); return; } renderStats(); $('stats').hidden = false; });
    $('payBuy').addEventListener('click', buyTraining);
    $('payRestore').addEventListener('click', restoreTraining);
    $('payLater').addEventListener('click', () => { $('paywall').hidden = true; });
    // Model ("show me why"): the simulator on the same scenario; coming back starts a new ECG (progress is saved).
    // In the app: the Simulator tab opens on it, and the Training tab still holds this ECG.
    $('why').addEventListener('click', () => {
      if (justShown()) return;
      if (INAPP) window.ECGInApp.go('simulator', st.item.link); else location.href = `../index.html#${st.item.link}`;
    });
    addEventListener('resize', syncFs);
    $('submit').addEventListener('click', submit);
    // menu (from the ECG's header or the home screen's): statistics, help, restart, the simulator; on the home screen
    // without the items about an ECG
    const menu = $('menu'), showMenu = (on) => {
      const home = !$('home').hidden;
      for (const b of menu.querySelectorAll('[data-go="home"], [data-go="report"]')) b.hidden = home;
      menu.hidden = !on; for (const id of ['menuBtn', 'homeMenuBtn']) $(id).setAttribute('aria-expanded', String(on));
    };
    for (const id of ['menuBtn', 'homeMenuBtn']) $(id).addEventListener('click', (e) => { e.stopPropagation(); showMenu(menu.hidden); });
    addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#menu, #menuBtn, #homeMenuBtn')) showMenu(false); });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (!b) return;
      showMenu(false);
      if (b.dataset.go === 'home') goHome();
      if (b.dataset.go === 'report') reportProblem();
      if (b.dataset.go === 'stats') { if (!ownsTraining()) { showPaywall(); return; } renderStats(); $('stats').hidden = false; }
      if (b.dataset.go === 'help') showHelp();
      if (b.dataset.go === 'restart' && confirm('Reset your progress? This clears your ratings and history on this phone.')) {
        st.hist = []; st.skills = Object.fromEntries(SKILLS.map((k) => [k, fresh()])); st.reviews = []; st.days = {}; saveProgress(); goHome();
      }
    });
    // help (a dialog; tap outside or Close)
    for (const b of document.querySelectorAll('#help .toc button')) b.addEventListener('click', () => helpPage(b.dataset.page));
    $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help') $('help').hidden = true; });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') $('help').hidden = true; });
    for (const b of document.querySelectorAll('.page [data-close]')) b.addEventListener('click', () => { b.closest('.page').hidden = true; });
    addEventListener('resize', () => requestAnimationFrame(sizeBottom));
    // (an installed iOS web app can settle its screen size and home-bar inset only after the first layout)
    addEventListener('pageshow', () => requestAnimationFrame(sizeBottom));
    if (window.visualViewport) visualViewport.addEventListener('resize', () => requestAnimationFrame(sizeBottom));
    window.ECGTraining = { st, gen, tour, prepTour, showPaywall, ownsTraining, premiumOn, pick, submit, toggleRegion, endRegion, setPage, setFs, score, nextItem, startMode, goHome, VOCAB, BY_ID, suggest: () => suggestions().list.map((x) => x.t.name) };   // (automated tests)
    startWorker(); renderHome(); syncFs(); requestAnimationFrame(sizeBottom);   // (the heart is built in the background while the home screen shows)
    if (document.fonts) document.fonts.ready.then(() => requestAnimationFrame(drawAll));
  }
  init();
})();
