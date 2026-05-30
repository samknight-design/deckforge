import ResourceHeader from '@/components/ResourceHeader';

export const metadata = { title: 'Privacy · DeckForge' };

export default function PrivacyPage() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      <ResourceHeader title="Privacy" subtitle="What DeckForge collects, why, and your control over it." />
      <div className="px-4 py-4 space-y-4 text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
        <p><strong className="text-white">In short:</strong> we store the minimum needed to run your account and your decks, and we never sell your data.</p>

        <Section title="What we collect">
          <ul className="list-disc list-inside space-y-1">
            <li>Account: email, nickname, avatar choice, tier.</li>
            <li>Your decks, cards and notes.</li>
            <li>Usage counts (scans / insights this month) so we can enforce plan limits.</li>
            <li>Likes you give, and likes received on your public decks.</li>
            <li>Card photos you upload — sent to our AI service for identification, then discarded (we don’t keep your scan images).</li>
          </ul>
        </Section>

        <Section title="What we don’t collect">
          <ul className="list-disc list-inside space-y-1">
            <li>We don’t sell or share your personal data with advertisers.</li>
            <li>We don’t track you across the web.</li>
            <li>Card scan images aren’t retained after identification.</li>
          </ul>
        </Section>

        <Section title="Service providers we use">
          <p>To operate the app we use the following third-party services as data processors. They are <strong>not</strong> partners, affiliates or sponsors of DeckForge — they process data on our behalf to deliver specific features:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Authentication and database hosting.</li>
            <li>An AI service for card identification and deck analysis.</li>
            <li>A payment processor for subscriptions (when you choose to subscribe).</li>
            <li>A web host for the app itself.</li>
          </ul>
          <p className="mt-2">Each only handles the data needed for its role. You can request the specific provider list at any time by emailing the address below.</p>
        </Section>

        <Section title="Your controls">
          <p>You can change your nickname, avatar and currency at any time from your profile. To delete your account and all associated decks, email <a href="mailto:privacy@deckforge.app" style={{ color: '#f59e0b' }}>privacy@deckforge.app</a> from the address on the account.</p>
        </Section>

        <Section title="Contact">
          <p>Privacy questions: <a href="mailto:privacy@deckforge.app" style={{ color: '#f59e0b' }}>privacy@deckforge.app</a></p>
        </Section>

        <p className="text-xs text-center pt-2" style={{ color: '#475569' }}>This is a plain-language summary. A formal policy will be linked here before public launch.</p>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
      <h3 className="font-bold text-white mb-2 text-base">{title}</h3>
      <div style={{ color: '#cbd5e1' }}>{children}</div>
    </div>
  );
}
