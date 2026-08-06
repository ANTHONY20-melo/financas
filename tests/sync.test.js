'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/load-sync');

// Configura o Sync para testes (URL/anon key fictícias)
function setup(app) {
  app.Sync.configure('https://financas-teste.example', 'anon-teste-publica');
  app.reset();
}

// ============================================
// Funções puras — código
// ============================================

test('normalizeCode: remove hífens, espaços e minúsculas', () => {
  const { Sync } = createApp();
  assert.strictEqual(Sync.normalizeCode('  k7q9-m2x4-art8 '), 'K7Q9M2X4ART8');
  assert.strictEqual(Sync.normalizeCode('abc-123'), 'ABC123');
  assert.strictEqual(Sync.normalizeCode(''), '');
});

test('formatCode: agrupa em blocos de 4 separados por hífen', () => {
  const { Sync } = createApp();
  assert.strictEqual(Sync.formatCode('K7Q9M2X4ART8'), 'K7Q9-M2X4-ART8');
  assert.strictEqual(Sync.formatCode('K7Q9-M2X4-ART8'), 'K7Q9-M2X4-ART8');
  assert.strictEqual(Sync.formatCode(''), '');
});

test('generateCode: formato XXXX-XXXX-XXXX com alfabeto sem ambíguos', () => {
  const { Sync } = createApp();
  for (let i = 0; i < 50; i++) {
    const code = Sync.generateCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(Sync.isValidCode(code));
  }
});

test('isValidCode: aceita 12 chars válidos, rejeita inválidos', () => {
  const { Sync } = createApp();
  assert.strictEqual(Sync.isValidCode('K7Q9-M2X4-ART8'), true);
  assert.strictEqual(Sync.isValidCode('K7Q9M2X4ART8'), true);
  assert.strictEqual(Sync.isValidCode('AB1'), false);
  assert.strictEqual(Sync.isValidCode('O0I1L-LKJ8-XXXX'), false); // 0/O/1/I/L proibidos
  assert.strictEqual(Sync.isValidCode(''), false);
});

test('generateCode: códigos são distintos (entropia)', () => {
  const { Sync } = createApp();
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(Sync.generateCode());
  assert.strictEqual(seen.size, 100);
});

// ============================================
// Funções puras — criptografia
// ============================================

test('sha256Hex: determinístico e em hex minúsculo', async () => {
  const { Sync } = createApp();
  const h1 = await Sync.sha256Hex('K7Q9M2X4ART8');
  const h2 = await Sync.sha256Hex('K7Q9M2X4ART8');
  const h3 = await Sync.sha256Hex('outro');
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('bytesToBase64/base64ToBytes: roundtrip', () => {
  const { Sync } = createApp();
  const bytes = new Uint8Array([0, 1, 2, 255, 128]);
  const b64 = Sync.bytesToBase64(bytes);
  const back = Sync.base64ToBytes(b64);
  assert.deepStrictEqual(Array.from(back), Array.from(bytes));
});

test('criptografia: encrypt/decrypt roundtrip com a mesma chave', async () => {
  const { Sync } = createApp();
  const salt = Sync.bytesToBase64(new Uint8Array(16).fill(7));
  const key = await Sync.deriveKey('K7Q9M2X4ART8', salt);
  const payload = { transactions: [{ id: 'x', amount: 12.5 }], categories: [] };
  const { iv, data } = await Sync.encryptJson(payload, key);
  const back = await Sync.decryptJson(data, iv, key);
  assert.strictEqual(back.transactions[0].id, 'x');
  assert.strictEqual(back.transactions[0].amount, 12.5);
});

test('criptografia: código errado não decifra (GCM falha)', async () => {
  const { Sync } = createApp();
  const salt = Sync.bytesToBase64(new Uint8Array(16).fill(1));
  const key = await Sync.deriveKey('K7Q9M2X4ART8', salt);
  const { iv, data } = await Sync.encryptJson({ ok: 1 }, key);
  const wrongKey = await Sync.deriveKey('AAAAAAAAAAAA', salt);
  await assert.rejects(() => Sync.decryptJson(data, iv, wrongKey));
});

test('criptografia: salt diferente gera chaves diferentes', async () => {
  const { Sync } = createApp();
  const k1 = await Sync.deriveKey('K7Q9M2X4ART8', Sync.bytesToBase64(new Uint8Array(16).fill(1)));
  const k2 = await Sync.deriveKey('K7Q9M2X4ART8', Sync.bytesToBase64(new Uint8Array(16).fill(2)));
  const { iv: iv1, data: d1 } = await Sync.encryptJson({ v: 1 }, k1);
  await assert.rejects(() => Sync.decryptJson(d1, iv1, k2));
});

// ============================================
// Estado local
// ============================================

test('markDirty/isDirty: marca e limpa sujeira', () => {
  const app = createApp();
  const { Sync } = app;
  assert.strictEqual(Sync.isDirty(), false);
  Sync.markDirty();
  assert.strictEqual(Sync.isDirty(), true);
  assert.strictEqual(app.localStorage.getItem('financas_space_dirty'), '1');
});

test('getState: reflete código ativo e configuração', () => {
  const app = createApp();
  const { Sync } = app;
  let s = Sync.getState();
  assert.strictEqual(s.active, false);
  // A anon key está EMBUTIDA no build (P6 ativo) → o app nasce configurado
  assert.strictEqual(s.configured, true);

  // configure() permite trocar URL/key em runtime (ex.: teste ou outro projeto)
  Sync.configure('https://x.example', 'anon');
  Sync.activateCode('k7q9-m2x4-art8');
  s = Sync.getState();
  assert.strictEqual(s.active, true);
  assert.strictEqual(s.configured, true);
  assert.strictEqual(s.code, 'K7Q9-M2X4-ART8');
});

test('activateCode: normaliza e formata o código guardado', async () => {
  const app = createApp();
  setup(app);
  const res = await app.Sync.activateCode('  k7q9m2x4art8 ');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(app.Sync.getState().code, 'K7Q9-M2X4-ART8');
});

test('activateCode: rejeita código inválido', async () => {
  const app = createApp();
  setup(app);
  const res = await app.Sync.activateCode('AB1');
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /inválido/i);
});

// ============================================
// End-to-end com fetch mock (2 aparelhos)
// ============================================

test('createSpace: envia os dados atuais para a nuvem', async () => {
  const app = createApp();
  setup(app);
  const cat = app.DB.getCategories().find(c => c.type === 'expense');
  app.DB.addTransaction({ type: 'expense', description: 'Mercado', amount: 150, category: cat.id, date: '2026-08-06' });

  const res = await app.Sync.createSpace();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.synced, 'push');
  assert.ok(app.Sync.isActive());

  // O servidor recebeu 1 snapshot criptografado (nunca o conteúdo em claro)
  const keys = Object.keys(app.serverStore);
  assert.strictEqual(keys.length, 1);
  assert.match(app.serverStore[keys[0]].data_enc, /^[A-Za-z0-9+/=]+$/);
});

test('segundo aparelho com o mesmo código puxa os dados (mãe no iPhone)', async () => {
  // Aparelho A: cria espaço com dados
  const appA = createApp();
  setup(appA);
  const cat = appA.DB.getCategories().find(c => c.type === 'expense');
  appA.DB.addTransaction({ type: 'expense', description: 'Mercado', amount: 150, category: cat.id, date: '2026-08-06', paid: false });
  const createRes = await appA.Sync.createSpace();
  assert.strictEqual(createRes.ok, true);
  const code = appA.Sync.getState().code;

  // Aparelho B (novo localStorage, MESMO servidor): entra com o código
  const appB = createApp(appA.serverStore);
  setup(appB);

  const res = await appB.Sync.activateCode(code);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.exists, true);

  // Os dados do A chegaram no B
  const txB = appB.DB.getTransactions();
  assert.strictEqual(txB.length, 1);
  assert.strictEqual(txB[0].description, 'Mercado');
  assert.strictEqual(txB[0].amount, 150);
  assert.strictEqual(txB[0].paid, false); // P5 preservado
  assert.ok(appB.DB.getCategories().some(c => c.name === 'Alimentação'));
});

test('aparelho B adiciona transação e o aparelho A recebe na sincronização', async () => {
  const appA = createApp();
  setup(appA);
  const createRes = await appA.Sync.createSpace();
  assert.strictEqual(createRes.ok, true);
  const code = appA.Sync.getState().code;

  const appB = createApp(appA.serverStore);
  setup(appB);
  await appB.Sync.activateCode(code);
  assert.strictEqual(appB.DB.getTransactions().length, 0);

  // B lança uma transação → markDirty → syncNow envia
  const catB = appB.DB.getCategories().find(c => c.type === 'income');
  appB.DB.addTransaction({ type: 'income', description: 'Freela', amount: 500, category: catB.id, date: '2026-08-06' });
  appB.Sync.markDirty();
  const pushRes = await appB.Sync.syncNow();
  assert.strictEqual(pushRes.ok, true);
  assert.strictEqual(pushRes.synced, 'push');

  // A sincroniza e recebe a transação do B
  const pullRes = await appA.Sync.syncNow();
  assert.strictEqual(pullRes.ok, true);
  assert.strictEqual(pullRes.synced, 'pull');
  assert.strictEqual(appA.DB.getTransactions().length, 1);
  assert.strictEqual(appA.DB.getTransactions()[0].description, 'Freela');
});

test('código errado não sobrescreve dados locais', async () => {
  const appA = createApp();
  setup(appA);
  const catA = appA.DB.getCategories().find(c => c.type === 'expense');
  appA.DB.addTransaction({ type: 'expense', description: 'Original A', amount: 10, category: catA.id, date: '2026-08-06' });
  await appA.Sync.createSpace();

  // B entra com código que não existe → espaço não encontrado, dados locais intactos
  const appB = createApp();
  setup(appB);
  const catB = appB.DB.getCategories().find(c => c.type === 'expense');
  appB.DB.addTransaction({ type: 'expense', description: 'Dados do B', amount: 99, category: catB.id, date: '2026-08-06' });
  const res = await appB.Sync.activateCode('ZZZZZZZZZZZZ'); // não existe
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.exists, false);
  assert.strictEqual(appB.DB.getTransactions().length, 1);
  assert.strictEqual(appB.DB.getTransactions()[0].description, 'Dados do B');
});

test('deactivate: desconecta sem apagar dados locais nem da nuvem', async () => {
  const app = createApp();
  setup(app);
  const cat = app.DB.getCategories().find(c => c.type === 'expense');
  app.DB.addTransaction({ type: 'expense', description: 'X', amount: 5, category: cat.id, date: '2026-08-06' });
  await app.Sync.createSpace();
  assert.ok(app.Sync.isActive());

  app.Sync.deactivate();
  assert.strictEqual(app.Sync.isActive(), false);
  assert.strictEqual(app.DB.getTransactions().length, 1); // dados locais permanecem
  assert.strictEqual(Object.keys(app.serverStore).length, 1); // nuvem permanece
});

test('pull com payload corrompido retorna erro e não quebra', async () => {
  const app = createApp();
  setup(app);
  await app.Sync.activateCode('AAAAAAAAAAAA');
  // injeta um snapshot inválido no servidor
  const spaceId = await app.Sync.sha256Hex('AAAAAAAAAAAA');
  app.serverStore[spaceId] = { salt: 's'.repeat(24), iv: 'i'.repeat(16), data_enc: 'Z2liYmVyaXNo', item_count: 1, updated_at: new Date().toISOString() };
  const res = await app.Sync.pull();
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /incorreto|corrompidos/i);
});

test('deleteSpace: apaga o snapshot da nuvem e desativa o espaço', async () => {
  const app = createApp();
  setup(app);
  const cat = app.DB.getCategories().find(c => c.type === 'expense');
  app.DB.addTransaction({ type: 'expense', description: 'X', amount: 5, category: cat.id, date: '2026-08-06' });
  await app.Sync.createSpace();
  assert.strictEqual(Object.keys(app.serverStore).length, 1); // existe na nuvem

  const res = await app.Sync.deleteSpace();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.deleted, true);
  assert.strictEqual(Object.keys(app.serverStore).length, 0); // nuvem vazia
  assert.strictEqual(app.Sync.isActive(), false); // espaço desativado no aparelho
  assert.strictEqual(app.DB.getTransactions().length, 1); // dados LOCAIS permanecem
});

test('deleteSpace: de espaço inexistente retorna ok sem erro', async () => {
  const app = createApp();
  setup(app);
  await app.Sync.activateCode('BBBBBBBBBBBB');
  const res = await app.Sync.deleteSpace();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.deleted, false);
  assert.strictEqual(app.Sync.isActive(), false);
});

test('deleteSpace: sem código ativo retorna erro', async () => {
  const app = createApp();
  setup(app);
  const res = await app.Sync.deleteSpace();
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /código/i);
});
