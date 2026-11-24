// Спільні компоненти інтерфейсу.
import React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useTheme, STATUS, STEPS, statusColor } from './theme';

export const fonts = { display: { fontWeight: '800', letterSpacing: -0.3 }, mono: { fontVariant: ['tabular-nums'], fontWeight: '700' } };

export function Screen({ children, refreshing, onRefresh, pad = true }) {
  const t = useTheme();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={pad ? { padding: 16, gap: 12, paddingBottom: 32 } : null}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress, testID }) {
  const t = useTheme();
  const st = [{ backgroundColor: t.surface, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 16, padding: 14, gap: 8 }, style];
  return onPress ? <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [...st, pressed && { opacity: 0.7 }]}>{children}</Pressable> : <View style={st}>{children}</View>;
}

export function T({ children, style, muted, size = 15, bold, mono, display, numberOfLines, color }) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: color || (muted ? t.muted : t.ink), fontSize: size, lineHeight: Math.round(size * 1.4) },
      bold && { fontWeight: '700' }, mono && fonts.mono, display && fonts.display, style]}>{children}</Text>
  );
}

export function Button({ title, onPress, kind = 'primary', disabled, loading, testID, style }) {
  const t = useTheme();
  const bg = { primary: t.accent, heat: t.heat, good: t.good, ghost: t.surface2, danger: 'transparent' }[kind];
  const fg = { primary: t.accentInk, heat: '#fff', good: '#fff', ghost: t.ink, danger: t.heat }[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'danger' && { borderWidth: 1.5, borderColor: t.heat }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '800', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T size={13} bold>{label}</T> : null}
      <TextInput placeholderTextColor={t.muted} {...props}
        style={[{ borderWidth: 1, borderColor: error ? t.heat : t.line, backgroundColor: t.bg, color: t.ink, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15 }, props.multiline && { minHeight: 70, textAlignVertical: 'top' }]} />
    </View>
  );
}

export function Chips({ items, value, onChange, testIDPrefix }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map(([k, label]) => {
        const on = value === k;
        return (
          <Pressable key={k} testID={testIDPrefix ? `${testIDPrefix}-${k}` : undefined} onPress={() => onChange(k)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface }}>
            <Text style={{ color: on ? t.bg : t.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Seg({ items, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: 'hidden' }}>
      {items.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: value === k ? t.accent : t.bg }}>
          <Text style={{ color: value === k ? t.accentInk : t.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StatusPill({ status }) {
  const t = useTheme(); const c = statusColor(t, status);
  return <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: c + '22' }}><Text style={{ color: c, fontWeight: '800', fontSize: 12 }}>{STATUS[status]}</Text></View>;
}

export function Timeline({ status }) {
  const t = useTheme(); const i = STEPS.indexOf(status);
  if (status === 'cancelled') return null;
  return <View style={{ flexDirection: 'row', gap: 4 }}>{STEPS.map((s, k) => <View key={s} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: k <= i ? t.accent : t.surface2 }} />)}</View>;
}

export function Avatar({ m, size = 40 }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: m?.color || '#888', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>{m?.short || '?'}</Text></View>;
}

export const Row = ({ children, style }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]}>{children}</View>;
export const Err = ({ children }) => { const t = useTheme(); return children ? <Text style={{ color: t.heat, fontWeight: '600' }}>{children}</Text> : null; };
export const Empty = ({ children }) => { const t = useTheme(); return <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 24 }}><Text style={{ color: t.muted, textAlign: 'center' }}>{children}</Text></View>; };
export const Loading = () => { const t = useTheme(); return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 40 }}><ActivityIndicator color={t.accent} size="large" /></View>; };

export function UnitThumb({ p, big }) {
  const t = useTheme();
  return (
    <View style={{ width: big ? '100%' : 72, height: big ? 150 : 56, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: big ? '70%' : 52, height: big ? 52 : 20, borderRadius: big ? 12 : 6, backgroundColor: p.dark ? '#2f363b' : '#f4f7f9', borderWidth: 1, borderColor: p.dark ? '#1b1f22' : '#c9d4db' }}>
        <View style={{ position: 'absolute', right: big ? 14 : 5, top: big ? 10 : 4, width: big ? 7 : 4, height: big ? 7 : 4, borderRadius: 4, backgroundColor: p.color }} />
      </View>
    </View>
  );
}
