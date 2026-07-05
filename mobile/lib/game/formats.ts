// Game-tracker configuration: supported formats and the shared types used by
// the Play flow (chooser → setup → board). See docs/GAME_TRACKER.md for the
// full feature spec. This is phase RN6 — single-device first; Realtime
// companions, QR join, counters and stat write-back layer on later.

import type { Deck } from '../db';

export type GameFormat = 'commander' | 'standard' | 'twoHeadedGiant' | 'custom';

export type FormatDef = {
  id: GameFormat;
  label: string;
  short: string;
  defaultLife: number;
  minPlayers: number;
  maxPlayers: number;
  hasCommanderDamage: boolean;
  /** seats are grouped into teams sharing one life total */
  teams?: boolean;
  blurb: string;
};

export const FORMATS: Record<GameFormat, FormatDef> = {
  commander: {
    id: 'commander',
    label: 'Commander',
    short: 'EDH',
    defaultLife: 40,
    minPlayers: 2,
    maxPlayers: 8,
    hasCommanderDamage: true,
    blurb: '40 life · multiplayer pods',
  },
  standard: {
    id: 'standard',
    label: 'Standard 1v1',
    short: '1v1',
    defaultLife: 20,
    minPlayers: 2,
    maxPlayers: 2,
    hasCommanderDamage: false,
    blurb: '20 life · duel',
  },
  twoHeadedGiant: {
    id: 'twoHeadedGiant',
    label: 'Two-Headed Giant',
    short: '2HG',
    defaultLife: 30,
    minPlayers: 4,
    maxPlayers: 4,
    hasCommanderDamage: true,
    teams: true,
    blurb: '30 shared life · teams of 2',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    short: 'Custom',
    defaultLife: 20,
    minPlayers: 2,
    maxPlayers: 8,
    hasCommanderDamage: false,
    blurb: 'Pick any starting life',
  },
};

export const FORMAT_ORDER: GameFormat[] = ['commander', 'standard', 'twoHeadedGiant', 'custom'];

// What the setup screen hands the board.
export type GameConfig = {
  format: GameFormat;
  playerCount: number;
  startingLife: number;
  hostDeck: Deck | null;
};

export type Counters = { poison: number; energy: number; experience: number };
export type CustomCounter = { id: string; label: string; value: number };

// Passable table tokens. Monarch / the Initiative are exclusive (only one
// player holds each); City's Blessing is per-player; Day/Night is global.
export type SeatStatus = {
  monarch: boolean;
  initiative: boolean;
  cityBlessing: boolean;
};

// Commander damage from a single source is lethal at this threshold.
export const CMD_DAMAGE_LETHAL = 21;

// Poison is lethal at this many counters.
export const POISON_LETHAL = 10;

// A single player's live state on the board. Position + facing come from the
// active layout (see lib/game/layouts.ts), paired by index.
export type Seat = {
  id: string;
  name: string;
  life: number;
  colorIndex: number;
  /** attached deck (for in-game display + future stat tracking) */
  deckId: string | null;
  deckName: string | null;
  /** overrides the palette colour when set */
  bgColor: string | null;
  /** Scryfall art_crop / commander art used as the panel background when set */
  bgImageUrl: string | null;
  /** commander damage received, keyed by attacker seat id */
  cmdDamage: Record<string, number>;
  counters: Counters;
  customCounters: CustomCounter[];
  status: SeatStatus;
  alive: boolean;
  /** finishing place once eliminated / game over; 1 = winner */
  placement: number | null;
};

export function makeSeat(i: number, name: string, life: number): Seat {
  return {
    id: `seat-${i}`,
    name,
    life,
    colorIndex: i,
    deckId: null,
    deckName: null,
    bgColor: null,
    bgImageUrl: null,
    cmdDamage: {},
    counters: { poison: 0, energy: 0, experience: 0 },
    customCounters: [],
    status: { monarch: false, initiative: false, cityBlessing: false },
    alive: true,
    placement: null,
  };
}

// Whether a seat has reached a game-loss condition: out of life, lethal poison,
// or 21+ commander damage from any single source.
export function isLethal(s: Seat): boolean {
  if (s.life <= 0) return true;
  if ((s.counters?.poison ?? 0) >= POISON_LETHAL) return true;
  return Object.values(s.cmdDamage ?? {}).some((v) => v >= CMD_DAMAGE_LETHAL);
}

// The resolved panel colour for a seat (custom override → palette default).
export function seatColor(seat: Seat): string {
  return seat.bgColor ?? SEAT_COLORS[seat.colorIndex % SEAT_COLORS.length];
}

// Fills in any fields a seat is missing — used when hydrating a game saved by an
// older build so new fields (status, bg, counters) never read as undefined.
export function normalizeSeat(s: Partial<Seat> & { id?: string }, i = 0): Seat {
  return {
    id: s.id ?? `seat-${i}`,
    name: s.name ?? `P${i + 1}`,
    life: typeof s.life === 'number' ? s.life : 20,
    colorIndex: s.colorIndex ?? i,
    deckId: s.deckId ?? null,
    deckName: s.deckName ?? null,
    bgColor: s.bgColor ?? null,
    bgImageUrl: s.bgImageUrl ?? null,
    cmdDamage: s.cmdDamage ?? {},
    counters: { poison: s.counters?.poison ?? 0, energy: s.counters?.energy ?? 0, experience: s.counters?.experience ?? 0 },
    customCounters: Array.isArray(s.customCounters) ? s.customCounters : [],
    status: { monarch: !!s.status?.monarch, initiative: !!s.status?.initiative, cityBlessing: !!s.status?.cityBlessing },
    alive: s.alive !== false,
    placement: s.placement ?? null,
  };
}

// Seat palette — an evenly-spaced, equal-weight jewel-tone wheel so up to eight
// players stay distinct yet harmonious on the near-black board. Indices are
// stable, so a seat keeps its colour all game. A player can override per seat.
export const SEAT_COLORS = [
  '#8b6ef0', // violet
  '#4f86ef', // azure
  '#2eb6d4', // cyan
  '#22c08c', // emerald
  '#5cb85b', // green
  '#d99520', // amber
  '#ef6a52', // coral
  '#e85a9c', // pink
];

// Hand-picked palette offered in the per-player background picker (the eight
// seat tones plus a few neutrals/extras), kept complementary.
export const BG_COLOR_CHOICES = [
  ...SEAT_COLORS,
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#14b8a6', // teal
  '#84cc16', // lime
  '#eab308', // gold
  '#f97316', // orange
  '#ef4444', // red
  '#a855f7', // purple
  '#64748b', // slate
  '#334155', // dark slate
];
