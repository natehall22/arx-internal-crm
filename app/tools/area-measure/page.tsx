import { notFound } from 'next/navigation'

import AreaMeasureClient from '@/components/area-measure/AreaMeasureClient'
import Nav from '@/components/Nav'
import { loadAreaMeasureSettings, loadAreaMeasurements, resolveAreaMeasureTarget } from '@/lib/area-measure-db'
import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

/**
 * Measure yard. Opened from a customer / property / deal / lead (?customer_id= &property_id= &opportunity_id= &lead_id=,
 * optional &from=<measurement id> to start from an older measurement, &address= to type one) — or with just an address
 * (then it measures but has nothing to save to). Lawn & landscape companies only (feature switch `areaMeasure`).
 */
export default async function AreaMeasurePage({ searchParams }: { searchParams: SP }) {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'areaMeasure')
  const admin = createServiceClient()
  const viewer = await resolveThreadViewer(admin, profile)
  const refs = { customerId: one(searchParams.customer_id), propertyId: one(searchParams.property_id), opportunityId: one(searchParams.opportunity_id), leadId: one(searchParams.lead_id) }
  const hasRefs = !!(refs.customerId || refs.propertyId || refs.opportunityId || refs.leadId)

  let address = one(searchParams.address)
  let lat: number | null = null
  let lng: number | null = null
  let canSave = false
  let reason: string | null = 'Open this from a customer or lead to save it.'
  let forLabel: string | null = null
  let resolved = refs
  let backHref = '/today'
  let initialShapes = undefined as Awaited<ReturnType<typeof loadAreaMeasurements>>['rows'][number]['shapes'] | undefined

  if (hasRefs) {
    const t = await resolveAreaMeasureTarget(admin, viewer, refs)
    if (!t.ok) notFound()
    const target = t.target
    resolved = { customerId: target.customerId, propertyId: target.propertyId, opportunityId: target.opportunityId, leadId: target.leadId }
    address = address ?? target.address
    lat = target.lat
    lng = target.lng
    canSave = target.canWrite
    reason = canSave ? null : 'Your role can look at measurements but not save them.'
    const db = orgDb(admin, viewer.orgId)
    if (target.customerId) {
      const { data: c } = await db.from('customers').select('name').eq('id', target.customerId).maybeSingle()
      forLabel = (c?.name as string | null) ?? null
      backHref = target.opportunityId ? `/c/${target.customerId}/d/${target.opportunityId}` : `/c/${target.customerId}`
    } else if (target.leadId) {
      const { data: l } = await db.from('leads').select('homeowner_name').eq('id', target.leadId).maybeSingle()
      forLabel = (l?.homeowner_name as string | null) ?? null
      backHref = `/c/lead/${target.leadId}`
    }
    const from = one(searchParams.from)
    if (from) {
      const { rows } = await loadAreaMeasurements(admin, viewer.orgId, target)
      initialShapes = rows.find((r) => r.id === from)?.shapes
    }
  }

  const settings = await loadAreaMeasureSettings(admin, viewer.orgId)
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <AreaMeasureClient
        address={address}
        lat={lat}
        lng={lng}
        refs={resolved}
        forLabel={forLabel}
        canSave={canSave}
        cannotSaveReason={reason}
        settings={settings}
        canEditSettings={isSuperAdmin(profile as never)}
        initialShapes={initialShapes}
        backHref={backHref}
      />
    </div>
  )
}
