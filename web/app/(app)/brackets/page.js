import ResourceHeader from '@/components/ResourceHeader';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';

export const metadata = { title: 'Brackets · DeckForge' };

const BRACKETS = [
  { n: 1, summary: 'Casual / jank. Built for fun and theme over winning. Few or no tutors, no fast combos, no mass land destruction.', expect: 'Battlecruiser games, big creatures, precons untouched or lightly tweaked.' },
  { n: 2, summary: 'Focused casual. A clear gameplan and some synergy, but still relaxed. Limited tutoring and interaction.', expect: 'Upgraded precons; a recognisable strategy without ruthless efficiency.' },
  { n: 3, summary: 'Optimised. Tuned mana, solid removal and card advantage. May include a couple of two-card combos.', expect: 'Decks that close games reliably but aren’t cutthroat.' },
  { n: 4, summary: 'High power. Lots of efficient interaction, tutors and compact win conditions. Fast and consistent.', expect: 'Strong combos, low curves, heavy interaction — just short of cEDH.' },
  { n: 5, summary: 'cEDH / competitive. The most powerful, consistent decks: fast mana, the best tutors and tight combo lines.', expect: 'Turn 1–4 wins are possible; every card earns its slot.' },
];

export default function BracketsPage() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      <ResourceHeader title="Commander Brackets" subtitle="A shared language for how powerful a deck is, from casual to competitive." />
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm" style={{ color: '#94a3b8' }}>
          Brackets help players match decks of similar power so games feel fair. DeckForge predicts a bracket for your deck when you run AI Insights.
        </p>

        {BRACKETS.map((b) => {
          const color = BRACKET_COLORS[b.n];
          return (
            <div key={b.n} className="rounded-2xl p-4" style={{ background: '#111827', border: `1px solid ${color}44` }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center rounded-xl font-bold flex-shrink-0" style={{ width: 40, height: 40, background: `${color}22`, color, border: `1px solid ${color}66` }}>{b.n}</div>
                <div className="font-bold text-white">{BRACKET_LABELS[b.n]}</div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>{b.summary}</p>
              <p className="text-xs mt-2" style={{ color: '#64748b' }}><strong style={{ color: '#94a3b8' }}>Expect:</strong> {b.expect}</p>
            </div>
          );
        })}

        <p className="text-xs text-center" style={{ color: '#475569' }}>Brackets are a guide, not a rule — always talk power level with your pod before a game.</p>
      </div>
    </div>
  );
}
