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
  const RECURRING_KEY = 'recurring';

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
    if (!Storage.get(RECURRING_KEY)) {
      Storage.set(RECURRING_KEY, []);
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
      // month pode vir como 'YYYY-MM' (completo) ou 'MM' (legado)
      const monthStr = String(month);
      transactions = transactions.filter(t => {
        if (monthStr.length === 7) {
          return t.date.slice(0, 7) === monthStr; // '2026-03' casa exatamente
        }
        const d = new Date(t.date + 'T00:00:00');
        // Legado: só o mês 'MM' — assume o ano informado ou o ano ATUAL (não o da transação)
        const wantYear = year && year !== 'all' ? parseInt(year) : new Date().getFullYear();
        return d.getMonth() + 1 === parseInt(month) && d.getFullYear() === wantYear;
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

  // --- Categorização automática (P1) ---
  // Sugere a categoria mais provável para uma descrição, aprendendo do
  // histórico: 1º tenta descrição idêntica normalizada; 2º palavras-chave.
  function normalizeText(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9 ]/g, ' ')      // pontuação vira espaço
      .replace(/\s+/g, ' ')
      .trim();
  }

  function suggestCategory(description, type) {
    const normalized = normalizeText(description);
    if (!normalized) return null;

    const transactions = getTransactions().filter(t => !type || t.type === type);

    // 1º: descrição idêntica (normalizada) no histórico → categoria mais frequente
    const exact = transactions.filter(t => normalizeText(t.description) === normalized);
    if (exact.length > 0) {
      return mostFrequentCategory(exact);
    }

    // 2º: palavras-chave compartilhadas (palavras com 3+ chars)
    const words = normalized.split(' ').filter(w => w.length >= 3);
    if (words.length === 0) return null;

    const candidates = transactions.filter(t => {
      const tWords = normalizeText(t.description).split(' ').filter(w => w.length >= 3);
      return tWords.some(w => words.includes(w));
    });

    if (candidates.length === 0) return null;
    return mostFrequentCategory(candidates);
  }

  // Retorna a categoria mais usada entre as transações (desempate: mais recente)
  function mostFrequentCategory(transactions) {
    const counts = {};
    transactions.forEach(t => {
      if (!t.category) return;
      counts[t.category] = (counts[t.category] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // mais frequente
      return 0;
    });

    if (sorted.length === 0) return null;
    const categoryId = sorted[0][0];
    const cat = getCategory(categoryId);
    return cat ? { categoryId, categoryName: cat.name } : null;
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

  // --- Recurring (transações recorrentes) ---
  // Recorrentes são "modelos" de lançamentos que se repetem. Elas NÃO viram
  // transações automaticamente: o usuário gera a transação do mês quando quiser
  // (botão "Lançar"). A deduplicação usa a marcação `recurringId + recurringDate`
  // na transação — o mesmo vencimento nunca é lançado duas vezes.

  function getRecurring() {
    return Storage.get(RECURRING_KEY, []);
  }

  function getRecurringById(id) {
    return getRecurring().find(r => r.id === id) || null;
  }

  function addRecurring(data) {
    const rawAmount = parseFloat(data.amount);
    const day = parseInt(data.day, 10);

    if (!data.description || !data.description.trim()) {
      return { success: false, error: 'Descrição é obrigatória.' };
    }
    // Zero-trust: valida o valor BRUTO antes de normalizar
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { success: false, error: 'O valor deve ser maior que zero.' };
    }
    if (!data.category) {
      return { success: false, error: 'Selecione uma categoria.' };
    }
    if (RECURRING_FREQUENCIES.indexOf(data.frequency) === -1) {
      return { success: false, error: 'Frequência inválida.' };
    }
    const maxDay = data.frequency === 'weekly' ? 6 : 31;
    const minDay = data.frequency === 'weekly' ? 0 : 1;
    if (!Number.isInteger(day) || day < minDay || day > maxDay) {
      return { success: false, error: data.frequency === 'weekly'
        ? 'Dia da semana inválido (0 = domingo, 6 = sábado).'
        : 'Dia do mês inválido (1 a 31).' };
    }

    const recurring = getRecurring();
    const rec = {
      id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      description: data.description.trim(),
      amount: Math.abs(rawAmount),
      type: data.type,
      category: data.category,
      frequency: data.frequency,
      day,
      startDate: data.startDate || null,
      active: data.active !== false,
      notes: data.notes ? data.notes.trim() : '',
      createdAt: new Date().toISOString(),
    };
    recurring.push(rec);
    Storage.set(RECURRING_KEY, recurring);
    return { success: true, recurring: rec };
  }

  function updateRecurring(id, data) {
    const recurring = getRecurring();
    const index = recurring.findIndex(r => r.id === id);
    if (index === -1) return { success: false, error: 'Recorrente não encontrada.' };

    const rawAmount = parseFloat(data.amount);
    const day = parseInt(data.day, 10);

    if (!data.description || !data.description.trim()) {
      return { success: false, error: 'Descrição é obrigatória.' };
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { success: false, error: 'O valor deve ser maior que zero.' };
    }
    if (RECURRING_FREQUENCIES.indexOf(data.frequency) === -1) {
      return { success: false, error: 'Frequência inválida.' };
    }
    const maxDay = data.frequency === 'weekly' ? 6 : 31;
    const minDay = data.frequency === 'weekly' ? 0 : 1;
    if (!Number.isInteger(day) || day < minDay || day > maxDay) {
      return { success: false, error: data.frequency === 'weekly'
        ? 'Dia da semana inválido (0 = domingo, 6 = sábado).'
        : 'Dia do mês inválido (1 a 31).' };
    }

    recurring[index] = {
      ...recurring[index],
      description: data.description.trim(),
      amount: Math.abs(rawAmount),
      type: data.type,
      category: data.category,
      frequency: data.frequency,
      day,
      startDate: data.startDate || recurring[index].startDate,
      active: data.active !== false,
      notes: data.notes ? data.notes.trim() : '',
    };
    Storage.set(RECURRING_KEY, recurring);
    return { success: true, recurring: recurring[index] };
  }

  function deleteRecurring(id) {
    const recurring = getRecurring();
    const filtered = recurring.filter(r => r.id !== id);
    if (filtered.length === recurring.length) {
      return { success: false, error: 'Recorrente não encontrada.' };
    }
    Storage.set(RECURRING_KEY, filtered);
    return { success: true };
  }

  // --- Datas de vencimento (lógica pura, testável) ---

  // Converte 'YYYY-MM-DD' em Date LOCAL (sem UTC — lição de fuso do getTodayStr)
  function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function clampDay(year, monthIndex, day) {
    return Math.min(day, getDaysInMonth(year, monthIndex));
  }

  // Próxima ocorrência mensal: dia `day` de cada mês (último dia se 31 > dias do mês)
  function nextMonthlyDate(rec, from) {
    let y = from.getFullYear();
    let m = from.getMonth();
    for (let i = 0; i < 48; i++) {
      const candidate = new Date(y, m, clampDay(y, m, rec.day));
      if (candidate >= from) return candidate;
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return null;
  }

  // Próxima ocorrência semanal: dia da semana `day` (0=Dom..6=Sáb), âncora = startDate
  function nextWeeklyDate(rec, from) {
    const anchor = rec.startDate ? parseLocalDate(rec.startDate) : new Date();
    const start = anchor > from ? anchor : from;
    const diff = (rec.day - start.getDay() + 7) % 7;
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + diff);
  }

  // Próxima ocorrência anual: dia `day` do mês da startDate (ou mês atual), todo ano
  function nextYearlyDate(rec, from) {
    const anchor = rec.startDate ? parseLocalDate(rec.startDate) : new Date();
    const monthIndex = anchor.getMonth();
    for (let y = from.getFullYear(); y <= from.getFullYear() + 3; y++) {
      const candidate = new Date(y, monthIndex, clampDay(y, monthIndex, rec.day));
      if (candidate >= from) return candidate;
    }
    return null;
  }

  // Próxima data de vencimento de uma recorrente a partir de `fromDate` (Date local)
  function getNextRecurringDate(rec, fromDate) {
    const from = fromDate || new Date();
    if (rec.frequency === 'weekly') return formatLocalDate(nextWeeklyDate(rec, from));
    if (rec.frequency === 'yearly') return formatLocalDate(nextYearlyDate(rec, from));
    return formatLocalDate(nextMonthlyDate(rec, from));
  }

  // Próximas ocorrências de TODAS as recorrentes ativas até `monthsAhead` meses.
  // Retorna [{ recurring, occurrences: [{ date, month, weekday }] }]
  function getUpcomingRecurring(monthsAhead = 3, refDateStr) {
    const ref = refDateStr ? parseLocalDate(refDateStr) : new Date();
    const horizon = new Date(ref.getFullYear(), ref.getMonth() + monthsAhead, 0); // fim do mês limite
    const recs = getRecurring().filter(r => r.active);

    return recs.map(rec => {
      const occurrences = [];
      let cursor = ref;
      let guard = 0;
      let next = getNextRecurringDate(rec, cursor);
      while (next && guard < 60) {
        const d = parseLocalDate(next);
        if (d > horizon) break;
        occurrences.push({
          date: next,
          month: next.slice(0, 7),
          weekday: d.getDay(),
        });
        cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        next = getNextRecurringDate(rec, cursor);
        guard++;
      }
      return { recurring: rec, occurrences };
    });
  }

  // Gera UMA transação real a partir da recorrente no mês informado ('YYYY-MM').
  // Deduplica por recurringId + recurringDate: o mesmo vencimento nunca duplica.
  function generateRecurringTransaction(recId, monthStr) {
    const rec = getRecurringById(recId);
    if (!rec) return { success: false, error: 'Recorrente não encontrada.' };
    if (!rec.active) return { success: false, error: 'Recorrente está inativa.' };

    const dueDate = getNextRecurringDate(rec, parseLocalDate(monthStr + '-01'));
    if (!dueDate || dueDate.slice(0, 7) !== monthStr) {
      return { success: false, error: 'Esta recorrente não tem vencimento neste mês.' };
    }

    const transactions = getTransactions();
    const existing = transactions.find(t => t.recurringId === rec.id && t.recurringDate === dueDate);
    if (existing) {
      return { success: false, error: `Já lançada em ${dueDate}.` };
    }

    const transaction = {
      id: 'txn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      description: rec.description,
      amount: rec.amount,
      type: rec.type,
      category: rec.category,
      date: dueDate,
      notes: rec.notes || '',
      createdAt: new Date().toISOString(),
      recurringId: rec.id,
      recurringDate: dueDate,
    };
    transactions.push(transaction);
    saveTransactions(transactions);
    return { success: true, transaction };
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
      recurring: getRecurring(),
      exportedAt: new Date().toISOString(),
      version: '2.1',
    };
  }

  // --- Import seguro (zero trust) ---
  // Sanitiza cada item ANTES de gravar: itens malformados são descartados
  // e contabilizados. Se uma coleção inteira for inválida, o import falha
  // (não pode substituir os dados atuais por lixo silenciosamente).

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_RE = /^\d{4}-\d{2}$/;
  const TYPES = ['income', 'expense'];
  const RECURRING_FREQUENCIES = ['monthly', 'weekly', 'yearly'];

  function sanitizeTransaction(t) {
    if (!t || typeof t !== 'object') return null;
    const amount = Number(t.amount);
    if (!t.id || typeof t.description !== 'string' || !t.description.trim()) return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (TYPES.indexOf(t.type) === -1) return null;
    if (typeof t.category !== 'string' || !t.category) return null;
    if (typeof t.date !== 'string' || !DATE_RE.test(t.date)) return null;
    const clean = {
      id: String(t.id),
      description: t.description.trim(),
      amount,
      type: t.type,
      category: t.category,
      date: t.date,
      notes: typeof t.notes === 'string' ? t.notes.trim() : '',
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    };
    // Marcação opcional de recorrente (preservada no backup)
    if (typeof t.recurringId === 'string' && t.recurringId) clean.recurringId = t.recurringId;
    if (typeof t.recurringDate === 'string' && DATE_RE.test(t.recurringDate)) clean.recurringDate = t.recurringDate;
    return clean;
  }

  function sanitizeCategory(c) {
    if (!c || typeof c !== 'object') return null;
    if (!c.id || typeof c.name !== 'string' || !c.name.trim()) return null;
    if (TYPES.indexOf(c.type) === -1) return null;
    return {
      id: String(c.id),
      name: c.name.trim(),
      type: c.type,
      icon: typeof c.icon === 'string' && c.icon ? c.icon : 'fa-solid fa-tag',
    };
  }

  function sanitizeBudget(b) {
    if (!b || typeof b !== 'object') return null;
    const amount = Number(b.amount);
    if (!b.id || typeof b.categoryId !== 'string' || !b.categoryId) return null;
    if (typeof b.month !== 'string' || !MONTH_RE.test(b.month)) return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      id: String(b.id),
      categoryId: b.categoryId,
      month: b.month,
      amount,
    };
  }

  function sanitizeGoal(g) {
    if (!g || typeof g !== 'object') return null;
    const target = Number(g.target);
    const current = Number(g.current) || 0;
    if (!g.id || typeof g.name !== 'string' || !g.name.trim()) return null;
    if (!Number.isFinite(target) || target <= 0) return null;
    if (g.deadline !== null && g.deadline !== undefined && !MONTH_RE.test(String(g.deadline))) return null;
    return {
      id: String(g.id),
      name: g.name.trim(),
      target,
      current: Math.max(0, current),
      deadline: g.deadline || null,
      icon: typeof g.icon === 'string' && g.icon ? g.icon : 'fa-solid fa-piggy-bank',
      createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
    };
  }

  function sanitizeRecurring(r) {
    if (!r || typeof r !== 'object') return null;
    const amount = Number(r.amount);
    const day = Number(r.day);
    if (!r.id || typeof r.description !== 'string' || !r.description.trim()) return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (TYPES.indexOf(r.type) === -1) return null;
    if (typeof r.category !== 'string' || !r.category) return null;
    if (RECURRING_FREQUENCIES.indexOf(r.frequency) === -1) return null;
    if (!Number.isInteger(day) || day < 0 || day > 31) return null;
    if (r.startDate !== null && r.startDate !== undefined &&
      (typeof r.startDate !== 'string' || !DATE_RE.test(r.startDate))) return null;
    return {
      id: String(r.id),
      description: r.description.trim(),
      amount,
      type: r.type,
      category: r.category,
      frequency: r.frequency,
      day,
      startDate: r.startDate || null,
      active: r.active !== false,
      notes: typeof r.notes === 'string' ? r.notes.trim() : '',
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    };
  }

  function importAllData(data) {
    if (!data || typeof data !== 'object' || !data.version) {
      return { success: false, error: 'Arquivo inválido.' };
    }

    let ignored = 0;
    const clean = {};

    // Cada coleção: se presente, sanitiza itens; itens inválidos são descartados
    ['transactions', 'categories', 'budgets', 'goals', 'recurring'].forEach(key => {
      if (data[key] === undefined || data[key] === null) return;
      if (!Array.isArray(data[key])) {
        clean[key] = null;
        return;
      }
      const sanitizer = key === 'transactions' ? sanitizeTransaction
        : key === 'categories' ? sanitizeCategory
        : key === 'budgets' ? sanitizeBudget
        : key === 'goals' ? sanitizeGoal
        : sanitizeRecurring;
      const valid = data[key].map(sanitizer).filter(Boolean);
      ignored += data[key].length - valid.length;
      clean[key] = valid;
    });

    // Falha se alguma coleção presente ficou vazia mas o backup tinha itens
    const failed = Object.keys(clean).filter(key =>
      clean[key] !== null && clean[key].length === 0 && Array.isArray(data[key]) && data[key].length > 0
    );
    if (failed.length > 0) {
      return {
        success: false,
        error: `Dados inválidos em "${failed[0]}": nenhum item válido encontrado.`,
      };
    }

    if (clean.transactions !== null) Storage.set(TRANSACTIONS_KEY, clean.transactions);
    if (clean.categories !== null) Storage.set(CATEGORIES_KEY, clean.categories);
    if (clean.budgets !== null) Storage.set(BUDGETS_KEY, clean.budgets);
    if (clean.goals !== null) Storage.set(GOALS_KEY, clean.goals);
    if (clean.recurring !== null) Storage.set(RECURRING_KEY, clean.recurring);

    return { success: true, ignored };
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
    suggestCategory,
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
    // Recurring
    getRecurring,
    getRecurringById,
    addRecurring,
    updateRecurring,
    deleteRecurring,
    getNextRecurringDate,
    getUpcomingRecurring,
    generateRecurringTransaction,
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
