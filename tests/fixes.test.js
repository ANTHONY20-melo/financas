'use strict';

/* ============================================
   Testes das correções v4.1 (A1, A2, P1)
   - A1: import seguro valida schema (zero trust)
   - A2: filtro de mês combina ano+mês
   - P1: categorização automática por histórico
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// --- A1: Import seguro ---

test('A1: importAllData rejeita backup sem version', () => {
  const res = DB.importAllData({ transactions: [] });
  assert.equal(res.success, false);
  assert.ok(res.error, 'deve retornar erro');
});

test('A1: importAllData ignora item de transação malformado (mantém os válidos)', () => {
  const backup = {
    version: '2.0',
    transactions: [
      { id: 'ok1', description: 'Válida', amount: 10, type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' },
      { id: 'bad1', description: 'Sem valor', amount: 'abc', type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' },
      { id: 'bad2', description: 'Sem tipo', amount: 20, type: 'lixo', category: 'cat_outros_desp', date: '2026-08-01' },
      { id: 'bad3', description: 'Data inválida', amount: 20, type: 'expense', category: 'cat_outros_desp', date: 'ontem' },
      null,
    ],
  };

  const res = DB.importAllData(backup);
  assert.equal(res.success, true);
  assert.equal(res.ignored, 4, 'deve reportar 4 itens ignorados (3 malformados + null)');
  const txs = DB.getTransactions();
  assert.equal(txs.length, 1, 'só a transação válida deve ser importada');
  assert.equal(txs[0].id, 'ok1');
});

test('A1: importAllData falha quando a coleção inteira é inválida (não apaga dados)', () => {
  DB.addTransaction({ description: 'Existente', amount: 50, type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' });

  const backup = {
    version: '2.0',
    transactions: [
      { id: 'bad', description: 'X', amount: 0, type: 'expense', category: 'cat_outros_desp', date: '2026-08-01' },
    ],
  };

  const res = DB.importAllData(backup);
  assert.equal(res.success, false);
  assert.match(res.error, /transactions/i, 'erro deve citar a coleção problemática');
  assert.equal(DB.getTransactions().length, 1, 'dados existentes preservados');
});

test('A1: importAllData sanitiza categorias, orçamentos e metas', () => {
  const backup = {
    version: '2.0',
    categories: [
      { id: 'c1', name: 'Nova Cat', type: 'expense', icon: 'fa-solid fa-star' },
      { id: 'c2', name: 'Sem tipo', type: 'weird' },
    ],
    budgets: [
      { id: 'b1', categoryId: 'c1', month: '2026-08', amount: 100 },
      { id: 'b2', categoryId: 'c1', month: '2026-08', amount: -5 },
    ],
    goals: [
      { id: 'g1', name: 'Meta boa', target: 1000, current: 100, deadline: '2026-12', icon: 'fa-solid fa-piggy-bank' },
      { id: 'g2', name: 'Meta ruim', target: 0, current: 0 },
    ],
  };

  const res = DB.importAllData(backup);
  assert.equal(res.success, true);
  assert.equal(res.ignored, 3, '1 categoria + 1 orçamento + 1 meta inválidos');

  const cats = DB.getCategories().filter(c => c.id === 'c1' || c.id === 'c2');
  assert.equal(cats.length, 1, 'categoria válida importada');
  assert.equal(cats[0].icon, 'fa-solid fa-star', 'ícone válido preservado');

  const budgets = DB.getBudgets().filter(b => b.id === 'b1' || b.id === 'b2');
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].amount, 100);

  const goals = DB.getGoals().filter(g => g.id === 'g1' || g.id === 'g2');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].target, 1000);
});

test('A1: importAllData normaliza types string para number', () => {
  const backup = {
    version: '2.0',
    transactions: [
      { id: 't1', description: 'Salário', amount: '3500.50', type: 'income', category: 'cat_salario', date: '2026-08-01' },
    ],
  };
  const res = DB.importAllData(backup);
  assert.equal(res.success, true);
  assert.equal(DB.getTransactions()[0].amount, 3500.5);
});

// --- A2: Filtro de mês com ano ---

test('A2: filtro por mês completo (YYYY-MM) não mistura anos', () => {
  DB.addTransaction({ description: 'Mar 2025', amount: 10, type: 'expense', category: 'cat_outros_desp', date: '2025-03-15' });
  DB.addTransaction({ description: 'Mar 2026', amount: 20, type: 'expense', category: 'cat_outros_desp', date: '2026-03-15' });

  const mar26 = DB.getTransactionsByFilters({ month: '2026-03' });
  assert.equal(mar26.length, 1);
  assert.equal(mar26[0].description, 'Mar 2026');

  const mar25 = DB.getTransactionsByFilters({ month: '2025-03' });
  assert.equal(mar25.length, 1);
  assert.equal(mar25[0].description, 'Mar 2025');
});

test('A2: filtro legado por mês + year explícito respeita o ano', () => {
  DB.addTransaction({ description: 'Ago 2025', amount: 10, type: 'expense', category: 'cat_outros_desp', date: '2025-08-15' });
  DB.addTransaction({ description: 'Ago 2026', amount: 20, type: 'expense', category: 'cat_outros_desp', date: '2026-08-15' });

  const ago25 = DB.getTransactionsByFilters({ month: '8', year: 2025 });
  assert.equal(ago25.length, 1);
  assert.equal(ago25[0].description, 'Ago 2025');
});

// --- P1: Categorização automática ---

test('P1: suggestCategory retorna null sem histórico', () => {
  assert.equal(DB.suggestCategory('iFood', 'expense'), null);
});

test('P1: suggestCategory acerta categoria por descrição idêntica', () => {
  DB.addTransaction({ description: 'iFood', amount: 30, type: 'expense', category: 'cat_alimentacao', date: '2026-08-01' });
  DB.addTransaction({ description: 'iFood', amount: 40, type: 'expense', category: 'cat_alimentacao', date: '2026-08-02' });

  const sug = DB.suggestCategory('  ifood  ', 'expense');
  assert.ok(sug, 'deve encontrar sugestão');
  assert.equal(sug.categoryId, 'cat_alimentacao');
});

test('P1: suggestCategory ignora acentos/caixa na descrição', () => {
  DB.addTransaction({ description: 'Mercado', amount: 100, type: 'expense', category: 'cat_alimentacao', date: '2026-08-01' });
  DB.addTransaction({ description: 'Mercado', amount: 90, type: 'expense', category: 'cat_alimentacao', date: '2026-08-02' });

  const sug = DB.suggestCategory('mercado', 'expense');
  assert.equal(sug.categoryId, 'cat_alimentacao');
});

test('P1: suggestCategory usa palavra-chave quando descrição é nova', () => {
  DB.addTransaction({ description: 'Uber para o aeroporto', amount: 25, type: 'expense', category: 'cat_transporte', date: '2026-08-01' });
  DB.addTransaction({ description: '99 para casa', amount: 15, type: 'expense', category: 'cat_transporte', date: '2026-08-02' });

  const sug = DB.suggestCategory('Uber do centro', 'expense');
  assert.equal(sug.categoryId, 'cat_transporte', 'palavra "uber" deve sugerir transporte');
});

test('P1: suggestCategory respeita o tipo (não sugere categoria de receita p/ despesa)', () => {
  DB.addTransaction({ description: 'Salário', amount: 3000, type: 'income', category: 'cat_salario', date: '2026-08-01' });

  const sugExpense = DB.suggestCategory('Salário', 'expense');
  assert.equal(sugExpense, null, 'não deve sugerir categoria de receita para despesa');

  const sugIncome = DB.suggestCategory('Salário', 'income');
  assert.equal(sugIncome.categoryId, 'cat_salario');
});

test('P1: categorias padrão do init existem e são usáveis', () => {
  const cats = DB.getCategories();
  assert.ok(cats.some(c => c.id === 'cat_alimentacao'), 'categoria alimentação padrão existe');
  assert.ok(cats.some(c => c.id === 'cat_transporte'), 'categoria transporte padrão existe');
});
