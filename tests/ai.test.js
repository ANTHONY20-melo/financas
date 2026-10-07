'use strict';

/* ============================================
   Testes do Assistente IA (js/ai.js)
   - contexto agregado
   - ferramentas (leitura e escrita) contra o DB real
   - adaptadores OpenAI-compat e Gemini
   - loop de function calling com fetch injetado
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadAI } = require('./helpers/load-ai');
const { createApp } = require('./helpers/load-app');

const AI = loadAI();
const app = createApp();
const { DB, reset } = app;

beforeEach(() => reset());

// Helpers de data relativa (o DB usa new Date() internamente)
function monthOffset(offset) {
  const d = new Date();
  const m = d.getMonth() + 1 + offset;
  const y = d.getFullYear() + Math.floor((m - 1) / 12);
  return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`;
}
function dayOffset(offset, day) {
  return `${monthOffset(offset)}-${String(day).padStart(2, '0')}`;
}

function seed() {
  DB.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'cat_salario', date: dayOffset(0, 5) });
  DB.addTransaction({ description: 'Mercado', amount: 1200, type: 'expense', category: 'cat_alimentacao', date: dayOffset(0, 10) });
  DB.addTransaction({ description: 'Aluguel', amount: 1500, type: 'expense', category: 'cat_moradia', date: dayOffset(0, 8) });
}

// --- Metadados ---

test('listProviders expõe presets com id, label e model', () => {
  const list = AI.listProviders();
  const ids = list.map((p) => p.id);
  assert.ok(ids.includes('ollama'));
  assert.ok(ids.includes('gemini'));
  assert.ok(ids.includes('groq'));
  list.forEach((p) => {
    assert.ok(p.label, 'preset deve ter label');
    assert.ok(p.model, 'preset deve ter model');
    assert.equal(typeof p.requiresKey, 'boolean');
  });
});

test('getProvider cai no fallback ollama para nome desconhecido', () => {
  assert.equal(AI.getProvider('inexistente').kind, 'openai');
  assert.equal(AI.getProvider('inexistente').baseUrl, AI.PROVIDERS.ollama.baseUrl);
});

// --- Contexto ---

test('buildContext agrega receitas, despesas, categorias e metas', () => {
  seed();
  const ctx = AI.buildContext(DB);
  assert.equal(ctx.receitasMes, 5000);
  assert.equal(ctx.despesasMes, 2700);
  assert.equal(ctx.saldoMes, 2300);
  assert.equal(ctx.taxaEconomia, 46);
  assert.ok(Array.isArray(ctx.topCategorias));
  assert.equal(ctx.topCategorias[0].nome, 'Moradia'); // Aluguel (1500) > Mercado (1200)
  assert.ok(ctx.saldoAtual > 0);
  assert.equal(ctx.mes, monthOffset(0));
});

test('buildSystemPrompt inclui o mês de referência e valores', () => {
  seed();
  const prompt = AI.buildSystemPrompt(AI.buildContext(DB));
  assert.match(prompt, /JARVIS/);
  assert.match(prompt, /Mês de referência/);
  assert.match(prompt, /Receitas do mês/);
});

// --- Ferramentas ---

test('getToolDefs retorna funções com schema válido', () => {
  const defs = AI.getToolDefs();
  const names = defs.map((d) => d.function.name);
  assert.ok(names.includes('get_financial_summary'));
  assert.ok(names.includes('get_category_expenses'));
  assert.ok(names.includes('add_transaction'));
  defs.forEach((d) => {
    assert.equal(d.type, 'function');
    assert.ok(d.function.name);
    assert.ok(d.function.description);
    assert.equal(d.function.parameters.type, 'object');
  });
});

test('runTool get_financial_summary calcula o mês', () => {
  seed();
  const out = AI.runTool('get_financial_summary', {}, DB);
  assert.equal(out.ok, true);
  assert.equal(out.receitas, 5000);
  assert.equal(out.despesas, 2700);
  assert.equal(out.saldo, 2300);
});

test('runTool get_category_expenses aceita month e calcula percentual', () => {
  seed();
  const out = AI.runTool('get_category_expenses', { month: monthOffset(0) }, DB);
  assert.equal(out.ok, true);
  assert.equal(out.total, 2700);
  const moradia = out.categorias.find((c) => c.nome === 'Moradia');
  assert.equal(moradia.total, 1500);
  assert.equal(moradia.percentual, 56);
});

test('runTool add_transaction registra despesa e sugere categoria', () => {
  seed();
  const before = DB.getTransactions().length;
  const out = AI.runTool('add_transaction', { type: 'expense', description: 'Mercado', amount: 100 }, DB);
  assert.equal(out.ok, true);
  assert.equal(out.tipo, 'expense');
  assert.equal(out.valor, 100);
  assert.equal(DB.getTransactions().length, before + 1);
  // "Mercado" já existe no histórico → deve sugerir Alimentação
  assert.equal(out.categoriaSugerida, 'Alimentação');
});

test('runTool add_transaction rejeita valor inválido', () => {
  const out = AI.runTool('add_transaction', { type: 'expense', description: 'X', amount: -5 }, DB);
  assert.equal(out.ok, false);
  assert.match(out.error, /Valor inválido/i);
});

test('runTool simulate_purchase calcula saldo após a compra', () => {
  seed();
  const out = AI.runTool('simulate_purchase', { amount: 300 }, DB);
  assert.equal(out.ok, true);
  assert.equal(out.valor, 300);
  // saldo acumulado = 2300 → após compra 2000
  assert.equal(out.saldoAposCompra, out.saldoAtual - 300);
});

test('runTool list_goals retorna metas com progresso', () => {
  DB.addGoal({ name: 'Reserva', target: 1000, current: 250 });
  const out = AI.runTool('list_goals', {}, DB);
  assert.equal(out.ok, true);
  assert.equal(out.metas.length, 1);
  assert.equal(out.metas[0].progressoPct, 25);
});

test('runTool create_goal cria meta válida', () => {
  const out = AI.runTool('create_goal', { name: 'Viagem', target: 3000 }, DB);
  assert.equal(out.ok, true);
  assert.equal(DB.getGoals().length, 1);
});

test('runTool com ferramenta desconhecida retorna erro', () => {
  const out = AI.runTool('nao_existe', {}, DB);
  assert.equal(out.ok, false);
});

// --- Adaptadores ---

test('buildOpenAIRequest monta url, auth e tools', () => {
  const provider = AI.createProvider({ provider: 'groq', apiKey: 'k123', model: 'llama' });
  const req = provider.buildRequest([{ role: 'user', content: 'oi' }], AI.getToolDefs());
  assert.match(req.url, /api\.groq\.com\/openai\/v1\/chat\/completions$/);
  assert.equal(req.options.headers.Authorization, 'Bearer k123');
  const body = JSON.parse(req.options.body);
  assert.equal(body.model, 'llama');
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tool_choice, 'auto');
});

test('buildOpenAIRequest não envia Authorization quando não há key (ollama)', () => {
  const provider = AI.createProvider({ provider: 'ollama' });
  const req = provider.buildRequest([{ role: 'user', content: 'oi' }], []);
  assert.equal(req.options.headers.Authorization, undefined);
});

test('parseOpenAIResponse extrai texto e tool_calls (arguments como string)', () => {
  const json = {
    choices: [
      {
        message: {
          content: 'Um momento...',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_projection', arguments: '{"months":3}' } }],
        },
      },
    ],
  };
  const out = AI.parseOpenAIResponse(json);
  assert.equal(out.text, 'Um momento...');
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'get_projection');
  assert.equal(out.toolCalls[0].args.months, 3);
});

test('buildGeminiRequest converte schema para tipos MAIÚSCULOS e põe a key na url', () => {
  const provider = AI.createProvider({ provider: 'gemini', apiKey: 'abc', model: 'gemini-2.0-flash' });
  const req = provider.buildRequest([{ role: 'system', content: 'sys' }, { role: 'user', content: 'oi' }], AI.getToolDefs());
  assert.match(req.url, /gemini-2\.0-flash:generateContent\?key=abc/);
  const body = JSON.parse(req.options.body);
  assert.ok(body.systemInstruction.parts[0].text);
  const decl = body.tools[0].functionDeclarations.find((d) => d.name === 'add_transaction');
  assert.equal(decl.parameters.type, 'OBJECT');
  assert.equal(decl.parameters.properties.amount.type, 'NUMBER');
});

test('parseGeminiResponse junta texto e functionCall', () => {
  const json = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Vou calcular.' },
            { functionCall: { name: 'get_projection', args: { months: 6 } } },
          ],
        },
      },
    ],
  };
  const out = AI.parseGeminiResponse(json);
  assert.equal(out.text, 'Vou calcular.');
  assert.equal(out.toolCalls[0].name, 'get_projection');
  assert.equal(out.toolCalls[0].args.months, 6);
});

// --- Chat (loop de function calling) ---

function fakeFetchSequence(responses) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: true, status: 200, json: async () => next };
  };
  fn.calls = calls;
  return fn;
}

test('chat executa ferramenta e devolve a resposta final (OpenAI-compat)', async () => {
  seed();
  const fetchImpl = fakeFetchSequence([
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_financial_summary', arguments: '{}' } }],
          },
        },
      ],
    },
    { choices: [{ message: { content: 'Seu saldo do mês é R$ 2.300,00.' } }] },
  ]);

  const r = await AI.chat({
    provider: 'ollama',
    db: DB,
    messages: [{ role: 'user', content: 'Como estão minhas finanças?' }],
    fetch: fetchImpl,
  });

  assert.equal(r.ok, true);
  assert.equal(r.text, 'Seu saldo do mês é R$ 2.300,00.');
  assert.equal(r.rounds, 2);
  assert.equal(r.trace.length, 1);
  assert.equal(r.trace[0].name, 'get_financial_summary');
  assert.equal(r.trace[0].result.ok, true);

  // O 2º request precisa conter o resultado da ferramenta
  const second = fetchImpl.calls[1].body.messages;
  assert.ok(second.some((m) => m.role === 'tool'));
  assert.ok(second[0].role === 'system');
});

test('chat registra transação via ferramenta de escrita', async () => {
  seed();
  const before = DB.getTransactions().length;
  const fetchImpl = fakeFetchSequence([
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'add_transaction', arguments: JSON.stringify({ type: 'expense', description: 'Uber', amount: 25 }) } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: 'Registrei R$ 25,00 de Uber.' } }] },
  ]);

  const r = await AI.chat({ provider: 'ollama', db: DB, messages: [{ role: 'user', content: 'gastei 25 de uber' }], fetch: fetchImpl });
  assert.equal(r.text, 'Registrei R$ 25,00 de Uber.');
  assert.equal(DB.getTransactions().length, before + 1);
});

test('chat funciona com o adaptador Gemini (functionResponse)', async () => {
  seed();
  const fetchImpl = fakeFetchSequence([
    {
      candidates: [
        { content: { parts: [{ functionCall: { name: 'get_projection', args: { months: 3 } } }] } },
      ],
    },
    { candidates: [{ content: { parts: [{ text: 'Sua projeção é positiva.' }] } }] },
  ]);

  const r = await AI.chat({
    provider: 'gemini',
    apiKey: 'abc',
    db: DB,
    messages: [{ role: 'user', content: 'e o futuro?' }],
    fetch: fetchImpl,
  });
  assert.equal(r.text, 'Sua projeção é positiva.');
  assert.equal(r.trace[0].name, 'get_projection');
  // 2º request: contents contém functionResponse
  const contents = fetchImpl.calls[1].body.contents;
  const hasFnResponse = contents.some((c) => c.parts.some((p) => p.functionResponse));
  assert.ok(hasFnResponse, 'deve enviar functionResponse');
});

test('chat sem tools devolve texto direto em 1 rodada', async () => {
  const fetchImpl = fakeFetchSequence([{ choices: [{ message: { content: 'Olá!' } }] }]);
  const r = await AI.chat({ provider: 'ollama', db: DB, messages: [{ role: 'user', content: 'oi' }], fetch: fetchImpl, tools: false });
  assert.equal(r.text, 'Olá!');
  assert.equal(r.rounds, 1);
  assert.equal(r.trace.length, 0);
  assert.equal(fetchImpl.calls.length, 1);
});

test('chat propaga erro HTTP do provedor', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(
    () => AI.chat({ provider: 'groq', apiKey: 'x', db: DB, messages: [{ role: 'user', content: 'oi' }], fetch: fetchImpl }),
    /HTTP 401/
  );
});
