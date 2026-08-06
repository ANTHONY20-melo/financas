'use strict';

/* ============================================
   Testes da feature P2 — Transações Recorrentes
   - CRUD com validação zero-trust
   - Cálculo de datas de vencimento (mensal/semanal/anual)
   - Geração de transação real com deduplicação
   - Export/Import com sanitização
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// Helper: cria uma recorrente mensal padrão (vence dia 5)
function addMonthlyRecurring(overrides = {}) {
  return DB.addRecurring({
    description: 'Aluguel',
    amount: 1200,
    type: 'expense',
    category: 'cat_moradia',
    frequency: 'monthly',
    day: 5,
    ...overrides,
  });
}

// --- CRUD + validação zero-trust ---

test('P2: addRecurring cria recorrente com defaults', () => {
  const res = addMonthlyRecurring();
  assert.equal(res.success, true);
  const rec = res.recurring;
  assert.match(rec.id, /^rec_/);
  assert.equal(rec.description, 'Aluguel');
  assert.equal(rec.amount, 1200);
  assert.equal(rec.active, true);
  assert.equal(rec.startDate, null);
  assert.equal(DB.getRecurring().length, 1);
});

test('P2: addRecurring rejeita valor zero/negativo (zero trust)', () => {
  const res = DB.addRecurring({
    description: 'Teste', amount: -50, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 5,
  });
  assert.equal(res.success, false);
  assert.match(res.error, /maior que zero/);
  assert.equal(DB.getRecurring().length, 0);
});

test('P2: addRecurring rejeita campos obrigatórios e frequência/dia inválidos', () => {
  assert.equal(DB.addRecurring({ description: '', amount: 10, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 5 }).success, false);
  assert.equal(DB.addRecurring({ description: 'X', amount: 10, type: 'expense', category: '', frequency: 'monthly', day: 5 }).success, false);
  assert.equal(DB.addRecurring({ description: 'X', amount: 10, type: 'expense', category: 'cat_moradia', frequency: 'diario', day: 5 }).success, false);
  // semanal aceita dia 0..6; dia 10 é inválido
  assert.equal(DB.addRecurring({ description: 'X', amount: 10, type: 'expense', category: 'cat_moradia', frequency: 'weekly', day: 10 }).success, false);
  // mensal aceita dia 1..31; dia 0 é inválido
  assert.equal(DB.addRecurring({ description: 'X', amount: 10, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 0 }).success, false);
  assert.equal(DB.getRecurring().length, 0);
});

test('P2: updateRecurring altera campos e deleteRecurring remove', () => {
  const created = addMonthlyRecurring();
  const id = created.recurring.id;

  const updated = DB.updateRecurring(id, { description: 'Aluguel Novo', amount: 1500, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 10 });
  assert.equal(updated.success, true);
  assert.equal(updated.recurring.amount, 1500);
  assert.equal(updated.recurring.day, 10);

  const updatedBad = DB.updateRecurring(id, { description: 'Aluguel', amount: -5, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 5 });
  assert.equal(updatedBad.success, false);

  assert.equal(DB.deleteRecurring(id).success, true);
  assert.equal(DB.getRecurring().length, 0);
  assert.equal(DB.deleteRecurring(id).success, false);
});

// --- Cálculo de datas ---

test('P2: getNextRecurringDate mensal retorna o dia 5 do mês', () => {
  const rec = addMonthlyRecurring().recurring;
  const next = DB.getNextRecurringDate(rec, new Date(2026, 7, 1)); // 1 ago 2026
  assert.equal(next, '2026-08-05');
});

test('P2: getNextRecurringDate mensal pula para o próximo mês se o dia já passou', () => {
  const rec = addMonthlyRecurring({ day: 5 }).recurring;
  const next = DB.getNextRecurringDate(rec, new Date(2026, 7, 10)); // 10 ago 2026
  assert.equal(next, '2026-09-05');
});

test('P2: getNextRecurringDate mensal dia 31 cai no último dia de mês menor', () => {
  const rec = addMonthlyRecurring({ day: 31 }).recurring;
  assert.equal(DB.getNextRecurringDate(rec, new Date(2026, 8, 1)), '2026-09-30'); // setembro tem 30
  assert.equal(DB.getNextRecurringDate(rec, new Date(2026, 1, 1)), '2026-02-28'); // fev 2026 tem 28
});

test('P2: getNextRecurringDate semanal respeita dia da semana (0=domingo)', () => {
  const rec = DB.addRecurring({
    description: 'Academia', amount: 100, type: 'expense', category: 'cat_saude', frequency: 'weekly', day: 3,
  }).recurring;
  // 1 ago 2026 é sábado (day 6); próxima quarta-feira (day 3) é 5 ago
  const next = DB.getNextRecurringDate(rec, new Date(2026, 7, 1));
  const d = new Date(next + 'T00:00:00');
  assert.equal(d.getDay(), 3, 'deve cair em uma quarta-feira');
  assert.equal(next >= '2026-08-01', true);
  assert.equal(next, '2026-08-05');
});

test('P2: getNextRecurringDate semanal com startDate futuro parte da âncora', () => {
  const rec = DB.addRecurring({
    description: 'Curso', amount: 50, type: 'expense', category: 'cat_educacao', frequency: 'weekly', day: 1,
    startDate: '2026-09-07', // segunda-feira
  }).recurring;
  const next = DB.getNextRecurringDate(rec, new Date(2026, 8, 1)); // 1 set (terça)
  assert.equal(next, '2026-09-07', 'âncora 7 set (seg) é a próxima segunda >= from');
});

test('P2: getNextRecurringDate anual repete no mesmo mês/dia da startDate', () => {
  const rec = DB.addRecurring({
    description: 'IPVA', amount: 800, type: 'expense', category: 'cat_outros_desp', frequency: 'yearly', day: 15,
    startDate: '2026-03-15',
  }).recurring;
  assert.equal(DB.getNextRecurringDate(rec, new Date(2026, 4, 1)), '2027-03-15');
  assert.equal(DB.getNextRecurringDate(rec, new Date(2026, 2, 1)), '2026-03-15');
});

// --- Próximas ocorrências (agrupadas) ---

test('P2: getUpcomingRecurring lista ocorrências dos próximos meses', () => {
  addMonthlyRecurring({ day: 5 });
  const upcoming = DB.getUpcomingRecurring(3, '2026-08-01');
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].occurrences.length, 3);
  assert.equal(upcoming[0].occurrences[0].date, '2026-08-05');
  assert.equal(upcoming[0].occurrences[1].date, '2026-09-05');
  assert.equal(upcoming[0].occurrences[2].date, '2026-10-05');
});

test('P2: getUpcomingRecurring ignora recorrentes inativas', () => {
  addMonthlyRecurring();
  addMonthlyRecurring({ description: 'Inativa', active: false });
  const upcoming = DB.getUpcomingRecurring(2, '2026-08-01');
  assert.equal(upcoming.length, 1);
});

// --- Geração de transação com deduplicação ---

test('P2: generateRecurringTransaction cria transação real com marcação', () => {
  const rec = addMonthlyRecurring().recurring;
  const res = DB.generateRecurringTransaction(rec.id, '2026-08');
  assert.equal(res.success, true);
  assert.equal(res.transaction.recurringId, rec.id);
  assert.equal(res.transaction.recurringDate, '2026-08-05');
  assert.equal(DB.getTransactions().length, 1);
  assert.equal(DB.getTransactions()[0].amount, 1200);
});

test('P2: generateRecurringTransaction deduplica o mesmo vencimento', () => {
  const rec = addMonthlyRecurring().recurring;
  assert.equal(DB.generateRecurringTransaction(rec.id, '2026-08').success, true);
  const second = DB.generateRecurringTransaction(rec.id, '2026-08');
  assert.equal(second.success, false);
  assert.match(second.error, /já lançada/i);
  assert.equal(DB.getTransactions().length, 1, 'não pode duplicar');
});

test('P2: generateRecurringTransaction permite lançar outro mês', () => {
  const rec = addMonthlyRecurring().recurring;
  assert.equal(DB.generateRecurringTransaction(rec.id, '2026-08').success, true);
  assert.equal(DB.generateRecurringTransaction(rec.id, '2026-09').success, true);
  assert.equal(DB.getTransactions().length, 2);
});

test('P2: generateRecurringTransaction rejeita recorrente inativa e ano sem vencimento', () => {
  const rec = addMonthlyRecurring({ day: 31 }).recurring;
  // mensal dia 31 em abril → clamp 30/04, vence (comportamento correto)
  assert.equal(DB.generateRecurringTransaction(rec.id, '2026-04').success, true);

  // anual de março → não tem vencimento em agosto
  const yearly = DB.addRecurring({
    description: 'IPVA', amount: 800, type: 'expense', category: 'cat_outros_desp',
    frequency: 'yearly', day: 15, startDate: '2026-03-15',
  }).recurring;
  const noVen = DB.generateRecurringTransaction(yearly.id, '2026-08');
  assert.equal(noVen.success, false);
  assert.match(noVen.error, /não tem vencimento/i);

  // recorrente inativa
  const inactive = addMonthlyRecurring({ description: 'Inativa', active: false }).recurring;
  assert.equal(DB.generateRecurringTransaction(inactive.id, '2026-08').success, false);
  assert.match(DB.generateRecurringTransaction(inactive.id, '2026-08').error, /inativa/i);
});

// --- Export / Import ---

test('P2: exportAllData inclui recurring e import roundtrip preserva', () => {
  addMonthlyRecurring();
  const exported = DB.exportAllData();
  assert.equal(exported.recurring.length, 1);
  assert.equal(exported.version, '2.2');

  reset();
  const imported = DB.importAllData(exported);
  assert.equal(imported.success, true);
  assert.equal(DB.getRecurring().length, 1);
  assert.equal(DB.getRecurring()[0].description, 'Aluguel');
});

test('P2: import sanitiza recorrentes inválidas e preserva marcação na transação', () => {
  const rec = addMonthlyRecurring().recurring;
  DB.generateRecurringTransaction(rec.id, '2026-08');

  const exported = DB.exportAllData();
  exported.recurring.push({ id: 'rec_bad', description: '', amount: 100, type: 'expense', category: 'cat_moradia', frequency: 'monthly', day: 5 });

  reset();
  const imported = DB.importAllData(exported);
  assert.equal(imported.success, true);
  assert.equal(imported.ignored, 1, 'recorrente malformada deve ser descartada');
  assert.equal(DB.getRecurring().length, 1);
  // transação importada mantém recurringId/recurringDate
  assert.equal(DB.getTransactions()[0].recurringId, rec.id);
  assert.equal(DB.getTransactions()[0].recurringDate, '2026-08-05');
});

test('P2: generateRecurringTransaction com dia 31 em fev gera no último dia (clamp)', () => {
  const rec = addMonthlyRecurring({ day: 31 }).recurring;
  const res = DB.generateRecurringTransaction(rec.id, '2026-02');
  assert.equal(res.success, true);
  assert.equal(res.transaction.recurringDate, '2026-02-28');
  assert.equal(DB.getTransactions().length, 1);
});
