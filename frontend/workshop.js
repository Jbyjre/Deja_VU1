/* Deja Vu1 - live connection, fleet, files, automations and Liquid Glass 2.0.
 *
 * Loaded after app.js and viewer3d.js, and uses app.js's helpers ($, esc,
 * api, getJSON, postJSON, runCommand, toast, render* functions). Plain
 * JavaScript, nothing to install, nothing fetched from anywhere but this
 * dashboard's own server.
 *
 * Contents
 *   1. small helpers + easing (the Block World movement pattern)
 *   2. the live connection: WebSocket, with a 1 s polling fallback
 *   3. printer selection, fleet overview, the printer chip
 *   4. overview: digital twin, print health gauge, chamber climate
 *   5. the live print pill (follows you across tabs)
 *   6. files: library, 3D + G-code viewer, edits, convert, compare
 *   7. Confirm Print gate and the print queue
 *   8. automations
 *   9. maintenance swap, filament forecast, side-by-side, camera,
 *      time-lapse, demo tools, handoff
 *  10. phone layout: bottom nav, quick actions, hold-to-cancel
 *  11. Liquid Glass 2.0: morphing, depth, tint, ambient motion
 */
'use strict';

const Workshop = (() => {
  /* The rest of this closure lives in workshop-part1.js, workshop-part2.js, workshop-part3.js, workshop-part4.js, workshop-part5.js (loaded before this file). */
  const { fmtHours, isLive, live, printerName, tween, twinFeed, twinFx } = WorkshopPart1;
  const { flipbookVideo, loadCamera, morph, stopCamera } = WorkshopPart3;
  const { applyState, loadFiles, loadQueue, openConfirm, openDialog, openDiff, openFile, refreshPrinter } = WorkshopPart4;
  const { closeDialog, init, nudgeLive, onTab, reconnect, refresh, selectPrinter, watchLive } = WorkshopPart5;
document.addEventListener('visibilitychange', nudgeLive);
window.addEventListener('online', nudgeLive);
setInterval(watchLive, 10000);
window.addEventListener('pageshow', e => { if (e.persisted) nudgeLive(); });
setInterval(() => {
    if (!isLive()) return;
    const age = (performance.now() - live.lastAt) / 1000;
    const how = live.mode === 'ws' ? 'Live' : tourOn() ? 'Recording' : 'Polling 1 s';
    $('rb-live-text').textContent = live.lastAt ? `${how} · ${age < 1 ? age.toFixed(1) : Math.round(age)} s` : how;
    $('rb-live').classList.toggle('is-stale', age > 3);
  }, 250);
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-att-printer]');
    if (!btn) return;
    const id = btn.dataset.attPrinter, tab = btn.dataset.attTab;
    if (id !== (currentPrinter || (live.fleet[0] && live.fleet[0].id))) selectPrinter(id, null, true);
    showTab(tab);
  });

  /* ================================================================
   * 5. the live print pill
   * ================================================================ */

  /* The status ribbon at the top of the page already carries the print's
   * progress, so the floating pill only appears once the ribbon has been
   * scrolled out of view - otherwise the two say the same thing and the
   * pill sits on top of whatever is in the bottom-right corner. */
if ('IntersectionObserver' in window && $('printer-chip')) {
    new IntersectionObserver(([entry]) => document.body.classList.toggle('ribbon-in-view', entry.isIntersecting))
      .observe($('printer-chip'));
  }
  // The full camera (Printer → Camera & time-lapses) runs only while its part is open.
window.addEventListener('dv-section', e => {
    if (e.detail.tab !== 'control') return;
    if (e.detail.key === 'camera' || e.detail.key === 'all') loadCamera(); else stopCamera();
  });

return { init, refresh, applyState, refreshPrinter, reconnect, onTab, isLive, selectPrinter, morph, twinFeed, twinFx,
           openFile, openConfirm, openDiff, loadQueue, loadFiles, printerName, fmtHours, openDialog, closeDialog, tween,
           flipbookVideo };
})();

window.Workshop = Workshop;
Workshop.init();
