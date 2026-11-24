// Автентифікація: хешування паролів (scrypt), JWT (HS256), refresh-токени.
'use strict';
const crypto = require('node:crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_TTL_SEC = 30 * 60;               // access-токен діє 30 хв
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000; // refresh-токен діє 30 днів

/* ---------- паролі ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
// Пароль: щонайменше 8 символів, літера і цифра.
const passwordProblem = p => (typeof p !== 'string' || p.length < 8) ? 'Пароль має містити щонайменше 8 символів'
  : (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(p) || !/\d/.test(p)) ? 'Пароль має містити літеру і цифру' : null;

/* ---------- JWT ---------- */
const b64url = buf => Buffer.from(buf).toString('base64url');
function signJwt(payload, ttlSec = ACCESS_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* ---------- refresh-токени: у БД лише SHA-256 ---------- */
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function issueRefresh(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, sha256(token), new Date(Date.now() + REFRESH_TTL_MS).toISOString());
  return token;
}
// Ротація: старий токен відкликається, видається новий. Повторне використання відкликаного
// токена означає крадіжку — відкликаються всі сесії користувача.
function rotateRefresh(db, token) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row) return null;
  if (row.revoked) { db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(row.user_id); return null; }
  if (row.expires_at < new Date().toISOString()) return null;
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  return { userId: row.user_id, refresh: issueRefresh(db, row.user_id) };
}
function revokeRefresh(db, token) {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(sha256(String(token || '')));
}

module.exports = { hashPassword, verifyPassword, passwordProblem, signJwt, verifyJwt, issueRefresh, rotateRefresh, revokeRefresh, ACCESS_TTL_SEC };
