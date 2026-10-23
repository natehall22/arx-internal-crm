export const dynamic = 'force-dynamic'

import { Suspense } from 'react'

import Nav from '@/components/Nav'
import PayWeekClient from '@/components/payroll/PayWeekClient'

/** Payroll: one screen — "Pay this week". (The access gate is app/admin/payroll/layout.tsx.) */
export default function PayrollPage() {
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <Suspense fallback={null}>
          <PayWeekClient />
        </Suspense>
      </main>
    </div>
  )
}
