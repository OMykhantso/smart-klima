// Smart Klima API: одна база SQLite для веб-сайту і мобільного застосунку.
// Без залежностей: node:http + node:sqlite (Node 22.13+).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const SEED = require('../shared/seed.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'smartklima.db');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const STATUSES = Object.keys(SEED.statuses);

/* ---------- database ---------- */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS masters (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, free INTEGER NOT NULL DEFAULT 1, pin_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE,
      created TEXT NOT NULL, updated TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, addr TEXT, whenText TEXT,
      master_id TEXT, comment TEXT, items TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, note TEXT);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, master_id TEXT, stars INTEGER NOT NULL,
      text TEXT NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web');
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, master_id TEXT NOT NULL, created TEXT NOT NULL);
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (!count) seed(db);
  return db;
}
const hashPin = pin => crypto.createHash('sha256').update('sk:' + pin).digest('hex');
function seed(db) {
  const ip = db.prepare('INSERT INTO products (id, data) VALUES (?, ?)');
  SEED.products.forEach(p => ip.run(p.id, JSON.stringify(p)));
  const is = db.prepare('INSERT INTO services (id, data) VALUES (?, ?)');
  SEED.services.forEach(s => is.run(s.id, JSON.stringify(s)));
  const im = db.prepare('INSERT INTO masters (id, data, free, pin_hash) VALUES (?, ?, ?, ?)');
  SEED.masters.forEach(({ pin, free, ...m }) => im.run(m.id, JSON.stringify(m), free ? 1 : 0, hashPin(process.env['PIN_' + m.id.toUpperCase()] || pin)));
  const ir = db.prepare('INSERT INTO reviews (name, master_id, stars, text, date, source) VALUES (?, ?, ?, ?, ?, ?)');
  SEED.reviews.forEach(r => ir.run(r.name, r.master, r.stars, r.text, r.date, 'seed'));
}

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rowOrder = r => r && ({
  id: r.id, created: r.created, updated: r.updated, status: r.status, source: r.source, name: r.name, phone: r.phone,
  addr: r.addr || '', when: r.whenText || '', master: r.master_id || '', comment: r.comment || '',
  items: JSON.parse(r.items), total: r.total, note: r.note || ''
});
const rowMaster = r => ({ ...JSON.parse(r.data), free: !!r.free });
const rowReview = r => ({ id: r.id, name: r.name, master: r.master_id, stars: r.stars, text: r.text, date: r.date, source: r.source });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = msg => { throw new HttpError(400, msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 64 * 1024) { reject(new HttpError(413, 'Запит завеликий')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Некоректний JSON')); } });
    req.on('error', reject);
  });
}

// Простий ліміт запитів на запис: 30 за 10 хвилин з одного IP.
const hits = new Map();
function rateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const t = Date.now(); const arr = (hits.get(ip) || []).filter(x => t - x < 600000);
  if (arr.length >= 30) throw new HttpError(429, 'Забагато запитів, спробуйте за кілька хвилин');
  arr.push(t); hits.set(ip, arr);
}

/* ---------- API ---------- */
function createApp(db) {
  const requireAdmin = req => {
    const k = req.headers['x-admin-key'] || '';
    const a = Buffer.from(String(k)), b = Buffer.from(ADMIN_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Невірний ключ адміністратора');
  };
  const requireMaster = req => {
    const tok = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const s = tok && db.prepare('SELECT master_id FROM sessions WHERE token = ?').get(tok);
    if (!s) throw new HttpError(401, 'Увійдіть як майстер');
    return s.master_id;
  };
  const getOrder = id => rowOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  const masterExists = id => !!db.prepare('SELECT 1 FROM masters WHERE id = ?').get(id);

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, mode: 'server', time: now() })],

    ['GET', /^\/api\/catalog$/, () => ({
      products: db.prepare('SELECT data FROM products ORDER BY id').all().map(r => JSON.parse(r.data)),
      services: db.prepare('SELECT data FROM services').all().map(r => JSON.parse(r.data)),
      masters: db.prepare('SELECT * FROM masters ORDER BY id').all().map(rowMaster),
    })],

    ['GET', /^\/api\/reviews$/, () => db.prepare('SELECT * FROM reviews ORDER BY date DESC, id DESC').all().map(rowReview)],

    ['POST', /^\/api\/reviews$/, async req => {
      rateLimit(req);
      const b = await readBody(req);
      const name = str(b.name, 40), text = str(b.text, 600), stars = Math.round(+b.stars);
      const master = str(b.master, 10);
      if (!name || !text) bad('Вкажіть ім\'я і текст відгуку');
      if (!(stars >= 1 && stars <= 5)) bad('Оцінка має бути від 1 до 5');
      if (master && !masterExists(master)) bad('Такого майстра немає');
      const r = db.prepare('INSERT INTO reviews (name, master_id, stars, text, date, source) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, master || null, stars, text, now().slice(0, 10), b.source === 'mobile' ? 'mobile' : 'web');
      return rowReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(r.lastInsertRowid));
    }],

    ['POST', /^\/api\/orders$/, async req => {
      rateLimit(req);
      const b = await readBody(req);
      const name = str(b.name, 60), phone = str(b.phone, 20);
      if (!name) bad('Вкажіть ім\'я');
      if (phone.replace(/\D/g, '').length < 10) bad('Перевірте номер телефону: потрібно щонайменше 10 цифр');
      const master = str(b.master, 10);
      if (master && !masterExists(master)) bad('Такого майстра немає');
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(i => ({ title: str(i && i.title, 120), price: Math.max(0, Math.round(+(i && i.price) || 0)) })).filter(i => i.title);
      const total = items.reduce((s, i) => s + i.price, 0);
      const token = crypto.randomBytes(16).toString('hex'); const t = now();
      const r = db.prepare(`INSERT INTO orders (token, created, updated, status, source, name, phone, addr, whenText, master_id, comment, items, total)
        VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(token, t, t, b.source === 'mobile' ? 'mobile' : 'web', name, phone, str(b.addr, 120), str(b.when, 60), master || null, str(b.comment, 400), JSON.stringify(items), total);
      return { ...getOrder(r.lastInsertRowid), token };
    }],

    // Клієнт бачить лише свої заявки за токенами, які отримав при створенні.
    ['POST', /^\/api\/orders\/mine$/, async req => {
      const b = await readBody(req);
      const tokens = (Array.isArray(b.tokens) ? b.tokens : []).filter(t => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t)).slice(0, 50);
      if (!tokens.length) return [];
      return db.prepare(`SELECT * FROM orders WHERE token IN (${tokens.map(() => '?').join(',')}) ORDER BY created DESC`).all(...tokens).map(rowOrder);
    }],

    /* --- admin --- */
    ['GET', /^\/api\/admin\/orders$/, req => { requireAdmin(req); return db.prepare('SELECT * FROM orders ORDER BY created DESC').all().map(rowOrder); }],
    ['PATCH', /^\/api\/admin\/orders\/(\d+)$/, async (req, m) => {
      requireAdmin(req); const b = await readBody(req); const id = +m[1];
      if (!getOrder(id)) throw new HttpError(404, 'Заявку не знайдено');
      if (b.status !== undefined) { if (!STATUSES.includes(b.status)) bad('Невідомий статус'); db.prepare('UPDATE orders SET status = ?, updated = ? WHERE id = ?').run(b.status, now(), id); }
      if (b.master !== undefined) { const ms = str(b.master, 10); if (ms && !masterExists(ms)) bad('Такого майстра немає'); db.prepare('UPDATE orders SET master_id = ?, updated = ? WHERE id = ?').run(ms || null, now(), id); }
      return getOrder(id);
    }],
    ['DELETE', /^\/api\/admin\/orders\/(\d+)$/, (req, m) => { requireAdmin(req); db.prepare('DELETE FROM orders WHERE id = ?').run(+m[1]); return { ok: true }; }],
    ['DELETE', /^\/api\/admin\/reviews\/(\d+)$/, (req, m) => { requireAdmin(req); db.prepare('DELETE FROM reviews WHERE id = ?').run(+m[1]); return { ok: true }; }],
    ['PATCH', /^\/api\/admin\/masters\/(m\d+)$/, async (req, m) => {
      requireAdmin(req); const b = await readBody(req);
      if (!masterExists(m[1])) throw new HttpError(404, 'Майстра не знайдено');
      db.prepare('UPDATE masters SET free = ? WHERE id = ?').run(b.free ? 1 : 0, m[1]);
      return rowMaster(db.prepare('SELECT * FROM masters WHERE id = ?').get(m[1]));
    }],

    /* --- master (мобільний застосунок) --- */
    ['POST', /^\/api\/master\/login$/, async req => {
      rateLimit(req); const b = await readBody(req);
      const row = db.prepare('SELECT * FROM masters WHERE id = ?').get(str(b.master, 10));
      if (!row || row.pin_hash !== hashPin(str(b.pin, 12))) throw new HttpError(401, 'Невірний PIN');
      const token = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions (token, master_id, created) VALUES (?, ?, ?)').run(token, row.id, now());
      return { token, master: rowMaster(row) };
    }],
    ['GET', /^\/api\/master\/orders$/, req => {
      const me = requireMaster(req);
      return db.prepare(`SELECT * FROM orders WHERE master_id = ? OR (master_id IS NULL AND status IN ('new','confirmed')) ORDER BY created DESC`).all(me).map(rowOrder);
    }],
    ['PATCH', /^\/api\/master\/orders\/(\d+)$/, async (req, m) => {
      const me = requireMaster(req); const b = await readBody(req); const id = +m[1];
      const o = getOrder(id); if (!o) throw new HttpError(404, 'Заявку не знайдено');
      if (o.master && o.master !== me) throw new HttpError(403, 'Заявка закріплена за іншим майстром');
      if (b.take) db.prepare(`UPDATE orders SET master_id = ?, status = CASE status WHEN 'new' THEN 'confirmed' ELSE status END, updated = ? WHERE id = ?`).run(me, now(), id);
      if (b.status !== undefined) {
        if (!['confirmed', 'onway', 'done'].includes(b.status)) bad('Майстер може ставити лише: підтверджена, виїхав, виконана');
        db.prepare('UPDATE orders SET status = ?, master_id = ?, updated = ? WHERE id = ?').run(b.status, me, now(), id);
      }
      if (b.note !== undefined) db.prepare('UPDATE orders SET note = ?, updated = ? WHERE id = ?').run(str(b.note, 400), now(), id);
      return getOrder(id);
    }],
    ['PATCH', /^\/api\/master\/me$/, async req => {
      const me = requireMaster(req); const b = await readBody(req);
      db.prepare('UPDATE masters SET free = ? WHERE id = ?').run(b.free ? 1 : 0, me);
      return rowMaster(db.prepare('SELECT * FROM masters WHERE id = ?').get(me));
    }],
  ];

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
  const STATIC = ['web', 'mobile', 'shared'];

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (url.pathname.startsWith('/api/')) {
      try {
        for (const [method, re, fn] of routes) {
          const m = url.pathname.match(re);
          if (m && method === req.method) {
            const out = await fn(req, m);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify(out));
          }
        }
        throw new HttpError(404, 'Не знайдено');
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: status === 500 ? 'Помилка сервера' : e.message }));
      }
    }

    // Статика: /, /web/, /mobile/, /shared/
    let p;
    try { p = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end(); }
    if (p === '/') p = '/index.html';
    if (p.endsWith('/')) p += 'index.html';
    const top = p.split('/')[1];
    if (p !== '/index.html' && !STATIC.includes(top)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  };
}

function start(port = PORT, dbPath = DB_PATH) {
  const db = openDb(dbPath);
  const server = http.createServer(createApp(db));
  return new Promise(resolve => server.listen(port, () => resolve({ server, db, port: server.address().port })));
}

if (require.main === module) {
  start().then(({ port }) => {
    console.log(`Smart Klima: http://localhost:${port}`);
    console.log(`  сайт:       http://localhost:${port}/web/`);
    console.log(`  застосунок: http://localhost:${port}/mobile/`);
    if (!process.env.ADMIN_KEY) console.warn('  УВАГА: ADMIN_KEY не задано, використовується ключ за замовчуванням "admin123"');
  });
}
module.exports = { start, createApp, openDb };
