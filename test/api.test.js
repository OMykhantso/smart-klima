'use strict';
// Автоматизовані тести серверної частини. Час зафіксовано: 01.12.2026 09:00 за Києвом.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server/server.js');
const { calculate, coolingKw, pickClass, installCost } = require('../server/calc.js');
const SL = require('../server/slots.js');

const NOW = new Date('2026-12-01T07:00:00Z');          // 09:00 Київ (UTC+2)
const TODAY = '2026-12-01', TOMORROW = '2026-12-02';
let srv, base;
test.after(() => srv.server.close());

async function call(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const login = async (email, password) => (await call('POST', '/api/auth/login', { email, password })).body;
const order = (token, extra = {}) => call('POST', '/api/orders', {
  kind: 'inspection', contactName: 'Тест', contactPhone: '0501234567', address: 'Київ, вул. Тестова, 1', date: TOMORROW, time: '09:00', ...extra,
}, token);

let client, client2, admin, m1, m3;
test.before(async () => {
  srv = await start(0, ':memory:', { now: () => NOW, authLimit: 1000, writeLimit: 1000 }); base = `http://localhost:${srv.port}`;
  client = await login('client@smartklima.ua', 'Client123!');
  client2 = await login('maksym@smartklima.ua', 'Client123!');
  admin = await login('admin@smartklima.ua', 'Admin123!');
  m1 = await login('andrii@smartklima.ua', 'Master123!');
  m3 = await login('iryna@smartklima.ua', 'Master123!');
});

/* ---------- автентифікація ---------- */
test('TC-01 реєстрація: валідація і успіх', async () => {
  assert.equal((await call('POST', '/api/auth/register', { name: 'Іван', email: 'ivan@test.ua', phone: '0671112233', password: 'short1' })).status, 422);
  assert.equal((await call('POST', '/api/auth/register', { name: 'Іван', email: 'ivan@test.ua', phone: '0671112233', password: 'onlyletters' })).status, 422);
  assert.equal((await call('POST', '/api/auth/register', { name: 'Іван', email: 'ivan@test.ua', phone: '12345', password: 'Passw0rd!' })).status, 422);
  assert.equal((await call('POST', '/api/auth/register', { name: 'Іван', email: 'не-пошта', phone: '0671112233', password: 'Passw0rd!' })).status, 422);
  const r = await call('POST', '/api/auth/register', { name: 'Іван', email: 'Ivan@Test.ua', phone: '067 111 22 33', password: 'Passw0rd!' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'client');
  assert.equal(r.body.user.phone, '+380671112233');
  assert.equal(r.body.user.email, 'ivan@test.ua');
  assert.ok(r.body.accessToken && r.body.refreshToken);
});
test('TC-02 повторний e-mail відхиляється', async () => {
  const r = await call('POST', '/api/auth/register', { name: 'Інший', email: 'IVAN@test.ua', phone: '0671112234', password: 'Passw0rd!' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'EMAIL_TAKEN');
});
test('TC-03 вхід: невірний пароль і успіх; пароль у БД лише як scrypt-хеш', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'client@smartklima.ua', password: 'wrong123' })).status, 401);
  assert.equal(client.user.role, 'client');
  const row = srv.db.prepare('SELECT pass_hash FROM users WHERE email = ?').get('client@smartklima.ua');
  assert.match(row.pass_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!row.pass_hash.includes('Client123!'));
});
test('TC-04 refresh-токен: ротація і виявлення повторного використання', async () => {
  const s = await login('maksym@smartklima.ua', 'Client123!');
  const r1 = await call('POST', '/api/auth/refresh', { refreshToken: s.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, s.refreshToken);
  const reuse = await call('POST', '/api/auth/refresh', { refreshToken: s.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal((await call('POST', '/api/auth/refresh', { refreshToken: r1.body.refreshToken })).status, 401, 'після крадіжки відкликано всі сесії');
  const dbRow = srv.db.prepare('SELECT token_hash FROM refresh_tokens LIMIT 1').get();
  assert.match(dbRow.token_hash, /^[0-9a-f]{64}$/);
});
test('TC-05 RBAC: без токена 401, чужа роль 403, підроблений JWT 401', async () => {
  assert.equal((await call('GET', '/api/admin/orders')).status, 401);
  assert.equal((await call('GET', '/api/admin/orders', null, client.accessToken)).status, 403);
  assert.equal((await call('GET', '/api/master/schedule', null, client.accessToken)).status, 403);
  assert.equal((await call('POST', '/api/orders', {}, m1.accessToken)).status, 403);
  const [h, , s] = client.accessToken.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 1, role: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal((await call('GET', '/api/admin/orders', null, `${h}.${forged}.${s}`)).status, 401);
  assert.equal((await call('GET', '/api/admin/orders', null, admin.accessToken)).status, 200);
});

/* ---------- калькулятор: контрольні дані ---------- */
test('TC-06 холодопродуктивність і клас на контрольних даних', () => {
  const cases = [
    // площа, висота, сторона, люди, техніка → кВт, клас
    [20, 2.7, 'normal', 2, 0.3, 2.18, 7],
    [25, 2.7, 'normal', 2, 0.3, 2.65, 9],
    [30, 2.8, 'normal', 3, 0.5, 3.39, 12],
    [25, 2.7, 'shade', 2, 0, 2.23, 9],
    [35, 2.7, 'sunny', 3, 0.5, 4.23, 18],
    [50, 3.0, 'sunny', 4, 1, 6.7, 24],
    [80, 3.0, 'sunny', 6, 2, 10.8, null],
  ];
  for (const [area, height, sun, people, tech, kw, cls] of cases) {
    assert.equal(coolingKw({ area, height, sun, people, tech }), kw, `кВт для ${area} м²`);
    assert.equal(pickClass(kw), cls, `клас для ${kw} кВт`);
  }
});
test('TC-07 вартість монтажу на контрольних даних', () => {
  assert.equal(installCost({ btu: 9 }).total, 4500);
  const c = installCost({ btu: 12, route: 5, floor: 'mid', options: ['wall', 'wall'], trace: 'box' });
  assert.equal(c.total, 5200 + 2 * 520 + 800 + 5 * 180 + 500);
  assert.equal(installCost({ btu: 18, route: 6, trace: 'hidden', options: ['pump', 'old', 'fence'] }).total, 6500 + 3 * 650 + 6 * 450 + 1900 + 1200 + 950);
  assert.equal(calculate({ area: 20 }).btu, 7);
});

/* ---------- планувальник ---------- */
test('TC-08 слоти на вільний день: межі робочого дня', async () => {
  const r = (await call('GET', `/api/slots?date=${TOMORROW}&kind=install&units=1`)).body;
  assert.equal(r.duration, 180);
  assert.equal(r.slots[0].time, '09:00');
  assert.equal(r.slots.at(-1).time, '16:00');
  assert.equal(r.slots.length, 15);
  assert.equal(r.slots[0].masters, 4);
});
test('TC-09 слоти сьогодні: не раніше ніж за 2 години; минулі дати й далі 14 днів — порожньо', async () => {
  const r = (await call('GET', `/api/slots?date=${TODAY}&kind=inspection`)).body;
  assert.equal(r.slots[0].time, '11:00');
  assert.deepEqual((await call('GET', '/api/slots?date=2026-11-30&kind=inspection')).body.slots, []);
  assert.deepEqual((await call('GET', '/api/slots?date=2026-12-20&kind=inspection')).body.slots, []);
  assert.equal((await call('GET', '/api/slots?date=bad&kind=inspection')).status, 400);
});
test('TC-10 штрафна функція на контрольних даних', () => {
  // вільний майстер з рейтингом 5 → 0; 1 виїзд → +20; рейтинг 4,8 → +2
  assert.equal(SL.penalty([], 540, 600, 5), 0);
  assert.equal(SL.penalty([{ s: 540, e: 720 }], 780, 840, 5), 20);
  assert.equal(SL.penalty([], 540, 600, 4.8), 2);
  // зайнято 09:00–12:00 (+30 хв дороги): виїзд о 12:30 не лишає вікна,
  // а виїзд о 13:30 лишає «мертве» вікно 30 хв (12:30–13:00), куди не вміститься жоден виїзд → +15
  assert.equal(SL.penalty([{ s: 540, e: 720 }], 750, 870, 5), 20);
  assert.equal(SL.penalty([{ s: 540, e: 720 }], 810, 930, 5), 20 + 15);
});

/* ---------- заявки ---------- */
let instOrder;
test('TC-11 створення заявки на монтаж: ціни з БД, майстер, журнал статусів', async () => {
  const r = await order(client.accessToken, {
    kind: 'install', time: '09:00', products: [{ id: 1, qty: 1, price: 1 }], install: { route: 5, floor: 'mid', options: ['wall'] }, total: 10, source: 'mobile',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  instOrder = r.body;
  assert.equal(instOrder.status, 'new');
  assert.equal(instOrder.total, 21900 + 4500 + 2 * 520 + 800 + 500, 'ціну рахує сервер');
  assert.equal(instOrder.startsAt, `${TOMORROW} 09:00`); assert.equal(instOrder.endsAt, `${TOMORROW} 12:00`);
  assert.ok(instOrder.master, 'майстра призначено');
  assert.equal(instOrder.source, 'mobile');
  assert.equal(instOrder.history[0].to_status, 'new');
  assert.equal((await order(client.accessToken, { kind: 'install' })).status, 422, 'монтаж без кондиціонера');
  assert.equal((await order(client.accessToken, { contactPhone: '123' })).status, 422);
});
test('TC-12 зайнятий час: 4 майстри о 09:00, п\'ята заявка отримує 409; буфер на дорогу', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await order(client2.accessToken, { time: '09:00' })).status, 200);
  const r = await order(client2.accessToken, { time: '09:00' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SLOT_TAKEN');
  const slots = (await call('GET', `/api/slots?date=${TOMORROW}&kind=inspection`)).body.slots;
  assert.ok(!slots.some(s => s.time === '09:00'));
  // майстер монтажу зайнятий 09:00–12:00, тож для нього найближчий слот — 12:30
  const own = (await call('GET', `/api/slots?date=${TOMORROW}&kind=inspection&master=${instOrder.master.id}`)).body.slots;
  assert.equal(own[0].time, '12:30');
});
test('TC-13 тригер БД не дає записати накладку навіть в обхід API', () => {
  const o = srv.db.prepare('SELECT * FROM orders WHERE id = ?').get(instOrder.id);
  assert.throws(() => srv.db.prepare(`INSERT INTO orders (user_id, kind, status, source, contact_name, contact_phone, address, master_id, starts_at, ends_at, total, created_at, updated_at)
    VALUES (?, 'inspection', 'new', 'web', 'X', '+380501234567', 'Адреса 1', ?, ?, ?, 0, 'x', 'x')`).run(o.user_id, o.master_id, `${TOMORROW} 10:00`, `${TOMORROW} 11:00`), /MASTER_BUSY/);
});
test('TC-14 автомат станів: повний цикл майстра і заборонені переходи', async () => {
  const mid = instOrder.master.id;
  const me = await login(srv.db.prepare('SELECT u.email FROM masters m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(mid).email, 'Master123!');
  const other = mid === 'm1' ? m3 : m1;
  const set = (tok, status) => call('PATCH', `/api/orders/${instOrder.id}/status`, { status }, tok);
  assert.equal((await set(me.accessToken, 'done')).status, 409, 'не можна стрибнути з «Нова» в «Виконана»');
  assert.equal((await set(other.accessToken, 'confirmed')).status, 403, 'чужий майстер');
  assert.equal((await set(client.accessToken, 'confirmed')).status, 403, 'клієнт не підтверджує');
  assert.equal((await set(me.accessToken, 'confirmed')).status, 200);
  assert.equal((await set(client.accessToken, 'on_way')).status, 403);
  assert.equal((await set(me.accessToken, 'on_way')).status, 200);
  assert.equal((await set(me.accessToken, 'cancelled')).status, 403, 'майстер не скасовує');
  assert.equal((await set(me.accessToken, 'in_work')).status, 200);
  assert.equal((await call('PATCH', `/api/orders/${instOrder.id}/note`, { note: 'Траса 5 м, кошик не потрібен' }, me.accessToken)).status, 200);
  const done = await set(me.accessToken, 'done');
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.history.map(h => h.to_status), ['new', 'confirmed', 'on_way', 'in_work', 'done']);
  assert.equal(done.body.masterNote, 'Траса 5 м, кошик не потрібен');
  assert.equal((await set(admin.accessToken, 'cancelled')).status, 409, 'виконану не скасувати');
});
test('TC-15 скасування клієнтом: нову можна, підтверджену менш ніж за 3 год — ні; чужу — ні', async () => {
  const a = (await order(client.accessToken, { time: '15:00' })).body;
  assert.equal((await call('PATCH', `/api/orders/${a.id}/status`, { status: 'cancelled' }, client2.accessToken)).status, 403);
  assert.equal((await call('PATCH', `/api/orders/${a.id}/status`, { status: 'cancelled' }, client.accessToken)).status, 200);
  const today = (await order(client.accessToken, { date: TODAY, time: '11:00' })).body;
  const ml = await login(srv.db.prepare('SELECT u.email FROM masters m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(today.master.id).email, 'Master123!');
  await call('PATCH', `/api/orders/${today.id}/status`, { status: 'confirmed' }, ml.accessToken);
  const r = await call('PATCH', `/api/orders/${today.id}/status`, { status: 'cancelled' }, client.accessToken);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'TOO_LATE');
  assert.equal((await call('PATCH', `/api/orders/${today.id}/status`, { status: 'cancelled' }, admin.accessToken)).status, 200, 'офіс може');
});
test('TC-16 відгук лише після виконання, один на заявку, оновлює рейтинг майстра', async () => {
  const pending = (await order(client.accessToken, { time: '17:00' })).body;
  assert.equal((await call('POST', `/api/orders/${pending.id}/review`, { stars: 5, text: 'Супер' }, client.accessToken)).status, 409);
  assert.equal((await call('POST', `/api/orders/${instOrder.id}/review`, { stars: 4, text: 'Добре' }, client2.accessToken)).status, 404, 'чужа заявка');
  assert.equal((await call('POST', `/api/orders/${instOrder.id}/review`, { stars: 4, text: 'Добре, акуратно' }, client.accessToken)).status, 200);
  assert.equal((await call('POST', `/api/orders/${instOrder.id}/review`, { stars: 5, text: 'Ще раз' }, client.accessToken)).status, 409);
  const reviews = (await call('GET', '/api/reviews')).body;
  assert.ok(reviews.some(r => r.text === 'Добре, акуратно' && r.master === instOrder.master.id));
  const expected = srv.db.prepare('SELECT ROUND(AVG(stars),1) AS a FROM reviews WHERE master_id = ?').get(instOrder.master.id).a;
  assert.equal(srv.db.prepare('SELECT rating FROM masters WHERE id = ?').get(instOrder.master.id).rating, expected);
});
test('TC-17 перепризначення адміном: на зайнятого майстра 409, на вільного — успіх', async () => {
  const a = (await order(client2.accessToken, { time: '13:00' })).body;
  const busy = srv.db.prepare(`SELECT master_id FROM orders WHERE starts_at = ? AND status <> 'cancelled' AND master_id <> ? LIMIT 1`).get(`${TOMORROW} 09:00`, a.master.id).master_id;
  const r = await call('PATCH', `/api/admin/orders/${a.id}/assign`, { masterId: busy, time: '09:30' }, admin.accessToken);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SLOT_TAKEN');
  const ok = await call('PATCH', `/api/admin/orders/${a.id}/assign`, { masterId: busy, time: '14:00' }, admin.accessToken);
  assert.equal(ok.status, 200); assert.equal(ok.body.master.id, busy); assert.equal(ok.body.startsAt, `${TOMORROW} 14:00`);
});
test('TC-18 вихідний майстра: заборонено, якщо є заявки; інакше майстер зникає зі слотів', async () => {
  const day = '2026-12-05';
  assert.equal((await call('PUT', `/api/master/days-off/${day}`, { off: true }, m3.accessToken)).status, 200);
  const s = (await call('GET', `/api/slots?date=${day}&kind=inspection&master=m3`)).body.slots;
  assert.deepEqual(s, []);
  assert.equal((await call('GET', `/api/slots?date=${day}&kind=inspection`)).body.slots[0].masters, 3);
  const busyDay = srv.db.prepare(`SELECT master_id, substr(starts_at,1,10) AS d FROM orders WHERE status NOT IN ('cancelled','done') AND master_id IS NOT NULL LIMIT 1`).get();
  const tok = await login(srv.db.prepare('SELECT u.email FROM masters m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(busyDay.master_id).email, 'Master123!');
  assert.equal((await call('PUT', `/api/master/days-off/${busyDay.d}`, { off: true }, tok.accessToken)).status, 409);
});
test('TC-19 майстер бачить лише свої заявки', async () => {
  const sched = (await call('GET', '/api/master/schedule', null, m1.accessToken)).body;
  assert.ok(sched.every(o => o.master.id === 'm1'));
  const foreign = srv.db.prepare(`SELECT id FROM orders WHERE master_id <> 'm1' LIMIT 1`).get();
  assert.equal((await call('GET', `/api/orders/${foreign.id}`, null, m1.accessToken)).status, 404);
  assert.equal((await call('GET', `/api/orders/${instOrder.id}`, null, client2.accessToken)).status, 404, 'клієнт не бачить чужу заявку');
});
test('TC-20 аналітика адміністратора', async () => {
  const a = (await call('GET', '/api/admin/analytics?days=30', null, admin.accessToken)).body;
  const total = srv.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  assert.equal(a.byStatus.reduce((s, x) => s + x.n, 0), total);
  assert.equal(a.revenueDone, instOrder.total);
  assert.ok(a.bySource.some(x => x.source === 'mobile'));
  assert.equal(a.topProducts[0].title, 'Gree Bora Inverter GWH09AAB');
});
test('TC-21 події реального часу: майстер отримує подію про нову заявку', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events?token=${m1.accessToken}`, { signal: ctrl.signal });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  await reader.read(); // retry
  const created = (await order(client2.accessToken, { date: '2026-12-03', time: '10:00', masterId: 'm1' })).body;
  const deadline = Date.now() + 2000;
  while (!buf.includes(`"id":${created.id}`) && Date.now() < deadline) { const { value } = await reader.read(); buf += dec.decode(value); }
  ctrl.abort();
  assert.match(buf, /event: order/); assert.ok(buf.includes(`"id":${created.id}`));
  assert.equal((await fetch(`${base}/api/events?token=bad`)).status, 401);
});
test('TC-22 статика: захист від виходу за межі папки', async () => {
  assert.equal((await fetch(base + '/web/')).status, 200);
  assert.equal((await fetch(base + '/server/app.js')).status, 404);
  assert.equal((await fetch(base + '/web/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await fetch(base + '/web/%2e%2e/server/db.js')).status, 404);
});
