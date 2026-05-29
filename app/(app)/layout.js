import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BottomNav from '@/components/BottomNav';
import ToastContainer from '@/components/Toast';
import RewardToast from '@/components/RewardToast';
import AnonBanner from '@/components/AnonBanner';

export default async function AppLayout({ children }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/welcome');
  }

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
