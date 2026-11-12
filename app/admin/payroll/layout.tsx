import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

// Session, active-account check and the company fence all come from requireAuth (never raw auth.getUser).
export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth()
  if (!profile.role || !isPayrollAdminRole(profile.role)) {
    redirect('/dashboard')
  }

  return <>{children}</>
}
