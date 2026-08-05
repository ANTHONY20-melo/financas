'use strict';

/* ============================================
   Testes do módulo DB (CRUD, agregações, export/import)
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// --- Init ---

test('init() cria categorias padrão de receita e despesa', () => {
  const cats = DB.getCategories();
  assert.ok(cats.length > 0, 'deve existir categorias padrão');
  assert.ok(DB.getCategoriesByType('income').length > 0, 'deve ter categorias de receita');
  assert.ok(DB.getCategoriesByType('expense').length > 0, 'deve ter categorias de despesa');
  cats.forEach(c => {
    assert.ok(c.id, 'categoria deve ter id');
    assert.ok(c.name, 'categoria deve ter nome');
    assert.ok(c.type, 'categoria deve ter tipo');
    assert.ok(c.icon, 'categoria deve ter ícone');
  });
});

// --- Transações: validação e criação ---

test('addTransaction valida campos obrigatórios', () => {
  const res = DB.addTransaction({ description: '', amount: 0, category: '', date: '' });
  assert.equal(res.success, false);
  assert.ok(res.error, 'deve retornar mensagem de erro');
});

test('addTransaction rejeita valor zero/negativo', () => {
  const base = { description: 'X', type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' };
  assert.equal(DB.addTransaction({ ...base, amount: 0 }).success, false);
  assert.equal(DB.addTransaction({ ...base, amount: -5 }).success, false);
});

test('addTransaction faz trim e converte amount em string para número', () => {
  const res = DB.addTransaction({
    description: '  Salário  ', amount: '3500.50', type: 'income', category: 'cat_salario', date: '2026-08-01',
  });
  assert.equal(res.success, true);
  assert.equal(res.transaction.description, 'Salário');
  assert.equal(res.transaction.amount, 3500.5);
  assert.ok(res.transaction.id.startsWith('txn_'));
});

// --- Transações: filtros ---

test('getTransactionsByFilters filtra por tipo', () => {
  DB.addTransaction({ description: 'Salário', amount: 3500, type: 'income', category: 'cat_salario', date: '2026-08-01' });
  DB.addTransaction({ description: 'Mercado', amount: 300, type: 'expense', category: 'cat_alimentacao', date: '2026-08-02' });

  const expenses = DB.getTransactionsByFilters({ type: 'expense' });
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].description, 'Mercado');
});

test('getTransactionsByFilters busca por descrição, notas e categoria', () => {
  DB.addTransaction({ description: 'Uber', amount: 25, type: 'expense', category: 'cat_transporte', date: '2026-08-01', notes: 'corrida do aeroporto' });
  DB.addTransaction({ description: 'Restaurante', amount: 90, type: 'expense', category: 'cat_alimentacao', date: '2026-08-02' });

  assert.equal(DB.getTransactionsByFilters({ search: 'uber' }).length, 1);
  assert.equal(DB.getTransactionsByFilters({ search: 'aeroporto' }).length, 1);
  assert.equal(DB.getTransactionsByFilters({ search: 'alimentação' }).length, 1);
  assert.equal(DB.getTransactionsByFilters({ search: 'inexistente' }).length, 0);
});

test('getTransactionsByFilters filtra por mês e ordena por data desc', () => {
  DB.addTransaction({ description: 'A', amount: 10, type: 'expense', category: 'cat_outros_desp', date: '2026-07-15' });
  DB.addTransaction({ description: 'B', amount: 20, type: 'expense', category: 'cat_outros_desp', date: '2026-08-10' });
  DB.addTransaction({ description: 'C', amount: 30, type: 'expense', category: 'cat_outros_desp', date: '2026-08-20' });

  const august = DB.getTransactionsByFilters({ month: 8 });
  assert.equal(august.length, 2);
  assert.equal(august[0].description, 'C');
  assert.equal(august[1].description, 'B');
});

// --- Transações: update/delete ---

test('updateTransaction edita e mantém campos não informados', () => {
  const created = DB.addTransaction({ description: 'Aluguel', amount: 1500, type: 'expense', category: 'cat_moradia', date: '2026-08-05' });
  const res = DB.updateTransaction(created.transaction.id, {
    description: 'Aluguel (atualizado)', amount: 1600, type: 'expense', category: 'cat_moradia', date: '2026-08-05', notes: 'novo valor',
  });
  assert.equal(res.success, true);
  const t = DB.getTransactions()[0];
  assert.equal(t.description, 'Aluguel (atualizado)');
  assert.equal(t.amount, 1600);
  assert.equal(t.notes, 'novo valor');
});

test('deleteTransaction remove e reporta erro quando não existe', () => {
  const created = DB.addTransaction({ description: 'X', amount: 10, type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' });
  assert.equal(DB.deleteTransaction(created.transaction.id).success, true);
  assert.equal(DB.getTransactions().length, 0);
  assert.equal(DB.deleteTransaction('nao_existe').success, false);
});

// --- Agregações ---

test('getMonthlySummary calcula income, expense, balance e savingsRate', () => {
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: '2026-08-05' });
  DB.addTransaction({ description: 'Mercado', amount: 1000, type: 'expense', category: 'cat_alimentacao', date: '2026-08-10' });

  const summary = DB.getMonthlySummary(2026, 8);
  assert.equal(summary.income, 5000);
  assert.equal(summary.expense, 1000);
  assert.equal(summary.balance, 4000);
  assert.equal(summary.savingsRate, 80);
});

test('getMonthlySummary retorna zero para mês sem dados', () => {
  const summary = DB.getMonthlySummary(2020, 1);
  assert.equal(summary.income, 0);
  assert.equal(summary.expense, 0);
  assert.equal(summary.balance, 0);
});

test('getMonthlyHistory retorna N meses consecutivos', () => {
  const history = DB.getMonthlyHistory(6);
  assert.equal(history.length, 6);
  history.forEach(h => {
    assert.ok(h.month, 'deve ter mês');
    assert.ok(h.label, 'deve ter label');
    assert.equal(typeof h.income, 'number');
    assert.equal(typeof h.expense, 'number');
  });
  // Meses consecutivos, do mais antigo para o atual: 2026-03 ... 2026-08
  assert.equal(history[0].month, '2026-03');
  assert.equal(history[history.length - 1].month, '2026-08');
});

test('getCategoryExpenses agrupa por categoria, ordena desc e soma totais', () => {
  DB.addTransaction({ description: 'Mercado', amount: 300, type: 'expense', category: 'cat_alimentacao', date: '2026-08-01' });
  DB.addTransaction({ description: 'Uber', amount: 50, type: 'expense', category: 'cat_transporte', date: '2026-08-02' });
  DB.addTransaction({ description: 'iFood', amount: 150, type: 'expense', category: 'cat_alimentacao', date: '2026-08-03' });

  const byCat = DB.getCategoryExpenses(2026, 8);
  assert.equal(byCat.length, 2);
  assert.equal(byCat[0].name, 'Alimentação');
  assert.equal(byCat[0].total, 450);
  assert.equal(byCat[1].total, 50);
});

// --- Categorias ---

test('categorias: cria, valida duplicado (case-insensitive), atualiza e exclui', () => {
  const created = DB.addCategory({ name: 'Pets', type: 'expense', icon: 'fa-solid fa-paw' });
  assert.equal(created.success, true);

  const dup = DB.addCategory({ name: 'pets', type: 'expense', icon: 'fa-solid fa-paw' });
  assert.equal(dup.success, false);

  const updated = DB.updateCategory(created.category.id, { name: 'Pet Shop', type: 'expense', icon: 'fa-solid fa-paw' });
  assert.equal(updated.success, true);
  assert.equal(DB.getCategory(created.category.id).name, 'Pet Shop');

  assert.equal(DB.deleteCategory(created.category.id).success, true);
  assert.equal(DB.getCategory(created.category.id), null);
});

test('deleteCategory bloqueia exclusão de categoria em uso', () => {
  const cat = DB.getCategoriesByType('expense')[0];
  DB.addTransaction({ description: 'X', amount: 10, type: 'expense', category: cat.id, date: '2026-08-01' });
  const res = DB.deleteCategory(cat.id);
  assert.equal(res.success, false);
});

// --- Orçamentos ---

test('orçamentos: cria, valida duplicado no mês e calcula progresso', () => {
  const cat = DB.getCategoriesByType('expense').find(c => c.name === 'Alimentação');
  const created = DB.addBudget({ categoryId: cat.id, month: '2026-08', amount: 200 });
  assert.equal(created.success, true);

  const dup = DB.addBudget({ categoryId: cat.id, month: '2026-08', amount: 300 });
  assert.equal(dup.success, false);

  DB.addTransaction({ description: 'Mercado', amount: 160, type: 'expense', category: cat.id, date: '2026-08-10' });
  const progress = DB.getBudgetProgress('2026-08');
  assert.equal(progress.length, 1);
  assert.equal(progress[0].spent, 160);
  assert.equal(progress[0].remaining, 40);
  assert.equal(progress[0].status, 'warning'); // 80% >= 80 → warning
  assert.equal(progress[0].percentage, 80);

  DB.addTransaction({ description: 'iFood', amount: 60, type: 'expense', category: cat.id, date: '2026-08-11' });
  const progress2 = DB.getBudgetProgress('2026-08');
  assert.equal(progress2[0].status, 'danger');
});

test('orçamento pode ser atualizado e excluído', () => {
  const cat = DB.getCategoriesByType('expense')[0];
  const created = DB.addBudget({ categoryId: cat.id, month: '2026-08', amount: 100 });
  const updated = DB.updateBudget(created.budget.id, { categoryId: cat.id, month: '2026-08', amount: 500 });
  assert.equal(updated.success, true);
  assert.equal(DB.getBudgets()[0].amount, 500);
  assert.equal(DB.deleteBudget(created.budget.id).success, true);
  assert.equal(DB.getBudgets().length, 0);
});

// --- Export / Import ---

test('exportAllData/importAllData faz roundtrip preservando dados', () => {
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: '2026-08-05' });
  const exported = DB.exportAllData();
  assert.equal(exported.version, '2.0');
  assert.equal(exported.transactions.length, 1);

  reset(); // limpa tudo e re-inicializa (categorias padrão voltam)
  const imported = DB.importAllData(exported);
  assert.equal(imported.success, true);
  assert.equal(DB.getTransactions().length, 1);
  assert.equal(DB.getTransactions()[0].description, 'Salário');
});

test('importAllData rejeita arquivo inválido', () => {
  const res = DB.importAllData({ foo: 'bar' });
  assert.equal(res.success, false);
});

test('exportToCSV gera BOM, cabeçalho e escapa aspas', () => {
  DB.addTransaction({
    description: 'Feira "orgânica"', amount: 100, type: 'expense',
    category: 'cat_alimentacao', date: '2026-08-01', notes: 'com "aspas"',
  });

  const csv = DB.exportToCSV(DB.getTransactions());
  assert.ok(csv.startsWith('\uFEFF'), 'deve começar com BOM para Excel');
  assert.ok(csv.includes('Data,Descrição,Categoria,Tipo,Valor,Observações'));
  assert.ok(csv.includes('"Feira ""orgânica"""'));
  assert.ok(csv.includes('"com ""aspas"""'));
});
