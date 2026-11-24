// REST API Smart Klima: маршрути, автентифікація, RBAC, валідація, бізнес-логіка.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx, nowIso } = require('./db.js');
const A = require('./auth.js');
const { calculate, installCost } = require('./calc.js');
const SL = require('./slots.js');
const WF = require('./workflow.js');

const ROOT = path.resolve(__dirname, '..');

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

/* ---------- валідація ---------- */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function normPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  const n = d.length === 10 && d[0] === '0' ? '38' + d : d.length === 9 ? '380' + d : d;
  return /^380\d{9}$/.test(n) ? '+' + n : null;
}
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/* ---------- ліміт частоти ---------- */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return key => {
    const t = Date.now(); const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (arr.length >= limit) fail(429, 'RATE_LIMIT', 'Забагато спроб. Спробуйте за кілька хвилин');
    arr.push(t); hits.set(key, arr);
  };
}

/* ---------- події реального часу (Server-Sent Events) ---------- */
function createBus() {
  const clients = new Set();
  return {
    add(res, user) { const c = { res, user }; clients.add(c); return () => clients.delete(c); },
    // Подія отримують: власник заявки, призначений майстер і всі адміністратори.
    orderChanged(order) {
      const payload = `event: order\ndata: ${JSON.stringify({ id: order.id, status: order.status })}\n\n`;
      for (const c of clients) {
        const u = c.user;
        if (u.role === 'admin' || u.id === order.user_id || (u.role === 'master' && u.masterId === order.master_id)) c.res.write(payload);
      }
    },
    broadcast(event) { for (const c of clients) c.res.write(`event: ${event}\ndata: {}\n\n`); },
    size: () => clients.size,
  };
}

function createApp(db, opts = {}) {
  const now = opts.now || (() => new Date());
  const bus = createBus();
  const limitAuth = rateLimiter(opts.authLimit || 20, 10 * 60 * 1000);
  const limitWrite = rateLimiter(opts.writeLimit || 60, 10 * 60 * 1000);

  /* ---------- допоміжні запити ---------- */
  const userById = id => db.prepare('SELECT id, email, phone, name, role, created_at FROM users WHERE id = ?').get(id);
  const masterOfUser = uid => db.prepare('SELECT id FROM masters WHERE user_id = ?').get(uid)?.id || null;
  const publicMaster = r => ({
    id: r.id, name: r.name, short: r.short, color: r.color, exp: r.exp_years, rating: r.rating, jobs: r.jobs, phone: r.phone,
    district: r.district, bio: r.bio, skills: JSON.parse(r.skills), active: !!r.active,
  });
  const product = r => ({
    id: r.id, brand: r.brand, model: r.model, btu: r.btu, kw: r.kw, area: r.area, noise: r.noise, inv: !!r.inverter, heat: r.heat_min,
    wifi: !!r.wifi, cls: r.energy, price: r.price, old: r.old_price, warranty: r.warranty, color: r.color, dark: !!r.dark, hit: !!r.hit, descr: r.descr, inStock: !!r.in_stock,
  });
  const getOrderRow = id => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  function fullOrder(o, actor) {
    const items = db.prepare('SELECT title, qty, price, product_id, service_id FROM order_items WHERE order_id = ? ORDER BY id').all(o.id);
    const history = db.prepare(`SELECT s.from_status, s.to_status, s.at, u.name AS actor, u.role AS actor_role FROM status_changes s
      LEFT JOIN users u ON u.id = s.actor_id WHERE s.order_id = ? ORDER BY s.id`).all(o.id);
    const m = o.master_id ? db.prepare('SELECT m.*, u.name, u.phone FROM masters m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(o.master_id) : null;
    const review = db.prepare('SELECT stars, text FROM reviews WHERE order_id = ?').get(o.id) || null;
    return {
      id: o.id, kind: o.kind, status: o.status, statusLabel: WF.LABELS[o.status], source: o.source,
      contactName: o.contact_name, contactPhone: o.contact_phone, address: o.address, comment: o.comment, masterNote: o.master_note,
      startsAt: o.starts_at, endsAt: o.ends_at, total: o.total, createdAt: o.created_at, updatedAt: o.updated_at, userId: o.user_id,
      master: m ? { id: m.id, name: m.name, phone: m.phone, short: m.short, color: m.color } : null,
      items, history, review, next: actor ? WF.nextStatuses(o, actor) : [],
    };
  }
  function changeStatus(order, to, actor, at = nowIso()) {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(to, at, order.id);
    db.prepare('INSERT INTO status_changes (order_id, from_status, to_status, actor_id, at) VALUES (?, ?, ?, ?, ?)').run(order.id, order.status, to, actor.id, at);
    if (to === 'done' && order.master_id) db.prepare('UPDATE masters SET jobs = jobs + 1 WHERE id = ?').run(order.master_id);
  }
  const masterBusyError = e => /MASTER_BUSY/.test(e.message) ? new HttpError(409, 'SLOT_TAKEN', 'Цей час щойно зайняли. Оберіть інший слот') : e;

  function tokensFor(u) {
    const masterId = u.role === 'master' ? masterOfUser(u.id) : null;
    return { accessToken: A.signJwt({ sub: u.id, role: u.role, mid: masterId }), refreshToken: A.issueRefresh(db, u.id), expiresIn: A.ACCESS_TTL_SEC, user: { ...userById(u.id), masterId } };
  }

  /* ---------- маршрути ---------- */
  // { m: метод, p: шлях з :параметрами, roles: хто має доступ (немає — публічний), h: обробник(ctx) }
  const R = [];
  const route = (m, p, roles, h) => R.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), roles, h });

  route('GET', '/api/health', null, () => ({ ok: true, time: nowIso() }));

  /* --- автентифікація --- */
  route('POST', '/api/auth/register', null, ({ body, ip }) => {
    limitAuth('auth:' + ip);
    const name = str(body.name, 60), email = str(body.email, 254).toLowerCase(), phone = normPhone(body.phone);
    if (name.length < 2) fail(422, 'VALIDATION', 'Вкажіть ім\'я (щонайменше 2 літери)');
    if (!EMAIL_RE.test(email)) fail(422, 'VALIDATION', 'Перевірте e-mail');
    if (!phone) fail(422, 'VALIDATION', 'Телефон у форматі +380XXXXXXXXX');
    const pp = A.passwordProblem(body.password); if (pp) fail(422, 'VALIDATION', pp);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'EMAIL_TAKEN', 'Цей e-mail уже зареєстровано. Увійдіть');
    const r = db.prepare('INSERT INTO users (email, phone, name, role, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, phone, name, 'client', A.hashPassword(body.password), nowIso());
    return tokensFor({ id: Number(r.lastInsertRowid), role: 'client' });
  });
  route('POST', '/api/auth/login', null, ({ body, ip }) => {
    limitAuth('auth:' + ip);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(body.email, 254).toLowerCase());
    if (!u || !A.verifyPassword(String(body.password || ''), u.pass_hash)) fail(401, 'BAD_CREDENTIALS', 'Невірний e-mail або пароль');
    return tokensFor(u);
  });
  route('POST', '/api/auth/refresh', null, ({ body }) => {
    const r = A.rotateRefresh(db, body.refreshToken);
    if (!r) fail(401, 'BAD_REFRESH', 'Сесія завершилась. Увійдіть знову');
    const u = userById(r.userId); const masterId = u.role === 'master' ? masterOfUser(u.id) : null;
    return { accessToken: A.signJwt({ sub: u.id, role: u.role, mid: masterId }), refreshToken: r.refresh, expiresIn: A.ACCESS_TTL_SEC, user: { ...u, masterId } };
  });
  route('POST', '/api/auth/logout', null, ({ body }) => { A.revokeRefresh(db, body.refreshToken); return { ok: true }; });
  route('GET', '/api/me', ['client', 'master', 'admin'], ({ user }) => ({ ...userById(user.id), masterId: user.masterId }));

  /* --- каталог, відгуки, розрахунок, слоти --- */
  route('GET', '/api/catalog', null, () => {
    const today = SL.kyivNow(now());
    const masters = db.prepare('SELECT m.*, u.name, u.phone FROM masters m JOIN users u ON u.id = m.user_id WHERE m.active = 1 ORDER BY m.id').all().map(publicMaster);
    for (const m of masters) m.freeToday = SL.availableSlots(db, { date: today.date, duration: 60, preferred: m.id, now: now() }).length > 0;
    return {
      products: db.prepare('SELECT * FROM products WHERE in_stock = 1 ORDER BY id').all().map(product),
      services: db.prepare('SELECT id, title, descr AS text, price, duration_min AS duration FROM services ORDER BY id').all(),
      masters, installBase: require('./calc.js').INSTALL_BASE, statuses: WF.LABELS,
    };
  });
  route('GET', '/api/reviews', null, () => db.prepare(`SELECT id, master_id AS master, author AS name, stars, text, substr(created_at, 1, 10) AS date, source
    FROM reviews ORDER BY created_at DESC, id DESC`).all());
  route('POST', '/api/calc', null, ({ body }) => calculate(body));
  route('GET', '/api/slots', null, ({ query }) => {
    const kind = ['install', 'service', 'inspection'].includes(query.kind) ? query.kind : 'inspection';
    const services = kind === 'service' ? db.prepare(`SELECT duration_min FROM services WHERE id IN (${String(query.services || '').split(',').filter(s => /^s\d+$/.test(s)).map(s => `'${s}'`).join(',') || "''"})`).all() : [];
    const duration = SL.jobDuration(kind, { units: Number(query.units) || 1, services });
    return { date: query.date, duration, slots: SL.availableSlots(db, { date: str(query.date, 10), duration, preferred: str(query.master, 10), now: now() }) };
  });

  /* --- заявки клієнта --- */
  route('POST', '/api/orders', ['client', 'admin'], ({ body, user, ip }) => {
    limitWrite('order:' + user.id + ip);
    const kind = body.kind;
    if (!['install', 'service', 'inspection'].includes(kind)) fail(422, 'VALIDATION', 'Оберіть тип виїзду');
    const contactName = str(body.contactName, 60), phone = normPhone(body.contactPhone), address = str(body.address, 160);
    if (contactName.length < 2) fail(422, 'VALIDATION', 'Вкажіть ім\'я контактної особи');
    if (!phone) fail(422, 'VALIDATION', 'Телефон у форматі +380XXXXXXXXX');
    if (address.length < 5) fail(422, 'VALIDATION', 'Вкажіть адресу');
    const date = str(body.date, 10), time = str(body.time, 5);
    if (!SL.isDate(date) || !/^\d{2}:\d{2}$/.test(time)) fail(422, 'VALIDATION', 'Оберіть дату і час');

    // Позиції: ціни беруться лише з БД.
    const items = [];
    const prodIds = Array.isArray(body.products) ? body.products.slice(0, 5) : [];
    let units = 0;
    for (const p of prodIds) {
      const row = db.prepare('SELECT * FROM products WHERE id = ? AND in_stock = 1').get(Number(p.id));
      if (!row) fail(422, 'VALIDATION', 'Модель не знайдено або немає в наявності');
      const qty = Math.min(5, Math.max(1, Math.round(Number(p.qty) || 1))); units += qty;
      items.push({ product_id: row.id, title: `${row.brand} ${row.model}`, qty, price: row.price * qty, btu: row.btu });
    }
    const svcIds = Array.isArray(body.services) ? [...new Set(body.services)].slice(0, 6) : [];
    const svcRows = svcIds.map(id => db.prepare('SELECT * FROM services WHERE id = ?').get(String(id)) || fail(422, 'VALIDATION', 'Послугу не знайдено'));
    for (const s of svcRows) items.push({ service_id: s.id, title: s.title, qty: 1, price: s.price });
    if (kind === 'install') {
      if (!items.some(i => i.product_id)) fail(422, 'VALIDATION', 'Для монтажу оберіть кондиціонер');
      for (const i of items.filter(i => i.product_id)) {
        const inst = installCost({ btu: i.btu, ...(body.install || {}) });
        items.push({ title: `Монтаж ${i.title}${i.qty > 1 ? ' × ' + i.qty : ''}: ${inst.lines.map(l => l.title).join('; ')}`, qty: i.qty, price: inst.total * i.qty });
      }
    }
    if (kind === 'service' && !svcRows.length) fail(422, 'VALIDATION', 'Оберіть послугу');
    const duration = SL.jobDuration(kind, { units: units || 1, services: svcRows });

    // Перевірка часу та вибір майстра.
    const slots = SL.availableSlots(db, { date, duration, preferred: str(body.masterId, 10), now: now() });
    if (!slots.some(s => s.time === time)) fail(409, 'SLOT_TAKEN', 'Цей час недоступний. Оберіть інший слот', slots.slice(0, 5));
    const total = items.reduce((s, i) => s + i.price, 0);
    const at = nowIso();
    try {
      const id = tx(db, () => {
        const masterId = SL.chooseMaster(db, { date, time, duration, preferred: str(body.masterId, 10) });
        if (!masterId) throw new Error('MASTER_BUSY');
        const r = db.prepare(`INSERT INTO orders (user_id, kind, status, source, contact_name, contact_phone, address, master_id, starts_at, ends_at, comment, total, created_at, updated_at)
          VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(user.id, kind, body.source === 'mobile' ? 'mobile' : 'web', contactName, phone, address, masterId, `${date} ${time}`, `${date} ${SL.toHHMM(SL.toMin(time) + duration)}`, str(body.comment, 400), total, at, at);
        const oid = Number(r.lastInsertRowid);
        const ins = db.prepare('INSERT INTO order_items (order_id, product_id, service_id, title, qty, price) VALUES (?, ?, ?, ?, ?, ?)');
        for (const i of items) ins.run(oid, i.product_id || null, i.service_id || null, i.title.slice(0, 300), i.qty, i.price);
        db.prepare('INSERT INTO status_changes (order_id, from_status, to_status, actor_id, at) VALUES (?, NULL, ?, ?, ?)').run(oid, 'new', user.id, at);
        return oid;
      });
      const o = getOrderRow(id); bus.orderChanged(o);
      return fullOrder(o, user);
    } catch (e) { throw masterBusyError(e); }
  });
  route('GET', '/api/orders/my', ['client', 'admin'], ({ user }) =>
    db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id).map(o => fullOrder(o, user)));
  route('GET', '/api/orders/:id', ['client', 'master', 'admin'], ({ user, params }) => {
    const o = getOrderRow(Number(params.id)); if (!o) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    if (user.role === 'client' && o.user_id !== user.id) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    if (user.role === 'master' && o.master_id !== user.masterId) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    return fullOrder(o, user);
  });
  route('PATCH', '/api/orders/:id/status', ['client', 'master', 'admin'], ({ user, params, body }) => {
    const o = getOrderRow(Number(params.id)); if (!o) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    const t = SL.kyivNow(now());
    const minutesToStart = o.starts_at.slice(0, 10) === t.date ? SL.toMin(o.starts_at.slice(11)) - t.min
      : (Date.parse(o.starts_at.slice(0, 10)) - Date.parse(t.date)) / 60000 + SL.toMin(o.starts_at.slice(11)) - t.min;
    try { WF.assertTransition(o, String(body.status), user, { minutesToStart }); }
    catch (e) { if (e instanceof WF.TransitionError) fail(e.status, e.code, e.message); throw e; }
    tx(db, () => changeStatus(o, body.status, user));
    const n = getOrderRow(o.id); bus.orderChanged(n);
    return fullOrder(n, user);
  });
  route('POST', '/api/orders/:id/review', ['client'], ({ user, params, body }) => {
    limitWrite('review:' + user.id);
    const o = getOrderRow(Number(params.id));
    if (!o || o.user_id !== user.id) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    if (o.status !== 'done') fail(409, 'NOT_DONE', 'Відгук можна залишити після виконання робіт');
    const stars = Math.round(Number(body.stars)), text = str(body.text, 600);
    if (!(stars >= 1 && stars <= 5)) fail(422, 'VALIDATION', 'Оцінка від 1 до 5');
    if (text.length < 3) fail(422, 'VALIDATION', 'Напишіть кілька слів');
    if (db.prepare('SELECT 1 FROM reviews WHERE order_id = ?').get(o.id)) fail(409, 'ALREADY_REVIEWED', 'Відгук на цю заявку вже є');
    tx(db, () => {
      db.prepare('INSERT INTO reviews (user_id, order_id, master_id, author, stars, text, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, o.id, o.master_id, userById(user.id).name, stars, text, nowIso(), body.source === 'mobile' ? 'mobile' : 'web');
      if (o.master_id) db.prepare(`UPDATE masters SET rating = (SELECT ROUND(AVG(stars), 1) FROM reviews WHERE master_id = ?) WHERE id = ?`).run(o.master_id, o.master_id);
    });
    bus.broadcast('reviews');
    return { ok: true };
  });

  /* --- майстер --- */
  route('GET', '/api/master/schedule', ['master'], ({ user, query }) => {
    const from = SL.isDate(query.from) ? query.from : SL.addDays(SL.kyivNow(now()).date, -30);
    return db.prepare(`SELECT * FROM orders WHERE master_id = ? AND substr(starts_at, 1, 10) >= ? ORDER BY starts_at`).all(user.masterId, from).map(o => fullOrder(o, user));
  });
  route('PATCH', '/api/orders/:id/note', ['master'], ({ user, params, body }) => {
    const o = getOrderRow(Number(params.id));
    if (!o || o.master_id !== user.masterId) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    db.prepare('UPDATE orders SET master_note = ?, updated_at = ? WHERE id = ?').run(str(body.note, 400), nowIso(), o.id);
    const n = getOrderRow(o.id); bus.orderChanged(n); return fullOrder(n, user);
  });
  route('GET', '/api/master/days-off', ['master'], ({ user }) => db.prepare('SELECT day FROM master_days_off WHERE master_id = ? ORDER BY day').all(user.masterId).map(r => r.day));
  route('PUT', '/api/master/days-off/:day', ['master'], ({ user, params, body }) => {
    if (!SL.isDate(params.day)) fail(422, 'VALIDATION', 'Некоректна дата');
    if (body.off) {
      const busy = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE master_id = ? AND status NOT IN ('cancelled','done') AND substr(starts_at,1,10) = ?`).get(user.masterId, params.day).n;
      if (busy) fail(409, 'HAS_ORDERS', 'На цей день у вас є заявки. Попросіть офіс їх перепризначити');
      db.prepare('INSERT OR IGNORE INTO master_days_off (master_id, day) VALUES (?, ?)').run(user.masterId, params.day);
    } else db.prepare('DELETE FROM master_days_off WHERE master_id = ? AND day = ?').run(user.masterId, params.day);
    bus.broadcast('catalog');
    return { ok: true };
  });

  /* --- адміністратор --- */
  route('GET', '/api/admin/orders', ['admin'], ({ user, query }) => {
    const where = [], args = [];
    if (WF.STATUSES.includes(query.status)) { where.push('status = ?'); args.push(query.status); }
    if (['web', 'mobile'].includes(query.source)) { where.push('source = ?'); args.push(query.source); }
    if (/^m\d+$/.test(query.master || '')) { where.push('master_id = ?'); args.push(query.master); }
    return db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`).all(...args).map(o => fullOrder(o, user));
  });
  route('PATCH', '/api/admin/orders/:id/assign', ['admin'], ({ user, params, body }) => {
    const o = getOrderRow(Number(params.id)); if (!o) fail(404, 'NOT_FOUND', 'Заявку не знайдено');
    if (['done', 'cancelled'].includes(o.status)) fail(409, 'CLOSED', 'Закриту заявку не можна перепризначити');
    const masterId = str(body.masterId, 10);
    if (!db.prepare('SELECT 1 FROM masters WHERE id = ? AND active = 1').get(masterId)) fail(422, 'VALIDATION', 'Майстра не знайдено');
    const date = SL.isDate(body.date) ? body.date : o.starts_at.slice(0, 10), time = /^\d{2}:\d{2}$/.test(body.time || '') ? body.time : o.starts_at.slice(11);
    const dur = SL.toMin(o.ends_at.slice(11)) - SL.toMin(o.starts_at.slice(11));
    try {
      tx(db, () => db.prepare('UPDATE orders SET master_id = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?')
        .run(masterId, `${date} ${time}`, `${date} ${SL.toHHMM(SL.toMin(time) + dur)}`, nowIso(), o.id));
    } catch (e) { throw masterBusyError(e); }
    const n = getOrderRow(o.id); bus.orderChanged(o); bus.orderChanged(n); return fullOrder(n, user);
  });
  route('GET', '/api/admin/analytics', ['admin'], ({ query }) => {
    const days = [7, 14, 30, 90, 365].includes(Number(query.days)) ? Number(query.days) : 30;
    const since = new Date(now().getTime() - days * 86400000).toISOString();
    const q = (sql, ...a) => db.prepare(sql).all(since, ...a);
    return {
      days,
      byStatus: q('SELECT status, COUNT(*) AS n, SUM(total) AS sum FROM orders WHERE created_at >= ? GROUP BY status'),
      bySource: q('SELECT source, COUNT(*) AS n FROM orders WHERE created_at >= ? GROUP BY source'),
      byKind: q('SELECT kind, COUNT(*) AS n FROM orders WHERE created_at >= ? GROUP BY kind'),
      byMaster: q(`SELECT m.id, u.name, COUNT(o.id) AS n, SUM(CASE WHEN o.status = 'done' THEN o.total ELSE 0 END) AS revenue, m.rating
        FROM masters m JOIN users u ON u.id = m.user_id LEFT JOIN orders o ON o.master_id = m.id AND o.created_at >= ? GROUP BY m.id ORDER BY m.id`),
      topProducts: q(`SELECT i.title, SUM(i.qty) AS qty, SUM(i.price) AS sum FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.created_at >= ? AND i.product_id IS NOT NULL AND o.status <> 'cancelled' GROUP BY i.product_id ORDER BY qty DESC LIMIT 5`),
      revenueDone: db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status = 'done' AND updated_at >= ?`).get(since).s,
      avgCheck: db.prepare(`SELECT COALESCE(ROUND(AVG(total)),0) AS a FROM orders WHERE status <> 'cancelled' AND created_at >= ?`).get(since).a,
      cancelRate: (() => { const r = db.prepare(`SELECT COUNT(*) AS n, SUM(status = 'cancelled') AS c FROM orders WHERE created_at >= ?`).get(since); return r.n ? Math.round(r.c / r.n * 100) : 0; })(),
    };
  });
  route('GET', '/api/admin/users', ['admin'], () => db.prepare(`SELECT u.id, u.email, u.phone, u.name, u.role, u.created_at,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders FROM users u ORDER BY u.id`).all());
  route('PATCH', '/api/admin/masters/:id', ['admin'], ({ params, body }) => {
    if (!db.prepare('SELECT 1 FROM masters WHERE id = ?').get(params.id)) fail(404, 'NOT_FOUND', 'Майстра не знайдено');
    db.prepare('UPDATE masters SET active = ? WHERE id = ?').run(body.active ? 1 : 0, params.id);
    bus.broadcast('catalog'); return { ok: true };
  });
  route('DELETE', '/api/admin/reviews/:id', ['admin'], ({ params }) => {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(params.id)); bus.broadcast('reviews'); return { ok: true };
  });

  /* ---------- HTTP ---------- */
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const STATIC = ['web'];

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new HttpError(413, 'TOO_LARGE', 'Запит завеликий')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); } catch { reject(new HttpError(400, 'BAD_JSON', 'Некоректний JSON')); } });
      req.on('error', reject);
    });
  }
  function authUser(req, url) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : (url.pathname === '/api/events' ? url.searchParams.get('token') : '');
    const p = token && A.verifyJwt(token);
    return p ? { id: p.sub, role: p.role, masterId: p.mid || null } : null;
  }
  function send(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (url.pathname === '/api/events') {
      const user = authUser(req, url); if (!user) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      const off = bus.add(res, user); const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { off(); clearInterval(ping); });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        for (const r of R) {
          const m = r.m === req.method && url.pathname.match(r.re);
          if (!m) continue;
          const user = authUser(req, url);
          if (r.roles) {
            if (!user) fail(401, 'UNAUTHORIZED', 'Потрібен вхід');
            if (!r.roles.includes(user.role)) fail(403, 'FORBIDDEN', 'Недостатньо прав');
          }
          const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
          const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
          const out = await r.h({ body, user, params: m.groups || {}, query: Object.fromEntries(url.searchParams), ip, req });
          return send(res, 200, out);
        }
        fail(404, 'NOT_FOUND', 'Не знайдено');
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        return send(res, status, { error: { code: e.code || 'INTERNAL', message: status === 500 ? 'Помилка сервера' : e.message } });
      }
    }

    // Статика веб-застосунку
    let p;
    try { p = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end(); }
    if (p === '/' || p === '/index.html') { res.writeHead(302, { Location: '/web/' }); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    if (!STATIC.includes(p.split('/')[1])) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }
  handler.bus = bus;
  return handler;
}

module.exports = { createApp, HttpError, normPhone };
