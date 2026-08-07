'use strict';

/* ============================================
   Teste helper — carrega js/advisor.js no Node
   (módulo puro, não usa DOM nem localStorage).
   ============================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const advisorCode = fs.readFileSync(path.join(ROOT, 'js', 'advisor.js'), 'utf-8');

function loadAdvisor() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(advisorCode, sandbox, { filename: 'advisor.js' });
  return vm.runInContext('Advisor', sandbox);
}

module.exports = { loadAdvisor };
