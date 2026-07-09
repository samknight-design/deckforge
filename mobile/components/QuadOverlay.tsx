// S3 (no-rebuild interim) — a true 4-corner perspective quad that hugs the card at
// any angle, unlike the old rotated-rectangle box. Drawn with plain RN Views: each
// edge is a thin bar translated to its start corner, stretched to the edge length,
// and rotated to point at the next corner (transformOrigin 'left center' pivots at
// the start corner).
//
// PERF: updated imperatively via a ref and re-renders ONLY when a new detection lands
// (~15 Hz), NOT on a 60 fps rAF loop (that was pure overhead and a major cause of lag —
// the box has nothing new to show between detections). Upstream One-Euro smoothing keeps
// the corners jitter-free, so rendering at detection rate looks fine. Isolated component,
// so only this tiny tree re-renders — never the whole CameraView.

import { forwardRef, useImperativeHandle, useState } from 'react';
import { View } from 'react-native';

export type Pt = { x: number; y: number };
export type QuadHandle = { set: (pts: Pt[] | null, color: string) => void };

const THICK = 3;   // edge thickness (px)
const NUB = 9;     // corner marker size (px)

const QuadOverlay = forwardRef<QuadHandle>((_props, ref) => {
  const [state, setState] = useState<{ pts: Pt[] | null; color: string }>({ pts: null, color: '#10b981' });

  useImperativeHandle(ref, () => ({
    set: (pts, color) => setState({ pts: pts && pts.length === 4 ? pts : null, color }),
  }), []);

  const { pts, color } = state;
  if (!pts) return null;

  const edges: [Pt, Pt][] = [[pts[0], pts[1]], [pts[1], pts[2]], [pts[2], pts[3]], [pts[3], pts[0]]];

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      {edges.map(([a, b], i) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: a.x,
              top: a.y - THICK / 2,
              width: len,
              height: THICK,
              borderRadius: THICK / 2,
              backgroundColor: color,
              transformOrigin: 'left center',
              transform: [{ rotateZ: `${ang}rad` }],
            }}
          />
        );
      })}
      {pts.map((c, i) => (
        <View
          key={`nub${i}`}
          style={{
            position: 'absolute',
            left: c.x - NUB / 2,
            top: c.y - NUB / 2,
            width: NUB,
            height: NUB,
            borderRadius: NUB / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
});

QuadOverlay.displayName = 'QuadOverlay';
export default QuadOverlay;
