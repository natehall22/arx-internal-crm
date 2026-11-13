import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { CUSTOM_FIELD_ENTITY_LABELS } from '@/lib/custom-fields'
import { loadOrgProfile, t } from '@/lib/org-profile'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'

import CustomFieldsClient from './CustomFieldsClient'

export const dynamic = 'force-dynamic'

/** Settings → Custom fields: the company's own fields on customers, properties and jobs. Owners only. */
export default async function CustomFieldsPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  // The job tab and subtitle use the company's own word for jobs (industry profile); roofing = "Jobs" as before.
  const jobsWord = t(await loadOrgProfile(createServiceClient(), profile.org_id), 'jobs')
  const entityLabels = { ...CUSTOM_FIELD_ENTITY_LABELS, job: jobsWord }
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Custom fields" subtitle={`Extra boxes your team fills in on customers, properties and ${jobsWord.toLowerCase()}. Only owners can change this list.`} />
        <CustomFieldsClient entityLabels={entityLabels} />
      </main>
    </div>
  )
}
