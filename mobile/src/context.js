// Глобальний стан: користувач, каталог, кошик для запису.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, loadSession, login as apiLogin, register as apiRegister, logout as apiLogout, setLogoutHandler } from './api';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined);      // undefined — ще завантажується
  const [catalog, setCatalog] = useState(null);
  const [cart, setCart] = useState({ products: [], services: [] }); // products: [{id, qty}]

  useEffect(() => {
    setLogoutHandler(() => setUser(null));
    loadSession().then(s => setUser(s?.user || null));
  }, []);

  const reloadCatalog = useCallback(() => api('GET', '/api/catalog').then(setCatalog).catch(() => {}), []);
  useEffect(() => { reloadCatalog(); }, [reloadCatalog]);

  const value = {
    user, catalog, reloadCatalog,
    login: async (e, p) => setUser(await apiLogin(e, p)),
    register: async d => setUser(await apiRegister(d)),
    logout: async () => { await apiLogout(); setUser(null); setCart({ products: [], services: [] }); },
    cart,
    addProduct: id => setCart(c => c.products.some(p => p.id === id) ? c : { ...c, products: [...c.products, { id, qty: 1 }] }),
    setQty: (id, qty) => setCart(c => ({ ...c, products: qty < 1 ? c.products.filter(p => p.id !== id) : c.products.map(p => p.id === id ? { ...p, qty: Math.min(5, qty) } : p) })),
    toggleService: id => setCart(c => ({ ...c, services: c.services.includes(id) ? c.services.filter(s => s !== id) : [...c.services, id] })),
    clearCart: () => setCart({ products: [], services: [] }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
