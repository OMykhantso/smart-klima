'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_KEY = 'test-admin';
const { start } = require('../server/server.js');

let srv, base;
test.before(async () => { srv = await start(0, ':memory:'); base = `http://localhost:${srv.port}`; });
test.after(() => srv.server.close());

const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const ADMIN = { 'X-Admin-Key': 'test-admin' };

test('health і каталог', async () => {
  assert.equal((await call('GET', '/api/health')).body.mode, 'server');
  const c = (await call('GET', '/api/catalog')).body;
  assert.equal(c.products.length, 12);
  assert.equal(c.masters.length, 4);
  assert.ok(c.masters.every(m => !('pin' in m) && !('pin_hash' in m)), 'PIN не віддається клієнтам');
});

test('заявка з сайту видна адміну і клієнту за токеном', async () => {
  const bad = await call('POST', '/api/orders', { name: 'Тест', phone: '123' });
  assert.equal(bad.status, 400);
  const o = (await call('POST', '/api/orders', { name: 'Тест', phone: '+380671234567', source: 'web', items: [{ title: 'Gree', price: 21900 }, { title: 'Монтаж', price: 4500 }] })).body;
  assert.equal(o.total, 26400);
  assert.equal(o.status, 'new');
  assert.match(o.token, /^[a-f0-9]{32}$/);
  assert.equal((await call('GET', '/api/admin/orders')).status, 401);
  const list = (await call('GET', '/api/admin/orders', null, ADMIN)).body;
  assert.equal(list[0].id, o.id);
  assert.ok(!('token' in list[0]), 'токен не віддається адміну');
  const mine = (await call('POST', '/api/orders/mine', { tokens: [o.token] })).body;
  assert.equal(mine.length, 1);
});

test('майстер з мобільного бере заявку і змінює статус, адмін бачить зміни', async () => {
  const o = (await call('POST', '/api/orders', { name: 'Мобільний', phone: '0671112233', source: 'mobile' })).body;
  assert.equal((await call('POST', '/api/master/login', { master: 'm3', pin: '0000' })).status, 401);
  const { token } = (await call('POST', '/api/master/login', { master: 'm3', pin: '3333' })).body;
  const auth = { Authorization: 'Bearer ' + token };
  const avail = (await call('GET', '/api/master/orders', null, auth)).body;
  assert.ok(avail.some(x => x.id === o.id));
  const taken = (await call('PATCH', `/api/master/orders/${o.id}`, { take: true }, auth)).body;
  assert.equal(taken.master, 'm3'); assert.equal(taken.status, 'confirmed');
  const done = (await call('PATCH', `/api/master/orders/${o.id}`, { status: 'done', note: 'Почищено дренаж' }, auth)).body;
  assert.equal(done.status, 'done');
  assert.equal((await call('PATCH', `/api/master/orders/${o.id}`, { status: 'cancelled' }, auth)).status, 400);
  // інший майстер не може чіпати чужу заявку
  const t2 = (await call('POST', '/api/master/login', { master: 'm1', pin: '1111' })).body.token;
  assert.equal((await call('PATCH', `/api/master/orders/${o.id}`, { status: 'onway' }, { Authorization: 'Bearer ' + t2 })).status, 403);
  const adminView = (await call('GET', '/api/admin/orders', null, ADMIN)).body.find(x => x.id === o.id);
  assert.equal(adminView.status, 'done'); assert.equal(adminView.note, 'Почищено дренаж'); assert.equal(adminView.source, 'mobile');
});

test('відгуки: валідація, додавання, видалення адміном', async () => {
  assert.equal((await call('POST', '/api/reviews', { name: 'A', text: 'ok', stars: 9 })).status, 400);
  const r = (await call('POST', '/api/reviews', { name: 'Іван', text: 'Все супер', stars: 5, master: 'm1' })).body;
  assert.ok((await call('GET', '/api/reviews')).body.some(x => x.id === r.id));
  assert.equal((await call('DELETE', `/api/admin/reviews/${r.id}`, null, ADMIN)).status, 200);
  assert.ok(!(await call('GET', '/api/reviews')).body.some(x => x.id === r.id));
});

test('графік майстрів: адмін і сам майстер', async () => {
  assert.equal((await call('PATCH', '/api/admin/masters/m2', { free: true }, ADMIN)).body.free, true);
  const { token } = (await call('POST', '/api/master/login', { master: 'm2', pin: '2222' })).body;
  assert.equal((await call('PATCH', '/api/master/me', { free: false }, { Authorization: 'Bearer ' + token })).body.free, false);
  const m2 = (await call('GET', '/api/catalog')).body.masters.find(m => m.id === 'm2');
  assert.equal(m2.free, false);
});

test('статика і захист від виходу за межі папки', async () => {
  const r = await fetch(base + '/web/');
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/server/server.js')).status, 404);
  assert.equal((await fetch(base + '/web/..%2f..%2fpackage.json')).status, 404);
});
