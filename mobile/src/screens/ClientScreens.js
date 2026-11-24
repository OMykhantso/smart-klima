// Екрани клієнта: каталог, модель, підбір, запис на виїзд, мої заявки, заявка, профіль.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, Linking, Alert, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../context';
import { api } from '../api';
import { Screen, Card, T, Button, Field, Chips, Seg, StatusPill, Timeline, Avatar, Row, Err, Empty, Loading, UnitThumb } from '../ui';
import { useTheme, UAH, dec, pad2, fmtDay, fmtSlot, kyivToday, addDays, KIND, STATUS } from '../theme';

const confirmAsk = (title, msg, ok) => Platform.OS === 'web' ? (window.confirm(`${title}\n${msg}`) && ok()) : Alert.alert(title, msg, [{ text: 'Ні', style: 'cancel' }, { text: 'Так', style: 'destructive', onPress: ok }]);

/* ---------- Каталог ---------- */
export function CatalogScreen({ navigation }) {
  const { catalog, reloadCatalog, cart, toggleService } = useApp();
  const t = useTheme();
  const [q, setQ] = useState(''); const [f, setF] = useState('all'); const [refreshing, setRefreshing] = useState(false);
  if (!catalog) return <Loading />;
  const list = catalog.products.filter(p => (f === 'all' || (+f && p.area === +f) || (f === 'inv' && p.inv) || (f === 'heat' && p.heat <= -25) || (f === 'sale' && p.old))
    && (!q || (p.brand + ' ' + p.model).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.price - b.price);
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reloadCatalog(); setRefreshing(false); }}>
      <View style={{ backgroundColor: t.ink, borderRadius: 18, padding: 16, gap: 4 }}>
        <T size={18} display color={t.bg}>Кондиціонер з монтажем за 1 день</T>
        <T color={t.bg} style={{ opacity: 0.8 }}>Оберіть модель і зручний час. Майстра підбере система.</T>
      </View>
      <Field placeholder="Пошук моделі" value={q} onChangeText={setQ} />
      <Chips value={f} onChange={setF} testIDPrefix="f" items={[['all', 'Усі'], ['20', '20 м²'], ['25', '25 м²'], ['35', '35 м²'], ['50', '50 м²'], ['70', '70 м²'], ['inv', 'Інвертор'], ['heat', 'До −25°C'], ['sale', 'Знижка']]} />
      {list.length ? list.map(p => (
        <Card key={p.id} testID={`product-${p.id}`} onPress={() => navigation.navigate('Product', { id: p.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <UnitThumb p={p} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T bold numberOfLines={1}>{p.brand} {p.model}</T>
            <T muted size={12}>до {p.area} м² · {dec(p.kw)} кВт · {p.noise} дБ{p.inv ? ' · інвертор' : ''}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {p.old ? <T muted size={11} style={{ textDecorationLine: 'line-through' }}>{UAH(p.old)}</T> : null}
            <T mono>{UAH(p.price)}</T>
          </View>
        </Card>
      )) : <Empty>Нічого не знайшлось</Empty>}
      <T size={18} display style={{ marginTop: 8 }}>Сервіс</T>
      {catalog.services.map(s => {
        const on = cart.services.includes(s.id);
        return (
          <Card key={s.id} onPress={() => toggleService(s.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}><T bold>{s.title}</T><T muted size={12}>{s.text}</T></View>
            <View style={{ alignItems: 'flex-end' }}><T mono>{s.price ? UAH(s.price) : '—'}</T><T size={12} color={on ? t.good : t.accent} bold>{on ? '✓ обрано' : '+ додати'}</T></View>
          </Card>
        );
      })}
      {cart.services.length ? <Button title={`Записатися на сервіс (${cart.services.length})`} onPress={() => navigation.navigate('BookingTab', { screen: 'Booking', params: { kind: 'service' } })} /> : null}
    </Screen>
  );
}

/* ---------- Модель ---------- */
export function ProductScreen({ route, navigation }) {
  const { catalog, addProduct, cart } = useApp();
  const p = catalog?.products.find(x => x.id === route.params.id);
  const t = useTheme();
  if (!p) return <Loading />;
  const inCart = cart.products.some(x => x.id === p.id);
  const rows = [['Площа', `до ${p.area} м²`], ['Потужність', `${dec(p.kw)} кВт · ${pad2(p.btu)}`], ['Компресор', p.inv ? 'інвертор' : 'on/off'], ['Обігрів до', `${p.heat}°C`], ['Шум', `${p.noise} дБ`], ['Енергоклас', p.cls], ['Wi‑Fi', p.wifi ? 'так' : 'ні'], ['Гарантія', `${p.warranty} р.`]];
  return (
    <Screen>
      <UnitThumb p={p} big />
      <View><T muted size={12} bold>{p.brand.toUpperCase()}</T><T size={22} display>{p.model}</T></View>
      <T muted>{p.descr}</T>
      <Card>{rows.map(([k, v]) => <Row key={k} style={{ justifyContent: 'space-between' }}><T muted>{k}</T><T mono>{v}</T></Row>)}</Card>
      <Card style={{ backgroundColor: t.surface2 }}>
        <Row style={{ justifyContent: 'space-between' }}><T size={24} mono>{UAH(p.price)}</T>{p.old ? <T muted style={{ textDecorationLine: 'line-through' }}>{UAH(p.old)}</T> : null}</Row>
        <T muted size={13}>Монтаж від {UAH(catalog.installBase[p.btu])}, разом від {UAH(p.price + catalog.installBase[p.btu])}</T>
      </Card>
      <Button testID="book-install" title={inCart ? 'Перейти до запису' : 'Записатися на монтаж'} onPress={() => { addProduct(p.id); navigation.navigate('BookingTab', { screen: 'Booking', params: { kind: 'install' } }); }} />
    </Screen>
  );
}

/* ---------- Підбір потужності ---------- */
export function CalcScreen({ navigation }) {
  const { catalog } = useApp();
  const t = useTheme();
  const [area, setArea] = useState(20); const [height, setHeight] = useState(2.7); const [sun, setSun] = useState('normal'); const [people, setPeople] = useState(2);
  const [res, setRes] = useState(null);
  useEffect(() => { const id = setTimeout(() => api('POST', '/api/calc', { area, height, sun, people, tech: 0.3 }).then(setRes).catch(() => {}), 200); return () => clearTimeout(id); }, [area, height, sun, people]);
  const Step = ({ label, value, set, step, min, max, fmt }) => (
    <Row style={{ justifyContent: 'space-between' }}>
      <T bold>{label}</T>
      <Row>
        <Button kind="ghost" title="−" onPress={() => set(v => Math.max(min, Math.round((v - step) * 10) / 10))} style={{ paddingVertical: 6, paddingHorizontal: 14 }} />
        <T mono style={{ minWidth: 64, textAlign: 'center' }}>{fmt(value)}</T>
        <Button kind="ghost" title="+" onPress={() => set(v => Math.min(max, Math.round((v + step) * 10) / 10))} style={{ paddingVertical: 6, paddingHorizontal: 14 }} />
      </Row>
    </Row>
  );
  const recs = res?.btu ? catalog?.products.filter(p => p.btu === res.btu).sort((a, b) => a.price - b.price).slice(0, 3) : [];
  return (
    <Screen>
      <Card>
        <Step label="Площа" value={area} set={setArea} step={1} min={8} max={80} fmt={v => `${v} м²`} />
        <Step label="Стеля" value={height} set={setHeight} step={0.1} min={2.4} max={4} fmt={v => `${dec(v.toFixed(1))} м`} />
        <Step label="Людей" value={people} set={setPeople} step={1} min={1} max={10} fmt={v => String(v)} />
        <Seg value={sun} onChange={setSun} items={[['shade', 'Тінь'], ['normal', 'Звичайна'], ['sunny', 'Сонячна']]} />
      </Card>
      {res ? (
        <Card>
          <Row style={{ gap: 24 }}>
            <View><T size={28} mono color={t.accent}>{dec(res.kw)}</T><T muted size={12}>кВт холоду</T></View>
            <View><T size={28} mono>{res.btu ? pad2(res.btu) : '24+'}</T><T muted size={12}>клас BTU</T></View>
            <View><T size={28} mono>{res.btu ? UAH(res.install.total).replace(' ₴', '') : '—'}</T><T muted size={12}>монтаж, ₴</T></View>
          </Row>
          {!res.enough ? <T muted>Потрібно понад 7 кВт: два блоки або мульти-спліт. Запишіться на безкоштовний огляд.</T> : null}
        </Card>
      ) : null}
      {recs?.map(p => (
        <Card key={p.id} onPress={() => navigation.navigate('CatalogTab', { screen: 'Product', params: { id: p.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <UnitThumb p={p} /><View style={{ flex: 1 }}><T bold numberOfLines={1}>{p.brand} {p.model}</T><T muted size={12}>{p.noise} дБ{p.inv ? ' · інвертор' : ''}</T></View><T mono>{UAH(p.price)}</T>
        </Card>
      ))}
      {res && !res.enough ? <Button title="Записатися на огляд" onPress={() => navigation.navigate('BookingTab', { screen: 'Booking', params: { kind: 'inspection' } })} /> : null}
    </Screen>
  );
}

/* ---------- Запис на виїзд ---------- */
export function BookingScreen({ route, navigation }) {
  const { catalog, cart, setQty, toggleService, clearCart, user } = useApp();
  const t = useTheme();
  const [kind, setKind] = useState(route.params?.kind || (cart.products.length ? 'install' : cart.services.length ? 'service' : 'inspection'));
  useEffect(() => { if (route.params?.kind) setKind(route.params.kind); }, [route.params?.kind]);
  const [opts, setOpts] = useState({ route: 3, floor: 'low', options: ['wall'], trace: '' });
  const [date, setDate] = useState(addDays(kyivToday(), 1));
  const [slots, setSlots] = useState(null); const [time, setTime] = useState(''); const [master, setMaster] = useState('');
  const [contact, setContact] = useState({ name: user?.name || '', phone: user?.phone || '', address: '', comment: '' });
  const [installPrice, setInstallPrice] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const products = cart.products.map(c => ({ ...catalog?.products.find(p => p.id === c.id), qty: c.qty })).filter(p => p.id);
  const services = (catalog?.services || []).filter(s => cart.services.includes(s.id));
  const units = products.reduce((s, p) => s + p.qty, 0) || 1;

  useEffect(() => {
    setSlots(null); setTime('');
    api('GET', `/api/slots?date=${date}&kind=${kind}&units=${units}&services=${cart.services.join(',')}&master=${master}`).then(r => setSlots(r.slots)).catch(e => setErr(e.message));
  }, [date, kind, units, cart.services.join(','), master]);
  useEffect(() => {
    if (kind !== 'install') return;
    const btus = [...new Set(products.map(p => p.btu))];
    Promise.all(btus.map(b => api('POST', '/api/calc', { btu: b, ...opts }).then(r => [b, r.install.total]))).then(x => setInstallPrice(Object.fromEntries(x))).catch(() => {});
  }, [kind, JSON.stringify(opts), products.map(p => p.btu).join()]);

  if (!catalog) return <Loading />;
  const total = kind === 'install' ? products.reduce((s, p) => s + (p.price + (installPrice[p.btu] || 0)) * p.qty, 0) + services.reduce((s, x) => s + x.price, 0)
    : kind === 'service' ? services.reduce((s, x) => s + x.price, 0) : 0;
  const days = Array.from({ length: 14 }, (_, i) => addDays(kyivToday(), i));
  const toggleOpt = o => setOpts(s => ({ ...s, options: s.options.includes(o) ? s.options.filter(x => x !== o) : [...s.options, o] }));

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const o = await api('POST', '/api/orders', {
        kind, date, time, masterId: master, products: kind === 'install' ? cart.products : [], services: kind === 'inspection' ? [] : cart.services,
        install: opts, contactName: contact.name, contactPhone: contact.phone, address: contact.address, comment: contact.comment, source: 'mobile',
      });
      clearCart();
      navigation.navigate('OrdersTab', { screen: 'Order', params: { id: o.id, fresh: true } });
    } catch (e) { setErr(e.message); if (e.code === 'SLOT_TAKEN') setDate(d => d); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Seg value={kind} onChange={setKind} items={[['install', 'Монтаж'], ['service', 'Сервіс'], ['inspection', 'Огляд']]} />
      {kind === 'install' && (
        <Card>
          <T bold>Кондиціонери</T>
          {products.length ? products.map(p => (
            <Row key={p.id} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}><T numberOfLines={1}>{p.brand} {p.model}</T><T muted size={12}>{UAH(p.price)} + монтаж {installPrice[p.btu] ? UAH(installPrice[p.btu]) : '…'}</T></View>
              <Row><Button kind="ghost" title="−" onPress={() => setQty(p.id, p.qty - 1)} style={{ paddingVertical: 4, paddingHorizontal: 12 }} /><T mono>{p.qty}</T><Button kind="ghost" title="+" onPress={() => setQty(p.id, p.qty + 1)} style={{ paddingVertical: 4, paddingHorizontal: 12 }} /></Row>
            </Row>
          )) : <T muted>Оберіть модель у каталозі.</T>}
          <Button kind="ghost" title="+ Обрати в каталозі" onPress={() => navigation.navigate('CatalogTab', { screen: 'Catalog' })} />
          <T bold style={{ marginTop: 6 }}>Умови монтажу</T>
          <Row style={{ justifyContent: 'space-between' }}><T>Траса</T><Row><Button kind="ghost" title="−" onPress={() => setOpts(s => ({ ...s, route: Math.max(1, s.route - 1) }))} style={{ paddingVertical: 4, paddingHorizontal: 12 }} /><T mono>{opts.route} м</T><Button kind="ghost" title="+" onPress={() => setOpts(s => ({ ...s, route: Math.min(20, s.route + 1) }))} style={{ paddingVertical: 4, paddingHorizontal: 12 }} /></Row></Row>
          <Seg value={opts.floor} onChange={v => setOpts(s => ({ ...s, floor: v }))} items={[['low', '1–2 пов.'], ['mid', '3–5 пов.'], ['high', '6+ пов.']]} />
          <Chips value={null} onChange={toggleOpt} items={[['wall', `${opts.options.includes('wall') ? '✓ ' : ''}Свердління`], ['pump', `${opts.options.includes('pump') ? '✓ ' : ''}Помпа`], ['old', `${opts.options.includes('old') ? '✓ ' : ''}Демонтаж старого`], ['fence', `${opts.options.includes('fence') ? '✓ ' : ''}Кошик`]]} />
        </Card>
      )}
      {kind === 'service' && (
        <Card>
          <T bold>Послуги</T>
          {catalog.services.map(s => (
            <Pressable key={s.id} onPress={() => toggleService(s.id)}><Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <T>{cart.services.includes(s.id) ? '☑' : '☐'} {s.title}</T><T mono>{s.price ? UAH(s.price) : '—'}</T>
            </Row></Pressable>
          ))}
        </Card>
      )}
      {kind === 'inspection' && <Card><T bold>Безкоштовний огляд</T><T muted>Майстер заміряє приміщення і трасу, порадить модель і назве точну ціну.</T></Card>}

      <T bold>Дата</T>
      <Chips value={date} onChange={setDate} testIDPrefix="day" items={days.map((d, i) => [d, i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : fmtDay(d)])} />
      <T bold>Майстер</T>
      <Chips value={master} onChange={setMaster} items={[['', 'Підбере система'], ...catalog.masters.map(m => [m.id, m.name.split(' ')[0]])]} />
      <T bold>Час</T>
      {slots === null ? <T muted>Завантаження…</T> : slots.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {slots.map(s => (
            <Pressable key={s.time} testID={`slot-${s.time}`} onPress={() => setTime(s.time)}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: time === s.time ? t.accent : t.line, backgroundColor: time === s.time ? t.accent : t.surface }}>
              <T mono size={14} color={time === s.time ? t.accentInk : t.ink}>{s.time}</T>
            </Pressable>
          ))}
        </View>
      ) : <Empty>На цей день вільного часу немає. Оберіть інший день.</Empty>}

      <Card>
        <Field testID="b-name" label="Контактна особа" value={contact.name} onChangeText={v => setContact(c => ({ ...c, name: v }))} />
        <Field testID="b-phone" label="Телефон" value={contact.phone} onChangeText={v => setContact(c => ({ ...c, phone: v }))} keyboardType="phone-pad" />
        <Field testID="b-address" label="Адреса" value={contact.address} onChangeText={v => setContact(c => ({ ...c, address: v }))} placeholder="Вулиця, будинок, квартира, поверх" />
        <Field label="Коментар" value={contact.comment} onChangeText={v => setContact(c => ({ ...c, comment: v }))} multiline />
      </Card>
      <Row style={{ justifyContent: 'space-between' }}><T bold>Разом</T><T size={20} mono color={t.heat}>{total ? UAH(total) : 'безкоштовно'}</T></Row>
      <Err>{err}</Err>
      <Button testID="b-submit" title={time ? `Записатися на ${fmtDay(date)}, ${time}` : 'Оберіть час'} disabled={!time} onPress={submit} loading={busy} />
    </Screen>
  );
}

/* ---------- Мої заявки ---------- */
function usePolling(fn, ms = 10000) {
  useFocusEffect(useCallback(() => { fn(); const id = setInterval(fn, ms); return () => clearInterval(id); }, [fn, ms]));
}
export function OrdersScreen({ navigation }) {
  const [orders, setOrders] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => api('GET', '/api/orders/my').then(o => { setOrders(o); setErr(''); }).catch(e => setErr(e.message)), []);
  usePolling(load);
  if (!orders) return err ? <Screen><Err>{err}</Err></Screen> : <Loading />;
  return (
    <Screen onRefresh={load}>
      {orders.length ? orders.map(o => <OrderCard key={o.id} o={o} onPress={() => navigation.navigate('Order', { id: o.id })} />)
        : <Empty>Заявок ще немає. Оберіть кондиціонер у каталозі або запишіться на безкоштовний огляд.</Empty>}
    </Screen>
  );
}
export function OrderCard({ o, onPress, forMaster }) {
  return (
    <Card onPress={onPress} testID={`order-${o.id}`}>
      <Row style={{ justifyContent: 'space-between' }}><T bold>№{o.id} · {KIND[o.kind]}{forMaster ? ' · ' + o.contactName : ''}</T><StatusPill status={o.status} /></Row>
      <Timeline status={o.status} />
      <T muted size={13}>{fmtSlot(o.startsAt)}–{o.endsAt.slice(11)}{forMaster ? ' · ' + o.address : o.master ? ' · ' + o.master.name : ''}</T>
      <T muted size={12} numberOfLines={1}>{o.items.length ? o.items.map(i => i.title.split(':')[0]).join(', ') : 'Безкоштовний огляд'}</T>
      {o.total ? <T mono style={{ alignSelf: 'flex-end' }}>{UAH(o.total)}</T> : null}
    </Card>
  );
}

/* ---------- Заявка клієнта ---------- */
export function OrderScreen({ route }) {
  const t = useTheme();
  const [o, setO] = useState(null); const [err, setErr] = useState(''); const [stars, setStars] = useState(5); const [text, setText] = useState('');
  const load = useCallback(() => api('GET', `/api/orders/${route.params.id}`).then(setO).catch(e => setErr(e.message)), [route.params.id]);
  usePolling(load, 8000);
  if (!o) return err ? <Screen><Err>{err}</Err></Screen> : <Loading />;
  const cancel = () => confirmAsk('Скасувати заявку?', 'Майстер не приїде.', async () => { try { setO(await api('PATCH', `/api/orders/${o.id}/status`, { status: 'cancelled' })); } catch (e) { setErr(e.message); } });
  const review = async () => { try { await api('POST', `/api/orders/${o.id}/review`, { stars, text, source: 'mobile' }); await load(); } catch (e) { setErr(e.message); } };
  return (
    <Screen>
      {route.params.fresh ? <Card style={{ backgroundColor: t.good + '22', borderColor: t.good }}><T bold color={t.good}>Заявку №{o.id} прийнято. Майстер підтвердить її найближчим часом.</T></Card> : null}
      <Row style={{ justifyContent: 'space-between' }}><T size={20} display>Заявка №{o.id}</T><StatusPill status={o.status} /></Row>
      <Timeline status={o.status} />
      <Card><T muted size={12}>КОЛИ</T><T bold>{fmtSlot(o.startsAt)}–{o.endsAt.slice(11)}</T><T muted size={12}>АДРЕСА</T><T>{o.address}</T></Card>
      {o.master ? (
        <Card>
          <Row><Avatar m={o.master} /><View style={{ flex: 1 }}><T bold>{o.master.name}</T><T muted mono size={13}>{o.master.phone}</T></View></Row>
          <Button kind="ghost" title="Подзвонити майстру" onPress={() => Linking.openURL('tel:' + o.master.phone)} />
        </Card>
      ) : null}
      <Card>
        {o.items.length ? o.items.map((i, k) => <Row key={k} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><T style={{ flex: 1 }} size={14}>{i.title}</T><T mono size={14}>{UAH(i.price)}</T></Row>) : <T>Безкоштовний огляд</T>}
        {o.total ? <Row style={{ justifyContent: 'space-between' }}><T bold>Разом</T><T mono color={t.heat}>{UAH(o.total)}</T></Row> : null}
      </Card>
      {o.masterNote ? <Card><T muted size={12}>КОМЕНТАР МАЙСТРА</T><T>{o.masterNote}</T></Card> : null}
      <Card><T muted size={12}>ІСТОРІЯ</T>{o.history.map((h, k) => <T key={k} size={13}>{new Date(h.at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {STATUS[h.to_status]}{h.actor ? ` · ${h.actor}` : ''}</T>)}</Card>
      {o.status === 'done' && !o.review ? (
        <Card>
          <T bold>Оцініть роботу</T>
          <Row>{[1, 2, 3, 4, 5].map(i => <Pressable key={i} onPress={() => setStars(i)}><T size={30} color={i <= stars ? t.star : t.line}>★</T></Pressable>)}</Row>
          <Field value={text} onChangeText={setText} placeholder="Як усе пройшло?" multiline />
          <Button title="Надіслати відгук" onPress={review} disabled={text.trim().length < 3} />
        </Card>
      ) : o.review ? <Card><T bold>Ваш відгук: {'★'.repeat(o.review.stars)}</T><T muted>{o.review.text}</T></Card> : null}
      <Err>{err}</Err>
      {o.next.includes('cancelled') ? <Button kind="danger" title="Скасувати заявку" onPress={cancel} /> : null}
    </Screen>
  );
}

/* ---------- Профіль (спільний) ---------- */
export function ProfileScreen() {
  const { user, logout, catalog } = useApp();
  const t = useTheme();
  return (
    <Screen>
      <Card><T size={18} display>{user.name}</T><T muted>{user.email}</T><T muted mono>{user.phone}</T></Card>
      <Card>
        <T bold>Контакти Smart Klima</T>
        <Row style={{ justifyContent: 'space-between' }}><T muted>Гаряча лінія</T><T mono>+38 (067) 000-24-24</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T muted>Графік</T><T>Пн–Сб 08:00–20:00</T></Row>
        <Button kind="ghost" title="Подзвонити" onPress={() => Linking.openURL('tel:+380670002424')} />
      </Card>
      {catalog ? <Card><T bold>Наші майстри</T>{catalog.masters.map(m => <Row key={m.id}><Avatar m={m} size={32} /><View style={{ flex: 1 }}><T>{m.name}</T><T muted size={12}>★ {dec(m.rating)} · {m.freeToday ? 'вільний сьогодні' : 'зайнятий сьогодні'}</T></View></Row>)}</Card> : null}
      <Button kind="danger" testID="logout" title="Вийти" onPress={logout} />
    </Screen>
  );
}
