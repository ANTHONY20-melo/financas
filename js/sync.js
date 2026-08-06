'use strict';

/* ============================================
   SYNC — Sincronização na nuvem SEM login
   ============================================
   Cada espaço de dados é identificado por um CÓDIGO de 12 caracteres
   (ex.: K7Q9-M2X4-ART8). Quem tem o código acessa o espaço.

   - Sem email, sem senha, sem tela de login (produto vendável, zero fricção)
   - Os dados são criptografados NO APARELHO (AES-256-GCM) com chave
     derivada do código via PBKDF2 (150k iterações) → o servidor guarda
     apenas o payload cifrado; nem o dono do banco lê o conteúdo
   - O servidor conhece somente o SHA-256 do código (nunca o código em si)
   - Compartilhe o código com a família: quem tem o código, tem o espaço
   - "Última escrita vence": sync por snapshot completo + sanitização zero-trust
     (reusa DB.importAllData na chegada)
   ============================================ */

const Sync = (() => {
  // ── Configuração do Supabase (chaves PÚBLICAS do seu projeto) ──
  // URL: Dashboard → Settings → API
  // A anon key é pública por design (pode ir para o GitHub); a service role NUNCA.
  let supabaseUrl = 'https://nezifjtwjhgghxjohdys.supabase.co';
  let supabaseAnonKey = 'sb_publishable_gtn8KVNdX55WqvTChxFqYg_LMQSSDgo'; // COLE A ANON KEY AQUI

  // Permite configurar em runtime (também usado nos testes)
  function configure(url, anonKey) {
    if (url) supabaseUrl = url;
    if (anonKey) supabaseAnonKey = anonKey;
  }

  // Chaves locais (localStorage, prefixo financas_)
  const CODE_KEY = 'financas_space_code';
  const DIRTY_KEY = 'financas_space_dirty';
  const DIRTY_AT_KEY = 'financas_space_dirty_at';
  const LAST_SYNC_KEY = 'financas_space_last_sync';

  // Código: 12 chars de um alfabeto sem caracteres ambíguos (0/O/1/I/L fora)
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LENGTH = 12;
  const GROUP_LEN = 4;
  const PBKDF2_ITERATIONS = 150000;
  const DEBOUNCE_MS = 1500;

  let debounceTimer = null;

  // ============================================
  // Funções puras (testáveis em Node)
  // ============================================

  // Remove tudo que não é letra/número e normaliza para maiúsculas
  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Formata 12 chars em grupos de 4: K7Q9-M2X4-ART8
  function formatCode(clean) {
    if (!clean) return '';
    const c = clean.replace(/[^A-Z0-9]/g, '').toUpperCase();
    const groups = [];
    for (let i = 0; i < c.length; i += GROUP_LEN) groups.push(c.slice(i, i + GROUP_LEN));
    return groups.join('-');
  }

  // Gera um código novo com entropia suficiente (~59 bits)
  function generateCode() {
    const chars = new Array(CODE_LENGTH);
    const buf = new Uint32Array(CODE_LENGTH);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(buf);
    } else {
      for (let i = 0; i < CODE_LENGTH; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
    }
    for (let i = 0; i < CODE_LENGTH; i++) {
      chars[i] = CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    }
    return formatCode(chars.join(''));
  }

  function isValidCode(raw) {
    const c = normalizeCode(raw);
    return c.length === CODE_LENGTH && /^[A-Z2-9]+$/.test(c);
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa !== 'undefined') return btoa(bin);
    return Buffer.from(bin, 'binary').toString('base64'); // Node
  }

  function base64ToBytes(b64) {
    let bin;
    if (typeof atob !== 'undefined') bin = atob(b64);
    else bin = Buffer.from(b64, 'base64').toString('binary'); // Node
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  // Deriva a chave AES-256-GCM a partir do código + salt (PBKDF2)
  async function deriveKey(code, saltB64) {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(normalizeCode(code)),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJson(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(enc)) };
  }

  async function decryptJson(b64, ivB64, key) {
    const enc = base64ToBytes(b64);
    const iv = base64ToBytes(ivB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ============================================
  // Estado local (localStorage)
  // ============================================

  function getCode() {
    try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
  }
  function setCode(code) {
    try { localStorage.setItem(CODE_KEY, code); } catch {}
  }
  function clearCode() {
    try { localStorage.removeItem(CODE_KEY); } catch {}
  }
  function isActive() {
    return !!getCode();
  }
  function isConfigured() {
    return !!supabaseAnonKey;
  }

  function markDirty() {
    try {
      localStorage.setItem(DIRTY_KEY, '1');
      localStorage.setItem(DIRTY_AT_KEY, String(Date.now()));
    } catch {}
    scheduleSync();
  }
  function isDirty() {
    try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; }
  }
  function getDirtyAt() {
    try { return Number(localStorage.getItem(DIRTY_AT_KEY)) || 0; } catch { return 0; }
  }
  function clearDirty() {
    try {
      localStorage.removeItem(DIRTY_KEY);
      localStorage.removeItem(DIRTY_AT_KEY);
    } catch {}
  }

  function getLastSync() {
    try { return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch { return 0; }
  }
  function setLastSync(ts) {
    try { localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch {}
  }

  function scheduleSync() {
    if (!isActive() || !isConfigured()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      syncNow().catch(() => {});
    }, DEBOUNCE_MS);
  }

  // ============================================
  // Rede (Supabase REST — RPCs SECURITY DEFINER)
  // ============================================

  async function apiCall(rpc, body) {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function dbApi() {
    return (typeof DB !== 'undefined' && DB && typeof DB.exportAllData === 'function') ? DB : null;
  }

  // ============================================
  // Operações
  // ============================================

  // Envia o snapshot local para a nuvem
  async function push() {
    if (!isConfigured()) return { ok: false, error: 'Sync não configurado.' };
    const code = getCode();
    if (!code) return { ok: false, error: 'Nenhum código ativo.' };
    const db = dbApi();
    if (!db) return { ok: false, error: 'Banco indisponível.' };

    const clean = normalizeCode(code);
    const spaceId = await sha256Hex(clean);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(clean, bytesToBase64(salt));
    const data = db.exportAllData();
    const itemCount =
      (data.transactions || []).length +
      (data.categories || []).length +
      (data.budgets || []).length +
      (data.goals || []).length +
      (data.recurring || []).length;
    const { iv, data: dataEnc } = await encryptJson(data, key);

    const result = await apiCall('space_save', {
      p_space_id: spaceId,
      p_salt: bytesToBase64(salt),
      p_iv: iv,
      p_data_enc: dataEnc,
      p_item_count: itemCount,
    });
    if (result && result.ok === true) {
      clearDirty();
      setLastSync(Date.now());
      return { ok: true, updatedAt: result.updated_at, itemCount };
    }
    return { ok: false, error: (result && result.error) || 'Falha ao sincronizar.' };
  }

  // Baixa o snapshot remoto e aplica localmente (sanitização zero-trust)
  async function pull() {
    if (!isConfigured()) return { ok: false, error: 'Sync não configurado.' };
    const code = getCode();
    if (!code) return { ok: false, error: 'Nenhum código ativo.' };
    const db = dbApi();
    if (!db) return { ok: false, error: 'Banco indisponível.' };

    const clean = normalizeCode(code);
    const spaceId = await sha256Hex(clean);
    const remote = await apiCall('space_get', { p_space_id: spaceId });
    if (!remote || remote.ok !== true) return { ok: false, error: (remote && remote.error) || 'Falha ao buscar dados.' };
    if (!remote.exists) return { ok: true, exists: false };

    let key;
    try {
      key = await deriveKey(clean, remote.salt);
    } catch {
      return { ok: false, error: 'Código inválido.' };
    }
    let data;
    try {
      data = await decryptJson(remote.data_enc, remote.iv, key);
    } catch {
      return { ok: false, error: 'Código incorreto ou dados corrompidos.' };
    }
    const imp = db.importAllData(data);
    if (!imp.success) return { ok: false, error: imp.error };

    const remoteTs = new Date(remote.updated_at).getTime();
    clearDirty();
    setLastSync(remoteTs || Date.now());
    return { ok: true, exists: true, itemCount: remote.item_count, updatedAt: remote.updated_at };
  }

  // Sincronização inteligente: puxa o remoto se mais novo, envia o local se sujo
  async function syncNow() {
    if (!isConfigured()) return { ok: false, error: 'Sync não configurado.', reason: 'not-configured' };
    if (!isActive()) return { ok: false, error: 'Nenhum código ativo.', reason: 'no-code' };
    const db = dbApi();
    if (!db) return { ok: false, error: 'Banco indisponível.', reason: 'no-db' };

    const clean = normalizeCode(getCode());
    const spaceId = await sha256Hex(clean);

    // 1) Consulta o remoto
    let remote;
    try {
      const res = await apiCall('space_get', { p_space_id: spaceId });
      if (!res || res.ok !== true) return { ok: false, error: 'Falha ao consultar a nuvem.', reason: 'rpc' };
      remote = res;
    } catch {
      return { ok: false, error: 'Sem conexão com a nuvem. Tente novamente.', reason: 'network' };
    }

    const remoteTs = remote.exists ? new Date(remote.updated_at).getTime() : 0;
    const dirtyAt = getDirtyAt();

    // 2) Pull: remoto mais novo que nosso último sync E mais novo que a última mudança local
    let pulled = false;
    if (remote.exists && remoteTs > getLastSync() && remoteTs > dirtyAt) {
      try {
        const key = await deriveKey(clean, remote.salt);
        const data = await decryptJson(remote.data_enc, remote.iv, key);
        const imp = db.importAllData(data);
        if (imp.success) {
          pulled = true;
          clearDirty();
          setLastSync(remoteTs || Date.now());
          if (typeof onApplied === 'function') onApplied();
        }
      } catch { /* código errado → não sobrescreve dados locais */ }
    }

    // 3) Push: há mudanças locais pendentes (e o remoto não é mais novo)
    if (isDirty() && (!remote.exists || dirtyAt >= remoteTs)) {
      try {
        const res = await push();
        if (!res.ok) return { ok: false, error: res.error, reason: 'push' };
        return { ok: true, synced: 'push', itemCount: res.itemCount };
      } catch {
        return { ok: false, error: 'Sem conexão com a nuvem.', reason: 'network' };
      }
    }

    return { ok: true, synced: pulled ? 'pull' : 'none', exists: !!remote.exists };
  }

  // Ativa um espaço com código existente (ou cria se não existir)
  async function activateCode(raw) {
    if (!isConfigured()) return { ok: false, error: 'Sync não configurado.' };
    const clean = normalizeCode(raw);
    if (!isValidCode(clean)) {
      return { ok: false, error: 'Código inválido. Use 12 letras e números (ex.: K7Q9-M2X4-ART8).' };
    }
    setCode(formatCode(clean));
    clearDirty();
    setLastSync(0); // força o pull do espaço existente
    return syncNow();
  }

  // Cria um espaço novo: gera código, ativa e envia os dados atuais para a nuvem
  async function createSpace() {
    if (!isConfigured()) return { ok: false, error: 'Sync não configurado.' };
    const code = generateCode();
    setCode(code);
    markDirty(); // garante o push inicial (o espaço não existe ainda)
    const res = await syncNow(); // fará push: não há remoto e há mudança pendente
    return { code, ...res };
  }

  // Desconecta ESTE aparelho (não apaga dados da nuvem nem do aparelho)
  function deactivate() {
    clearCode();
    clearDirty();
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  // Estado atual para a UI
  function getState() {
    const code = getCode();
    return {
      active: !!code,
      configured: isConfigured(),
      code: code ? formatCode(code) : '',
      lastSync: getLastSync(),
      dirty: isDirty(),
    };
  }

  // Callback chamado quando um pull aplica dados remotos (a UI re-renderiza)
  let onApplied = null;

  // Public API
  return {
    configure,
    normalizeCode,
    formatCode,
    generateCode,
    isValidCode,
    sha256Hex,
    bytesToBase64,
    base64ToBytes,
    deriveKey,
    encryptJson,
    decryptJson,
    // estado
    isActive,
    isConfigured,
    markDirty,
    isDirty,
    getState,
    // operações
    push,
    pull,
    syncNow,
    activateCode,
    createSpace,
    deactivate,
    // config
    get setOnApplied() { return (fn) => { onApplied = fn; }; },
  };
})();

if (typeof window !== 'undefined') {
  window.Sync = Sync;
}
