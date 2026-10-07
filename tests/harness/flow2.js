// Harness de fluxo — chat IA (18 checks).
// Rode com: node tests/harness/flow2.js   (ou: npm run test:harness)
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let mode = 'ok'; // ok | http500
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));

const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
w.addEventListener('error', (e) => errors.push(`window.error: ${e.message} @${e.lineno}`));
w.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
w.scrollTo = () => {};
// O harness não carrega vendor/chart.umd.min.js (gráfico do dashboard); stub
// evita que um CRUD que chama renderDashboard() derrube o fluxo (fora de escopo).
w.Chart = class FakeChart { constructor() {} destroy() {} update() {} };
w.HTMLCanvasElement.prototype.getContext = function () { return {}; };
w.Element.prototype.scrollIntoView = function () {};
let lastReqBody = null;
w.fetch = async (url, opts) => {
  lastReqBody = opts && opts.body ? JSON.parse(opts.body) : null;
  if (mode === 'http500') return { ok: false, status: 500, text: async () => 'erro interno do provedor' };
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'resposta-ia-' + Date.now() } }] }), text: async () => '' };
};

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

(async () => {
  await sleep(400);
  errors.length = 0;

  // (a) histórico persistido renderiza ao abrir a aba (simula troca de página)
  const hist = { provider: 'ollama', messages: [
    { role: 'user', content: 'olá', ts: Date.now() - 60000 },
    { role: 'assistant', content: 'oi! <script>alert(1)</script>', ts: Date.now() - 50000 },
    { role: 'assistant', content: 'erro antigo', ts: Date.now() - 40000, error: true },
  ] };
  w.localStorage.setItem('financas_ai_config', JSON.stringify(hist));
  // renderAssistant é interno; dispara via navegação (clique na aba)
  const navItem = [...w.document.querySelectorAll('.nav-item')].find((n) => n.dataset.page === 'assistente');
  check('aba Assistente existe no menu', !!navItem);
  if (navItem) navItem.click();
  await sleep(100);
  const box = w.document.getElementById('aiChatMessages');
  const htmlRendered = box.innerHTML;
  check('histórico renderizado (2 msgs, erro excluído do visual? não — deve aparecer)', box.querySelectorAll('.ai-msg').length >= 2, `children=${box.querySelectorAll('.ai-msg').length}`);
  check('HTML da IA escapado (sem <script> cru)', !htmlRendered.includes('<script>alert'), htmlRendered.includes('&lt;script&gt;') ? 'escapado ok' : htmlRendered.slice(0, 120));

  // (b) modal de config abre
  const settingsBtn = w.document.getElementById('aiSettingsBtn');
  check('botão de config da IA existe', !!settingsBtn);
  if (settingsBtn) settingsBtn.click();
  await sleep(50);
  const modal = w.document.getElementById('aiSettingsModal');
  check('modal de config ABRE', !!(modal && modal.classList.contains('open')), `classes=${modal && modal.className}`);

  // (b2) botão "Testar conexão" → sucesso com o fetch stub ok
  const testBtn = w.document.getElementById('aiTestBtn');
  check('botão Testar conexão existe', !!testBtn);
  if (testBtn) {
    testBtn.click();
    await sleep(300);
    const testRes = w.document.getElementById('aiTestResult');
    check('Testar conexão: resultado de sucesso', !!testRes && /Conectado/.test(testRes.textContent), testRes && testRes.textContent);
    check('Testar conexão: botão reabilitado', testBtn.disabled === false);
  }

  // fecha modal
  const closeBtn = modal && modal.querySelector('.modal-close');
  if (closeBtn) closeBtn.click();
  await sleep(50);

  // (c) envio com histórico → corpo da request contém turnos anteriores
  w.localStorage.setItem('financas_ai_config', JSON.stringify({
    provider: 'ollama', messages: [
      { role: 'user', content: 'quanto ganhei?' }, { role: 'assistant', content: 'R$ 5.000' },
      { role: 'user', content: 'erro de antes', error: true },
    ],
  }));
  const input = w.document.getElementById('aiChatInput');
  const form = w.document.getElementById('aiChatForm');
  input.value = 'e quanto gastei?';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(200);
  const msgsSent = lastReqBody ? lastReqBody.messages : null;
  check('request enviou histórico', !!msgsSent && msgsSent.length >= 3, JSON.stringify(msgsSent && msgsSent.map((m) => `${m.role}:${(m.content || '').slice(0, 20)}`)));
  check('mensagem de erro antiga foi filtrada', !!msgsSent && !msgsSent.some((m) => m.content === 'erro de antes'));
  check('system prompt presente', !!msgsSent && msgsSent[0].role === 'system');

  // (d) caminho de erro HTTP 500
  mode = 'http500';
  input.value = 'teste erro';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(200);
  const lastMsgs = w.document.querySelectorAll('#aiChatMessages .ai-msg');
  const lastMsg = lastMsgs[lastMsgs.length - 1];
  check('erro vira bolha de erro no chat', !!(lastMsg && lastMsg.classList.contains('ai-msg--error')), lastMsg && lastMsg.textContent.slice(0, 60));
  check('botão reabilitado após erro', w.document.getElementById('aiChatSend').disabled === false);
  check('status limpo após erro', w.document.getElementById('aiChatStatus').textContent === '');
  const realErrors = errors.filter((e) => !e.includes('no-canvas'));
  check('nenhum erro de runtime não tratado', realErrors.length === 0, realErrors.join(' ; ').slice(0, 200));

  // (e) banner mobile: oculto no desktop; visível com override mobile + ollama; some com groq
  const banner = w.document.getElementById('aiMobileBanner');
  check('banner mobile oculto no desktop', !!(banner && banner.hasAttribute('hidden')));
  w.__aiDeviceMobile = true;
  const navOther = [...w.document.querySelectorAll('.nav-item')].find((n) => n.dataset.page && n.dataset.page !== 'assistente');
  if (navOther) navOther.click();
  await sleep(80);
  if (navItem) navItem.click();
  await sleep(80);
  check('banner mobile visível com ollama', !!(banner && !banner.hasAttribute('hidden')));
  w.localStorage.setItem('financas_ai_config', JSON.stringify({ provider: 'groq', apiKey: 'x', messages: [] }));
  if (navOther) navOther.click();
  await sleep(80);
  if (navItem) navItem.click();
  await sleep(80);
  check('banner mobile oculto com groq', !!(banner && banner.hasAttribute('hidden')));
  w.localStorage.setItem('financas_ai_config', JSON.stringify({ provider: 'ollama', messages: [] }));

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} checks passaram`);
  process.exit(fails ? 1 : 0);
})();