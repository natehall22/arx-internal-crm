import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isOwnerProfile } from '@/lib/super-admin'

import MoneyAccessClient from './MoneyAccessClient'

export const dynamic = 'force-dynamic'

export default async function MoneyAccessPage() {
  const { profile } = await requireAuth()
  if (!isOwnerProfile(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        <PageHeader title="Money access" subtitle="Who can see company financials, and who can record job money. Only owners can change this; every change is logged." />
        <MoneyAccessClient />
      </main>
    </div>
  )
}
