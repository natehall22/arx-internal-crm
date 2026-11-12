export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SendDocumentFlow from '@/components/signing/SendDocumentFlow'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { canManageTemplates } from '@/lib/signing/access'
import { createServiceClient } from '@/lib/supabase/service'

/** Save a document and where its fields go, once; anyone who can send then sends it in three taps. Managers and admins. */
export default async function NewTemplatePage() {
  const { authUser, profile } = await requireAuth()
  if (!(await canManageTemplates(createServiceClient(), { id: authUser.id, role: profile.role, custom_role_id: profile.custom_role_id }))) redirect('/signing')
  return (
    <>
      <Nav />
      <main className="px-3 py-4">
        <PageHeader title="New template" />
        <SendDocumentFlow mode="template" />
      </main>
    </>
  )
}
