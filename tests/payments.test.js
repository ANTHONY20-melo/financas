'use strict';

/* ============================================
   Testes da feature P5 — Status de Pagamento (Pago / Não Pago / A Pagar)
   - Campo `paid` por padrão (despesa a pagar, receita recebida)
   - Paid explícito em transação, parcela e recorrente
   - setTransactionPaid / isPaid
   - getUnpaidExpenses (ordem + daysOverdue)
   - getPendingSummary (total, count, overdue)
   - getUpcomingPayments (vencidas + próximos dias)
   - Filtro por status no getTransactionsByFilters
   - Sanitização/backup: preserva paid; ausente assume padrão
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// Helper: despesa comum
function addExpense(overrides = {}) {
  return DB.addTransaction({
    description: 'Conta de luz',
    amount: 150,
    type: 'expense',
    category: 'cat_contas',
    date: '2026-08-10',
    ...overrides,
  });
}

// --- Defaults do campo paid ---

test('P5: despesa nova nasce "a pagar" (paid=false)', () => {
  const res = addExpense();
  assert.equal(res.success, true);
  assert.equal(res.transaction.paid, false);
  assert.equal(DB.isPaid(res.transaction), false);
});

test('P5: receita nova nasce "recebida" (paid=true)', () => {
  const res = DB.addTransaction({
    description: 'Salário',
    amount: 5000,
    type: 'income',
    category: 'cat_salario',
    date: '2026-08-05',
  });
  assert.equal(res.success, true);
  assert.equal(res.transaction.paid, true);
  assert.equal(DB.isPaid(res.transaction), true);
});

test('P5: paid explícito é respeitado na criação', () => {
  const res = addExpense({ paid: true });
  assert.equal(res.transaction.paid, true);
  const res2 = addExpense({ description: 'Internet', paid: false });
  assert.equal(res2.transaction.paid, false);
});

test('P5: parcelas herdam paid (despesa parcelada nasce a pagar)', () => {
  const res = DB.addTransaction({
    description: 'Notebook',
    amount: 3600,
    type: 'expense',
    category: 'cat_compras',
    date: '2026-08-15',
    installments: 3,
  });
  assert.equal(res.success, true);
  res.transactions.forEach(t => assert.equal(t.paid, false));
});

test('P5: parcela pode ser criada já paga via paid explícito', () => {
  const res = DB.addTransaction({
    description: 'Notebook',
    amount: 3600,
    type: 'expense',
    category: 'cat_compras',
    date: '2026-08-15',
    installments: 2,
    paid: true,
  });
  res.transactions.forEach(t => assert.equal(t.paid, true));
});

test('P5: transação gerada de recorrente nasce a pagar (despesa)', () => {
  const rec = DB.addRecurring({
    description: 'Aluguel',
    amount: 1200,
    type: 'expense',
    category: 'cat_moradia',
    frequency: 'monthly',
    day: 5,
  });
  const gen = DB.generateRecurringTransaction(rec.recurring.id, '2026-08');
  assert.equal(gen.success, true);
  assert.equal(gen.transaction.paid, false);
});

// --- setTransactionPaid / isPaid ---

test('P5: setTransactionPaid alterna o status sem reescrever o resto', () => {
  const { transaction } = addExpense();
  const res = DB.setTransactionPaid(transaction.id, true);
  assert.equal(res.success, true);
  assert.equal(res.transaction.paid, true);
  assert.equal(DB.isPaid(DB.getTransactions()[0]), true);
  // Campos preservados
  assert.equal(DB.getTransactions()[0].description, 'Conta de luz');
});

test('P5: setTransactionPaid de id inexistente → erro', () => {
  const res = DB.setTransactionPaid('txn_nao_existe', true);
  assert.equal(res.success, false);
  assert.match(res.error, /não encontrada/);
});

test('P5: updateTransaction preserva paid quando não informado', () => {
  const { transaction } = addExpense();
  const res = DB.updateTransaction(transaction.id, {
    description: 'Conta de luz (editada)',
    amount: 160,
    type: 'expense',
    category: 'cat_contas',
    date: '2026-08-10',
  });
  assert.equal(res.success, true);
  assert.equal(res.transaction.paid, false); // preservou "a pagar"
});

test('P5: updateTransaction permite alterar paid explicitamente', () => {
  const { transaction } = addExpense();
  const res = DB.updateTransaction(transaction.id, {
    description: 'Conta de luz',
    amount: 150,
    type: 'expense',
    category: 'cat_contas',
    date: '2026-08-10',
    paid: true,
  });
  assert.equal(res.transaction.paid, true);
});

// --- getUnpaidExpenses / getPendingSummary ---

test('P5: getUnpaidExpenses retorna só despesas não pagas ordenadas por vencimento', () => {
  addExpense({ description: 'Mais velha', date: '2026-07-20' });
  addExpense({ description: 'Paga', date: '2026-06-01', paid: true });
  addExpense({ description: 'Futura', date: '2026-09-05' });
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: '2026-08-05' });

  const unpaid = DB.getUnpaidExpenses('2026-08-06');
  assert.equal(unpaid.length, 2);
  assert.equal(unpaid.map(t => t.description).join(','), 'Mais velha,Futura');
  // daysOverdue: 17 dias de atraso para 20/07 vs ref 06/08; futura = -30
  assert.equal(unpaid[0].daysOverdue, 17);
  assert.equal(unpaid[1].daysOverdue, -30);
});

test('P5: getPendingSummary soma total, count e atrasados', () => {
  addExpense({ description: 'Atrasada 1', date: '2026-07-20', amount: 100 });
  addExpense({ description: 'Atrasada 2', date: '2026-08-01', amount: 50 });
  addExpense({ description: 'A vencer', date: '2026-09-10', amount: 200 });
  addExpense({ description: 'Paga', date: '2026-07-01', amount: 999, paid: true });

  const summary = DB.getPendingSummary('2026-08-06');
  assert.equal(summary.count, 3);
  assert.equal(summary.total, 350);
  assert.equal(summary.overdueCount, 2);
  assert.equal(summary.overdueTotal, 150);
});

test('P5: getPendingSummary vazio sem pendências', () => {
  const summary = DB.getPendingSummary('2026-08-06');
  assert.equal(summary.count, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.overdueCount, 0);
});

// --- getUpcomingPayments ---

test('P5: getUpcomingPayments inclui vencidas + próximos N dias', () => {
  addExpense({ description: 'Vencida', date: '2026-08-01' });
  addExpense({ description: 'Vence em 3 dias', date: '2026-08-09' });
  addExpense({ description: 'Vence em 10 dias', date: '2026-08-16' });
  addExpense({ description: 'Paga', date: '2026-08-02', paid: true });

  const upcoming = DB.getUpcomingPayments(7, '2026-08-06');
  assert.equal(upcoming.length, 2); // vencida (01/08) + vence em 3 dias (09/08)
  assert.equal(upcoming.map(t => t.description).join(','), 'Vencida,Vence em 3 dias');
});

// --- Filtro por status ---

test('P5: getTransactionsByFilters filtra por status (unpaid/paid)', () => {
  addExpense({ description: 'A pagar', date: '2026-08-01' });
  addExpense({ description: 'Paga', date: '2026-08-02', paid: true });
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: '2026-08-05' });

  const unpaid = DB.getTransactionsByFilters({ paid: 'unpaid' });
  assert.equal(unpaid.length, 1);
  assert.equal(unpaid[0].description, 'A pagar');

  const paid = DB.getTransactionsByFilters({ paid: 'paid' });
  assert.equal(paid.length, 2); // despesa paga + receita (sempre paga)
  assert.equal(paid.map(t => t.description).sort().join(','), 'Paga,Salário');
});

test('P5: filtro sem status retorna tudo (all)', () => {
  addExpense();
  addExpense({ description: 'Paga', paid: true });
  assert.equal(DB.getTransactionsByFilters().length, 2);
});

// --- Export/Import (sanitização) ---

test('P5: export/import roundtrip preserva paid', () => {
  addExpense({ description: 'A pagar', date: '2026-08-01' });
  addExpense({ description: 'Paga', date: '2026-08-02', paid: true });

  const backup = DB.exportAllData();
  assert.equal(backup.version, '2.2');

  reset();
  const res = DB.importAllData(backup);
  assert.equal(res.success, true);
  const txs = DB.getTransactions();
  assert.equal(txs.length, 2);
  const byDesc = Object.fromEntries(txs.map(t => [t.description, t]));
  assert.equal(byDesc['A pagar'].paid, false);
  assert.equal(byDesc['Paga'].paid, true);
});

test('P5: import de backup sem campo paid assume padrão (despesa a pagar, receita recebida)', () => {
  const legacy = {
    version: '2.2',
    transactions: [
      { id: 'txn_1', description: 'Antiga', amount: 100, type: 'expense', category: 'cat_contas', date: '2026-01-01' },
      { id: 'txn_2', description: 'Receita antiga', amount: 50, type: 'income', category: 'cat_salario', date: '2026-01-02' },
    ],
  };
  const res = DB.importAllData(legacy);
  assert.equal(res.success, true);
  const txs = DB.getTransactions();
  assert.equal(txs.find(t => t.type === 'expense').paid, false);
  assert.equal(txs.find(t => t.type === 'income').paid, true);
});

// --- Insight de contas a pagar ---

test('P5: getInsights inclui alerta de contas a pagar', () => {
  addExpense({ description: 'Atrasada', date: '2026-07-20' });
  const insights = DB.getInsights(2026, 8);
  const pending = insights.find(i => i.title === 'Contas a pagar');
  assert.ok(pending, 'deveria existir insight de contas a pagar');
  assert.equal(pending.type, 'danger'); // tem atrasada
  assert.match(pending.text, /atrasada/);
});

test('P5: sem pendências, getInsights não cria alerta de contas a pagar', () => {
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: '2026-08-05' });
  const insights = DB.getInsights(2026, 8);
  assert.equal(insights.some(i => i.title === 'Contas a pagar'), false);
});
