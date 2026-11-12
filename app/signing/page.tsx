export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SigningList from '@/components/signing/SigningList'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

/** Everything out for signature, and the saved templates. */
export default async function SigningPage() {
  const { authUser, profile } = await requireAuth()
  if (await resolveSalesDocAccessBarred(createServiceClient(), authUser.id, profile)) redirect('/today')
  return (
    <>
      <Nav />
      <main className="px-3 py-4">
        <PageHeader title="Signatures" />
        <SigningList />
      </main>
    </>
  )
}
