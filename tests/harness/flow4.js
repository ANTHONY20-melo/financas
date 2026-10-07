// Valida as 8 melhorias da tela de transações:
// 1 ordenação por coluna, 2 período de/até, 3 estado vazio com ações,
// 4 deep-link dos filtros via hash, 5 highlight da busca,
// 6 ações em massa, 7 undo no delete, 8 data-labels do card mobile.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!e.message.includes('no-canvas')) errors.push('jsdomError: ' + e.message); });

const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.addEventListener('error', (e) => { if (!String(e.message).includes('no-canvas')) errors.push(`window.error: ${e.message} @${e.lineno}`); });
w.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
w.scrollTo = () => {};
// O harness não carrega vendor/chart.umd.min.js; CRUDs chamam renderDashboard()
// que instancia Chart. Stub evita que o gráfico derrube o teste (fora de escopo).
w.Chart = class FakeChart { constructor() {} destroy() {} update() {} };
w.HTMLCanvasElement.prototype.getContext = function () { return {}; };
w.Element.prototype.scrollIntoView = function () {};
w.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });

for (const rel of ['js/storage.js', 'js/sync.js', 'js/notifications.js', 'js/advisor.js', 'js/ai.js', 'js/app.js']) {
  const s = w.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  w.document.body.appendChild(s);
}
// IMPORTANTE: NÃO disparar DOMContentLoaded manualmente. O jsdom dispara
// automaticamente quando o parse termina; disparar de novo faria App.init()
// rodar 2x e registraria os listeners (ex.: ordenação) em duplicidade,
// quebrando o 1º clique. No navegador real o evento dispara 1x apenas.
if (w.document.readyState !== 'loading') {
  throw new Error('documento já parseado: init automático pode ter ocorrido antes dos scripts');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond, detail) => results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? ' | ' + detail : ''}`);
const $ = (id) => w.document.getElementById(id);
const rows = () => w.document.querySelectorAll('#transactionsBody tr').length;
const descs = () => [...w.document.querySelectorAll('#transactionsBody td[data-label="Descrição"] strong')].map(td => td.textContent.trim());

(async () => {
  await sleep(400);
  errors.length = 0;
  const DB = w.eval('DB');

  // Dados: 3 despesas + 1 receita em datas conhecidas
  DB.addTransaction({ type: 'expense', description: 'Uber aeroporto', amount: 80, category: 'cat_transporte', date: '2026-01-10' });
  DB.addTransaction({ type: 'expense', description: 'Mercado', amount: 350, category: 'cat_alimentacao', date: '2026-01-15' });
  DB.addTransaction({ type: 'income', description: 'Salário', amount: 3000, category: 'cat_salario', date: '2026-01-05' });
  DB.addTransaction({ type: 'expense', description: 'Uber corrida', amount: 25, category: 'cat_transporte', date: '2026-02-20' });

  // navega para transações
  const nav = [...w.document.querySelectorAll('.nav-item')].find((n) => n.dataset.page === 'transacoes');
  nav.click();
  await sleep(100);

  // ===== 1. Ordenação por coluna =====
  const thAmount = w.document.querySelector('th.sortable[data-sort="amount"]');
  const amountText = (td) => td.textContent.replace(/[^\d,.]+/g, ''); // `- R$ 25,00\n` -> `25,00`
  check('1 th de Valor é sortável', !!thAmount);
  check('1 th de Data nasce ordenado desc', w.document.querySelector('th[data-sort="date"]').getAttribute('aria-sort') === 'descending');
  thAmount.click();
  await sleep(50);
  let amounts = [...w.document.querySelectorAll('#transactionsBody td[data-label="Valor"]')].map(amountText);
  const ascOrder = amounts.join('|');
  check('1 1º clique em Valor → asc (menor primeiro)', ascOrder === '25,00|80,00|350,00|3.000,00', ascOrder);
  check('1 aria-sort vira ascending', thAmount.getAttribute('aria-sort') === 'ascending');
  thAmount.click();
  await sleep(50);
  amounts = [...w.document.querySelectorAll('#transactionsBody td[data-label="Valor"]')].map(amountText);
  check('1 2º clique inverte → desc', amounts.join('|') === '3.000,00|350,00|80,00|25,00', amounts.join('|'));
  check('1 aria-sort vira descending', thAmount.getAttribute('aria-sort') === 'descending');

  // ===== 2. Período de/até =====
  const df = $('transactionDateFrom');
  const dt = $('transactionDateTo');
  df.value = '2026-02-01';
  df.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  check('2 só transações de fevereiro', rows() === 1 && descs()[0] === 'Uber corrida', `${rows()} linhas: ${descs().join(',')}`);
  dt.value = '2026-02-28';
  dt.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  check('2 dateTo não quebra (1 continua)', rows() === 1, `rows=${rows()}`);
  df.value = '2026-01-11';
  df.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  check('2 janela jan-11 a fev-28 → Mercado + Uber corrida', rows() === 2, `${rows()}: ${descs().join(',')}`);

  // ===== 3. Estado vazio com ações =====
  df.value = '2030-01-01';
  df.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  const empty = w.document.querySelector('#transactionsBody .tx-empty');
  check('3 estado vazio renderizado', !!empty);
  check('3 tem botão Limpar filtros', !!empty && empty.textContent.includes('Limpar filtros'));
  check('3 tem botão Nova transação', !!empty && empty.textContent.includes('Nova transação'));
  check('3 botão limpar da toolbar visível', $('clearFiltersBtn').hidden === false);
  empty.querySelector('[onclick*="clearTxFilters"]').click();
  await sleep(50);
  check('3 limpar restaura os 4 registros', rows() === 4, `rows=${rows()} count=${$('transactionsCount').textContent}`);
  check('3 toolbar limpa esconde o botão', $('clearFiltersBtn').hidden === true);

  // ===== 5. Highlight do termo buscado =====
  const search = $('transactionSearch');
  search.value = 'uber';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(350);
  const marks = [...w.document.querySelectorAll('#transactionsBody mark.tx-mark')];
  check('5 <mark> aplicado na descrição', marks.length === 2 && marks.every(m => m.textContent.toLowerCase() === 'uber'), `marks=${marks.length}`);
  check('5 highlight não injeta HTML cru', !w.document.querySelector('#transactionsBody td[data-label="Descrição"]').innerHTML.includes('<script'));
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(350);

  // ===== 4. Deep-link via hash =====
  w.history.replaceState(null, '', '#transacoes?ty=expense&sb=amount&sd=asc&df=2026-01-01&dt=2026-01-31');
  w.dispatchEvent(new w.Event('hashchange'));
  await sleep(80);
  check('4 hash aplica tipo=despesa', $('transactionTypeFilter').value === 'expense', $('transactionTypeFilter').value);
  check('4 hash aplica período', $('transactionDateFrom').value === '2026-01-01' && $('transactionDateTo').value === '2026-01-31', `${$('transactionDateFrom').value}..${$('transactionDateTo').value}`);
  check('4 hash aplica ordenação asc', w.document.querySelector('th[data-sort="amount"]').getAttribute('aria-sort') === 'ascending');
  check('4 filtro aplicado → 2 despesas de janeiro (asc por valor)', rows() === 2 && descs().join(',') === 'Uber aeroporto,Mercado', `${rows()}: ${descs().join(',')}`);
  // mudar um filtro na UI deve reescrever o hash
  $('transactionStatusFilter').value = 'unpaid';
  $('transactionStatusFilter').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  check('4 UI grava o filtro no hash', w.location.hash.includes('st=unpaid'), w.location.hash);
  // voltar para hash sem query limpa os filtros
  w.history.replaceState(null, '', '#transacoes');
  w.dispatchEvent(new w.Event('hashchange'));
  await sleep(80);
  check('4 hash sem query limpa filtros', rows() === 4 && $('transactionTypeFilter').value === 'all', `rows=${rows()}`);

  // ===== 6. Ações em massa =====
  const boxes = [...w.document.querySelectorAll('#transactionsBody .tx-select')];
  check('6 checkbox por linha', boxes.length === 4, `boxes=${boxes.length}`);
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new w.Event('change', { bubbles: true }));
  boxes[1].checked = true;
  boxes[1].dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  check('6 bulk bar aparece', $('bulkBar').hidden === false);
  check('6 contagem = 2 selecionadas', $('bulkCount').textContent === '2 selecionadas', $('bulkCount').textContent);
  check('6 linha marcada ganha classe', w.document.querySelectorAll('#transactionsBody tr.row-selected').length === 2);
  // select-all
  const all = $('selectAllTx');
  all.checked = true;
  all.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  check('6 select-all marca a página toda', $('bulkCount').textContent === '4 selecionadas', $('bulkCount').textContent);
  // desmarcar tudo via botão
  $('bulkClearBtn').click();
  await sleep(30);
  check('6 limpar seleção esconde a barra', $('bulkBar').hidden === true);
  // bulk mark paid (só despesas)
  const unpaid = [...w.document.querySelectorAll('#transactionsBody .tx-select')];
  const expenseIdx = [...w.document.querySelectorAll('#transactionsBody tr')].findIndex(tr => tr.textContent.includes('Mercado'));
  unpaid[expenseIdx].checked = true;
  unpaid[expenseIdx].dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  await $('bulkPaidBtn').click();
  await sleep(80);
  const mercado = DB.getTransactions().find(t => t.description === 'Mercado');
  check('6 em massa marca como paga', DB.isPaid(mercado) === true, `paid=${DB.isPaid(mercado)}`);
  check('6 seleção limpa após a ação', $('bulkBar').hidden === true);

  // ===== 7. Undo no delete =====
  const target = DB.getTransactions().find(t => t.description === 'Uber aeroporto');
  const beforeCount = DB.getTransactions().length;
  w.App.deleteTransaction(target.id);
  await sleep(60);
  check('7 modal de confirmação abriu', $('confirmModal').classList.contains('open'));
  $('confirmAction').click();
  await sleep(80);
  check('7 transação excluída', DB.getTransactions().length === beforeCount - 1, `total=${DB.getTransactions().length}`);
  const undoBtn = [...w.document.querySelectorAll('#toastContainer .toast-action')].find(b => b.textContent === 'Desfazer');
  check('7 toast com botão Desfazer apareceu', !!undoBtn);
  if (undoBtn) {
    undoBtn.click();
    await sleep(80);
    check('7 desfazer restaurou a transação', DB.getTransactions().some(t => t.id === target.id), `total=${DB.getTransactions().length}`);
    check('7 toast de sucesso pós-undo', [...w.document.querySelectorAll('#toastContainer .toast')].some(t => t.textContent.includes('restaurada')));
  }

  // ===== 8. data-labels (pré-requisito do card mobile) =====
  const tds = [...w.document.querySelectorAll('#transactionsBody tr:not(.row-selected) td[data-label]')];
  const labels = new Set(tds.map(td => td.dataset.label));
  check('8 todos os td têm data-label', tds.length >= rows() * 7, `${tds.length} tds com label, ${rows()} linhas`);
  check('8 labels esperados presentes', ['Data', 'Descrição', 'Categoria', 'Tipo', 'Status', 'Valor', 'Ações'].every(l => labels.has(l)), [...labels].join(','));
  check('8 ths são sortáveis (menos Ações)', w.document.querySelectorAll('#transactionsTable th.sortable').length === 6);

  check('0 erros de runtime', errors.length === 0, errors.join(' ; ').slice(0, 400));

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} checks passaram`);
  process.exit(fails ? 1 : 0);
})();
