export default function Loading() {
  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header skeleton */}
      <div className="flex-shrink-0 px-4 pt-6 pb-3" style={{ borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1.5">
            <div className="h-5 w-24 rounded-lg animate-pulse" style={{ background: '#1e2d47' }} />
            <div className="h-3 w-16 rounded-lg animate-pulse" style={{ background: '#1a2235' }} />
          </div>
          <div className="h-10 w-24 rounded-xl animate-pulse" style={{ background: '#1e2d47' }} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#111827' }} />
          ))}
        </div>
      </div>

      {/* Deck card skeletons */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-2xl animate-pulse" style={{ height: 160, background: '#111827', border: '1px solid #1e2d47' }} />
        ))}
      </div>
    </div>
  );
}
