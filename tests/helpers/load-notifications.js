'use strict';

/* ============================================
   Teste helper — carrega js/notifications.js no Node
   (funções puras: planNotifications, todayStr).
   ============================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const notificationsCode = fs.readFileSync(path.join(ROOT, 'js', 'notifications.js'), 'utf-8');

function loadReminders() {
  const sandbox = {
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    toLocaleString: undefined, // não usado no topo
  };
  vm.createContext(sandbox);
  vm.runInContext(notificationsCode, sandbox, { filename: 'notifications.js' });
  return vm.runInContext('Reminders', sandbox);
}

module.exports = { loadReminders };
