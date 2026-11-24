/* Smart Klima: клієнт REST API для веб-застосунку.
 * Access-токен живе в пам'яті та sessionStorage, refresh-токен — у localStorage;
 * при відповіді 401 токен оновлюється один раз і запит повторюється. */
(function () {
  'use strict';
  const BASE = (window.SK_API_URL || '').replace(/\/$/, '');
  const ls = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  let session = ls.get('sk_session');   // { accessToken, refreshToken, user }
  const listeners = new Set();
  class ApiError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }

  async function raw(method, path, body, token) {
    let res;
    try { res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new ApiError(0, 'NETWORK', 'Немає зв\'язку з сервером'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error && data.error.code, (data.error && data.error.message) || 'Помилка ' + res.status);
    return data;
  }
  function save(s) { session = s; ls.set('sk_session', s); listeners.forEach(fn => fn(s && s.user)); reconnect(); }
  let refreshing = null;
  async function api(method, path, body) {
    try { return await raw(method, path, body, session && session.accessToken); }
    catch (e) {
      if (e.status !== 401 || !session) throw e;
      try {
        refreshing = refreshing || raw('POST', '/api/auth/refresh', { refreshToken: session.refreshToken }).finally(() => { refreshing = null; });
        const r = await refreshing; save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
      } catch (x) { save(null); throw new ApiError(401, 'SESSION_EXPIRED', 'Сесія завершилась. Увійдіть знову'); }
      return raw(method, path, body, session.accessToken);
    }
  }

  // Події реального часу (SSE): сервер повідомляє про зміни заявок.
  let es = null; const evListeners = new Set();
  function reconnect() {
    if (es) { es.close(); es = null; }
    if (!session || typeof EventSource === 'undefined') return;
    es = new EventSource(BASE + '/api/events?token=' + encodeURIComponent(session.accessToken));
    ['order', 'reviews', 'catalog'].forEach(t => es.addEventListener(t, e => evListeners.forEach(fn => fn(t, e.data))));
    es.onerror = async () => { // токен міг протермінуватись: оновлюємо і перепідключаємось
      es.close(); es = null;
      try { await api('GET', '/api/me'); setTimeout(reconnect, 1000); } catch (e) {}
    };
  }

  window.SK = {
    api, ApiError,
    get user() { return session && session.user; },
    onAuth(fn) { listeners.add(fn); },
    onEvent(fn) { evListeners.add(fn); },
    async login(email, password) { const r = await raw('POST', '/api/auth/login', { email, password }); save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user }); return r.user; },
    async register(d) { const r = await raw('POST', '/api/auth/register', d); save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user }); return r.user; },
    async logout() { if (session) raw('POST', '/api/auth/logout', { refreshToken: session.refreshToken }).catch(() => {}); save(null); },
    start() { reconnect(); },
  };
})();
