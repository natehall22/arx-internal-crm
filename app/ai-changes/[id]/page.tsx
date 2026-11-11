import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { loadAiChange, personContext } from '@/lib/ai-connector/changes-review'
import { ToolError } from '@/lib/ai-connector/tools/types'
import { createServiceClient } from '@/lib/supabase/service'

import ReviewClient from './ReviewClient'

export const dynamic = 'force-dynamic'

/** A change an AI app prepared for the signed-in person: the exact change in plain words, and the only place it can be approved. */
export default async function AiChangePage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  const ctx = await personContext({ admin: createServiceClient(), profile, userId: profile.id, orgId: profile.org_id })
  let view: Awaited<ReturnType<typeof loadAiChange>> | null = null
  try {
    view = await loadAiChange(ctx, params.id)
  } catch (e) {
    if (!(e instanceof ToolError)) throw e
  }
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-xl px-4 py-6 text-ink">
        {!view ? (
          <>
            <h1 className="text-xl font-semibold">Change not found</h1>
            <p className="mt-3 text-base">This change does not exist, or it was prepared for someone else.</p>
          </>
        ) : (
          <ReviewClient
            id={view.row.id}
            appName={view.clientName}
            title={view.row.preview.title}
            lines={view.row.preview.lines}
            links={view.row.preview.links}
            warnings={view.row.preview.warnings ?? []}
            status={view.expired ? 'expired' : view.row.status}
            result={view.row.result ? { summary: view.row.result.summary, links: view.row.result.links } : null}
            writesOn={ctx.writesAllowed === true}
          />
        )}
      </main>
    </div>
  )
}
