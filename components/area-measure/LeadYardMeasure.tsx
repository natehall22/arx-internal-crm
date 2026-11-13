import YardMeasureCard from '@/components/area-measure/YardMeasureCard'
import { loadAreaMeasurements, resolveAreaMeasureTarget } from '@/lib/area-measure-db'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'

type Profile = Parameters<typeof resolveThreadViewer>[1]

/**
 * Yard measurement on a lead (the Prospect File). Renders nothing unless the company uses Measure yard, the person may
 * open this lead, and the table exists — so every other company's lead page is exactly what it was.
 */
export default async function LeadYardMeasure({ profile, leadId }: { profile: Profile & { org_id: string }; leadId: string }) {
  if (!(await isOrgFeatureOn(profile.org_id, 'areaMeasure'))) return null
  const admin = createServiceClient()
  const viewer = await resolveThreadViewer(admin, profile)
  const t = await resolveAreaMeasureTarget(admin, viewer, { leadId })
  if (!t.ok) return null
  const found = await loadAreaMeasurements(admin, viewer.orgId, { leadId }).catch(() => null)
  if (!found || !found.ready) return null
  return <YardMeasureCard leadId={leadId} rows={found.rows} properties={[]} canMeasure={t.target.canWrite} />
}
