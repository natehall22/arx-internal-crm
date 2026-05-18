import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import LeadFormWithReferral from '@/components/LeadFormWithReferral'
import { userHasSchedulingCreate } from '@/lib/scheduling-create-permission'

export default async function NewLeadPage() {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()
  const canScheduleInspection = await userHasSchedulingCreate(supabase, profile.id, profile)

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
          />
        </div>
      </div>
    </div>
  )
}
