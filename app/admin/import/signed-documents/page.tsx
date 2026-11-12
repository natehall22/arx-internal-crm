import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import MoveSignedDocuments from '@/components/signed-import/MoveSignedDocuments'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Settings → Move signed documents: bring contracts already signed in DocuSign, Dropbox Sign or PandaDoc into customer documents (owners only). */
export default async function MoveSignedDocumentsPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <PageHeader title="Move signed documents" subtitle="Bring contracts you already signed in another tool into each customer’s documents. They are kept as read-only copies, and the whole import can be undone." />
        <MoveSignedDocuments />
      </main>
    </div>
  )
}
