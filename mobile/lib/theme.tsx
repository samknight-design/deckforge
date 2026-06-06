import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'dark' | 'light';
export type Currency = 'EUR' | 'USD' | 'GBP';

export const DARK = {
  bg: '#0a0e1a',
  surface: '#111827',
  surfaceAlt: '#1a2235',
  border: '#1e2d47',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  textDim: '#475569',
  accent: '#f59e0b',
  accentText: '#0a0e1a',
  success: '#10b981',
  danger: '#ef4444',
  info: '#3b82f6',
  purple: '#7c3aed',
  overlay: 'rgba(0,0,0,0.78)',
};

export const LIGHT = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#475569',
  textDim: '#94a3b8',
  accent: '#d97706',
  accentText: '#ffffff',
  success: '#059669',
  danger: '#dc2626',
  info: '#2563eb',
  purple: '#7c3aed',
  overlay: 'rgba(0,0,0,0.5)',
};

export type Colors = typeof DARK;

interface ThemeCtx {
  theme: ThemeMode;
  currency: Currency;
  colors: Colors;
  setTheme: (t: ThemeMode) => void;
  setCurrency: (c: Currency) => void;
  formatPrice: (eur: number | null | undefined) => string;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'dark',
  currency: 'EUR',
  colors: DARK,
  setTheme: () => {},
  setCurrency: () => {},
  formatPrice: () => '—',
});

const EUR_TO_USD = 1.08;
const EUR_TO_GBP = 0.86;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [currency, setCurrencyState] = useState<Currency>('EUR');

  useEffect(() => {
    SecureStore.getItemAsync('df_theme').then((v) => {
      if (v === 'dark' || v === 'light') setThemeState(v);
    });
    SecureStore.getItemAsync('df_currency').then((v) => {
      if (v === 'EUR' || v === 'USD' || v === 'GBP') setCurrencyState(v);
    });
  }, []);

  const setTheme = (t: ThemeMode) => {
    setThemeState(t);
    SecureStore.setItemAsync('df_theme', t).catch(() => {});
  };

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    SecureStore.setItemAsync('df_currency', c).catch(() => {});
  };

  const colors = theme === 'dark' ? DARK : LIGHT;

  const formatPrice = (eur: number | null | undefined): string => {
    if (eur == null) return '—';
    if (currency === 'USD') return `$${(eur * EUR_TO_USD).toFixed(2)}`;
    if (currency === 'GBP') return `£${(eur * EUR_TO_GBP).toFixed(2)}`;
    return `€${eur.toFixed(2)}`;
  };

  const value = useMemo(
    () => ({ theme, currency, colors, setTheme, setCurrency, formatPrice }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, currency],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// XP → level mapping: level N costs N×100 XP
export function xpToLevel(xp: number): { level: number; progress: number; needed: number } {
  let level = 1;
  let total = 0;
  while (level <= 99) {
    const needed = level * 100;
    if (xp < total + needed) return { level, progress: xp - total, needed };
    total += needed;
    level++;
  }
  return { level: 100, progress: 0, needed: 1 };
}

export const BRACKET_NAMES: Record<number, string> = {
  1: 'Casual',
  2: 'Focused',
  3: 'Optimised',
  4: 'High Power',
  5: 'cEDH',
};

export const BRACKET_COLORS: Record<number, string> = {
  1: '#10b981',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#f97316',
  5: '#ef4444',
};
