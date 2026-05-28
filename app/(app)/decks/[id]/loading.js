export default function Loading() {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: '#0a0e1a' }}>
      {/* Top header */}
      <div className="flex-shrink-0 px-4 pt-5 pb-4" style={{ borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="space-y-2 flex-1">
            <div className="h-6 w-40 rounded-lg animate-pulse" style={{ background: '#1e2d47' }} />
            <div className="h-3 w-28 rounded-lg animate-pulse" style={{ background: '#1a2235' }} />
          </div>
          <div className="h-8 w-20 rounded-xl animate-pulse flex-shrink-0" style={{ background: '#1e2d47' }} />
        </div>
        {/* Stat pills */}
        <div className="flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-8 w-20 rounded-full animate-pulse" style={{ background: '#111827' }} />
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex px-4 pt-3 pb-0 gap-3" style={{ borderBottom: '1px solid #1e2d47' }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 w-16 rounded-lg animate-pulse" style={{ background: '#111827' }} />
        ))}
      </div>

      {/* Card rows */}
      <div className="flex-1 overflow-hidden px-4 py-3 space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="flex-shrink-0 rounded-lg animate-pulse" style={{ width: 36, height: 50, background: '#1a2235' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 rounded animate-pulse" style={{ background: '#1e2d47', width: `${55 + (i * 17) % 35}%` }} />
              <div className="h-3 rounded animate-pulse" style={{ background: '#1a2235', width: `${35 + (i * 11) % 30}%` }} />
            </div>
            <div className="flex-shrink-0 flex items-center gap-1">
              <div className="h-7 w-7 rounded-lg animate-pulse" style={{ background: '#1a2235' }} />
              <div className="h-4 w-5 rounded animate-pulse" style={{ background: '#1e2d47' }} />
              <div className="h-7 w-7 rounded-lg animate-pulse" style={{ background: '#1a2235' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
