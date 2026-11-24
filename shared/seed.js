/* Стартові дані Smart Klima. Спільні для сервера (Node) і демо-режиму в браузері. */
(function (root) {
  const SEED = {
    products: [
      { id: 1, brand: "Gree", model: "Bora Inverter GWH09AAB", btu: 9, kw: 2.6, area: 25, noise: 22, inv: true, heat: -15, wifi: true, cls: "A++", price: 21900, old: 0, color: "#1b9bd1", dark: false, hit: true, warranty: 3, descr: "Популярний інвертор для спальні та невеликої вітальні. Тихий нічний режим, керування зі смартфона." },
      { id: 2, brand: "Cooper&Hunter", model: "Vip Inverter CH-S09FTXHV", btu: 9, kw: 2.7, area: 25, noise: 21, inv: true, heat: -25, wifi: true, cls: "A+++", price: 28400, old: 31200, color: "#c8102e", dark: false, hit: true, warranty: 3, descr: "Обігрів до −25°C: можна гріти квартиру взимку замість обігрівача. Клас A+++, мінімальні рахунки за світло." },
      { id: 3, brand: "Midea", model: "Forest DC MSAFB-07N8", btu: 7, kw: 2.1, area: 20, noise: 24, inv: true, heat: -15, wifi: false, cls: "A++", price: 15600, old: 0, color: "#0067b1", dark: false, hit: true, warranty: 3, descr: "Найдоступніший інвертор у каталозі. Для кухні, кабінету чи дитячої до 20 м²." },
      { id: 4, brand: "Mitsubishi Electric", model: "MSZ-HR25VF", btu: 9, kw: 2.5, area: 25, noise: 22, inv: true, heat: -10, wifi: false, cls: "A++", price: 33900, old: 0, color: "#e60012", dark: false, hit: false, warranty: 5, descr: "Японська надійність і довгий ресурс компресора. Простий, без зайвих функцій." },
      { id: 5, brand: "Daikin", model: "Perfera FTXM35R", btu: 12, kw: 3.5, area: 35, noise: 19, inv: true, heat: -25, wifi: true, cls: "A+++", price: 52700, old: 0, color: "#0097e0", dark: true, hit: false, warranty: 5, descr: "Преміум: 19 дБ, датчик руху, очищення повітря. Ефективно гріє до −25°C." },
      { id: 6, brand: "LG", model: "Artcool Mirror AC12BK", btu: 12, kw: 3.5, area: 35, noise: 19, inv: true, heat: -15, wifi: true, cls: "A++", price: 38200, old: 41900, color: "#a50034", dark: true, hit: true, warranty: 3, descr: "Дзеркальна чорна панель для сучасних інтер'єрів, швидке охолодження Jet Cool." },
      { id: 7, brand: "Samsung", model: "WindFree AR12TXEAAWK", btu: 12, kw: 3.5, area: 35, noise: 21, inv: true, heat: -15, wifi: true, cls: "A++", price: 36500, old: 0, color: "#1428a0", dark: false, hit: false, warranty: 3, descr: "Охолоджує без прямого потоку через тисячі мікроотворів. Не дме на людей." },
      { id: 8, brand: "Tosot", model: "Smart Pro T12H-SN", btu: 12, kw: 3.5, area: 35, noise: 26, inv: false, heat: -7, wifi: false, cls: "A", price: 17800, old: 0, color: "#2b9348", dark: false, hit: false, warranty: 2, descr: "Бюджетний on/off для дачі, гаража чи сезонного використання." },
      { id: 9, brand: "Gree", model: "Pular Inverter GWH18AGD", btu: 18, kw: 5.3, area: 50, noise: 32, inv: true, heat: -15, wifi: true, cls: "A++", price: 35400, old: 0, color: "#1b9bd1", dark: false, hit: false, warranty: 3, descr: "Для великої вітальні або студії до 50 м². Інвертор, Wi‑Fi." },
      { id: 10, brand: "Cooper&Hunter", model: "Nordic Premium CH-S18FTXN", btu: 18, kw: 5.3, area: 50, noise: 28, inv: true, heat: -30, wifi: true, cls: "A++", price: 46900, old: 0, color: "#c8102e", dark: false, hit: false, warranty: 3, descr: "Арктична серія: обігрів до −30°C, підігрів піддону. Для приватного будинку." },
      { id: 11, brand: "Midea", model: "Mission MSMB-24HRN1", btu: 24, kw: 7.0, area: 70, noise: 38, inv: false, heat: -7, wifi: false, cls: "A", price: 31200, old: 34500, color: "#0067b1", dark: false, hit: false, warranty: 3, descr: "Потужний on/off для офісу, магазину чи залу до 70 м²." },
      { id: 12, brand: "Daikin", model: "Sensira FTXF71A", btu: 24, kw: 7.1, area: 70, noise: 33, inv: true, heat: -15, wifi: true, cls: "A++", price: 61800, old: 0, color: "#0097e0", dark: false, hit: false, warranty: 5, descr: "Інвертор Daikin для великих приміщень і комерції до 70 м²." }
    ],
    services: [
      { id: "s1", title: "Чищення спліт-системи", text: "Внутрішній і зовнішній блок, антибактеріальна обробка, промивка дренажу.", price: 1400 },
      { id: "s2", title: "Дозаправка фреоном", text: "Пошук витоку, усунення, дозаправка R32 або R410A до норми.", price: 1800 },
      { id: "s3", title: "Діагностика", text: "Виїзд, перевірка тиску, плати і датчиків. Знімається при ремонті.", price: 600 },
      { id: "s4", title: "Демонтаж кондиціонера", text: "Зі збором фреону в зовнішній блок, для переїзду чи заміни.", price: 1200 },
      { id: "s5", title: "Перенесення на нове місце", text: "Демонтаж і монтаж у межах квартири, нова траса до 3 м.", price: 4800 },
      { id: "s6", title: "Сервіс для бізнесу", text: "Договір на обслуговування ресторанів, офісів, магазинів. Чищення двічі на рік.", price: 0 }
    ],
    masters: [
      { id: "m1", name: "Андрій Коваль", short: "АК", color: "#0b7a8a", exp: 12, rating: 4.9, jobs: 640, free: true, phone: "+38 (067) 111-20-01", area: "Поділ, Оболонь, Виноградар", skills: ["Мульти-спліт системи", "Монтаж на фасадах 9+ поверх", "Сертифікат Daikin, Mitsubishi"], bio: "Береться за складні фасади та мульти-спліти на 3–5 кімнат.", pin: "1111" },
      { id: "m2", name: "Олег Бондар", short: "ОБ", color: "#e0662b", exp: 8, rating: 4.8, jobs: 410, free: false, phone: "+38 (050) 222-30-02", area: "Лівий берег, Бровари", skills: ["Побутові спліт-системи", "Прихований монтаж траси", "Заправка фреоном"], bio: "Спеціалізується на прихованому монтажі в штробі під час ремонту.", pin: "2222" },
      { id: "m3", name: "Ірина Мельник", short: "ІМ", color: "#6c4fd1", exp: 6, rating: 5.0, jobs: 290, free: true, phone: "+38 (093) 333-40-03", area: "Печерськ, Голосіїв, Теремки", skills: ["Діагностика і ремонт плат", "Сервісне чищення", "Wi‑Fi модулі та налаштування"], bio: "Ремонтує плати замість заміни блоків, налаштовує керування зі смартфона.", pin: "3333" },
      { id: "m4", name: "Тарас Литвин", short: "ТЛ", color: "#1f8a4c", exp: 15, rating: 4.9, jobs: 820, free: true, phone: "+38 (097) 444-50-04", area: "Київ та область", skills: ["Касетні та канальні", "Комерційні об'єкти, ресторани", "Промислові чилери"], bio: "Веде комерційні об'єкти: ресторани, офіси, склади. Здає під ключ.", pin: "4444" }
    ],
    reviews: [
      { name: "Олена", master: "m1", stars: 5, date: "2026-07-14", text: "Приїхали в день дзвінка, поставили Gree на 9-му поверсі за 3 години. Все прибрали за собою, трасу сховали в короб." },
      { name: "Максим", master: "m3", stars: 5, date: "2026-08-02", text: "Ірина знайшла, чому старий кондиціонер тік. Почистила дренаж, взяла 900 грн замість нового блоку за 20 тисяч." },
      { name: "Наталія", master: "m2", stars: 4, date: "2026-06-21", text: "Монтаж якісний, але запізнились на годину. Попередили заздалегідь, тому мінус лише одна зірка." },
      { name: "Ресторан «Печера»", master: "m4", stars: 5, date: "2026-05-30", text: "Тарас поставив 4 касетні блоки в залі. Влітку гості нарешті не просять пересадити від вікна." }
    ],
    installBase: { 7: 4200, 9: 4500, 12: 5200, 18: 6500, 24: 7800 },
    statuses: { new: "Нова", confirmed: "Підтверджена", onway: "Майстер виїхав", done: "Виконана", cancelled: "Скасована" }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = SEED;
  else root.SK_SEED = SEED;
})(typeof window !== "undefined" ? window : globalThis);
