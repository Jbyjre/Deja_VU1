/* theme-boot.js: Light / Dark / System, applied before the page is drawn.
 * Loaded in <head> on purpose (no defer), so a reload never flashes the
 * other theme. Preferences → Appearance → Theme saves the choice in this
 * browser only; "system" follows the computer's own setting and changes
 * with it. dark.css holds the dark colours; everything else reads
 * data-theme on <html>. Other scripts listen for "dv-theme" to redraw what
 * CSS can't reach (canvas and 3D labels).
 */
(function () {
  var KEY = 'dejavu1.pref.theme';
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
    get: pref,
    current: function () { return document.documentElement.getAttribute('data-theme') || 'light'; },
    set: function (choice) {
      choice = choice === 'dark' || choice === 'system' ? choice : 'light';
      try { localStorage.setItem(KEY, choice); } catch (e) { /* private window: this visit only */ }
      apply(choice);
    }
  };
})();
