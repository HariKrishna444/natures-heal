// Nature's Heal — Service Worker v3
// Strategy:
//   • Same-origin assets  → Cache-first (offline support)
//   • External CDN/API    → Network-only, SW does NOT intercept
//                           (SW fetch() runs under the page CSP, so fetching
//                            external CDNs from here triggers CSP violations)

const CACHE_NAME = 'naturesheal-v3';

// Same-origin assets to pre-cache on install
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon_192.png',
];

// External hostnames the SW must NOT intercept — browser handles them directly
const BYPASS_ORIGINS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'www.gstatic.com',
    'i.pravatar.cc',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'apis.google.com',
    'www.google.com',
    'accounts.google.com',
    'checkout.razorpay.com',
    'api.razorpay.com',
    'lumberjack.razorpay.com',
    'us-central1-naturesheal.cloudfunctions.net',
    'firebaseio.com',
    'firebaseapp.com',
    'firebasestorage.googleapis.com',
];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. Only handle GET
    if (event.request.method !== 'GET') return;

    // 2. Skip external origins — let the browser fetch them natively.
    //    This prevents the flood of CSP "Refused to connect" errors that
    //    happen when the SW tries to fetch CDN assets under the page's CSP.
    if (BYPASS_ORIGINS.some(origin => url.hostname.includes(origin))) return;

    // 3. Only cache same-origin requests
    if (url.origin !== self.location.origin) return;

    // 4. Cache-first for same-origin assets
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request)
                .then(response => {
                    // Only store valid basic (same-origin) responses
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Offline fallback — return cached index.html for page navigations
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                });
        })
    );
});