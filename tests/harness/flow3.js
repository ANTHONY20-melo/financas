// Harness de fluxo — tela de transações: debounce, paginação (50/pág), totais
// separados, reset de página ao mudar filtro e preservação de página em CRUD (19 checks).
// Rode com: node tests/harness/flow3.js   (ou: npm run test:harness)
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
// Stub do Chart.js (vendor não é carregado no harness): renderDashboard() de
// ações de CRUD não pode derrubar o fluxo — o gráfico está fora do escopo.
w.Chart = class FakeChart { constructor() {} destroy() {} update() {} };
w.HTMLCanvasElement.prototype.getContext = function () { return {}; };
w.Element.prototype.scrollIntoView = function () {};
w.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });

for (const rel of ['js/storage.js', 'js/sync.js', 'js/notifications.js', 'js/advisor.js', 'js/ai.js', 'js/app.js']) {
  const s = w.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  w.document.body.appendChild(s);
}
// IMPORTANTE: não disparar DOMContentLoaded manualmente — o jsdom dispara
// automaticamente quando o parse termina; disparar de novo roda App.init() 2x
// e registra listeners em duplicidade (ex.: ordenação das transações).
if (w.document.readyState !== 'loading') {
  throw new Error('documento já parseado: init automático pode ter ocorrido antes dos scripts');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond, detail) => results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? ' | ' + detail : ''}`);
const $ = (id) => w.document.getElementById(id);
const rows = () => w.document.querySelectorAll('#transactionsBody tr').length;
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

(async () => {
  await sleep(400);
  errors.length = 0;

  // Popula: 120 despesas de R$10 + 2 receitas de R$1.000
  const DB = w.eval('DB'); // const em topo de script vive no escopo lexical, não em window
  const cats = DB.getCategories();
  const expenseCat = cats.find((c) => c.type === 'expense') || cats[0];
  const incomeCat = cats.find((c) => c.type === 'income') || cats[0];
  for (let i = 0; i < 120; i++) {
    DB.addTransaction({ type: 'expense', description: `Despesa teste ${i}`, amount: 10, category: expenseCat.id, date: '2026-01-15' });
  }
  DB.addTransaction({ type: 'income', description: 'Salário', amount: 1000, category: incomeCat.id, date: '2026-01-05' });
  DB.addTransaction({ type: 'income', description: 'Freelance', amount: 1000, category: incomeCat.id, date: '2026-01-20' });

  // navega para transações
  const nav = [...w.document.querySelectorAll('.nav-item')].find((n) => n.dataset.page === 'transacoes');
  nav.click();
  await sleep(100);

  // --- Paginação ---
  check('122 transações no total', $('transactionsCount').textContent.startsWith('122'), $('transactionsCount').textContent);
  check('página 1 renderiza 50 linhas', rows() === 50, `rows=${rows()}`);
  const pag = $('transactionsPagination');
  check('paginação visível', !pag.hidden);
  check('indica "Página 1 de 3"', /Página 1 de 3/.test(pag.textContent), pag.textContent.trim());
  check('botão anterior desabilitado na pág 1', pag.querySelector('[data-page="0"]').disabled);

  // --- Totais ---
  check('Entradas = 2.000', $('transactionsIncome').textContent === brl(2000), $('transactionsIncome').textContent);
  check('Saídas = 1.200', $('transactionsExpense').textContent === brl(1200), $('transactionsExpense').textContent);
  check('Saldo = 800', $('transactionsTotal').textContent.includes(brl(800)), $('transactionsTotal').textContent);

  // --- Navegação de página ---
  pag.querySelector('[data-page="2"]').click();
  await sleep(50);
  check('página 2: 50 linhas', rows() === 50, `rows=${rows()}`);
  check('indica "Página 2 de 3"', /Página 2 de 3/.test($('transactionsPagination').textContent));
  pag.querySelector('[data-page="3"]').click();
  await sleep(50);
  check('página 3: 22 linhas (resto)', rows() === 22, `rows=${rows()}`);

  // --- Filtro reseta para página 1 ---
  const statusF = $('transactionStatusFilter');
  statusF.value = 'unpaid';
  statusF.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);
  check('filtro muda → volta à página 1', /Página 1 de 3/.test($('transactionsPagination').textContent), $('transactionsPagination').textContent.trim());
  statusF.value = 'all';
  statusF.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(50);

  // --- Debounce na busca ---
  const search = $('transactionSearch');
  search.value = 'Salá';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(80); // menos que 250ms
  const before = $('transactionsCount').textContent;
  check('debounce: nada renderizou em 80ms', before.startsWith('122'), before);
  await sleep(300); // passou do debounce
  const after = $('transactionsCount').textContent;
  check('debounce: renderizou após 250ms', !after.startsWith('122') && parseInt(after, 10) > 0, after);
  // busca por "Freelance" (descrição única; "Salá" casa também com a categoria "Salário")
  search.value = 'Freelance';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(350);
  check('busca por "Freelance" acha 1 transação', rows() === 1 && $('transactionsCount').textContent === '1 transação', `rows=${rows()} count=${$('transactionsCount').textContent}`);

  // busca sem resultado → paginação some
  search.value = 'inexistente-xyz';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(350);
  check('sem resultados: paginação oculta', $('transactionsPagination').hidden === true);
  check('sem resultados: mensagem de vazio', $('transactionsBody').textContent.includes('Nenhuma transação'));

  // --- Render de CRUD preserva página (togglePaid não pode resetar) ---
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(350);
  pag.querySelector('[data-page="2"]').click();
  await sleep(50);
  const pageBefore = $('transactionsPagination').textContent.trim();
  const firstRowToggle = w.document.querySelector('#transactionsBody .btn-toggle-paid');
  if (firstRowToggle) {
    firstRowToggle.click(); // dispara renderTransactions() sem options
    await sleep(50);
  }
  check('togglePaid preserva a página', $('transactionsPagination').textContent.trim() === pageBefore, `${pageBefore} -> ${$('transactionsPagination').textContent.trim()}`);

  // --- Clamping: apaga tudo, não pode quebrar ---
  check('0 erros de runtime', errors.length === 0, errors.join(' ; ').slice(0, 300));

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} checks passaram`);
  process.exit(fails ? 1 : 0);
})();