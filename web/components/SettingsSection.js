'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { showToast } from './Toast';
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY } from '@/lib/currency';
import { getTheme, getCurrency, setTheme, setCurrency } from '@/lib/prefs';

const APP_VERSION = '1.2.0';

// Tucked away in the profile — settings, info pages, theme + currency.
export default function SettingsSection({ userId, savedCurrency, savedTheme }) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState(savedTheme || 'dark');
  const [currency, setCurrencyState] = useState(savedCurrency || DEFAULT_CURRENCY);
  const supabase = createClient();
  const router = useRouter();

  // Re-sync from the cookie on mount in case the server's value was stale.
  useEffect(() => {
    const t = getTheme();
    const c = getCurrency();
    if (t !== theme) setThemeState(t);
    if (c !== currency) setCurrencyState(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTheme = async (next) => {
    setThemeState(next);
    setTheme(next);
    if (userId) await supabase.from('profiles').update({ theme: next }).eq('id', userId);
  };

  const changeCurrency = async (next) => {
    setCurrencyState(next);
    setCurrency(next);
    if (userId) await supabase.from('profiles').update({ currency: next }).eq('id', userId);
    showToast(`Currency set to ${next}`, 'success');
    // router.refresh() re-renders the server tree in place — preserves scroll
    // position (a full window.location.reload() would jump to the top).
    router.refresh();
  };

  const rateUrl = process.env.NEXT_PUBLIC_RATE_URL || '';

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
      <button
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
        style={{ color: '#94a3b8', minHeight: 44 }}
      >
        <span>⚙️ Settings & About</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid #1e2d47' }}>
          {/* Theme */}
          <div className="rounded-xl p-3" style={{ background: '#0d1424', border: '1px solid #1e2d47' }}>
            <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>APPEARANCE</div>
            <div className="text-sm font-medium text-white mb-2">Theme <span className="text-xs ml-1" style={{ color: '#a78bfa' }}>(light is preview)</span></div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'dark', label: '🌙 Dark' },
                { v: 'light', label: '☀️ Light' },
              ].map((t) => (
                <button
                  key={t.v}
                  onClick={() => changeTheme(t.v)}
                  className="rounded-lg py-2 text-sm font-medium"
                  style={{
                    background: theme === t.v ? 'rgba(245,158,11,0.15)' : '#1a2235',
                    border: `1px solid ${theme === t.v ? '#f59e0b' : '#1e2d47'}`,
                    color: theme === t.v ? '#f59e0b' : '#94a3b8',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Currency */}
          <div className="rounded-xl p-3" style={{ background: '#0d1424', border: '1px solid #1e2d47' }}>
            <div className="text-xs font-semibold mb-2" style={{ color: '#64748b' }}>CURRENCY</div>
            <div className="grid grid-cols-3 gap-2">
              {CURRENCY_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => changeCurrency(c.key)}
                  className="rounded-lg py-2 text-sm font-medium"
                  style={{
                    background: currency === c.key ? 'rgba(245,158,11,0.15)' : '#1a2235',
                    border: `1px solid ${currency === c.key ? '#f59e0b' : '#1e2d47'}`,
                    color: currency === c.key ? '#f59e0b' : '#94a3b8',
                  }}
                  title={c.label}
                >
                  {c.symbol} {c.key}
                </button>
              ))}
            </div>
          </div>

          {/* Info pages */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#0d1424', border: '1px solid #1e2d47' }}>
            <Link href="/about" className="flex items-center justify-between px-3 py-3 text-sm" style={{ color: '#cbd5e1', borderBottom: '1px solid #1e2d47' }}>
              <span>ℹ️ About DeckForge</span><span style={{ color: '#475569' }}>›</span>
            </Link>
            <Link href="/privacy" className="flex items-center justify-between px-3 py-3 text-sm" style={{ color: '#cbd5e1', borderBottom: '1px solid #1e2d47' }}>
              <span>🔐 Privacy</span><span style={{ color: '#475569' }}>›</span>
            </Link>
            <a
              href={rateUrl || '#'}
              target={rateUrl ? '_blank' : undefined}
              rel="noopener noreferrer"
              onClick={(e) => { if (!rateUrl) { e.preventDefault(); showToast('Rating link coming soon', 'success'); } }}
              className="flex items-center justify-between px-3 py-3 text-sm"
              style={{ color: '#cbd5e1', borderBottom: '1px solid #1e2d47' }}
            >
              <span>⭐ Rate the app</span><span style={{ color: '#475569' }}>{rateUrl ? '↗' : '›'}</span>
            </a>
            <a
              href="mailto:feedback@deckforge.app?subject=DeckForge%20feedback"
              className="flex items-center justify-between px-3 py-3 text-sm"
              style={{ color: '#cbd5e1', borderBottom: '1px solid #1e2d47' }}
            >
              <span>💬 Send feedback</span><span style={{ color: '#475569' }}>↗</span>
            </a>
            <a
              href="mailto:bugs@deckforge.app?subject=Bug%20report"
              className="flex items-center justify-between px-3 py-3 text-sm"
              style={{ color: '#cbd5e1', borderBottom: '1px solid #1e2d47' }}
            >
              <span>🐞 Report a bug</span><span style={{ color: '#475569' }}>↗</span>
            </a>
            <a
              href="mailto:ideas@deckforge.app?subject=Feature%20request"
              className="flex items-center justify-between px-3 py-3 text-sm"
              style={{ color: '#cbd5e1' }}
            >
              <span>✨ Request a feature</span><span style={{ color: '#475569' }}>↗</span>
            </a>
          </div>

          <p className="text-xs text-center pt-1" style={{ color: '#475569' }}>DeckForge v{APP_VERSION}</p>
        </div>
      )}
    </div>
  );
}
