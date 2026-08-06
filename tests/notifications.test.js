'use strict';

/* ============================================
   Testes — Lembretes de Vencimento (js/notifications.js)
   Lógica pura: planNotifications (despesas não pagas na janela).
   ============================================ */

const test = require('node:test');
const assert = require('node:assert');
const { loadReminders } = require('./helpers/load-notifications');

const Reminders = loadReminders();

const txn = (overrides) => Object.assign({
  id: 'txn_1',
  type: 'expense',
  description: 'Aluguel',
  amount: 1200,
  category: 'cat_1',
  date: '2026-08-10',
  paid: false,
}, overrides);

test('planNotifications: lista despesas não pagas na janela, ordenadas por data', () => {
  const list = Reminders.planNotifications([
    txn({ id: 'a', date: '2026-08-12' }),
    txn({ id: 'b', date: '2026-08-08' }),
    txn({ id: 'c', date: '2026-08-11' }),
  ], { from: '2026-08-06' });
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(list.map(r => r.id), ['b', 'c', 'a']); // ordenado por vencimento
  assert.strictEqual(list[0].date, '2026-08-08');
});

test('planNotifications: ignora pagas, receitas e vencimentos fora da janela', () => {
  const list = Reminders.planNotifications([
    txn({ id: 'paga', date: '2026-08-10', paid: true }),            // paga → fora
    txn({ id: 'receita', type: 'income', date: '2026-08-10' }),      // receita → fora
    txn({ id: 'passado', date: '2026-08-01' }),                      // antes de from → fora
    txn({ id: 'futuro', date: '2026-09-01' }),                       // depois da janela → fora
    txn({ id: 'na_janela', date: '2026-08-20' }),                    // dentro → entra
  ], { from: '2026-08-06', daysAhead: 14 });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'na_janela');
});

test('planNotifications: título e corpo corretos (hoje, amanhã, N dias)', () => {
  const list = Reminders.planNotifications([
    txn({ id: 'hoje', date: '2026-08-06' }),
    txn({ id: 'amanha', date: '2026-08-07' }),
    txn({ id: 'depois', date: '2026-08-20' }),
  ], { from: '2026-08-06', daysAhead: 14 });
  assert.strictEqual(list[0].title, 'Conta vence hoje');
  assert.strictEqual(list[1].title, 'Conta vence amanhã');
  assert.strictEqual(list[2].title, 'Conta vence em 14 dias');
  assert.match(list[0].body, /1\.200|1200/); // formato pt-BR
  assert.match(list[0].body, /Aluguel/);
});

test('planNotifications: tag única por transação+data e timestamp do vencimento', () => {
  const list = Reminders.planNotifications([txn({ id: 'x', date: '2026-08-06' })], { from: '2026-08-06' });
  assert.strictEqual(list[0].tag, 'financas-reminder-x-2026-08-06');
  // timestamp local de 2026-08-06 00:00 — verificamos apenas que é um número válido
  assert.strictEqual(typeof list[0].timestamp, 'number');
  assert.ok(list[0].timestamp > 0);
});

test('planNotifications: lista vazia quando não há pendências', () => {
  const list = Reminders.planNotifications([], { from: '2026-08-06' });
  assert.deepStrictEqual(list, []);
});

test('planNotifications: janela padrão usa hoje (14 dias)', () => {
  const list = Reminders.planNotifications([
    txn({ id: 'hoje_padrao', date: Reminders.todayStr() }),
  ]);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'hoje_padrao');
});

test('todayStr: formato YYYY-MM-DD (data local, nunca UTC)', () => {
  assert.match(Reminders.todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});
