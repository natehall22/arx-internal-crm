import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import LeadFormWithReferral from '@/components/LeadFormWithReferral'
import { userHasSchedulingCreate } from '@/lib/scheduling-create-permission'
import { loadOrgProfile, t } from '@/lib/org-profile'
import { loadCompanyServiceChoices } from '@/lib/lead-intake-db'
import { readLeadIntakeSettings } from '@/lib/lead-intake'

export default async function NewLeadPage() {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()
  const canScheduleInspection = await userHasSchedulingCreate(supabase, profile.id, profile)

  const profile_ = await loadOrgProfile(supabase, profile.org_id)
  const serviceChoices = await loadCompanyServiceChoices(supabase, profile.org_id).catch(() => [] as string[])
  const { data: orgRow } = await supabase.from('orgs').select('settings').eq('id', profile.org_id).maybeSingle()
  const routingMode = readLeadIntakeSettings((orgRow?.settings ?? null) as Record<string, unknown> | null).routing.mode
  // Only a company that set up lead routing gets the Owner choice; everyone else keeps "the person typing owns it".
  let ownerChoices: Array<{ id: string; name: string }> | null = null
  if (routingMode !== 'person') {
    const { data: people } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('full_name', { ascending: true })
    ownerChoices = (people ?? []).map((u: { id: string; full_name: string | null }) => ({ id: u.id, name: u.full_name || 'Unnamed' }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link href="/leads" className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            ← Back to Leads
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">New Lead</h1>
          <LeadFormWithReferral 
            orgId={profile.org_id} 
            userId={profile.id}
            canScheduleInspection={canScheduleInspection}
            nameLabel={t(profile_, 'leadName')}
            serviceChoices={serviceChoices}
            ownerChoices={ownerChoices}
          />
        </div>
      </div>
    </div>
  )
}
