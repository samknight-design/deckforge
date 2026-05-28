'use client';

import Link from 'next/link';

export default function AnonBanner() {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 gap-3"
      style={{ background: 'rgba(124,58,237,0.12)', borderBottom: '1px solid rgba(124,58,237,0.25)' }}
    >
      <p className="text-xs" style={{ color: '#c4b5fd' }}>
        💾 Guest session — your decks live on this device only
      </p>
      <Link
        href="/login?convert=true"
        className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-95"
        style={{ background: 'rgba(124,58,237,0.3)', color: '#e9d5ff', border: '1px solid rgba(124,58,237,0.4)' }}
      >
        Save →
      </Link>
    </div>
  );
}
