/* ============================================
   FINANÇAS PESSOAIS - Application Logic
   ============================================ */

const App = (() => {
  'use strict';

  // --- State ---
  let currentPage = 'dashboard';
  let charts = {};

  // --- DOM Cache ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // --- Utility Functions ---
  function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
  }

  // Data local (não UTC): evita bug de fuso que retornava o dia anterior
  // entre 00h-05h em UTC-3 quando usava toISOString()
  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // --- Segurança (zero trust): escapa texto antes de qualquer innerHTML ---
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Ícones só podem ser classes Font Awesome válidas (evita XSS via import JSON)
  const ICON_RE = /^fa-[a-z0-9-]+\s+fa-[a-z0-9-]+$/;
  function safeIcon(icon) {
    return (icon && ICON_RE.test(icon)) ? icon : 'fa-solid fa-tag';
  }

  function getCurrentMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getMonthOptions() {
    const months = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push({
        value: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
        label: m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      });
    }
    return months;
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 8);
  }

  // --- Toast ---
  function showToast(message, type = 'success', duration = 3000) {
    const container = $('#toastContainer');
    const icons = {
      success: 'fa-solid fa-check-circle',
      error: 'fa-solid fa-exclamation-circle',
      warning: 'fa-solid fa-exclamation-triangle',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Zero-trust: mensagens podem conter dados do usuário (nomes de categoria etc.) → escapa
    toast.innerHTML = `<i class="${icons[type] || icons.success}"></i> ${esc(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --- Modal System ---
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function closeAllModals() {
    $$('.modal.open').forEach(m => {
      m.classList.remove('open');
    });
    document.body.style.overflow = '';
  }

  // --- Confirmation Dialog ---
  // Resolvedor ativo do confirm — todos os caminhos de saída (confirmar,
  // cancelar, fechar, backdrop, Esc) resolvem a Promise. Nunca pendura.
  let confirmResolver = null;

  function resolveConfirm(result) {
    if (confirmResolver) {
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(result);
    }
  }

  function showConfirm(title, message) {
    return new Promise((resolve) => {
      // Se já existe um confirm pendente, resolve-o como false (evita pendura)
      if (confirmResolver) confirmResolver(false);
      confirmResolver = resolve;
      $('#confirmTitle').textContent = title;
      $('#confirmMessage').textContent = message;
      openModal('confirmModal');
    });
  }

  // --- Sidebar ---
  function toggleSidebar() {
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  }

  function closeSidebar() {
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  }

  // --- Navigation ---
  function navigateTo(page) {
    currentPage = page;

    // Update sidebar
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    $$('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update title
    const titles = {
      dashboard: { title: 'Dashboard', subtitle: 'Visão geral das suas finanças' },
      transacoes: { title: 'Transações', subtitle: 'Gerencie suas receitas e despesas' },
      categorias: { title: 'Categorias', subtitle: 'Organize suas categorias financeiras' },
      orcamentos: { title: 'Orçamentos', subtitle: 'Defina limites mensais por categoria' },
      recorrentes: { title: 'Recorrentes', subtitle: 'Lançamentos automáticos e próximos vencimentos' },
      assistente: { title: 'Assistente', subtitle: 'Metas, insights e projeções inteligentes' },
      relatorios: { title: 'Relatórios', subtitle: 'Análise detalhada das suas finanças' },
      nuvem: { title: 'Nuvem', subtitle: 'Sincronização e backup na nuvem' },
    };

    const info = titles[page] || titles.dashboard;
    $('#pageTitle').textContent = info.title;
    $('#pageSubtitle').textContent = info.subtitle;

    // Render page content
    switch (page) {
      case 'dashboard': renderDashboard(); break;
      case 'transacoes': renderTransactions(); break;
      case 'categorias': renderCategories(); break;
      case 'orcamentos': renderBudgets(); break;
      case 'recorrentes': renderRecurring(); break;
      case 'assistente': renderAssistant(); break;
      case 'relatorios': renderReports(); break;
      case 'nuvem': renderSync(); break;
    }

    // Close sidebar on mobile
    closeSidebar();

    // Update URL hash without scrolling
    history.replaceState(null, '', `#${page}`);
  }

  // ==========================================
  // DASHBOARD
  // ==========================================
  function renderDashboard() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    // Monthly summary
    const summary = DB.getMonthlySummary(year, month);
    $('#monthlyIncome').textContent = formatCurrency(summary.income);
    $('#monthlyExpense').textContent = formatCurrency(summary.expense);

    const balanceEl = $('#monthlyBalance');
    balanceEl.textContent = formatCurrency(summary.balance);
    balanceEl.className = 'card-stat-value ' + (summary.balance >= 0 ? 'text-income' : 'text-expense');

    const savingsRate = summary.income > 0 ? ((summary.income - summary.expense) / summary.income * 100) : 0;
    $('#savingsRate').textContent = savingsRate.toFixed(1) + '%';

    // P5: card "A Pagar" + alerta de contas atrasadas/vencendo
    const pending = DB.getPendingSummary();
    const pendingAmountEl = $('#pendingAmount');
    pendingAmountEl.textContent = formatCurrency(pending.total);
    pendingAmountEl.className = 'card-stat-value text-pending';
    $('#pendingCount').textContent = pending.count > 0
      ? `${pending.count} conta${pending.count !== 1 ? 's' : ''} em aberto`
      : 'Nenhuma conta em aberto';

    const alertEl = $('#pendingAlert');
    if (pending.overdueCount > 0) {
      alertEl.style.display = 'flex';
      alertEl.className = 'card card-alert danger';
      const more = pending.count > pending.overdueCount ? ` Mais ${pending.count - pending.overdueCount} a vencer.` : '';
      alertEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i>
        <span><strong>${pending.overdueCount} conta${pending.overdueCount !== 1 ? 's' : ''} atrasada${pending.overdueCount !== 1 ? 's' : ''}</strong>: ${formatCurrency(pending.overdueTotal)} em aberto.${more}</span>
        <a href="#transacoes" data-page="transacoes" class="btn-link">Ver transações</a>`;
    } else if (pending.count > 0) {
      alertEl.style.display = 'flex';
      alertEl.className = 'card card-alert';
      alertEl.innerHTML = `<i class="fas fa-clock"></i>
        <span><strong>${pending.count} conta${pending.count !== 1 ? 's' : ''} a pagar</strong>: ${formatCurrency(pending.total)} em aberto.</span>
        <a href="#transacoes" data-page="transacoes" class="btn-link">Ver transações</a>`;
    } else {
      alertEl.style.display = 'none';
    }

    // Update sidebar total balance
    const allTransactions = DB.getTransactions();
    const totalBalance = allTransactions.reduce((sum, t) => {
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }, 0);
    const totalEl = $('#totalBalance');
    totalEl.textContent = formatCurrency(totalBalance);
    totalEl.style.color = totalBalance >= 0 ? '' : 'var(--color-expense)';

    // Recent transactions (last 5)
    const recent = DB.getTransactionsByFilters().slice(0, 5);
    const recentContainer = $('#recentTransactions');

    if (recent.length === 0) {
      recentContainer.innerHTML = '<p class="empty-state">Nenhuma transação registrada. Clique em "Nova Transação" para começar.</p>';
    } else {
      recentContainer.innerHTML = recent.map(t => {
        const cat = DB.getCategory(t.category);
        const instBadge = t.installment
          ? `<span class="badge badge-installment" title="Parcela ${t.installment.number} de ${t.installment.total}">${t.installment.number}/${t.installment.total}</span>`
          : '';
        return `
          <div class="transaction-item">
            <div class="transaction-item-left">
              <div class="transaction-item-icon ${t.type}">
                <i class="${safeIcon(cat ? cat.icon : 'fa-solid fa-receipt')}"></i>
              </div>
              <div class="transaction-item-info">
                <span class="transaction-item-desc">${esc(t.description)}${instBadge}</span>
                <span class="transaction-item-meta">
                  ${formatDate(t.date)} — ${esc(cat ? cat.name : 'Sem categoria')}
                </span>
              </div>
            </div>
            <span class="transaction-item-amount ${t.type === 'income' ? 'text-income' : 'text-expense'}">
              ${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}
            </span>
          </div>
        `;
      }).join('');
    }

    // Charts
    renderIncomeExpenseChart();
    renderExpensePieChart();
  }

  function renderIncomeExpenseChart() {
    const canvas = $('#incomeExpenseChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const months = parseInt($('#incomeExpenseChartPeriod').value);

    // Destroy previous chart
    if (charts.incomeExpense) {
      charts.incomeExpense.destroy();
    }

    const history = DB.getMonthlyHistory(months);
    const labels = history.map(h => h.label);
    const incomeData = history.map(h => h.income);
    const expenseData = history.map(h => h.expense);

    charts.incomeExpense = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Receitas',
            data: incomeData,
            backgroundColor: 'rgba(22, 163, 74, 0.8)',
            borderColor: 'rgba(22, 163, 74, 1)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Despesas',
            data: expenseData,
            backgroundColor: 'rgba(220, 38, 38, 0.8)',
            borderColor: 'rgba(220, 38, 38, 1)',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, padding: 20, font: { family: 'Inter' } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (val) => formatCurrency(val),
              font: { family: 'Inter', size: 11 },
            },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Inter', size: 11 } },
          },
        },
      },
    });
  }

  function renderExpensePieChart() {
    const canvas = $('#expensePieChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const period = $('#expensePieChartPeriod').value;
    const today = new Date();

    let year, month;
    if (period === 'thisMonth') {
      year = today.getFullYear();
      month = today.getMonth() + 1;
    } else if (period === 'lastMonth') {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      year = d.getFullYear();
      month = d.getMonth() + 1;
    } else {
      // Last 3 months aggregate
      year = today.getFullYear();
      month = undefined;
    }

    if (charts.expensePie) {
      charts.expensePie.destroy();
    }

    const expenses = DB.getCategoryExpenses(year, period === '3' ? undefined : month);
    const total = expenses.reduce((s, e) => s + e.total, 0);

    if (expenses.length === 0 || total === 0) {
      // Show empty state on canvas
      charts.expensePie = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Sem dados'],
          datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
        },
      });
      return;
    }

    // Limit to top 8 categories
    const topExpenses = expenses.slice(0, 8);
    const otherTotal = expenses.slice(8).reduce((s, e) => s + e.total, 0);

    const labels = topExpenses.map(e => e.name);
    const data = topExpenses.map(e => e.total);
    if (otherTotal > 0) {
      labels.push('Outros');
      data.push(otherTotal);
    }

    const colors = [
      '#2563eb', '#16a34a', '#dc2626', '#d97706',
      '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#94a3b8',
    ];

    charts.expensePie = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.slice(0, data.length),
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 12,
              usePointStyle: true,
              font: { family: 'Inter', size: 11 },
              generateLabels: (chart) => {
                const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                return original.map(label => ({
                  ...label,
                  text: `${label.text} (${((chart.data.datasets[0].data[label.index] / total) * 100).toFixed(1)}%)`,
                }));
              },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return `${ctx.label}: ${formatCurrency(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ==========================================
  // TRANSACTIONS
  // ==========================================
  function renderTransactions() {
    const search = $('#transactionSearch').value;
    const type = $('#transactionTypeFilter').value;
    const category = $('#transactionCategoryFilter').value;
    const month = $('#transactionMonthFilter').value;
    const status = $('#transactionStatusFilter').value;

    const transactions = DB.getTransactionsByFilters({ search, type, category, month, paid: status });
    const tbody = $('#transactionsBody');

    if (transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma transação encontrada.</td></tr>';
    } else {
      tbody.innerHTML = transactions.map(t => {
        const cat = DB.getCategory(t.category);
        const catName = cat ? cat.name : 'Sem categoria';
        const instBadge = t.installment
          ? `<span class="badge badge-installment" title="Parcela ${t.installment.number} de ${t.installment.total}">${t.installment.number}/${t.installment.total}</span>`
          : '';
        const groupBtn = t.installment
          ? `<button class="btn-delete" onclick="App.deleteInstallmentGroup('${t.installment.groupId}')" title="Excluir todas as parcelas (${t.installment.total}x)">
              <i class="fa-solid fa-layer-group"></i>
            </button>`
          : '';
        // P5: status de pagamento (receita é sempre recebida)
        const isIncome = t.type === 'income';
        const paid = isIncome ? true : DB.isPaid(t);
        const overdue = !paid && t.date < getTodayStr();
        const statusBadge = isIncome
          ? '<span class="badge badge-paid">Recebida</span>'
          : paid
            ? '<span class="badge badge-paid">Paga</span>'
            : overdue
              ? '<span class="badge badge-unpaid badge-unpaid--overdue">Atrasada</span>'
              : '<span class="badge badge-unpaid">A pagar</span>';
        const paidBtn = isIncome ? '' : `
          <button class="btn-toggle-paid" onclick="App.togglePaid('${t.id}')" title="${paid ? 'Marcar como não paga' : 'Marcar como paga'}">
            <i class="fas fa-${paid ? 'check-circle' : 'circle'}"></i>
          </button>`;
        return `
          <tr>
            <td>${formatDate(t.date)}</td>
            <td>
              <strong>${esc(t.description)}</strong>${instBadge}
              ${t.notes ? `<br><small class="text-muted">${esc(t.notes)}</small>` : ''}
            </td>
            <td>
              <span class="badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}">
                ${esc(catName)}
              </span>
            </td>
            <td>${t.type === 'income' ? 'Receita' : 'Despesa'}</td>
            <td>${statusBadge}</td>
            <td class="${t.type === 'income' ? 'text-income' : 'text-expense'} fw-600">
              ${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}
            </td>
            <td>
              <div class="actions">
                ${paidBtn}
                <button class="btn-edit" onclick="App.editTransaction('${t.id}')" title="Editar">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="btn-delete" onclick="App.deleteTransaction('${t.id}')" title="Excluir">
                  <i class="fas fa-trash-alt"></i>
                </button>
                ${groupBtn}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Update counts
    const totalAmount = transactions.reduce((sum, t) => {
      return sum + (t.type === 'income' ? t.amount : -t.amount);
    }, 0);
    $('#transactionsCount').textContent = `${transactions.length} transação${transactions.length !== 1 ? 'ões' : ''}`;
    const totalEl = $('#transactionsTotal');
    totalEl.textContent = `Total: ${formatCurrency(totalAmount)}`;
    totalEl.style.color = totalAmount >= 0 ? 'var(--color-income)' : 'var(--color-expense)';
  }

  function setupTransactionFilters() {
    // Populate category filter
    const catSelect = $('#transactionCategoryFilter');
    const allCats = DB.getCategories();
    catSelect.innerHTML = '<option value="all">Todas as categorias</option>' +
      allCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    // Populate month filter (valor completo YYYY-MM → filtra ano+mês, não só mês)
    const monthSelect = $('#transactionMonthFilter');
    const months = getMonthOptions();
    monthSelect.innerHTML = '<option value="all">Todos os meses</option>' +
      months.map(m => `<option value="${m.value}">${m.label}</option>`).join('');

    // Event listeners
    $('#transactionSearch').addEventListener('input', renderTransactions);
    $('#transactionTypeFilter').addEventListener('change', renderTransactions);
    $('#transactionCategoryFilter').addEventListener('change', renderTransactions);
    $('#transactionMonthFilter').addEventListener('change', renderTransactions);
    $('#transactionStatusFilter').addEventListener('change', renderTransactions);
  }

  // --- Transaction Modal ---
  function openTransactionModal(transactionId = null) {
    const modal = $('#transactionModal');
    const title = $('#transactionModalTitle');
    const form = $('#transactionForm');
    form.reset();
    $('#transactionId').value = '';

    // Populate categories
    const catSelect = $('#transactionCategory');
    const type = $('#transactionType').value;
    const cats = DB.getCategoriesByType(type);
    catSelect.innerHTML = '<option value="">Selecione...</option>' +
      cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    // Set default date
    $('#transactionDate').value = getTodayStr();

    if (transactionId) {
      // Edit mode
      title.textContent = 'Editar Transação';
      const transactions = DB.getTransactions();
      const t = transactions.find(t => t.id === transactionId);
      if (t) {
        $('#transactionId').value = t.id;
        $('#transactionType').value = t.type;
        $('#transactionDescription').value = t.description;
        $('#transactionAmount').value = t.amount;
        $('#transactionDate').value = t.date;
        $('#transactionNotes').value = t.notes || '';
        updateCategorySelect(t.type, t.category);
        // P5: status de pagamento (receita = sempre recebida)
        $('#transactionPaid').checked = t.type === 'income' ? true : DB.isPaid(t);
        updatePaidGroupVisibility();
        // Parcelas: em edição de uma parcela gerada, o campo fica oculto
        // (não faz sentido "reparcelar" uma parcela já criada — exclua e recrie)
        const instField = $('#transactionInstallments');
        const instHint = $('#installmentHint');
        if (t.installment) {
          instField.style.display = 'none';
          instHint.style.display = 'none';
        } else {
          instField.style.display = '';
          instField.value = '1';
          instHint.style.display = 'none';
        }
      }
    } else {
      title.textContent = 'Nova Transação';
      const instField = $('#transactionInstallments');
      instField.style.display = '';
      instField.value = '1';
      $('#installmentHint').style.display = 'none';
      // P5: nova despesa nasce "a pagar"; receita nasce "recebida"
      $('#transactionPaid').checked = false;
      updatePaidGroupVisibility();
    }

    openModal('transactionModal');
  }

  // P5: mostra o checkbox "Já foi pago?" apenas para despesa (receita é sempre recebida)
  function updatePaidGroupVisibility() {
    const isExpense = $('#transactionType').value === 'expense';
    const group = $('#transactionPaidGroup');
    group.style.display = isExpense ? '' : 'none';
    if (!isExpense) $('#transactionPaid').checked = true;
  }

  // Popula o select de parcelas (2..48) e controla a dica
  function setupTransactionInstallments() {
    const select = $('#transactionInstallments');
    const hint = $('#installmentHint');
    for (let i = 2; i <= 48; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i}x — parcelado`;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      hint.style.display = select.value !== '1' ? 'block' : 'none';
    });
  }

  function updateCategorySelect(type, selectedId = null) {
    const catSelect = $('#transactionCategory');
    const cats = DB.getCategoriesByType(type);
    catSelect.innerHTML = '<option value="">Selecione...</option>' +
      cats.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  function saveTransaction(e) {
    e.preventDefault();

    const id = $('#transactionId').value;
    const data = {
      type: $('#transactionType').value,
      description: $('#transactionDescription').value,
      amount: $('#transactionAmount').value,
      category: $('#transactionCategory').value,
      date: $('#transactionDate').value,
      notes: $('#transactionNotes').value,
      installments: $('#transactionInstallments').value,
      paid: $('#transactionPaid').checked,
    };

    let result;
    if (id) {
      result = DB.updateTransaction(id, data);
    } else {
      result = DB.addTransaction(data);
    }

    if (result.success) {
      Sync.markDirty();
      closeModal('transactionModal');
      const count = result.transactions ? result.transactions.length : 1;
      const msg = id
        ? 'Transação atualizada!'
        : count > 1
          ? `${count} parcelas criadas!`
          : 'Transação adicionada!';
      showToast(msg, 'success');
      renderDashboard();
      renderTransactions();
      checkBudgetAlerts();
      refreshReminders(); // novas pendências → re-planeja lembretes
    } else {
      showToast(result.error, 'error');
    }
  }

  // --- Transaction Operations (exposed globally) ---
  window.App = window.App || {};

  window.App.editTransaction = function (id) {
    openTransactionModal(id);
  };

  window.App.deleteTransaction = async function (id) {
    const confirmed = await showConfirm('Excluir Transação', 'Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita.');
    if (confirmed) {
      const result = DB.deleteTransaction(id);
      if (result.success) {
        Sync.markDirty();
        showToast('Transação excluída!', 'success');
        renderDashboard();
        renderTransactions();
        refreshReminders();
      } else {
        showToast(result.error, 'error');
      }
    }
  };

  window.App.deleteInstallmentGroup = async function (groupId) {
    const group = DB.getInstallmentGroup(groupId);
    const total = group.length > 0 ? group[0].installment.total : 0;
    const confirmed = await showConfirm(
      'Excluir Parcelas',
      `Tem certeza que deseja excluir TODAS as ${total} parcelas deste grupo? Esta ação não pode ser desfeita.`
    );
    if (confirmed) {
      const result = DB.deleteInstallmentGroup(groupId);
      if (result.success) {
        Sync.markDirty();
        showToast(`${result.count} parcelas excluídas!`, 'success');
        renderDashboard();
        renderTransactions();
        checkBudgetAlerts();
        refreshReminders();
      } else {
        showToast(result.error, 'error');
      }
    }
  };

  // P5: alterna o status pago/não pago de uma despesa
  window.App.togglePaid = function (id) {
    const t = DB.getTransactions().find(x => x.id === id);
    if (!t) return;
    const next = !DB.isPaid(t);
    const result = DB.setTransactionPaid(id, next);
    if (result.success) {
      Sync.markDirty();
      showToast(next ? 'Marcada como paga!' : 'Marcada como a pagar', 'success');
      renderDashboard();
      renderTransactions();
      checkBudgetAlerts();
      refreshReminders(); // paga → remove do agendamento
    } else {
      showToast(result.error, 'error');
    }
  };

  // ==========================================
  // CATEGORIES
  // ==========================================
  function renderCategories() {
    const incomeCats = DB.getCategoriesByType('income');
    const expenseCats = DB.getCategoriesByType('expense');

    $('#incomeCategories').innerHTML = incomeCats.length === 0
      ? '<p class="empty-state">Nenhuma categoria de receita.</p>'
      : incomeCats.map(c => createCategoryItem(c)).join('');

    $('#expenseCategories').innerHTML = expenseCats.length === 0
      ? '<p class="empty-state">Nenhuma categoria de despesa.</p>'
      : expenseCats.map(c => createCategoryItem(c)).join('');
  }

  function createCategoryItem(cat) {
    return `
      <div class="category-item">
        <div class="category-item-left">
          <div class="category-item-icon ${cat.type}">
            <i class="${safeIcon(cat.icon)}"></i>
          </div>
          <span class="category-item-name">${esc(cat.name)}</span>
        </div>
        <div class="category-item-actions">
          <button class="btn-edit" onclick="App.editCategory('${cat.id}')" title="Editar">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn-delete" onclick="App.deleteCategory('${cat.id}')" title="Excluir">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>
    `;
  }

  // --- Category Modal ---
  const ICONS = [
    'fa-solid fa-briefcase', 'fa-solid fa-laptop-code', 'fa-solid fa-chart-line',
    'fa-solid fa-home', 'fa-solid fa-utensils', 'fa-solid fa-car',
    'fa-solid fa-heart-pulse', 'fa-solid fa-graduation-cap', 'fa-solid fa-gamepad',
    'fa-solid fa-file-invoice', 'fa-solid fa-bag-shopping', 'fa-solid fa-repeat',
    'fa-solid fa-triangle-exclamation', 'fa-solid fa-dumbbell', 'fa-solid fa-paw',
    'fa-solid fa-film', 'fa-solid fa-plane', 'fa-solid fa-gift',
    'fa-solid fa-wifi', 'fa-solid fa-lightbulb', 'fa-solid fa-water',
    'fa-solid fa-fire', 'fa-solid fa-tools', 'fa-solid fa-tshirt',
    'fa-solid fa-book', 'fa-solid fa-music', 'fa-solid fa-camera',
    'fa-solid fa-phone', 'fa-solid fa-bus', 'fa-solid fa-taxi',
    'fa-solid fa-credit-card', 'fa-solid fa-piggy-bank', 'fa-solid fa-hand-holding-heart',
    'fa-solid fa-tag', 'fa-solid fa-plus-circle', 'fa-solid fa-minus-circle',
    'fa-solid fa-cart-shopping', 'fa-solid fa-house-chimney', 'fa-solid fa-bolt',
    'fa-solid fa-droplet',
  ];

  function openCategoryModal(categoryId = null) {
    const title = $('#categoryModalTitle');
    const form = $('#categoryForm');
    form.reset();
    $('#categoryId').value = '';

    renderIconPicker(null);

    if (categoryId) {
      title.textContent = 'Editar Categoria';
      const cat = DB.getCategory(categoryId);
      if (cat) {
        $('#categoryId').value = cat.id;
        $('#categoryName').value = cat.name;
        $('#categoryType').value = cat.type;
        renderIconPicker(cat.icon);
      }
    } else {
      title.textContent = 'Nova Categoria';
    }

    openModal('categoryModal');
  }

  function renderIconPicker(selectedIcon) {
    const picker = $('#iconPicker');
    picker.innerHTML = ICONS.map(icon =>
      `<div class="icon-picker-item ${icon === selectedIcon ? 'selected' : ''}" data-icon="${esc(icon)}">
        <i class="${icon}"></i>
      </div>`
    ).join('');

    // Click handler
    picker.querySelectorAll('.icon-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        picker.querySelectorAll('.icon-picker-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  function getSelectedIcon() {
    const selected = $('#iconPicker .selected');
    return selected ? selected.dataset.icon : ICONS[0];
  }

  function saveCategory(e) {
    e.preventDefault();

    const id = $('#categoryId').value;
    const data = {
      name: $('#categoryName').value,
      type: $('#categoryType').value,
      icon: getSelectedIcon(),
    };

    let result;
    if (id) {
      result = DB.updateCategory(id, data);
    } else {
      result = DB.addCategory(data);
    }

    if (result.success) {
      Sync.markDirty();
      closeModal('categoryModal');
      showToast(id ? 'Categoria atualizada!' : 'Categoria criada!', 'success');
      renderCategories();
      renderTransactions();
      setupTransactionFilters();
    } else {
      showToast(result.error, 'error');
    }
  }

  window.App.editCategory = function (id) {
    openCategoryModal(id);
  };

  window.App.deleteCategory = async function (id) {
    const confirmed = await showConfirm('Excluir Categoria', 'Tem certeza que deseja excluir esta categoria?');
    if (confirmed) {
      const result = DB.deleteCategory(id);
      if (result.success) {
        Sync.markDirty();
        showToast('Categoria excluída!', 'success');
        renderCategories();
        setupTransactionFilters();
      } else {
        showToast(result.error, 'error');
      }
    }
  };

  // ==========================================
  // BUDGETS
  // ==========================================
  function renderBudgets() {
    const monthStr = $('#budgetMonthSelect').value;
    if (!monthStr) return;

    const budgets = DB.getBudgetProgress(monthStr);
    const list = $('#budgetList');
    const totalLimit = budgets.reduce((s, b) => s + b.amount, 0);
    const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
    const overallPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;

    // Summary
    $('#budgetTotalText').textContent = `${formatCurrency(totalSpent)} de ${formatCurrency(totalLimit)}`;
    $('#budgetProgressText').textContent = `${overallPct.toFixed(1)}%`;

    // Progress bar
    const progressBar = $('#budgetOverallProgress');
    progressBar.style.width = `${Math.min(overallPct, 100)}%`;
    progressBar.className = 'budget-progress-fill';
    if (overallPct >= 100) progressBar.classList.add('over-budget');
    else if (overallPct >= 80) progressBar.classList.add('warning');

    // Budget items
    if (budgets.length === 0) {
      list.innerHTML = '<p class="empty-state">Nenhum orçamento definido para este mês. Clique em "Definir Orçamento" para começar.</p>';
    } else {
      list.innerHTML = budgets.map(b => {
        const pct = b.percentage;
        const remainingClass = b.remaining >= 0 ? 'text-income' : 'text-expense';
        return `
          <div class="budget-item">
            <div class="budget-item-header">
              <div class="budget-item-category">
                <i class="${safeIcon(b.categoryIcon)}"></i>
                ${esc(b.categoryName)}
              </div>
              <div class="budget-item-header-actions">
                <div class="budget-item-values">
                  <strong class="${remainingClass}">${formatCurrency(b.spent)}</strong>
                  <span class="text-muted">/ ${formatCurrency(b.amount)}</span>
                </div>
                <button class="btn-delete budget-delete-btn" data-id="${b.id}" title="Excluir orçamento" aria-label="Excluir orçamento">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
            <div class="budget-item-bar">
              <div class="budget-item-fill ${b.status}" style="width: ${Math.min(pct, 100)}%"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span class="${pct >= 100 ? 'text-expense' : 'text-muted'}">
                ${pct.toFixed(1)}% utilizado
              </span>
              <span class="${remainingClass}">
                ${b.remaining >= 0 ? 'Restante' : 'Excedido'}: ${formatCurrency(Math.abs(b.remaining))}
              </span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function setupBudgetSelect() {
    const select = $('#budgetMonthSelect');
    const options = getMonthOptions();
    select.innerHTML = options.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
    select.value = getCurrentMonthStr();
    select.addEventListener('change', renderBudgets);
  }

  // --- Budget Modal ---
  function openBudgetModal(budgetId = null) {
    const title = $('#budgetModalTitle');
    const form = $('#budgetForm');
    form.reset();
    $('#budgetId').value = '';

    // Populate expense categories
    const catSelect = $('#budgetCategory');
    const expenseCats = DB.getCategoriesByType('expense');
    catSelect.innerHTML = '<option value="">Selecione...</option>' +
      expenseCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    // Set default month
    $('#budgetMonth').value = getCurrentMonthStr();

    if (budgetId) {
      title.textContent = 'Editar Orçamento';
      const budgets = DB.getBudgets();
      const b = budgets.find(b => b.id === budgetId);
      if (b) {
        $('#budgetId').value = b.id;
        $('#budgetCategory').value = b.categoryId;
        $('#budgetMonth').value = b.month;
        $('#budgetAmount').value = b.amount;
      }
    } else {
      title.textContent = 'Definir Orçamento';
    }

    openModal('budgetModal');
  }

  function saveBudget(e) {
    e.preventDefault();

    const id = $('#budgetId').value;
    const data = {
      categoryId: $('#budgetCategory').value,
      month: $('#budgetMonth').value,
      amount: $('#budgetAmount').value,
    };

    let result;
    if (id) {
      result = DB.updateBudget(id, data);
    } else {
      result = DB.addBudget(data);
    }

    if (result.success) {
      Sync.markDirty();
      closeModal('budgetModal');
      showToast(id ? 'Orçamento atualizado!' : 'Orçamento definido!', 'success');
      renderBudgets();
    } else {
      showToast(result.error, 'error');
    }
  }

  function setupBudgetActions() {
    // Delete budget items on hover - add delete buttons
    // We'll add this via event delegation on the budget list
    $('#budgetList').addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.budget-delete-btn');
      if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        deleteBudgetAction(id);
      }
    });
  }

  async function deleteBudgetAction(id) {
    const confirmed = await showConfirm('Excluir Orçamento', 'Tem certeza que deseja excluir este orçamento?');
    if (confirmed) {
      const result = DB.deleteBudget(id);
      if (result.success) {
        Sync.markDirty();
        showToast('Orçamento excluído!', 'success');
        renderBudgets();
      }
    }
  }

  // ==========================================
  // RECURRENTES
  // ==========================================

  function frequencyLabel(freq) {
    return { monthly: 'Mensal', weekly: 'Semanal', yearly: 'Anual' }[freq] || freq;
  }

  function dayLabel(rec) {
    if (rec.frequency === 'weekly') {
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      return `Toda ${days[rec.day]}`;
    }
    return `Dia ${rec.day}`;
  }

  function renderRecurring() {
    const monthStr = $('#recurringMonthSelect').value || getCurrentMonthStr();
    const recs = DB.getRecurring();
    const list = $('#recurringList');

    if (recs.length === 0) {
      list.innerHTML = '<p class="empty-state">Nenhuma recorrente criada. Clique em "Nova Recorrente" para começar.</p>';
    } else {
      list.innerHTML = recs.map(r => {
        const cat = DB.getCategory(r.category);
        const nextDate = DB.getNextRecurringDate(r, new Date());
        return `
          <div class="recurring-item ${r.active ? '' : 'recurring-inactive'}">
            <div class="recurring-item-left">
              <div class="recurring-item-icon ${r.type}">
                <i class="${safeIcon(cat ? cat.icon : 'fa-solid fa-repeat')}"></i>
              </div>
              <div class="recurring-item-info">
                <span class="recurring-item-desc">${esc(r.description)}</span>
                <span class="recurring-item-meta">
                  ${frequencyLabel(r.frequency)} · ${dayLabel(r)} · ${esc(cat ? cat.name : 'Sem categoria')}
                  ${r.startDate ? ` · desde ${formatDate(r.startDate)}` : ''}
                </span>
              </div>
            </div>
            <div class="recurring-item-right">
              <span class="recurring-item-amount ${r.type === 'income' ? 'text-income' : 'text-expense'}">
                ${r.type === 'income' ? '+' : '-'} ${formatCurrency(r.amount)}
              </span>
              <div class="recurring-item-actions">
                <button class="btn-edit" onclick="App.launchRecurring('${r.id}')" title="Lançar no mês atual" aria-label="Lançar">
                  <i class="fas fa-bolt"></i>
                </button>
                <button class="btn-edit" onclick="App.editRecurring('${r.id}')" title="Editar">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="btn-edit" onclick="App.toggleRecurring('${r.id}')" title="${r.active ? 'Pausar' : 'Reativar'}">
                  <i class="fas fa-${r.active ? 'pause' : 'play'}"></i>
                </button>
                <button class="btn-delete" onclick="App.deleteRecurring('${r.id}')" title="Excluir">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Upcoming occurrences
    renderUpcoming(monthStr);
  }

  function renderUpcoming(monthStr) {
    const container = $('#upcomingList');
    const upcoming = DB.getUpcomingRecurring(3, monthStr + '-01');

    if (upcoming.length === 0) {
      container.innerHTML = '<p class="empty-state">Nenhuma recorrente ativa.</p>';
      return;
    }

    // Group by month
    const byMonth = {};
    upcoming.forEach(({ recurring, occurrences }) => {
      occurrences.forEach(o => {
        if (!byMonth[o.month]) byMonth[o.month] = [];
        byMonth[o.month].push({ ...o, description: recurring.description, type: recurring.type, amount: recurring.amount });
      });
    });

    const months = Object.keys(byMonth).sort();
    container.innerHTML = months.map(m => {
      const items = byMonth[m];
      const total = items.reduce((s, i) => s + (i.type === 'income' ? i.amount : -i.amount), 0);
      return `
        <div class="upcoming-month">
          <strong>${m}</strong>
          <span class="text-muted">(${items.length} vencimento${items.length !== 1 ? 's' : ''})</span>
          <span class="${total >= 0 ? 'text-income' : 'text-expense'} fw-600">${formatCurrency(Math.abs(total))}</span>
        </div>
      `;
    }).join('');
  }

  function setupRecurringSelect() {
    const select = $('#recurringMonthSelect');
    const options = getMonthOptions();
    select.innerHTML = options.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
    select.value = getCurrentMonthStr();
    select.addEventListener('change', renderRecurring);
  }

  function openRecurringModal(recurringId = null) {
    const title = $('#recurringModalTitle');
    const form = $('#recurringForm');
    form.reset();
    $('#recurringId').value = '';

    // Populate expense categories (default)
    const catSelect = $('#recurringCategory');
    const expenseCats = DB.getCategoriesByType('expense');
    catSelect.innerHTML = '<option value="">Selecione...</option>' +
      expenseCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    $('#recurringDay').value = '5';
    $('#recurringFrequency').value = 'monthly';

    if (recurringId) {
      title.textContent = 'Editar Recorrente';
      const rec = DB.getRecurringById(recurringId);
      if (rec) {
        $('#recurringId').value = rec.id;
        $('#recurringDescription').value = rec.description;
        $('#recurringAmount').value = rec.amount;
        $('#recurringType').value = rec.type;
        $('#recurringFrequency').value = rec.frequency;
        $('#recurringDay').value = rec.day;
        $('#recurringStartDate').value = rec.startDate || '';
        $('#recurringNotes').value = rec.notes || '';
        // Update category select for the chosen type
        const cats = DB.getCategoriesByType(rec.type);
        catSelect.innerHTML = '<option value="">Selecione...</option>' +
          cats.map(c => `<option value="${c.id}" ${c.id === rec.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
      }
    } else {
      title.textContent = 'Nova Recorrente';
    }

    openModal('recurringModal');
  }

  function saveRecurring(e) {
    e.preventDefault();

    const id = $('#recurringId').value;
    const data = {
      description: $('#recurringDescription').value,
      amount: $('#recurringAmount').value,
      type: $('#recurringType').value,
      category: $('#recurringCategory').value,
      frequency: $('#recurringFrequency').value,
      day: $('#recurringDay').value,
      startDate: $('#recurringStartDate').value || null,
      notes: $('#recurringNotes').value,
    };

    let result;
    if (id) {
      result = DB.updateRecurring(id, data);
    } else {
      result = DB.addRecurring(data);
    }

    if (result.success) {
      Sync.markDirty();
      closeModal('recurringModal');
      showToast(id ? 'Recorrente atualizada!' : 'Recorrente criada!', 'success');
      renderRecurring();
    } else {
      showToast(result.error, 'error');
    }
  }

  async function deleteRecurringAction(id) {
    const confirmed = await showConfirm('Excluir Recorrente', 'Tem certeza que deseja excluir esta recorrente?');
    if (confirmed) {
      const result = DB.deleteRecurring(id);
      if (result.success) {
        Sync.markDirty();
        showToast('Recorrente excluída!', 'success');
        renderRecurring();
      } else {
        showToast(result.error, 'error');
      }
    }
  }

  function toggleRecurringAction(id) {
    const rec = DB.getRecurringById(id);
    if (!rec) return;
    const result = DB.updateRecurring(id, { ...rec, active: !rec.active });
    if (result.success) {
      Sync.markDirty();
      showToast(rec.active ? 'Recorrente pausada.' : 'Recorrente reativada!', 'success');
      renderRecurring();
    }
  }

  function launchRecurringAction(id) {
    const rec = DB.getRecurringById(id);
    if (!rec) return;
    const monthStr = getCurrentMonthStr();
    const result = DB.generateRecurringTransaction(id, monthStr);
    if (result.success) {
      Sync.markDirty();
      showToast(`Lançamento de ${formatCurrency(rec.amount)} criado!`, 'success');
      renderRecurring();
      renderDashboard();
      renderTransactions();
      checkBudgetAlerts();
    } else {
      showToast(result.error, 'error');
    }
  }

  // Exposed globally
  window.App.launchRecurring = launchRecurringAction;
  window.App.editRecurring = function (id) { openRecurringModal(id); };
  window.App.deleteRecurring = async function (id) { await deleteRecurringAction(id); };
  window.App.toggleRecurring = toggleRecurringAction;

  // ==========================================
  // ASSISTANT (Metas, Insights, Projeções)
  // ==========================================
  const GOAL_ICONS = [
    'fa-solid fa-piggy-bank', 'fa-solid fa-vault', 'fa-solid fa-umbrella-beach',
    'fa-solid fa-plane', 'fa-solid fa-house-chimney', 'fa-solid fa-car',
    'fa-solid fa-graduation-cap', 'fa-solid fa-gift', 'fa-solid fa-gamepad',
    'fa-solid fa-ring', 'fa-solid fa-suitcase', 'fa-solid fa-baby',
    'fa-solid fa-heart', 'fa-solid fa-credit-card', 'fa-solid fa-laptop',
    'fa-solid fa-tools', 'fa-solid fa-trophy', 'fa-solid fa-star',
  ];

  function renderAssistant() {
    const monthStr = $('#assistantMonthSelect').value || getCurrentMonthStr();
    const [year, month] = monthStr.split('-').map(Number);

    renderAssistantAlerts(monthStr);
    renderAssistantStats();
    renderProjectionChart();
    renderGoals();
    renderInsights(year, month);
  }

  function setupAssistantSelect() {
    const select = $('#assistantMonthSelect');
    const options = getMonthOptions();
    select.innerHTML = options.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
    select.value = getCurrentMonthStr();
    select.addEventListener('change', () => {
      const [year, month] = select.value.split('-').map(Number);
      renderAssistantAlerts(select.value);
      renderInsights(year, month);
    });
  }

  function renderAssistantAlerts(monthStr) {
    const container = $('#assistantAlerts');
    const alerts = DB.getBudgetAlerts(monthStr);

    if (alerts.length === 0) {
      container.innerHTML = '';
    } else {
      container.innerHTML = alerts.map(a => `
        <div class="assistant-alert alert-${esc(a.alertType)}">
          <i class="fa-solid ${a.alertType === 'danger' ? 'fa-triangle-exclamation' : 'fa-exclamation'}"></i>
          <span>${esc(a.message)}</span>
          <a href="#orcamentos" data-page="orcamentos" class="btn-link">Ver orçamentos</a>
        </div>
      `).join('');
    }

    updateAssistantBadge(alerts.length);
  }

  function updateAssistantBadge(count) {
    const badge = $('#assistantAlertBadge');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function renderAssistantStats() {
    const projection = DB.getProjection(6, 3);
    const avgSavings = DB.getAverageSavings(3);

    const balanceEl = $('#assistantCurrentBalance');
    balanceEl.textContent = formatCurrency(projection.currentBalance);
    balanceEl.className = 'card-stat-value ' + (projection.currentBalance >= 0 ? 'text-income' : 'text-expense');

    $('#assistantAvgSavings').textContent = formatCurrency(avgSavings);

    const projectedEl = $('#assistantProjectedBalance');
    const projected = projection.projection.length > 0 ? projection.projection[projection.projection.length - 1].balance : projection.currentBalance;
    projectedEl.textContent = formatCurrency(projected);
    projectedEl.className = 'card-stat-value ' + (projected >= 0 ? 'text-income' : 'text-expense');
  }

  function renderProjectionChart() {
    const canvas = $('#projectionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.projection) {
      charts.projection.destroy();
    }

    const data = DB.getProjection(6, 3);
    const labels = [...data.history.map(h => h.label), ...data.projection.map(p => p.label)];
    const balances = [...data.history.map(h => h.balance), ...data.projection.map(p => p.balance)];
    const isProjected = [...data.history.map(() => false), ...data.projection.map(() => true)];

    if (data.monthsWithData === 0 && data.projection.length === 0) {
      charts.projection = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: { responsive: true, maintainAspectRatio: false },
      });
      return;
    }

    const colors = labels.map((_, i) => isProjected[i] ? '#94a3b8' : '#2563eb');
    const pointStyles = labels.map((_, i) => isProjected[i] ? 'rectRot' : 'circle');

    charts.projection = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Saldo projetado',
          data: balances,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          borderWidth: 2,
          pointBackgroundColor: colors,
          pointStyle: pointStyles,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const suffix = isProjected[ctx.dataIndex] ? ' (projeção)' : '';
                return `${ctx.parsed.y >= 0 ? '+' : ''}${formatCurrency(ctx.parsed.y)}${suffix}`;
              },
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: (val) => formatCurrency(val), font: { family: 'Inter', size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        },
        interaction: { intersect: false, mode: 'index' },
      },
    });
  }

  function renderGoals() {
    const container = $('#goalsList');
    const goals = DB.getGoalProgress(3);

    if (goals.length === 0) {
      container.innerHTML = '<p class="empty-state">Nenhuma meta criada. Clique em "Nova Meta" para começar.</p>';
      return;
    }

    container.innerHTML = goals.map(g => {
      const statusLabel = g.isComplete
        ? `<span class="goal-status goal-status--complete"><i class="fa-solid fa-check"></i> Concluída</span>`
        : g.onTrack === false
          ? `<span class="goal-status goal-status--late"><i class="fa-solid fa-clock"></i> Fora do prazo</span>`
          : `<span class="goal-status goal-status--progress"><i class="fa-solid fa-arrow-trend-up"></i> Em andamento</span>`;

      const projectionText = g.isComplete
        ? 'Meta alcançada! Parabéns!'
        : g.projectedMonths !== null
          ? `Ritmo atual: conclusão em ~${g.projectedMonths} ${g.projectedMonths === 1 ? 'mês' : 'meses'}${g.monthsToDeadline !== null ? ` (prazo: ${g.monthsToDeadline} ${g.monthsToDeadline === 1 ? 'mês' : 'meses'})` : ''}`
          : 'Adicione receitas para estimar o prazo de conclusão';

      return `
        <div class="goal-item ${g.isComplete ? 'goal-complete' : ''}">
          <div class="goal-item-header">
            <div class="goal-item-title">
              <i class="${safeIcon(g.icon)} goal-item-icon"></i>
              <div>
                <strong>${esc(g.name)}</strong>
                <span class="goal-item-target">${formatCurrency(g.current)} de ${formatCurrency(g.target)}</span>
              </div>
            </div>
            <div class="goal-item-actions">
              <button class="btn-edit" onclick="App.contributeGoal('${g.id}')" title="Adicionar valor">
                <i class="fa-solid fa-plus"></i>
              </button>
              <button class="btn-edit" onclick="App.editGoal('${g.id}')" title="Editar">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn-delete" onclick="App.deleteGoal('${g.id}')" title="Excluir">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>
          <div class="goal-item-bar">
            <div class="goal-item-fill ${g.isComplete ? 'complete' : g.onTrack === false ? 'late' : ''}" style="width: ${Math.min(g.pct, 100)}%"></div>
          </div>
          <div class="goal-item-footer">
            <span class="goal-item-pct">${g.pct.toFixed(1)}%</span>
            <span class="goal-item-projection ${g.onTrack === false ? 'text-expense' : 'text-muted'}">${esc(projectionText)}</span>
            ${statusLabel}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderInsights(year, month) {
    const container = $('#insightsList');
    const insights = DB.getInsights(year, month);

    if (insights.length === 0) {
      container.innerHTML = '<p class="empty-state">Adicione transações para receber análises personalizadas.</p>';
      return;
    }

    container.innerHTML = insights.map(i => `
      <div class="insight-item insight-${esc(i.type)}">
        <div class="insight-icon">
          <i class="fa-solid ${i.type === 'success' ? 'fa-circle-check' : i.type === 'warning' ? 'fa-triangle-exclamation' : i.type === 'danger' ? 'fa-circle-xmark' : 'fa-circle-info'}"></i>
        </div>
        <div class="insight-body">
          <strong>${esc(i.title)}</strong>
          <p>${esc(i.text)}</p>
        </div>
      </div>
    `).join('');
  }

  // --- Goal Modal ---
  function renderGoalIconPicker(selectedIcon) {
    const picker = $('#goalIconPicker');
    picker.innerHTML = GOAL_ICONS.map(icon =>
      `<div class="icon-picker-item ${icon === selectedIcon ? 'selected' : ''}" data-icon="${esc(icon)}">
        <i class="${icon}"></i>
      </div>`
    ).join('');

    picker.querySelectorAll('.icon-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        picker.querySelectorAll('.icon-picker-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  function getSelectedGoalIcon() {
    const selected = $('#goalIconPicker .selected');
    return selected ? selected.dataset.icon : GOAL_ICONS[0];
  }

  function openGoalModal(goalId = null) {
    const title = $('#goalModalTitle');
    const form = $('#goalForm');
    form.reset();
    $('#goalId').value = '';
    $('#goalDeadline').value = '';
    renderGoalIconPicker(null);

    if (goalId) {
      title.textContent = 'Editar Meta';
      const goal = DB.getGoals().find(g => g.id === goalId);
      if (goal) {
        $('#goalId').value = goal.id;
        $('#goalName').value = goal.name;
        $('#goalTarget').value = goal.target;
        $('#goalCurrent').value = goal.current;
        $('#goalDeadline').value = goal.deadline || '';
        renderGoalIconPicker(goal.icon);
      }
    } else {
      title.textContent = 'Nova Meta';
    }

    openModal('goalModal');
  }

  function saveGoal(e) {
    e.preventDefault();

    const id = $('#goalId').value;
    const data = {
      name: $('#goalName').value,
      target: $('#goalTarget').value,
      current: $('#goalCurrent').value || '0',
      deadline: $('#goalDeadline').value,
      icon: getSelectedGoalIcon(),
    };

    let result;
    if (id) {
      result = DB.updateGoal(id, data);
    } else {
      result = DB.addGoal(data);
    }

    if (result.success) {
      Sync.markDirty();
      closeModal('goalModal');
      showToast(id ? 'Meta atualizada!' : 'Meta criada!', 'success');
      renderGoals();
    } else {
      showToast(result.error, 'error');
    }
  }

  // --- Contribution Modal ---
  function openContributionModal(goalId) {
    const goal = DB.getGoals().find(g => g.id === goalId);
    if (!goal) return;

    $('#contributionGoalId').value = goal.id;
    $('#contributionGoalName').textContent = `Adicionando valor à meta "${goal.name}"`;
    $('#contributionAmount').value = '';
    openModal('contributionModal');
  }

  function saveContribution(e) {
    e.preventDefault();

    const id = $('#contributionGoalId').value;
    const amount = $('#contributionAmount').value;
    const result = DB.addGoalContribution(id, amount);

    if (result.success) {
      Sync.markDirty();
      closeModal('contributionModal');
      showToast('Valor adicionado à meta!', 'success');
      renderGoals();
    } else {
      showToast(result.error, 'error');
    }
  }

  async function deleteGoalAction(id) {
    const confirmed = await showConfirm('Excluir Meta', 'Tem certeza que deseja excluir esta meta?');
    if (confirmed) {
      const result = DB.deleteGoal(id);
      if (result.success) {
        Sync.markDirty();
        showToast('Meta excluída!', 'success');
        renderGoals();
      } else {
        showToast(result.error, 'error');
      }
    }
  }

  // Dispara toasts de alerta quando uma transação faz um orçamento passar de 80%/100%
  function checkBudgetAlerts() {
    const alerts = DB.getBudgetAlerts(getCurrentMonthStr());
    if (alerts.length === 0) {
      updateAssistantBadge(0);
      return;
    }

    updateAssistantBadge(alerts.length);
    // Mostra só os dois mais críticos para não encher de toasts
    const critical = alerts
      .filter(a => a.alertType === 'danger')
      .concat(alerts.filter(a => a.alertType === 'warning'))
      .slice(0, 2);

    critical.forEach(a => {
      showToast(a.message, a.alertType === 'danger' ? 'error' : 'warning', 5000);
    });
  }

  // Ações expostas globalmente (chamadas por onclick nos renders)
  window.App.editGoal = function (id) { openGoalModal(id); };
  window.App.deleteGoal = async function (id) { await deleteGoalAction(id); };
  window.App.contributeGoal = function (id) { openContributionModal(id); };

  // ==========================================
  // REPORTS
  // ==========================================
  function renderReports() {
    const year = parseInt($('#reportYear').value);
    const month = $('#reportMonth').value;

    // Monthly chart
    renderReportMonthlyChart(year, month);

    // Pie chart
    renderReportPieChart(year, month);

    // Top categories
    renderTopCategories(year, month);

    // Summary
    renderReportSummary(year, month);
  }

  function renderReportMonthlyChart(year, month) {
    const canvas = $('#reportMonthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.reportMonthly) {
      charts.reportMonthly.destroy();
    }

    const history = DB.getMonthlyHistory(12);
    let filtered = history;

    if (month !== 'all') {
      filtered = history.filter(h => {
        const m = parseInt(h.month.split('-')[1]);
        return m === parseInt(month);
      });
    }

    // If filtered by month, show daily data would be ideal, but we show averages
    if (filtered.length === 0) {
      charts.reportMonthly = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: { responsive: true, maintainAspectRatio: false },
      });
      return;
    }

    const labels = filtered.map(h => h.label);
    const incomeData = filtered.map(h => h.income);
    const expenseData = filtered.map(h => h.expense);
    const balanceData = filtered.map(h => h.balance);

    charts.reportMonthly = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Receitas',
            data: incomeData,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
          },
          {
            label: 'Despesas',
            data: expenseData,
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
          },
          {
            label: 'Saldo',
            data: balanceData,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
            borderDash: [5, 5],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, font: { family: 'Inter' } } },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (val) => formatCurrency(val), font: { family: 'Inter', size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        },
        interaction: { intersect: false, mode: 'index' },
      },
    });
  }

  function renderReportPieChart(year, month) {
    const canvas = $('#reportPieChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.reportPie) {
      charts.reportPie.destroy();
    }

    const expenses = DB.getCategoryExpenses(year, month !== 'all' ? parseInt(month) : undefined);
    const total = expenses.reduce((s, e) => s + e.total, 0);

    if (expenses.length === 0 || total === 0) {
      charts.reportPie = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Sem dados'], datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
      });
      return;
    }

    const topExpenses = expenses.slice(0, 8);
    const otherTotal = expenses.slice(8).reduce((s, e) => s + e.total, 0);
    const labels = topExpenses.map(e => e.name);
    const data = topExpenses.map(e => e.total);
    if (otherTotal > 0) { labels.push('Outros'); data.push(otherTotal); }

    const colors = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#94a3b8'];

    charts.reportPie = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: '#ffffff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 10, usePointStyle: true, font: { family: 'Inter', size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    });
  }

  function renderTopCategories(year, month) {
    const container = $('#topCategories');
    const expenses = DB.getCategoryExpenses(year, month !== 'all' ? parseInt(month) : undefined);
    const total = expenses.reduce((s, e) => s + e.total, 0);

    if (expenses.length === 0 || total === 0) {
      container.innerHTML = '<p class="empty-state">Sem dados no período.</p>';
      return;
    }

    const top = expenses.slice(0, 5);
    container.innerHTML = top.map((e, i) => {
      const pct = ((e.total / total) * 100).toFixed(1);
      return `
        <div class="top-category-item">
          <span class="top-category-rank">${i + 1}</span>
          <i class="${safeIcon(e.icon)} top-category-icon"></i>
          <span class="top-category-name">${esc(e.name)}</span>
          <span class="top-category-amount">${formatCurrency(e.total)}</span>
          <span class="top-category-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  function renderReportSummary(year, month) {
    let totalIncome = 0;
    let totalExpense = 0;
    let count = 0;
    let largestExpense = 0;

    const transactions = DB.getTransactions().filter(t => {
      const d = new Date(t.date + 'T00:00:00');
      if (d.getFullYear() !== year) return false;
      if (month !== 'all' && d.getMonth() + 1 !== parseInt(month)) return false;
      return true;
    });

    transactions.forEach(t => {
      if (t.type === 'income') totalIncome += t.amount;
      else {
        totalExpense += t.amount;
        if (t.amount > largestExpense) largestExpense = t.amount;
      }
      count++;
    });

    const balance = totalIncome - totalExpense;
    const avgTransaction = count > 0 ? (totalIncome + totalExpense) / count : 0;

    $('#reportTotalIncome').textContent = formatCurrency(totalIncome);
    $('#reportTotalExpense').textContent = formatCurrency(totalExpense);

    const balanceEl = $('#reportTotalBalance');
    balanceEl.textContent = formatCurrency(balance);
    balanceEl.className = 'value ' + (balance >= 0 ? 'text-income' : 'text-expense');

    $('#reportTransactionCount').textContent = count;
    $('#reportLargestExpense').textContent = formatCurrency(largestExpense);
    $('#reportAvgTransaction').textContent = formatCurrency(avgTransaction);
  }

  function setupReportFilters() {
    const yearSelect = $('#reportYear');
    const monthSelect = $('#reportMonth');
    const currentYear = new Date().getFullYear();

    // Years (last 5 years)
    for (let y = currentYear; y >= currentYear - 5; y--) {
      yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
    }

    // Months
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    monthSelect.innerHTML = '<option value="all">Ano completo</option>';
    months.forEach((m, i) => {
      monthSelect.innerHTML += `<option value="${i + 1}">${m}</option>`;
    });

    // Set defaults
    yearSelect.value = currentYear;

    // Events
    yearSelect.addEventListener('change', renderReports);
    monthSelect.addEventListener('change', renderReports);
    $('#generateReportBtn').addEventListener('click', renderReports);
  }

  // ==========================================
  // EXPORT / IMPORT
  // ==========================================
  function exportData() {
    const data = DB.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financas-backup-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dados exportados com sucesso!', 'success');
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = DB.importAllData(data);

        if (result.success) {
          Sync.markDirty();
          showToast('Dados importados com sucesso!', 'success');
          navigateTo(currentPage); // Refresh
          refreshReminders(); // pendências mudaram com o import
        } else {
          showToast(result.error, 'error');
        }
      } catch {
        showToast('Erro ao ler o arquivo. Verifique se é um JSON válido.', 'error');
      }
    };

    input.click();
  }

  function exportTransactionsCSV() {
    const transactions = DB.getTransactions();
    if (transactions.length === 0) {
      showToast('Nenhuma transação para exportar.', 'warning');
      return;
    }

    const csv = DB.exportToCSV(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transacoes-${getTodayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Transações exportadas em CSV!', 'success');
  }

  async function clearAllData() {
    const confirmed = await showConfirm(
      'Limpar Todos os Dados',
      'Tem certeza que deseja limpar todos os dados financeiros? Esta ação não pode ser desfeita!'
    );

    if (confirmed) {
      const confirmed2 = await showConfirm(
        'Confirmação Final',
        'Tem CERTEZA? Todos os seus dados serão perdidos permanentemente.'
      );

      if (confirmed2) {
        Storage.clear();
        DB.init();
        Sync.markDirty();
        showToast('Dados limpos com sucesso!', 'success');
        navigateTo(currentPage);
        refreshReminders(); // nada mais a agendar
      }
    }
  }

  // ==========================================
  // CLOUD SYNC (página Nuvem)
  // ==========================================
  function renderSync() {
    const state = Sync.getState();

    $('#syncNotConfigured').style.display = state.configured ? 'none' : 'flex';
    $('#syncNotActive').style.display = (!state.configured || state.active) ? 'none' : 'block';
    $('#syncActive').style.display = (state.configured && state.active) ? 'block' : 'none';

    if (state.configured && state.active) {
      $('#syncCodeDisplay').textContent = state.code;
      $('#syncStatus').textContent = state.lastSync > 0
        ? `Última sincronização: ${new Date(state.lastSync).toLocaleString('pt-BR')}`
        : 'Nunca sincronizado. Toque em "Sincronizar agora".';
    }

    // Card de lembretes é renderizado junto com a página Nuvem
    renderReminders();
  }

  async function handleCreateSpace() {
    const btn = $('#createSpaceBtn');
    btn.disabled = true;
    try {
      const res = await Sync.createSpace();
      if (res.ok) {
        renderSync();
        showToast(`Código criado: ${res.code}`, 'success', 5000);
        Sync.markDirty(); // garante push inicial dos dados atuais
        renderSync();
      } else {
        showToast(res.error || 'Não foi possível criar o código.', 'error');
      }
    } catch {
      showToast('Sem conexão com a nuvem.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function handleEnterCode() {
    const input = $('#enterCodeInput');
    const code = input.value.trim();
    if (!code) {
      showToast('Digite o código do seu espaço.', 'warning');
      return;
    }
    const btn = $('#enterCodeBtn');
    btn.disabled = true;
    try {
      const res = await Sync.activateCode(code);
      input.value = '';
      renderSync();
      if (res.ok) {
        showToast(res.exists ? 'Dados sincronizados!' : 'Espaço ativado!', 'success');
        navigateTo(currentPage);
        renderSync();
      } else {
        showToast(res.error || 'Não foi possível ativar o código.', 'error');
      }
    } catch {
      showToast('Sem conexão com a nuvem.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function handleSyncNow() {
    const btn = $('#syncNowBtn');
    btn.disabled = true;
    try {
      const res = await Sync.syncNow();
      renderSync();
      if (res.ok) {
        showToast(res.synced === 'push'
          ? 'Dados enviados para a nuvem!'
          : res.synced === 'pull'
            ? 'Dados atualizados deste aparelho!'
            : 'Tudo sincronizado!', 'success');
      } else {
        showToast(res.error || 'Falha na sincronização.', 'error');
      }
    } catch {
      showToast('Sem conexão com a nuvem.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function handleCopyCode() {
    const code = $('#syncCodeDisplay').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => showToast('Código copiado!', 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Código copiado!', 'success');
    }
  }

  async function handleDeactivateSpace() {
    const confirmed = await showConfirm(
      'Desativar Nuvem',
      'Desconectar este aparelho do espaço? Seus dados na nuvem e neste aparelho permanecem.'
    );
    if (confirmed) {
      Sync.deactivate();
      renderSync();
      showToast('Nuvem desativada neste aparelho.', 'success');
    }
  }

  async function handleDeleteSpace() {
    const confirmed = await showConfirm(
      'Apagar espaço na nuvem',
      'Apagar TODOS os dados deste espaço na nuvem? Isso é permanente e afeta TODOS os aparelhos que usam este código. Os dados deste aparelho continuam aqui.'
    );
    if (!confirmed) return;
    const confirmed2 = await showConfirm(
      'Última confirmação',
      'Tem certeza? Esta ação não pode ser desfeita. Digite o código para continuar (opcional: clique em Cancelar para abortar).'
    );
    if (!confirmed2) return;
    const btn = $('#deleteSpaceBtn');
    btn.disabled = true;
    try {
      const res = await Sync.deleteSpace();
      renderSync();
      if (res.ok) {
        showToast('Espaço apagado da nuvem.', 'success');
      } else {
        showToast(res.error || 'Não foi possível apagar o espaço.', 'error');
      }
    } catch {
      showToast('Sem conexão com a nuvem.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ==========================================
  // REMINDERS (Lembretes de vencimento)
  // 100% locais: agenda notificações no Service Worker (TimestampTrigger).
  // ==========================================

  function getReminderCfg() {
    return Storage.get('reminders', { enabled: false });
  }

  async function getSwRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.getRegistration() || null;
    } catch {
      return null;
    }
  }

  async function scheduleReminders() {
    if (typeof Reminders === 'undefined' || !Reminders.isSupported()) return 0;
    const sw = await getSwRegistration();
    if (!sw) return 0;
    const list = Reminders.planNotifications(DB.getTransactions());
    const ok = await Reminders.schedule(sw, list);
    return ok ? list.length : 0;
  }

  // Re-planeja silenciosamente quando habilitado (mutação de transações)
  function refreshReminders() {
    const cfg = getReminderCfg();
    if (!cfg.enabled) return;
    scheduleReminders()
      .then((n) => {
        if ($('#reminderState').style.display === 'block') renderRemindersStatus(n);
      })
      .catch(() => {});
  }

  function renderReminders() {
    const supported = typeof Reminders !== 'undefined' && Reminders.isSupported();
    const basicSupported = typeof Reminders !== 'undefined' && Reminders.hasBasicSupport();
    // Mostra o card de lembretes se tiver suporte básico (mesmo sem showTrigger)
    const showUI = basicSupported;
    $('#reminderUnsupported').style.display = supported ? 'none' : (basicSupported ? 'block' : 'block');
    $('#reminderState').style.display = showUI ? 'block' : 'none';
    if (!showUI) return;
    renderRemindersStatus();
  }

  function renderRemindersStatus(justScheduled) {
    const cfg = getReminderCfg();
    const btn = $('#reminderToggleBtn');
    const update = $('#reminderUpdateBtn');
    const status = $('#reminderStatus');
    const unsupported = $('#reminderUnsupported');
    const supported = typeof Reminders !== 'undefined' && Reminders.isSupported();
    btn.innerHTML = cfg.enabled
      ? '<i class="fas fa-bell-slash"></i> Desativar lembretes'
      : '<i class="fas fa-bell"></i> Ativar lembretes';
    update.style.display = cfg.enabled ? 'inline-flex' : 'none';
    const perm = Reminders.permissionState();
    if (!cfg.enabled) {
      status.textContent = perm === 'denied'
        ? 'Notificações bloqueadas no navegador. Libere nas configurações do site para ativar os lembretes.'
        : 'Clique em "Ativar lembretes" para receber avisos das contas a pagar nos próximos 14 dias.';
    } else if (justScheduled !== undefined) {
      status.textContent = justScheduled > 0
        ? `Lembretes ativos para ${justScheduled} conta${justScheduled !== 1 ? 's' : ''} nos próximos 14 dias.`
        : 'Lembretes ativos. Nenhuma conta a pagar nos próximos 14 dias.';
    } else {
      status.textContent = supported
        ? 'Lembretes ativos. Atualizados automaticamente quando você lança ou paga contas.'
        : 'Lembretes ativos (modo básico: avisos aparecem ao abrir o app). Atualize ao lançar/pagar contas.';
    }
    // Mensagem de fallback quando não tem showTrigger
    unsupported.style.display = supported ? 'none' : 'block';
  }

  async function handleReminderToggle() {
    const cfg = getReminderCfg();
    if (cfg.enabled) {
      const sw = await getSwRegistration();
      if (sw) await Reminders.cancel(sw);
      Storage.set('reminders', { enabled: false });
      renderReminders();
      showToast('Lembretes desativados.', 'success');
      return;
    }
    if (!Reminders.canRequest()) return;
    let perm = Reminders.permissionState();
    if (perm !== 'granted') {
      perm = await Reminders.requestPermission();
    }
    if (perm !== 'granted') {
      renderReminders();
      showToast('Permissão de notificação negada. Libere nas configurações do site.', 'error');
      return;
    }
    Storage.set('reminders', { enabled: true });
    const n = await scheduleReminders();
    renderRemindersStatus(n);
    showToast(n > 0 ? `Lembretes ativos para ${n} contas!` : 'Lembretes ativos!', 'success');
  }

  async function handleReminderUpdate() {
    const n = await scheduleReminders();
    renderRemindersStatus(n);
    showToast(n > 0 ? `${n} contas agendadas!` : 'Nenhuma conta a pagar nos próximos 14 dias.', 'success');
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================
  function init() {
    // Initialize database
    DB.init();

    // --- Sidebar ---
    $('#mobileMenuBtn').addEventListener('click', toggleSidebar);
    $('#sidebarToggle').addEventListener('click', toggleSidebar);
    $('#sidebarOverlay').addEventListener('click', closeSidebar);

    // --- Navigation ---
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.page);
      });
    });

    // Event delegation para [data-page] (cobre links renderizados dinamicamente,
    // ex.: alerta de contas a pagar no dashboard)
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-page]');
      if (link) {
        e.preventDefault();
        navigateTo(link.dataset.page);
      }
    });

    // --- Transaction Button ---
    $('#addTransactionBtn').addEventListener('click', () => openTransactionModal());

    // --- Transaction Form ---
    $('#transactionForm').addEventListener('submit', saveTransaction);
    setupTransactionInstallments();
    $('#transactionType').addEventListener('change', (e) => {
      const catSelect = $('#transactionCategory');
      const cats = DB.getCategoriesByType(e.target.value);
      catSelect.innerHTML = '<option value="">Selecione...</option>' +
        cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      // P5: ao trocar para receita, esconde "Já foi pago?" e força recebida
      updatePaidGroupVisibility();
    });
    // Categorização automática: ao digitar a descrição, sugere categoria do histórico
    $('#transactionDescription').addEventListener('input', (e) => {
      const catSelect = $('#transactionCategory');
      if (catSelect.value !== '') return; // usuário já escolheu → não sobrescrever
      const suggestion = DB.suggestCategory(e.target.value, $('#transactionType').value);
      if (!suggestion) return;
      catSelect.value = suggestion.categoryId;
      if (suggestion.categoryName) {
        showToast(`Categoria sugerida: ${suggestion.categoryName}`, 'warning', 2500);
      }
    });

    // --- Category ---
    $('#addCategoryBtn').addEventListener('click', () => openCategoryModal());
    $('#categoryForm').addEventListener('submit', saveCategory);

    // --- Budget ---
    $('#addBudgetBtn').addEventListener('click', () => openBudgetModal());
    $('#budgetForm').addEventListener('submit', saveBudget);
    setupBudgetActions();

    // --- Recurring ---
    $('#addRecurringBtn').addEventListener('click', () => openRecurringModal());
    $('#recurringForm').addEventListener('submit', saveRecurring);

    // --- Goal ---
    $('#addGoalBtn').addEventListener('click', () => openGoalModal());
    $('#addGoalLink').addEventListener('click', (e) => { e.preventDefault(); openGoalModal(); });
    $('#goalForm').addEventListener('submit', saveGoal);
    $('#contributionForm').addEventListener('submit', saveContribution);

    // --- Modal Close ---
    $$('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal');
        if (modal) {
          if (modal.id === 'confirmModal') resolveConfirm(false);
          closeModal(modal.id);
        }
      });
    });

    $$('.modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal');
        if (modal) {
          if (modal.id === 'confirmModal') resolveConfirm(false);
          closeModal(modal.id);
        }
      });
    });

    $$('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', () => {
        const modal = backdrop.closest('.modal');
        if (modal) {
          if (modal.id === 'confirmModal') resolveConfirm(false);
          closeModal(modal.id);
        }
      });
    });

    // Confirmar ação no modal de confirmação
    $('#confirmAction').addEventListener('click', () => {
      resolveConfirm(true);
      closeModal('confirmModal');
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        resolveConfirm(false);
        closeAllModals();
      }
    });

    // --- Export / Import ---
    $('#exportDataBtn').addEventListener('click', exportData);
    $('#importDataBtn').addEventListener('click', importData);
    $('#clearDataBtn').addEventListener('click', clearAllData);
    $('#exportTransactionsBtn').addEventListener('click', exportTransactionsCSV);

    // --- Cloud Sync ---
    $('#createSpaceBtn').addEventListener('click', handleCreateSpace);
    $('#enterCodeBtn').addEventListener('click', handleEnterCode);
    $('#syncNowBtn').addEventListener('click', handleSyncNow);
    $('#copyCodeBtn').addEventListener('click', handleCopyCode);
    $('#deactivateSpaceBtn').addEventListener('click', handleDeactivateSpace);
    $('#deleteSpaceBtn').addEventListener('click', handleDeleteSpace);
    $('#reminderToggleBtn').addEventListener('click', handleReminderToggle);
    $('#reminderUpdateBtn').addEventListener('click', handleReminderUpdate);
    $('#enterCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleEnterCode();
    });
    // Quando um pull aplica dados remotos, re-renderiza a UI
    if (typeof Sync !== 'undefined' && Sync.setOnApplied) {
      Sync.setOnApplied(() => {
        navigateTo(currentPage);
        checkBudgetAlerts();
        renderSync();
        refreshReminders(); // dados remotos mudaram as pendências
      });
    }

    // --- Chart Period ---
    $('#incomeExpenseChartPeriod').addEventListener('change', renderIncomeExpenseChart);
    $('#expensePieChartPeriod').addEventListener('change', renderExpensePieChart);

    // --- Setup ---
    setupTransactionFilters();
    setupBudgetSelect();
    setupRecurringSelect();
    setupAssistantSelect();
    setupReportFilters();

    // --- Navigation from URL hash ---
    const hash = window.location.hash.replace('#', '');
    const validPages = ['dashboard', 'transacoes', 'categorias', 'orcamentos', 'recorrentes', 'assistente', 'relatorios', 'nuvem'];
    const page = validPages.includes(hash) ? hash : 'dashboard';
    navigateTo(page);

    // Badge inicial de alertas de orçamento
    checkBudgetAlerts();

    // Sync inicial: se há um código ativo e configurado, puxa os dados da nuvem
    if (typeof Sync !== 'undefined' && Sync.isConfigured && Sync.isConfigured() && Sync.isActive && Sync.isActive()) {
      Sync.syncNow().catch(() => {});
    }

    // Lembretes: re-planeja ao abrir (cobre contas pagas em outro aparelho/PC)
    refreshReminders();

    // Welcome toast
    setTimeout(() => {
      const total = DB.getTransactions().length;
      if (total === 0) {
        showToast('Bem-vindo! Comece adicionando sua primeira transação.', 'warning', 4000);
      } else {
        showToast(`Bem-vindo! Você tem ${total} transação${total !== 1 ? 'ões' : ''} registradas.`, 'success', 3000);
      }
    }, 500);
  }

  // Public API
  return {
    init,
    editTransaction: window.App.editTransaction,
    deleteTransaction: window.App.deleteTransaction,
    deleteInstallmentGroup: window.App.deleteInstallmentGroup,
    togglePaid: window.App.togglePaid,
    editCategory: window.App.editCategory,
    deleteCategory: window.App.deleteCategory,
    editGoal: window.App.editGoal,
    deleteGoal: window.App.deleteGoal,
    contributeGoal: window.App.contributeGoal,
    launchRecurring: window.App.launchRecurring,
    editRecurring: window.App.editRecurring,
    deleteRecurring: window.App.deleteRecurring,
    toggleRecurring: window.App.toggleRecurring,
  };
})();

// --- Initialize on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
