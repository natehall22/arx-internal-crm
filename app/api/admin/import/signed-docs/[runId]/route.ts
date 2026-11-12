import { NextResponse } from 'next/server'

import { importOwner } from '@/lib/jobber-import/access'
import { runProgress } from '@/lib/jobber-import/db'
import {
  addEnvelopeIndex,
  confirmUploads,
  discardSignedRun,
  dropUnfinished,
  importBatch,
  loadIndexFiles,
  loadSignedRun,
  matchStep,
  readStep,
  registerFiles,
  removeEnvelopeIndex,
  reviewGroups,
  savePicks,
  setProvider,
  signedSummary,
  startSignedImport,
  startSignedUndo,
  undoBatch,
} from '@/lib/signed-import/db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** GET — everything the Move signed documents screen shows for one import. */
export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  const admin = createServiceClient()
  const run = await loadSignedRun(admin, owner.org_id, params.runId)
  if (!run) return notFound()
  const [indexFiles, progress] = await Promise.all([loadIndexFiles(admin, owner.org_id, run.id), runProgress(admin, owner.org_id, run.id)])
  const review = run.status === 'draft' ? await reviewGroups(admin, owner.org_id, run) : null
  const summary = run.status === 'draft' ? null : await signedSummary(admin, owner.org_id, run)
  const provider = (run.mapping as Record<string, unknown>)?.provider
  return NextResponse.json({ run: { ...run, summary: undefined }, indexFiles, progress, review, summary, provider: provider && typeof provider === 'object' ? (provider as { value?: string }).value || '' : '' })
}

/**
 * POST — one step: { action }
 *   register { files[{name,dir,origin,size,sha256}], skipped? } · confirm { itemIds[] } · addIndex { name, text } · removeIndex { fileId }
 *   dropUnfinished · provider { value } · read · match { at } · picks { picks } · discard
 *   import (starts, then one batch per call) · undo (starts, then one batch per call)
 */
export async function POST(request: Request, { params }: { params: { runId: string } }) {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  const admin = createServiceClient()
  const run = await loadSignedRun(admin, owner.org_id, params.runId)
  if (!run) return notFound()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const answer = (r: { ok: true } | { ok: false; status: number; error: string }, extra: Record<string, unknown> = {}) =>
    r.ok ? NextResponse.json({ ...extra, ...r }) : NextResponse.json({ error: r.error }, { status: r.status })

  switch (action) {
    case 'register':
      return answer(await registerFiles(admin, owner.org_id, run, body?.files, body?.skipped))
    case 'confirm':
      return answer(await confirmUploads(admin, owner.org_id, run, body?.itemIds))
    case 'addIndex': {
      const name = typeof body?.name === 'string' ? body.name : ''
      const text = typeof body?.text === 'string' ? body.text : ''
      if (!name || !text) return NextResponse.json({ error: 'name and text are required' }, { status: 400 })
      return answer(await addEnvelopeIndex(admin, owner.org_id, run, name, text))
    }
    case 'removeIndex':
      return answer(await removeEnvelopeIndex(admin, owner.org_id, run, String(body?.fileId ?? '')))
    case 'dropUnfinished':
      return answer(await dropUnfinished(admin, owner.org_id, run))
    case 'provider':
      return answer(await setProvider(admin, owner.org_id, run, body?.value))
    case 'read':
      return answer(await readStep(admin, owner.org_id, run))
    case 'match':
      return answer(await matchStep(admin, owner.org_id, run, typeof body?.at === 'number' && body.at >= 0 ? Math.floor(body.at) : 0))
    case 'picks':
      return answer(await savePicks(admin, owner.org_id, run, body?.picks))
    case 'discard':
      return answer(await discardSignedRun(admin, owner.org_id, run))
    case 'import': {
      if (run.status === 'draft') {
        const s = await startSignedImport(admin, owner.org_id, run)
        if (!s.ok) return answer(s)
        run.status = 'importing'
      }
      return answer(await importBatch(admin, owner.org_id, owner.id, run))
    }
    case 'undo': {
      if (run.status === 'done') {
        const s = await startSignedUndo(admin, owner.org_id, run)
        if (!s.ok) return answer(s)
        run.status = 'undoing'
      }
      return answer(await undoBatch(admin, owner.org_id, run))
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
