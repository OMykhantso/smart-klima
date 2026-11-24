// Демонстраційні заявки за останні 3 тижні та на найближчі дні (npm run demo).
// Створює окрему базу data/demo.db, щоб не змішувати з робочими даними.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { openDb, tx } = require('./db.js');
const SL = require('./slots.js');
const { installCost } = require('./calc.js');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'demo.db');
for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = openDb(file);

// Детермінований генератор, щоб демо щоразу було однаковим.
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];

const today = SL.kyivNow().date;
const clients = [
  ['Олена Клієнтка', '+380501234567', 'Київ, вул. Січових Стрільців, 10, кв. 5'], ['Максим Клієнт', '+380631112233', 'Київ, просп. Перемоги, 44, кв. 81'],
  ['Ірина Савчук', '+380671239876', 'Київ, вул. Антоновича, 112'], ['Дмитро Гнатюк', '+380931234500', 'Бровари, вул. Київська, 160, кв. 3'],
  ['Кав\'ярня «Зерно»', '+380442223344', 'Київ, вул. Ярославів Вал, 14'], ['Сергій Мороз', '+380955554433', 'Київ, вул. Здолбунівська, 7Д, кв. 120'],
  ['Наталія Бойко', '+380681112244', 'Ірпінь, вул. Університетська, 2, кв. 15'], ['Офіс «Мета»', '+380443332211', 'Київ, вул. Велика Васильківська, 72, оф. 5'],
];
const userIds = db.prepare(`SELECT id FROM users WHERE role = 'client'`).all().map(r => r.id);
const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).get().id;
const masters = db.prepare('SELECT m.id, m.user_id FROM masters m').all();
const products = db.prepare('SELECT * FROM products').all();
const services = db.prepare('SELECT * FROM services').all();
const comments = ['', '', 'Домофон не працює, зателефонуйте', 'Паркування у дворі', 'Потрібен короб білого кольору', 'Після 14:00 зручніше', ''];
const notes = ['Траса 4 м, свердління бетону', 'Почищено дренаж, замінено фільтри', 'Клієнт перевірив охолодження й обігрів', 'Додатково встановлено кошик', ''];

let n = 0;
tx(db, () => {
  for (let d = -21; d <= 4; d++) {
    const date = SL.addDays(today, d);
    const perDay = d < 0 ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < perDay; k++) {
      const kind = pick(['install', 'install', 'service', 'service', 'inspection']);
      const items = [];
      let units = 1;
      if (kind === 'install') {
        const p = pick(products); units = rnd() < 0.15 ? 2 : 1;
        const inst = installCost({ btu: p.btu, route: 3 + Math.floor(rnd() * 4), floor: pick(['low', 'mid', 'high']), options: ['wall'] });
        items.push({ product_id: p.id, title: `${p.brand} ${p.model}`, qty: units, price: p.price * units });
        items.push({ title: `Монтаж ${p.brand} ${p.model}: ${inst.lines.map(l => l.title).join('; ')}`, qty: units, price: inst.total * units });
      }
      const svc = kind === 'service' ? [pick(services.filter(s => s.price))] : [];
      for (const s of svc) items.push({ service_id: s.id, title: s.title, qty: 1, price: s.price });
      const duration = SL.jobDuration(kind, { units, services: svc });
      const slots = SL.availableSlots(db, { date, duration, now: new Date(date + 'T00:00:00Z') });
      if (!slots.length) continue;
      const slot = pick(slots);
      const masterId = SL.chooseMaster(db, { date, time: slot.time, duration });
      const c = pick(clients);
      const status = d < -1 ? (rnd() < 0.1 ? 'cancelled' : 'done') : d === -1 ? pick(['done', 'done', 'in_work']) : d === 0 ? pick(['confirmed', 'on_way', 'in_work', 'done']) : pick(['new', 'new', 'confirmed']);
      const created = new Date(Date.parse(date + 'T08:00:00Z') - (1 + Math.floor(rnd() * 3)) * 86400000 + Math.floor(rnd() * 36000000)).toISOString();
      const total = items.reduce((s, i) => s + i.price, 0);
      const r = db.prepare(`INSERT INTO orders (user_id, kind, status, source, contact_name, contact_phone, address, master_id, starts_at, ends_at, comment, master_note, total, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pick(userIds), kind, status, rnd() < 0.55 ? 'mobile' : 'web', c[0], c[1], c[2], masterId, `${date} ${slot.time}`, `${date} ${slot.end}`, pick(comments), status === 'done' ? pick(notes) : '', total, created, created);
      const oid = Number(r.lastInsertRowid);
      for (const i of items) db.prepare('INSERT INTO order_items (order_id, product_id, service_id, title, qty, price) VALUES (?, ?, ?, ?, ?, ?)').run(oid, i.product_id || null, i.service_id || null, i.title, i.qty, i.price);
      const path = status === 'cancelled' ? ['new', 'cancelled'] : ['new', 'confirmed', 'on_way', 'in_work', 'done'].slice(0, ['new', 'confirmed', 'on_way', 'in_work', 'done'].indexOf(status) + 1);
      const mUser = masters.find(m => m.id === masterId).user_id;
      let t = Date.parse(created);
      path.forEach((s, i) => {
        t = i === 0 ? t : i === 1 ? t + 3600000 : Math.max(t + 600000, Date.parse(`${date}T${slot.time}:00Z`) - 7200000 + i * 3000000);
        db.prepare('INSERT INTO status_changes (order_id, from_status, to_status, actor_id, at) VALUES (?, ?, ?, ?, ?)').run(oid, i ? path[i - 1] : null, s, s === 'cancelled' ? admin : i ? mUser : null, new Date(t).toISOString());
      });
      db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(new Date(t).toISOString(), oid);
      n++;
    }
  }
});
console.log(`Демо-база: ${file}, заявок: ${n}`);
