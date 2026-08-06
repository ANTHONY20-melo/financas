'use strict';

/* ============================================
   Testes da feature P4 — Parcelamento
   - Geração de N parcelas mensais com metadata
   - Zero-trust: número de parcelas válido (2..48)
   - Clamp de dia (31 em mês de 30 dias)
   - Grupo: consultar, excluir tudo, excluir parcela
   - Sanitização/backup (export '2.2', import preserva)
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./helpers/load-app');
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// Helper: parcelamento de despesa em N vezes a partir de uma data
function addInstallmentTx(overrides = {}) {
  return DB.addTransaction({
    description: 'iPhone',
    amount: 3600,
    type: 'expense',
    category: 'cat_compras',
    date: '2026-08-15',
    installments: 3,
    ...overrides,
  });
}

// --- Geração de parcelas ---

test('P4: addTransaction com installments=3 cria 3 transações mensais com metadata', () => {
  const res = addInstallmentTx();
  assert.equal(res.success, true);
  assert.equal(res.transactions.length, 3);
  const all = DB.getTransactions();
  assert.equal(all.length, 3);

  // Datas: mesma data nos 3 meses seguintes (15/08, 15/09, 15/10/2026)
  assert.equal(all.map(t => t.date).join(','), '2026-08-15,2026-09-15,2026-10-15');

  // Metadata de parcela correta e mesmo groupId
  const groupIds = new Set(all.map(t => t.installment.groupId));
  assert.equal(groupIds.size, 1);
  all.forEach((t, i) => {
    assert.match(t.id, /^txn_/);
    assert.equal(t.installment.number, i + 1);
    assert.equal(t.installment.total, 3);
    assert.equal(t.description, 'iPhone');
    assert.equal(t.amount, 3600);
    assert.equal(t.category, 'cat_compras');
  });
});

test('P4: installments=1 ou ausente cria transação normal sem metadata', () => {
  const res = DB.addTransaction({
    description: 'Café', amount: 8, type: 'expense', category: 'cat_alimentacao', date: '2026-08-10', installments: 1,
  });
  assert.equal(res.success, true);
  assert.equal(res.transactions, undefined); // caminho normal
  const t = DB.getTransactions()[0];
  assert.equal(t.installment, undefined);

  const res2 = DB.addTransaction({
    description: 'Padaria', amount: 12, type: 'expense', category: 'cat_alimentacao', date: '2026-08-11',
  });
  assert.equal(res2.success, true);
  assert.equal(DB.getTransactions()[1].installment, undefined);
});

test('P4: zero trust — parcelas inválidas (0, -1, 1.5, 49, "abc") são rejeitadas', () => {
  [0, -1, 1.5, 49, 'abc'].forEach(n => {
    const res = DB.addTransaction({
      description: 'X', amount: 100, type: 'expense', category: 'cat_compras', date: '2026-08-15', installments: n,
    });
    assert.equal(res.success, false, `deveria rejeitar ${n}`);
    assert.match(res.error, /parcelas/i);
  });
  assert.equal(DB.getTransactions().length, 0);
});

test('P4: zero trust — campos obrigatórios validados no parcelamento', () => {
  assert.equal(addInstallmentTx({ description: '' }).success, false);
  assert.equal(addInstallmentTx({ amount: 0 }).success, false);
  assert.equal(addInstallmentTx({ amount: -50 }).success, false);
  assert.equal(addInstallmentTx({ category: '' }).success, false);
  assert.equal(addInstallmentTx({ date: '' }).success, false);
  assert.equal(DB.getTransactions().length, 0);
});

test('P4: clamp de dia — parcela de 31/01/2026 cai em 28/02 e 31/03', () => {
  const res = addInstallmentTx({ date: '2026-01-31' });
  assert.equal(res.success, true);
  const dates = DB.getTransactions().map(t => t.date);
  assert.equal(dates.join(','), '2026-01-31,2026-02-28,2026-03-31');
});

test('P4: parcelas com receita funcionam (income)', () => {
  const res = addInstallmentTx({ type: 'income', category: 'cat_freela', amount: 300, description: 'Freela' });
  assert.equal(res.success, true);
  const all = DB.getTransactions();
  assert.equal(all.length, 3);
  assert.ok(all.every(t => t.type === 'income'));
});

// --- Grupo ---

test('P4: getInstallmentGroup retorna parcelas ordenadas do grupo', () => {
  const res = addInstallmentTx();
  const groupId = res.transactions[0].installment.groupId;

  // Outra transação fora do grupo
  DB.addTransaction({
    description: 'Café', amount: 8, type: 'expense', category: 'cat_alimentacao', date: '2026-08-10',
  });

  const group = DB.getInstallmentGroup(groupId);
  assert.equal(group.length, 3);
  // join evita comparação de prototype de Array da VM (deepEqual falharia)
  assert.equal(group.map(t => t.installment.number).join(','), '1,2,3');
});

test('P4: deleteInstallmentGroup exclui só as parcelas do grupo', () => {
  const res = addInstallmentTx();
  const groupId = res.transactions[0].installment.groupId;
  DB.addTransaction({
    description: 'Café', amount: 8, type: 'expense', category: 'cat_alimentacao', date: '2026-08-10',
  });

  const del = DB.deleteInstallmentGroup(groupId);
  assert.equal(del.success, true);
  assert.equal(del.count, 3);
  assert.equal(DB.getTransactions().length, 1);
  assert.equal(DB.getTransactions()[0].description, 'Café');
});

test('P4: deleteInstallmentGroup de grupo inexistente → erro', () => {
  const res = DB.deleteInstallmentGroup('grp_nao_existe');
  assert.equal(res.success, false);
  assert.match(res.error, /não encontrado/i);
});

test('P4: deleteTransaction de uma parcela remove só ela, grupo continua', () => {
  const res = addInstallmentTx();
  const groupId = res.transactions[0].installment.groupId;
  const secondId = res.transactions[1].id;

  const del = DB.deleteTransaction(secondId);
  assert.equal(del.success, true);
  assert.equal(DB.getTransactions().length, 2);
  assert.equal(DB.getInstallmentGroup(groupId).length, 2);
});

test('P4: updateTransaction de parcela preserva metadata de installment', () => {
  const res = addInstallmentTx();
  const tx = res.transactions[0];
  const upd = DB.updateTransaction(tx.id, {
    description: 'iPhone 17', amount: tx.amount, type: tx.type, category: tx.category, date: tx.date,
  });
  assert.equal(upd.success, true);
  assert.equal(upd.transaction.installment.number, 1);
  assert.equal(upd.transaction.installment.total, 3);
  assert.equal(upd.transaction.description, 'iPhone 17');
});

// --- Sanitização / Backup ---

test('P4: import preserva metadata válida de parcela (sanitização)', () => {
  reset();
  const backup = {
    version: '2.2',
    transactions: [{
      id: 'txn_1', description: 'iPhone', amount: 3600, type: 'expense',
      category: 'cat_compras', date: '2026-08-15',
      installment: { groupId: 'grp_1', number: 2, total: 3 },
    }],
  };
  const res = DB.importAllData(backup);
  assert.equal(res.success, true);
  const restored = DB.getTransactions()[0];
  assert.ok(restored.installment);
  assert.equal(restored.installment.groupId, 'grp_1');
  assert.equal(restored.installment.number, 2);
  assert.equal(restored.installment.total, 3);
});

test('P4: import descarta metadata inválida (number > total, sem groupId, não inteiro)', () => {
  const cases = [
    { groupId: 'grp_1', number: 4, total: 3 }, // number > total
    { number: 1, total: 3 },                    // sem groupId
    { groupId: 'grp_1', number: 'x', total: 3 },// não inteiro
  ];
  cases.forEach((inst, i) => {
    reset();
    const backup = {
      version: '2.2',
      transactions: [{
        id: `txn_${i}`, description: 'X', amount: 10, type: 'expense',
        category: 'cat_compras', date: '2026-08-15', installment: inst,
      }],
    };
    const res = DB.importAllData(backup);
    assert.equal(res.success, true, `caso ${i} deveria importar`);
    // Transação importada, mas metadata de parcela descartada
    assert.equal(DB.getTransactions()[0].installment, undefined, `caso ${i}`);
  });
});

test('P4: export version é 2.2 e import roundtrip preserva parcelas', () => {
  addInstallmentTx();
  const exported = DB.exportAllData();
  assert.equal(exported.version, '2.2');
  assert.equal(exported.transactions.length, 3);

  // Simula outro backup: limpa e importa
  reset();
  const imported = DB.importAllData(exported);
  assert.equal(imported.success, true);
  const restored = DB.getTransactions();
  assert.equal(restored.length, 3);
  assert.ok(restored.every(t => t.installment));
  assert.equal(restored.map(t => t.installment.number).join(','), '1,2,3');
});
