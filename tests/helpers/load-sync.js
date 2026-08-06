'use strict';

/* ============================================
   Teste helper — carrega js/storage.js + js/sync.js
   no Node com localStorage mock + crypto + fetch mock.
   ============================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const storageCode = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf-8');
const syncCode = fs.readFileSync(path.join(ROOT, 'js', 'sync.js'), 'utf-8');

function createLocalStorage() {
  const ls = {};
  Object.defineProperties(ls, {
    getItem: { value: (k) => Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null },
    setItem: { value: (k, v) => { ls[k] = String(v); } },
    removeItem: { value: (k) => { delete ls[k]; } },
    clear: { value: () => { Object.keys(ls).forEach(k => delete ls[k]); } },
    key: { value: (i) => Object.keys(ls)[i] ?? null },
    length: { get() { return Object.keys(ls).length; } },
  });
  return ls;
}

// Mock de fetch: roteia as chamadas RPC para um "servidor" em memória.
// space_save guarda o payload; space_get devolve conforme o espaço existe.
function createFetchMock(serverStore) {
  return async (url, opts = {}) => {
    const body = JSON.parse(opts.body || '{}');
    if (url.endsWith('/rest/v1/rpc/space_save')) {
      const { p_space_id, p_salt, p_iv, p_data_enc, p_item_count } = body;
      if (p_salt.length < 16 || p_iv.length < 12 || p_data_enc.length < 8) {
        return { ok: false, status: 400, json: async () => ({ ok: false, error: 'validação' }) };
      }
      serverStore[p_space_id] = {
        salt: p_salt, iv: p_iv, data_enc: p_data_enc, item_count: p_item_count,
        updated_at: new Date().toISOString(),
        version: (serverStore[p_space_id]?.version || 0) + 1,
      };
      return { ok: true, status: 200, json: async () => ({ ok: true, updated_at: serverStore[p_space_id].updated_at }) };
    }
    if (url.endsWith('/rest/v1/rpc/space_get')) {
      const rec = serverStore[body.p_space_id];
      if (!rec) return { ok: true, status: 200, json: async () => ({ ok: true, exists: false }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, exists: true, ...rec }) };
    }
    if (url.endsWith('/rest/v1/rpc/space_delete')) {
      const existed = Object.prototype.hasOwnProperty.call(serverStore, body.p_space_id);
      delete serverStore[body.p_space_id];
      return { ok: true, status: 200, json: async () => ({ ok: true, deleted: existed }) };
    }
    throw new Error(`fetch não mapeado: ${url}`);
  };
}

function createApp(serverStore = {}) {
  const localStorage = createLocalStorage();
  const sandbox = {
    localStorage,
    console,
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    fetch: createFetchMock(serverStore),
  };
  vm.createContext(sandbox);
  vm.runInContext(storageCode, sandbox, { filename: 'storage.js' });
  vm.runInContext(syncCode, sandbox, { filename: 'sync.js' });

  const DB = vm.runInContext('DB', sandbox);
  const Storage = vm.runInContext('Storage', sandbox);
  const Sync = vm.runInContext('Sync', sandbox);

  return {
    DB,
    Storage,
    Sync,
    localStorage,
    serverStore,
    reset() {
      localStorage.clear();
      DB.init();
    },
  };
}

module.exports = { createApp };
