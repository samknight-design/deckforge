'use client';

export default function ManaBar({ manaCurve = [] }) {
  const max = Math.max(...manaCurve, 1);
  const labels = ['0', '1', '2', '3', '4', '5', '6', '7+'];
  const MAX_H = 76; // px — bar heights scale against this so counts are visible

  return (
    <div>
      {/* justify-end so bars grow up from the baseline; pixel heights (a % of an
          auto-height parent collapses to nothing — the previous bug). */}
      <div className="flex items-end gap-1.5" style={{ height: MAX_H + 18 }}>
        {manaCurve.map((count, cmc) => {
          const h = count > 0 ? Math.max(Math.round((count / max) * MAX_H), 6) : 0;
          return (
            <div key={cmc} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
              {count > 0 && (
                <span className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
                  {count}
                </span>
              )}
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: h,
                  background: cmc <= 2 ? '#10b981' : cmc <= 4 ? '#f59e0b' : '#ef4444',
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
