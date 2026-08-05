'use strict';

/* ============================================
   Testes do módulo Storage (wrapper localStorage)
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { Storage, localStorage, reset } = app;

beforeEach(() => reset());

test('Storage.get retorna defaultValue quando a chave não existe', () => {
  assert.equal(Storage.get('nao_existe', 'padrao'), 'padrao');
  assert.equal(Storage.get('nao_existe'), null);
});

test('Storage.set/get faz roundtrip com JSON', () => {
  const obj = { a: 1, b: [1, 2, 3], c: 'texto' };
  assert.equal(Storage.set('dados', obj), true);
  // JSON roundtrip: normaliza objetos vindos do realm do VM
  assert.deepEqual(JSON.parse(JSON.stringify(Storage.get('dados'))), obj);
});

test('Storage.remove remove a chave', () => {
  Storage.set('temp', 42);
  Storage.remove('temp');
  assert.equal(Storage.get('temp', 'sumiu'), 'sumiu');
});

test('Storage.clear limpa apenas chaves com prefixo financas_', () => {
  Storage.set('a', 1);
  localStorage.setItem('outra_chave', 'x');
  Storage.clear();
  assert.equal(Storage.get('a', null), null);
  assert.equal(localStorage.getItem('outra_chave'), 'x');
});
