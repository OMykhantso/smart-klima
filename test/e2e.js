// Наскрізний тест інтеграції Web ↔ Mobile через спільний API і базу даних.
// Запуск: npm run e2e  (потрібен Playwright; мобільний застосунок збирається для веб-перегляду
// командою `npx expo export --platform web` у папці mobile, API — на порту 3000).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-secret';
const { start } = require('../server/server.js');

const DIST = path.join(__dirname, '..', 'mobile', 'dist');
const SHOTS = process.env.E2E_SHOTS || '';
function serveStatic(dir, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
  return new Promise(r => { const s = http.createServer((req, res) => {
    let f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(port, () => r(s)); });
}
const step = m => console.log('✔ ' + m);

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) execSync('npx expo export --platform web --output-dir dist', { cwd: path.join(__dirname, '..', 'mobile'), stdio: 'inherit' });
  const srv = await start(3000, ':memory:');
  const mob = await serveStatic(DIST, 8081);
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text())); };
  const shot = async (p, name, full) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };
  try {
    /* 1. Клієнт на сайті: реєстрація, вибір моделі, запис на час */
    const web = await browser.newPage({ viewport: { width: 1280, height: 900 } }); watch(web);
    await web.goto('http://localhost:3000/web/#catalog'); await web.waitForSelector('#grid .card');
    await web.click('#grid .add[data-id="2"]');
    await web.goto('http://localhost:3000/web/#register');
    await web.fill('#rName', 'Наталія E2E'); await web.fill('#rEmail', 'e2e@test.ua'); await web.fill('#rPhone', '0961112233'); await web.fill('#rPass', 'Klima2026');
    await web.click('#regForm button[type=submit]');
    await web.waitForSelector('#bSlots [data-time="10:00"]'); await web.click('#bSlots [data-time="10:00"]');
    await web.fill('#oAddr', 'Київ, вул. Хрещатик, 1, кв. 7');
    await web.click('#oSubmit'); await web.waitForSelector('#dOk .ok');
    const id = +(await web.textContent('#dOk .ok')).match(/№(\d+)/)[1];
    const masterName = (await web.textContent('#dOk .ok')).match(/Майстер: ([^.]+)\./)[1];
    step(`сайт: клієнт зареєструвався і записався, заявка №${id}, майстер ${masterName}`);

    /* 2. Майстер у мобільному застосунку проводить заявку через усі статуси */
    const emails = { 'Андрій Коваль': 'andrii', 'Олег Бондар': 'oleh', 'Ірина Мельник': 'iryna', 'Тарас Литвин': 'taras' };
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); watch(m);
    await m.goto('http://localhost:8081/'); await m.getByTestId('login-email').waitFor();
    await m.getByTestId('login-email').fill(emails[masterName] + '@smartklima.ua'); await m.getByTestId('login-password').fill('Master123!'); await m.getByTestId('login-submit').click();
    await m.getByTestId('order-' + id).waitFor(); await shot(m, 'e2e-mobile-schedule');
    await m.getByTestId('order-' + id).click(); await m.getByTestId('next-status').waitFor();
    for (const label of ['Підтверджена', 'Майстер у дорозі', 'Монтаж триває']) { await m.getByTestId('next-status').click(); await m.getByText(label, { exact: true }).first().waitFor(); }
    await m.getByTestId('master-note').fill('Встановлено на 2-му поверсі, траса 3 м'); await m.getByTestId('save-note').click();
    await shot(m, 'e2e-mobile-order', true);
    await m.getByTestId('next-status').click(); await m.getByText('Виконана', { exact: true }).first().waitFor();
    step('застосунок: майстер підтвердив, виїхав, почав і завершив роботу, залишив нотатку');

    /* 3. Клієнт на сайті бачить статус і залишає відгук */
    await web.goto('http://localhost:3000/web/#cabinet'); await web.waitForSelector(`[data-oid="${id}"] .st.done`);
    assert.match(await web.textContent(`[data-oid="${id}"]`), /Встановлено на 2-му поверсі/);
    await web.fill(`[data-rv="${id}"] textarea`, 'Майстер приїхав вчасно, все акуратно'); await web.click(`[data-rv="${id}"] button[type=submit]`);
    await web.waitForSelector(`[data-oid="${id}"] .stars`);
    await shot(web, 'e2e-web-cabinet');
    step('сайт: клієнт бачить «Виконана» і нотатку майстра, залишив відгук');

    /* 4. Клієнт у мобільному застосунку бачить ту саму заявку */
    const c = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); watch(c);
    await c.goto('http://localhost:8081/'); await c.getByTestId('login-email').waitFor();
    await c.getByTestId('login-email').fill('e2e@test.ua'); await c.getByTestId('login-password').fill('Klima2026'); await c.getByTestId('login-submit').click();
    await c.getByTestId('tab-OrdersTab').click(); await c.getByTestId('order-' + id).waitFor();
    assert.match(await c.getByTestId('order-' + id).textContent(), /Виконана/);
    step('застосунок: клієнт бачить заявку з сайту зі статусом «Виконана»');

    /* 5. Адміністратор на сайті */
    await web.click('#logoutBtn');
    await web.goto('http://localhost:3000/web/#login'); await web.fill('#lEmail', 'admin@smartklima.ua'); await web.fill('#lPass', 'Admin123!'); await web.click('#loginForm button[type=submit]');
    await web.waitForSelector(`#admOrders [data-oid="${id}"]`);
    const card = await web.textContent(`#admOrders [data-oid="${id}"]`);
    assert.match(card, /Виконана/); assert.match(card, /Сайт/);
    await web.goto('http://localhost:3000/web/#reviews'); await web.waitForSelector('text=Майстер приїхав вчасно');
    step('сайт: адміністратор бачить заявку і журнал, відгук опубліковано');

    assert.deepEqual(errors, [], 'помилки в консолі: ' + errors.join('; '));
    console.log('\nE2E: усі кроки пройдено, помилок у консолі немає');
  } finally { await browser.close(); srv.server.close(); mob.close(); }
})().catch(e => { console.error('✖', e.message); process.exit(1); });
