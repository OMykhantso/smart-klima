// Схема бази даних SQLite, обмеження цілісності та стартові дані.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SEED = require('./seed.js');
const { hashPassword } = require('./auth.js');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phone       TEXT    NOT NULL CHECK (phone GLOB '+380[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  role        TEXT    NOT NULL DEFAULT 'client' CHECK (role IN ('client','master','admin')),
  pass_hash   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);

CREATE TABLE IF NOT EXISTS masters (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  short       TEXT    NOT NULL,
  color       TEXT    NOT NULL,
  exp_years   INTEGER NOT NULL CHECK (exp_years >= 0),
  rating      REAL    NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  jobs        INTEGER NOT NULL DEFAULT 0 CHECK (jobs >= 0),
  district    TEXT    NOT NULL,
  bio         TEXT    NOT NULL,
  skills      TEXT    NOT NULL,             -- JSON-масив рядків
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  brand       TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  btu         INTEGER NOT NULL CHECK (btu IN (7,9,12,18,24)),
  kw          REAL    NOT NULL CHECK (kw > 0),
  area        INTEGER NOT NULL CHECK (area > 0),
  noise       INTEGER NOT NULL CHECK (noise BETWEEN 10 AND 60),
  inverter    INTEGER NOT NULL CHECK (inverter IN (0,1)),
  heat_min    INTEGER NOT NULL,
  wifi        INTEGER NOT NULL CHECK (wifi IN (0,1)),
  energy      TEXT    NOT NULL,
  price       INTEGER NOT NULL CHECK (price > 0),
  old_price   INTEGER NOT NULL DEFAULT 0 CHECK (old_price = 0 OR old_price > price),
  warranty    INTEGER NOT NULL CHECK (warranty BETWEEN 1 AND 10),
  color       TEXT    NOT NULL,
  dark        INTEGER NOT NULL DEFAULT 0,
  hit         INTEGER NOT NULL DEFAULT 0,
  descr       TEXT    NOT NULL,
  in_stock    INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0,1))
);

CREATE TABLE IF NOT EXISTS services (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  descr        TEXT    NOT NULL,
  price        INTEGER NOT NULL CHECK (price >= 0),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 30 AND 480)
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('install','service','inspection')),
  status      TEXT    NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','confirmed','on_way','in_work','done','cancelled')),
  source      TEXT    NOT NULL CHECK (source IN ('web','mobile')),
  contact_name  TEXT  NOT NULL,
  contact_phone TEXT  NOT NULL CHECK (contact_phone GLOB '+380[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  address     TEXT    NOT NULL CHECK (length(address) >= 5),
  master_id   TEXT    REFERENCES masters(id),
  starts_at   TEXT    NOT NULL,             -- 'YYYY-MM-DD HH:MM', час Києва
  ends_at     TEXT    NOT NULL,
  comment     TEXT    NOT NULL DEFAULT '',
  master_note TEXT    NOT NULL DEFAULT '',
  total       INTEGER NOT NULL CHECK (total >= 0),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS orders_master_time ON orders(master_id, starts_at);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at);

-- Гарантія на рівні БД: у майстра не може бути двох активних заявок, що перетинаються в часі.
CREATE TRIGGER IF NOT EXISTS orders_no_overlap_ins BEFORE INSERT ON orders
WHEN NEW.master_id IS NOT NULL AND NEW.status <> 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'MASTER_BUSY') WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.master_id = NEW.master_id AND o.status <> 'cancelled'
      AND o.starts_at < NEW.ends_at AND NEW.starts_at < o.ends_at);
END;
CREATE TRIGGER IF NOT EXISTS orders_no_overlap_upd BEFORE UPDATE OF master_id, starts_at, ends_at, status ON orders
WHEN NEW.master_id IS NOT NULL AND NEW.status <> 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'MASTER_BUSY') WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.id <> NEW.id AND o.master_id = NEW.master_id AND o.status <> 'cancelled'
      AND o.starts_at < NEW.ends_at AND NEW.starts_at < o.ends_at);
END;

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id),
  service_id  TEXT    REFERENCES services(id),
  title       TEXT    NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 10),
  price       INTEGER NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS status_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  at          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  order_id    INTEGER UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  master_id   TEXT    REFERENCES masters(id),
  author      TEXT    NOT NULL,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text        TEXT    NOT NULL CHECK (length(text) BETWEEN 3 AND 600),
  created_at  TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'web' CHECK (source IN ('web','mobile','seed'))
);

CREATE TABLE IF NOT EXISTS master_days_off (
  master_id   TEXT    NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  day         TEXT    NOT NULL,             -- 'YYYY-MM-DD'
  PRIMARY KEY (master_id, day)
);
`;

const nowIso = () => new Date().toISOString();

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (!db.prepare('SELECT COUNT(*) AS n FROM products').get().n) seed(db);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

function seed(db) {
  tx(db, () => {
    const t = nowIso();
    const addUser = db.prepare('INSERT INTO users (email, phone, name, role, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of SEED.users) addUser.run(u.email, u.phone, u.name, u.role, hashPassword(process.env['PASS_' + u.role.toUpperCase()] || u.password), t);
    const addM = db.prepare(`INSERT INTO masters (id, user_id, short, color, exp_years, rating, jobs, district, bio, skills)
      VALUES (?, (SELECT id FROM users WHERE email = ?), ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const m of SEED.masters) {
      addUser.run(m.email, m.phone, m.name, 'master', hashPassword(m.password), t);
      addM.run(m.id, m.email, m.short, m.color, m.exp, m.rating, m.jobs, m.district, m.bio, JSON.stringify(m.skills));
    }
    const addP = db.prepare(`INSERT INTO products (id, brand, model, btu, kw, area, noise, inverter, heat_min, wifi, energy, price, old_price, warranty, color, dark, hit, descr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of SEED.products) addP.run(p.id, p.brand, p.model, p.btu, p.kw, p.area, p.noise, p.inv ? 1 : 0, p.heat, p.wifi ? 1 : 0, p.cls, p.price, p.old || 0, p.warranty, p.color, p.dark ? 1 : 0, p.hit ? 1 : 0, p.descr);
    const addS = db.prepare('INSERT INTO services (id, title, descr, price, duration_min) VALUES (?, ?, ?, ?, ?)');
    for (const s of SEED.services) addS.run(s.id, s.title, s.text, s.price, s.duration);
    const addR = db.prepare('INSERT INTO reviews (master_id, author, stars, text, created_at, source) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of SEED.reviews) addR.run(r.master, r.name, r.stars, r.text, r.date + 'T12:00:00.000Z', 'seed');
  });
}

module.exports = { openDb, tx, nowIso };
