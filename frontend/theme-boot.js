/* theme-boot.js: Light / Dark / System, applied before the page is drawn.
 * Loaded in <head> on purpose (no defer), so a reload never flashes the
 * other theme. Preferences → Appearance → Theme saves the choice in this
 * browser only; "system" follows the computer's own setting and changes
 * with it. dark.css holds the dark colours; everything else reads
 * data-theme on <html>. Other scripts listen for "dv-theme" to redraw what
 * CSS can't reach (canvas and 3D labels).
 *
 * The look (Preferences → Appearance → Look) is set here too, as data-ui:
 * "workbench" (the default: flat panels, hairlines, aligned numbers),
 * "control" (denser and squarer, grey, colour only for status) or "glass"
 * (frosted glass and the moving background). looks.css holds the first two;
 * "dv-ui" tells scripts it changed.
 */
(function () {
  var KEY = 'dejavu1.pref.theme';
  var UI_KEY = 'dejavu1.pref.ui';
  var LOOKS = ['workbench', 'control', 'glass'];
  function look() {
    try {
      var v = localStorage.getItem(UI_KEY);
      return LOOKS.indexOf(v) >= 0 ? v : 'workbench';
    } catch (e) {
      return 'workbench';
    }
  }
  function applyLook(choice) {
    document.documentElement.setAttribute('data-ui', choice);
    try { window.dispatchEvent(new CustomEvent('dv-ui', { detail: { ui: choice } })); } catch (e) { /* old browser */ }
  }
  applyLook(look());
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
      choice = LOOKS.indexOf(choice) >= 0 ? choice : 'workbench';
      try { localStorage.setItem(UI_KEY, choice); } catch (e) { /* private window: this visit only */ }
      applyLook(choice);
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
