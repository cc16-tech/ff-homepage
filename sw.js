/* ══════════════════════════════════════════════════════════════
   ff-homepage service worker

   Caches the page shell so the homepage opens with no signal.
   Everything the page actually stores — tasks, notes, streak,
   eggs, sand, reminders — already lives in IndexedDB, so an
   offline load is fully functional apart from live market data
   and weather, which the status panel reports honestly.

   Bump VERSION to force every client to re-fetch the shell.
   ══════════════════════════════════════════════════════════════ */

const VERSION = 'v7.0';
const SHELL   = 'ffhome-shell-' + VERSION;
const RUNTIME = 'ffhome-runtime-' + VERSION;

const SHELL_FILES = ['./', './index.html'];

// Live data must never be served stale from here. The page has its own
// IndexedDB cache for prices and knows how to say "cached" in the UI;
// a silently stale quote from the SW would be a lie it can't detect.
const NEVER_CACHE = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'api.coingecko.com',
  'api.allorigins.win',
  'corsproxy.io',
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'finance.yahoo.com',
  'www.coingecko.com',
];

// Fonts and favicons are immutable enough to serve cache-first.
const CACHE_FIRST = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.google.com',        // s2/favicons
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .catch(() => {})      // a failed precache must not block install
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function hostMatches(url, list) {
  try { return list.includes(new URL(url).hostname); }
  catch (_) { return false; }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Live endpoints: straight to the network, never cached, and a clean
  // failure so the page can fall back to its own IndexedDB copy.
  if (hostMatches(url, NEVER_CACHE)) {
    event.respondWith(
      fetch(req).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // Navigations: network-first so a redeploy lands immediately, with the
  // cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match('./index.html') || await caches.match('./');
        return cached || new Response('Offline and nothing cached yet.', {
          status: 503, headers: { 'Content-Type': 'text/plain' }
        });
      }
    })());
    return;
  }

  // Fonts and favicons: cache-first, refreshed in the background.
  if (hostMatches(url, CACHE_FIRST)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          caches.open(RUNTIME).then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || (await network) ||
             new Response('', { status: 504, statusText: 'Offline' });
    })());
    return;
  }

  // Anything else same-origin: network, falling back to whatever we hold.
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then(
      r => r || new Response('', { status: 504, statusText: 'Offline' })
    ))
  );
});
