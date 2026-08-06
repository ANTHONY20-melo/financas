/* ============================================
   FINANÇAS PESSOAIS - Lembretes de Vencimento
   Notificações 100% locais (zero servidor): agenda no Service Worker
   com TimestampTrigger (Chrome/Edge/Android). iPhone/Safari não suporta
   agendamento futuro → fallback é o alerta in-app do Dashboard.
   ============================================ */
'use strict';

const Reminders = (() => {
  const DAYS_AHEAD = 14; // janela de agendamento (dias)
  const TAG_PREFIX = 'financas-reminder-';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Data local de hoje (lição v2: nunca toISOString, que usa UTC)
  function todayStr() {
    return toStr(new Date());
  }

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Pura e testável: lista as notificações para despesas NÃO pagas que
  // vencem entre `from` (inclusive) e `from + daysAhead` (inclusive),
  // ordenadas pela data de vencimento.
  function planNotifications(transactions, opts = {}) {
    const from = opts.from || todayStr();
    const daysAhead = opts.daysAhead === undefined ? DAYS_AHEAD : opts.daysAhead;
    const base = new Date(from + 'T00:00:00');
    const end = new Date(base);
    end.setDate(end.getDate() + daysAhead);
    const endStr = toStr(end);

    return transactions
      .filter((t) => t.type === 'expense' && t.paid === false && t.date >= from && t.date <= endStr)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((t) => {
        const due = new Date(t.date + 'T00:00:00');
        const days = Math.round((due - base) / 86400000);
        return {
          id: t.id,
          date: t.date,
          title: days === 0 ? 'Conta vence hoje' : days === 1 ? 'Conta vence amanhã' : 'Conta vence em ' + days + ' dias',
          body: formatCurrency(t.amount) + ' — ' + t.description,
          timestamp: due.getTime(),
          tag: TAG_PREFIX + t.id + '-' + t.date,
        };
      });
  }

  // --- API do navegador (não testável em Node) ---

  function isSupported() {
    return typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype;
  }

  // Verifica se notificações básicas funcionam (mesmo sem agendamento futuro)
  function hasBasicSupport() {
    return typeof Notification !== 'undefined' && 'requestPermission' in Notification;
  }

  function canRequest() {
    return hasBasicSupport();
  }

  function permissionState() {
    return canRequest() ? Notification.permission : 'unsupported';
  }

  async function requestPermission() {
    if (!canRequest()) return 'unsupported';
    return Notification.requestPermission();
  }

  function postToSw(swReg, payload) {
    if (!swReg || !swReg.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 3000); // safety: SW não respondeu
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(!!e.data && e.data.ok !== false);
      };
      try {
        swReg.active.postMessage(payload, [channel.port2]);
      } catch (err) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  // Agenda no SW (substitui TODAS as anteriores — tags únicas por txn+data
  // evitam duplicatas entre re-planejamentos).
  function schedule(swReg, notifications) {
    return postToSw(swReg, { type: 'schedule-reminders', reminders: notifications });
  }

  // Cancela as agendadas (as já disparadas não podem ser desagendadas).
  function cancel(swReg) {
    return postToSw(swReg, { type: 'cancel-reminders' });
  }

  return {
    planNotifications,
    todayStr,
    isSupported,
    hasBasicSupport,
    canRequest: hasBasicSupport,
    permissionState,
    requestPermission,
    schedule,
    cancel,
    DAYS_AHEAD,
  };
})();
