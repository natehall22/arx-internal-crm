import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ALLOWED = new Set(['admin', 'owner', 'operations'])

export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile?.role || !ALLOWED.has(profile.role)) {
    redirect('/dashboard')
  }

  return <>{children}</>
}
