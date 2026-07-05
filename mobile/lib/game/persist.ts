// Local persistence for the in-progress game (Lotus-style resume). Writes the
// board snapshot to a JSON file in the app's document directory; only the live
// game lives here — final results / stats go to Supabase in a later slice.
// Uses the SDK 54 synchronous File API.

import { File, Paths } from 'expo-file-system';
import { normalizeSeat, type GameConfig, type Seat } from './formats';

export type SavedGame = {
  config: GameConfig;
  seats: Seat[];
  layoutId: string;
  savedAt: number;
};

const FILENAME = 'active-game.json';
const file = () => new File(Paths.document, FILENAME);

export function saveGame(snapshot: Omit<SavedGame, 'savedAt'>): void {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    // best-effort; resume is a convenience, never block play on it
  }
}

export function loadGame(): SavedGame | null {
  try {
    const f = file();
    if (!f.exists) return null;
    const data = JSON.parse(f.textSync()) as SavedGame;
    if (!data?.seats?.length || !data?.config) return null;
    // Migrate seats saved by an older build to the current shape.
    return { ...data, seats: data.seats.map((s, i) => normalizeSeat(s, i)) };
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
