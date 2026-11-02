/* Never cache printer readings, API replies, control requests or the app shell.
   Only a clearly offline explanation survives loss of the server. */
const OFFLINE_CACHE = 'dejavu-offline-v6';
self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's own cache, so an update always stores the new page.
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then(cache => cache.add(new Request('offline.html', { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('dejavu-offline-') && k !== OFFLINE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
const pause = ms => new Promise(done => setTimeout(done, ms));
// A refused connection comes back at once. Deja Vu1 restarting (an update, a crash it
// recovers from, the computer waking) is usually back within a few seconds, so the page
// is asked for again for about 4 seconds before the offline explanation is shown.
async function navigate(request) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fetch(request);
    } catch (_) {
      await pause(700);
    }
  }
  return (await caches.match('offline.html')) || Response.error();
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(navigate(event.request));
});
