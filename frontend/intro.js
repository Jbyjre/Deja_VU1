/* intro.js: the opening scene.
 *
 * On a fresh start the 3D printer fills the whole screen for three seconds, turning slowly, close up. Then the camera pulls back and the
 * printer settles into its place on the Printer screen while the rest of the app rises in around it (the sidebar, the toolbar, the tiles). Where
 * the app opens on another screen the printer fades away instead and that screen comes up.
 *
 * It is the same 3D printer the Printer screen shows, borrowed for those seconds (the card is docked into a full-screen layer and handed back),
 * so nothing is drawn twice. It plays only on a fresh start (not on a reload or Back), never with reduced motion, never in an automated browser
 * (add ?intro to see it there) and not on a computer that draws 3D in software (it would stall; ?intro=force plays it anyway) and not when Settings › Look & layout has it off (?nointro skips it once). Any click, key or the Skip button ends it
 * at once. If the printer is not ready to draw within about three seconds (no printer and no demo data, or no WebGL 2) it does not play, and the
 * plain cover that hides the page from the first paint (html.intro-pending, set in theme-boot.js) is lifted. It can be played again from the
 * command bar ("Play the opening scene").
 */
(() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const KEY = 'dejavu1.pref.intro';
  const HOLD_MS = 3000, GIVE_UP_MS = 3400, PULL_MS = 760;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = false;

  const lift = () => root.classList.remove('intro-pending');
  const click = sel => { const b = document.querySelector(sel); if (b) b.click(); };

  /* A computer that draws 3D in software (no graphics acceleration) would stall for the whole scene, as drawing the printer full screen costs
   * it hundreds of milliseconds a frame: there the scene does not play. ?intro=force plays it anyway (for checking it in such a browser). */
  function drawsInSoftware() {
    if (/[?&]intro=force\b/.test(location.search)) return false;
    return !!(window.Cockpit && Cockpit.software && Cockpit.software());
  }

  function twinReady() {
    const card = $('twin-card');
    return !!card && card.dataset.twinEngine === '3d' && !!card.querySelector('#twin-model canvas');
  }

  function play(opts) {
    if (playing || reduced()) { lift(); return; }
    const card = $('twin-card');
    if (!card || !twinReady() || drawsInSoftware()) { lift(); return; }
    playing = true;
    const home = { parent: card.parentElement, next: card.nextSibling };
    const spinBtn = $('twin-spin');
    const spinWas = !!spinBtn && spinBtn.getAttribute('aria-pressed') === 'true';

    const layer = document.createElement('div');
    layer.id = 'intro';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Opening scene');
    layer.innerHTML = `<div class="intro-bg" id="intro-bg"></div><div class="intro-stage" id="intro-stage"></div>
      <div class="intro-foot"><span class="intro-brand">Deja Vu1</span><span class="intro-name" id="intro-name"></span>
        <button type="button" class="intro-skip" id="intro-skip">Skip</button></div>`;
    document.body.append(layer);
    const stage = $('intro-stage');
    stage.append(card);
    card.dataset.stage = 'intro';
    const nameEl = $('intro-name');
    const who = $('pp-name');
    if (nameEl && who && who.textContent && who.textContent !== 'Printer') nameEl.textContent = who.textContent;
    lift();                                                    // the layer covers the page now: the plain cover can go
    window.dispatchEvent(new Event('resize'));
    if (spinBtn && !spinWas) spinBtn.click();                  // turn slowly
    for (let i = 0; i < 3; i++) click('[data-twin="zoom-in"]');   // close up: the pull-back is the camera moving away
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-in')));

    let finished = false, timer = 0;
    const end = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      layer.remove();
      document.removeEventListener('keydown', skip, true);
      root.classList.remove('intro-reveal');
      if (window.Panes && Panes.dock) Panes.dock();
      if (card.closest('#intro')) home.parent.insertBefore(card, home.next);
      card.style.transform = '';
      card.style.opacity = '';
      card.dataset.stage = 'printer';
      window.dispatchEvent(new Event('resize'));
      playing = false;
    };
    const pull = fast => {
      if (finished || layer.classList.contains('is-leaving')) return;
      clearTimeout(timer);
      layer.classList.add('is-leaving');
      root.classList.add('intro-reveal');
      if (spinBtn && !spinWas && spinBtn.getAttribute('aria-pressed') === 'true') spinBtn.click();
      click('[data-twin="reset"]');                           // the camera sets back (the twin's own 0.5 s move)
      const target = $('p-stage');
      const onPrinter = document.body.dataset.tab === 'control' && target && target.offsetParent !== null;
      const ms = fast ? 380 : PULL_MS;
      if (!card.animate) { end(); return; }
      const f = card.getBoundingClientRect();
      let anim;
      if (onPrinter) {
        // The card is the whole screen; it shrinks, in one uniform scale, onto the stage while the layer's window closes down to the stage's
        // box, so the printer never squashes and lands where the stage will draw it.
        const r = target.getBoundingClientRect();
        const s = Math.max(r.height / f.height, r.width / f.width);
        const dx = r.left + r.width / 2 - (f.left + f.width / 2), dy = r.top + r.height / 2 - (f.top + f.height / 2);
        stage.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round 18px)` }],
          { duration: ms, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' });
        anim = card.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: ms, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' });
      } else {
        stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
        anim = card.animate([{ transform: 'none' }, { transform: 'scale(0.92)' }], { duration: ms, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' });
      }
      $('intro-bg').animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay: onPrinter ? ms * 0.15 : 0, easing: 'ease-out', fill: 'forwards' });
      layer.querySelector('.intro-foot').animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.min(260, ms), fill: 'forwards' });
      anim.onfinish = () => setTimeout(end, 40);
      setTimeout(end, ms + 400);                              // never left on screen if an animation does not report
    };
    const skip = e => {
      if (e && e.type === 'keydown') e.preventDefault();
      pull(true);
    };
    layer.addEventListener('pointerdown', () => skip());
    $('intro-skip').addEventListener('click', e => { e.stopPropagation(); skip(); });
    document.addEventListener('keydown', skip, true);
    timer = setTimeout(() => pull(false), (opts && opts.hold) || HOLD_MS);
  }

  function start() {
    if (!root.classList.contains('intro-pending')) return;
    const t0 = performance.now();
    const poll = setInterval(() => {
      if (twinReady()) { clearInterval(poll); setTimeout(() => play(), 120); }
      else if (performance.now() - t0 > GIVE_UP_MS) { clearInterval(poll); lift(); }
    }, 80);
  }

  window.DVIntro = {
    replay: opts => play(Object.assign({ hold: HOLD_MS }, opts || {})),
    on: () => store.get(KEY) !== 'off',                       // `store` falls back to the tab's memory where saved settings are blocked
    set: on => store.set(KEY, on ? 'on' : 'off'),
  };
  start();
})();
