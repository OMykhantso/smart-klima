// Кольори та типографіка застосунку (світла й темна теми).
import { useColorScheme } from 'react-native';

const light = {
  bg: '#eef3f6', surface: '#ffffff', surface2: '#e3ebf0', ink: '#0f2230', muted: '#5a6f7d', line: '#cfdbe3',
  accent: '#0b7a8a', accentInk: '#ffffff', heat: '#e0662b', good: '#1f8a4c', warn: '#b7791f', star: '#e3a21a',
};
const dark = {
  bg: '#0c161d', surface: '#132129', surface2: '#1a2c36', ink: '#e4eef3', muted: '#93a8b5', line: '#26404d',
  accent: '#3cc0cf', accentInk: '#06222a', heat: '#f08a55', good: '#4cc27e', warn: '#e3b04b', star: '#f0bb44',
};
export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);

export const STATUS = { new: 'Нова', confirmed: 'Підтверджена', on_way: 'Майстер у дорозі', in_work: 'Монтаж триває', done: 'Виконана', cancelled: 'Скасована' };
export const STEPS = ['new', 'confirmed', 'on_way', 'in_work', 'done'];
export const statusColor = (t, s) => ({ new: t.heat, confirmed: t.warn, on_way: t.accent, in_work: t.accent, done: t.good, cancelled: t.muted }[s] || t.muted);
export const KIND = { install: 'Монтаж', service: 'Сервіс', inspection: 'Огляд' };

export const UAH = n => Math.round(n).toLocaleString('uk-UA').replace(/[\s,]/g, ' ') + ' ₴';
export const dec = n => String(n).replace('.', ',');
export const pad2 = n => String(n).padStart(2, '0');
const MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const fmtDay = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const fmtSlot = s => s ? `${fmtDay(s.slice(0, 10))}, ${s.slice(11)}` : '';
export const kyivToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
