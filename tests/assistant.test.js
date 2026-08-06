'use strict';

/* ============================================
   Testes do Assistente Financeiro
   (metas, insights, projeções, alertas de orçamento)
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// Helpers de data relativa ao mês atual (o app usa `new Date()` internamente,
// então os testes devem montar datas dinâmicas, não fixas).
function monthStr(offset) {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1 + offset).padStart(2, '0')}`;
}

function dayStr(monthOffset, day) {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1 + monthOffset).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addIncome(description, amount, monthOffset, day) {
  return DB.addTransaction({ description, amount, type: 'income', category: 'cat_salario', date: dayStr(monthOffset, day || 5) });
}

function addExpense(description, amount, category, monthOffset, day) {
  return DB.addTransaction({ description, amount, type: 'expense', category, date: dayStr(monthOffset, day || 10) });
}

// --- Goals CRUD ---

test('addGoal valida nome e valor-alvo positivo', () => {
  assert.equal(DB.addGoal({ name: '', target: 100 }).success, false);
  assert.equal(DB.addGoal({ name: 'Reserva', target: 0 }).success, false);
  assert.equal(DB.addGoal({ name: 'Reserva', target: -50 }).success, false);

  const ok = DB.addGoal({ name: 'Reserva', target: 1000, current: 100, icon: 'fa-solid fa-piggy-bank' });
  assert.equal(ok.success, true);
  assert.equal(ok.goal.current, 100);
  assert.ok(ok.goal.id.startsWith('goal_'));
});

test('updateGoal edita e addGoalContribution soma valores', () => {
  const created = DB.addGoal({ name: 'Viagem', target: 3000, current: 500 });
  const id = created.goal.id;

  const updated = DB.updateGoal(id, { name: 'Viagem Europa', target: 4000 });
  assert.equal(updated.success, true);
  assert.equal(updated.goal.name, 'Viagem Europa');
  assert.equal(updated.goal.target, 4000);

  const contrib = DB.addGoalContribution(id, 250);
  assert.equal(contrib.success, true);
  assert.equal(contrib.goal.current, 750);

  assert.equal(DB.addGoalContribution(id, 0).success, false);
  assert.equal(DB.addGoalContribution(id, -10).success, false);
  assert.equal(DB.addGoalContribution('nao_existe', 100).success, false);
});

test('deleteGoal remove meta', () => {
  const created = DB.addGoal({ name: 'Teste', target: 100 });
  assert.equal(DB.deleteGoal(created.goal.id).success, true);
  assert.equal(DB.getGoals().length, 0);
  assert.equal(DB.deleteGoal('nao_existe').success, false);
});

// --- Goal Progress ---

test('getGoalProgress calcula pct, remaining e isComplete', () => {
  DB.addGoal({ name: 'A', target: 1000, current: 250 });
  DB.addGoal({ name: 'B', target: 1000, current: 1200 }); // concluída

  const progress = DB.getGoalProgress(3);
  assert.equal(progress.length, 2);

  const a = progress.find(g => g.name === 'A');
  assert.equal(a.pct, 25);
  assert.equal(a.remaining, 750);
  assert.equal(a.isComplete, false);

  const b = progress.find(g => g.name === 'B');
  assert.equal(b.pct, 100);
  assert.equal(b.isComplete, true);
});

test('getGoalProgress projeta prazo de conclusão com economia média positiva', () => {
  // Meta de 3000, já guardou 1500 → faltam 1500
  DB.addGoal({ name: 'Meta', target: 3000, current: 1500 });

  // Mês atual com saldo positivo de 500 → economia média de 500/mês
  addIncome('Salário', 2000, 0);
  addExpense('Mercado', 1500, 'cat_alimentacao', 0);

  const [goal] = DB.getGoalProgress(3);
  assert.equal(goal.avgSavings, 500);
  assert.equal(goal.projectedMonths, 3); // 1500 / 500 = 3 meses
  assert.equal(goal.onTrack, null); // sem prazo definido → onTrack null
});

test('getGoalProgress respeita prazo (onTrack true/false)', () => {
  DB.addGoal({ name: 'Curta', target: 3000, current: 1500, deadline: '2026-09' });
  DB.addGoal({ name: 'Longa', target: 3000, current: 1500, deadline: '2027-12' });

  addIncome('Salário', 2000, 0);
  addExpense('Mercado', 1500, 'cat_alimentacao', 0);

  const progress = DB.getGoalProgress(3);
  const curta = progress.find(g => g.name === 'Curta');
  const longa = progress.find(g => g.name === 'Longa');
  assert.equal(curta.onTrack, false); // 3 meses > 1 mês restante
  assert.equal(longa.onTrack, true);  // 3 meses < 16 meses
});

test('getAverageSavings ignora meses sem saldo positivo', () => {
  addIncome('Salário', 2000, 0);
  addExpense('Mercado', 1500, 'cat_alimentacao', 0); // saldo +500

  addIncome('Salário', 2000, -1);
  addExpense('Mercado', 2500, 'cat_alimentacao', -1); // saldo -500 → 0

  addIncome('Salário', 2000, -2);
  addExpense('Mercado', 1000, 'cat_alimentacao', -2); // saldo +1000

  // A média conta apenas meses com saldo POSITIVO: (500 + 1000) / 2 = 750
  assert.equal(DB.getAverageSavings(3), 750);
});

// --- Insights ---

test('getInsights sem dados retorna lista vazia', () => {
  assert.equal(DB.getInsights().length, 0);
});

test('getInsights identifica maior gasto e economia do mês', () => {
  addIncome('Salário', 5000, 0);
  addExpense('Mercado', 1000, 'cat_alimentacao', 0);
  addExpense('Uber', 300, 'cat_transporte', 0);

  const insights = DB.getInsights();
  const top = insights.find(i => i.type === 'expense');
  assert.ok(top, 'deve ter insight de maior gasto');
  assert.equal(top.title.includes('Alimentação'), true);

  const saved = insights.find(i => i.type === 'success');
  assert.ok(saved, 'deve ter insight de economia (saldo positivo)');
  assert.equal(saved.title.includes('economizou'), true);
});

test('getInsights alerta mês no vermelho', () => {
  addIncome('Salário', 3000, 0);
  addExpense('Mercado', 1500, 'cat_alimentacao', 0);
  addExpense('Aluguel', 2000, 'cat_moradia', 0); // saldo -500

  const insights = DB.getInsights();
  const danger = insights.find(i => i.type === 'danger');
  assert.ok(danger, 'deve ter insight de perigo');
  assert.equal(danger.title.includes('vermelho'), true);
});

// --- Projection ---

test('getProjection calcula saldo atual e projeta com médias', () => {
  addIncome('Salário', 3000, 0);
  addExpense('Mercado', 1500, 'cat_alimentacao', 0); // mês atual: +1500
  addIncome('Salário', 3000, -1);
  addExpense('Mercado', 1500, 'cat_alimentacao', -1); // mês anterior: +1500

  const proj = DB.getProjection(6, 3);
  assert.equal(proj.currentBalance, 3000); // 1500 + 1500
  assert.equal(proj.monthsWithData, 2);    // 2 meses com dados
  assert.equal(proj.avgIncome, 3000);
  assert.equal(proj.avgExpense, 1500);
  assert.equal(proj.netMonthly, 1500);
  assert.equal(proj.projection.length, 6);
  assert.equal(proj.history.length, 3);

  // Projeção cresce 1500/mês a partir do saldo atual
  assert.equal(proj.projection[0].balance, 4500);
  assert.equal(proj.projection[5].balance, 12000);
});

test('getProjection sem dados retorna saldo zero e médias zero', () => {
  const proj = DB.getProjection(6, 3);
  assert.equal(proj.currentBalance, 0);
  assert.equal(proj.monthsWithData, 0);
  assert.equal(proj.netMonthly, 0);
  assert.equal(proj.projection.length, 6);
});

// --- Budget Alerts ---

test('getBudgetAlerts filtra apenas orçamentos em warning/danger', () => {
  const alimentacao = DB.getCategoriesByType('expense').find(c => c.name === 'Alimentação');
  const transporte = DB.getCategoriesByType('expense').find(c => c.name === 'Transporte');

  DB.addBudget({ categoryId: alimentacao.id, month: monthStr(0), amount: 200 });
  DB.addBudget({ categoryId: transporte.id, month: monthStr(0), amount: 500 });

  // Alimentação gasta 250/200 → danger; Transporte gasta 0/500 → normal
  addExpense('Mercado', 250, alimentacao.id, 0);

  const alerts = DB.getBudgetAlerts(monthStr(0));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, 'danger');
  assert.equal(alerts[0].categoryName, 'Alimentação');
  assert.ok(alerts[0].message.includes('estourou'));
  // O percentual na mensagem deve ser o REAL (125%), não capado em 100%
  assert.ok(alerts[0].message.includes('(125.0%)'), 'mensagem deve mostrar percentual real acima de 100%');
});

test('getBudgetAlerts retorna warning para orçamento acima de 80%', () => {
  const cat = DB.getCategoriesByType('expense').find(c => c.name === 'Lazer');
  DB.addBudget({ categoryId: cat.id, month: monthStr(0), amount: 100 });
  addExpense('Cinema', 85, cat.id, 0); // 85%

  const alerts = DB.getBudgetAlerts(monthStr(0));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, 'warning');
  assert.ok(alerts[0].message.includes('perto do limite'));
});

// --- Export inclui metas ---

test('exportAllData inclui metas no roundtrip', () => {
  DB.addGoal({ name: 'Reserva', target: 5000, current: 2000 });
  const exported = DB.exportAllData();
  assert.equal(exported.goals.length, 1);
  assert.equal(exported.version, '2.2');

  reset();
  const imported = DB.importAllData(exported);
  assert.equal(imported.success, true);
  assert.equal(DB.getGoals().length, 1);
  assert.equal(DB.getGoals()[0].name, 'Reserva');
});
