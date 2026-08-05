/* ============================================
   FINANÇAS PESSOAIS - Storage Module
   Gerencia dados no localStorage com MMKV-like API
   ============================================ */

const Storage = (() => {
  const PREFIX = 'financas_';

  function getKey(key) {
    return PREFIX + key;
  }

  function get(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(getKey(key));
      return data !== null ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(getKey(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(getKey(key));
  }

  function clear() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  }

  function getAllKeys() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .map(k => k.slice(PREFIX.length));
  }

  return { get, set, remove, clear, getAllKeys };
})();


/* ============================================
   Database Module
   Estrutura de dados e operações CRUD
   ============================================ */

const DB = (() => {
  const TRANSACTIONS_KEY = 'transactions';
  const CATEGORIES_KEY = 'categories';
  const BUDGETS_KEY = 'budgets';
  const GOALS_KEY = 'goals';

  // --- Default Categories ---
  const DEFAULT_CATEGORIES = [
    // Income
    { id: 'cat_salario', name: 'Salário', type: 'income', icon: 'fa-solid fa-briefcase' },
    { id: 'cat_freela', name: 'Freelance', type: 'income', icon: 'fa-solid fa-laptop-code' },
    { id: 'cat_invest', name: 'Investimentos', type: 'income', icon: 'fa-solid fa-chart-line' },
    { id: 'cat_aluguel_rec', name: 'Aluguel Recebido', type: 'income', icon: 'fa-solid fa-home' },
    { id: 'cat_outros_rec', name: 'Outras Receitas', type: 'income', icon: 'fa-solid fa-plus-circle' },
    // Expense
    { id: 'cat_alimentacao', name: 'Alimentação', type: 'expense', icon: 'fa-solid fa-utensils' },
    { id: 'cat_moradia', name: 'Moradia', type: 'expense', icon: 'fa-solid fa-home' },
    { id: 'cat_transporte', name: 'Transporte', type: 'expense', icon: 'fa-solid fa-car' },
    { id: 'cat_saude', name: 'Saúde', type: 'expense', icon: 'fa-solid fa-heart-pulse' },
    { id: 'cat_educacao', name: 'Educação', type: 'expense', icon: 'fa-solid fa-graduation-cap' },
    { id: 'cat_lazer', name: 'Lazer', type: 'expense', icon: 'fa-solid fa-gamepad' },
    { id: 'cat_contas', name: 'Contas & Serviços', type: 'expense', icon: 'fa-solid fa-file-invoice' },
    { id: 'cat_compras', name: 'Compras', type: 'expense', icon: 'fa-solid fa-bag-shopping' },
    { id: 'cat_assina', name: 'Assinaturas', type: 'expense', icon: 'fa-solid fa-repeat' },
    { id: 'cat_imprevistos', name: 'Imprevistos', type: 'expense', icon: 'fa-solid fa-triangle-exclamation' },
    { id: 'cat_outros_desp', name: 'Outras Despesas', type: 'expense', icon: 'fa-solid fa-minus-circle' },
  ];

  // --- Initialize ---
  function init() {
    if (!Storage.get(CATEGORIES_KEY)) {
      Storage.set(CATEGORIES_KEY, DEFAULT_CATEGORIES);
    }
    if (!Storage.get(TRANSACTIONS_KEY)) {
      Storage.set(TRANSACTIONS_KEY, []);
    }
    if (!Storage.get(BUDGETS_KEY)) {
      Storage.set(BUDGETS_KEY, []);
    }
    if (!Storage.get(GOALS_KEY)) {
      Storage.set(GOALS_KEY, []);
    }
  }

  // --- Transactions CRUD ---
  function getTransactions() {
    return Storage.get(TRANSACTIONS_KEY, []);
  }

  function saveTransactions(transactions) {
    Storage.set(TRANSACTIONS_KEY, transactions);
  }

  function addTransaction(data) {
    const transactions = getTransactions();
    const rawAmount = parseFloat(data.amount);
    const transaction = {
      id: 'txn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      description: data.description.trim(),
      amount: Math.abs(rawAmount),
      type: data.type,
      category: data.category,
      date: data.date,
      notes: data.notes ? data.notes.trim() : '',
      createdAt: new Date().toISOString(),
    };

    // Validate (antes de normalizar: valor deve existir e ser positivo)
    if (!transaction.description || !rawAmount || !transaction.category || !transaction.date) {
      return { success: false, error: 'Preencha todos os campos obrigatórios.' };
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { success: false, error: 'O valor deve ser maior que zero.' };
    }

    transactions.push(transaction);
    saveTransactions(transactions);
    return { success: true, transaction };
  }

  function updateTransaction(id, data) {
    const transactions = getTransactions();
    const index = transactions.findIndex(t => t.id === id);
    if (index === -1) return { success: false, error: 'Transação não encontrada.' };

    const rawAmount = parseFloat(data.amount);
    const updated = {
      ...transactions[index],
      description: data.description.trim(),
      amount: Math.abs(rawAmount),
      type: data.type,
      category: data.category,
      date: data.date,
      notes: data.notes ? data.notes.trim() : '',
    };

    if (!updated.description || !rawAmount || !updated.category || !updated.date) {
      return { success: false, error: 'Preencha todos os campos obrigatórios.' };
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { success: false, error: 'O valor deve ser maior que zero.' };
    }

    transactions[index] = updated;
    saveTransactions(transactions);
    return { success: true, transaction: updated };
  }

  function deleteTransaction(id) {
    const transactions = getTransactions();
    const filtered = transactions.filter(t => t.id !== id);
    if (filtered.length === transactions.length) {
      return { success: false, error: 'Transação não encontrada.' };
    }
    saveTransactions(filtered);
    return { success: true };
  }

  function getTransactionsByFilters({ search, type, category, month, year } = {}) {
    let transactions = getTransactions();

    if (search) {
      const term = search.toLowerCase();
      transactions = transactions.filter(t =>
        t.description.toLowerCase().includes(term) ||
        t.notes.toLowerCase().includes(term) ||
        getCategoryName(t.category).toLowerCase().includes(term)
      );
    }

    if (type && type !== 'all') {
      transactions = transactions.filter(t => t.type === type);
    }

    if (category && category !== 'all') {
      transactions = transactions.filter(t => t.category === category);
    }

    if (month && month !== 'all') {
      transactions = transactions.filter(t => {
        const d = new Date(t.date + 'T00:00:00');
        return d.getMonth() + 1 === parseInt(month);
      });
    }

    if (year && year !== 'all') {
      transactions = transactions.filter(t => {
        const d = new Date(t.date + 'T00:00:00');
        return d.getFullYear() === parseInt(year);
      });
    }

    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date + 'T00:00:00') - new Date(a.date + 'T00:00:00'));

    return transactions;
  }

  // --- Categories CRUD ---
  function getCategories() {
    return Storage.get(CATEGORIES_KEY, []);
  }

  function getCategoriesByType(type) {
    return getCategories().filter(c => c.type === type);
  }

  function getCategory(id) {
    return getCategories().find(c => c.id === id) || null;
  }

  function getCategoryName(id) {
    const cat = getCategory(id);
    return cat ? cat.name : 'Sem categoria';
  }

  function addCategory(data) {
    const categories = getCategories();
    const newCat = {
      id: 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: data.name.trim(),
      type: data.type,
      icon: data.icon || 'fa-solid fa-tag',
    };

    if (!newCat.name) return { success: false, error: 'Nome da categoria é obrigatório.' };

    // Check duplicate
    if (categories.some(c => c.name.toLowerCase() === newCat.name.toLowerCase() && c.type === newCat.type)) {
      return { success: false, error: 'Já existe uma categoria com este nome.' };
    }

    categories.push(newCat);
    Storage.set(CATEGORIES_KEY, categories);
    return { success: true, category: newCat };
  }

  function updateCategory(id, data) {
    const categories = getCategories();
    const index = categories.findIndex(c => c.id === id);
    if (index === -1) return { success: false, error: 'Categoria não encontrada.' };

    const updated = {
      ...categories[index],
      name: data.name.trim(),
      type: data.type,
      icon: data.icon || categories[index].icon,
    };

    if (!updated.name) return { success: false, error: 'Nome da categoria é obrigatório.' };

    // Check duplicate
    const duplicate = categories.some((c, i) =>
      i !== index && c.name.toLowerCase() === updated.name.toLowerCase() && c.type === updated.type
    );
    if (duplicate) return { success: false, error: 'Já existe uma categoria com este nome.' };

    categories[index] = updated;
    Storage.set(CATEGORIES_KEY, categories);
    return { success: true, category: updated };
  }

  function deleteCategory(id) {
    const transactions = getTransactions();
    const inUse = transactions.some(t => t.category === id);
    if (inUse) {
      return { success: false, error: 'Não é possível excluir: existem transações usando esta categoria.' };
    }

    const categories = getCategories();
    const filtered = categories.filter(c => c.id !== id);
    if (filtered.length === categories.length) {
      return { success: false, error: 'Categoria não encontrada.' };
    }

    // Also remove budgets using this category
    const budgets = getBudgets();
    Storage.set(BUDGETS_KEY, budgets.filter(b => b.categoryId !== id));

    Storage.set(CATEGORIES_KEY, filtered);
    return { success: true };
  }

  // --- Budgets CRUD ---
  function getBudgets() {
    return Storage.get(BUDGETS_KEY, []);
  }

  function getBudgetsByMonth(monthStr) {
    return getBudgets().filter(b => b.month === monthStr);
  }

  function addBudget(data) {
    const budgets = getBudgets();

    // Check duplicate
    const exists = budgets.some(b => b.categoryId === data.categoryId && b.month === data.month);
    if (exists) {
      return { success: false, error: 'Já existe um orçamento para esta categoria neste mês.' };
    }

    const budget = {
      id: 'budg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      categoryId: data.categoryId,
      month: data.month,
      amount: Math.abs(parseFloat(data.amount)),
    };

    if (!budget.categoryId || !budget.month || !budget.amount) {
      return { success: false, error: 'Preencha todos os campos.' };
    }
    if (budget.amount <= 0) {
      return { success: false, error: 'O limite deve ser maior que zero.' };
    }

    budgets.push(budget);
    Storage.set(BUDGETS_KEY, budgets);
    return { success: true, budget };
  }

  function updateBudget(id, data) {
    const budgets = getBudgets();
    const index = budgets.findIndex(b => b.id === id);
    if (index === -1) return { success: false, error: 'Orçamento não encontrado.' };

    const updated = {
      ...budgets[index],
      categoryId: data.categoryId,
      month: data.month,
      amount: Math.abs(parseFloat(data.amount)),
    };

    // Check duplicate
    const duplicate = budgets.some((b, i) =>
      i !== index && b.categoryId === updated.categoryId && b.month === updated.month
    );
    if (duplicate) {
      return { success: false, error: 'Já existe um orçamento para esta categoria neste mês.' };
    }

    if (!updated.amount || updated.amount <= 0) {
      return { success: false, error: 'O limite deve ser maior que zero.' };
    }

    budgets[index] = updated;
    Storage.set(BUDGETS_KEY, budgets);
    return { success: true, budget: updated };
  }

  function deleteBudget(id) {
    const budgets = getBudgets();
    const filtered = budgets.filter(b => b.id !== id);
    if (filtered.length === budgets.length) {
      return { success: false, error: 'Orçamento não encontrado.' };
    }
    Storage.set(BUDGETS_KEY, filtered);
    return { success: true };
  }

  // --- Aggregations ---
  function getMonthlySummary(year, month) {
    const transactions = getTransactions();
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    const filtered = transactions.filter(t => {
      const d = new Date(t.date + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });

    const income = filtered.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = filtered.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const balance = income - expense;
    const savingsRate = income > 0 ? ((income - expense) / income * 100) : 0;

    return { income, expense, balance, savingsRate, count: filtered.length, month: monthStr };
  }

  function getMonthlyHistory(months = 12) {
    const today = new Date();
    const history = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const summary = getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      history.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        ...summary,
      });
    }

    return history;
  }

  function getCategoryExpenses(year, month) {
    const transactions = getTransactions().filter(t => {
      const d = new Date(t.date + 'T00:00:00');
      return t.type === 'expense' && d.getFullYear() === year &&
        (month === undefined || d.getMonth() + 1 === month);
    });

    const grouped = {};
    transactions.forEach(t => {
      if (!grouped[t.category]) {
        const cat = getCategory(t.category);
        grouped[t.category] = {
          categoryId: t.category,
          name: cat ? cat.name : 'Sem categoria',
          icon: cat ? cat.icon : 'fa-solid fa-tag',
          total: 0,
        };
      }
      grouped[t.category].total += t.amount;
    });

    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }

  // --- Goals (Metas de Economia) ---
  function getGoals() {
    return Storage.get(GOALS_KEY, []);
  }

  function addGoal(data) {
    const goals = getGoals();
    const rawTarget = parseFloat(data.target);

    if (!data.name || !data.name.trim()) {
      return { success: false, error: 'Nome da meta é obrigatório.' };
    }
    // Zero-trust: valida o valor BRUTO antes de normalizar (Math.abs(-50) viraria +50)
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
      return { success: false, error: 'O valor da meta deve ser maior que zero.' };
    }

    const target = Math.abs(rawTarget);
    const goal = {
      id: 'goal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: data.name.trim(),
      target,
      current: Math.abs(parseFloat(data.current) || 0),
      deadline: data.deadline || null,
      icon: data.icon || 'fa-solid fa-piggy-bank',
      createdAt: new Date().toISOString(),
    };

    goals.push(goal);
    Storage.set(GOALS_KEY, goals);
    return { success: true, goal };
  }

  function updateGoal(id, data) {
    const goals = getGoals();
    const index = goals.findIndex(g => g.id === id);
    if (index === -1) return { success: false, error: 'Meta não encontrada.' };

    const rawTarget = data.target !== undefined ? parseFloat(data.target) : goals[index].target;
    if (!data.name || !data.name.trim()) {
      return { success: false, error: 'Nome da meta é obrigatório.' };
    }
    // Zero-trust: valida o valor bruto antes de normalizar
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
      return { success: false, error: 'O valor da meta deve ser maior que zero.' };
    }

    const target = Math.abs(rawTarget);
    goals[index] = {
      ...goals[index],
      name: data.name.trim(),
      target,
      current: Math.abs(parseFloat(data.current ?? goals[index].current) || 0),
      deadline: data.deadline !== undefined ? (data.deadline || null) : goals[index].deadline,
      icon: data.icon || goals[index].icon,
    };

    Storage.set(GOALS_KEY, goals);
    return { success: true, goal: goals[index] };
  }

  // Adiciona valor guardado à meta (contribuição). amount deve ser positivo.
  function addGoalContribution(id, amount) {
    const goals = getGoals();
    const index = goals.findIndex(g => g.id === id);
    if (index === -1) return { success: false, error: 'Meta não encontrada.' };

    const raw = parseFloat(amount);
    if (!Number.isFinite(raw) || raw <= 0) {
      return { success: false, error: 'O valor deve ser maior que zero.' };
    }

    goals[index] = { ...goals[index], current: goals[index].current + raw };
    Storage.set(GOALS_KEY, goals);
    return { success: true, goal: goals[index] };
  }

  function deleteGoal(id) {
    const goals = getGoals();
    const filtered = goals.filter(g => g.id !== id);
    if (filtered.length === goals.length) {
      return { success: false, error: 'Meta não encontrada.' };
    }
    Storage.set(GOALS_KEY, filtered);
    return { success: true };
  }

  // Calcula progresso de cada meta + projeção de conclusão baseada na
  // economia mensal média (soma de saldos positivos dos últimos 3 meses).
  function getGoalProgress(monthCount = 3) {
    const goals = getGoals();
    const avgSavings = getAverageSavings(monthCount);

    return goals.map(g => {
      const pct = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
      const remaining = Math.max(g.target - g.current, 0);
      const isComplete = g.current >= g.target;

      // Meses até o prazo, se definido
      let monthsToDeadline = null;
      if (g.deadline) {
        const now = new Date();
        const dl = new Date(g.deadline + '-01T00:00:00');
        monthsToDeadline = Math.max((dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth()), 0);
      }

      // Projeção: quanto tempo (meses) para concluir no ritmo atual de economia
      const projectedMonths = !isComplete && avgSavings > 0 ? Math.ceil(remaining / avgSavings) : null;
      const onTrack = monthsToDeadline !== null && projectedMonths !== null
        ? projectedMonths <= monthsToDeadline
        : null;

      return {
        ...g,
        pct,
        remaining,
        isComplete,
        avgSavings,
        monthsToDeadline,
        projectedMonths,
        onTrack,
      };
    });
  }

  // Média da economia mensal: média dos saldos POSITIVOS dos últimos N meses.
  // Saldos negativos contam como 0 (não há economia naquele mês).
  function getAverageSavings(monthCount = 3) {
    const today = new Date();
    let total = 0;
    let count = 0;

    for (let i = 0; i < monthCount; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const summary = getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      if (summary.balance > 0) {
        total += summary.balance;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  // --- Insights (análise automática do assistente) ---
  function getInsights(year, month) {
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || now.getMonth() + 1;

    const current = getMonthlySummary(y, m);
    const prevDate = new Date(y, m - 2, 1); // mês anterior
    const previous = getMonthlySummary(prevDate.getFullYear(), prevDate.getMonth() + 1);

    const catExpenses = getCategoryExpenses(y, m);
    const prevCatExpenses = getCategoryExpenses(prevDate.getFullYear(), prevDate.getMonth() + 1);
    const totalExpense = catExpenses.reduce((s, e) => s + e.total, 0);
    const prevTotalExpense = prevCatExpenses.reduce((s, e) => s + e.total, 0);

    const insights = [];

    // 1. Categoria mais cara do mês
    if (catExpenses.length > 0) {
      const top = catExpenses[0];
      insights.push({
        type: 'expense',
        title: `Maior gasto: ${top.name}`,
        text: `Você gastou ${formatMoney(top.total)} em ${top.name} neste mês${totalExpense > 0 ? ` (${((top.total / totalExpense) * 100).toFixed(0)}% de todas as despesas)` : ''}.`,
      });
    }

    // 2. Variação de despesas vs mês anterior
    if (prevTotalExpense > 0 && totalExpense > 0) {
      const variation = ((totalExpense - prevTotalExpense) / prevTotalExpense) * 100;
      if (variation > 10) {
        insights.push({
          type: 'warning',
          title: 'Atenção: gastos subiram',
          text: `Suas despesas aumentaram ${variation.toFixed(0)}% em relação ao mês anterior.`,
        });
      } else if (variation < -10) {
        insights.push({
          type: 'success',
          title: 'Gastos em queda',
          text: `Suas despesas caíram ${Math.abs(variation).toFixed(0)}% em relação ao mês anterior. Bom trabalho!`,
        });
      }
    }

    // 3. Taxa de economia do mês
    if (current.income > 0) {
      if (current.balance > 0) {
        insights.push({
          type: 'success',
          title: 'Você economizou este mês',
          text: `Taxa de economia de ${current.savingsRate.toFixed(1)}% — sobrou ${formatMoney(current.balance)}.`,
        });
      } else if (current.balance < 0) {
        insights.push({
          type: 'danger',
          title: 'Mês no vermelho',
          text: `Você gastou ${formatMoney(Math.abs(current.balance))} a mais do que recebeu. Revise suas despesas.`,
        });
      }
    }

    // 4. Comparação com média de 3 meses
    const avg3 = getAverageExpenses(3);
    if (avg3 > 0 && totalExpense > avg3 * 1.2) {
      insights.push({
        type: 'warning',
        title: 'Acima da sua média',
        text: `Seus gastos deste mês estão ${((totalExpense / avg3 - 1) * 100).toFixed(0)}% acima da sua média dos últimos 3 meses (${formatMoney(avg3)}).`,
      });
    } else if (avg3 > 0 && totalExpense > 0 && totalExpense < avg3 * 0.8) {
      insights.push({
        type: 'success',
        title: 'Abaixo da sua média',
        text: `Seus gastos deste mês estão ${((1 - totalExpense / avg3) * 100).toFixed(0)}% abaixo da sua média dos últimos 3 meses.`,
      });
    }

    // 5. Categoria com maior aumento vs mês anterior
    const increases = catExpenses
      .map(e => {
        const prev = prevCatExpenses.find(p => p.categoryId === e.categoryId);
        const prevTotal = prev ? prev.total : 0;
        return { ...e, prevTotal, increase: prevTotal > 0 ? (e.total - prevTotal) : 0 };
      })
      .filter(e => e.increase > 0)
      .sort((a, b) => b.increase - a.increase);

    if (increases.length > 0) {
      const top = increases[0];
      insights.push({
        type: 'warning',
        title: `Maior aumento: ${top.name}`,
        text: `A categoria ${top.name} cresceu ${formatMoney(top.increase)} em relação ao mês anterior.`,
      });
    }

    return insights;
  }

  // Média de despesas dos últimos N meses (só conta meses com gastos).
  function getAverageExpenses(monthCount = 3) {
    const today = new Date();
    let total = 0;
    let count = 0;

    for (let i = 0; i < monthCount; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const summary = getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      if (summary.expense > 0) {
        total += summary.expense;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  // --- Projection (projeção de saldo futuro) ---
  // Projeta o saldo para os próximos N meses usando a média de receitas e
  // despesas dos últimos `historyMonths` meses. Inclui o histórico no retorno
  // para o gráfico mostrar a linha contínua passado → futuro.
  function getProjection(futureMonths = 6, historyMonths = 3) {
    const today = new Date();
    const allTransactions = getTransactions();

    // Saldo atual (todas as transações até hoje)
    let currentBalance = 0;
    allTransactions.forEach(t => {
      currentBalance += t.type === 'income' ? t.amount : -t.amount;
    });

    // Médias dos últimos historyMonths
    let totalIncome = 0;
    let totalExpense = 0;
    let count = 0;
    for (let i = 0; i < historyMonths; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const summary = getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      if (summary.count > 0) {
        totalIncome += summary.income;
        totalExpense += summary.expense;
        count++;
      }
    }

    const avgIncome = count > 0 ? totalIncome / count : 0;
    const avgExpense = count > 0 ? totalExpense / count : 0;
    const netMonthly = avgIncome - avgExpense;

    // Histórico (últimos historyMonths) para contexto no gráfico
    const history = [];
    for (let i = historyMonths - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const summary = getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      history.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        type: 'history',
        income: summary.income,
        expense: summary.expense,
        balance: summary.balance,
      });
    }

    // Projeção futura (a partir do saldo atual acumulado)
    const projection = [];
    let projected = currentBalance;
    for (let i = 1; i <= futureMonths; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      projected += netMonthly;
      projection.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        type: 'projection',
        income: avgIncome,
        expense: avgExpense,
        balance: projected,
      });
    }

    return {
      currentBalance,
      avgIncome,
      avgExpense,
      netMonthly,
      monthsWithData: count,
      history,
      projection,
    };
  }

  // --- Budget Alerts (alertas de orçamento) ---
  function getBudgetAlerts(monthStr) {
    const progress = getBudgetProgress(monthStr || getCurrentMonth());
    return progress
      .filter(b => b.status !== 'normal')
      .map(b => ({
        ...b,
        alertType: b.status, // 'warning' | 'danger'
        message: b.status === 'danger'
          ? `${b.categoryName} estourou o orçamento: ${formatMoney(b.spent)} de ${formatMoney(b.amount)} (${b.percentage.toFixed(1)}%).`
          : `${b.categoryName} está perto do limite: ${formatMoney(b.spent)} de ${formatMoney(b.amount)} (${b.percentage.toFixed(1)}%).`,
      }));
  }

  function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatMoney(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function getBudgetProgress(monthStr) {
    const budgets = getBudgetsByMonth(monthStr);
    const [year, month] = monthStr.split('-').map(Number);
    const expenses = getCategoryExpenses(year, month);

    return budgets.map(b => {
      const cat = getCategory(b.categoryId);
      const spent = expenses.find(e => e.categoryId === b.categoryId);
      const spentAmount = spent ? spent.total : 0;
      const pct = b.amount > 0 ? (spentAmount / b.amount) * 100 : 0;

      return {
        ...b,
        categoryName: cat ? cat.name : 'Removida',
        categoryIcon: cat ? cat.icon : 'fa-solid fa-tag',
        spent: spentAmount,
        remaining: b.amount - spentAmount,
        percentage: pct,
        status: pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'normal',
      };
    });
  }

  // --- Export / Import ---
  function exportAllData() {
    return {
      transactions: getTransactions(),
      categories: getCategories(),
      budgets: getBudgets(),
      goals: getGoals(),
      exportedAt: new Date().toISOString(),
      version: '2.0',
    };
  }

  function importAllData(data) {
    if (!data || !data.version) {
      return { success: false, error: 'Arquivo inválido.' };
    }

    if (data.transactions && Array.isArray(data.transactions)) {
      Storage.set(TRANSACTIONS_KEY, data.transactions);
    }
    if (data.categories && Array.isArray(data.categories)) {
      Storage.set(CATEGORIES_KEY, data.categories);
    }
    if (data.budgets && Array.isArray(data.budgets)) {
      Storage.set(BUDGETS_KEY, data.budgets);
    }
    if (data.goals && Array.isArray(data.goals)) {
      Storage.set(GOALS_KEY, data.goals);
    }

    return { success: true };
  }

  function exportToCSV(transactions) {
    const headers = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Observações'];
    const rows = transactions.map(t => [
      t.date,
      `"${t.description.replace(/"/g, '""')}"`,
      `"${getCategoryName(t.category).replace(/"/g, '""')}"`,
      t.type === 'income' ? 'Receita' : 'Despesa',
      t.type === 'income' ? t.amount : -t.amount,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return '\uFEFF' + csv; // BOM for Excel
  }

  // Public API
  return {
    init,
    // Transactions
    getTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    getTransactionsByFilters,
    // Categories
    getCategories,
    getCategoriesByType,
    getCategory,
    getCategoryName,
    addCategory,
    updateCategory,
    deleteCategory,
    // Budgets
    getBudgets,
    getBudgetsByMonth,
    addBudget,
    updateBudget,
    deleteBudget,
    getBudgetProgress,
    // Goals
    getGoals,
    addGoal,
    updateGoal,
    addGoalContribution,
    deleteGoal,
    getGoalProgress,
    // Assistant
    getInsights,
    getProjection,
    getBudgetAlerts,
    getAverageSavings,
    getAverageExpenses,
    // Aggregations
    getMonthlySummary,
    getMonthlyHistory,
    getCategoryExpenses,
    // Export/Import
    exportAllData,
    importAllData,
    exportToCSV,
  };
})();
