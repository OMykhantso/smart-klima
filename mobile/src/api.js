// Клієнт REST API: токени в SecureStore, автоматичне оновлення access-токена.
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3000').replace(/\/$/, '');

// SecureStore працює на iOS/Android; у веб-збірці (для перегляду в браузері) — localStorage.
const store = Platform.OS === 'web'
  ? { get: async k => { try { return localStorage.getItem(k); } catch { return null; } }, set: async (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } }
  : { get: k => SecureStore.getItemAsync(k), set: (k, v) => (v == null ? SecureStore.deleteItemAsync(k) : SecureStore.setItemAsync(k, v)) };

let session = null;          // { accessToken, refreshToken, user }
let onLogout = () => {};
export const setLogoutHandler = fn => { onLogout = fn; };

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function loadSession() {
  const raw = await store.get('sk_session');
  session = raw ? JSON.parse(raw) : null;
  return session;
}
async function saveSession(s) { session = s; await store.set('sk_session', s ? JSON.stringify(s) : null); }

async function raw(method, path, body, token) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Немає зв\'язку з сервером. Перевірте інтернет');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error?.code, data.error?.message || 'Помилка ' + res.status);
  return data;
}

let refreshing = null;
async function refresh() {
  if (!session?.refreshToken) throw new ApiError(401, 'NO_SESSION', 'Увійдіть');
  refreshing = refreshing || raw('POST', '/api/auth/refresh', { refreshToken: session.refreshToken })
    .then(r => saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user }))
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** Запит з токеном; при 401 один раз оновлює токен і повторює. */
export async function api(method, path, body) {
  try {
    return await raw(method, path, body, session?.accessToken);
  } catch (e) {
    if (e.status !== 401 || !session) throw e;
    try { await refresh(); } catch { await saveSession(null); onLogout(); throw new ApiError(401, 'SESSION_EXPIRED', 'Сесія завершилась. Увійдіть знову'); }
    return raw(method, path, body, session.accessToken);
  }
}

export async function login(email, password) {
  const r = await raw('POST', '/api/auth/login', { email, password });
  await saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
  return r.user;
}
export async function register(data) {
  const r = await raw('POST', '/api/auth/register', data);
  await saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
  return r.user;
}
export async function logout() {
  if (session?.refreshToken) raw('POST', '/api/auth/logout', { refreshToken: session.refreshToken }).catch(() => {});
  await saveSession(null);
}
export const currentUser = () => session?.user || null;
