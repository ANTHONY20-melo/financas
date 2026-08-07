/* ============================================
   FINANÇAS PESSOAIS — JARVIS: Conselheiro Financeiro
   Motor puro de análise (100% offline, testável em Node).
   Recebe transações/categorias como PARÂMETROS — não toca em DOM
   nem em localStorage (mesmo padrão de Reminders/planNotifications).

   Capacidades:
   - analyze()        → saúde financeira (score 0-100 + diagnóstico)
   - suggestCuts()    → gastos a cortar (ranqueado por impacto)
   - salaryPlan()     → plano para fazer o salário render (regra 50/30/20)
   - debtEscapePlan() → plano para sair do vermelho

   Formato das transações esperado (mesmo do DB):
   { id, type: 'income'|'expense', amount, description, category, date: 'YYYY-MM-DD', paid }
   ============================================ */
'use strict';

const Advisor = (() => {
  const MONTHS_DEFAULT = 3;

  // ── Helpers de valor ───────────────────────────────────────────
  // Sem NBSP: usa toLocaleString('pt-BR') só para número (separador de
  // milhar '.' e decimal ','), e monta 'R$ ' com espaço comum — evita a
  // pegadinha de testes com \u00A0 da lição P5.
  function money(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-R$ ' : 'R$ ') + abs;
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 100);
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // ── Classificação essencial × supérfluo (heurística por nome) ──
  // O padrão conservador: categoria desconhecida conta como ESSENCIAL
  // (não recomendamos cortar o que não entendemos).
  const DISCRETIONARY_KEYWORDS = [
    'lazer', 'entretenimento', 'restaurante', 'delivery', 'ifood', 'lanche',
    'cinema', 'bar', 'festa', 'viagem', 'passagem', 'hotel', 'compras', 'roupa',
    'shopping', 'assinatura', 'streaming', 'netflix', 'spotify', 'jogos',
    'games', 'presente', 'hobby', 'bebida', 'cafe', 'sobremesa', 'delivery',
  ];
  const ESSENTIAL_KEYWORDS = [
    'moradia', 'aluguel', 'condominio', 'energia', 'luz', 'agua', 'internet',
    'telefone', 'mercado', 'supermercado', 'alimentacao', 'farmacia', 'saude',
    'plano de saude', 'transporte', 'gasolina', 'combustivel', 'educacao',
    'escola', 'faculdade', 'seguro', 'imposto', 'financiamento', 'medico',
    'dentista', 'contas', 'servicos',
  ];

  function classify(categoryName) {
    const n = norm(categoryName);
    for (const kw of DISCRETIONARY_KEYWORDS) {
      if (n.includes(kw)) return 'discretionary';
    }
    for (const kw of ESSENTIAL_KEYWORDS) {
      if (n.includes(kw)) return 'essential';
    }
    return 'essential';
  }

  // ── Agrupamento por mês ────────────────────────────────────────
  function groupByMonth(transactions) {
    const map = {};
    for (const t of transactions || []) {
      if (!t || !t.date) continue;
      const month = String(t.date).slice(0, 7);
      const amount = Number(t.amount) || 0;
      const entry = map[month] || (map[month] = { income: 0, expenses: 0, byCategory: {} });
      if (t.type === 'income') {
        entry.income += amount;
      } else if (t.type === 'expense') {
        entry.expenses += amount;
        const cat = t.category || 'uncategorized';
        entry.byCategory[cat] = (entry.byCategory[cat] || 0) + amount;
      }
    }
    return map;
  }

  // Últimos N meses (string 'YYYY-MM' ordena cronologicamente)
  function lastMonths(map, n) {
    return Object.keys(map).sort().slice(-n).map((m) => ({ month: m, ...map[m] }));
  }

  function buildCatMap(categories) {
    const map = {};
    for (const c of categories || []) {
      if (c && c.id) map[c.id] = c.name || c.id;
    }
    return map;
  }

  function catName(catById, id) {
    return catById[id] || (id === 'uncategorized' ? 'Sem categoria' : id);
  }

  function unpaidTotal(transactions) {
    return (transactions || []).reduce((s, t) => {
      if (t && t.type === 'expense' && t.paid === false) s += Number(t.amount) || 0;
      return s;
    }, 0);
  }

  // ── Saúde financeira (score 0-100) ─────────────────────────────
  function healthScore({ avgIncome, avgExpenses, savingsRate, months, unpaidTotal: unpaid, discretionaryPct }) {
    if (!months.length) return { score: 0, label: 'Sem dados' };
    let score = 50;
    if (savingsRate >= 0.2) score += 25;
    else if (savingsRate >= 0.05) score += 15;
    else if (avgIncome > 0 && avgBalancePositive(avgIncome, avgExpenses)) score += 5;

    const redMonths = months.filter((m) => m.expenses > m.income).length;
    if (redMonths > 0) score -= 10 * Math.min(redMonths, 3);

    if (discretionaryPct > 35) score -= 10;
    if (unpaid > 0 && avgIncome > 0 && unpaid > avgIncome * 0.5) score -= 10;

    score = Math.max(0, Math.min(100, score));
    const label = score >= 80 ? 'Excelente' : score >= 60 ? 'Boa' : score >= 40 ? 'Atenção' : 'Crítico';
    return { score, label };
  }

  function avgBalancePositive(income, expenses) {
    return income >= expenses;
  }

  // Categorias do MÊS MAIS RECENTE com dados, classificadas
  function categoryBreakdown(months, catById) {
    const last = months[months.length - 1];
    const list = Object.keys(last?.byCategory || {}).map((id) => {
      const name = catName(catById, id);
      return { id, name, total: last.byCategory[id], type: classify(name) };
    });
    list.sort((a, b) => b.total - a.total);
    return list;
  }

  // ═══ ANALISE — saúde financeira ═════════════════════════════════
  function analyze(transactions, categories, opts = {}) {
    const n = opts.months || MONTHS_DEFAULT;
    const map = groupByMonth(transactions);
    const months = lastMonths(map, n);
    const catById = buildCatMap(categories);

    const totals = months.reduce((acc, m) => {
      acc.income += m.income;
      acc.expenses += m.expenses;
      return acc;
    }, { income: 0, expenses: 0 });

    const count = months.length || 1;
    const avgIncome = totals.income / count;
    const avgExpenses = totals.expenses / count;
    const avgBalance = avgIncome - avgExpenses;
    const savingsRate = avgIncome > 0 ? avgBalance / avgIncome : (avgBalance < 0 ? -1 : 0);

    const breakdown = categoryBreakdown(months, catById);
    const dispTotal = breakdown.filter((c) => c.type === 'discretionary').reduce((s, c) => s + c.total, 0);
    const expTotal = breakdown.reduce((s, c) => s + c.total, 0);
    const discretionaryPct = pct(dispTotal, expTotal);

    const unpaid = unpaidTotal(transactions);
    const health = healthScore({ avgIncome, avgExpenses, savingsRate, months, unpaidTotal: unpaid, discretionaryPct });

    // Diagnóstico em linguagem natural
    const diagnosis = buildDiagnosis({ avgIncome, avgExpenses, avgBalance, savingsRate, months, discretionaryPct, unpaid, health });

    return {
      monthsAnalyzed: months.length,
      months,
      avgIncome,
      avgExpenses,
      avgBalance,
      savingsRate,
      discretionaryPct,
      unpaidTotal: unpaid,
      health,
      diagnosis,
      topExpenseCategories: breakdown.slice(0, 5),
    };
  }

  function buildDiagnosis({ avgIncome, avgExpenses, avgBalance, savingsRate, months, discretionaryPct, unpaid, health }) {
    if (!months.length) {
      return 'Sem transações suficientes nos últimos ' + MONTHS_DEFAULT + ' meses. Registre seus ganhos e gastos para eu poder analisar suas finanças.';
    }
    const parts = [];
    if (avgBalance >= 0) {
      parts.push('Suas contas fecham no azul em média: sobra ' + money(avgBalance) + ' por mês.');
    } else {
      parts.push('Atenção: suas contas fecham no vermelho em média (' + money(avgBalance) + ' por mês).');
    }
    if (savingsRate >= 0.2) {
      parts.push('Ótima taxa de economia de ' + Math.round(savingsRate * 100) + '% da renda — acima da meta de 20%.');
    } else if (savingsRate > 0) {
      parts.push('Você economiza ' + Math.round(savingsRate * 100) + '% da renda; a meta saudável é 20%.');
    } else if (avgIncome > 0) {
      parts.push('Você não está conseguindo economizar — todo o salário vai para gastos.');
    }
    if (discretionaryPct > 35) {
      parts.push(Math.round(discretionaryPct) + '% dos gastos são em itens supérfluos (acima dos 30% recomendados).');
    }
    if (unpaid > 0) {
      parts.push('Você tem ' + money(unpaid) + ' em contas a pagar pendentes.');
    }
    return parts.join(' ');
  }

  // ═══ CORTES — gastos a cortar ══════════════════════════════════
  // Usa o mês mais recente com dados. Corte sugerido = metade do total
  // da categoria supérflua (orientação realista, não radical).
  function suggestCuts(transactions, categories, opts = {}) {
    const n = opts.months || MONTHS_DEFAULT;
    const map = groupByMonth(transactions);
    const months = lastMonths(map, n);
    const catById = buildCatMap(categories);

    if (!months.length) {
      return { cuts: [], totalExpenses: 0, potentialSaving: 0, summary: 'Sem dados para analisar cortes.' };
    }

    const breakdown = categoryBreakdown(months, catById);
    const totalExpenses = breakdown.reduce((s, c) => s + c.total, 0);

    const cuts = breakdown
      .filter((c) => c.type === 'discretionary')
      .map((c) => {
        const half = c.total / 2;
        const reason = /assinatura|streaming|netflix|spotify/.test(norm(c.name))
          ? 'Assinatura recorrente — cancele ou renegocie o plano.'
          : 'Gasto supérfluo — reduza a frequência ou procure alternativa mais barata.';
        return {
          category: c.name,
          total: c.total,
          pctOfExpenses: pct(c.total, totalExpenses),
          estimatedSaving: half,
          reason,
          impact: c.total >= totalExpenses * 0.15 ? 'alta' : 'média',
        };
      })
      .sort((a, b) => b.estimatedSaving - a.estimatedSaving)
      .slice(0, 5);

    const potentialSaving = cuts.reduce((s, c) => s + c.estimatedSaving, 0);
    const summary = cuts.length
      ? 'Cortando pela metade os gastos supérfluos listados, você economiza ~' + money(potentialSaving) + ' por mês (' + pct(potentialSaving, totalExpenses) + '% das despesas).'
      : 'Nenhum gasto supérfluo identificado — parabéns, seu perfil é enxuto.';

    return { cuts, totalExpenses, potentialSaving, summary };
  }

  // ═══ PLANO DO SALÁRIO — fazer o salário render (50/30/20) ═══════
  // Adaptação realista: essenciais ≤ 50%, supérfluos ≤ 30%, restante
  // (20%+) vai para poupança/dívidas. No vermelho, a regra muda:
  // supérfluos caem para ≤ 10% até zerar o déficit.
  function salaryPlan(transactions, categories, opts = {}) {
    const n = opts.months || MONTHS_DEFAULT;
    const map = groupByMonth(transactions);
    const months = lastMonths(map, n);
    const catById = buildCatMap(categories);

    if (!months.length) {
      return { hasData: false, advice: ['Registre seus ganhos e gastos para eu montar seu plano de salário.'] };
    }

    const last = months[months.length - 1];
    const income = last.income;
    const expenses = last.expenses;
    const balance = income - expenses;

    const breakdown = categoryBreakdown(months, catById);
    const essentialTotal = breakdown.filter((c) => c.type === 'essential').reduce((s, c) => s + c.total, 0);
    const discretionaryTotal = breakdown.filter((c) => c.type === 'discretionary').reduce((s, c) => s + c.total, 0);
    const otherTotal = Math.max(0, expenses - essentialTotal - discretionaryTotal);

    const inRed = balance < 0;
    const needCut = Math.max(0, expenses - income);

    const current = {
      essentialPct: pct(essentialTotal, income),
      discretionaryPct: pct(discretionaryTotal, income),
      savingsPct: income > 0 ? Math.round((balance / income) * 100) : 0,
    };

    // Regras recomendadas
    const recommended = inRed
      ? { essential: 60, discretionary: 10, savings: 30 }
      : { essential: 50, discretionary: 30, savings: 20 };

    const targetSavings = income > 0 ? (income * recommended.savings) / 100 : 0;

    const advice = [];
    if (!income) {
      advice.push('Este mês não registrou receitas — o plano fica incompleto até você lançar seus ganhos.');
    }
    advice.push(
      inRed
        ? 'Você está no vermelho em ' + money(Math.abs(balance)) + '. Regra de emergência: essenciais devem caber em até 60% da renda e supérfluos em até 10%, o resto vai para zerar o déficit.'
        : 'Regra 50/30/20: até 50% da renda em essenciais, até 30% em lazer/supérfluos e 20%+ poupados.'
    );
    if (current.essentialPct > recommended.essential) {
      advice.push('Seus essenciais consomem ' + current.essentialPct + '% da renda (recomendado: até ' + recommended.essential + '%). Avalie renegociar moradia, contas e transporte.');
    }
    if (current.discretionaryPct > recommended.discretionary) {
      advice.push('Seus supérfluos consomem ' + current.discretionaryPct + '% da renda (recomendado: até ' + recommended.discretionary + '%). Corte aqui antes de tocar nos essenciais.');
    }
    if (inRed) {
      advice.push('Para sair do vermelho em 3 meses, corte ~' + money(needCut / 3) + ' por mês nos supérfluos.');
    } else {
      advice.push('Guarde ' + money(targetSavings) + ' por mês (' + recommended.savings + '% da renda) em uma reserva de emergência antes de investir.');
    }
    advice.push('Invista o que sobrar em renda fixa simples (Tesouro Selic ou CDB 100% CDI) para começar — liquidez diária e sem risco de mercado.');

    return {
      hasData: true,
      inRed,
      income,
      expenses,
      balance,
      needCut,
      current,
      recommended,
      targetSavings,
      yearlySavings: targetSavings * 12,
      breakdown: {
        essentialTotal,
        discretionaryTotal,
        otherTotal,
      },
      advice,
    };
  }

  // ═══ SAIR DO VERMELHO ══════════════════════════════════════════
  function debtEscapePlan(transactions, categories, opts = {}) {
    const n = opts.months || MONTHS_DEFAULT;
    const map = groupByMonth(transactions);
    const months = lastMonths(map, n);
    const catById = buildCatMap(categories);

    if (!months.length) {
      return { hasData: false, inRed: false, advice: ['Registre suas finanças para eu montar o plano de saída do vermelho.'] };
    }

    const last = months[months.length - 1];
    const income = last.income;
    const expenses = last.expenses;
    const balance = income - expenses;
    const deficit = Math.max(0, expenses - income);
    const inRed = deficit > 0;

    const cuts = suggestCuts(transactions, categories, opts);
    const unpaid = unpaidTotal(transactions);

    const advice = [];
    if (!inRed) {
      advice.push('Boa notícia: você não está no vermelho neste mês. Priorize construir a reserva de emergência (3 a 6 meses de gastos).');
    } else {
      advice.push('Seu déficit mensal é ' + money(deficit) + '. Sem cortes, ele se acumula a cada mês.');
      if (cuts.cuts.length) {
        advice.push('Cortando pela metade os supérfluos abaixo, você cobre ' + money(cuts.potentialSaving) + ' do déficit.');
      }
      advice.push('Se ainda faltar, renegocie dívidas com juros altos (cartão e cheque especial) e troque por crédito consignado ou parcelamento com juros menores.');
      if (unpaid > 0) {
        advice.push('Pague primeiro as contas com vencimento mais próximo e os juros mais altos; ' + money(unpaid) + ' estão pendentes.');
      }
      advice.push('Meta: em 3 meses, fechar o mês no azul. Em 6, ter começado a reserva de emergência.');
    }

    return {
      hasData: true,
      inRed,
      income,
      expenses,
      balance,
      deficit,
      unpaid,
      cuts: cuts.cuts,
      potentialSaving: cuts.potentialSaving,
      advice,
    };
  }

  return {
    analyze,
    suggestCuts,
    salaryPlan,
    debtEscapePlan,
    classify,
    money,
    groupByMonth,
    MONTHS_DEFAULT,
  };
})();
