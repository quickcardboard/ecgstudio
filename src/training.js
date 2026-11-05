// ECG Studio Training (prototype). A fixed bank of pre-generated, blind-read ECGs (tools/trainbank.js);
// the user names the rhythm and the findings with an in-app keyboard and type-ahead, locates findings
// by tapping lead groups, and gets a one-screen result. No storage: the session rating is not kept.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
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
  // a term matches when the typed text starts at the start of a word of its name or a synonym, or
  // matches the name/synonym written without spaces ("3avb" → "3 AVB"). Returns { via, exact } or null:
  // via is the synonym that matched ('' for the name), exact when the text is that whole synonym.
  function matchTerm(t, q) {
    const qs = q.replace(/ /g, '');
    let best = null;
    for (const [s, isName] of [[t.name, true], ...t.syn.map((x) => [x, false])]) {
      const n = norm(s), ns = n.replace(/ /g, '');
      if (ns.startsWith(qs) || (' ' + n).includes(' ' + q)) {
        const exact = ns === qs;
        if (!best || (exact && !best.exact) || (isName && !best.exact && best.via)) best = { via: isName ? '' : s, exact };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ bank
  const ITEMS = BANK.map((it) => ({
    ...it,
    data: it.leads.map((b) => { const bin = atob(b), a = new Int16Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16; return a; }),
  }));
  // interleaved order (confusable pairs close together); open-ended: wraps around
  const ORDER = ['normal', 'avnrt', 'lbbb', 'avrt', 'oldInf', 'mobitz1', 'af', 'antSTEMI', 'chb', 'flutter'].map((id) => ITEMS.findIndex((x) => x.id === id)).filter((i) => i >= 0);
  for (let i = 0; i < ITEMS.length; i++) if (!ORDER.includes(i)) ORDER.push(i);

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
  const st = {
    pos: 0, item: null, page: 0, picked: [], typed: '', phase: 'answer',   // answer | region | result
    region: null, t0: 0, rating: 1500, fs: false, hist: [],
  };
  // session (this browser tab only; the prototype keeps nothing longer): survives "Show me why" and back
  function saveSession() { try { sessionStorage.setItem('ecgTraining', JSON.stringify({ hist: st.hist, rating: st.rating })); } catch (e) { /* storage blocked */ } }
  try { const j = JSON.parse(sessionStorage.getItem('ecgTraining') || 'null'); if (j) { st.hist = j.hist || []; st.rating = j.rating || 1500; } } catch (e) { /* none */ }
  {
    const m = /(?:^|[#&])i=(\d+)/.exec(location.hash); if (m) st.pos = (+m[1]) % ORDER.length;
  }
  const rhythmPick = () => st.picked.find((p) => BY_ID[p.id].kind === 'rhythm');

  function loadItem() {
    st.item = ITEMS[ORDER[st.pos % ORDER.length]];
    st.picked = []; st.typed = ''; st.phase = 'answer'; st.region = null; st.t0 = performance.now(); st.score = null;
    setPage(0, false); render();
  }

  // ------------------------------------------------------------------ rendering
  function measChips(el) {
    // (rate in /min, intervals in ms)
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
    list.sort((a, b) => (b.exact - a.exact) || (a.t.rank - b.t.rank));   // an exact abbreviation, then the most common
    return { list, q };
  }
  function renderField() {
    const wantRhythm = !rhythmPick();
    $('typed').textContent = st.typed;
    $('ph').textContent = st.typed ? '' : wantRhythm ? 'Type the rhythm' : 'Add a finding';
    const { list, q } = suggestions(), el = $('suggest');
    let html = '';
    if (q.replace(/ /g, '').length < 2) {
      html += `<span class="hint">${q.length ? 'one more letter…' : wantRhythm ? 'Suggestions after 2 letters' : 'Add every abnormality you see, then Submit'}</span>`;
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
    const it = st.item, res = st.phase === 'result', reg = st.phase === 'region';
    const opts = res ? { highlight: it.highlight, caliper: it.caliper } : reg ? { regions: true, picked: new Set(st.region.regions) } : {};
    drawEcg($('c0'), it, PAGES[0], opts); drawEcg($('c1'), it, PAGES[1], opts);
    if (st.fs || document.body.classList.contains('land')) drawEcg($('cfull'), it, FULL, res ? opts : {});
  }
  function render() {
    measChips($('meas')); measChips($('fsMeas'));
    $('rating').innerHTML = `<em>Rating</em>${Math.round(st.rating)}`;
    const ph = st.phase;
    $('answer').hidden = ph === 'result'; $('kbd').hidden = ph !== 'answer'; $('region').hidden = ph !== 'region'; $('result').hidden = ph !== 'result';
    renderPicked();
    if (ph === 'answer') renderField();
    if (ph === 'region') { $('suggest').innerHTML = ''; $('fieldRow').hidden = true; renderRegion(); } else $('fieldRow').hidden = false;
    if (ph === 'region') $('answer').hidden = false;
    if (ph === 'result') renderResult();
    requestAnimationFrame(drawAll);
  }


  // ------------------------------------------------------------------ statistics (this session)
  function renderStats() {
    const h = st.hist, n = h.length, avg = (f) => (n ? h.reduce((a, x) => a + f(x), 0) / n : 0);
    const el = $('statsBody');
    if (!n) { el.innerHTML = '<p class="empty">No answers yet. Statistics fill in as you answer.</p><p class="empty">Prototype: statistics are kept for this browser tab only.</p>'; return; }
    const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
    el.innerHTML = `<div class="tiles">${tile(Math.round(st.rating), 'Rating')}${tile(n, 'ECGs answered')}${tile(`${Math.round(avg((x) => x.score) * 100)}%`, 'Average score')}${tile(`${Math.round(avg((x) => (x.rhythm === 'ok' ? 1 : 0)) * 100)}%`, 'Rhythm correct')}${tile(`${Math.round(avg((x) => x.time))} s`, 'Average time')}${tile(`${h.filter((x) => x.score >= 0.999).length}`, 'Perfect answers')}</div>`
      + '<h3>By ECG</h3><div class="hist">' + h.slice().reverse().map((x) => `<div><span>${x.title}</span><span class="pc" style="color:${x.score >= 0.8 ? 'var(--ok)' : x.score >= 0.4 ? 'var(--part)' : 'var(--bad)'}">${Math.round(x.score * 100)}%</span><span class="tm">${Math.round(x.time)} s</span></div>`).join('') + '</div>'
      + '<p class="empty" style="margin-top:16px">Prototype: statistics are kept for this browser tab only. The skill radar, rating history and accuracy by topic come with saved progress.</p>';
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
    const el = $('kbd'), keys = (r) => [...r].map((c) => `<button type="button" data-k="${c}">${c}</button>`).join('');
    el.innerHTML = `<div class="row">${keys('qwertyuiop')}</div><div class="row">${keys('asdfghjkl')}</div>`
      + `<div class="row"><button type="button" class="wide add" data-k="add" aria-label="Add the first suggestion">Add</button>${keys('zxcvbnm')}<button type="button" class="wide" data-k="del" aria-label="Delete">⌫</button></div>`
      + '<div class="row"><button type="button" class="space" data-k=" ">space</button></div>';
    // pointerdown (not click): typing feels immediate; holding delete repeats
    let rep = null;
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120);
      const k = b.dataset.k;
      if (k === 'add') { const first = $('suggest').querySelector('button[data-id]'); if (first) pick(first.dataset.id); return; }
      if (k === 'del') { del(); clearInterval(rep); const t0 = Date.now(); rep = setInterval(() => { if (Date.now() - t0 > 400) del(); }, 70); return; }
      type(k);
    });
    const stop = () => clearInterval(rep);
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('pointerleave', stop);
    // a hardware keyboard works too (desktop testing)
    addEventListener('keydown', (e) => {
      if (st.phase !== 'answer' || e.metaKey || e.ctrlKey || e.altKey || !$('menu').hidden) return;
      if (/^[a-z ]$/i.test(e.key)) type(e.key.toLowerCase());
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
    if (st.phase !== 'answer') return;
    if (!rhythmPick()) { const f = $('field'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); toast('Name the rhythm first'); return; }
    st.time = (performance.now() - st.t0) / 1000;
    st.score = score(st.item.key, st.picked);
    // session rating (Elo-style; the prototype keeps nothing): item rating from its number of findings
    const k = st.item.key, ir = 1400 + 120 * k.findings.length + (['avnrt', 'avrt', 'mobitz1', 'flutter'].includes(st.item.id) ? 120 : 0);
    const exp = 1 / (1 + 10 ** ((ir - st.rating) / 400));
    st.delta = 32 * (st.score.total - exp); st.rating += st.delta;
    st.phase = 'result'; st.typed = ''; st.shownAt = performance.now();
    st.hist.push({ id: st.item.id, title: st.item.title, score: st.score.total, time: st.time, rhythm: st.score.rhythm, delta: st.delta });
    saveSession();
    // show the half of the ECG that carries the answer
    const hl = st.item.highlight || [], chest = hl.filter((l) => l.startsWith('V')).length, limb = hl.length - chest;
    setPage(st.item.caliper && st.item.caliper.lead.startsWith('V') ? 1 : chest > limb ? 1 : 0);
    render();
  }

  // ------------------------------------------------------------------ scoring
  // rhythm 40% (an accepted alternative: half); required findings share 60% (the region is half of a
  // finding's share); optional findings +5% each; a finding not present −10% (on an ECG with no other
  // abnormality: −20%); clamped to 0–100%
  function score(key, picked) {
    const out = { rows: [], total: 0 }, rp = picked.find((p) => BY_ID[p.id].kind === 'rhythm');
    let s = 0;
    if (rp && rp.id === key.rhythm) { s += 0.4; out.rows.push({ id: rp.id, cls: 'ok', label: BY_ID[rp.id].name }); out.rhythm = 'ok'; }
    else if (rp && (key.alt || []).includes(rp.id)) { s += 0.2; out.rows.push({ id: rp.id, cls: 'part', label: BY_ID[rp.id].name, tag: `more exactly: ${BY_ID[key.rhythm].name}` }); out.rhythm = 'part'; }
    else { out.rows.push({ id: rp.id, cls: 'bad', label: BY_ID[rp.id].name }); out.rows.push({ id: key.rhythm, cls: 'miss', label: BY_ID[key.rhythm].name }); out.rhythm = 'bad'; out.wrongRhythm = rp.id; }
    const req = key.findings, share = req.length ? 0.6 / req.length : 0, opt = key.optional || [];
    const fp = picked.filter((p) => BY_ID[p.id].kind === 'finding');
    let wrong = 0;
    for (const f of req) {
      const p = fp.find((x) => x.id === f.id);
      if (!p) { out.rows.push({ id: f.id, cls: 'miss', label: f.regions ? `${BY_ID[f.id].name}, ${regionText(f.regions)}` : BY_ID[f.id].name }); out.missed = out.missed || f; continue; }
      if (!f.regions) { s += share; out.rows.push({ id: f.id, cls: 'ok', label: chipLabel(p) }); continue; }
      const allowed = [...f.regions, ...(f.okRegions || [])], regOk = f.regions.every((r) => p.regions.includes(r)) && p.regions.every((r) => allowed.includes(r));
      s += regOk ? share : share / 2;
      out.rows.push({ id: f.id, cls: regOk ? 'ok' : 'part', label: chipLabel(p), tag: regOk ? '' : `leads: ${regionText(f.regions)}` });
      if (!regOk) out.regionMiss = out.regionMiss || f;
    }
    for (const p of fp) {
      if (req.some((f) => f.id === p.id)) continue;
      if (opt.includes(p.id)) { s += 0.05; out.rows.push({ id: p.id, cls: 'ok', label: chipLabel(p), tag: 'also true' }); continue; }
      wrong++; out.rows.push({ id: p.id, cls: 'bad', label: chipLabel(p) }); out.wrong = out.wrong || p;
    }
    if (!req.length) s += Math.max(0, 0.6 - 0.2 * wrong); else s -= 0.1 * wrong;
    out.total = Math.max(0, Math.min(1, s));
    return out;
  }
  // the one line: the single most important miss (rhythm, then a missed finding, then its location,
  // then a finding that is not there); a short confirmation when all is right
  function oneLine(sc, it) {
    if (sc.rhythm === 'bad') { const n = BY_ID[sc.wrongRhythm].name; return `Not ${/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n}. ${it.line}`; }
    if (sc.missed || sc.regionMiss || sc.rhythm === 'part') return it.line;
    if (sc.wrong) return `${chipLabel(sc.wrong)}: not present. ${it.line}`;
    return `Correct. ${it.line}`;
  }
  function renderResult() {
    const sc = st.score, pct = Math.round(sc.total * 100);
    $('rscore').textContent = `${pct}%`;
    $('rbar').style.width = '0%'; requestAnimationFrame(() => { $('rbar').style.width = `${pct}%`; $('rbar').style.background = pct >= 80 ? 'var(--ok)' : pct >= 40 ? 'var(--part)' : 'var(--bad)'; });
    const d = Math.round(st.delta);
    $('rdelta').textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d)}`; $('rdelta').className = `delta ${d >= 0 ? 'up' : 'down'}`;
    $('rtime').textContent = `${Math.round(st.time)} s`;
    $('rchips').innerHTML = sc.rows.map((r) => `<span class="achip ${r.cls}">${r.label}${r.tag ? ` <span class="tag">${r.tag}</span>` : ''}</span>`).join('');
    $('rline').textContent = oneLine(sc, st.item);
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
    const fresh = () => performance.now() - (st.shownAt || 0) < 450;
    $('next').addEventListener('click', () => { if (fresh()) return; st.pos = (st.pos + 1) % ORDER.length; history.replaceState(null, '', `#i=${st.pos}`); loadItem(); });
    // Show me why: the simulator on the same scenario; coming back continues at the next item
    $('why').addEventListener('click', () => {
      if (fresh()) return;
      history.replaceState(null, '', `#i=${(st.pos + 1) % ORDER.length}`);
      location.href = `../index.html#${st.item.link}`;
    });
    addEventListener('resize', syncFs);
    $('submit').addEventListener('click', submit);
    // menu: statistics, help, restart, the simulator
    const menu = $('menu'), showMenu = (on) => { menu.hidden = !on; $('menuBtn').setAttribute('aria-expanded', String(on)); };
    $('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); showMenu(menu.hidden); });
    addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#menu, #menuBtn')) showMenu(false); });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (!b) return;
      showMenu(false);
      if (b.dataset.go === 'stats') { renderStats(); $('stats').hidden = false; }
      if (b.dataset.go === 'help') $('help').hidden = false;
      if (b.dataset.go === 'restart' && confirm('Start again? This clears the session statistics and rating.')) {
        st.hist = []; st.rating = 1500; saveSession(); st.pos = 0; history.replaceState(null, '', '#i=0'); loadItem();
      }
    });
    for (const b of document.querySelectorAll('.page [data-close]')) b.addEventListener('click', () => { b.closest('.page').hidden = true; });
    window.ECGTraining = { st, pick, submit, toggleRegion, endRegion, setPage, setFs, score, ITEMS, VOCAB };   // (automated tests)
    for (const it of ITEMS) for (const id of [it.key.rhythm, ...(it.key.alt || []), ...it.key.findings.map((f) => f.id), ...(it.key.optional || [])]) if (!BY_ID[id]) console.warn(`training: ${it.id} uses "${id}", not in the vocabulary`);
    loadItem(); syncFs();
    if (document.fonts) document.fonts.ready.then(() => requestAnimationFrame(drawAll));
  }
  init();
})();
