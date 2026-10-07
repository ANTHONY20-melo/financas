/* ============================================
   FINANÇAS PESSOAIS — ASSISTENTE IA (LLM)
   Módulo puro (sem DOM / sem localStorage), testável em Node.

   Ideia central (privacidade + confiabilidade):
   - O modelo NUNCA acessa os lançamentos crus. Recebe apenas um
     contexto AGREGADO (buildContext) e pode chamar "ferramentas"
     (function calling) que consultam o DB localmente.
   - Segredos (API key) ficam só no aparelho (localStorage), nunca na nuvem.

   Provedores suportados (trocáveis):
   - openai-compat: Ollama local, Groq, OpenAI, OpenRouter...
   - gemini: Google Generative Language API

   Uso:
     AI.chat({
       provider: 'ollama', apiKey: '', model: 'qwen2.5-coder:3b',
       messages: [{ role: 'user', content: 'Pra onde foi meu dinheiro?' }],
       db: DB, fetch: window.fetch,
     }).then(r => console.log(r.text));
   ============================================ */
'use strict';

const AI = (() => {
  // ── Provedores (presets) ───────────────────────────────────────
  // kind 'openai' = endpoint /chat/completions compatível OpenAI
  // kind 'gemini' = generateContent do Google
  const PROVIDERS = {
    ollama: {
      label: 'Ollama (local, grátis)',
      kind: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:3b',
      requiresKey: false,
      hint: 'Precisa do Ollama rodando nesta máquina (ollama serve).',
    },
    groq: {
      label: 'Groq (grátis, precisa cadastro)',
      kind: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      requiresKey: true,
      hint: 'Chave gratuita em console.groq.com/keys',
    },
    gemini: {
      label: 'Google Gemini (grátis, precisa cadastro)',
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      requiresKey: true,
      hint: 'Chave gratuita em aistudio.google.com/app/apikey',
    },
    openrouter: {
      label: 'OpenRouter (modelos free)',
      kind: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      requiresKey: true,
      hint: 'Chave em openrouter.ai/keys. Para celular, prefira esse caminho. Ou exponha Ollama via túnel e use "URL base".',
    },
    openai: {
      label: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      requiresKey: true,
      hint: 'Chave em platform.openai.com/api-keys',
    },
  };

  function getProvider(name) {
    return PROVIDERS[name] || PROVIDERS.ollama;
  }

  function listProviders() {
    return Object.keys(PROVIDERS).map((id) => ({ id, ...PROVIDERS[id] }));
  }

  // ── Helpers ────────────────────────────────────────────────────
  function money(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-R$ ' : 'R$ ') + abs;
  }

  function monthStrOf(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // ── Contexto agregado (o que a IA "enxerga") ───────────────────
  function buildContext(db, date) {
    const now = date || new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    const summary = db.getMonthlySummary(y, m);
    const projection = db.getProjection(6, 3);
    const catExpenses = db.getCategoryExpenses(y, m);
    const totalExpense = catExpenses.reduce((s, c) => s + c.total, 0);

    const topCategorias = catExpenses.slice(0, 6).map((c) => ({
      nome: c.name,
      total: round2(c.total),
      percentual: totalExpense > 0 ? Math.round((c.total / totalExpense) * 100) : 0,
    }));

    let contasAPagar = null;
    if (typeof db.getPendingSummary === 'function') {
      const pending = db.getPendingSummary();
      contasAPagar = { total: round2(pending.total || 0), quantidade: pending.count || 0 };
    }

    let metas = [];
    if (typeof db.getGoalProgress === 'function') {
      metas = db.getGoalProgress().map((g) => ({
        nome: g.name,
        meta: round2(g.target),
        guardado: round2(g.current),
        progressoPct: Math.round(g.pct),
        completo: g.isComplete,
      }));
    }

    const lastProjection = projection.projection.length
      ? projection.projection[projection.projection.length - 1]
      : null;

    return {
      geradoEm: new Date().toISOString(),
      mes: summary.month,
      receitasMes: round2(summary.income),
      despesasMes: round2(summary.expense),
      saldoMes: round2(summary.balance),
      taxaEconomia: Math.round(summary.savingsRate),
      saldoAtual: round2(projection.currentBalance),
      mediaMensal: round2(projection.netMonthly),
      projecao6m: lastProjection ? round2(lastProjection.balance) : round2(projection.currentBalance),
      topCategorias,
      contasAPagar,
      metas,
    };
  }

  function buildSystemPrompt(context) {
    const c = context || {};
    const lines = [
      'Você é o JARVIS, um assistente financeiro pessoal brasileiro do app "Finanças".',
      'Fale em português do Brasil, de forma direta, prática e amigável (sem juridiquês).',
      'Você tem FERRAMENTAS para consultar os dados reais do usuário — USE-AS em vez de inventar números.',
      'Nunca invente valores. Se faltar dado, chame a ferramenta adequada.',
      'Para registrar gastos/receitas ou criar metas, use as ferramentas de escrita e confirme o que fez.',
      'Seja conciso: no máximo poucos parágrafos ou uma lista curta. Valores sempre em R$.',
      '',
      'Resumo atual das finanças (só para orientação, confirme com as ferramentas):',
      `- Mês de referência: ${c.mes || '-'}`,
      `- Receitas do mês: ${money(c.receitasMes)} | Despesas: ${money(c.despesasMes)} | Saldo: ${money(c.saldoMes)}`,
      `- Saldo acumulado: ${money(c.saldoAtual)} | Média mensal (sobra): ${money(c.mediaMensal)}`,
      `- Projeção em 6 meses: ${money(c.projecao6m)}`,
    ];
    if (c.contasAPagar && c.contasAPagar.quantidade > 0) {
      lines.push(`- Contas a pagar: ${c.contasAPagar.quantidade} (${money(c.contasAPagar.total)})`);
    }
    if (Array.isArray(c.topCategorias) && c.topCategorias.length) {
      lines.push('- Maiores gastos do mês: ' + c.topCategorias.map((t) => `${t.nome} ${money(t.total)}`).join(', '));
    }
    if (Array.isArray(c.metas) && c.metas.length) {
      lines.push('- Metas: ' + c.metas.map((g) => `${g.nome} ${g.progressoPct}%`).join(', '));
    }
    return lines.join('\n');
  }

  // ── Ferramentas (function calling) ─────────────────────────────
  // Esquema no formato OpenAI (type/minúsculo). O adaptador Gemini converte.
  function getToolDefs() {
    return [
      {
        type: 'function',
        function: {
          name: 'get_financial_summary',
          description: 'Resumo do mês atual: receitas, despesas, saldo, taxa de economia, saldo acumulado, médias e projeção.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_category_expenses',
          description: 'Gastos por categoria em um mês. Use para responder "pra onde foi meu dinheiro".',
          parameters: {
            type: 'object',
            properties: {
              month: { type: 'string', description: "Mês no formato YYYY-MM (omitir = mês atual)" },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_insights',
          description: 'Insights automáticos: categoria mais cara, variação vs mês anterior, maiores aumentos, contas a pagar.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_projection',
          description: 'Projeção de saldo para os próximos meses com base na média atual.',
          parameters: {
            type: 'object',
            properties: {
              months: { type: 'integer', description: 'Quantidade de meses à frente (padrão 6)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_goals',
          description: 'Lista as metas de economia com progresso e projeção de conclusão.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_pending_bills',
          description: 'Contas a pagar pendentes e próximos vencimentos.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: 'Janela em dias para próximos vencimentos (padrão 7)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'simulate_purchase',
          description: 'Simula o impacto de uma compra no saldo atual e na economia do mês.',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number', description: 'Valor da compra em reais' },
            },
            required: ['amount'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_transaction',
          description: 'Registra uma transação (despesa ou receita). Se a categoria não for informada, o app sugere automaticamente.',
          parameters: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['income', 'expense'], description: 'Tipo da transação' },
              description: { type: 'string', description: 'Descrição (ex: Uber, Salário)' },
              amount: { type: 'number', description: 'Valor em reais (positivo)' },
              category: { type: 'string', description: 'ID da categoria (opcional)' },
              date: { type: 'string', description: 'Data YYYY-MM-DD (opcional, padrão hoje)' },
              paid: { type: 'boolean', description: 'Já foi pago/recebido? (opcional)' },
            },
            required: ['type', 'description', 'amount'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_goal',
          description: 'Cria uma meta de economia.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nome da meta' },
              target: { type: 'number', description: 'Valor alvo em reais' },
              current: { type: 'number', description: 'Já guardado (opcional)' },
              deadline: { type: 'string', description: 'Prazo YYYY-MM (opcional)' },
            },
            required: ['name', 'target'],
          },
        },
      },
    ];
  }

  function parseArgs(args) {
    if (!args) return {};
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof args === 'object' ? args : {};
  }

  // Executa uma ferramenta contra o DB local. Sempre devolve objeto serializável.
  function runTool(name, rawArgs, db) {
    const args = parseArgs(rawArgs);
    const fn = TOOL_IMPL[name];
    if (!fn) return { ok: false, error: `Ferramenta desconhecida: ${name}` };
    try {
      return fn(args, db);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  const TOOL_IMPL = {
    get_financial_summary(_args, db) {
      const now = new Date();
      const s = db.getMonthlySummary(now.getFullYear(), now.getMonth() + 1);
      const p = db.getProjection(6, 3);
      const last = p.projection.length ? p.projection[p.projection.length - 1] : null;
      const out = {
        ok: true,
        mes: s.month,
        receitas: round2(s.income),
        despesas: round2(s.expense),
        saldo: round2(s.balance),
        taxaEconomia: Math.round(s.savingsRate),
        saldoAcumulado: round2(p.currentBalance),
        mediaMensal: round2(p.netMonthly),
        projecao6meses: last ? round2(last.balance) : round2(p.currentBalance),
      };
      if (typeof db.getPendingSummary === 'function') {
        out.contasAPagar = round2(db.getPendingSummary().total || 0);
      }
      return out;
    },

    get_category_expenses(args, db) {
      let y;
      let m;
      if (args.month && /^\d{4}-\d{2}$/.test(args.month)) {
        y = Number(args.month.slice(0, 4));
        m = Number(args.month.slice(5, 7));
      } else {
        const now = new Date();
        y = now.getFullYear();
        m = now.getMonth() + 1;
      }
      const list = db.getCategoryExpenses(y, m);
      const total = list.reduce((s, c) => s + c.total, 0);
      return {
        ok: true,
        mes: `${y}-${String(m).padStart(2, '0')}`,
        total: round2(total),
        categorias: list.slice(0, 10).map((c) => ({
          nome: c.name,
          total: round2(c.total),
          percentual: total > 0 ? Math.round((c.total / total) * 100) : 0,
        })),
      };
    },

    get_insights(_args, db) {
      const now = new Date();
      const list = db.getInsights(now.getFullYear(), now.getMonth() + 1);
      return { ok: true, insights: list.map((i) => ({ tipo: i.type, titulo: i.title, texto: i.text })) };
    },

    get_projection(args, db) {
      const months = Number.isInteger(args.months) && args.months > 0 ? Math.min(args.months, 24) : 6;
      const p = db.getProjection(months, 3);
      return {
        ok: true,
        saldoAtual: round2(p.currentBalance),
        mediaMensal: round2(p.netMonthly),
        projecao: p.projection.map((x) => ({ mes: x.month, saldo: round2(x.balance) })),
      };
    },

    list_goals(_args, db) {
      if (typeof db.getGoalProgress !== 'function') return { ok: true, metas: [] };
      return {
        ok: true,
        metas: db.getGoalProgress().map((g) => ({
          nome: g.name,
          meta: round2(g.target),
          guardado: round2(g.current),
          falta: round2(g.remaining),
          progressoPct: Math.round(g.pct),
          completo: g.isComplete,
          mesesParaConcluir: g.projectedMonths,
        })),
      };
    },

    list_pending_bills(args, db) {
      const days = Number.isInteger(args.days) && args.days > 0 ? Math.min(args.days, 60) : 7;
      const summary = typeof db.getPendingSummary === 'function' ? db.getPendingSummary() : { total: 0, count: 0 };
      let upcoming = [];
      if (typeof db.getUpcomingPayments === 'function') {
        upcoming = db.getUpcomingPayments(days).map((p) => ({
          descricao: p.description,
          valor: round2(p.amount),
          vencimento: p.date,
        }));
      }
      return {
        ok: true,
        totalPendente: round2(summary.total || 0),
        quantidade: summary.count || 0,
        atrasadas: summary.overdueCount || 0,
        proximos: upcoming,
      };
    },

    simulate_purchase(args, db) {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: 'Informe um valor de compra válido (positivo).' };
      }
      const now = new Date();
      const s = db.getMonthlySummary(now.getFullYear(), now.getMonth() + 1);
      const p = db.getProjection(6, 3);
      const avgSavings = typeof db.getAverageSavings === 'function' ? db.getAverageSavings(3) : 0;
      return {
        ok: true,
        valor: round2(amount),
        saldoAtual: round2(p.currentBalance),
        saldoAposCompra: round2(p.currentBalance - amount),
        saldoDoMes: round2(s.balance),
        cabeNoSaldoDoMes: s.balance >= amount,
        economiaMediaMensal: round2(avgSavings),
        mesesDeEconomia: avgSavings > 0 ? Math.ceil(amount / avgSavings) : null,
      };
    },

    add_transaction(args, db) {
      const type = args.type === 'income' ? 'income' : args.type === 'expense' ? 'expense' : null;
      if (!type) return { ok: false, error: 'Tipo inválido (use income ou expense).' };
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Valor inválido.' };
      const description = String(args.description || '').trim();
      if (!description) return { ok: false, error: 'Descrição obrigatória.' };

      let category = args.category;
      let suggestedName = null;
      if (!category && typeof db.suggestCategory === 'function') {
        const sug = db.suggestCategory(description, type);
        if (sug) {
          category = sug.categoryId;
          suggestedName = sug.categoryName;
        }
      }
      if (!category) {
        const fallback = db.getCategoriesByType(type)[0];
        category = fallback ? fallback.id : null;
      }
      if (!category) return { ok: false, error: 'Nenhuma categoria disponível.' };

      const res = db.addTransaction({
        type,
        description,
        amount,
        category,
        date: /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : todayStr(),
        paid: typeof args.paid === 'boolean' ? args.paid : undefined,
      });
      if (!res || !res.success) return { ok: false, error: (res && res.error) || 'Falha ao salvar.' };
      return {
        ok: true,
        id: res.transaction.id,
        tipo: type,
        descricao: res.transaction.description,
        valor: round2(res.transaction.amount),
        categoriaSugerida: suggestedName,
        data: res.transaction.date,
      };
    },

    create_goal(args, db) {
      const name = String(args.name || '').trim();
      const target = Number(args.target);
      if (!name) return { ok: false, error: 'Nome da meta obrigatório.' };
      if (!Number.isFinite(target) || target <= 0) return { ok: false, error: 'Valor da meta inválido.' };
      const res = db.addGoal({
        name,
        target,
        current: Number(args.current) || 0,
        deadline: /^\d{4}-\d{2}$/.test(args.deadline) ? args.deadline : null,
      });
      if (!res || !res.success) return { ok: false, error: (res && res.error) || 'Falha ao criar meta.' };
      return { ok: true, id: res.goal.id, nome: res.goal.name, meta: round2(res.goal.target) };
    },
  };

  // ── Adaptadores de provedor ────────────────────────────────────
  // Formato interno de mensagem:
  //   { role:'system'|'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name? }
  // toolCalls: [{ id, name, args }]

  function buildOpenAIRequest(messages, tools, cfg) {
    const hasSystem = messages.some((m) => m.role === 'system');
    const body = {
      model: cfg.model,
      messages: messages.map((m) => {
        if (m.role === 'assistant') {
          const msg = { role: 'assistant', content: m.content || null };
          if (m.toolCalls && m.toolCalls.length) {
            msg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
            }));
          }
          return msg;
        }
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
        }
        return { role: m.role, content: m.content };
      }),
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    // Ollama (e outros locais) não pedem Authorization
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    if (hasSystem) body.stream = false;
    return {
      url: `${cfg.baseUrl}/chat/completions`,
      options: { method: 'POST', headers, body: JSON.stringify(body) },
    };
  }

  function parseOpenAIResponse(json) {
    const message = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          name: tc.function ? tc.function.name : tc.name,
          args: parseArgs(tc.function ? tc.function.arguments : tc.arguments),
        }))
      : [];
    return { text: message.content || '', toolCalls };
  }

  // Converte um JSON Schema (minúsculo) para o formato do Gemini (tipos MAIÚSCULOS)
  function toGeminiSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const out = {};
    if (schema.type) out.type = String(schema.type).toUpperCase();
    if (schema.description) out.description = schema.description;
    if (schema.enum) out.enum = schema.enum;
    if (schema.required) out.required = schema.required;
    if (schema.properties) {
      out.properties = {};
      Object.keys(schema.properties).forEach((k) => {
        out.properties[k] = toGeminiSchema(schema.properties[k]);
      });
    }
    if (schema.items) out.items = toGeminiSchema(schema.items);
    return out;
  }

  function buildGeminiRequest(messages, tools, cfg) {
    let systemText = '';
    const contents = [];
    messages.forEach((m) => {
      if (m.role === 'system') {
        systemText = systemText ? `${systemText}\n${m.content}` : String(m.content || '');
        return;
      }
      if (m.role === 'assistant') {
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        (m.toolCalls || []).forEach((tc) => parts.push({ functionCall: { name: tc.name, args: tc.args || {} } }));
        if (parts.length) contents.push({ role: 'model', parts });
        return;
      }
      if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: m.name || 'result', response: { result: m.content } } }],
        });
        return;
      }
      contents.push({ role: 'user', parts: [{ text: String(m.content || '') }] });
    });

    const body = { contents, generationConfig: { temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3 } };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (tools && tools.length) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: toGeminiSchema(t.function.parameters),
          })),
        },
      ];
    }
    return {
      url: `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.apiKey || '')}`,
      options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    };
  }

  function parseGeminiResponse(json) {
    const content = (json && json.candidates && json.candidates[0] && json.candidates[0].content) || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    let text = '';
    const toolCalls = [];
    parts.forEach((p, i) => {
      if (typeof p.text === 'string') text += p.text;
      if (p.functionCall) {
        toolCalls.push({ id: `call_${i}`, name: p.functionCall.name, args: parseArgs(p.functionCall.args) });
      }
    });
    return { text, toolCalls };
  }

  function createProvider(cfg) {
    const preset = getProvider(cfg.provider);
    const resolved = {
      name: cfg.provider || 'ollama',
      kind: cfg.baseUrl ? (preset.kind) : preset.kind,
      baseUrl: (cfg.baseUrl || preset.baseUrl).replace(/\/+$/, ''),
      model: cfg.model || preset.model,
      apiKey: cfg.apiKey || '',
      temperature: cfg.temperature,
    };
    // Se o usuário escolher "gemini" mas passar baseUrl compatível, respeita o preset.
    if (preset.kind === 'gemini') {
      return {
        ...resolved,
        buildRequest: (msgs, tools) => buildGeminiRequest(msgs, tools, resolved),
        parseResponse: parseGeminiResponse,
      };
    }
    return {
      ...resolved,
      buildRequest: (msgs, tools) => buildOpenAIRequest(msgs, tools, resolved),
      parseResponse: parseOpenAIResponse,
    };
  }

  // Mensagens internas a partir da resposta do provedor
  function assistantTurn(text, toolCalls) {
    return { role: 'assistant', content: text || '', toolCalls: toolCalls || [] };
  }

  function toolTurns(toolCalls, results) {
    return toolCalls.map((tc, i) => ({
      role: 'tool',
      toolCallId: tc.id,
      name: tc.name,
      content: JSON.stringify(results[i]),
    }));
  }

  async function callProvider(provider, messages, tools, fetchImpl) {
    const req = provider.buildRequest(messages, tools);
    const res = await fetchImpl(req.url, req.options);
    if (!res || typeof res.ok !== 'boolean' || !res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* sem corpo */
      }
      throw new Error(`HTTP ${res && res.status}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
    }
    const json = await res.json();
    return provider.parseResponse(json);
  }

  // ── Chat (orquestra o loop de function calling) ────────────────
  async function chat(opts) {
    const cfg = opts || {};
    const fetchImpl = cfg.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw new Error('fetch indisponível neste ambiente.');

    const provider = createProvider(cfg);
    const tools = cfg.tools === false ? [] : getToolDefs();
    const maxRounds = Number.isInteger(cfg.maxRounds) ? cfg.maxRounds : 4;

    const messages = [];
    if (cfg.system !== false) {
      const context = cfg.context || (cfg.db ? buildContext(cfg.db) : {});
      messages.push({ role: 'system', content: cfg.systemPrompt || buildSystemPrompt(context) });
    }
    (cfg.messages || []).forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
      }
    });

    const trace = [];
    let lastText = '';
    let rounds = 0;

    for (let round = 0; round < maxRounds; round++) {
      rounds = round + 1;
      const res = await callProvider(provider, messages, tools, fetchImpl);
      if (res.text) lastText = res.text;
      if (!res.toolCalls.length) {
        return { ok: true, provider: provider.name, model: provider.model, text: res.text || '', messages, trace, rounds };
      }
      messages.push(assistantTurn(res.text, res.toolCalls));
      const results = res.toolCalls.map((tc) => {
        const out = runTool(tc.name, tc.args, cfg.db);
        trace.push({ name: tc.name, args: tc.args || {}, result: out });
        return out;
      });
      toolTurns(res.toolCalls, results).forEach((m) => messages.push(m));
    }

    // Estourou as rodadas: pede uma resposta final sem ferramentas
    const final = await callProvider(provider, messages, [], fetchImpl);
    return {
      ok: true,
      provider: provider.name,
      model: provider.model,
      text: final.text || lastText,
      messages,
      trace,
      rounds: rounds + 1,
      truncated: true,
    };
  }

  return {
    PROVIDERS,
    listProviders,
    getProvider,
    // contexto
    buildContext,
    buildSystemPrompt,
    // ferramentas
    getToolDefs,
    runTool,
    // provedores
    createProvider,
    buildOpenAIRequest,
    parseOpenAIResponse,
    buildGeminiRequest,
    parseGeminiResponse,
    toGeminiSchema,
    // chat
    chat,
    // utils
    money,
    todayStr,
    round2,
  };
})();

if (typeof window !== 'undefined') {
  window.AI = AI;
}
