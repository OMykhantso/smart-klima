/* Smart Klima: веб-застосунок. Дані — REST API (web/api.js), спільна база з мобільним застосунком. */
(function () {
'use strict';
const { api } = window.SK;
const $ = id => document.getElementById(id);
const UAH = n => Math.round(n).toLocaleString('uk-UA').replace(/[\s,]/g, ' ') + ' ₴';
const dec = n => String(n).replace('.', ',');
const pad2 = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'], WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmtDay = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtDT = iso => { try { return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };
const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const KIND = { install: 'Монтаж', service: 'Сервіс', inspection: 'Огляд' };
const STEPS = ['new', 'confirmed', 'on_way', 'in_work', 'done'];
const ACTION = { confirmed: 'Підтвердити', on_way: 'Майстер виїхав', in_work: 'Почати роботу', done: 'Роботу виконано', cancelled: 'Скасувати' };

/* ---------- state ---------- */
const S = { products: [], services: [], masters: [], statuses: {}, installBase: {}, reviews: [], loaded: false };
let cart = ls.get('sk_cart2', { products: [], services: [], kind: 'install', install: { route: 3, floor: 'low', options: ['wall'], trace: '' } });
let compare = ls.get('sk_cmp', []);
const P = id => S.products.find(p => p.id === id);
const M = id => S.masters.find(m => m.id === id);
const user = () => window.SK.user;

const toastEl = $('toast'); let tT;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(tT); tT = setTimeout(() => toastEl.hidden = true, 2600); }
async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); toast('Скопійовано'); }
  catch (e) { if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast('Текст виділено, скопіюйте вручну'); }
}

/* ---------- router ---------- */
let route = { view: 'home', arg: null };
const TITLES = { home: 'Smart Klima', catalog: 'Каталог', compare: 'Порівняння', calc: 'Калькулятор', services: 'Послуги', masters: 'Майстри', reviews: 'Відгуки', faq: 'Питання', contacts: 'Контакти', order: 'Запис на виїзд', admin: 'Адмінка', login: 'Вхід', register: 'Реєстрація', cabinet: 'Кабінет' };
function parseHash() {
  const h = (location.hash || '').replace(/^#/, ''); let m;
  if ((m = h.match(/^model-(\d+)$/))) return { view: 'model', arg: +m[1] };
  if ((m = h.match(/^master-(m\d+)$/))) return { view: 'master', arg: m[1] };
  return { view: TITLES[h] ? h : 'home', arg: null };
}
function go() {
  const prev = route.view + route.arg;
  route = parseHash();
  const u = user();
  if (route.view === 'admin' && (!u || u.role !== 'admin')) { location.hash = u ? 'cabinet' : 'login'; return; }
  if (route.view === 'cabinet' && !u) { location.hash = 'login'; return; }
  if (['login', 'register'].includes(route.view) && u) { location.hash = u.role === 'admin' ? 'admin' : 'cabinet'; return; }
  document.querySelectorAll('.view').forEach(v => v.hidden = v.dataset.view !== route.view);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav.split(' ').includes(route.view)));
  $('navLinks').classList.remove('open'); $('burger').setAttribute('aria-expanded', false);
  document.title = route.view === 'home' ? 'Smart Klima' : (TITLES[route.view] || 'Smart Klima') + ' · Smart Klima';
  renderView();
  if (prev !== route.view + route.arg) window.scrollTo(0, 0);
}
function renderView() {
  if (!S.loaded && !['login', 'register', 'faq', 'contacts'].includes(route.view)) return;
  ({ home: renderHome, catalog: renderGrid, model: () => renderProduct(route.arg), compare: renderCompare, calc, services: renderServices, masters: renderMasters,
     master: () => renderMasterPage(route.arg), reviews: renderReviews, order: renderBooking, cabinet: loadCabinet, admin: loadAdmin }[route.view] || (() => {}))();
}
window.addEventListener('hashchange', go);
$('burger').onclick = () => { const o = $('navLinks').classList.toggle('open'); $('burger').setAttribute('aria-expanded', o); };
function renderAccount() {
  const u = user();
  $('accBtn').textContent = u ? (u.role === 'admin' ? 'Адмінка' : u.name.split(' ')[0]) : 'Увійти';
  $('accBtn').href = u ? (u.role === 'admin' ? '#admin' : '#cabinet') : '#login';
  $('navAdmin').hidden = !(u && u.role === 'admin');
}
window.SK.onAuth(() => { renderAccount(); });

/* ---------- cart ---------- */
function saveCart() { ls.set('sk_cart2', cart); $('cartCount').textContent = cart.products.reduce((s, p) => s + p.qty, 0) + cart.services.length; }
const inCart = id => cart.products.some(p => p.id === id);
function toggleProduct(id) {
  if (inCart(id)) { cart.products = cart.products.filter(p => p.id !== id); toast('Прибрано із запису'); }
  else { cart.products.push({ id, qty: 1 }); cart.kind = 'install'; toast('Додано до запису на монтаж'); }
  saveCart(); renderView();
}
function toggleService(id) {
  if (cart.services.includes(id)) cart.services = cart.services.filter(s => s !== id);
  else { cart.services.push(id); if (!cart.products.length) cart.kind = 'service'; }
  saveCart(); toast(cart.services.includes(id) ? 'Послугу додано' : 'Послугу прибрано'); renderView();
}
function toggleCompare(id) {
  const i = compare.indexOf(id);
  if (i >= 0) compare.splice(i, 1); else { if (compare.length >= 4) { toast('Можна порівняти до 4 моделей'); return; } compare.push(id); }
  ls.set('sk_cmp', compare); updateCmpLink(); renderView();
}
function updateCmpLink() { $('cmpCount').textContent = compare.length; $('cmpLink').hidden = !compare.length; }

/* ---------- catalog cards ---------- */
function cardHTML(p) {
  const inC = inCart(p.id), inCmp = compare.includes(p.id);
  return `<article class="card">
    <a class="unit ${p.dark ? 'dark' : ''}" style="--c:${esc(p.color)}" href="#model-${p.id}" aria-label="${esc(p.brand + ' ' + p.model)}"><div class="body"></div></a>
    <div><div class="brand">${esc(p.brand)}</div><h3><a href="#model-${p.id}">${esc(p.model)}</a></h3></div>
    <div class="tags">
      ${p.old ? '<span class="tag heat">−' + Math.round((1 - p.price / p.old) * 100) + '%</span>' : ''}
      ${p.inv ? '<span class="tag inv">Інвертор</span>' : '<span class="tag">On/Off</span>'}
      ${p.wifi ? '<span class="tag">Wi‑Fi</span>' : ''}
      <span class="tag ${p.heat <= -25 ? 'heat' : ''}">Обігрів до ${p.heat}°C</span>
    </div>
    <dl class="specs"><dt>Площа</dt><dd>до ${p.area} м²</dd><dt>Потужність</dt><dd>${dec(p.kw)} кВт / ${pad2(p.btu)}</dd><dt>Шум</dt><dd>${p.noise} дБ</dd></dl>
    <div class="price"><div>${p.old ? `<s>${UAH(p.old)}</s>` : ''}<b>${UAH(p.price)}</b></div>
      <div class="btnrow"><button type="button" class="cmp ${inCmp ? 'on' : ''}" data-cmp="${p.id}" title="Порівняти" aria-label="Порівняти">⇄</button>
      <button type="button" class="add ${inC ? 'in' : ''}" data-id="${p.id}">${inC ? '✓ У записі' : 'Замовити'}</button></div></div>
  </article>`;
}
let pendingMaster = '';
document.addEventListener('click', e => {
  const a = e.target.closest('.add[data-id]'); if (a) { toggleProduct(+a.dataset.id); return; }
  const c = e.target.closest('[data-cmp]'); if (c) { toggleCompare(+c.dataset.cmp); return; }
  const s = e.target.closest('[data-s-add]'); if (s) { toggleService(s.dataset.sAdd); return; }
  const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy, cp.previousElementSibling); return; }
  const b = e.target.closest('[data-book]'); if (b) { pendingMaster = b.dataset.book; location.hash = 'order'; return; }
  const k = e.target.closest('a[data-kind]'); if (k) { cart.kind = k.dataset.kind; saveCart(); }
  const ar = e.target.closest('[data-area]'); if (ar) $('fArea').value = ar.dataset.area;
  const cb = e.target.closest('[data-calc-area]'); if (cb) { $('cArea').value = cb.dataset.calcArea; calc(); location.hash = 'calc'; }
});

/* ---------- home / catalog / product / compare ---------- */
function renderHome() {
  $('homeHits').innerHTML = S.products.filter(p => p.hit).map(cardHTML).join('');
  $('homeSvc').innerHTML = S.services.slice(0, 3).map(svcHTML).join('');
  $('homeMasters').innerHTML = S.masters.map(m => `<a href="#master-${m.id}"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div><div><b>${esc(m.name)}</b><small><span class="status ${m.freeToday ? 'free' : 'busy'}">${m.freeToday ? 'Є час сьогодні' : 'Зайнятий сьогодні'}</span></small></div></a>`).join('');
  $('homeReviews').innerHTML = S.reviews.slice(0, 3).map(reviewHTML).join('');
}
let filter = 'all';
function renderGrid() {
  const maxA = +$('fArea').value, sort = $('fSort').value, brand = $('fBrand').value, q = $('fSearch').value.trim().toLowerCase();
  const list = S.products.filter(p => (filter === 'all' || (filter === 'inv' && p.inv) || (filter === 'heat' && p.heat <= -25) || (filter === 'wifi' && p.wifi) || (filter === 'sale' && p.old)) &&
    (!maxA || p.area === maxA) && (!brand || p.brand === brand) && (!q || (p.brand + ' ' + p.model).toLowerCase().includes(q)));
  list.sort((a, b) => sort === 'price' ? a.price - b.price : sort === '-price' ? b.price - a.price : a.noise - b.noise);
  $('foundCount').textContent = `Знайдено моделей: ${list.length}`;
  $('grid').innerHTML = list.length ? list.map(cardHTML).join('') : '<div class="empty">Нічого не знайшлось. Спробуйте інший фільтр.</div>';
  updateCmpLink();
}
$('filters').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; filter = c.dataset.f; $('filters').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c)); renderGrid(); });
['fArea', 'fSort', 'fBrand'].forEach(id => $(id).onchange = renderGrid);
$('fSearch').oninput = renderGrid;

function renderProduct(id) {
  const p = P(id); if (!p) { $('prodBox').innerHTML = '<div class="empty">Модель не знайдено.</div>'; return; }
  document.title = `${p.brand} ${p.model} · Smart Klima`; $('pCrumb').textContent = `${p.brand} ${p.model}`;
  const inst = S.installBase[p.btu];
  $('prodBox').innerHTML = `
    <div>
      <div class="unit ${p.dark ? 'dark' : ''}" style="--c:${esc(p.color)}"><div class="body"></div></div>
      <div class="tags" style="margin-top:14px">${p.old ? '<span class="tag heat">−' + Math.round((1 - p.price / p.old) * 100) + '%</span>' : ''}${p.inv ? '<span class="tag inv">Інвертор</span>' : '<span class="tag">On/Off</span>'}${p.wifi ? '<span class="tag">Wi‑Fi</span>' : ''}<span class="tag">${esc(p.cls)}</span><span class="tag">R32</span></div>
      <h3 style="margin:24px 0 8px">Характеристики</h3>
      <table class="spec-table">
        <tr><th>Рекомендована площа</th><td>до ${p.area} м²</td></tr><tr><th>Холодопродуктивність</th><td>${dec(p.kw)} кВт (${pad2(p.btu)} тис. BTU)</td></tr>
        <tr><th>Тип компресора</th><td>${p.inv ? 'Інверторний' : 'On/Off'}</td></tr><tr><th>Обігрів працює до</th><td>${p.heat}°C</td></tr>
        <tr><th>Рівень шуму (мін.)</th><td>${p.noise} дБ</td></tr><tr><th>Енергоклас</th><td>${esc(p.cls)}</td></tr>
        <tr><th>Wi‑Fi керування</th><td>${p.wifi ? 'Так' : 'Немає'}</td></tr><tr><th>Гарантія виробника</th><td>${p.warranty} ${p.warranty < 5 ? 'роки' : 'років'}</td></tr>
      </table>
    </div>
    <div>
      <div class="brand">${esc(p.brand)}</div><h1>${esc(p.model)}</h1><p class="lead">${esc(p.descr)}</p>
      <ul class="perks"><li>Монтаж за 1 день, огляд безкоштовний</li><li>3 роки гарантії на монтаж від Smart Klima</li><li>Оплата після монтажу або частинами</li></ul>
      <div class="buy">
        <div class="pr"><b>${UAH(p.price)}</b>${p.old ? `<s>${UAH(p.old)}</s>` : ''}</div>
        <div class="note">Стандартний монтаж для класу ${pad2(p.btu)}: від <b class="num">${UAH(inst)}</b>. Разом з монтажем від <b class="num">${UAH(p.price + inst)}</b>.</div>
        <div class="acts">
          <button type="button" class="btn primary add ${inCart(p.id) ? 'in' : ''}" data-id="${p.id}">${inCart(p.id) ? '✓ У записі' : 'Замовити з монтажем'}</button>
          <button type="button" class="btn ghost" data-calc-area="${p.area}">Порахувати монтаж</button>
          <button type="button" class="btn ghost" data-cmp="${p.id}">${compare.includes(p.id) ? '✓ У порівнянні' : '⇄ Порівняти'}</button>
        </div>
      </div>
    </div>`;
  const sim = S.products.filter(x => x.btu === p.btu && x.id !== p.id);
  const fill = sim.length < 3 ? S.products.filter(x => x.id !== p.id && !sim.includes(x)).sort((a, b) => Math.abs(a.kw - p.kw) - Math.abs(b.kw - p.kw)).slice(0, 3 - sim.length) : [];
  $('prodSimilar').innerHTML = [...sim, ...fill].slice(0, 4).map(cardHTML).join('');
}
function renderCompare() {
  const list = compare.map(P).filter(Boolean);
  if (!list.length) { $('cmpBox').innerHTML = '<div class="empty">Ви ще нічого не додали. Натисніть «⇄» на картці моделі в <a href="#catalog">каталозі</a>.</div>'; return; }
  const rows = [['Ціна', p => p.price, v => UAH(v), 'min'], ['Площа', p => p.area, v => `до ${v} м²`, null], ['Потужність', p => p.kw, v => `${dec(v)} кВт`, null], ['Шум', p => p.noise, v => `${v} дБ`, 'min'],
    ['Обігрів до', p => p.heat, v => `${v}°C`, 'min'], ['Компресор', p => p.inv ? 1 : 0, v => v ? 'Інвертор' : 'On/Off', 'max'], ['Wi‑Fi', p => p.wifi ? 1 : 0, v => v ? 'Так' : 'Немає', 'max'],
    ['Енергоклас', p => p.cls.length, (v, p) => esc(p.cls), 'max'], ['Гарантія', p => p.warranty, v => `${v} р.`, 'max'], ['Монтаж від', p => S.installBase[p.btu], v => UAH(v), null]];
  $('cmpBox').innerHTML = `<div class="tablewrap"><table class="ctable"><thead><tr><th></th>${list.map(p => `<th><div class="brand">${esc(p.brand)}</div><a href="#model-${p.id}">${esc(p.model)}</a><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="add ${inCart(p.id) ? 'in' : ''}" data-id="${p.id}">${inCart(p.id) ? '✓' : 'Замовити'}</button><button type="button" class="cmp" data-cmp="${p.id}" aria-label="Прибрати">✕</button></div></th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, get, fmt, best]) => { const vals = list.map(get); const target = best === 'min' ? Math.min(...vals) : best === 'max' ? Math.max(...vals) : null; const differ = new Set(vals).size > 1;
      return `<tr><th>${label}</th>${list.map((p, i) => `<td class="${best && differ && vals[i] === target ? 'best' : ''}">${fmt(vals[i], p)}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`;
}

/* ---------- calculator (розрахунок на сервері) ---------- */
let sun = 'normal', lastCalc = null, calcTimer;
$('cSun').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sun = { 30: 'shade', 35: 'normal', 40: 'sunny' }[b.dataset.q]; [...$('cSun').children].forEach(x => x.setAttribute('aria-pressed', x === b)); calc(); });
['cArea', 'cH', 'cPeople', 'cTech', 'cRoute', 'cFloor', 'xWall', 'xBox', 'xHidden', 'xPump', 'xOld', 'xFence'].forEach(id => $(id).addEventListener('input', calc));
$('xBox').addEventListener('change', () => { if ($('xBox').checked) { $('xHidden').checked = false; calc(); } });
$('xHidden').addEventListener('change', () => { if ($('xHidden').checked) { $('xBox').checked = false; calc(); } });
function calcInput() {
  return { area: +$('cArea').value, height: +$('cH').value, sun, people: +$('cPeople').value, tech: +$('cTech').value, route: +$('cRoute').value,
    floor: { 0: 'low', 800: 'mid', 1500: 'high' }[$('cFloor').value], trace: $('xBox').checked ? 'box' : $('xHidden').checked ? 'hidden' : '',
    options: [['xWall', 'wall'], ['xPump', 'pump'], ['xOld', 'old'], ['xFence', 'fence']].filter(([id]) => $(id).checked).map(x => x[1]) };
}
function calc() {
  const inp = calcInput();
  $('oArea').textContent = inp.area + ' м²'; $('oH').textContent = dec(inp.height.toFixed(1)) + ' м'; $('oPeople').textContent = inp.people; $('oTech').textContent = dec(inp.tech.toFixed(1)) + ' кВт'; $('oRoute').textContent = inp.route + ' м';
  clearTimeout(calcTimer);
  calcTimer = setTimeout(async () => {
    let r; try { r = await api('POST', '/api/calc', inp); } catch (e) { return; }
    lastCalc = { ...r, input: inp };
    $('rKw').textContent = dec(r.kw); $('rBtu').textContent = r.btu ? pad2(r.btu) : '24+';
    $('rLines').innerHTML = r.install.lines.map(l => `<li><span>${esc(l.title)}</span><span>${UAH(l.price)}</span></li>`).join('') + `<li class="total"><span>Монтаж разом</span><span>${UAH(r.install.total)}</span></li>`;
    const recs = r.btu ? S.products.filter(p => p.btu === r.btu).sort((a, b) => a.price - b.price).slice(0, 3) : [];
    $('rRec').innerHTML = recs.length ? recs.map(p => `<a href="#model-${p.id}" style="display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink)"><span>${esc(p.brand + ' ' + p.model)}<br><small class="note">${p.inv ? 'інвертор' : 'on/off'} · ${p.noise} дБ</small></span><b class="num">${UAH(p.price)}</b></a>`).join('')
      : '<div class="note">Потрібно понад 7 кВт. Для такого приміщення радимо два блоки або мульти-спліт, майстер підбере на огляді.</div>';
  }, 150);
}
$('calcOrder').onclick = () => {
  if (!lastCalc) return;
  const { route, floor, options, trace } = lastCalc.input;
  cart.install = { route, floor, options, trace };
  if (lastCalc.btu && !cart.products.length) { const p = S.products.filter(x => x.btu === lastCalc.btu).sort((a, b) => a.price - b.price)[0]; if (p) cart.products.push({ id: p.id, qty: 1 }); }
  cart.kind = lastCalc.btu ? 'install' : 'inspection'; saveCart(); location.hash = 'order';
};

/* ---------- services / masters ---------- */
function svcHTML(s) {
  return `<article><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><div class="row"><b>${s.price ? 'від ' + UAH(s.price) : 'за домовленістю'}</b>
    <button type="button" class="add ${cart.services.includes(s.id) ? 'in' : ''}" data-s-add="${esc(s.id)}">${cart.services.includes(s.id) ? '✓ У записі' : 'Замовити'}</button></div></article>`;
}
function renderServices() { $('svcList').innerHTML = S.services.map(svcHTML).join(''); }
function masterCardHTML(m, full) {
  const cnt = S.reviews.filter(r => r.master === m.id).length;
  return `<article class="m-card">
    <div class="m-top"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div>
      <div><h3>${full ? esc(m.name) : `<a href="#master-${m.id}" style="color:inherit;text-decoration:none">${esc(m.name)}</a>`}</h3><small>Досвід ${m.exp} років · <span class="num">${m.jobs}</span> монтажів</small></div></div>
    <div style="display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap"><span class="stars">${'★'.repeat(Math.round(m.rating))}</span><span class="num">${dec((+m.rating).toFixed(1))}</span>
      <span class="status ${m.freeToday ? 'free' : 'busy'}">${m.freeToday ? 'Є час сьогодні' : 'Зайнятий сьогодні'}</span></div>
    ${full ? `<p style="margin:0;color:var(--muted);font-size:.92rem">${esc(m.bio)}</p><div class="note">Район: <b>${esc(m.district)}</b></div>` : ''}
    <ul>${m.skills.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <div class="m-actions">
      <div class="phone"><span>${esc(m.phone)}</span><button class="copy" type="button" data-copy="${esc(m.phone)}">Копіювати</button></div>
      <button class="btn primary sm" type="button" data-book="${m.id}">Записатися до майстра</button>
      ${full ? '' : `<a class="btn ghost sm" href="#master-${m.id}">Профіль і відгуки (${cnt})</a>`}
    </div></article>`;
}
function renderMasters() { $('mastersList').innerHTML = S.masters.map(m => masterCardHTML(m, false)).join(''); }
function renderMasterPage(id) {
  const m = M(id); if (!m) return;
  document.title = m.name + ' · Smart Klima'; $('mCrumb').textContent = m.name; $('mProfCard').innerHTML = masterCardHTML(m, true);
  const revs = S.reviews.filter(r => r.master === id);
  $('mRevTitle').textContent = revs.length ? `${revs.length} ${revs.length === 1 ? 'відгук' : revs.length < 5 ? 'відгуки' : 'відгуків'}` : 'Поки без відгуків';
  $('mRevList').innerHTML = revs.length ? revs.map(reviewHTML).join('') : '<div class="empty">Про цього майстра ще не писали.</div>';
}

/* ---------- reviews ---------- */
let revMaster = '';
function reviewHTML(r) {
  const m = M(r.master); const st = Math.max(1, Math.min(5, Math.round(+r.stars))); const u = user();
  return `<article class="rev"><header><b>${esc(r.name)}</b><span class="stars">${'★'.repeat(st)}${'☆'.repeat(5 - st)}</span></header>
    <p>${esc(r.text)}</p><div class="who"><span>Майстер: ${m ? `<a href="#master-${m.id}">${esc(m.name)}</a>` : '—'} · ${fmtDate(r.date)}</span>
    ${r.source === 'mobile' ? '<span class="pill">із застосунку</span>' : r.source === 'seed' ? '' : '<span class="pill">з сайту</span>'}
    ${u && u.role === 'admin' ? `<button class="linkbtn" type="button" data-delrev="${r.id}">Видалити</button>` : ''}</div></article>`;
}
function renderReviews() {
  const list = S.reviews; const avg = list.length ? list.reduce((s, r) => s + (+r.stars), 0) / list.length : 0;
  $('avg').textContent = avg ? dec(avg.toFixed(1)) : '–'; $('avgStars').textContent = avg ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) : '';
  $('revCount').textContent = `на основі ${list.length} відгуків`;
  $('dist').innerHTML = [5, 4, 3, 2, 1].map(s => { const n = list.filter(r => +r.stars === s).length; return `<div><span>${s}</span><i><b style="width:${list.length ? n / list.length * 100 : 0}%"></b></i><span class="num">${n}</span></div>`; }).join('');
  $('revFilter').innerHTML = `<button class="chip" type="button" data-rm="" aria-pressed="${!revMaster}">Усі</button>` + S.masters.map(m => `<button class="chip" type="button" data-rm="${m.id}" aria-pressed="${revMaster === m.id}">${esc(m.name.split(' ')[0])}</button>`).join('');
  const shown = list.filter(r => !revMaster || r.master === revMaster);
  $('revList').innerHTML = shown.length ? shown.map(reviewHTML).join('') : '<div class="empty">Відгуків ще немає.</div>';
}
$('revFilter').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { revMaster = b.dataset.rm; renderReviews(); } });
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-delrev]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Точно видалити?'; return; }
  try { await api('DELETE', '/api/admin/reviews/' + b.dataset.delrev); toast('Відгук видалено'); await loadReviews(); } catch (err) { toast(err.message); }
});

/* ---------- booking ---------- */
let bDate = addDays(kyivToday(), 1), bTime = '', installPrice = {};
$('bKind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; cart.kind = b.dataset.k; saveCart(); renderBooking(); });
async function renderBooking() {
  const u = user();
  [...$('bKind').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.k === cart.kind));
  const prods = cart.products.map(c => ({ ...P(c.id), qty: c.qty })).filter(p => p.id);
  const svcs = S.services.filter(s => cart.services.includes(s.id));
  if (cart.kind === 'install') {
    const btus = [...new Set(prods.map(p => p.btu))];
    await Promise.all(btus.map(async b => { installPrice[b] = (await api('POST', '/api/calc', { btu: b, ...cart.install }).catch(() => ({ install: { total: S.installBase[b] } }))).install.total; }));
  }
  let rows = '', total = 0;
  if (cart.kind === 'install') {
    rows = prods.length ? prods.map(p => { const sum = (p.price + (installPrice[p.btu] || 0)) * p.qty; total += sum;
      return `<div class="ci"><span>${esc(p.brand + ' ' + p.model)} × ${p.qty}<br><small class="note">${UAH(p.price)} + монтаж ${UAH(installPrice[p.btu] || 0)}</small></span><span style="display:flex;gap:6px;align-items:center"><button type="button" class="cmp" data-qty="${p.id}|-1">−</button><button type="button" class="cmp" data-qty="${p.id}|1">+</button><b class="num">${UAH(sum)}</b></span></div>`; }).join('')
      : '<p class="note" style="font-size:.92rem">Оберіть кондиціонер у <a href="#catalog">каталозі</a> або в <a href="#calc">калькуляторі</a>.</p>';
    const i = cart.install;
    $('bInstall').textContent = prods.length ? `Умови монтажу: траса ${i.route} м, ${{ low: '1–2 поверх', mid: '3–5 поверх', high: '6+ поверх' }[i.floor]}${i.options.length ? ', ' + i.options.map(o => ({ wall: 'свердління', pump: 'помпа', old: 'демонтаж старого', fence: 'кошик' }[o])).join(', ') : ''}. Змінити можна в калькуляторі.` : '';
  } else {
    $('bInstall').textContent = '';
    if (cart.kind === 'service') {
      rows = S.services.map(s => `<label class="ci" style="cursor:pointer"><span><input type="checkbox" data-svc="${s.id}" ${cart.services.includes(s.id) ? 'checked' : ''}> ${esc(s.title)}<br><small class="note">${s.duration} хв</small></span><b class="num">${s.price ? UAH(s.price) : '—'}</b></label>`).join('');
      total = svcs.reduce((s, x) => s + x.price, 0);
    } else rows = '<p class="note" style="font-size:.92rem">Майстер приїде, заміряє приміщення і трасу, порадить модель і назве точну ціну. Огляд безкоштовний.</p>';
  }
  $('dItems').innerHTML = rows; $('dTotal').textContent = total ? UAH(total) : 'безкоштовно';
  const days = Array.from({ length: 14 }, (_, i) => addDays(kyivToday(), i));
  $('bDays').innerHTML = days.map((d, i) => `<button class="chip" type="button" data-day="${d}" aria-pressed="${d === bDate}">${i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : fmtDay(d)}</button>`).join('');
  if (pendingMaster) { $('oMaster').value = pendingMaster; pendingMaster = ''; }
  $('bNeedLogin').hidden = !!u; $('orderForm').hidden = !u || !$('dOk').hidden;
  if (u && !$('oName').value) { $('oName').value = u.name; $('oPhone').value = u.phone; }
  loadSlots();
}
async function loadSlots() {
  const units = cart.products.reduce((s, p) => s + p.qty, 0) || 1;
  $('bSlots').innerHTML = '<span class="note">Завантаження…</span>';
  try {
    const r = await api('GET', `/api/slots?date=${bDate}&kind=${cart.kind}&units=${units}&services=${cart.services.join(',')}&master=${$('oMaster').value}`);
    if (!r.slots.some(s => s.time === bTime)) bTime = '';
    $('bSlots').innerHTML = r.slots.length ? r.slots.map(s => `<button class="chip slot" type="button" data-time="${s.time}" aria-pressed="${s.time === bTime}" title="до ${s.end}, вільних майстрів: ${s.masters}">${s.time}</button>`).join('')
      + `<p class="note" style="width:100%;margin:4px 0 0">Тривалість виїзду: ${Math.floor(r.duration / 60)} год${r.duration % 60 ? ' ' + r.duration % 60 + ' хв' : ''}.</p>`
      : '<div class="empty" style="width:100%">На цей день вільного часу немає. Оберіть інший день.</div>';
  } catch (e) { $('bSlots').innerHTML = `<span class="note err">${esc(e.message)}</span>`; }
  $('oSubmit').textContent = bTime ? `Записатися на ${fmtDay(bDate)}, ${bTime}` : 'Оберіть час'; $('oSubmit').disabled = !bTime;
}
$('bDays').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (!b) return; bDate = b.dataset.day; bTime = ''; $('bDays').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === b)); loadSlots(); });
$('bSlots').addEventListener('click', e => { const b = e.target.closest('[data-time]'); if (!b) return; bTime = b.dataset.time; $('bSlots').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === b)); $('oSubmit').textContent = `Записатися на ${fmtDay(bDate)}, ${bTime}`; $('oSubmit').disabled = false; });
$('oMaster').onchange = loadSlots;
$('dItems').addEventListener('click', e => {
  const q = e.target.closest('[data-qty]'); if (!q) return;
  const [id, d] = q.dataset.qty.split('|').map(Number); const it = cart.products.find(p => p.id === id); if (!it) return;
  it.qty = Math.min(5, it.qty + d); if (it.qty < 1) cart.products = cart.products.filter(p => p.id !== id); saveCart(); renderBooking();
});
$('dItems').addEventListener('change', e => { const c = e.target.closest('[data-svc]'); if (c) { toggleService(c.dataset.svc); } });
$('orderForm').addEventListener('submit', async e => {
  e.preventDefault(); $('oErr').hidden = true; $('oSubmit').disabled = true;
  try {
    const o = await api('POST', '/api/orders', { kind: cart.kind, date: bDate, time: bTime, masterId: $('oMaster').value,
      products: cart.kind === 'install' ? cart.products : [], services: cart.kind === 'service' ? cart.services : [], install: cart.install,
      contactName: $('oName').value, contactPhone: $('oPhone').value, address: $('oAddr').value, comment: $('oComment').value, source: 'web' });
    $('orderForm').hidden = true; $('dOk').hidden = false;
    $('dOk').innerHTML = `<div class="ok">Заявку №${o.id} прийнято: ${fmtDay(o.startsAt.slice(0, 10))}, ${o.startsAt.slice(11)}–${o.endsAt.slice(11)}. Майстер: ${esc(o.master.name)}. Статус видно в кабінеті й у мобільному застосунку.</div>
      <a class="btn primary" href="#cabinet">Перейти до моїх заявок</a><button class="btn ghost" type="button" id="oAgain">Новий запис</button>`;
    $('oAgain').onclick = () => { $('dOk').hidden = true; $('orderForm').hidden = false; renderBooking(); };
    cart.products = []; cart.services = []; bTime = ''; saveCart(); $('oComment').value = '';
  } catch (err) { $('oErr').textContent = err.message; $('oErr').hidden = false; if (err.code === 'SLOT_TAKEN') loadSlots(); }
  finally { $('oSubmit').disabled = !bTime; }
});

/* ---------- auth ---------- */
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('lErr').hidden = true;
  try { const u = await window.SK.login($('lEmail').value.trim(), $('lPass').value); $('lPass').value = ''; location.hash = u.role === 'admin' ? 'admin' : 'cabinet'; }
  catch (err) { $('lErr').textContent = err.message; $('lErr').hidden = false; }
});
$('regForm').addEventListener('submit', async e => {
  e.preventDefault(); $('rErr').hidden = true;
  try { await window.SK.register({ name: $('rName').value, email: $('rEmail').value.trim(), phone: $('rPhone').value, password: $('rPass').value }); location.hash = cart.products.length || cart.services.length ? 'order' : 'cabinet'; }
  catch (err) { $('rErr').textContent = err.message; $('rErr').hidden = false; }
});
$('logoutBtn').onclick = async () => { await window.SK.logout(); location.hash = 'home'; };

/* ---------- cabinet ---------- */
function orderHTML(o, mode) {
  const step = STEPS.indexOf(o.status);
  const acts = o.next.filter(s => mode === 'master' ? s !== 'cancelled' : true);
  return `<article class="order" data-s="${esc(o.status)}" data-oid="${o.id}">
    <div class="top"><b>№${o.id} · ${KIND[o.kind]} · ${fmtDay(o.startsAt.slice(0, 10))}, ${o.startsAt.slice(11)}–${o.endsAt.slice(11)}</b>
      <span style="display:flex;gap:6px;align-items:center">${mode === 'admin' ? `<span class="pill">${o.source === 'mobile' ? 'Застосунок' : 'Сайт'}</span>` : ''}<span class="st ${esc(o.status)}">${esc(o.statusLabel)}</span></span></div>
    ${o.status !== 'cancelled' ? `<div class="timeline">${STEPS.map((s, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    <div class="meta">${mode !== 'client' ? `<span>Клієнт: <b>${esc(o.contactName)}</b> <span class="num">${esc(o.contactPhone)}</span></span>` : ''}<span>Адреса: <b>${esc(o.address)}</b></span>${o.master && mode !== 'master' ? `<span>Майстер: <b>${esc(o.master.name)}</b> <span class="num">${esc(o.master.phone)}</span></span>` : ''}</div>
    <ul>${o.items.length ? o.items.map(i => `<li>${esc(i.title)} — ${UAH(i.price)}</li>`).join('') : '<li>Безкоштовний огляд</li>'}</ul>
    ${o.comment ? `<div class="note">Клієнт: «${esc(o.comment)}»</div>` : ''}${o.masterNote ? `<div class="note">Майстер: «${esc(o.masterNote)}»</div>` : ''}
    <details><summary class="note" style="cursor:pointer">Історія статусів</summary><div class="hist">${o.history.map(h => `<span>${fmtDT(h.at)} · ${esc(S.statuses[h.to_status] || h.to_status)}${h.actor ? ' · ' + esc(h.actor) : ''}</span>`).join('')}</div></details>
    <div class="ctrl"><b class="num" style="margin-right:auto">${o.total ? UAH(o.total) : 'безкоштовно'}</b>
      ${mode === 'admin' && !['done', 'cancelled'].includes(o.status) ? `<select data-assign="${o.id}" aria-label="Майстер">${S.masters.map(m => `<option value="${m.id}" ${o.master && o.master.id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
      ${acts.map(s => `<button class="btn ${s === 'cancelled' ? 'ghost' : 'primary'} sm" type="button" data-st="${o.id}|${s}">${ACTION[s]}</button>`).join('')}
    </div>
    ${mode === 'client' && o.status === 'done' && !o.review ? `<form class="rvform" data-rv="${o.id}" style="display:grid;gap:8px;border-top:1px solid var(--line);padding-top:10px">
      <b>Оцініть роботу майстра</b><div class="star-pick">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" class="on" aria-label="${i} з 5">★</button>`).join('')}</div>
      <textarea class="inp" rows="2" maxlength="600" required placeholder="Як усе пройшло?"></textarea><button class="btn primary sm" type="submit">Надіслати відгук</button></form>` : ''}
    ${o.review ? `<div class="note">Ваш відгук: <span class="stars">${'★'.repeat(o.review.stars)}</span> ${esc(o.review.text)}</div>` : ''}
  </article>`;
}
async function loadCabinet() {
  const u = user(); if (!u) return;
  if (u.role === 'admin') { location.hash = 'admin'; return; }
  $('cabTitle').textContent = u.role === 'master' ? 'Мій розклад' : 'Мої заявки';
  $('cabSub').textContent = u.role === 'master' ? `${u.name}. Повний робочий процес майстра — у мобільному застосунку.` : `${u.name}, ${u.email}. Ці ж заявки видно в мобільному застосунку.`;
  try {
    const list = await api('GET', u.role === 'master' ? '/api/master/schedule' : '/api/orders/my');
    $('cabOrders').innerHTML = list.length ? list.map(o => orderHTML(o, u.role)).join('') : `<div class="empty">Заявок ще немає. <a href="#order">Записатися на виїзд</a></div>`;
  } catch (e) { $('cabOrders').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-st]'); if (!b) return;
  const [id, status] = b.dataset.st.split('|');
  if (status === 'cancelled' && b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Точно скасувати?'; return; }
  try { await api('PATCH', `/api/orders/${id}/status`, { status }); toast('Статус змінено'); renderView(); } catch (err) { toast(err.message); }
});
document.addEventListener('click', e => { const s = e.target.closest('[data-star]'); if (!s) return; const n = +s.dataset.star; s.parentElement.querySelectorAll('[data-star]').forEach(x => x.classList.toggle('on', +x.dataset.star <= n)); s.parentElement.dataset.v = n; });
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-rv]'); if (!f) return; e.preventDefault();
  try { await api('POST', `/api/orders/${f.dataset.rv}/review`, { stars: +(f.querySelector('.star-pick').dataset.v || 5), text: f.querySelector('textarea').value, source: 'web' }); toast('Дякуємо за відгук!'); await loadReviews(); loadCabinet(); }
  catch (err) { toast(err.message); }
});

/* ---------- admin ---------- */
let admTab = 'orders';
$('admTabs').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return; admTab = c.dataset.t;
  $('admTabs').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c));
  ['orders', 'analytics', 'masters', 'users'].forEach(t => $('tab' + t[0].toUpperCase() + t.slice(1)).hidden = t !== admTab);
  loadAdmin();
});
['admFilter', 'admSource', 'admMasterF'].forEach(id => $(id).onchange = loadAdmin);
$('anDays').onchange = loadAdmin;
async function loadAdmin() {
  if (!user() || user().role !== 'admin') return;
  if ($('admFilter').options.length < 2) {
    $('admFilter').innerHTML = '<option value="">Усі статуси</option>' + Object.entries(S.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('admMasterF').innerHTML = '<option value="">Усі майстри</option>' + S.masters.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  }
  try {
    const an = await api('GET', '/api/admin/analytics?days=' + $('anDays').value);
    const n = s => (an.byStatus.find(x => x.status === s) || {}).n || 0;
    $('admKpis').innerHTML = [[n('new'), 'нових'], [n('confirmed') + n('on_way') + n('in_work'), 'у роботі'], [n('done'), 'виконано'], [UAH(an.revenueDone), 'виручка']].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l} за ${an.days} дн.</span></div>`).join('');
    if (admTab === 'analytics') renderAnalytics(an);
    if (admTab === 'orders') {
      const q = new URLSearchParams({ status: $('admFilter').value, source: $('admSource').value, master: $('admMasterF').value });
      const list = await api('GET', '/api/admin/orders?' + q);
      $('admOrders').innerHTML = list.length ? list.map(o => orderHTML(o, 'admin')).join('') : '<div class="empty">Заявок за цими фільтрами немає.</div>';
    }
    if (admTab === 'masters') {
      $('admMasters').innerHTML = S.masters.map(m => { const a = an.byMaster.find(x => x.id === m.id) || {};
        return `<div class="mtoggle"><span><b>${esc(m.name)}</b><br><span class="note">★ ${dec(m.rating)} · заявок за період: ${a.n || 0} · виручка: ${UAH(a.revenue || 0)} · ${m.freeToday ? 'є час сьогодні' : 'зайнятий сьогодні'}</span></span>
          <span class="switch"><input type="checkbox" data-mactive="${m.id}" ${m.active ? 'checked' : ''} aria-label="${esc(m.name)} приймає заявки"><i></i></span></div>`; }).join('')
        + '<p class="note">Вимкнений майстер не отримує нових заявок і зникає з сайту та застосунку.</p>';
    }
    if (admTab === 'users') {
      const us = await api('GET', '/api/admin/users');
      const R = { client: 'клієнт', master: 'майстер', admin: 'адміністратор' };
      $('admUsers').innerHTML = `<thead><tr><th>№</th><th>Ім'я</th><th>E-mail</th><th>Телефон</th><th>Роль</th><th>Заявок</th><th>Реєстрація</th></tr></thead><tbody>${us.map(x => `<tr><td>${x.id}</td><td style="font-family:var(--body)">${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.phone)}</td><td style="font-family:var(--body)">${R[x.role]}</td><td>${x.orders}</td><td>${fmtDate(x.created_at)}</td></tr>`).join('')}</tbody>`;
    }
    $('admSync').textContent = 'Оновлено ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); $('admSync').classList.add('live');
  } catch (e) { $('admSync').textContent = e.message; }
}
function bars(rows, fmt = v => v) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="bars">${rows.map(([l, v]) => `<div class="bar"><span title="${esc(l)}">${esc(l)}</span><i><b style="width:${v / max * 100}%"></b></i><span>${fmt(v)}</span></div>`).join('')}</div>`;
}
function renderAnalytics(an) {
  const panel = (t, html) => `<div class="panel"><h3>${t}</h3>${html}</div>`;
  $('anBox').innerHTML = [
    panel('Заявки за статусом', bars(Object.keys(S.statuses).map(s => [S.statuses[s], (an.byStatus.find(x => x.status === s) || {}).n || 0]))),
    panel('Джерело заявок', bars([['Сайт', (an.bySource.find(x => x.source === 'web') || {}).n || 0], ['Мобільний застосунок', (an.bySource.find(x => x.source === 'mobile') || {}).n || 0]])),
    panel('Тип виїзду', bars(Object.keys(KIND).map(k => [KIND[k], (an.byKind.find(x => x.kind === k) || {}).n || 0]))),
    panel('Виручка майстрів (виконані)', bars(an.byMaster.map(m => [m.name, m.revenue || 0]), UAH)),
    panel('Популярні моделі', an.topProducts.length ? bars(an.topProducts.map(p => [p.title, p.qty]), v => v + ' шт.') : '<p class="note">Продажів за період немає.</p>'),
    panel('Показники', `<div class="bars"><div class="bar"><span>Середній чек</span><i></i><span>${UAH(an.avgCheck)}</span></div><div class="bar"><span>Скасовано</span><i><b style="width:${an.cancelRate}%;background:var(--heat)"></b></i><span>${an.cancelRate}%</span></div></div>`),
  ].join('');
}
document.addEventListener('change', async e => {
  const a = e.target.closest('[data-assign]');
  if (a) { try { await api('PATCH', `/api/admin/orders/${a.dataset.assign}/assign`, { masterId: a.value }); toast('Майстра змінено'); } catch (err) { toast(err.message); } loadAdmin(); }
  const m = e.target.closest('[data-mactive]');
  if (m) { try { await api('PATCH', `/api/admin/masters/${m.dataset.mactive}`, { active: m.checked }); await loadCatalog(); toast('Збережено'); } catch (err) { toast(err.message); } loadAdmin(); }
});

/* ---------- remote ---------- */
(() => {
  let t = 22, on = true, mi = 0; const modes = ['❄ ОХОЛОДЖ.', '☀ ОБІГРІВ', '💧 ОСУШ.', '⟳ АВТО'];
  const bar = $('rBar'); for (let i = 0; i < 14; i++) bar.appendChild(document.createElement('i'));
  function draw() { $('rTemp').textContent = on ? t : '--'; $('rMode').textContent = on ? modes[mi] : 'ВИМК.'; [...bar.children].forEach((b, i) => b.classList.toggle('on', on && i < (t - 16))); }
  $('kUp').onclick = () => { if (on && t < 30) { t++; draw(); } }; $('kDown').onclick = () => { if (on && t > 16) { t--; draw(); } };
  $('kMode').onclick = () => { if (on) { mi = (mi + 1) % modes.length; draw(); } }; $('kPow').onclick = () => { on = !on; draw(); };
  draw();
})();

/* ---------- data ---------- */
async function loadCatalog() {
  const c = await api('GET', '/api/catalog');
  Object.assign(S, { products: c.products, services: c.services, masters: c.masters, statuses: c.statuses, installBase: c.installBase });
  cart.products = cart.products.filter(p => P(p.id)); compare = compare.filter(id => P(id));
  const cur = $('fBrand').value;
  $('fBrand').innerHTML = '<option value="">Усі бренди</option>' + [...new Set(S.products.map(p => p.brand))].sort().map(b => `<option>${esc(b)}</option>`).join(''); $('fBrand').value = cur;
  const om = $('oMaster').value;
  $('oMaster').innerHTML = '<option value="">Підбере система за розкладом</option>' + S.masters.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join(''); $('oMaster').value = om;
}
async function loadReviews() {
  S.reviews = await api('GET', '/api/reviews');
  if (S.reviews.length) $('heroRating').textContent = dec((S.reviews.reduce((s, r) => s + r.stars, 0) / S.reviews.length).toFixed(1));
}
window.SK.onEvent(async type => {
  if (type === 'reviews') await loadReviews();
  if (type === 'catalog') await loadCatalog();
  if (['cabinet', 'admin', 'reviews', 'home', 'master', 'masters'].includes(route.view) || type === 'catalog') renderView();
});

saveCart(); renderAccount(); updateCmpLink(); go();
(async () => {
  try { await Promise.all([loadCatalog(), loadReviews()]); S.loaded = true; calc(); renderView(); }
  catch (e) { toast('Сервер недоступний: ' + e.message); }
  window.SK.start();
})();
})();
