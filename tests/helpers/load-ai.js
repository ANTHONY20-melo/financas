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
  // VM realm mínimo: o módulo é puro (sem DOM), mas usa timers e AbortController
  // para o timeout do chat — precisa estar disponível no sandbox do teste.
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
  };
  vm.createContext(sandbox);
  vm.runInContext(aiCode, sandbox, { filename: 'ai.js' });
  return vm.runInContext('AI', sandbox);
}

module.exports = { loadAI };
