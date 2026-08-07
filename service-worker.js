/* ============================================
   FINANÇAS PESSOAIS - Service Worker (PWA)
   Cache offline completo + atualização em segundo plano
   ============================================ */
'use strict';

const CACHE = 'financas-cache-v5';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/sync.js',
  './js/notifications.js',
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

/* ============================================
   LEMBRETES DE VENCIMENTO
   Notificações agendadas (100% locais). O app envia a lista via
   message → gravamos no IndexedDB e agendamos com TimestampTrigger.
   ============================================ */

const REMINDERS_DB = 'financas-reminders';
const REMINDERS_STORE = 'reminders';

function openRemindersDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REMINDERS_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(REMINDERS_STORE, { keyPath: 'tag' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function remindersTx(mode, fn) {
  return openRemindersDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(REMINDERS_STORE, mode);
        const store = tx.objectStore(REMINDERS_STORE);
        let out;
        try {
          out = fn(store);
        } catch (err) {
          tx.abort();
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(out && out.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

function clearReminders() {
  return remindersTx('readwrite', (store) => store.clear());
}

function scheduleReminder(r) {
  // Só agenda com TimestampTrigger se o browser suportar (Chrome/Edge).
  // Sem suporte (Safari/iPhone) → fallback in-app, nada aqui.
  if (!('showTrigger' in Notification.prototype)) return;
  if (!r || !r.tag || !r.timestamp) return;
  // Timestamp no passado (ex.: conta vence hoje e o app abriu depois das 9h)
  // é DESCARTADO pelo Chrome (nunca dispara). Fallback: dispara em segundos,
  // o usuário acabou de abrir/ativar e vê o aviso imediatamente.
  const when = r.timestamp <= Date.now() ? Date.now() + 5000 : r.timestamp;
  return self.registration.showNotification(r.title, {
    body: r.body,
    tag: r.tag,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { date: r.date, id: r.id },
    showTrigger: new TimestampTrigger(when),
  });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};

  // Substitui TODAS as agendadas pela nova lista (tags únicas por txn+data
  // fazem o navegador substituir pendentes da mesma tag → sem duplicatas).
  if (data.type === 'schedule-reminders' && Array.isArray(data.reminders)) {
    event.waitUntil(
      clearReminders()
        .then(() => Promise.all(data.reminders.map(scheduleReminder)))
        .then(() => {
          if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
        })
        .catch(() => {
          if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: false });
        })
    );
    return;
  }

  if (data.type === 'cancel-reminders') {
    event.waitUntil(
      clearReminders()
        .then(() => {
          if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
        })
        .catch(() => {
          if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: false });
        })
    );
    return;
  }
});

// Clique na notificação → foca o app na página Nuvem (ou abre).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          return;
        }
      }
      return clients.openWindow('./index.html#nuvem');
    })
  );
});
