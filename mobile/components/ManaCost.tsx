// Renders Scryfall mana cost strings ({2}{W}{U}{B} etc.) as small coloured
// circle pips. Used in library card rows, deck card rows, and card detail modal.

import { StyleSheet, Text, View } from 'react-native';

const PIP_COLORS: Record<string, { bg: string; text: string }> = {
  W: { bg: '#f8f0e3', text: '#555' },
  U: { bg: '#1a6faf', text: '#fff' },
  B: { bg: '#2a2a2a', text: '#ccc' },
  R: { bg: '#d32f2f', text: '#fff' },
  G: { bg: '#2e7d32', text: '#fff' },
  C: { bg: '#9e9e9e', text: '#fff' },
  S: { bg: '#b0d9e8', text: '#333' }, // snow
  X: { bg: '#555', text: '#fff' },
};

function parsePips(manaCost: string): string[] {
  const pips: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(manaCost)) !== null) {
    pips.push(m[1].toUpperCase());
  }
  return pips;
}

function Pip({ symbol, size }: { symbol: string; size: number }) {
  const style = PIP_COLORS[symbol] || { bg: '#666', text: '#fff' };
  const isNum = /^\d+$/.test(symbol);
  return (
    <View style={[
      pipStyles.circle,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: isNum ? '#6b7280' : style.bg },
    ]}>
      <Text style={[pipStyles.label, { fontSize: size * 0.55, color: isNum ? '#fff' : style.text }]}>
        {symbol.length > 2 ? symbol[0] : symbol}
      </Text>
    </View>
  );
}

const pipStyles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  label: { fontWeight: '700', lineHeight: undefined },
});

type Props = {
  manaCost: string | null | undefined;
  size?: number;
};

export default function ManaCost({ manaCost, size = 16 }: Props) {
  if (!manaCost) return null;
  const pips = parsePips(manaCost);
  if (pips.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      {pips.map((p, i) => <Pip key={i} symbol={p} size={size} />)}
    </View>
  );
}
