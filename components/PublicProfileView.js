'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';
import { TIERS, levelProgress, ACHIEVEMENTS } from '@/lib/tiers';

export default function PublicProfileView({ profile, publicDecks, totalLikes, achievementKeys }) {
  const router = useRouter();
  const tierCfg = TIERS[profile.tier] || TIERS.free;
  const lvl = levelProgress(profile.xp || 0);
  const haveAch = new Set(achievementKeys || []);
  const unlocked = ACHIEVEMENTS.filter((a) => haveAch.has(a.key));
  const memberSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null;

  return (
    <div className="h-full overflow-y-auto scroll-y" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="px-4 pt-5 pb-5" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center rounded-xl mb-4"
          style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
        >
          ←
        </button>
        <div className="flex items-center gap-4">
          <Avatar avatarKey={profile.avatar_key} size={72} ring={tierCfg.color} />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{profile.username}</h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold rounded-full px-2.5 py-1" style={{ background: `${tierCfg.color}22`, color: tierCfg.color, border: `1px solid ${tierCfg.color}55` }}>
                {tierCfg.icon} {tierCfg.name}
              </span>
              <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>Level {lvl.level}</span>
              {memberSince && <span className="text-xs" style={{ color: '#64748b' }}>· since {memberSince}</span>}
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: 'Likes', value: totalLikes, color: '#fbbf24' },
            { label: 'Public decks', value: publicDecks.length, color: '#f1f5f9' },
            { label: 'Achievements', value: unlocked.length, color: '#10b981' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-2.5 text-center" style={{ background: '#0d1424', border: '1px solid #1e2d47' }}>
              <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs" style={{ color: '#64748b' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* Achievements */}
        {unlocked.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-2">Achievements</h3>
            <div className="grid grid-cols-3 gap-2">
              {unlocked.map((a) => (
                <div key={a.key} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
                  <div className="text-2xl mb-1">{a.icon}</div>
                  <div className="text-xs font-semibold text-white">{a.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public decks */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Public decks</h3>
          {publicDecks.length === 0 ? (
            <div className="rounded-xl p-4 text-center" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>No public decks.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {publicDecks.map((d) => (
                  <Link key={d.id} href={`/community/${d.id}`} className="block">
                    <div className="relative rounded-2xl overflow-hidden" style={{ minHeight: 110 }}>
                      {d.commander_image_url && <img src={d.commander_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 15%' }} />}
                      <div className="absolute inset-0" style={{ background: d.commander_image_url ? 'linear-gradient(160deg, rgba(10,14,26,0.2), rgba(10,14,26,0.95))' : '#0d1424', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }} />
                      <div className="relative z-10 p-2.5 flex flex-col h-full justify-between" style={{ minHeight: 110 }}>
                        <div className="flex justify-end">
                          <span className="text-xs font-semibold rounded-full px-1.5 py-0.5 backdrop-blur" style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>👍 {d.like_count || 0}</span>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white truncate drop-shadow">{d.name}</div>
                          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{d.format === 'commander' ? 'Commander' : '60-Card'}{d.bracket ? ` · B${d.bracket}` : ''}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
