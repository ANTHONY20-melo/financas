'use strict';

/* ============================================
   Teste helper — carrega js/storage.js no Node
   com um localStorage mock (o arquivo usa localStorage,
   que não existe fora do navegador).
   ============================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STORAGE_FILE = path.join(__dirname, '..', '..', 'js', 'storage.js');
const storageCode = fs.readFileSync(STORAGE_FILE, 'utf-8');

function createApp() {
  // Mock fiel do localStorage do navegador: as chaves são propriedades
  // enumeráveis (Object.keys() retorna as chaves, como no Storage real).
  const ls = {};
  Object.defineProperties(ls, {
    getItem: { value: (k) => Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null },
    setItem: { value: (k, v) => { ls[k] = String(v); } },
    removeItem: { value: (k) => { delete ls[k]; } },
    clear: { value: () => { Object.keys(ls).forEach(k => delete ls[k]); } },
    key: { value: (i) => Object.keys(ls)[i] ?? null },
    length: { get() { return Object.keys(ls).length; } },
  });
  const localStorage = ls;

  const sandbox = { localStorage, console };
  vm.createContext(sandbox);
  vm.runInContext(storageCode, sandbox, { filename: 'storage.js' });

  // `const Storage`/`const DB` vivem no escopo léxico do contexto,
  // não no objeto sandbox — avaliar os identificadores dentro do contexto.
  const DB = vm.runInContext('DB', sandbox);
  const Storage = vm.runInContext('Storage', sandbox);

  return {
    DB,
    Storage,
    localStorage,
    reset() {
      localStorage.clear();
      DB.init();
    },
  };
}

module.exports = { createApp };
