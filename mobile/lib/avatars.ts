// Avatar options (emoji by key — placeholder until real SVG avatars land). Shared by the
// Home, Onboarding and Profile screens. Lives here (not exported from a screen) so screens
// don't import each other.
export const AVATAR_OPTIONS = [
  { key: 'wizard',   emoji: '🧙' },
  { key: 'dragon',   emoji: '🐉' },
  { key: 'knight',   emoji: '⚔️' },
  { key: 'mystic',   emoji: '🔮' },
  { key: 'eagle',    emoji: '🦅' },
  { key: 'moon',     emoji: '🌙' },
  { key: 'comet',    emoji: '☄️' },
  { key: 'castle',   emoji: '🏰' },
  { key: 'wave',     emoji: '🌊' },
  { key: 'storm',    emoji: '⚡' },
  { key: 'flame',    emoji: '🔥' },
  { key: 'forest',   emoji: '🌿' },
];

// Resolve an avatar key to its emoji, falling back to a provided initial (e.g. username[0]).
export function getAvatarEmoji(key?: string | null, fallback = 'U'): string {
  const found = AVATAR_OPTIONS.find((a) => a.key === key);
  return found ? found.emoji : fallback;
}
