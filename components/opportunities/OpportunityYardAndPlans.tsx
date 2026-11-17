import LeadYardMeasure from '@/components/area-measure/LeadYardMeasure'
import { CustomerRecords } from '@/components/customer-file/CustomerRecords'
import { loadCustomerExtras } from '@/lib/customer-file/customer-extras'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'

type Profile = Parameters<typeof resolveThreadViewer>[1]

/**
 * Opportunity page, companies that do not measure roofs: the property, its lawn / bed measurements (switch `areaMeasure`)
 * and its service plans (switch `servicePlans`) — the Customer File's own `CustomerRecords` cards, data and rules
 * (lib/customer-file/customer-extras.ts), nothing new. Renders nothing when neither switch is on (a roofing company, or a
 * company that uses neither), when the viewer may not read the customer, or inside the Customer File (it shows them itself).
 */
export default async function OpportunityYardAndPlans({
  profile,
  opportunityId,
  customerId,
  leadId,
  embedded,
}: {
  profile: Profile & { org_id: string }
  opportunityId: string
  customerId: string | null
  leadId: string | null
  embedded: boolean
}) {
  if (embedded) return null
  const admin = createServiceClient()
  if (!customerId) {
    // No customer yet: the lead's own yard measure (renders nothing unless the company uses it).
    return leadId ? <LeadYardMeasure profile={profile} leadId={leadId} /> : null
  }
  const viewer = await resolveThreadViewer(admin, profile)
  const extras = await loadCustomerExtras(admin, viewer, customerId).catch(() => null)
  if (!extras || (!extras.areaMeasure && !extras.servicePlans)) return null
  return (
    <div className="mb-6 space-y-6">
      <CustomerRecords customerId={customerId} extras={extras} opportunityId={opportunityId} />
    </div>
  )
}
