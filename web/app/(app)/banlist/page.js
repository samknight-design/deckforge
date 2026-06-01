import ResourceHeader from '@/components/ResourceHeader';

export const metadata = { title: 'Ban list · DeckForge' };

const FORMATS = [
  { name: 'Commander (EDH)', note: 'Singleton, 100 cards, colour identity rules. The Commander banned list is maintained by the RC/WotC.' },
  { name: 'Standard', note: 'The most recent sets. Cards rotate out over time; a small banned list keeps it healthy.' },
  { name: 'Pioneer', note: 'Return-to-Ravnica forward. No rotation; banned list manages problem cards.' },
  { name: 'Modern', note: '8th Edition / Modern-era forward. Large card pool with an active banned list.' },
  { name: 'Legacy', note: 'Nearly every card is legal; a banned list removes the truly broken ones.' },
  { name: 'Pauper', note: 'Commons only — but some commons are still banned.' },
];

const OFFICIAL = 'https://magic.wizards.com/en/banned-restricted-list';

export default function BanlistPage() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      <ResourceHeader title="Ban lists" subtitle="Which cards are legal where. Ban lists change — always check the official source before an event." />
      <div className="px-4 py-4 space-y-3">
        <a
          href={OFFICIAL}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-2xl p-4 text-center"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)' }}
        >
          <div className="text-sm font-bold" style={{ color: '#f59e0b' }}>Official Banned &amp; Restricted list ↗</div>
          <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>The live, authoritative list for every format</div>
        </a>

        {FORMATS.map((f) => (
          <div key={f.name} className="rounded-xl p-3" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="text-sm font-semibold text-white">{f.name}</div>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#94a3b8' }}>{f.note}</p>
          </div>
        ))}

        <p className="text-xs text-center" style={{ color: '#475569' }}>Ban lists update with each set and announcement — this page links to the source of truth rather than a copy that can go stale.</p>
      </div>
    </div>
  );
}
