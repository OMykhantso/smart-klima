// Наскрізна перевірка "одна база для двох систем" у браузері.
// Потрібен Playwright: npx playwright install chromium && node test/e2e.js
// Сценарій: клієнт оформлює заявку на сайті → майстер бере її в мобільному
// застосунку і закриває → адмін на сайті бачить статус і нотатку → клієнт бачить статус.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
process.env.ADMIN_KEY = 'e2e-admin';
const { start } = require('../server/server.js');

(async () => {
  const srv = await start(0, ':memory:'); const base = `http://localhost:${srv.port}`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text())); };
  try {
    // 1. Клієнт на сайті
    const web = await browser.newPage({ viewport: { width: 1280, height: 900 } }); watch(web);
    await web.goto(base + '/web/#catalog');
    await web.waitForFunction(() => window.SKApi && window.SKApi.mode === 'server');
    await web.click('#grid .add[data-id="1"]');
    await web.goto(base + '/web/#order');
    await web.fill('#oName', 'Клієнт E2E'); await web.fill('#oPhone', '+380671234567'); await web.fill('#oAddr', 'вул. Тестова, 1');
    await web.click('#oSubmit');
    await web.waitForSelector('#dOk .ok');
    const okText = await web.textContent('#dOk .ok');
    const id = +okText.match(/№(\d+)/)[1];
    console.log('✔ сайт: створено заявку №' + id);

    // 2. Майстер у застосунку
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); watch(mob);
    await mob.goto(base + '/mobile/');
    await mob.click('[data-tab="profile"]'); await mob.click('#toMaster');
    await mob.click('[data-who="m3"]');
    for (const k of '3333') await mob.click(`[data-k="${k}"]`);
    await mob.waitForSelector(`[data-o="${id}"]`);
    await mob.click(`[data-o="${id}"]`); await mob.click('#take');
    await mob.click('[data-mt="mine"]');
    await mob.click(`[data-o="${id}"]`); await mob.click('#nextSt'); // onway
    await mob.click(`[data-o="${id}"]`); await mob.fill('#note', 'Встановлено, траса 4 м'); await mob.click('#saveNote');
    await mob.click(`[data-o="${id}"]`); await mob.click('#nextSt'); // done
    await mob.click('[data-tab="done"]'); await mob.waitForSelector(`[data-o="${id}"]`);
    console.log('✔ застосунок: майстер взяв і виконав заявку');

    // 3. Адмін на сайті
    await web.goto(base + '/web/#admin');
    await web.fill('#admKey', 'e2e-admin'); await web.click('#admLogin button[type=submit]');
    await web.waitForSelector('#admOrders .order');
    const card = await web.textContent('#admOrders .order');
    assert.match(card, /Виконана/); assert.match(card, /Встановлено, траса 4 м/);
    assert.equal(await web.inputValue(`[data-omaster="${id}"]`), 'm3');
    console.log('✔ адмінка: статус «Виконана», майстер і нотатка видні');

    // 4. Клієнт бачить статус на сайті
    await web.goto(base + '/web/#order'); await web.waitForSelector('#myOrders:not([hidden])');
    assert.match(await web.textContent('#myOrders'), /Виконана/);
    console.log('✔ клієнт: бачить статус «Виконана»');

    // 5. Відгук із застосунку з'являється на сайті
    const cli = await browser.newPage({ viewport: { width: 390, height: 844 } }); watch(cli);
    await cli.goto(base + '/mobile/');
    await cli.evaluate(() => fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Мобільний відгук', text: 'Все чудово', stars: 5, master: 'm3', source: 'mobile' }) }));
    await web.goto(base + '/web/#reviews'); await web.waitForSelector('text=Мобільний відгук');
    console.log('✔ відгук із застосунку видно на сайті');

    assert.deepEqual(errors, [], 'помилки в консолі: ' + errors.join('; '));
    console.log('\nE2E: усі кроки пройдено, помилок у консолі немає');
  } finally { await browser.close(); srv.server.close(); }
})().catch(e => { console.error('✖', e.message); process.exit(1); });
