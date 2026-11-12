export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SendDocumentFlow from '@/components/signing/SendDocumentFlow'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

/** Send a document for signature. Optional ?customerId=&opportunityId=&jobId=&name=&email= pre-fill the signer and file the signed copy on that customer. */
export default async function NewSignaturePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { authUser, profile } = await requireAuth()
  if (await resolveSalesDocAccessBarred(createServiceClient(), authUser.id, profile)) redirect('/today')
  const clip = (v: string | undefined, n: number) => (v ? v.slice(0, n) : undefined)
  return (
    <>
      <Nav />
      <main className="px-3 py-4">
        <PageHeader title="Send for signature" />
        <SendDocumentFlow mode="send" me={{ name: String((profile as { full_name?: string; name?: string }).full_name ?? (profile as { name?: string }).name ?? '').slice(0, 120), email: String((profile as { email?: string }).email ?? '').slice(0, 200) }} prefill={{ templateId: clip(searchParams.template, 40), customerId: clip(searchParams.customerId, 40), opportunityId: clip(searchParams.opportunityId, 40), jobId: clip(searchParams.jobId, 40), name: clip(searchParams.name, 120), email: clip(searchParams.email, 200) }} />
      </main>
    </>
  )
}
