// Екрани майстра: розклад, заявка (статуси, дзвінок, маршрут, нотатка), профіль з вихідними.
import React, { useCallback, useState } from 'react';
import { View, Linking, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../context';
import { api } from '../api';
import { Screen, Card, T, Button, Field, Seg, StatusPill, Timeline, Row, Err, Empty, Loading, Avatar } from '../ui';
import { useTheme, UAH, fmtDay, kyivToday, addDays, KIND, STATUS } from '../theme';
import { OrderCard } from './ClientScreens';

const NEXT_ACTION = {
  confirmed: ['Підтвердити заявку', 'primary'],
  on_way: ['Я виїхав', 'primary'],
  in_work: ['Почав роботу', 'primary'],
  done: ['Роботу виконано', 'good'],
};

function useSchedule() {
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api('GET', '/api/master/schedule').then(l => { setList(l); setErr(''); }).catch(e => setErr(e.message)), []);
  useFocusEffect(useCallback(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]));
  return { list, err, load };
}

export function ScheduleScreen({ navigation }) {
  const { list, err, load } = useSchedule();
  const [tab, setTab] = useState('active');
  const t = useTheme();
  if (!list) return err ? <Screen><Err>{err}</Err></Screen> : <Loading />;
  const today = kyivToday();
  const active = list.filter(o => !['done', 'cancelled'].includes(o.status));
  const done = list.filter(o => o.status === 'done');
  const shown = tab === 'active' ? active : done.slice().reverse();
  const groups = shown.reduce((m, o) => { const d = o.startsAt.slice(0, 10); (m[d] = m[d] || []).push(o); return m; }, {});
  const todayCount = active.filter(o => o.startsAt.startsWith(today)).length;
  const fresh = active.filter(o => o.status === 'new').length;
  return (
    <Screen onRefresh={load}>
      <Row style={{ gap: 10 }}>
        {[[todayCount, 'сьогодні'], [fresh, 'нових'], [done.length, 'виконано']].map(([n, l]) => (
          <Card key={l} style={{ flex: 1, gap: 2 }}><T size={24} mono color={l === 'нових' && n ? t.heat : undefined}>{n}</T><T muted size={12}>{l}</T></Card>
        ))}
      </Row>
      <Seg value={tab} onChange={setTab} items={[['active', `Активні (${active.length})`], ['done', `Виконані (${done.length})`]]} />
      {Object.keys(groups).length ? Object.entries(groups).map(([d, os]) => (
        <View key={d} style={{ gap: 8 }}>
          <T bold muted>{d === today ? 'Сьогодні' : d === addDays(today, 1) ? 'Завтра' : fmtDay(d)}</T>
          {os.map(o => <OrderCard key={o.id} o={o} forMaster onPress={() => navigation.navigate('MasterOrder', { id: o.id })} />)}
        </View>
      )) : <Empty>{tab === 'active' ? 'Активних заявок немає. Нові з\'являться тут, щойно клієнт запишеться на сайті чи в застосунку.' : 'Виконаних заявок ще немає.'}</Empty>}
    </Screen>
  );
}

export function MasterOrderScreen({ route }) {
  const t = useTheme();
  const [o, setO] = useState(null); const [note, setNote] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('GET', `/api/orders/${route.params.id}`).then(x => { setO(x); setNote(n => n === null ? x.masterNote : n); }).catch(e => setErr(e.message)), [route.params.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!o) return err ? <Screen><Err>{err}</Err></Screen> : <Loading />;
  const act = async status => { setBusy(true); setErr(''); try { setO(await api('PATCH', `/api/orders/${o.id}/status`, { status })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const saveNote = async () => { try { setO(await api('PATCH', `/api/orders/${o.id}/note`, { note })); } catch (e) { setErr(e.message); } };
  const next = o.next.find(s => NEXT_ACTION[s]);
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}><T size={20} display>№{o.id} · {KIND[o.kind]}</T><StatusPill status={o.status} /></Row>
      <Timeline status={o.status} />
      <Card>
        <T muted size={12}>КЛІЄНТ</T><T bold>{o.contactName}</T><T mono>{o.contactPhone}</T>
        <T muted size={12}>АДРЕСА</T><T>{o.address}</T>
        <T muted size={12}>ЧАС</T><T>{fmtDay(o.startsAt.slice(0, 10))}, {o.startsAt.slice(11)}–{o.endsAt.slice(11)}</T>
        <Row>
          <Button testID="call-client" title="Подзвонити" onPress={() => Linking.openURL('tel:' + o.contactPhone)} style={{ flex: 1 }} />
          <Button kind="ghost" title="Маршрут" onPress={() => Linking.openURL('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address))} style={{ flex: 1 }} />
        </Row>
      </Card>
      <Card>
        {o.items.length ? o.items.map((i, k) => <Row key={k} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><T size={14} style={{ flex: 1 }}>{i.title}</T><T mono size={14}>{UAH(i.price)}</T></Row>) : <T>Безкоштовний огляд: заміри, підбір моделі, розрахунок</T>}
        {o.total ? <Row style={{ justifyContent: 'space-between' }}><T bold>До сплати</T><T mono color={t.heat}>{UAH(o.total)}</T></Row> : null}
      </Card>
      {o.comment ? <Card><T muted size={12}>КЛІЄНТ ПИШЕ</T><T>«{o.comment}»</T></Card> : null}
      {next ? <Button testID="next-status" kind={NEXT_ACTION[next][1]} title={NEXT_ACTION[next][0]} onPress={() => act(next)} loading={busy} /> : null}
      <Card>
        <Field testID="master-note" label="Нотатка для офісу і клієнта" value={note ?? ''} onChangeText={setNote} multiline placeholder="Що зроблено, що докупити" />
        <Button testID="save-note" kind="ghost" title="Зберегти нотатку" onPress={saveNote} disabled={(note ?? '') === o.masterNote} />
      </Card>
      <Card><T muted size={12}>ІСТОРІЯ</T>{o.history.map((h, k) => <T key={k} size={13}>{new Date(h.at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {STATUS[h.to_status]}{h.actor ? ` · ${h.actor}` : ''}</T>)}</Card>
      <Err>{err}</Err>
    </Screen>
  );
}

export function MasterProfileScreen() {
  const { user, logout, catalog } = useApp();
  const t = useTheme();
  const [off, setOff] = useState(null); const [err, setErr] = useState(''); const [stats, setStats] = useState(null);
  const load = useCallback(() => {
    api('GET', '/api/master/days-off').then(setOff).catch(e => setErr(e.message));
    api('GET', '/api/master/schedule?from=2000-01-01').then(l => setStats({ done: l.filter(o => o.status === 'done').length, sum: l.filter(o => o.status === 'done').reduce((s, o) => s + o.total, 0) })).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const me = catalog?.masters.find(m => m.id === user.masterId);
  const days = Array.from({ length: 14 }, (_, i) => addDays(kyivToday(), i));
  const toggle = async d => { setErr(''); try { await api('PUT', `/api/master/days-off/${d}`, { off: !off.includes(d) }); load(); } catch (e) { setErr(e.message); } };
  return (
    <Screen>
      <Card><Row><Avatar m={me} size={48} /><View style={{ flex: 1 }}><T size={18} display>{user.name}</T><T muted>Майстер · ★ {me ? String(me.rating).replace('.', ',') : '—'}</T></View></Row></Card>
      {stats ? <Row style={{ gap: 10 }}><Card style={{ flex: 1 }}><T size={22} mono>{stats.done}</T><T muted size={12}>виконано через застосунок</T></Card><Card style={{ flex: 1 }}><T size={22} mono>{UAH(stats.sum)}</T><T muted size={12}>сума робіт</T></Card></Row> : null}
      <Card>
        <T bold>Вихідні на 2 тижні</T>
        <T muted size={12}>У вихідний день клієнти не зможуть записатися до вас.</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {off && days.map(d => {
            const isOff = off.includes(d);
            return <Pressable key={d} onPress={() => toggle(d)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: isOff ? t.heat : t.line, backgroundColor: isOff ? t.heat + '22' : t.surface }}>
              <T size={13} color={isOff ? t.heat : t.ink} bold={isOff}>{fmtDay(d)}{isOff ? ' · вихідний' : ''}</T></Pressable>;
          })}
        </View>
        <Err>{err}</Err>
      </Card>
      <Button kind="danger" testID="logout" title="Вийти" onPress={logout} />
    </Screen>
  );
}

export function AdminHomeScreen() {
  const { user, logout } = useApp();
  const [a, setA] = useState(null);
  useFocusEffect(useCallback(() => { api('GET', '/api/admin/analytics?days=30').then(setA).catch(() => {}); }, []));
  const n = s => a?.byStatus.find(x => x.status === s)?.n || 0;
  return (
    <Screen>
      <Card><T size={18} display>{user.name}</T><T muted>Адміністратор. Повна адмінка (призначення, аналітика, модерація) — на сайті.</T></Card>
      {a ? <Card><T bold>За 30 днів</T>{['new', 'confirmed', 'on_way', 'in_work', 'done', 'cancelled'].map(s => <Row key={s} style={{ justifyContent: 'space-between' }}><T>{STATUS[s]}</T><T mono>{n(s)}</T></Row>)}<Row style={{ justifyContent: 'space-between' }}><T bold>Виручка (виконані)</T><T mono>{UAH(a.revenueDone)}</T></Row></Card> : <Loading />}
      <Button kind="danger" title="Вийти" onPress={logout} />
    </Screen>
  );
}
