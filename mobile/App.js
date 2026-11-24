// Smart Klima: мобільний застосунок (React Native, Expo). Навігація за роллю користувача.
import React from 'react';
import { Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/context';
import { useTheme } from './src/theme';
import { Loading } from './src/ui';
import { LoginScreen, RegisterScreen } from './src/screens/AuthScreens';
import { CatalogScreen, ProductScreen, CalcScreen, BookingScreen, OrdersScreen, OrderScreen, ProfileScreen } from './src/screens/ClientScreens';
import { ScheduleScreen, MasterOrderScreen, MasterProfileScreen, AdminHomeScreen } from './src/screens/MasterScreens';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const icon = ch => ({ color }) => <Text style={{ color, fontSize: 20 }}>{ch}</Text>;

function stack(screens) {
  return function S() {
    return <Stack.Navigator>{screens.map(([name, comp, title]) => <Stack.Screen key={name} name={name} component={comp} options={{ title }} />)}</Stack.Navigator>;
  };
}
const CatalogStack = stack([['Catalog', CatalogScreen, 'Каталог'], ['Product', ProductScreen, 'Модель']]);
const CalcStack = stack([['Calc', CalcScreen, 'Підбір потужності']]);
const BookingStack = stack([['Booking', BookingScreen, 'Запис на виїзд']]);
const OrdersStack = stack([['Orders', OrdersScreen, 'Мої заявки'], ['Order', OrderScreen, 'Заявка']]);
const ProfileStack = stack([['Profile', ProfileScreen, 'Профіль']]);
const ScheduleStack = stack([['Schedule', ScheduleScreen, 'Мій розклад'], ['MasterOrder', MasterOrderScreen, 'Заявка']]);
const MasterProfileStack = stack([['MasterProfile', MasterProfileScreen, 'Профіль']]);
const AdminStack = stack([['AdminHome', AdminHomeScreen, 'Smart Klima']]);

function Tabs({ items }) {
  const t = useTheme();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, tabBarInactiveTintColor: t.muted, tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line } }}>
      {items.map(([name, comp, label, ch]) => <Tab.Screen key={name} name={name} component={comp} options={{ title: label, tabBarIcon: icon(ch), tabBarButtonTestID: 'tab-' + name }} />)}
    </Tab.Navigator>
  );
}

function Root() {
  const { user } = useApp();
  const t = useTheme();
  if (user === undefined) return <Loading />;
  if (!user) return (
    <Stack.Navigator>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Реєстрація' }} />
    </Stack.Navigator>
  );
  if (user.role === 'master') return <Tabs items={[['ScheduleTab', ScheduleStack, 'Розклад', '🗓'], ['MasterProfileTab', MasterProfileStack, 'Профіль', '☰']]} />;
  if (user.role === 'admin') return <Tabs items={[['AdminTab', AdminStack, 'Огляд', '📊'], ['CatalogTab', CatalogStack, 'Каталог', '❄']]} />;
  return <Tabs items={[['CatalogTab', CatalogStack, 'Каталог', '❄'], ['CalcTab', CalcStack, 'Підбір', '⌗'], ['BookingTab', BookingStack, 'Запис', '＋'], ['OrdersTab', OrdersStack, 'Заявки', '🧾'], ['ProfileTab', ProfileStack, 'Профіль', '☰']]} />;
}

function Themed() {
  const t = useTheme();
  const base = t.bg === '#0c161d' ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer theme={{ ...base, colors: { ...base.colors, primary: t.accent, background: t.bg, card: t.surface, text: t.ink, border: t.line } }}>
      <StatusBar style="auto" />
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return <SafeAreaProvider><AppProvider><Themed /></AppProvider></SafeAreaProvider>;
}
