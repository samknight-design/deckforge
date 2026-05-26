'use client';

export default function ManaBar({ manaCurve = [] }) {
  const max = Math.max(...manaCurve, 1);
  const labels = ['0', '1', '2', '3', '4', '5', '6', '7+'];

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: 80 }}>
        {manaCurve.map((count, cmc) => {
          const pct = (count / max) * 100;
          return (
            <div key={cmc} className="flex-1 flex flex-col items-center gap-1">
              {count > 0 && (
                <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
                  {count}
                </span>
              )}
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(pct, count > 0 ? 8 : 0)}%`,
                  background: cmc <= 2 ? '#10b981' : cmc <= 4 ? '#f59e0b' : '#ef4444',
                  minHeight: count > 0 ? 4 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 text-center text-xs" style={{ color: '#475569' }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
