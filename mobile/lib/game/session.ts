// Join-session helpers: a short human-typable game code + the universal link the
// QR encodes. Multiplayer join (Realtime + scanning) is a later slice; for now
// this drives the host lobby's QR + pincode display.

// Ambiguity-free alphabet (no 0/O/1/I) for codes read aloud / typed at a table.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// Universal/app link a non-user can scan with their system camera. The web app
// will host /j/[code] as a deep-link landing + store fallback (later slice).
export function joinUrl(code: string): string {
  return `https://deckforge-eta.vercel.app/j/${code}`;
}
