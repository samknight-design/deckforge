// Seat layouts for the life-tracker board. A layout is a preset arrangement for
// a given player count: where each seat sits and which way it faces, so players
// around the table read upright. Picked from the board's layout menu (centre ☰)
// — never rotated per-seat. The catalog aims to cover the realistic ways people
// sit around a table for each pod size.

import type { DimensionValue } from 'react-native';

// Content rotation, chosen so the seat reads UPRIGHT for the player sitting on
// that side of the table (text top points away from them, across the phone):
//   0   = player at the bottom (holder)
//   180 = player across the top
//   90  = player on the LEFT side  (text top points right/centre)
//   270 = player on the RIGHT side (text top points left/centre)
export type Rot = 0 | 90 | 180 | 270;

// Named by where the player sits, for readable layout authoring.
const BOTTOM: Rot = 0;
const TOP: Rot = 180;
const LEFT: Rot = 90;
const RIGHT: Rot = 270;

export type SeatSlot = { x: number; y: number; w: number; h: number; rot: Rot };
export type Layout = { id: string; label: string; players: number; slots: SeatSlot[] };

export const pct = (n: number): DimensionValue => `${n * 100}%` as DimensionValue;

// ── Generators ───────────────────────────────────────────────────────────────

// Equal-height horizontal bands; each band split into n equal cells sharing a rotation.
function bands(spec: { rot: Rot; n: number }[]): SeatSlot[] {
  const h = 1 / spec.length;
  const out: SeatSlot[] = [];
  spec.forEach((b, bi) => {
    const w = 1 / b.n;
    for (let i = 0; i < b.n; i++) out.push({ x: i * w, y: bi * h, w, h, rot: b.rot });
  });
  return out;
}

// Equal-width vertical bands (columns); each split into n equal rows sharing a rotation.
function cols(spec: { rot: Rot; n: number }[]): SeatSlot[] {
  const w = 1 / spec.length;
  const out: SeatSlot[] = [];
  spec.forEach((b, bi) => {
    const h = 1 / b.n;
    for (let i = 0; i < b.n; i++) out.push({ x: bi * w, y: i * h, w, h, rot: b.rot });
  });
  return out;
}

const facing = (n: number) => {
  const top = Math.floor(n / 2);
  const bottom = n - top;
  return top === 0 ? bands([{ rot: 0, n: bottom }]) : bands([{ rot: 180, n: top }, { rot: 0, n: bottom }]);
};
const sameWay = (n: number) => {
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  return bottom === 0 ? bands([{ rot: 0, n: top }]) : bands([{ rot: 0, n: top }, { rot: 0, n: bottom }]);
};

// ── Hand-authored "around the table" + side variants ─────────────────────────

const SIDES_2: SeatSlot[] = cols([{ rot: LEFT, n: 1 }, { rot: RIGHT, n: 1 }]);
const SIDEBYSIDE_2: SeatSlot[] = cols([{ rot: BOTTOM, n: 1 }, { rot: BOTTOM, n: 1 }]);

const AROUND_3: SeatSlot[] = [
  { x: 0, y: 0, w: 0.5, h: 0.5, rot: LEFT },
  { x: 0.5, y: 0, w: 0.5, h: 0.5, rot: RIGHT },
  { x: 0, y: 0.5, w: 1, h: 0.5, rot: BOTTOM },
];

const AROUND_4: SeatSlot[] = [
  { x: 0, y: 0, w: 1, h: 0.25, rot: TOP },
  { x: 0, y: 0.25, w: 0.5, h: 0.5, rot: LEFT },
  { x: 0.5, y: 0.25, w: 0.5, h: 0.5, rot: RIGHT },
  { x: 0, y: 0.75, w: 1, h: 0.25, rot: BOTTOM },
];
const SIDES_4: SeatSlot[] = cols([{ rot: LEFT, n: 2 }, { rot: RIGHT, n: 2 }]);

const AROUND_5: SeatSlot[] = [
  { x: 0, y: 0, w: 1, h: 0.25, rot: TOP },
  { x: 0, y: 0.25, w: 0.5, h: 0.5, rot: LEFT },
  { x: 0.5, y: 0.25, w: 0.5, h: 0.5, rot: RIGHT },
  { x: 0, y: 0.75, w: 0.5, h: 0.25, rot: BOTTOM },
  { x: 0.5, y: 0.75, w: 0.5, h: 0.25, rot: BOTTOM },
];

const AROUND_6: SeatSlot[] = [
  { x: 0, y: 0, w: 1, h: 0.2, rot: TOP },
  { x: 0, y: 0.2, w: 0.5, h: 0.3, rot: LEFT },
  { x: 0, y: 0.5, w: 0.5, h: 0.3, rot: LEFT },
  { x: 0.5, y: 0.2, w: 0.5, h: 0.3, rot: RIGHT },
  { x: 0.5, y: 0.5, w: 0.5, h: 0.3, rot: RIGHT },
  { x: 0, y: 0.8, w: 1, h: 0.2, rot: BOTTOM },
];
const SIDES_6: SeatSlot[] = cols([{ rot: LEFT, n: 3 }, { rot: RIGHT, n: 3 }]);

const AROUND_7: SeatSlot[] = [
  { x: 0, y: 0, w: 1, h: 0.2, rot: TOP },
  { x: 0, y: 0.2, w: 0.5, h: 0.3, rot: LEFT },
  { x: 0, y: 0.5, w: 0.5, h: 0.3, rot: LEFT },
  { x: 0.5, y: 0.2, w: 0.5, h: 0.3, rot: RIGHT },
  { x: 0.5, y: 0.5, w: 0.5, h: 0.3, rot: RIGHT },
  { x: 0, y: 0.8, w: 0.5, h: 0.2, rot: BOTTOM },
  { x: 0.5, y: 0.8, w: 0.5, h: 0.2, rot: BOTTOM },
];

const AROUND_8: SeatSlot[] = [
  { x: 0, y: 0, w: 1, h: 0.16, rot: TOP },
  { x: 0, y: 0.16, w: 0.5, h: 0.227, rot: LEFT },
  { x: 0, y: 0.387, w: 0.5, h: 0.227, rot: LEFT },
  { x: 0, y: 0.614, w: 0.5, h: 0.226, rot: LEFT },
  { x: 0.5, y: 0.16, w: 0.5, h: 0.227, rot: RIGHT },
  { x: 0.5, y: 0.387, w: 0.5, h: 0.227, rot: RIGHT },
  { x: 0.5, y: 0.614, w: 0.5, h: 0.226, rot: RIGHT },
  { x: 0, y: 0.84, w: 1, h: 0.16, rot: BOTTOM },
];
const SIDES_8: SeatSlot[] = cols([{ rot: LEFT, n: 4 }, { rot: RIGHT, n: 4 }]);

// ── Catalog ──────────────────────────────────────────────────────────────────

export function getLayouts(n: number): Layout[] {
  const L = (id: string, label: string, slots: SeatSlot[]): Layout => ({ id: `${n}-${id}`, label, players: n, slots });

  switch (n) {
    case 2:
      return [
        L('facing', 'Across', facing(2)),
        L('sides', 'Left & right', SIDES_2),
        L('beside', 'Side by side', SIDEBYSIDE_2),
        L('same', 'Same way', sameWay(2)),
      ];
    case 3:
      return [
        L('facing', '1 v 2', bands([{ rot: 180, n: 1 }, { rot: 0, n: 2 }])),
        L('facing2', '2 v 1', bands([{ rot: 180, n: 2 }, { rot: 0, n: 1 }])),
        L('around', 'Around table', AROUND_3),
        L('same', 'Same way', sameWay(3)),
      ];
    case 4:
      return [
        L('facing', '2 v 2', facing(4)),
        L('around', 'Around table', AROUND_4),
        L('sides', 'Two each side', SIDES_4),
        L('same', 'Same way', sameWay(4)),
      ];
    case 5:
      return [
        L('facing', '2 v 3', bands([{ rot: 180, n: 2 }, { rot: 0, n: 3 }])),
        L('facing2', '3 v 2', bands([{ rot: 180, n: 3 }, { rot: 0, n: 2 }])),
        L('around', 'Around table', AROUND_5),
        L('same', 'Same way', sameWay(5)),
      ];
    case 6:
      return [
        L('facing', '3 v 3', facing(6)),
        L('around', 'Around table', AROUND_6),
        L('sides', 'Three each side', SIDES_6),
        L('same', 'Same way', sameWay(6)),
      ];
    case 7:
      return [
        L('facing', '3 v 4', bands([{ rot: 180, n: 3 }, { rot: 0, n: 4 }])),
        L('facing2', '4 v 3', bands([{ rot: 180, n: 4 }, { rot: 0, n: 3 }])),
        L('around', 'Around table', AROUND_7),
        L('same', 'Same way', sameWay(7)),
      ];
    case 8:
      return [
        L('facing', '4 v 4', facing(8)),
        L('around', 'Around table', AROUND_8),
        L('sides', 'Four each side', SIDES_8),
        L('same', 'Same way', sameWay(8)),
      ];
    default:
      return [L('facing', 'Facing rows', facing(n)), L('same', 'Same way', sameWay(n))];
  }
}

export function defaultLayout(n: number): Layout {
  return getLayouts(n)[0];
}
