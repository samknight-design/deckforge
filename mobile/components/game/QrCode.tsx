// Lightweight QR renderer with no native dependency. Uses the pure-JS
// qrcode-generator to compute the module matrix, then draws each row as a few
// run-length <View> rectangles (keeps the view count low). Good enough for a
// lobby join code; not a high-density payload.

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import qrcode from 'qrcode-generator';

export default function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const { runs, cell, pad } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4; // standard quiet zone in modules
    const cell = size / (count + quiet * 2);
    const pad = quiet * cell;

    // Build horizontal runs of dark modules per row.
    const runs: { x: number; y: number; w: number }[] = [];
    for (let r = 0; r < count; r++) {
      let start = -1;
      for (let c = 0; c <= count; c++) {
        const dark = c < count && qr.isDark(r, c);
        if (dark && start === -1) start = c;
        if (!dark && start !== -1) {
          runs.push({ x: pad + start * cell, y: pad + r * cell, w: (c - start) * cell });
          start = -1;
        }
      }
    }
    return { runs, cell, pad };
  }, [value, size]);

  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      {runs.map((run, i) => (
        <View key={i} style={{ position: 'absolute', left: run.x, top: run.y, width: run.w, height: cell, backgroundColor: '#0a0e1a' }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' },
});
