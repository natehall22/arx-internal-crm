import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import SisuHubNav from './SisuHubNav'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

export default async function SisuAdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth()

  if (!ADMIN_ROLES.includes(profile.role)) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <Nav />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-sm font-medium text-indigo-300 transition hover:text-indigo-100"
          >
            ← Back to Admin
          </Link>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-indigo-300">Sisu Admin</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Sisu Hub</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Manage Heats, badges, the 444 program, and field marketer accountability.
          </p>
        </div>

        <Suspense fallback={<div className="h-11 rounded-xl border border-slate-800 bg-slate-900/70" />}>
          <SisuHubNav />
        </Suspense>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
