// Розрахунок потрібної холодопродуктивності та вартості монтажу.
// Обидва клієнти показують результат цієї функції, а сервер перераховує ціну монтажу
// під час створення заявки, тому клієнт не може підмінити суму.
'use strict';

const Q_BY_SUN = { shade: 30, normal: 35, sunny: 40 };            // Вт/м³
const CLASSES = [[7, 2.1], [9, 2.6], [12, 3.5], [18, 5.3], [24, 7.0]]; // [клас BTU, кВт]
const INSTALL_BASE = { 7: 4200, 9: 4500, 12: 5200, 18: 6500, 24: 7800 };
const FLOOR_PRICE = { low: 0, mid: 800, high: 1500 };
const OPTIONS = {
  wall:   { title: 'Свердління стіни', price: 500 },
  pump:   { title: 'Дренажна помпа', price: 1900 },
  old:    { title: 'Демонтаж старого кондиціонера', price: 1200 },
  fence:  { title: 'Захисний кошик', price: 950 },
};
const PER_METER = { box: { title: 'Декор-короб', price: 180 }, hidden: { title: 'Штроба', price: 450 } };

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Q = S·h·q / 1000 + 0,1·людей + 0,3·техніка (кВт) */
function coolingKw({ area, height, sun, people, tech }) {
  const S = clamp(area, 5, 200, 20), h = clamp(height, 2.2, 5, 2.7), q = Q_BY_SUN[sun] || Q_BY_SUN.normal;
  const n = clamp(people, 0, 30, 2), t = clamp(tech, 0, 5, 0.3);
  return Math.round((S * h * q / 1000 + n * 0.1 + t * 0.3) * 100) / 100;
}
/** Найменший клас, що дає не менше 95 % потрібної потужності; null — потрібно понад 7 кВт. */
function pickClass(kw) { const c = CLASSES.find(([, cap]) => cap >= kw * 0.95); return c ? c[0] : null; }

function installCost({ btu, route = 3, floor = 'low', options = [], trace = '' }) {
  if (!INSTALL_BASE[btu]) throw new Error('BAD_CLASS');
  const r = Math.round(clamp(route, 1, 30, 3));
  const lines = [{ title: `Базовий монтаж, клас ${String(btu).padStart(2, '0')} (до 3 м траси)`, price: INSTALL_BASE[btu] }];
  const extra = Math.max(0, r - 3), perM = btu >= 18 ? 650 : 520;
  if (extra) lines.push({ title: `Додаткова траса ${extra} м × ${perM} ₴`, price: extra * perM });
  if (FLOOR_PRICE[floor]) lines.push({ title: 'Висотні роботи', price: FLOOR_PRICE[floor] });
  if (PER_METER[trace]) lines.push({ title: `${PER_METER[trace].title} ${r} м × ${PER_METER[trace].price} ₴`, price: r * PER_METER[trace].price });
  for (const o of [...new Set(options)]) if (OPTIONS[o]) lines.push({ ...OPTIONS[o] });
  return { lines, total: lines.reduce((s, l) => s + l.price, 0) };
}

function calculate(input = {}) {
  // Лише вартість монтажу для відомого класу (кошик застосунку)
  if (INSTALL_BASE[input.btu]) return { btu: Number(input.btu), install: installCost({ ...input, btu: Number(input.btu) }) };
  const kw = coolingKw(input);
  const btu = pickClass(kw);
  const install = installCost({ ...input, btu: btu || 24 });
  return { kw, btu, enough: !!btu, install };
}

module.exports = { calculate, coolingKw, pickClass, installCost, INSTALL_BASE, OPTIONS };
