import ResourceHeader from '@/components/ResourceHeader';

export const metadata = { title: 'Rules · DeckForge' };

// Native <details> = collapsible sections, no client JS needed.
function Section({ q, children, open }) {
  return (
    <details open={open} className="rounded-xl mb-2 overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
      <summary className="px-4 py-3 text-sm font-semibold text-white cursor-pointer select-none flex items-center justify-between">
        <span>{q}</span>
        <span style={{ color: '#64748b' }}>▾</span>
      </summary>
      <div className="px-4 pb-3 text-sm leading-relaxed space-y-2" style={{ color: '#cbd5e1' }}>{children}</div>
    </details>
  );
}

const Term = ({ children }) => <strong className="text-white">{children}</strong>;

export default function RulesPage() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      <ResourceHeader title="Rules" subtitle="A quick reference to the basics of Magic: The Gathering." />
      <div className="px-4 py-4">

        <Section q="🎯 The goal" open>
          <p>Each player usually starts at <Term>20 life</Term> (<Term>40</Term> in Commander). You win by reducing every opponent to 0 life — or by other effects (e.g. milling out their library, or 21+ combat damage from a single commander).</p>
        </Section>

        <Section q="🗺️ Zones">
          <p><Term>Library</Term> — your deck. <Term>Hand</Term> — cards you can play. <Term>Battlefield</Term> — lands and permanents in play. <Term>Graveyard</Term> — discard/destroyed pile. <Term>Exile</Term> — removed from the game. <Term>Stack</Term> — where spells/abilities wait to resolve. <Term>Command</Term> — your commander’s home.</p>
        </Section>

        <Section q="🔄 Turn structure">
          <p>1. <Term>Untap</Term> — untap your permanents.<br/>2. <Term>Upkeep</Term> — triggered effects happen.<br/>3. <Term>Draw</Term> — draw a card.<br/>4. <Term>Main phase 1</Term> — play lands and cast spells.<br/>5. <Term>Combat</Term> — attack with creatures.<br/>6. <Term>Main phase 2</Term> — play more spells.<br/>7. <Term>End</Term> — end-of-turn effects, discard to 7.</p>
        </Section>

        <Section q="⚔️ Combat">
          <p><Term>Declare attackers</Term>: tap creatures to attack (they need to have been under your control since your turn began, unless they have Haste). <Term>Declare blockers</Term>: the defender assigns blockers. <Term>Damage</Term>: attackers and blockers deal damage equal to their power simultaneously. Unblocked attackers hit the player/planeswalker.</p>
        </Section>

        <Section q="🃏 Card types">
          <p><Term>Lands</Term> make mana (usually 1 per turn). <Term>Creatures</Term> attack and block. <Term>Instants</Term> can be cast any time. <Term>Sorceries</Term> only on your main phase with an empty stack. <Term>Artifacts</Term> & <Term>Enchantments</Term> are lasting effects. <Term>Planeswalkers</Term> have loyalty abilities. <Term>Battles</Term> are sieged objectives.</p>
        </Section>

        <Section q="🌀 Casting & the stack">
          <p>When you cast a spell or activate an ability it goes on the <Term>stack</Term>. Players get <Term>priority</Term> to respond; the stack resolves last-in, first-out. Instants and abilities can be used in response — sorcery-speed things cannot.</p>
        </Section>

        <Section q="💎 Mana & colours">
          <p>Five colours: <Term>White (W)</Term>, <Term>Blue (U)</Term>, <Term>Black (B)</Term>, <Term>Red (R)</Term>, <Term>Green (G)</Term>, plus <Term>Colourless</Term>. A card’s mana cost (e.g. <Term>2WW</Term>) is its <Term>mana value / CMC</Term>. In Commander, your cards must match your commander’s colour identity.</p>
        </Section>

        <Section q="✨ Common keywords">
          <p><Term>Flying</Term> (only blocked by flyers/reach), <Term>Trample</Term> (excess damage carries over), <Term>Deathtouch</Term> (any damage is lethal), <Term>Lifelink</Term> (gain life equal to damage), <Term>Haste</Term> (attack the turn it enters), <Term>Vigilance</Term> (attacks without tapping), <Term>First strike</Term> (deals damage first), <Term>Menace</Term> (needs two blockers), <Term>Hexproof/Ward</Term> (protection from targeting).</p>
        </Section>

        <p className="text-xs text-center mt-4" style={{ color: '#475569' }}>This is a simplified reference. For full rulings, the official Comprehensive Rules are the final word.</p>
      </div>
    </div>
  );
}
