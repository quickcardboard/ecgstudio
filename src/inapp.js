// App mode: this page runs as a module inside the app shell (app/index.html loads it in a frame with ?app).
// The shell draws the module tabs over the left of this page's header (html.inapp reserves --tabs-w there);
// this script tells the shell when that header is covered (full-screen views, help and other pages: a page's own
// header counts only when marked .app-bar), and passes the shell's show/hide and the other modules' requests on.
(function () {
  const active = /[?&]app(?:[=&]|$)/.test(location.search) && window.parent !== window;
  const listeners = {};
  const api = window.ECGInApp = {
    active,
    site: 'https://ecgstudio.app/',   // (links shared from the app point at the website)
    post(type, data) { if (active) parent.postMessage(Object.assign({ ecgApp: type }, data || {}), '*'); },
    listen(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    go(module, hash) { api.post('go', { module, hash: hash || '' }); },   // switch to another module (e.g. the simulator on a scenario)
  };
  if (!active) return;
  document.documentElement.classList.add('inapp');
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !d || !d.ecgApp) return;
    if (d.ecgApp === 'tabs') { document.documentElement.style.setProperty('--tabs-w', `${d.w}px`); soon(); }
    for (const fn of listeners[d.ecgApp] || []) fn(d);
  });
  // is the header under the tabs showing? (whatever covers the top-left corner decides)
  let last = null, queued = false;
  function check() {
    queued = false;
    const el = document.elementFromPoint(4, 25);
    const on = !!(el && el.closest('header, .app-bar'));
    if (on !== last) { last = on; api.post('chrome', { on }); }
  }
  function soon() { if (!queued) { queued = true; requestAnimationFrame(check); } }
  function start() {
    new MutationObserver(soon).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
    addEventListener('resize', soon);
    addEventListener('pointerup', () => { soon(); setTimeout(soon, 350); });
    addEventListener('transitionend', soon);
    api.post('ready'); soon();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
