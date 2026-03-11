type AnyError = { code?: string; message?: string } | null | undefined

export type UiProductOrderStatus = 'ordered' | 'received' | 'paid' | 'returned'

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
