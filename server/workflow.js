// Скінченний автомат станів заявки: хто і з якого статусу може перевести заявку.
'use strict';

const STATUSES = ['new', 'confirmed', 'on_way', 'in_work', 'done', 'cancelled'];
const LABELS = { new: 'Нова', confirmed: 'Підтверджена', on_way: 'Майстер у дорозі', in_work: 'Монтаж триває', done: 'Виконана', cancelled: 'Скасована' };

// [з, у, ролі, додаткова умова]
const TRANSITIONS = [
  ['new',       'confirmed', ['master', 'admin']],
  ['confirmed', 'on_way',    ['master']],
  ['on_way',    'in_work',   ['master']],
  ['in_work',   'done',      ['master', 'admin']],
  ['new',       'cancelled', ['client', 'admin']],
  ['confirmed', 'cancelled', ['client', 'admin'], 'clientLeadTime'],
  ['on_way',    'cancelled', ['admin']],
];

class TransitionError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

/**
 * Перевіряє перехід. actor = { id, role, masterId }, order = рядок таблиці orders.
 * ctx.minutesToStart — скільки хвилин до початку виїзду (для правила скасування клієнтом).
 */
function assertTransition(order, to, actor, ctx = {}) {
  if (!STATUSES.includes(to)) throw new TransitionError('BAD_STATUS', 'Невідомий статус', 400);
  if (order.status === to) throw new TransitionError('SAME_STATUS', 'Заявка вже має цей статус');
  const rule = TRANSITIONS.find(([f, t]) => f === order.status && t === to);
  if (!rule) throw new TransitionError('BAD_TRANSITION', `Не можна перейти зі статусу «${LABELS[order.status]}» у «${LABELS[to]}»`);
  if (!rule[2].includes(actor.role)) throw new TransitionError('FORBIDDEN', 'Недостатньо прав для цієї дії', 403);
  if (actor.role === 'client' && order.user_id !== actor.id) throw new TransitionError('NOT_OWNER', 'Це не ваша заявка', 403);
  if (actor.role === 'master' && order.master_id !== actor.masterId) throw new TransitionError('NOT_ASSIGNED', 'Заявка призначена іншому майстру', 403);
  if (rule[3] === 'clientLeadTime' && actor.role === 'client' && (ctx.minutesToStart ?? Infinity) < 180)
    throw new TransitionError('TOO_LATE', 'Підтверджену заявку можна скасувати не пізніше ніж за 3 години до виїзду. Зателефонуйте нам.');
  return true;
}

/** Дозволені наступні статуси для показу кнопок у клієнтах. */
function nextStatuses(order, actor) {
  return TRANSITIONS.filter(([f, , roles]) => f === order.status && roles.includes(actor.role))
    .filter(([, , , cond]) => !(actor.role === 'master' && order.master_id !== actor.masterId) && !(actor.role === 'client' && order.user_id !== actor.id))
    .map(([, t]) => t);
}

module.exports = { STATUSES, LABELS, TRANSITIONS, assertTransition, nextStatuses, TransitionError };
