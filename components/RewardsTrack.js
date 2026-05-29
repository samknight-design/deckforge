'use client';

import { useRouter } from 'next/navigation';
import { xpForLevel, levelFromXp, levelProgress, levelRewards } from '@/lib/tiers';

const MAX_LEVEL = 30;

export default function RewardsTrack({ xp }) {
  const router = useRouter();
  const current = levelFromXp(xp);
  const lp = levelProgress(xp);
  const levels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

  return (
    <div className="h-full overflow-y-auto scroll-y" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="px-4 pt-5 pb-4" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center rounded-xl mb-3"
          style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
        >
          ←
        </button>
        <h1 className="text-xl font-bold text-white">Rewards Track</h1>
        <p className="text-xs mb-3" style={{ color: '#64748b' }}>Earn XP from scans, insights, likes and challenges to climb levels and unlock credits.</p>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-bold" style={{ color: '#a78bfa' }}>Level {current}</span>
          <span style={{ color: '#64748b' }}>{lp.into} / {lp.span} XP to level {current + 1}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (lp.into / lp.span) * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#f59e0b)' }} />
        </div>
      </div>

      {/* Track */}
      <div className="px-4 py-4">
        {levels.map((L) => {
          const reward = levelRewards(L);
          const unlocked = current >= L;
          const isCurrent = current === L;
          const tone = isCurrent ? '#f59e0b' : unlocked ? '#10b981' : '#334155';
          return (
            <div key={L} className="flex items-stretch gap-3">
              {/* Rail + node */}
              <div className="flex flex-col items-center" style={{ width: 40 }}>
                <div className="w-px flex-1" style={{ background: L === 1 ? 'transparent' : (unlocked ? '#10b981' : '#1e2d47') }} />
                <div
                  className="flex items-center justify-center rounded-full font-bold flex-shrink-0"
                  style={{ width: 34, height: 34, fontSize: 13, background: isCurrent ? tone : '#111827', color: isCurrent ? '#0a0e1a' : tone, border: `2px solid ${tone}` }}
                >
                  {unlocked && !isCurrent ? '✓' : L}
                </div>
                <div className="w-px flex-1" style={{ background: L === MAX_LEVEL ? 'transparent' : (current >= L + 1 ? '#10b981' : '#1e2d47') }} />
              </div>

              {/* Reward card */}
              <div
                className="flex-1 my-1 rounded-xl px-3 py-2.5 flex items-center justify-between"
                style={{
                  background: isCurrent ? 'rgba(245,158,11,0.1)' : '#111827',
                  border: `1px solid ${isCurrent ? 'rgba(245,158,11,0.4)' : '#1e2d47'}`,
                  opacity: unlocked || isCurrent ? 1 : 0.7,
                }}
              >
                <div>
                  <div className="text-sm font-semibold" style={{ color: unlocked ? '#f1f5f9' : '#94a3b8' }}>
                    Level {L}{L === 1 ? ' · Start' : ''}
                  </div>
                  <div className="text-xs" style={{ color: '#64748b' }}>
                    {L === 1 ? 'Begin your journey' : `${reward.scan} scan credits${reward.insight ? ` + ${reward.insight} insights` : ''}`}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {L > 1 && (
                    <div className="text-xs font-semibold" style={{ color: unlocked ? '#10b981' : '#64748b' }}>
                      {unlocked ? 'Unlocked' : `${xpForLevel(L)} XP`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
