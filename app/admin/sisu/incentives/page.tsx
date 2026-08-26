import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminIncentivesClient from './AdminIncentivesClient'

type PageProps = {
  searchParams: Promise<{ tab?: string }>
}

export default async function SisuIncentivesPage({ searchParams }: PageProps) {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) redirect('/login')

  const params = await searchParams
  const initialTab = params.tab === 'badges' ? 'badges' : 'heats'

  return (
    <div className="rounded-xl border border-slate-800 bg-gray-50 p-6 shadow-2xl shadow-black/20">
      <AdminIncentivesClient currentUserId={user.id} initialTab={initialTab} />
    </div>
  )
}
