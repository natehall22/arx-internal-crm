export const dynamic = 'force-dynamic'

import Nav from '@/components/Nav'
import MyPayClient from '@/components/payroll/MyPayClient'
import { requireAuth } from '@/lib/auth'

/** My pay: what's on my next check, what's coming, what I was paid — each line with its math. Everyone sees only their own. */
export default async function MyPayPage() {
  await requireAuth()
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-xl px-4 py-4">
        <MyPayClient />
      </main>
    </div>
  )
}
