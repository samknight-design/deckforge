'use client';

import { useState, useEffect, useCallback } from 'react';

let pushFn = null;

// Call after any gamified action with the API's `rewards` payload. Only shows a
// notification for meaningful events (level-up / achievement / challenge) — not
// the per-action XP trickle, so it stays unobtrusive.
export function showReward(rewards) {
  if (!rewards || !pushFn) return;
  const items = [];

  if (rewards.leveledTo) {
    const bits = [];
    if (rewards.scanCredits) bits.push(`+${rewards.scanCredits} scans`);
    if (rewards.insightCredits) bits.push(`+${rewards.insightCredits} insights`);
    items.push({ icon: '⬆️', title: `Level ${rewards.leveledTo}!`, sub: bits.join(' · ') || 'Keep it up', tone: '#a855f7' });
  }
  (rewards.challenges || []).forEach((c) => {
    items.push({ icon: '✅', title: 'Challenge complete', sub: `${c.name} · +${c.xp} XP`, tone: '#10b981' });
  });
  (rewards.achievements || []).forEach((a) => {
    items.push({ icon: a.icon || '🏆', title: a.name, sub: `Achievement · +${a.xp} XP`, tone: '#f59e0b' });
  });

  items.forEach((it, i) => setTimeout(() => pushFn(it), i * 350));
}

export default function RewardToast() {
  const [items, setItems] = useState([]);

  const push = useCallback((item) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { ...item, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    pushFn = push;
    return () => { pushFn = null; };
  }, [push]);

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
        width: 'max-content',
        maxWidth: '90vw',
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          className="reward-enter"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#111827',
            border: `1px solid ${it.tone}`,
            borderRadius: 14,
            padding: '8px 14px 8px 10px',
            boxShadow: `0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px ${it.tone}22`,
          }}
        >
          <span
            style={{
              fontSize: 20,
              width: 34, height: 34,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 10,
              background: `${it.tone}22`,
            }}
          >
            {it.icon}
          </span>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13 }}>{it.title}</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>{it.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
