// Вхід і реєстрація.
import React, { useState } from 'react';
import { View, KeyboardAvoidingView, Platform } from 'react-native';
import { useApp } from '../context';
import { Screen, Card, T, Button, Field, Err } from '../ui';
import { useTheme } from '../theme';

function Brand() {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 6, marginTop: 24, marginBottom: 8 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}><T size={30} color="#fff">❄</T></View>
      <T size={24} display>Smart Klima</T>
      <T muted>Кондиціонери з монтажем за 1 день</T>
    </View>
  );
}

export function LoginScreen({ navigation }) {
  const { login } = useApp();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await login(email.trim(), password); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Brand />
        <Card>
          <T size={18} display>Вхід</T>
          <Field testID="login-email" label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field testID="login-password" label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          <Err>{err}</Err>
          <Button testID="login-submit" title="Увійти" onPress={submit} loading={busy} />
        </Card>
        <Button kind="ghost" title="Немає акаунта? Зареєструватися" onPress={() => navigation.navigate('Register')} />
        <T muted size={12} style={{ textAlign: 'center' }}>Майстри входять з обліковим записом, який видав офіс.</T>
      </Screen>
    </KeyboardAvoidingView>
  );
}

export function RegisterScreen() {
  const { register } = useApp();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = k => v => setF(s => ({ ...s, [k]: v }));
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await register(f); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Card>
          <Field testID="reg-name" label="Ім'я" value={f.name} onChangeText={set('name')} autoComplete="name" />
          <Field testID="reg-email" label="E-mail" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
          <Field testID="reg-phone" label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+380 67 123 45 67" />
          <Field testID="reg-password" label="Пароль" value={f.password} onChangeText={set('password')} secureTextEntry placeholder="щонайменше 8 символів, літера і цифра" />
          <Err>{err}</Err>
          <Button testID="reg-submit" title="Створити акаунт" onPress={submit} loading={busy} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
