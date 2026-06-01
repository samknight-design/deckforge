'use client';

// Authenticated app shell. Was a server component doing supabase.auth.getUser()
// + redirect, but that can't run in static export. AuthProvider does the same
// work on mount; pages call useAuth()/useInitialData() to read user + load
// their props.

import { AuthProvider, useAuth, LoadingScreen } from '@/lib/useInitialData';
import BottomNav from '@/components/BottomNav';
import ToastContainer from '@/components/Toast';
import RewardToast from '@/components/RewardToast';
import AnonBanner from '@/components/AnonBanner';

function AppShell({ children }) {
  const { user, loading } = useAuth();
  if (loading || !user) return <LoadingScreen />;
  const isAnon = user.is_anonymous === true;
  return (
    <div className="flex flex-col overflow-hidden" style={{ background: '#0a0e1a', height: '100dvh' }}>
      {isAnon && <AnonBanner />}
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
      <BottomNav />
      <ToastContainer />
      <RewardToast />
    </div>
  );
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
