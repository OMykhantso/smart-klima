/* Smart Klima: спільний шар даних для сайту (web) і мобільного застосунку (mobile).
 * Обидва клієнти працюють з однією базою:
 *  - режим "server": REST API на сервері (server/server.js, SQLite);
 *  - режим "demo": якщо сервер недоступний (наприклад, GitHub Pages), та сама логіка
 *    працює на localStorage. Сайт і застосунок на одному домені бачать спільні демо-дані.
 * Адресу API можна задати в shared/config.js (window.SK_API_URL).
 */
(function () {
  const SEED = window.SK_SEED;
  const BASE = (window.SK_API_URL || '').replace(/\/$/, '');
  const DEMO_KEY = 'sk_demo_db_v1';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} },
  };
  const now = () => new Date().toISOString();
  const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  /* ---------- transport: server ---------- */
  async function http(method, url, body, headers = {}) {
    let res;
    try {
      res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new ApiError(0, 'Немає зв\'язку з сервером'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || 'Помилка ' + res.status);
    return data;
  }

  /* ---------- transport: demo (localStorage) ---------- */
  function demoDb() {
    let db = ls.get(DEMO_KEY, null);
    if (!db) {
      db = {
        products: SEED.products, services: SEED.services,
        masters: SEED.masters.map(m => ({ ...m })),
        reviews: SEED.reviews.map((r, i) => ({ id: i + 1, ...r, source: 'seed' })),
        orders: [], sessions: {}, nextOrder: 1, nextReview: SEED.reviews.length + 1,
      };
      ls.set(DEMO_KEY, db);
    }
    return db;
  }
  const saveDemo = db => { ls.set(DEMO_KEY, db); emit(); };
  const pubMaster = ({ pin, ...m }) => m;
  const pubOrder = ({ token, ...o }) => o;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const demo = {
    catalog() { const d = demoDb(); return { products: d.products, services: d.services, masters: d.masters.map(pubMaster) }; },
    reviews() { return demoDb().reviews.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id); },
    addReview(b) {
      const d = demoDb(); const name = str(b.name, 40), text = str(b.text, 600), stars = Math.round(+b.stars);
      if (!name || !text) throw new ApiError(400, 'Вкажіть ім\'я і текст відгуку');
      if (!(stars >= 1 && stars <= 5)) throw new ApiError(400, 'Оцінка має бути від 1 до 5');
      const r = { id: d.nextReview++, name, master: b.master || null, stars, text, date: now().slice(0, 10), source: b.source || 'web' };
      d.reviews.push(r); saveDemo(d); return r;
    },
    createOrder(b) {
      const d = demoDb(); const name = str(b.name, 60), phone = str(b.phone, 20);
      if (!name) throw new ApiError(400, 'Вкажіть ім\'я');
      if (phone.replace(/\D/g, '').length < 10) throw new ApiError(400, 'Перевірте номер телефону: потрібно щонайменше 10 цифр');
      const items = (b.items || []).slice(0, 20).map(i => ({ title: str(i.title, 120), price: Math.max(0, Math.round(+i.price || 0)) })).filter(i => i.title);
      const t = now();
      const o = { id: d.nextOrder++, token: rnd(16), created: t, updated: t, status: 'new', source: b.source || 'web', name, phone,
        addr: str(b.addr, 120), when: str(b.when, 60), master: b.master || '', comment: str(b.comment, 400), items, total: items.reduce((s, i) => s + i.price, 0), note: '' };
      d.orders.push(o); saveDemo(d); return { ...pubOrder(o), token: o.token };
    },
    myOrders(tokens) { return demoDb().orders.filter(o => tokens.includes(o.token)).sort((a, b) => b.created.localeCompare(a.created)).map(pubOrder); },
    admin: {
      check(key) { if (key !== 'admin123') throw new ApiError(401, 'Невірний ключ адміністратора'); },
      orders() { return demoDb().orders.slice().sort((a, b) => b.created.localeCompare(a.created)).map(pubOrder); },
      updateOrder(id, patch) {
        const d = demoDb(); const o = d.orders.find(x => x.id === id); if (!o) throw new ApiError(404, 'Заявку не знайдено');
        if (patch.status !== undefined) o.status = patch.status;
        if (patch.master !== undefined) o.master = patch.master || '';
        o.updated = now(); saveDemo(d); return pubOrder(o);
      },
      deleteOrder(id) { const d = demoDb(); d.orders = d.orders.filter(o => o.id !== id); saveDemo(d); },
      deleteReview(id) { const d = demoDb(); d.reviews = d.reviews.filter(r => r.id !== id); saveDemo(d); },
      setMasterFree(id, free) { const d = demoDb(); const m = d.masters.find(x => x.id === id); m.free = !!free; saveDemo(d); return pubMaster(m); },
    },
    master: {
      login(master, pin) {
        const d = demoDb(); const m = d.masters.find(x => x.id === master);
        if (!m || m.pin !== pin) throw new ApiError(401, 'Невірний PIN');
        const token = rnd(24); d.sessions[token] = m.id; saveDemo(d); return { token, master: pubMaster(m) };
      },
      me(token) { const d = demoDb(); const id = d.sessions[token]; if (!id) throw new ApiError(401, 'Увійдіть як майстер'); return id; },
      orders(token) { const me = demo.master.me(token); return demoDb().orders.filter(o => o.master === me || (!o.master && ['new', 'confirmed'].includes(o.status))).sort((a, b) => b.created.localeCompare(a.created)).map(pubOrder); },
      update(token, id, b) {
        const me = demo.master.me(token); const d = demoDb(); const o = d.orders.find(x => x.id === id);
        if (!o) throw new ApiError(404, 'Заявку не знайдено');
        if (o.master && o.master !== me) throw new ApiError(403, 'Заявка закріплена за іншим майстром');
        if (b.take) { o.master = me; if (o.status === 'new') o.status = 'confirmed'; }
        if (b.status !== undefined) {
          if (!['confirmed', 'onway', 'done'].includes(b.status)) throw new ApiError(400, 'Майстер може ставити лише: підтверджена, виїхав, виконана');
          o.status = b.status; o.master = me;
        }
        if (b.note !== undefined) o.note = str(b.note, 400);
        o.updated = now(); saveDemo(d); return pubOrder(o);
      },
      setFree(token, free) { const me = demo.master.me(token); const d = demoDb(); const m = d.masters.find(x => x.id === me); m.free = !!free; saveDemo(d); return pubMaster(m); },
    },
  };

  /* ---------- live updates ---------- */
  const listeners = new Set();
  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  window.addEventListener('storage', e => { if (e.key === DEMO_KEY) emit(); });
  let pollTimer = null;
  function startPolling() { if (!pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') emit(); }, 15000); }

  /* ---------- public API ---------- */
  let mode = null;
  const ready = (async () => {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal }); clearTimeout(t);
      const j = await r.json(); mode = j && j.mode === 'server' ? 'server' : 'demo';
    } catch (e) { mode = 'demo'; }
    if (mode === 'server') startPolling();
    return mode;
  })();

  const TOKENS = 'sk_order_tokens';
  const myTokens = () => ls.get(TOKENS, []);
  const wrap = fn => async (...a) => { await ready; return fn(...a); };
  const isServer = () => mode === 'server';

  const Api = {
    ready, get mode() { return mode; }, ApiError, SEED,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refresh: emit,
    catalog: wrap(() => isServer() ? http('GET', '/api/catalog') : demo.catalog()),
    reviews: wrap(() => isServer() ? http('GET', '/api/reviews') : demo.reviews()),
    addReview: wrap(async b => { const r = isServer() ? await http('POST', '/api/reviews', b) : demo.addReview(b); if (isServer()) emit(); return r; }),
    createOrder: wrap(async b => {
      const o = isServer() ? await http('POST', '/api/orders', b) : demo.createOrder(b);
      ls.set(TOKENS, [...myTokens(), o.token].slice(-50)); if (isServer()) emit(); return o;
    }),
    myOrders: wrap(() => { const t = myTokens(); if (!t.length) return []; return isServer() ? http('POST', '/api/orders/mine', { tokens: t }) : demo.myOrders(t); }),

    admin: {
      get key() { return ss.get('sk_admin_key'); },
      login: wrap(async key => { if (isServer()) await http('GET', '/api/admin/orders', null, { 'X-Admin-Key': key }); else demo.admin.check(key); ss.set('sk_admin_key', key); }),
      logout() { ss.set('sk_admin_key', ''); },
      orders: wrap(() => isServer() ? http('GET', '/api/admin/orders', null, { 'X-Admin-Key': Api.admin.key }) : demo.admin.orders()),
      updateOrder: wrap(async (id, p) => { const r = isServer() ? await http('PATCH', '/api/admin/orders/' + id, p, { 'X-Admin-Key': Api.admin.key }) : demo.admin.updateOrder(id, p); if (isServer()) emit(); return r; }),
      deleteOrder: wrap(async id => { isServer() ? await http('DELETE', '/api/admin/orders/' + id, null, { 'X-Admin-Key': Api.admin.key }) : demo.admin.deleteOrder(id); if (isServer()) emit(); }),
      deleteReview: wrap(async id => { isServer() ? await http('DELETE', '/api/admin/reviews/' + id, null, { 'X-Admin-Key': Api.admin.key }) : demo.admin.deleteReview(id); if (isServer()) emit(); }),
      setMasterFree: wrap(async (id, free) => { const r = isServer() ? await http('PATCH', '/api/admin/masters/' + id, { free }, { 'X-Admin-Key': Api.admin.key }) : demo.admin.setMasterFree(id, free); if (isServer()) emit(); return r; }),
    },

    master: {
      get session() { return ls.get('sk_master_session', null); },
      login: wrap(async (id, pin) => { const r = isServer() ? await http('POST', '/api/master/login', { master: id, pin }) : demo.master.login(id, pin); ls.set('sk_master_session', r); return r; }),
      logout() { ls.del('sk_master_session'); },
      orders: wrap(() => { const s = Api.master.session; return isServer() ? http('GET', '/api/master/orders', null, { Authorization: 'Bearer ' + s.token }) : demo.master.orders(s.token); }),
      update: wrap(async (id, b) => { const s = Api.master.session; const r = isServer() ? await http('PATCH', '/api/master/orders/' + id, b, { Authorization: 'Bearer ' + s.token }) : demo.master.update(s.token, id, b); if (isServer()) emit(); return r; }),
      setFree: wrap(async free => { const s = Api.master.session; const r = isServer() ? await http('PATCH', '/api/master/me', { free }, { Authorization: 'Bearer ' + s.token }) : demo.master.setFree(s.token, free); if (isServer()) emit(); return r; }),
    },

    resetDemo() { ls.del(DEMO_KEY); emit(); },
  };

  /* ---------- small shared helpers ---------- */
  Api.util = {
    UAH: n => Math.round(n).toLocaleString('uk-UA').replace(/[\s,]/g, ' ') + ' ₴',
    dec: n => String(n).replace('.', ','),
    pad2: n => String(n).padStart(2, '0'),
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtDate: iso => { try { return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } },
    fmtDT: iso => { try { return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } },
    // Q = S × h × q + 0.1 кВт на людину + 0.3 від тепловиділення техніки
    coolingKw: (area, h, q, people, tech) => area * h * q / 1000 + people * 0.1 + tech * 0.3,
    pickClass: kw => { const c = [[7, 2.1], [9, 2.6], [12, 3.5], [18, 5.3], [24, 7.0]].find(x => x[1] >= kw * 0.95); return c ? c[0] : null; },
    ls,
  };

  window.SKApi = Api;
})();
