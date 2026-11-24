/* Smart Klima: веб-сайт. Дані: window.SKApi (shared/api.js), спільні з мобільним застосунком. */
(function () {
'use strict';
const Api = window.SKApi;
const { UAH, dec, pad2, esc, fmtDate, fmtDT, ls } = Api.util;
const $ = id => document.getElementById(id);
const SEED = Api.SEED;
const STATUS = SEED.statuses;
const INSTALL_BASE = SEED.installBase;

/* ---------- state ---------- */
const S = {
  products: SEED.products, services: SEED.services, masters: SEED.masters.map(({ pin, ...m }) => m),
  reviews: [], myOrders: [], adminOrders: [], admin: false,
};
let cart = ls.get('sk_cart', []);
let compare = ls.get('sk_cmp', []).filter(id => S.products.some(p => p.id === id));
const P = id => S.products.find(p => p.id === id);
const M = id => S.masters.find(m => m.id === id);

const toastEl = $('toast'); let tT;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(tT); tT = setTimeout(() => toastEl.hidden = true, 2600); }
async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); toast('Скопійовано'); }
  catch (e) { if (fallbackEl) { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast('Текст виділено, скопіюйте вручну'); }
}

/* ---------- router ---------- */
let route = { view: 'home', arg: null };
const TITLES = { home: 'Smart Klima', catalog: 'Каталог', compare: 'Порівняння', calc: 'Калькулятор', services: 'Послуги', masters: 'Майстри', reviews: 'Відгуки', faq: 'Питання', contacts: 'Контакти', order: 'Заявка', admin: 'Адмінка' };
function parseHash() {
  const h = (location.hash || '').replace(/^#/, ''); let m;
  if ((m = h.match(/^model-(\d+)$/)) && P(+m[1])) return { view: 'model', arg: +m[1] };
  if ((m = h.match(/^master-(m\d+)$/)) && M(m[1])) return { view: 'master', arg: m[1] };
  return { view: TITLES[h] ? h : 'home', arg: null };
}
function go() {
  const prev = route.view + route.arg;
  route = parseHash();
  document.querySelectorAll('.view').forEach(v => v.hidden = v.dataset.view !== route.view);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav.split(' ').includes(route.view)));
  $('navLinks').classList.remove('open'); $('burger').setAttribute('aria-expanded', false);
  if (TITLES[route.view]) document.title = route.view === 'home' ? 'Smart Klima' : TITLES[route.view] + ' · Smart Klima';
  renderView();
  if (prev !== route.view + route.arg) window.scrollTo(0, 0);
}
function renderView() {
  switch (route.view) {
    case 'home': renderHome(); break;
    case 'catalog': renderGrid(); break;
    case 'model': renderProduct(route.arg); break;
    case 'compare': renderCompare(); break;
    case 'services': renderServices(); break;
    case 'masters': renderMasters(); break;
    case 'master': renderMasterPage(route.arg); break;
    case 'reviews': renderReviews(); break;
    case 'order': renderOrder(); break;
    case 'admin': renderAdminShell(); break;
  }
}
window.addEventListener('hashchange', go);
$('burger').onclick = () => { const o = $('navLinks').classList.toggle('open'); $('burger').setAttribute('aria-expanded', o); };

/* ---------- cart & compare ---------- */
const inCart = key => cart.some(c => c.key === key);
function saveCart() { ls.set('sk_cart', cart); $('cartCount').textContent = cart.length; renderView(); }
function toggleItem(item) {
  const i = cart.findIndex(c => c.key === item.key);
  if (i >= 0) { cart.splice(i, 1); toast('Прибрано із заявки'); } else { cart.push(item); toast('Додано до заявки'); }
  saveCart();
}
const productItem = p => ({ key: 'p' + p.id, title: `${p.brand} ${p.model}`, price: p.price });
function toggleCompare(id) {
  const i = compare.indexOf(id);
  if (i >= 0) { compare.splice(i, 1); toast('Прибрано з порівняння'); }
  else { if (compare.length >= 4) { toast('Можна порівняти до 4 моделей'); return; } compare.push(id); toast('Додано до порівняння'); }
  ls.set('sk_cmp', compare); updateCmpLink(); renderView();
}
function updateCmpLink() { $('cmpCount').textContent = compare.length; $('cmpLink').hidden = !compare.length; }

/* ---------- product card ---------- */
function cardHTML(p) {
  const inC = inCart('p' + p.id), inCmp = compare.includes(p.id);
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
      <button type="button" class="add ${inC ? 'in' : ''}" data-id="${p.id}">${inC ? '✓ У заявці' : 'До заявки'}</button></div></div>
  </article>`;
}
let pendingMaster = '';
document.addEventListener('click', e => {
  const a = e.target.closest('.add[data-id]'); if (a) { toggleItem(productItem(P(+a.dataset.id))); return; }
  const c = e.target.closest('[data-cmp]'); if (c) { toggleCompare(+c.dataset.cmp); return; }
  const s = e.target.closest('[data-s-add]'); if (s) { const sv = S.services.find(x => x.id === s.dataset.sAdd); toggleItem({ key: sv.id, title: sv.title, price: sv.price }); return; }
  const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy, cp.previousElementSibling); return; }
  const b = e.target.closest('[data-book]'); if (b) { pendingMaster = b.dataset.book; location.hash = 'order'; return; }
  const ar = e.target.closest('[data-area]'); if (ar) $('fArea').value = ar.dataset.area;
  const cb = e.target.closest('[data-calc-area]'); if (cb) { $('cArea').value = cb.dataset.calcArea; calc(); location.hash = 'calc'; }
});

/* ---------- home ---------- */
function renderHome() {
  $('homeHits').innerHTML = S.products.filter(p => p.hit).map(cardHTML).join('');
  $('homeSvc').innerHTML = S.services.slice(0, 3).map(svcHTML).join('');
  $('homeMasters').innerHTML = S.masters.map(m => `<a href="#master-${m.id}"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div><div><b>${esc(m.name)}</b><small><span class="status ${m.free ? 'free' : 'busy'}">${m.free ? 'Вільний сьогодні' : 'Зайнятий'}</span></small></div></a>`).join('');
  $('homeReviews').innerHTML = S.reviews.slice(0, 3).map(reviewHTML).join('');
}

/* ---------- catalog ---------- */
let filter = 'all';
function fillBrands() {
  const cur = $('fBrand').value;
  $('fBrand').innerHTML = '<option value="">Усі бренди</option>' + [...new Set(S.products.map(p => p.brand))].sort().map(b => `<option>${esc(b)}</option>`).join('');
  $('fBrand').value = cur;
}
function renderGrid() {
  const maxA = +$('fArea').value, sort = $('fSort').value, brand = $('fBrand').value, q = $('fSearch').value.trim().toLowerCase();
  const list = S.products.filter(p =>
    (filter === 'all' || (filter === 'inv' && p.inv) || (filter === 'heat' && p.heat <= -25) || (filter === 'wifi' && p.wifi) || (filter === 'sale' && p.old)) &&
    (!maxA || p.area === maxA) && (!brand || p.brand === brand) && (!q || (p.brand + ' ' + p.model).toLowerCase().includes(q)));
  list.sort((a, b) => sort === 'price' ? a.price - b.price : sort === '-price' ? b.price - a.price : a.noise - b.noise);
  $('foundCount').textContent = `Знайдено моделей: ${list.length}`;
  $('grid').innerHTML = list.length ? list.map(cardHTML).join('') : '<div class="empty">Нічого не знайшлось. Спробуйте інший фільтр.</div>';
  updateCmpLink();
}
$('filters').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  filter = c.dataset.f; $('filters').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c)); renderGrid();
});
['fArea', 'fSort', 'fBrand'].forEach(id => $(id).onchange = renderGrid);
$('fSearch').oninput = renderGrid;

/* ---------- product page ---------- */
function renderProduct(id) {
  const p = P(id); if (!p) return;
  document.title = `${p.brand} ${p.model} · Smart Klima`;
  $('pCrumb').textContent = `${p.brand} ${p.model}`;
  const inC = inCart('p' + p.id), inCmp = compare.includes(p.id), install = INSTALL_BASE[p.btu];
  $('prodBox').innerHTML = `
    <div>
      <div class="unit ${p.dark ? 'dark' : ''}" style="--c:${esc(p.color)}"><div class="body"></div></div>
      <div class="tags" style="margin-top:14px">
        ${p.old ? '<span class="tag heat">−' + Math.round((1 - p.price / p.old) * 100) + '%</span>' : ''}
        ${p.inv ? '<span class="tag inv">Інвертор</span>' : '<span class="tag">On/Off</span>'}
        ${p.wifi ? '<span class="tag">Wi‑Fi</span>' : ''}<span class="tag">${esc(p.cls)}</span><span class="tag">R32</span>
      </div>
      <h3 style="margin:24px 0 8px">Характеристики</h3>
      <table class="spec-table">
        <tr><th>Рекомендована площа</th><td>до ${p.area} м²</td></tr>
        <tr><th>Холодопродуктивність</th><td>${dec(p.kw)} кВт (${pad2(p.btu)} тис. BTU)</td></tr>
        <tr><th>Тип компресора</th><td>${p.inv ? 'Інверторний' : 'On/Off'}</td></tr>
        <tr><th>Обігрів працює до</th><td>${p.heat}°C</td></tr>
        <tr><th>Рівень шуму (мін.)</th><td>${p.noise} дБ</td></tr>
        <tr><th>Енергоклас</th><td>${esc(p.cls)}</td></tr>
        <tr><th>Wi‑Fi керування</th><td>${p.wifi ? 'Так' : 'Немає'}</td></tr>
        <tr><th>Фреон</th><td>R32</td></tr>
        <tr><th>Гарантія виробника</th><td>${p.warranty} ${p.warranty < 5 ? 'роки' : 'років'}</td></tr>
      </table>
    </div>
    <div>
      <div class="brand">${esc(p.brand)}</div>
      <h1>${esc(p.model)}</h1>
      <p class="lead">${esc(p.descr)}</p>
      <ul class="perks"><li>Монтаж за 1 день, огляд безкоштовний</li><li>3 роки гарантії на монтаж від Smart Klima</li><li>Оплата після монтажу або частинами</li></ul>
      <div class="buy">
        <div class="pr"><b>${UAH(p.price)}</b>${p.old ? `<s>${UAH(p.old)}</s>` : ''}</div>
        <div class="note">Стандартний монтаж для класу ${pad2(p.btu)}: від <b class="num">${UAH(install)}</b>. Разом з монтажем від <b class="num">${UAH(p.price + install)}</b>.</div>
        <div class="acts">
          <button type="button" class="btn primary add ${inC ? 'in' : ''}" data-id="${p.id}">${inC ? '✓ У заявці' : 'Додати до заявки'}</button>
          <button type="button" class="btn ghost" data-calc-area="${p.area}">Порахувати монтаж</button>
          <button type="button" class="btn ghost" data-cmp="${p.id}">${inCmp ? '✓ У порівнянні' : '⇄ Порівняти'}</button>
        </div>
      </div>
    </div>`;
  const sim = S.products.filter(x => x.btu === p.btu && x.id !== p.id);
  const fill = sim.length < 3 ? S.products.filter(x => x.id !== p.id && !sim.includes(x)).sort((a, b) => Math.abs(a.kw - p.kw) - Math.abs(b.kw - p.kw)).slice(0, 3 - sim.length) : [];
  $('prodSimilar').innerHTML = [...sim, ...fill].slice(0, 4).map(cardHTML).join('');
}

/* ---------- compare ---------- */
function renderCompare() {
  const list = compare.map(P).filter(Boolean);
  if (!list.length) { $('cmpBox').innerHTML = '<div class="empty">Ви ще нічого не додали. Натисніть «⇄» на картці моделі в <a href="#catalog">каталозі</a>.</div>'; return; }
  const rows = [
    ['Ціна', p => p.price, v => UAH(v), 'min'], ['Площа', p => p.area, v => `до ${v} м²`, null], ['Потужність', p => p.kw, v => `${dec(v)} кВт`, null],
    ['Шум', p => p.noise, v => `${v} дБ`, 'min'], ['Обігрів до', p => p.heat, v => `${v}°C`, 'min'], ['Компресор', p => p.inv ? 1 : 0, v => v ? 'Інвертор' : 'On/Off', 'max'],
    ['Wi‑Fi', p => p.wifi ? 1 : 0, v => v ? 'Так' : 'Немає', 'max'], ['Енергоклас', p => p.cls.length, (v, p) => esc(p.cls), 'max'],
    ['Гарантія', p => p.warranty, v => `${v} р.`, 'max'], ['Монтаж від', p => INSTALL_BASE[p.btu], v => UAH(v), null],
  ];
  $('cmpBox').innerHTML = `<div class="tablewrap"><table class="ctable">
    <thead><tr><th></th>${list.map(p => `<th><div class="brand">${esc(p.brand)}</div><a href="#model-${p.id}">${esc(p.model)}</a><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="add ${inCart('p' + p.id) ? 'in' : ''}" data-id="${p.id}">${inCart('p' + p.id) ? '✓' : 'До заявки'}</button><button type="button" class="cmp" data-cmp="${p.id}" aria-label="Прибрати">✕</button></div></th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, get, fmt, best]) => {
      const vals = list.map(get); const target = best === 'min' ? Math.min(...vals) : best === 'max' ? Math.max(...vals) : null;
      const differ = new Set(vals).size > 1;
      return `<tr><th>${label}</th>${list.map((p, i) => `<td class="${best && differ && vals[i] === target ? 'best' : ''}">${fmt(vals[i], p)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ---------- calculator ---------- */
let q = 35, lastCalc = null;
$('cSun').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; q = +b.dataset.q; [...$('cSun').children].forEach(x => x.setAttribute('aria-pressed', x === b)); calc(); });
['cArea', 'cH', 'cPeople', 'cTech', 'cRoute', 'cFloor', 'xWall', 'xBox', 'xHidden', 'xPump', 'xOld', 'xFence'].forEach(id => $(id).addEventListener('input', calc));
$('xBox').addEventListener('change', () => { if ($('xBox').checked) { $('xHidden').checked = false; calc(); } });
$('xHidden').addEventListener('change', () => { if ($('xHidden').checked) { $('xBox').checked = false; calc(); } });
function calc() {
  const Sq = +$('cArea').value, h = +$('cH').value, ppl = +$('cPeople').value, tech = +$('cTech').value, rt = +$('cRoute').value;
  $('oArea').textContent = Sq + ' м²'; $('oH').textContent = dec(h.toFixed(1)) + ' м';
  $('oPeople').textContent = ppl; $('oTech').textContent = dec(tech.toFixed(1)) + ' кВт'; $('oRoute').textContent = rt + ' м';
  const kw = Api.util.coolingKw(Sq, h, q, ppl, tech);
  const fit = Api.util.pickClass(kw); const btu = fit || 24;
  $('rKw').textContent = dec(kw.toFixed(1)); $('rBtu').textContent = fit ? pad2(btu) : '24+';
  const lines = [[`Базовий монтаж, клас ${pad2(btu)} (до 3 м траси)`, INSTALL_BASE[btu]]];
  const extra = Math.max(0, rt - 3), perM = btu >= 18 ? 650 : 520;
  if (extra) lines.push([`Додаткова траса ${extra} м × ${perM} ₴`, extra * perM]);
  const floor = +$('cFloor').value; if (floor) lines.push(['Висотні роботи', floor]);
  if ($('xWall').checked) lines.push(['Свердління стіни', 500]);
  if ($('xBox').checked) lines.push([`Декор-короб ${rt} м × 180 ₴`, rt * 180]);
  if ($('xHidden').checked) lines.push([`Штроба ${rt} м × 450 ₴`, rt * 450]);
  if ($('xPump').checked) lines.push(['Дренажна помпа', 1900]);
  if ($('xOld').checked) lines.push(['Демонтаж старого', 1200]);
  if ($('xFence').checked) lines.push(['Захисний кошик', 950]);
  const total = lines.reduce((s, l) => s + l[1], 0);
  $('rLines').innerHTML = lines.map(l => `<li><span>${l[0]}</span><span>${UAH(l[1])}</span></li>`).join('') + `<li class="total"><span>Монтаж разом</span><span>${UAH(total)}</span></li>`;
  const recs = S.products.filter(p => p.btu === btu).sort((a, b) => a.price - b.price).slice(0, 3);
  $('rRec').innerHTML = fit && recs.length ? recs.map(p => `<a href="#model-${p.id}" style="display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink)"><span>${esc(p.brand + ' ' + p.model)}<br><small class="note">${p.inv ? 'інвертор' : 'on/off'} · ${p.noise} дБ</small></span><b class="num">${UAH(p.price)}</b></a>`).join('')
    : '<div class="note">Потрібно понад 7 кВт. Для такого приміщення радимо два блоки або мульти-спліт, майстер підбере на огляді.</div>';
  lastCalc = { btu, total, S: Sq };
}
$('calcOrder').onclick = () => {
  cart = cart.filter(c => c.key !== 'install');
  cart.push({ key: 'install', title: `Монтаж, клас ${pad2(lastCalc.btu)}, кімната ${lastCalc.S} м²`, price: lastCalc.total });
  saveCart(); toast('Монтаж додано до заявки');
};

/* ---------- services ---------- */
function svcHTML(s) {
  return `<article><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><div class="row"><b>${s.price ? 'від ' + UAH(s.price) : 'за домовленістю'}</b>
    <button type="button" class="add ${inCart(s.id) ? 'in' : ''}" data-s-add="${esc(s.id)}">${inCart(s.id) ? '✓ У заявці' : 'До заявки'}</button></div></article>`;
}
function renderServices() { $('svcList').innerHTML = S.services.map(svcHTML).join(''); }

/* ---------- masters ---------- */
function masterCardHTML(m, full) {
  const cnt = S.reviews.filter(r => r.master === m.id).length;
  return `<article class="m-card">
    <div class="m-top"><div class="ava" style="background:${esc(m.color)}">${esc(m.short)}</div>
      <div><h3>${full ? esc(m.name) : `<a href="#master-${m.id}" style="color:inherit;text-decoration:none">${esc(m.name)}</a>`}</h3><small>Досвід ${m.exp} років · <span class="num">${m.jobs}</span> монтажів</small></div></div>
    <div style="display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap">
      <span class="stars">${'★'.repeat(Math.round(m.rating))}</span><span class="num">${dec((+m.rating).toFixed(1))}</span>
      <span class="status ${m.free ? 'free' : 'busy'}">${m.free ? 'Вільний сьогодні' : 'Зайнятий сьогодні'}</span>
    </div>
    ${full ? `<p style="margin:0;color:var(--muted);font-size:.92rem">${esc(m.bio)}</p><div class="note">Район: <b>${esc(m.area)}</b></div>` : ''}
    <ul>${m.skills.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <div class="m-actions">
      <div class="phone"><span>${esc(m.phone)}</span><button class="copy" type="button" data-copy="${esc(m.phone)}">Копіювати</button></div>
      <button class="btn primary sm" type="button" data-book="${m.id}">Викликати майстра</button>
      ${full ? '' : `<a class="btn ghost sm" href="#master-${m.id}">Профіль і відгуки (${cnt})</a>`}
    </div>
  </article>`;
}
function renderMasters() { $('mastersList').innerHTML = S.masters.map(m => masterCardHTML(m, false)).join(''); }
function renderMasterPage(id) {
  const m = M(id); if (!m) return;
  document.title = m.name + ' · Smart Klima';
  $('mCrumb').textContent = m.name;
  $('mProfCard').innerHTML = masterCardHTML(m, true);
  const revs = S.reviews.filter(r => r.master === id);
  $('mRevTitle').textContent = revs.length ? `${revs.length} ${revs.length === 1 ? 'відгук' : revs.length < 5 ? 'відгуки' : 'відгуків'}` : 'Поки без відгуків';
  $('mRevList').innerHTML = revs.length ? revs.map(reviewHTML).join('') : '<div class="empty">Про цього майстра ще не писали. <a href="#reviews">Залиште перший відгук</a>.</div>';
}
function fillMasterSelects() {
  const cur = pendingMaster || $('oMaster').value;
  $('oMaster').innerHTML = '<option value="">Будь-хто вільний</option>' + S.masters.map(m => `<option value="${m.id}">${esc(m.name)}${m.free ? '' : ' (зайнятий сьогодні)'}</option>`).join('');
  $('oMaster').value = cur;
  const rc = $('rvMaster').value;
  $('rvMaster').innerHTML = S.masters.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if (rc) $('rvMaster').value = rc;
}

/* ---------- reviews ---------- */
let pick = 5, revMaster = '';
function drawPick() { $('starPick').innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" data-st="${i}" class="${i <= pick ? 'on' : ''}" aria-label="${i} з 5">★</button>`).join(''); }
$('starPick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pick = +b.dataset.st; drawPick(); } });
function reviewHTML(r) {
  const m = M(r.master); const st = Math.max(1, Math.min(5, Math.round(+r.stars)));
  return `<article class="rev"><header><b>${esc(r.name)}</b><span class="stars">${'★'.repeat(st)}${'☆'.repeat(5 - st)}</span></header>
    <p>${esc(r.text)}</p><div class="who"><span>Майстер: ${m ? `<a href="#master-${m.id}">${esc(m.name)}</a>` : '—'} · ${fmtDate(r.date)}</span>
    ${r.source === 'mobile' ? '<span class="pill">із застосунку</span>' : ''}
    ${S.admin ? `<button class="linkbtn" type="button" data-delrev="${r.id}">Видалити</button>` : ''}</div></article>`;
}
function updateRating() {
  const list = S.reviews; if (!list.length) return null;
  const avg = list.reduce((s, r) => s + (+r.stars), 0) / list.length;
  $('heroRating').textContent = dec(avg.toFixed(1));
  return avg;
}
function renderReviews() {
  const list = S.reviews; const avg = updateRating();
  $('avg').textContent = avg ? dec(avg.toFixed(1)) : '–';
  $('avgStars').textContent = avg ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) : '';
  $('revCount').textContent = `на основі ${list.length} відгуків`;
  $('dist').innerHTML = [5, 4, 3, 2, 1].map(s => { const n = list.filter(r => +r.stars === s).length;
    return `<div><span>${s}</span><i><b style="width:${list.length ? n / list.length * 100 : 0}%"></b></i><span class="num">${n}</span></div>`; }).join('');
  $('revFilter').innerHTML = `<button class="chip" type="button" data-rm="" aria-pressed="${!revMaster}">Усі</button>` + S.masters.map(m => `<button class="chip" type="button" data-rm="${m.id}" aria-pressed="${revMaster === m.id}">${esc(m.name.split(' ')[0])}</button>`).join('');
  const shown = list.filter(r => !revMaster || r.master === revMaster);
  $('revList').innerHTML = shown.length ? shown.map(reviewHTML).join('') : '<div class="empty">Відгуків ще немає.</div>';
}
$('revFilter').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { revMaster = b.dataset.rm; renderReviews(); } });
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-delrev]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Точно видалити?'; return; }
  try { await Api.admin.deleteReview(+b.dataset.delrev); toast('Відгук видалено'); await loadReviews(); } catch (err) { toast(err.message); }
});
$('revForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('rvSubmit').disabled = true;
  try {
    await Api.addReview({ name: $('rvName').value, master: $('rvMaster').value, stars: pick, text: $('rvText').value, source: 'web' });
    toast('Відгук опубліковано'); e.target.reset(); pick = 5; drawPick(); await loadReviews();
  } catch (err) { toast(err.message); }
  finally { $('rvSubmit').disabled = false; }
});

/* ---------- order page ---------- */
const orderTotal = () => cart.reduce((s, c) => s + (c.price || 0), 0);
function renderOrder() {
  $('dItems').innerHTML = cart.length ? cart.map((c, i) => `<div class="ci"><span>${esc(c.title)}<br><b class="num">${c.price ? UAH(c.price) : 'ціна за домовленістю'}</b></span><button type="button" data-i="${i}">Прибрати</button></div>`).join('')
    : '<p class="note" style="font-size:.92rem">Заявка порожня. Можна просто викликати майстра на безкоштовний огляд, або додайте кондиціонер з <a href="#catalog">каталогу</a> чи монтаж з <a href="#calc">калькулятора</a>.</p>';
  $('dTotal').textContent = UAH(orderTotal()); $('dTotalRow').hidden = !cart.length;
  $('oSubmit').textContent = cart.length ? 'Надіслати заявку' : 'Викликати на безкоштовний огляд';
  if (pendingMaster) { $('oMaster').value = pendingMaster; pendingMaster = ''; }
  loadMyOrders();
}
$('dItems').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { cart.splice(+b.dataset.i, 1); saveCart(); } });
async function loadMyOrders() {
  try { S.myOrders = await Api.myOrders(); } catch (e) { return; }
  const box = $('myOrders');
  if (!S.myOrders.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<b>Мої заявки</b>' + S.myOrders.map(o => `<div><span>№${o.id} · ${fmtDT(o.created)} · <span class="num">${o.total ? UAH(o.total) : 'огляд'}</span>${o.master && M(o.master) ? ' · ' + esc(M(o.master).name) : ''}</span><span class="st ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></div>`).join('');
}
$('orderForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('oErr').hidden = true; $('oSubmit').disabled = true;
  try {
    const o = await Api.createOrder({ name: $('oName').value, phone: $('oPhone').value, addr: $('oAddr').value, when: $('oDate').value,
      master: $('oMaster').value, comment: $('oComment').value, items: cart.map(c => ({ title: c.title, price: c.price || 0 })), source: 'web' });
    $('orderForm').hidden = true; $('dOk').hidden = false;
    $('dOk').innerHTML = `<div class="ok">Дякуємо, ${esc(o.name)}! Заявку №${o.id} прийнято. Передзвонимо на ${esc(o.phone)} протягом 15 хвилин у робочий час. Статус можна стежити тут або в мобільному застосунку.</div><button class="btn ghost" type="button" id="oAgain">Нова заявка</button>`;
    $('oAgain').onclick = () => { $('dOk').hidden = true; $('orderForm').hidden = false; };
    cart = []; e.target.reset(); saveCart();
  } catch (err) { $('oErr').textContent = err.message; $('oErr').hidden = false; }
  finally { $('oSubmit').disabled = false; }
});

/* ---------- admin ---------- */
function renderAdminShell() {
  const logged = S.admin;
  $('admLogin').hidden = logged; $('admPanel').hidden = !logged;
  $('admDemoHint').hidden = Api.mode !== 'demo';
  if (logged) { loadAdmin(); renderAdminMasters(); }
}
$('admLogin').addEventListener('submit', async e => {
  e.preventDefault(); $('admErr').hidden = true;
  try { await Api.admin.login($('admKey').value); S.admin = true; $('admKey').value = ''; renderAdminShell(); }
  catch (err) { $('admErr').textContent = err.message; $('admErr').hidden = false; }
});
$('admLogout').onclick = () => { Api.admin.logout(); S.admin = false; renderAdminShell(); };
$('admTabs').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $('admTabs').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c));
  $('tabOrders').hidden = c.dataset.t !== 'orders'; $('tabMasters').hidden = c.dataset.t !== 'masters';
});
$('admFilter').onchange = renderAdmin; $('admSource').onchange = renderAdmin;
async function loadAdmin() {
  try { S.adminOrders = await Api.admin.orders(); $('admSync').textContent = 'Оновлено ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }); $('admSync').classList.add('live'); }
  catch (err) { if (err.status === 401) { Api.admin.logout(); S.admin = false; renderAdminShell(); } $('admSync').textContent = err.message; return; }
  renderAdmin();
}
function renderAdmin() {
  const all = S.adminOrders; const cnt = s => all.filter(o => o.status === s).length;
  $('kNew').textContent = cnt('new'); $('kConf').textContent = cnt('confirmed') + cnt('onway'); $('kDone').textContent = cnt('done');
  $('kSum').textContent = UAH(all.filter(o => o.status === 'done').reduce((s, o) => s + (+o.total || 0), 0));
  const f = $('admFilter').value, src = $('admSource').value;
  const list = all.filter(o => (!f || o.status === f) && (!src || o.source === src));
  const masterOpts = sel => '<option value="">не призначено</option>' + S.masters.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  $('admOrders').innerHTML = list.length ? list.map(o => `<article class="order" data-s="${esc(o.status)}">
      <div class="top"><b>№${o.id} · ${esc(o.name)} · <span class="num">${esc(o.phone)}</span></b>
        <span style="display:flex;gap:6px;align-items:center"><span class="pill">${o.source === 'mobile' ? 'Застосунок' : 'Сайт'}</span><span class="st ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></span></div>
      <div class="meta"><span>Створено: <b>${fmtDT(o.created)}</b></span>${o.when ? `<span>Коли: <b>${esc(o.when)}</b></span>` : ''}${o.addr ? `<span>Адреса: <b>${esc(o.addr)}</b></span>` : ''}</div>
      <ul>${(o.items || []).length ? o.items.map(i => `<li>${esc(i.title)}${i.price ? ' — ' + UAH(+i.price) : ''}</li>`).join('') : '<li>Безкоштовний огляд</li>'}</ul>
      ${o.comment ? `<div class="note">Клієнт: «${esc(o.comment)}»</div>` : ''}
      ${o.note ? `<div class="note">Майстер: «${esc(o.note)}»</div>` : ''}
      <div class="ctrl"><b class="num" style="margin-right:auto">${o.total ? UAH(+o.total) : '—'}</b>
        <select data-omaster="${o.id}" aria-label="Майстер">${masterOpts(o.master)}</select>
        <select data-ost="${o.id}" aria-label="Статус">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="copy" type="button" data-copy="${esc(o.phone)}">Копіювати номер</button>
        <button class="linkbtn" type="button" data-odel="${o.id}">Видалити</button></div>
    </article>`).join('') : '<div class="empty">Заявок поки немає. Нові з\'являться тут одразу після відправки з сайту чи застосунку.</div>';
}
$('admOrders').addEventListener('change', async e => {
  const s = e.target.closest('[data-ost]'), m = e.target.closest('[data-omaster]');
  try {
    if (s) await Api.admin.updateOrder(+s.dataset.ost, { status: s.value });
    if (m) await Api.admin.updateOrder(+m.dataset.omaster, { master: m.value });
    toast('Збережено'); loadAdmin();
  } catch (err) { toast(err.message); }
});
$('admOrders').addEventListener('click', async e => {
  const b = e.target.closest('[data-odel]'); if (!b) return;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Точно видалити?'; return; }
  try { await Api.admin.deleteOrder(+b.dataset.odel); toast('Видалено'); loadAdmin(); } catch (err) { toast(err.message); }
});
function renderAdminMasters() {
  $('admMasters').innerHTML = S.masters.map(m => `<label class="mtoggle"><span><b>${esc(m.name)}</b><br><span class="note">${m.free ? 'Вільний сьогодні' : 'Зайнятий сьогодні'}</span></span>
    <span class="switch"><input type="checkbox" data-mf="${m.id}" ${m.free ? 'checked' : ''} aria-label="${esc(m.name)} вільний"><i></i></span></label>`).join('');
}
$('admMasters').addEventListener('change', async e => {
  const c = e.target.closest('[data-mf]'); if (!c) return;
  try { await Api.admin.setMasterFree(c.dataset.mf, c.checked); await loadCatalog(); renderAdminMasters(); toast('Збережено'); } catch (err) { toast(err.message); }
});

/* ---------- remote ---------- */
(() => {
  let t = 22, on = true, mi = 0;
  const modes = ['❄ ОХОЛОДЖ.', '☀ ОБІГРІВ', '💧 ОСУШ.', '⟳ АВТО'];
  const bar = $('rBar'); for (let i = 0; i < 14; i++) bar.appendChild(document.createElement('i'));
  function draw() { $('rTemp').textContent = on ? t : '--'; $('rMode').textContent = on ? modes[mi] : 'ВИМК.'; [...bar.children].forEach((b, i) => b.classList.toggle('on', on && i < (t - 16))); }
  $('kUp').onclick = () => { if (on && t < 30) { t++; draw(); } };
  $('kDown').onclick = () => { if (on && t > 16) { t--; draw(); } };
  $('kMode').onclick = () => { if (on) { mi = (mi + 1) % modes.length; draw(); } };
  $('kPow').onclick = () => { on = !on; draw(); };
  draw();
})();

/* ---------- data loading ---------- */
async function loadCatalog() {
  const c = await Api.catalog();
  S.products = c.products; S.services = c.services; S.masters = c.masters;
  compare = compare.filter(id => P(id));
  fillBrands(); fillMasterSelects();
}
async function loadReviews() { S.reviews = await Api.reviews(); updateRating(); if (['home', 'reviews', 'master', 'masters'].includes(route.view)) renderView(); }

$('cartCount').textContent = cart.length;
fillBrands(); fillMasterSelects(); drawPick(); calc(); updateCmpLink();
go();
(async () => {
  const mode = await Api.ready;
  $('modeNote').textContent = mode === 'server' ? 'Дані з сервера.' : 'Демо-режим: дані зберігаються в цьому браузері, спільно з застосунком.';
  S.admin = !!Api.admin.key;
  try { await loadCatalog(); await loadReviews(); renderView(); } catch (e) { toast(e.message); }
  Api.subscribe(async () => {
    try { await loadCatalog(); await loadReviews(); if (route.view === 'admin' && S.admin) { loadAdmin(); renderAdminMasters(); } if (route.view === 'order') loadMyOrders(); } catch (e) {}
  });
})();
})();
