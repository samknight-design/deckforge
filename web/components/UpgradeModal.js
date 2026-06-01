'use client';

import { useState } from 'react';

const FEATURES = [
  { icon: '🔬', text: 'Unlimited card scans' },
  { icon: '🃏', text: 'Unlimited decks' },
  { icon: '✨', text: 'AI deck insights powered by Claude' },
  { icon: '🔗', text: 'Public deck sharing links' },
  { icon: '📊', text: 'Advanced deck statistics' },
];

export default function UpgradeModal({ onClose }) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start checkout');
        setLoading(false);
      }
    } catch {
      alert('Failed to start checkout');
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 backdrop"
        onClick={onClose}
        style={{ zIndex: 400 }}
      />
      <div
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl overflow-hidden sheet-enter"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 410, maxWidth: 400, margin: '0 auto' }}
      >
        {/* Header gradient */}
        <div
          className="px-5 pt-6 pb-5 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(245,158,11,0.2) 100%)' }}
        >
          <div className="text-4xl mb-2">⚡</div>
          <h2 className="text-xl font-bold text-text-primary">Upgrade to Pro</h2>
          <div className="mt-2">
            <span className="text-3xl font-bold" style={{ color: '#f59e0b' }}>£3.99</span>
            <span className="text-text-secondary text-sm">/month</span>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="space-y-3 mb-5">
            {FEATURES.map((f) => (
              <div key={f.text} className="flex items-center gap-3">
                <span className="text-lg">{f.icon}</span>
                <span className="text-sm text-text-primary">{f.text}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full rounded-xl py-3.5 text-sm font-bold mb-3 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #f59e0b)', color: '#fff', minHeight: 48 }}
          >
            {loading ? 'Loading…' : '⚡ Upgrade to Pro'}
          </button>

          <button
            onClick={onClose}
            className="w-full rounded-xl py-3 text-sm font-medium"
            style={{ background: 'transparent', color: '#94a3b8', minHeight: 44 }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}
