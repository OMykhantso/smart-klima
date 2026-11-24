// Планувальник виїздів: вільні слоти і вибір майстра за штрафною функцією.
// Робочий день 09:00–19:00, крок 30 хв, між виїздами 30 хв на дорогу.
'use strict';

const DAY_START = 9 * 60, DAY_END = 19 * 60, STEP = 30, TRAVEL = 30, MIN_LEAD = 120, HORIZON_DAYS = 14;
const SHORTEST_JOB = 60;

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Поточні дата й час у Києві: { date: 'YYYY-MM-DD', min: хвилини від півночі }. */
function kyivNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/** Тривалість виїзду в хвилинах. */
function jobDuration(kind, { units = 1, services = [] } = {}) {
  if (kind === 'install') return 180 + 60 * Math.max(0, Math.min(5, units) - 1);
  if (kind === 'service') return Math.max(SHORTEST_JOB, Math.min(480, services.reduce((s, x) => s + x.duration_min, 0)));
  return SHORTEST_JOB; // огляд
}

/** Зайняті інтервали майстрів на дату: Map(masterId → [{s, e}]) у хвилинах. */
function busyByMaster(db, date, excludeOrderId = 0) {
  const rows = db.prepare(`SELECT id, master_id, starts_at, ends_at FROM orders
    WHERE master_id IS NOT NULL AND status <> 'cancelled' AND substr(starts_at, 1, 10) = ? AND id <> ?`).all(date, excludeOrderId);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.master_id)) map.set(r.master_id, []);
    map.get(r.master_id).push({ s: toMin(r.starts_at.slice(11)), e: toMin(r.ends_at.slice(11)) });
  }
  for (const v of map.values()) v.sort((a, b) => a.s - b.s);
  return map;
}

const fits = (busy, s, e) => busy.every(b => e + TRAVEL <= b.s || s >= b.e + TRAVEL);

/**
 * Штраф для майстра на інтервал [s, e):
 *  20 × кількість виїздів того дня (рівномірне навантаження),
 *  15 за кожне «мертве» вікно 1..59 хв, у яке вже не вміститься жоден виїзд (фрагментація),
 *  10 × (5 − рейтинг) (перевага досвідченішим).
 */
function penalty(busy, s, e, rating) {
  const all = [...busy, { s, e }].sort((a, b) => a.s - b.s);
  let dead = 0, prev = DAY_START - TRAVEL;
  for (const b of all) { const gap = b.s - TRAVEL - prev; if (gap > 0 && gap < SHORTEST_JOB) dead++; prev = b.e + TRAVEL; }
  const tail = DAY_END - prev; if (tail > 0 && tail < SHORTEST_JOB) dead++;
  return 20 * busy.length + 15 * dead + Math.round(10 * (5 - rating));
}

function activeMasters(db, date, preferred) {
  const rows = db.prepare(`SELECT m.id, m.rating FROM masters m
    WHERE m.active = 1 AND NOT EXISTS (SELECT 1 FROM master_days_off d WHERE d.master_id = m.id AND d.day = ?)`).all(date);
  return preferred ? rows.filter(r => r.id === preferred) : rows;
}

/** Вільні слоти на дату для виїзду тривалістю duration хв. */
function availableSlots(db, { date, duration, preferred = '', now = new Date() }) {
  if (!isDate(date)) throw Object.assign(new Error('Некоректна дата'), { status: 400 });
  const today = kyivNow(now);
  if (date < today.date || date > addDays(today.date, HORIZON_DAYS)) return [];
  const masters = activeMasters(db, date, preferred);
  const busy = busyByMaster(db, date);
  const earliest = date === today.date ? today.min + MIN_LEAD : 0;
  const out = [];
  for (let s = DAY_START; s + duration <= DAY_END; s += STEP) {
    if (s < earliest) continue;
    const e = s + duration;
    const cands = masters.filter(m => fits(busy.get(m.id) || [], s, e))
      .map(m => ({ id: m.id, score: penalty(busy.get(m.id) || [], s, e, m.rating) }))
      .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    if (cands.length) out.push({ time: toHHMM(s), end: toHHMM(e), masters: cands.length, recommended: cands[0].id });
  }
  return out;
}

/** Обирає майстра для конкретного часу. Повертає id або null, якщо всі зайняті. */
function chooseMaster(db, { date, time, duration, preferred = '', excludeOrderId = 0 }) {
  const s = toMin(time), e = s + duration;
  if (s < DAY_START || e > DAY_END || (s - DAY_START) % STEP) return null;
  const busy = busyByMaster(db, date, excludeOrderId);
  const c = activeMasters(db, date, preferred).filter(m => fits(busy.get(m.id) || [], s, e))
    .map(m => ({ id: m.id, score: penalty(busy.get(m.id) || [], s, e, m.rating) }))
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return c.length ? c[0].id : null;
}

module.exports = { availableSlots, chooseMaster, jobDuration, penalty, kyivNow, addDays, isDate, toMin, toHHMM, DAY_START, DAY_END, TRAVEL, MIN_LEAD, HORIZON_DAYS };
