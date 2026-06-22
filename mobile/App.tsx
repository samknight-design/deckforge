import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './lib/supabase';
import { ThemeProvider, useTheme } from './lib/theme';
import type { Session } from '@supabase/supabase-js';
import type { Deck } from './lib/db';

import ScanScreen from './screens/ScanScreen';
import HomeScreen from './screens/HomeScreen';
import LibraryScreen from './screens/LibraryScreen';
import DecksScreen from './screens/DecksScreen';
import DeckDetailScreen from './screens/DeckDetailScreen';
import DeckSearchScreen from './screens/DeckSearchScreen';
import InsightsScreen from './screens/InsightsScreen';
import ProfileScreen from './screens/ProfileScreen';
import SettingsScreen from './screens/SettingsScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import AuthScreen from './screens/AuthScreen';
import { XpToastProvider } from './lib/xpToast';
import { getProfile } from './lib/db';

WebBrowser.maybeCompleteAuthSession();

// ── Navigation types ─────────────────────────────────────────────────────────

type Tab = 'home' | 'decks' | 'profile';

type Screen =
  | { id: 'home' }
  | { id: 'library' }
  | { id: 'scan'; fromTab: Tab; deck?: Deck }
  | { id: 'decks' }
  | { id: 'deckDetail'; deck: Deck }
  | { id: 'deckSearch' }
  | { id: 'insights'; deck: Deck }
  | { id: 'profile' }
  | { id: 'settings' };

const TAB_ORDER: Tab[] = ['home', 'decks', 'profile'];

const TAB_ICONS: Record<Tab, string> = {
  home: '🏠',
  decks: '🗂️',
  profile: '👤',
};

const TAB_LABELS: Record<Tab, string> = {
  home: 'Home',
  decks: 'Decks',
  profile: 'Profile',
};

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onTab,
  onScan,
}: {
  active: Tab;
  onTab: (t: Tab) => void;
  onScan: () => void;
}) {
  const { colors, theme } = useTheme();
  const scanPulse = useRef(new Animated.Value(1)).current;

  const pulse = () => {
    Animated.sequence([
      Animated.timing(scanPulse, { toValue: 0.93, duration: 80, useNativeDriver: true }),
      Animated.timing(scanPulse, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  };

  return (
    <View style={[tabStyles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {/* Left two tabs */}
      {TAB_ORDER.slice(0, 2).map((t) => (
        <Pressable key={t} style={tabStyles.tab} onPress={() => onTab(t)}>
          <Text style={tabStyles.tabIcon}>{TAB_ICONS[t]}</Text>
          <Text style={[tabStyles.tabLabel, { color: t === active ? colors.accent : colors.textDim }]}>
            {TAB_LABELS[t]}
          </Text>
          {t === active && <View style={[tabStyles.activeDot, { backgroundColor: colors.accent }]} />}
        </Pressable>
      ))}

      {/* Center scan button */}
      <View style={tabStyles.scanWrap}>
        <Animated.View style={{ transform: [{ scale: scanPulse }] }}>
          <Pressable
            style={[tabStyles.scanBtn, { backgroundColor: colors.accent }]}
            onPress={() => { pulse(); onScan(); }}
          >
            <Text style={tabStyles.scanIcon}>📷</Text>
          </Pressable>
        </Animated.View>
      </View>

      {/* Right tabs */}
      {TAB_ORDER.slice(2).map((t) => (
        <Pressable key={t} style={tabStyles.tab} onPress={() => onTab(t)}>
          <Text style={tabStyles.tabIcon}>{TAB_ICONS[t]}</Text>
          <Text style={[tabStyles.tabLabel, { color: t === active ? colors.accent : colors.textDim }]}>
            {TAB_LABELS[t]}
          </Text>
          {t === active && <View style={[tabStyles.activeDot, { backgroundColor: colors.accent }]} />}
        </Pressable>
      ))}
      {/* Reserved slot (keeps the right side balanced against the two left tabs).
          The future "Play MTG" tab (RN6) drops in here. */}
      {TAB_ORDER.slice(2).length < 2 && <View style={tabStyles.tab} />}
    </View>
  );
}

// On Android with gesture navigation the system nav bar sits below our tab bar.
// We can't use SafeAreaView here because the tab bar is absolutely positioned —
// instead we add explicit bottom padding. 34pt is the default Android gesture
// nav bar height; iOS uses the home-indicator safe area (20pt).
const BOTTOM_INSET = Platform.OS === 'ios' ? 20 : 28;
const TAB_H = Platform.OS === 'ios' ? 82 : 64 + BOTTOM_INSET;

const tabStyles = StyleSheet.create({
  bar: {
    height: TAB_H,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 8,
    borderTopWidth: 1,
    paddingBottom: BOTTOM_INSET,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 2 },
  tabIcon: { fontSize: 20, marginBottom: 2 },
  tabLabel: { fontSize: 10, fontWeight: '600' },
  activeDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  scanWrap: { width: 72, alignItems: 'center', marginTop: -22 },
  scanBtn: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#f59e0b', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  scanIcon: { fontSize: 26 },
});

// ── Main app (authed) ─────────────────────────────────────────────────────────

function AuthedApp({ session }: { session: Session }) {
  const { colors, theme } = useTheme();
  const userId = session.user.id;

  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>({ id: 'home' });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null); // null = loading

  // Check if onboarding is needed (username not yet set)
  useEffect(() => {
    getProfile(userId)
      .then((p) => setOnboardingDone(!!p?.username))
      .catch(() => setOnboardingDone(true)); // On error, don't block the app
  }, [userId]);

  const goTab = (t: Tab) => {
    setActiveTab(t);
    setScreen({ id: t });
  };

  const goScan = (deck?: Deck) => {
    setScreen({ id: 'scan', fromTab: activeTab, deck });
  };

  const goHome = () => {
    setActiveTab('home');
    setScreen({ id: 'home' });
  };

  const goBack = () => {
    setScreen({ id: activeTab });
  };

  // ── Screen routing ──────────────────────────────────────────────────────────

  // Show nothing while we check the profile
  if (onboardingDone === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  // First-time user — must complete onboarding before entering the app
  if (!onboardingDone) {
    return (
      <XpToastProvider>
        <OnboardingScreen userId={userId} onComplete={() => setOnboardingDone(true)} />
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      </XpToastProvider>
    );
  }

  if (screen.id === 'scan') {
    return (
      <ScanScreen
        userId={userId}
        targetDeck={screen.deck}
        onBack={() => {
          const from = screen.fromTab;
          setActiveTab(from);
          setScreen({ id: from });
        }}
      />
    );
  }

  if (screen.id === 'library') {
    return (
      <LibraryScreen
        userId={userId}
        onBack={goBack}
        onGoToScan={() => goScan()}
      />
    );
  }

  if (screen.id === 'settings') {
    return <SettingsScreen onBack={() => setScreen({ id: 'profile' })} userId={userId} />;
  }

  if (screen.id === 'insights') {
    return (
      <InsightsScreen
        deck={screen.deck}
        userId={userId}
        onBack={() => setScreen({ id: 'deckDetail', deck: screen.deck })}
      />
    );
  }

  if (screen.id === 'deckSearch') {
    return (
      <DeckSearchScreen
        userId={userId}
        onBack={goHome}
        onOpenDeck={(deck) => setScreen({ id: 'deckDetail', deck: deck as unknown as Deck })}
      />
    );
  }

  return (
    <XpToastProvider>
    <View style={[appStyles.root, { backgroundColor: colors.bg }]}>
      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {screen.id === 'home' && (
          <HomeScreen
            userId={userId}
            onOpenDeck={(deck) => setScreen({ id: 'deckDetail', deck: deck as unknown as Deck })}
            onGoToLibrary={() => setScreen({ id: 'library' })}
            onGoToScan={() => goScan()}
            onGoToDeckSearch={() => setScreen({ id: 'deckSearch' })}
          />
        )}
        {screen.id === 'decks' && (
          <DecksScreen
            userId={userId}
            onBack={goHome}
            onOpenDeck={(deck) => setScreen({ id: 'deckDetail', deck })}
            onGoToLibrary={() => setScreen({ id: 'library' })}
          />
        )}
        {screen.id === 'deckDetail' && (
          <DeckDetailScreen
            deck={screen.deck}
            userId={userId}
            onBack={() => setScreen({ id: 'decks' })}
            onScanInto={(deck) => goScan(deck)}
            onInsights={(deck) => setScreen({ id: 'insights', deck })}
          />
        )}
        {screen.id === 'profile' && (
          <ProfileScreen
            userId={userId}
            onGoToSettings={() => setScreen({ id: 'settings' })}
          />
        )}
      </View>

      {/* Tab bar — hidden during nested screens that have their own back nav */}
      {!['deckDetail', 'settings', 'insights', 'deckSearch'].includes(screen.id) && (
        <TabBar
          active={activeTab}
          onTab={goTab}
          onScan={() => goScan()}
        />
      )}

      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
    </XpToastProvider>
  );
}

const appStyles = StyleSheet.create({
  root: { flex: 1 },
});

// ── Root ──────────────────────────────────────────────────────────────────────

function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const { colors } = useTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBootstrapped(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Magic-link deep-link handler
  useEffect(() => {
    const handle = async (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const code = parsed.queryParams?.code as string | undefined;
        if (!code) return;
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) Alert.alert('Sign-in failed', error.message);
      } catch (e: any) {
        Alert.alert('Sign-in error', e?.message ?? String(e));
      }
    };
    Linking.getInitialURL().then((u) => { if (u) handle(u); });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  if (!bootstrapped) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: colors.accent, fontSize: 32, fontWeight: '900' }}>⚔️</Text>
      </View>
    );
  }

  return session ? <AuthedApp session={session} /> : <AuthScreen />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}
