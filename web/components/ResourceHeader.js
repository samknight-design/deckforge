import Link from 'next/link';

// Simple header for in-app reference pages (Rules, Brackets, Ban list).
export default function ResourceHeader({ title, subtitle }) {
  return (
    <div className="px-4 pt-5 pb-4" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
      <Link
        href="/home"
        className="inline-flex items-center justify-center rounded-xl mb-3"
        style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
      >
        ←
      </Link>
      <h1 className="text-xl font-bold text-white">{title}</h1>
      {subtitle && <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>{subtitle}</p>}
    </div>
  );
}
