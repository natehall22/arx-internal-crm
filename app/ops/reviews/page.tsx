export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessOpsDashboardFromPermissionNames } from '@/lib/permissions'
import OpsReviewBackstopList, { type OpsReviewRow } from '@/components/reviews/OpsReviewBackstopList'

function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)))
}

export default async function OpsReviewsPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()

  const opsPermissions = await resolveEffectivePermissionNames(admin, authUser.id, profile)
  if (!canAccessOpsDashboardFromPermissionNames(opsPermissions)) {
    redirect('/dashboard')
  }

  const [{ data: jobs }, { data: allRequests }] = await Promise.all([
    admin
      .from('production_jobs')
      .select(
        `id, job_number, address_text, completed_at, status,
         customer:customers(name),
         salesperson:users!production_jobs_salesperson_id_fkey(full_name),
         review_requests(sent_at)`
      )
      .eq('org_id', profile.org_id)
      .in('status', ['complete', 'collected'])
      .order('completed_at', { ascending: true, nullsFirst: false }),
    admin
      .from('review_requests')
      .select('sent_at, clicked_at')
      .eq('org_id', profile.org_id),
  ])

  // "Needs a request" = completed job with no request, or a prepared-but-unsent request.
  const rows: OpsReviewRow[] = (jobs || [])
    .filter((j: any) => {
      const rr = firstOrSelf<{ sent_at: string | null }>(j.review_requests)
      return !rr || !rr.sent_at
    })
    .map((j: any) => {
      const customer = firstOrSelf<{ name: string | null }>(j.customer)
      const salesperson = firstOrSelf<{ full_name: string | null }>(j.salesperson)
      return {
        jobId: j.id as string,
        jobNumber: (j.job_number as string) ?? null,
        customerName: customer?.name ?? null,
        address: (j.address_text as string) ?? null,
        completedAt: (j.completed_at as string) ?? null,
        repName: salesperson?.full_name ?? null,
        ageDays: daysSince(j.completed_at as string | null),
      }
    })

  const sentCount = (allRequests || []).filter((r: any) => r.sent_at).length
  const clickedCount = (allRequests || []).filter((r: any) => r.clicked_at).length
  const ctr = sentCount > 0 ? Math.round((clickedCount / sentCount) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review requests</h1>
            <p className="mt-1 text-sm text-gray-600">
              Backstop for completed jobs a closer hasn&apos;t sent a Google review request for yet.
            </p>
          </div>
          <Link href="/ops/dashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ← Ops dashboard
          </Link>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Awaiting request</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{rows.length}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sent</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{sentCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Clicked</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{clickedCount}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Click rate</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{ctr}%</p>
          </div>
        </div>

        <OpsReviewBackstopList rows={rows} />
      </div>
    </div>
  )
}
