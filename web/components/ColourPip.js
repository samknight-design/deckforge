'use client';

const COLOR_MAP = {
  W: { bg: '#f9fafb', text: '#1f2937', border: '#9ca3af', label: 'White' },
  U: { bg: '#3b82f6', text: '#fff', border: '#3b82f6', label: 'Blue' },
  B: { bg: '#374151', text: '#d1d5db', border: '#374151', label: 'Black' },
  R: { bg: '#ef4444', text: '#fff', border: '#ef4444', label: 'Red' },
  G: { bg: '#22c55e', text: '#fff', border: '#22c55e', label: 'Green' },
  C: { bg: '#9ca3af', text: '#fff', border: '#9ca3af', label: 'Colorless' },
};

export default function ColourPip({ color, size = 20 }) {
  const c = COLOR_MAP[color] || COLOR_MAP.C;
  return (
    <span
      title={c.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: c.bg,
        color: c.text,
        border: `1.5px solid ${c.border}`,
        fontSize: size * 0.55,
        fontWeight: 'bold',
        flexShrink: 0,
      }}
    >
      {color}
    </span>
  );
}

export function ColourPips({ colors = [], size = 18 }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      {colors.map((c, i) => (
        <ColourPip key={i} color={c} size={size} />
      ))}
    </div>
  );
}

export function ManaCostDisplay({ manaCost, size = 16 }) {
  if (!manaCost) return null;
  // Parse "{W}{U}{2}" style mana costs
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {symbols.map((sym, i) => {
        const inner = sym.replace('{', '').replace('}', '');
        const c = COLOR_MAP[inner];
        if (c) {
          return <ColourPip key={i} color={inner} size={size} />;
        }
        // Generic (number or X)
        return (
          <span
            key={i}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: size,
              height: size,
              borderRadius: '50%',
              background: '#4b5563',
              color: '#f9fafb',
              border: '1.5px solid #6b7280',
              fontSize: size * 0.6,
              fontWeight: 'bold',
              flexShrink: 0,
            }}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
