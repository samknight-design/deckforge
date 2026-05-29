'use client';

import { useState } from 'react';
import { showReward } from './RewardToast';

export default function LikeButton({ deckId, initialLiked = false, initialCount = 0, size = 'md' }) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prevLiked = liked;
    const prevCount = count;
    // optimistic
    setLiked(!prevLiked);
    setCount(prevCount + (prevLiked ? -1 : 1));
    try {
      const res = await fetch('/api/decks/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId }),
      });
      const data = await res.json();
      if (res.ok) {
        setLiked(data.liked);
        setCount(data.like_count);
        showReward(data.rewards);
      } else {
        setLiked(prevLiked);
        setCount(prevCount);
      }
    } catch {
      setLiked(prevLiked);
      setCount(prevCount);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2.5 text-sm';

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-xl font-semibold transition-all active:scale-95 ${pad}`}
      style={{
        background: liked ? 'rgba(245,158,11,0.18)' : '#1a2235',
        border: `1px solid ${liked ? '#f59e0b' : '#1e2d47'}`,
        color: liked ? '#f59e0b' : '#94a3b8',
        minHeight: size === 'sm' ? 28 : 44,
      }}
      title={liked ? 'Remove like' : 'Like this deck'}
    >
      <span>{liked ? '👍' : '🤍'}</span>
      <span>{count}</span>
    </button>
  );
}
