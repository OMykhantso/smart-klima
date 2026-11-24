/* Smart Klima: мобільний застосунок (PWA). Два режими на одній базі з сайтом:
 *  - Клієнт: каталог, підбір потужності, заявка, статус своїх заявок, відгук;
 *  - Майстер: вхід за PIN, нові та свої заявки, зміна статусу, нотатки, графік. */
(function () {
'use strict';
const Api = window.SKApi;
const { UAH, dec, pad2, esc, fmtDT, ls } = Api.util;
const SEED = Api.SEED, STATUS = SEED.statuses, INSTALL = SEED.installBase;
const $ = id => document.getElementById(id);
const screen = $('screen');

const S = {
  role: ls.get('sk_role', 'client'),
  tab: null,
  products: SEED.products, services: SEED.services, masters: SEED.masters.map(({ pin, ...m }) => m),
  myOrders: [], masterOrders: [],
  cart: ls.get('sk_cart', []),
  filter: 'all', q: '',
  calc: { area: 20, h: 2.7, q: 35, people: 2 },
  masterTab: 'new',
};
const P = id => S.products.find(p => p.id === id);
const M = id => S.masters.find(m => m.id === id);
let tT;
function toast(m) { $('toast').textContent = m; $('toast').hidden = false; clearTimeout(tT); tT = setTimeout(() => $('toast').hidden = true, 2400); }
function saveCart() { ls.set('sk_cart', S.cart); renderTabs(); }
const inCart = k => S.cart.some(c => c.key === k);

/* ---------- tabs ---------- */
const CLIENT_TABS = [['catalog', '❄', 'Каталог'], ['calc', '⌗', 'Підбір'], ['order', '🧾', 'Заявка'], ['mine', '⏱', 'Мої'], ['profile', '☰', 'Ще']];
const MASTER_TABS = [['jobs', '🛠', 'Заявки'], ['done', '✓', 'Виконані'], ['profile', '☰', 'Ще']];
function tabs() { return S.role === 'master' && Api.master.session ? MASTER_TABS : CLIENT_TABS; }
function renderTabs() {
  const t = tabs();
  if (!t.some(x => x[0] === S.tab)) S.tab = t[0][0];
  $('tabs').innerHTML = '<div class="in">' + t.map(([id, ic, label]) => {
    let badge = '';
    if (id === 'order' && S.cart.length) badge = S.cart.length;
    if (id === 'mine') badge = S.myOrders.filter(o => !['done', 'cancelled'].includes(o.status)).length || '';
    if (id === 'jobs') badge = S.masterOrders.filter(o => !o.master && o.status === 'new').length || '';
    return `<button type="button" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}><i aria-hidden="true">${ic}</i>${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  }).join('') + '</div>';
  const isM = S.role === 'master' && Api.master.session;
  $('roleBadge').textContent = isM ? 'Майстер' : 'Клієнт';
  $('roleBadge').classList.toggle('master', !!isM);
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); } });

function render() {
  renderTabs();
  const titles = { catalog: 'Каталог', calc: 'Підбір потужності', order: 'Заявка', mine: 'Мої заявки', profile: 'Smart Klima', jobs: 'Заявки', done: 'Виконані' };
  $('topTitle').textContent = titles[S.tab] || 'Smart Klima';
  ({ catalog: vCatalog, calc: vCalc, order: vOrder, mine: vMine, profile: vProfile, jobs: vJobs, done: vDone }[S.tab] || vCatalog)();
}

/* ---------- sheet ---------- */
function openSheet(html) { $('sheetBody').innerHTML = html; $('sheetBg').hidden = false; }
function closeSheet() { $('sheetBg').hidden = true; }
$('sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ================= CLIENT ================= */
function productRow(p) {
  return `<button class="item" type="button" data-p="${p.id}">
    <div class="thumb ${p.dark ? 'dark' : ''}" style="--c:${esc(p.color)}"><i></i></div>
    <div class="mid"><b>${esc(p.brand)} ${esc(p.model)}</b><small>до ${p.area} м² · ${dec(p.kw)} кВт · ${p.noise} дБ</small>
      <div class="tags">${p.inv ? '<span class="tag inv">Інвертор</span>' : '<span class="tag">On/Off</span>'}${p.heat <= -25 ? `<span class="tag heat">до ${p.heat}°C</span>` : ''}${p.wifi ? '<span class="tag">Wi‑Fi</span>' : ''}</div></div>
    <div class="end">${p.old ? `<s>${UAH(p.old)}</s>` : ''}<b>${UAH(p.price)}</b></div>
  </button>`;
}
function vCatalog() {
  const chips = [['all', 'Усі'], ['20', '20 м²'], ['25', '25 м²'], ['35', '35 м²'], ['50', '50 м²'], ['70', '70 м²'], ['inv', 'Інвертор'], ['heat', 'До −25°C'], ['sale', 'Знижка']];
  screen.innerHTML = `
    <div class="hero"><b>Кондиціонер з монтажем за 1 день</b><span>Огляд безкоштовний. Статус заявки видно тут і на сайті.</span></div>
    <div class="search"><input type="search" id="q" placeholder="Пошук моделі" value="${esc(S.q)}" aria-label="Пошук"></div>
    <div class="chips" id="chips">${chips.map(([k, l]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div>
    <div class="list" id="plist"></div>
    <h2 style="margin-top:8px">Послуги</h2>
    <div class="list">${S.services.map(s => `<button class="item" type="button" data-svc="${esc(s.id)}"><div class="mid"><b>${esc(s.title)}</b><small>${esc(s.text)}</small></div><div class="end"><b>${s.price ? UAH(s.price) : '—'}</b><small class="note">${inCart(s.id) ? '✓ у заявці' : '+ додати'}</small></div></button>`).join('')}</div>`;
  drawList();
  $('q').oninput = e => { S.q = e.target.value; drawList(); };
  $('chips').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; S.filter = c.dataset.f; $('chips').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c)); drawList(); };
}
function drawList() {
  const f = S.filter, q = S.q.trim().toLowerCase();
  const list = S.products.filter(p => (f === 'all' || (+f && p.area === +f) || (f === 'inv' && p.inv) || (f === 'heat' && p.heat <= -25) || (f === 'sale' && p.old)) && (!q || (p.brand + ' ' + p.model).toLowerCase().includes(q))).sort((a, b) => a.price - b.price);
  $('plist').innerHTML = list.length ? list.map(productRow).join('') : '<div class="empty">Нічого не знайшлось</div>';
}
screen.addEventListener('click', e => {
  const p = e.target.closest('[data-p]'); if (p) return productSheet(+p.dataset.p);
  const s = e.target.closest('[data-svc]'); if (s) { const sv = S.services.find(x => x.id === s.dataset.svc); toggleCart({ key: sv.id, title: sv.title, price: sv.price }); vCatalog(); }
});
function toggleCart(item) {
  const i = S.cart.findIndex(c => c.key === item.key);
  if (i >= 0) { S.cart.splice(i, 1); toast('Прибрано із заявки'); } else { S.cart.push(item); toast('Додано до заявки'); }
  saveCart();
}
function productSheet(id) {
  const p = P(id); const k = 'p' + id;
  openSheet(`
    <div class="unit-big ${p.dark ? 'dark' : ''}" style="--c:${esc(p.color)}"><i></i></div>
    <div><div class="note" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">${esc(p.brand)}</div><h2>${esc(p.model)}</h2></div>
    <p style="margin:0;color:var(--muted)">${esc(p.descr)}</p>
    <dl class="specs">
      <dt>Площа</dt><dd>до ${p.area} м²</dd><dt>Потужність</dt><dd>${dec(p.kw)} кВт · ${pad2(p.btu)}</dd>
      <dt>Компресор</dt><dd>${p.inv ? 'інвертор' : 'on/off'}</dd><dt>Обігрів до</dt><dd>${p.heat}°C</dd>
      <dt>Шум</dt><dd>${p.noise} дБ</dd><dt>Енергоклас</dt><dd>${esc(p.cls)}</dd><dt>Гарантія</dt><dd>${p.warranty} р.</dd>
    </dl>
    <div class="card" style="background:var(--bg)"><div style="display:flex;justify-content:space-between;align-items:baseline"><b class="num" style="font-size:1.5rem">${UAH(p.price)}</b>${p.old ? `<s class="num note">${UAH(p.old)}</s>` : ''}</div>
      <div class="note">Монтаж від <b class="num">${UAH(INSTALL[p.btu])}</b>, разом від <b class="num">${UAH(p.price + INSTALL[p.btu])}</b></div></div>
    <div class="row2">
      <button class="btn ${inCart(k) ? 'good' : 'primary'}" type="button" id="shAdd">${inCart(k) ? '✓ У заявці' : 'До заявки'}</button>
      <button class="btn ghost" type="button" id="shInst">+ з монтажем</button>
    </div>`);
  $('shAdd').onclick = () => { toggleCart({ key: k, title: `${p.brand} ${p.model}`, price: p.price }); closeSheet(); };
  $('shInst').onclick = () => {
    if (!inCart(k)) S.cart.push({ key: k, title: `${p.brand} ${p.model}`, price: p.price });
    S.cart = S.cart.filter(c => c.key !== 'install');
    S.cart.push({ key: 'install', title: `Монтаж, клас ${pad2(p.btu)} (базовий)`, price: INSTALL[p.btu] });
    saveCart(); closeSheet(); toast('Додано кондиціонер і монтаж'); S.tab = 'order'; render();
  };
}

function vCalc() {
  const c = S.calc;
  screen.innerHTML = `
    <div class="card">
      <div class="f"><label for="cA">Площа <output id="oA">${c.area} м²</output></label><input type="range" id="cA" min="8" max="80" value="${c.area}"></div>
      <div class="f"><label for="cH">Висота стелі <output id="oH">${dec(c.h.toFixed(1))} м</output></label><input type="range" id="cH" min="2.4" max="4" step="0.1" value="${c.h}"></div>
      <div class="f"><label>Сторона</label><div class="seg" id="cQ">${[[30, 'Тінь'], [35, 'Звичайна'], [40, 'Сонячна']].map(([v, l]) => `<button type="button" data-q="${v}" aria-pressed="${c.q === v}">${l}</button>`).join('')}</div></div>
      <div class="f"><label for="cP">Людей <output id="oP">${c.people}</output></label><input type="range" id="cP" min="1" max="10" value="${c.people}"></div>
    </div>
    <div class="card" id="cRes"></div>`;
  const upd = () => {
    c.area = +$('cA').value; c.h = +$('cH').value; c.people = +$('cP').value;
    $('oA').textContent = c.area + ' м²'; $('oH').textContent = dec(c.h.toFixed(1)) + ' м'; $('oP').textContent = c.people;
    const kw = Api.util.coolingKw(c.area, c.h, c.q, c.people, 0.3); const cls = Api.util.pickClass(kw);
    const recs = cls ? S.products.filter(p => p.btu === cls).sort((a, b) => a.price - b.price).slice(0, 3) : [];
    $('cRes').innerHTML = `<div class="big"><div><b style="color:var(--accent)">${dec(kw.toFixed(1))}</b><span>кВт холоду</span></div><div><b>${cls ? pad2(cls) : '24+'}</b><span>клас BTU</span></div><div><b>${cls ? UAH(INSTALL[cls]) : '—'}</b><span>монтаж від</span></div></div>
      ${recs.length ? '<div class="list">' + recs.map(productRow).join('') + '</div>' : '<div class="note">Понад 7 кВт: потрібні два блоки або мульти-спліт. Викличте майстра на огляд.</div>'}
      <div class="note">Точну ціну з трасою, поверхом і коробом рахує калькулятор на сайті або майстер на огляді.</div>`;
  };
  ['cA', 'cH', 'cP'].forEach(id => $(id).oninput = upd);
  $('cQ').onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; c.q = +b.dataset.q; $('cQ').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); upd(); };
  upd();
}

function vOrder() {
  const total = S.cart.reduce((s, c) => s + (c.price || 0), 0);
  const draft = ls.get('sk_contact', {});
  screen.innerHTML = `
    <div class="card"><h3>Що замовляєте</h3>
      ${S.cart.length ? `<ul class="lines">${S.cart.map((c, i) => `<li><span>${esc(c.title)}<br><button type="button" data-rm="${i}">Прибрати</button></span><b>${c.price ? UAH(c.price) : '—'}</b></li>`).join('')}<li class="total"><span>Разом</span><b>${UAH(total)}</b></li></ul>`
        : '<div class="note">Порожньо. Можна просто викликати майстра на безкоштовний огляд.</div>'}
    </div>
    <form class="card" id="oForm">
      <h3>Контакти</h3>
      <div class="f"><label for="oN">Ім'я</label><input type="text" id="oN" required maxlength="60" value="${esc(draft.name || '')}" autocomplete="name"></div>
      <div class="f"><label for="oT">Телефон</label><input type="tel" id="oT" required maxlength="20" placeholder="+380 67 123 45 67" value="${esc(draft.phone || '')}" autocomplete="tel"></div>
      <div class="f"><label for="oAd">Адреса</label><input type="text" id="oAd" maxlength="120" placeholder="Вулиця, будинок, поверх" value="${esc(draft.addr || '')}"></div>
      <div class="f"><label for="oW">Коли зручно</label><input type="text" id="oW" maxlength="60" placeholder="завтра після 14:00"></div>
      <div class="f"><label for="oM">Майстер</label><select id="oM"><option value="">Будь-хто вільний</option>${S.masters.map(m => `<option value="${m.id}">${esc(m.name)}${m.free ? '' : ' (зайнятий)'}</option>`).join('')}</select></div>
      <div class="f"><label for="oC">Коментар</label><textarea id="oC" rows="2" maxlength="400"></textarea></div>
      <p class="err" id="oErr" hidden></p>
      <button class="btn primary" type="submit" id="oSend">${S.cart.length ? 'Надіслати заявку' : 'Викликати на огляд'}</button>
    </form>`;
  screen.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.cart.splice(+b.dataset.rm, 1); saveCart(); vOrder(); });
  $('oForm').onsubmit = async e => {
    e.preventDefault(); $('oErr').hidden = true; $('oSend').disabled = true;
    const body = { name: $('oN').value, phone: $('oT').value, addr: $('oAd').value, when: $('oW').value, master: $('oM').value, comment: $('oC').value, items: S.cart.map(c => ({ title: c.title, price: c.price || 0 })), source: 'mobile' };
    try {
      const o = await Api.createOrder(body);
      ls.set('sk_contact', { name: body.name, phone: body.phone, addr: body.addr });
      S.cart = []; saveCart(); await loadMine();
      S.tab = 'mine'; render(); toast(`Заявку №${o.id} надіслано`);
    } catch (err) { $('oErr').textContent = err.message; $('oErr').hidden = false; $('oSend').disabled = false; }
  };
}

const STEPS = ['new', 'confirmed', 'onway', 'done'];
function orderCard(o, forMaster) {
  const step = STEPS.indexOf(o.status); const m = M(o.master);
  return `<button class="order" type="button" data-o="${o.id}" data-s="${esc(o.status)}">
    <div class="top-row"><b>№${o.id}${forMaster ? ' · ' + esc(o.name) : ''}</b><span class="st ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></div>
    ${o.status !== 'cancelled' ? `<div class="timeline">${STEPS.map((s, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    <small>${fmtDT(o.created)} · ${o.items.length ? esc(o.items.map(i => i.title).join(', ')) : 'Безкоштовний огляд'}</small>
    <div class="top-row"><small>${forMaster ? (o.addr ? esc(o.addr) : 'Адресу уточнити') : (m ? 'Майстер: ' + esc(m.name) : 'Майстра ще не призначено')}</small><b class="num">${o.total ? UAH(o.total) : ''}</b></div>
  </button>`;
}
async function loadMine() { try { S.myOrders = await Api.myOrders(); } catch (e) {} }
function vMine() {
  screen.innerHTML = S.myOrders.length ? `<div class="list">${S.myOrders.map(o => orderCard(o, false)).join('')}</div><p class="note">Статус оновлюється автоматично. Ці ж заявки видно на сайті в розділі «Заявка».</p>`
    : '<div class="empty">Заявок ще немає. Оберіть кондиціонер у каталозі або викличте майстра на огляд.</div>';
  screen.querySelectorAll('[data-o]').forEach(b => b.onclick = () => clientOrderSheet(S.myOrders.find(o => o.id === +b.dataset.o)));
}
function clientOrderSheet(o) {
  const m = M(o.master);
  openSheet(`<div class="top-row" style="display:flex;justify-content:space-between;align-items:center"><h2>Заявка №${o.id}</h2><span class="st ${esc(o.status)}">${STATUS[o.status]}</span></div>
    <ul class="lines">${o.items.map(i => `<li><span>${esc(i.title)}</span><b>${i.price ? UAH(i.price) : '—'}</b></li>`).join('') || '<li><span>Безкоштовний огляд</span><b></b></li>'}${o.total ? `<li class="total"><span>Разом</span><b>${UAH(o.total)}</b></li>` : ''}</ul>
    ${m ? `<div class="card" style="background:var(--bg)"><div style="display:flex;gap:10px;align-items:center"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div><div><b>${esc(m.name)}</b><br><span class="num note">${esc(m.phone)}</span></div></div><a class="btn ghost" href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">Подзвонити майстру</a></div>` : ''}
    ${o.note ? `<div class="note">Коментар майстра: «${esc(o.note)}»</div>` : ''}
    ${o.status === 'done' ? `<form class="card" id="rvF" style="background:var(--bg)"><h3>Оцініть роботу</h3><div class="star-pick" id="rvS"></div><div class="f"><textarea id="rvT" rows="3" maxlength="600" required placeholder="Як усе пройшло?"></textarea></div><p class="err" id="rvE" hidden></p><button class="btn primary" type="submit">Надіслати відгук</button></form>` : ''}`);
  if (o.status === 'done') {
    let stars = 5; const draw = () => $('rvS').innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" data-st="${i}" class="${i <= stars ? 'on' : ''}" aria-label="${i} з 5">★</button>`).join('');
    draw(); $('rvS').onclick = e => { const b = e.target.closest('[data-st]'); if (b) { stars = +b.dataset.st; draw(); } };
    $('rvF').onsubmit = async e => {
      e.preventDefault();
      try { await Api.addReview({ name: o.name, master: o.master, stars, text: $('rvT').value, source: 'mobile' }); closeSheet(); toast('Дякуємо! Відгук уже на сайті'); }
      catch (err) { $('rvE').textContent = err.message; $('rvE').hidden = false; }
    };
  }
}

function vProfile() {
  const sess = Api.master.session; const isM = S.role === 'master' && sess;
  screen.innerHTML = `
    ${isM ? `<div class="card"><div style="display:flex;gap:12px;align-items:center"><div class="ava" style="background:${esc(sess.master.color)}">${esc(sess.master.short)}</div><div><b>${esc(sess.master.name)}</b><br><span class="note">Режим майстра</span></div></div>
      <div class="switchrow"><span><b>Вільний сьогодні</b><br><span class="note">Видно клієнтам на сайті та в застосунку</span></span><span class="switch"><input type="checkbox" id="freeSw" ${M(sess.master.id) && M(sess.master.id).free ? 'checked' : ''} aria-label="Вільний сьогодні"><i></i></span></div>
      <button class="btn ghost" type="button" id="toClient">Перейти в режим клієнта</button>
      <button class="btn ghost" type="button" id="mLogout">Вийти з акаунта майстра</button></div>`
    : `<div class="card"><h3>Ви майстер Smart Klima?</h3><p class="note" style="margin:0">Увійдіть за PIN, щоб бачити нові заявки, брати їх у роботу і змінювати статус.</p><button class="btn heat" type="button" id="toMaster">Увійти як майстер</button></div>`}
    <div class="card"><h3>Контакти</h3>
      <ul class="lines"><li><span>Гаряча лінія</span><b>+38 (067) 000-24-24</b></li><li><span>Telegram / Viber</span><b>@smartklima_ua</b></li><li><span>Графік</span><b>Пн–Сб 08–20</b></li></ul>
      <a class="btn ghost" href="tel:+380670002424">Подзвонити</a>
      <a class="btn ghost" href="../web/">Відкрити сайт</a>
    </div>
    <div class="card"><h3>Встановити на телефон</h3><p class="note" style="margin:0">Android, Chrome: меню ⋮ → «Встановити застосунок». iPhone, Safari: «Поділитися» → «На екран Додому».</p></div>
    <p class="note" style="text-align:center">${Api.mode === 'server' ? 'Підключено до сервера' : 'Демо-режим: дані зберігаються в цьому браузері, спільно з сайтом'}</p>`;
  if ($('toMaster')) $('toMaster').onclick = () => sess ? (S.role = 'master', ls.set('sk_role', 'master'), loadMaster().then(render)) : masterLogin();
  if ($('toClient')) $('toClient').onclick = () => { S.role = 'client'; ls.set('sk_role', 'client'); S.tab = 'catalog'; render(); };
  if ($('mLogout')) $('mLogout').onclick = () => { Api.master.logout(); S.role = 'client'; ls.set('sk_role', 'client'); S.tab = 'catalog'; render(); };
  if ($('freeSw')) $('freeSw').onchange = async e => { try { await Api.master.setFree(e.target.checked); await loadCatalog(); toast('Збережено'); } catch (err) { toast(err.message); } };
}

/* ================= MASTER ================= */
function masterLogin() {
  let who = '', pin = '';
  const draw = () => {
    openSheet(`<h2>Вхід для майстра</h2>
      <div class="who">${S.masters.map(m => `<button type="button" data-who="${m.id}" aria-pressed="${who === m.id}"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div><b style="font-size:.85rem">${esc(m.name)}</b></button>`).join('')}</div>
      <div class="pindots">${[0, 1, 2, 3].map(i => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <p class="err" id="pinErr" hidden></p>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
      ${Api.mode === 'demo' ? '<p class="note" style="text-align:center">Демо: PIN 1111, 2222, 3333 або 4444 за порядком майстрів</p>' : ''}`);
    $('sheetBody').querySelector('.who').onclick = e => { const b = e.target.closest('[data-who]'); if (b) { who = b.dataset.who; draw(); } };
    $('sheetBody').querySelector('.pinpad').onclick = async e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      if (!who) { $('pinErr').textContent = 'Спершу оберіть себе у списку'; $('pinErr').hidden = false; return; }
      pin = b.dataset.k === '⌫' ? pin.slice(0, -1) : (pin + b.dataset.k).slice(0, 4);
      if (pin.length < 4) return draw();
      try {
        await Api.master.login(who, pin); S.role = 'master'; ls.set('sk_role', 'master'); closeSheet();
        await loadMaster(); S.tab = 'jobs'; render(); toast('Вітаємо, ' + M(who).name.split(' ')[0]);
      } catch (err) { pin = ''; draw(); $('pinErr').textContent = err.message; $('pinErr').hidden = false; }
    };
  };
  draw();
}
async function loadMaster() {
  if (!Api.master.session) return;
  try { S.masterOrders = await Api.master.orders(); }
  catch (err) { if (err.status === 401) { Api.master.logout(); S.role = 'client'; ls.set('sk_role', 'client'); toast('Сесія завершилась, увійдіть знову'); } }
}
function vJobs() {
  const me = Api.master.session.master.id;
  const fresh = S.masterOrders.filter(o => !o.master && ['new', 'confirmed'].includes(o.status));
  const mine = S.masterOrders.filter(o => o.master === me && ['new', 'confirmed', 'onway'].includes(o.status));
  const done = S.masterOrders.filter(o => o.master === me && o.status === 'done');
  const list = S.masterTab === 'new' ? fresh : mine;
  screen.innerHTML = `
    <div class="kpis"><div class="kpi"><b>${fresh.length}</b><span>нових</span></div><div class="kpi"><b>${mine.length}</b><span>у роботі</span></div><div class="kpi"><b>${done.length}</b><span>виконано</span></div></div>
    <div class="seg" id="mSeg"><button type="button" data-mt="new" aria-pressed="${S.masterTab === 'new'}">Нові (${fresh.length})</button><button type="button" data-mt="mine" aria-pressed="${S.masterTab === 'mine'}">Мої (${mine.length})</button></div>
    ${list.length ? `<div class="list">${list.map(o => orderCard(o, true)).join('')}</div>` : `<div class="empty">${S.masterTab === 'new' ? 'Нових заявок немає. Вони з\'являться тут, щойно клієнт надішле заявку з сайту чи застосунку.' : 'У вас немає активних заявок.'}</div>`}`;
  $('mSeg').onclick = e => { const b = e.target.closest('[data-mt]'); if (b) { S.masterTab = b.dataset.mt; vJobs(); } };
  screen.querySelectorAll('[data-o]').forEach(b => b.onclick = () => masterOrderSheet(+b.dataset.o));
}
function vDone() {
  const me = Api.master.session.master.id;
  const done = S.masterOrders.filter(o => o.master === me && o.status === 'done');
  const sum = done.reduce((s, o) => s + o.total, 0);
  screen.innerHTML = `<div class="card"><div class="big"><div><b>${done.length}</b><span>виконано</span></div><div><b>${UAH(sum)}</b><span>сума робіт</span></div></div></div>
    ${done.length ? `<div class="list">${done.map(o => orderCard(o, true)).join('')}</div>` : '<div class="empty">Тут з\'являться виконані заявки.</div>'}`;
  screen.querySelectorAll('[data-o]').forEach(b => b.onclick = () => masterOrderSheet(+b.dataset.o));
}
function masterOrderSheet(id) {
  const o = S.masterOrders.find(x => x.id === id); if (!o) return;
  const me = Api.master.session.master.id; const mine = o.master === me;
  const tel = o.phone.replace(/[^\d+]/g, '');
  const next = { confirmed: ['onway', 'Я виїхав', 'primary'], onway: ['done', 'Роботу виконано', 'good'], new: ['confirmed', 'Підтвердити', 'primary'] }[o.status];
  openSheet(`<div style="display:flex;justify-content:space-between;align-items:center"><h2>Заявка №${o.id}</h2><span class="st ${esc(o.status)}">${STATUS[o.status]}</span></div>
    <div class="card" style="background:var(--bg)"><b>${esc(o.name)}</b><span class="num">${esc(o.phone)}</span>
      ${o.addr ? `<span>📍 ${esc(o.addr)}</span>` : ''}${o.when ? `<span class="note">Коли: ${esc(o.when)}</span>` : ''}
      <div class="row2"><a class="btn primary" href="tel:${esc(tel)}">Подзвонити</a><button class="btn ghost" type="button" id="cpPh">Копіювати</button></div></div>
    <ul class="lines">${o.items.map(i => `<li><span>${esc(i.title)}</span><b>${i.price ? UAH(i.price) : '—'}</b></li>`).join('') || '<li><span>Безкоштовний огляд</span><b></b></li>'}${o.total ? `<li class="total"><span>Разом</span><b>${UAH(o.total)}</b></li>` : ''}</ul>
    ${o.comment ? `<div class="note">Клієнт пише: «${esc(o.comment)}»</div>` : ''}
    <div class="note">Джерело: ${o.source === 'mobile' ? 'застосунок' : 'сайт'} · створено ${fmtDT(o.created)}</div>
    ${!o.master ? '<button class="btn heat" type="button" id="take">Взяти заявку</button>' : ''}
    ${mine && next ? `<button class="btn ${next[2]}" type="button" id="nextSt">${next[1]}</button>` : ''}
    ${mine ? `<div class="f"><label for="note">Нотатка для офісу і клієнта</label><textarea id="note" rows="2" maxlength="400" placeholder="Що зроблено, що докупити">${esc(o.note)}</textarea></div><button class="btn ghost" type="button" id="saveNote">Зберегти нотатку</button>` : ''}
    <p class="err" id="mErr" hidden></p>`);
  const act = async body => {
    try { await Api.master.update(o.id, body); await loadMaster(); closeSheet(); render(); toast('Збережено'); }
    catch (err) { $('mErr').textContent = err.message; $('mErr').hidden = false; }
  };
  $('cpPh').onclick = async () => { try { await navigator.clipboard.writeText(o.phone); toast('Номер скопійовано'); } catch (e) { toast(o.phone); } };
  if ($('take')) $('take').onclick = () => act({ take: true });
  if ($('nextSt')) $('nextSt').onclick = () => act({ status: next[0] });
  if ($('saveNote')) $('saveNote').onclick = () => act({ note: $('note').value });
}

/* ---------- data ---------- */
async function loadCatalog() { const c = await Api.catalog(); S.products = c.products; S.services = c.services; S.masters = c.masters; }
async function refreshAll() {
  try { await loadCatalog(); } catch (e) {}
  await loadMine();
  if (S.role === 'master') await loadMaster();
}

(async () => {
  render();
  await Api.ready;
  await refreshAll(); render();
  Api.subscribe(async () => { await refreshAll(); if ($('sheetBg').hidden) render(); else renderTabs(); });
})();
})();
