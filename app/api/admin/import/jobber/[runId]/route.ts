import { NextResponse } from 'next/server'

import { importOwner } from '@/lib/jobber-import/access'
import {
  addFile,
  checkRun,
  discardRun,
  importBatch,
  itemsNeedingALook,
  loadCustomerNames,
  loadRun,
  loadRunFiles,
  plansToReview,
  recordDocuments,
  removeFile,
  runProgress,
  startImport,
  startUndo,
  undoBatch,
  updateDraft,
} from '@/lib/jobber-import/db'
import { matchFileNames } from '@/lib/jobber-import/files-match'
import { loadOrgTrades } from '@/lib/org-trades'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** GET — everything the Move from Jobber screen shows for one import. */
export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  const owner = await importOwner()
  if (!owner) return forbidden()
  const admin = createServiceClient()
  const run = await loadRun(admin, owner.org_id, params.runId)
  if (!run) return notFound()
  const [files, progress, trades] = await Promise.all([loadRunFiles(admin, owner.org_id, run.id), runProgress(admin, owner.org_id, run.id), loadOrgTrades(admin, owner.org_id)])
  const finished = run.status === 'done' || run.status === 'undone'
  const [needsALook, reviewPlans] = finished ? await Promise.all([itemsNeedingALook(admin, owner.org_id, run.id), run.status === 'done' ? plansToReview(admin, owner.org_id, run.id) : []]) : [[], []]
  return NextResponse.json({
    run,
    files,
    progress,
    trades: trades.filter((t) => t.active).map((t) => ({ slug: t.slug, label: t.label })),
    needsALook,
    reviewPlans,
  })
}

/**
 * POST — one step: { action }
 *   addFile { name, text } · removeFile { fileId } · update { fileId?, kind?, columns?, options? } · check · discard
 *   import (starts, then one batch per call) · undo (starts, then one batch per call)
 *   matchFiles { names[] } · recordDocuments { documentIds[] }
 */
export async function POST(request: Request, { params }: { params: { runId: string } }) {
  const owner = await importOwner()
  if (!owner) return forbidden()
  const admin = createServiceClient()
  const run = await loadRun(admin, owner.org_id, params.runId)
  if (!run) return notFound()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const answer = (r: { ok: true } | { ok: false; status: number; error: string }, extra: Record<string, unknown> = {}) =>
    r.ok ? NextResponse.json({ ...extra, ...r }) : NextResponse.json({ error: r.error }, { status: r.status })

  switch (action) {
    case 'addFile': {
      const name = typeof body?.name === 'string' ? body.name : ''
      const text = typeof body?.text === 'string' ? body.text : ''
      if (!name || !text) return NextResponse.json({ error: 'name and text are required' }, { status: 400 })
      return answer(await addFile(admin, owner.org_id, run, name, text))
    }
    case 'removeFile':
      return answer(await removeFile(admin, owner.org_id, run, String(body?.fileId ?? '')))
    case 'update':
      return answer(await updateDraft(admin, owner.org_id, run, { fileId: body?.fileId, kind: body?.kind, columns: body?.columns, options: body?.options }))
    case 'check':
      return answer(await checkRun(admin, owner.org_id, run))
    case 'discard':
      return answer(await discardRun(admin, owner.org_id, run))
    case 'import': {
      if (run.status === 'draft') {
        const s = await startImport(admin, owner.org_id, run)
        if (!s.ok) return answer(s)
        run.status = 'importing'
      }
      return answer(await importBatch(admin, owner.org_id, owner.id, run))
    }
    case 'undo': {
      if (run.status === 'done') {
        const s = await startUndo(admin, owner.org_id, run)
        if (!s.ok) return answer(s)
        run.status = 'undoing'
      }
      return answer(await undoBatch(admin, owner.org_id, run))
    }
    case 'matchFiles': {
      const names = Array.isArray(body?.names) ? (body!.names as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 500) : []
      const customers = await loadCustomerNames(admin, owner.org_id)
      return NextResponse.json({ matches: matchFileNames(names, customers), customers })
    }
    case 'recordDocuments':
      return answer(await recordDocuments(admin, owner.org_id, owner.id, run, body?.documentIds))
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
