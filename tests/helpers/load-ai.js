'use strict';

/* ============================================
   Teste helper — carrega js/ai.js no Node
   (módulo puro: não usa DOM nem localStorage; o fetch é injetado).
   ============================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const aiCode = fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf-8');

function loadAI() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(aiCode, sandbox, { filename: 'ai.js' });
  return vm.runInContext('AI', sandbox);
}

module.exports = { loadAI };
