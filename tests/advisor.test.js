'use strict';

/* ============================================
   TESTES — JARVIS Conselheiro Financeiro (js/advisor.js)
   Motor puro de análise: saúde, cortes, plano salário, sair do vermelho.
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAdvisor } = require('./helpers/load-advisor');

const Advisor = loadAdvisor();

// Fixtures determinísticas
const CATEGORIES = [
  { id: 'cat_salario', name: 'Salário', type: 'income' },
  { id: 'cat_alimentacao', name: 'Alimentação', type: 'expense' },
  { id: 'cat_moradia', name: 'Moradia', type: 'expense' },
  { id: 'cat_transporte', name: 'Transporte', type: 'expense' },
  { id: 'cat_lazer', name: 'Lazer', type: 'expense' },
  { id: 'cat_assina', name: 'Assinaturas', type: 'expense' },
];

function tx(type, category, amount, date, extra = {}) {
  // Despesas nascem PAGAS por padrão (como histórico real); pendências
  // só quando o teste passa paid: false explicitamente.
  return { id: Math.random().toString(36).slice(2), type, category, amount, description: 'teste', date, paid: type === 'income' || extra.paid !== false, ...extra };
}

function healthyMonth() {
  // Renda 5000, essenciais 2800 (56%), supérfluos 700 (14%), sobra 1500 (30%)
  return [
    tx('income', 'cat_salario', 5000, '2026-06-05'),
    tx('expense', 'cat_moradia', 1500, '2026-06-05'),
    tx('expense', 'cat_alimentacao', 800, '2026-06-10'),
    tx('expense', 'cat_transporte', 500, '2026-06-12'),
    tx('expense', 'cat_lazer', 400, '2026-06-15'),
    tx('expense', 'cat_assina', 300, '2026-06-01'),
  ];
}

function redMonth() {
  // Renda 3000, gastos 4200 (déficit 1200), supérfluos altos
  return [
    tx('income', 'cat_salario', 3000, '2026-06-05'),
    tx('expense', 'cat_moradia', 1500, '2026-06-05'),
    tx('expense', 'cat_alimentacao', 900, '2026-06-10'),
    tx('expense', 'cat_transporte', 600, '2026-06-12'),
    tx('expense', 'cat_lazer', 800, '2026-06-15'),
    tx('expense', 'cat_assina', 400, '2026-06-01'),
  ];
}

test('Advisor carrega e expõe API', () => {
  for (const fn of ['analyze', 'suggestCuts', 'salaryPlan', 'debtEscapePlan', 'classify', 'money']) {
    assert.equal(typeof Advisor[fn], 'function', fn + ' deve ser função');
  }
});

// ── money ────────────────────────────────────────────────
test('money formata pt-BR sem NBSP', () => {
  assert.equal(Advisor.money(1234.5), 'R$ 1.234,50');
  assert.equal(Advisor.money(-10), '-R$ 10,00');
  assert.equal(Advisor.money(0), 'R$ 0,00');
  assert.equal(Advisor.money('1500'), 'R$ 1.500,00');
});

// ── classify ─────────────────────────────────────────────
test('classify identifica essencial × supérfluo por nome', () => {
  assert.equal(Advisor.classify('Lazer'), 'discretionary');
  assert.equal(Advisor.classify('Assinaturas'), 'discretionary');
  assert.equal(Advisor.classify('Restaurante'), 'discretionary');
  assert.equal(Advisor.classify('Alimentação'), 'essential');
  assert.equal(Advisor.classify('Moradia'), 'essential');
  assert.equal(Advisor.classify('Saúde'), 'essential');
  assert.equal(Advisor.classify('Transporte'), 'essential');
  // Desconhecida → essencial por padrão (conservador, não corta o que não entende)
  assert.equal(Advisor.classify('Imprevistos'), 'essential');
});

// ── analyze ──────────────────────────────────────────────
test('analyze: mês saudável dá score alto e sobra positiva', () => {
  const r = Advisor.analyze(healthyMonth(), CATEGORIES);
  assert.equal(r.monthsAnalyzed, 1);
  assert.equal(r.avgIncome, 5000);
  assert.equal(r.avgExpenses, 3500);
  assert.equal(r.avgBalance, 1500);
  assert.ok(r.health.score >= 60, 'score deve ser alto: ' + r.health.score);
  assert.match(r.diagnosis, /azul/);
  assert.ok(r.savingsRate > 0.2);
});

test('analyze: mês no vermelho dá score baixo e diagnóstico de alerta', () => {
  const r = Advisor.analyze(redMonth(), CATEGORIES);
  assert.equal(r.avgBalance, -1200);
  assert.ok(r.health.score < 50, 'score deve ser baixo: ' + r.health.score);
  assert.match(r.diagnosis, /vermelho/);
});

test('analyze: sem dados retorna score 0 e diagnóstico orientador', () => {
  const r = Advisor.analyze([], CATEGORIES);
  assert.equal(r.monthsAnalyzed, 0);
  assert.equal(r.health.score, 0);
  assert.match(r.diagnosis, /Registre/);
});

test('analyze: top categorias por total', () => {
  const r = Advisor.analyze(healthyMonth(), CATEGORIES);
  assert.equal(r.topExpenseCategories[0].name, 'Moradia');
  assert.equal(r.topExpenseCategories[0].total, 1500);
});

test('analyze: contas a pagar pendentes somadas', () => {
  const txs = healthyMonth().concat([
    tx('expense', 'cat_moradia', 200, '2026-06-20', { paid: false }),
    tx('expense', 'cat_alimentacao', 150, '2026-06-22', { paid: false }),
  ]);
  const r = Advisor.analyze(txs, CATEGORIES);
  assert.equal(r.unpaidTotal, 350);
});

test('analyze: média de 3 meses', () => {
  const txs = healthyMonth().concat(
    healthyMonth().map((t) => ({ ...t, date: t.date.replace('2026-06', '2026-05') })),
    healthyMonth().map((t) => ({ ...t, date: t.date.replace('2026-06', '2026-04') }))
  );
  const r = Advisor.analyze(txs, CATEGORIES);
  assert.equal(r.monthsAnalyzed, 3);
  assert.equal(r.avgIncome, 5000);
  assert.equal(r.avgExpenses, 3500);
});

// ── suggestCuts ───────────────────────────────────────────
test('suggestCuts: identifica supérfluos e ranqueia por impacto', () => {
  const r = Advisor.suggestCuts(healthyMonth(), CATEGORIES);
  assert.equal(r.cuts.length, 2);
  assert.equal(r.cuts[0].category, 'Lazer'); // 400 > 300
  assert.equal(r.cuts[0].estimatedSaving, 200); // metade
  assert.equal(r.cuts[1].category, 'Assinaturas');
  assert.ok(r.potentialSaving > 0);
  assert.match(r.summary, /economiza/);
});

test('suggestCuts: mês sem supérfluos não sugere cortes', () => {
  const txs = [
    tx('income', 'cat_salario', 5000, '2026-06-05'),
    tx('expense', 'cat_moradia', 1500, '2026-06-05'),
    tx('expense', 'cat_alimentacao', 900, '2026-06-10'),
  ];
  const r = Advisor.suggestCuts(txs, CATEGORIES);
  assert.equal(r.cuts.length, 0);
  assert.match(r.summary, /enxuto/);
});

test('suggestCuts: sem dados retorna summary orientador', () => {
  const r = Advisor.suggestCuts([], CATEGORIES);
  assert.equal(r.cuts.length, 0);
  assert.match(r.summary, /Sem dados/);
});

// ── salaryPlan ────────────────────────────────────────────
test('salaryPlan: saudável segue 50/30/20', () => {
  const r = Advisor.salaryPlan(healthyMonth(), CATEGORIES);
  assert.equal(r.hasData, true);
  assert.equal(r.inRed, false);
  assert.equal(r.income, 5000);
  assert.equal(r.targetSavings, 1000); // 20% de 5000
  assert.equal(r.yearlySavings, 12000);
  assert.equal(r.recommended.essential, 50);
  assert.equal(r.recommended.discretionary, 30);
  assert.equal(r.recommended.savings, 20);
  assert.ok(r.advice.length >= 3);
  assert.ok(r.advice.some((a) => a.includes('50/30/20')));
});

test('salaryPlan: no vermelho muda regra para emergência', () => {
  const r = Advisor.salaryPlan(redMonth(), CATEGORIES);
  assert.equal(r.inRed, true);
  assert.equal(r.needCut, 1200);
  assert.equal(r.recommended.discretionary, 10);
  assert.equal(r.recommended.essential, 60);
  assert.ok(r.advice.some((a) => a.includes('emergência') || a.includes('vermelho')));
});

test('salaryPlan: sem dados retorna hasData false', () => {
  const r = Advisor.salaryPlan([], CATEGORIES);
  assert.equal(r.hasData, false);
});

// ── debtEscapePlan ────────────────────────────────────────
test('debtEscapePlan: no vermelho calcula déficit e cortes', () => {
  const r = Advisor.debtEscapePlan(redMonth(), CATEGORIES);
  assert.equal(r.hasData, true);
  assert.equal(r.inRed, true);
  assert.equal(r.deficit, 1200);
  assert.ok(r.cuts.length >= 2);
  assert.ok(r.potentialSaving > 0);
  assert.ok(r.advice.some((a) => a.includes('déficit')));
});

test('debtEscapePlan: no azul orienta reserva de emergência', () => {
  const r = Advisor.debtEscapePlan(healthyMonth(), CATEGORIES);
  assert.equal(r.inRed, false);
  assert.equal(r.deficit, 0);
  assert.ok(r.advice.some((a) => a.includes('reserva')));
});

test('debtEscapePlan: sem dados orienta registrar finanças', () => {
  const r = Advisor.debtEscapePlan([], CATEGORIES);
  assert.equal(r.hasData, false);
  assert.equal(r.inRed, false);
});

// ── groupByMonth ──────────────────────────────────────────
test('groupByMonth agrupa por YYYY-MM', () => {
  const map = Advisor.groupByMonth(healthyMonth());
  assert.deepEqual(Object.keys(map).sort(), ['2026-06']);
  assert.equal(map['2026-06'].income, 5000);
  assert.equal(map['2026-06'].expenses, 3500);
});
