/* theme-boot.js: Light / Dark / System, applied before the page is drawn.
 * Loaded in <head> on purpose (no defer), so a reload never flashes the
 * other theme. Preferences → Appearance → Theme saves the choice in this
 * browser only; "system" follows the computer's own setting and changes
 * with it. dark.css holds the dark colours; everything else reads
 * data-theme on <html>. Other scripts listen for "dv-theme" to redraw what
 * CSS can't reach (canvas and 3D labels).
 *
 * The look (Preferences → Appearance → Look) is set here too, as data-ui:
 * "glass" (the default: frosted glass and the moving background),
 * "workbench" (flat panels, hairlines, aligned numbers) or "control"
 * (denser and squarer, grey, colour only for status). looks.css holds the
 * last two; "dv-ui" tells scripts it changed. A look chosen before the
 * default changed stays as it was chosen.
 */
(function () {
  var KEY = 'dejavu1.pref.theme';
  var UI_KEY = 'dejavu1.pref.ui';
  var LOOKS = ['glass', 'workbench', 'control'];
  var DEFAULT_LOOK = 'glass';
  function look() {
    try {
      var v = localStorage.getItem(UI_KEY);
      return LOOKS.indexOf(v) >= 0 ? v : DEFAULT_LOOK;
    } catch (e) {
      return DEFAULT_LOOK;
    }
  }
  function applyLook(choice) {
    document.documentElement.setAttribute('data-ui', choice);
    try { window.dispatchEvent(new CustomEvent('dv-ui', { detail: { ui: choice } })); } catch (e) { /* old browser */ }
  }
  applyLook(look());
  // Spacing (Preferences → Appearance → Spacing): "comfortable" (the default) or "compact", which
  // tightens cards and the sidebar so more of a screen is useful on a laptop.
  var DENSITY_KEY = 'dejavu1.pref.density';
  var DENSITIES = ['comfortable', 'compact'];
  function density() {
    try {
      var v = localStorage.getItem(DENSITY_KEY);
      return DENSITIES.indexOf(v) >= 0 ? v : 'comfortable';
    } catch (e) {
      return 'comfortable';
    }
  }
  function applyDensity(choice) {
    document.documentElement.setAttribute('data-density', choice);
    try { window.dispatchEvent(new CustomEvent('dv-density', { detail: { density: choice } })); } catch (e) { /* old browser */ }
  }
  applyDensity(density());
  // Which top of the page the first paint gets: the Deja Vu1 banner on Overview, the slim page bar on
  // every other screen. A link such as #/printer wins over the remembered screen, as in rail.js.
  // pagebar.js keeps data-page right after this.
  function firstPage() {
    try {
      var link = /^#\/([a-z-]+)/.exec(location.hash || '');
      var start = localStorage.getItem('dejavu1.pref.start');
      var name = link ? link[1] : ((start && start !== 'last' ? start : localStorage.getItem('dejavu1.tab')) || 'overview');
      return name === 'overview' ? 'overview' : 'page';
    } catch (e) {
      return 'overview';
    }
  }
  document.documentElement.setAttribute('data-page', firstPage());
  // The SHELL frame (shell.css) styles everything under html.has-shell, so it is set before the first paint.
  document.documentElement.classList.add('has-shell');
  // The opening scene (intro.js) plays on a fresh start. While it is about to, a plain cover hides the page from the first paint so the app
  // never flashes before it; intro.js lifts the cover, and a timer lifts it anyway so a page can never be left covered.
  try {
    var nav = window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var fresh = !nav || nav.type === 'navigate';
    var off = localStorage.getItem('dejavu1.pref.intro') === 'off';
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var robot = navigator.webdriver && !/[?&]intro(\b|=)/.test(location.search);
    var skipped = /[?&]nointro(\b|=)/.test(location.search);
    if (fresh && !off && !still && !robot && !skipped) {
      document.documentElement.classList.add('intro-pending');
      setTimeout(function () { document.documentElement.classList.remove('intro-pending'); }, 5200);
    }
  } catch (e) { /* no cover: the app simply opens */ }
  // Your experience (Settings › Look & layout, and the setup's "Make it yours"): "new" keeps short hints for the first visits,
  // "know" (the default) shows none. shell-panes.css reads data-experience.
  var EXP_KEY = 'dejavu1.pref.experience';
  function experience() {
    try { return localStorage.getItem(EXP_KEY) === 'new' ? 'new' : 'know'; } catch (e) { return 'know'; }
  }
  document.documentElement.setAttribute('data-experience', experience());
  var media =window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'system' ? v : 'light';
    } catch (e) {
      return 'light';
    }
  }
  function apply(choice) {
    var dark = choice === 'dark' || (choice === 'system' && !!media && media.matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#10151d' : '#f0f1f5');
    try {
      window.dispatchEvent(new CustomEvent('dv-theme', { detail: { theme: dark ? 'dark' : 'light', pref: choice } }));
    } catch (e) { /* very old browser: the colours still change */ }
  }
  apply(pref());
  if (media && media.addEventListener) media.addEventListener('change', function () { if (pref() === 'system') apply('system'); });
  window.DVTheme = {
    looks: LOOKS.slice(),
    look: look,
    setLook: function (choice) {
      choice = LOOKS.indexOf(choice) >= 0 ? choice : DEFAULT_LOOK;
      try { localStorage.setItem(UI_KEY, choice); } catch (e) { /* private window: this visit only */ }
      applyLook(choice);
    },
    experience: experience,
    setExperience: function (choice) {
      choice = choice === 'new' ? 'new' : 'know';
      try { localStorage.setItem(EXP_KEY, choice); } catch (e) { /* private window: this visit only */ }
      document.documentElement.setAttribute('data-experience', choice);
      try { window.dispatchEvent(new CustomEvent('dv-experience', { detail: { experience: choice } })); } catch (e) { /* old browser */ }
    },
    densities: DENSITIES.slice(),
    density: density,
    setDensity: function (choice) {
      choice = DENSITIES.indexOf(choice) >= 0 ? choice : 'comfortable';
      try { localStorage.setItem(DENSITY_KEY, choice); } catch (e) { /* private window: this visit only */ }
      applyDensity(choice);
    },
    get: pref,
    current: function () { return document.documentElement.getAttribute('data-theme') || 'light'; },
    set: function (choice) {
      choice = choice === 'dark' || choice === 'system' ? choice : 'light';
      try { localStorage.setItem(KEY, choice); } catch (e) { /* private window: this visit only */ }
      apply(choice);
    }
  };
})();
