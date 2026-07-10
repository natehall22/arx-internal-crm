import { notFound } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import GoalsClient from './GoalsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export default async function AdminGoalsPage() {
  const { profile } = await requireAuth()
  if (!isOrgSuperuserRoleSlug(profile.role)) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Goals &amp; Forecast</h1>
          <p className="mt-2 text-gray-600">Monthly targets, scorecard, and revenue forecasting</p>
        </div>
        <GoalsClient />
      </div>
    </div>
  )
}
