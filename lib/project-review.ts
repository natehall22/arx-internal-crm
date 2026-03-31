/**
 * Project review questionnaire: sales/ops handoff so install crews know what was sold.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProjectReviewAnswers = {
  /** Full scope: what products, line items, warranty tier, exclusions */
  scopeSummary: string
  /** Shingle/flat/material brand, color, underlayment, accessories package */
  materialsAndProducts: string
  /** Tear-off layers, decking repairs, ventilation */
  tearOffAndDecking: string
  /** Gutters, drip edge, skylights, chimney, flashings */
  accessories: string
  /** Steep pitch, two-story, tight lot, dogs, gate codes */
  siteConditions: string
  /** Permits, HOA approval, HOA rules */
  permitsAndHoa: string
  /** What the homeowner was told about timeline / process */
  customerExpectations: string
  /** Financing product, lender, payment structure, promo, what was explained to homeowner */
  financing: string
  /** Anything ops must know before install */
  openItems: string
}

export const emptyProjectReviewAnswers = (): ProjectReviewAnswers => ({
  scopeSummary: '',
  materialsAndProducts: '',
  tearOffAndDecking: '',
  accessories: '',
  siteConditions: '',
  permitsAndHoa: '',
  customerExpectations: '',
  financing: '',
  openItems: '',
})

export type ProjectReviewStored = {
  answers: ProjectReviewAnswers
  submittedAt: string
  submittedByUserId: string
}

export function parseProjectReviewStored(raw: unknown): ProjectReviewStored | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!o.answers || typeof o.answers !== 'object') return null
  return raw as ProjectReviewStored
}

/** Display order for questionnaire fields (job detail, exports, notes). */
export const PROJECT_REVIEW_FIELD_ORDER: (keyof ProjectReviewAnswers)[] = [
  'scopeSummary',
  'materialsAndProducts',
  'tearOffAndDecking',
  'accessories',
  'siteConditions',
  'permitsAndHoa',
  'customerExpectations',
  'financing',
  'openItems',
]

export const PROJECT_REVIEW_FIELD_LABELS: Record<keyof ProjectReviewAnswers, string> = {
  scopeSummary: 'What was sold (scope)',
  materialsAndProducts: 'Materials & products',
  tearOffAndDecking: 'Tear-off, layers & decking',
  accessories: 'Accessories (gutters, skylights, etc.)',
  siteConditions: 'Site / access / safety',
  permitsAndHoa: 'Permits & HOA',
  customerExpectations: 'Customer expectations',
  financing: 'Financing',
  openItems: 'Open questions / handoff items',
}

export function formatProjectReviewForJobNote(
  answers: ProjectReviewAnswers,
  meta: { submitterName: string; submittedAt: Date }
): string {
  const lines: string[] = [
    `PROJECT REVIEW — ${meta.submittedAt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })} — ${meta.submitterName}`,
    '',
  ]
  for (const key of PROJECT_REVIEW_FIELD_ORDER) {
    const v = answers[key]?.trim()
    if (v) {
      lines.push(`${PROJECT_REVIEW_FIELD_LABELS[key]}`, v, '')
    }
  }
  const syncId = meta.submittedAt.toISOString()
  return `${lines.join('\n').trim()}\n\n_review_id:${syncId}`
}

export function mergeOpsNotesBlock(existing: string | null | undefined, block: string): string {
  const prev = (existing || '').trim()
  if (!prev) return block
  return `${prev}\n\n${block}`
}

function truncatePreview(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Short text for job board cards — prefers structured project review, then scope/product/ops notes. */
export function handoffPreviewForJobBoard(project: {
  project_review?: unknown
  ops_notes?: string | null
  scope_of_work?: string | null
  product_summary?: string | null
} | null | undefined): string | null {
  if (!project) return null
  const pr = parseProjectReviewStored(project.project_review)
  if (pr?.answers) {
    const parts = [
      pr.answers.scopeSummary,
      pr.answers.materialsAndProducts,
      pr.answers.financing,
      pr.answers.openItems,
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    if (parts.length) return truncatePreview(parts[0], 220)
  }
  if (project.scope_of_work?.trim()) return truncatePreview(project.scope_of_work, 220)
  if (project.product_summary?.trim()) return truncatePreview(project.product_summary, 220)
  if (project.ops_notes?.trim()) {
    const o = project.ops_notes.trim()
    const idx = o.lastIndexOf('PROJECT REVIEW')
    const slice = idx >= 0 ? o.slice(idx) : o
    return truncatePreview(slice, 220)
  }
  return null
}

export type ImportProjectReviewResult =
  | { ok: true; created: boolean; skipped?: string }
  | { ok: false; error: string }

/**
 * When a production job is created after a project review was saved on the project only,
 * copy that handoff into `production_job_notes` so ops sees it on the job.
 * Skips if the same review timestamp is already present on a note (idempotent).
 */
export async function importProjectReviewNoteToJob(
  admin: SupabaseClient,
  opts: { jobId: string; projectId: string; actorUserId: string }
): Promise<ImportProjectReviewResult> {
  const { data: project, error: pErr } = await admin
    .from('projects')
    .select('project_review')
    .eq('id', opts.projectId)
    .single()

  if (pErr || !project) {
    return { ok: false, error: 'project_not_found' }
  }

  const stored = parseProjectReviewStored(project.project_review)
  if (!stored) {
    return { ok: true, created: false, skipped: 'no_project_review' }
  }

  const { data: dup } = await admin
    .from('production_job_notes')
    .select('id')
    .eq('job_id', opts.jobId)
    .like('note', `%${stored.submittedAt}%`)
    .maybeSingle()

  if (dup?.id) {
    return { ok: true, created: false, skipped: 'already_on_job' }
  }

  let submitterName = 'Team member'
  const { data: sub } = await admin
    .from('users')
    .select('full_name')
    .eq('id', stored.submittedByUserId)
    .maybeSingle()
  if (sub?.full_name) submitterName = sub.full_name

  const body = formatProjectReviewForJobNote(stored.answers, {
    submitterName,
    submittedAt: new Date(stored.submittedAt),
  })
  const note = `IMPORTED FROM PROJECT (when job was created)\n\n${body}`

  const { error: insErr } = await admin.from('production_job_notes').insert({
    job_id: opts.jobId,
    user_id: opts.actorUserId,
    note,
    is_internal: true,
  })

  if (insErr) {
    console.error('importProjectReviewNoteToJob:', insErr)
    return { ok: false, error: insErr.message }
  }

  return { ok: true, created: true }
}
