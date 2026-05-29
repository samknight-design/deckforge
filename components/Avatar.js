import { getAvatar } from '@/lib/tiers';

// Renders a preset avatar (emoji on a coloured disc). Works in server or client.
export default function Avatar({ avatarKey, size = 48, ring }) {
  const a = getAvatar(avatarKey);
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: a.bg,
        fontSize: size * 0.5,
        lineHeight: 1,
        border: ring ? `2px solid ${ring}` : 'none',
      }}
    >
      {a.emoji}
    </div>
  );
}
