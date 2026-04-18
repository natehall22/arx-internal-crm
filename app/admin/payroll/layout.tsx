import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile?.role || !isPayrollAdminRole(profile.role)) {
    redirect('/dashboard')
  }

  return <>{children}</>
}
