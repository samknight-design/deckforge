import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BottomNav from '@/components/BottomNav';

export default async function AppLayout({ children }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ background: '#0a0e1a', height: '100dvh' }}>
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
