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
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
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
