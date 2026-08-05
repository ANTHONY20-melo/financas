/* ============================================
   FINANÇAS PESSOAIS - Service Worker (PWA)
   Cache offline completo + atualização em segundo plano
   ============================================ */
'use strict';

const CACHE = 'financas-cache-v2';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/app.js',
  './vendor/chart.umd.min.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2',
  './vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
  './vendor/fonts/inter-latin-300-normal.woff2',
  './vendor/fonts/inter-latin-400-normal.woff2',
  './vendor/fonts/inter-latin-500-normal.woff2',
  './vendor/fonts/inter-latin-600-normal.woff2',
  './vendor/fonts/inter-latin-700-normal.woff2',
  './vendor/fonts/inter-latin-800-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// --- Instalação: pré-cache de todos os assets (app 100% offline) ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// --- Ativação: limpa caches antigos e assume controle imediatamente ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- Fetch ---
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navegações: network-first (sempre entrega versão nova quando online,
  // cai para o cache quando offline — o app funciona no modo avião).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Demais assets: stale-while-revalidate (entrega do cache na hora e
  // atualiza em segundo plano — rápido e sempre fresco).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
