type AnyError = { code?: string; message?: string } | null | undefined

export type UiProductOrderStatus = 'ordered' | 'received' | 'paid' | 'returned'

export function getSignedOrderAmount(amount: number, status: UiProductOrderStatus) {
  const numericAmount = Number(amount || 0)
  return status === 'returned' ? -Math.abs(numericAmount) : numericAmount
}

export function isMissingJobProductOrdersTable(error: AnyError) {
  const message = error?.message || ''
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    (message.includes('job_product_orders') && message.includes('schema cache'))
  )
}

function normalizeNotesForStatus(notes: string | null | undefined, status: UiProductOrderStatus) {
  const raw = (notes || '').replace(/\s*\[ui_status:(ordered|received|paid|returned)\]\s*/g, '').trim()
  return raw ? `${raw}\n[ui_status:${status}]` : `[ui_status:${status}]`
}

function readStatusFromNotes(notes: string | null | undefined): UiProductOrderStatus | null {
  if (!notes) return null
  const match = notes.match(/\[ui_status:(ordered|received|paid|returned)\]/)
  return (match?.[1] as UiProductOrderStatus) || null
}

function notesToDescription(notes: string | null | undefined) {
  if (!notes) return null
  const cleaned = notes.replace(/\s*\[ui_status:(ordered|received|paid|returned)\]\s*/g, '').trim()
  return cleaned || null
}

function mapFallbackStatusToUi(status: string | null | undefined, notes: string | null | undefined): UiProductOrderStatus {
  const fromNotes = readStatusFromNotes(notes)
  if (fromNotes) return fromNotes
  if (status === 'delivered') return 'received'
  return 'ordered'
}

function mapUiStatusToFallback(status: UiProductOrderStatus) {
  if (status === 'received' || status === 'paid') return 'delivered'
  if (status === 'returned') return 'pending'
  return 'ordered'
}

export function mapMaterialOrdersRowsToUi(rows: any[] | null | undefined) {
  return (rows || []).map((row) => {
    const firstItem = Array.isArray(row.items) ? row.items[0] : null
    return {
      id: row.id,
      org_id: row.org_id,
      job_id: row.job_id,
      description: notesToDescription(row.notes) || firstItem?.description || 'Material Order',
      supplier: row.supplier,
      amount: parseFloat(row.total_cost || 0),
      status: mapFallbackStatusToUi(row.status, row.notes),
      created_at: row.created_at,
    }
  })
}

export function buildFallbackInsert(input: {
  orgId: string
  jobId: string
  description: string
  supplier?: string | null
  amount: number
  status: UiProductOrderStatus
  userId: string
}) {
  return {
    org_id: input.orgId,
    job_id: input.jobId,
    supplier: input.supplier?.trim() || 'Unknown',
    items: [{ description: input.description.trim() }],
    status: mapUiStatusToFallback(input.status),
    total_cost: input.amount,
    created_by: input.userId,
    notes: normalizeNotesForStatus(input.description.trim(), input.status),
  }
}

export function buildFallbackUpdate(existingNotes: string | null | undefined, status: UiProductOrderStatus) {
  return {
    status: mapUiStatusToFallback(status),
    notes: normalizeNotesForStatus(existingNotes, status),
  }
}

/** Full edit of a material_orders row (fallback table) — description, supplier, amount, status */
export function buildFallbackFullUpdate(input: {
  description: string
  supplier: string | null
  amount: number
  status: UiProductOrderStatus
}) {
  const desc = input.description.trim()
  return {
    supplier: input.supplier?.trim() || 'Unknown',
    items: [{ description: desc }],
    total_cost: input.amount,
    status: mapUiStatusToFallback(input.status),
    notes: normalizeNotesForStatus(desc, input.status),
  }
}

export async function computeMaterialCostTotalForJob(
  serviceSupabase: any,
  jobId: string
) {
  const { data, error } = await serviceSupabase
    .from('job_product_orders')
    .select('amount, status')
    .eq('job_id', jobId)

  if (!error) {
    return (data || []).reduce(
      (sum: number, row: any) => sum + getSignedOrderAmount(Number(row.amount || 0), row.status),
      0
    )
  }

  if (!isMissingJobProductOrdersTable(error)) {
    throw error
  }

  const { data: fallbackData, error: fallbackError } = await serviceSupabase
    .from('material_orders')
    .select('total_cost, status, notes, items, supplier, org_id, job_id, id, created_at')
    .eq('job_id', jobId)

  if (fallbackError) {
    throw fallbackError
  }

  const mapped = mapMaterialOrdersRowsToUi(fallbackData)
  return mapped.reduce(
    (sum: number, row: any) => sum + getSignedOrderAmount(Number(row.amount || 0), row.status),
    0
  )
}

/**
 * Keep `production_jobs.material_cost` in step with the job's product orders WITHOUT clobbering it.
 *
 * Ops add orders as they go (QXO, then Lowe's, then a one-off), so an order change must move the
 * job's cost. But the column also holds hand-reconciled figures (the ARX Tracker), and overwriting it
 * with the order total once replaced Cox's $11,318.09 of shingles with its $8,050 solar D&R order.
 * So: an empty column is seeded from the order total; a stored column moves by exactly what this
 * change added or removed (`totalBefore` is the order total captured before the mutation); with no
 * `totalBefore` a stored column is left alone.
 */
export async function syncJobMaterialCost(
  serviceSupabase: any,
  orgId: string,
  jobId: string,
  totalBefore?: number
) {
  const total = await computeMaterialCostTotalForJob(serviceSupabase, jobId)

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: job, error: readError } = await serviceSupabase
      .from('production_jobs')
      .select('material_cost')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .single()
    if (readError) throw readError

    const current = job?.material_cost
    const hasCurrent = current !== null && current !== undefined
    if (hasCurrent && totalBefore === undefined) return total

    const next = hasCurrent
      ? Math.max(0, Math.round((Number(current) + (total - (totalBefore as number))) * 100) / 100)
      : total
    if (hasCurrent && next === Number(current)) return total

    // Compare-and-set so two orders saved at once can't overwrite each other's delta.
    let update = serviceSupabase
      .from('production_jobs')
      .update({ material_cost: next })
      .eq('id', jobId)
      .eq('org_id', orgId)
    update = hasCurrent ? update.eq('material_cost', current) : update.is('material_cost', null)
    const { data: updated, error } = await update.select('id')
    if (error) throw error
    if (updated && updated.length > 0) return total
  }

  throw new Error(`Could not sync material cost for job ${jobId}: concurrent updates`)
}
