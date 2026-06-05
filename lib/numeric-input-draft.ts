/**
 * Controlled number inputs must keep draft text while editing.
 * Coerce to numbers only for preview math or on save — never `parseFloat(v) || 0` on change.
 */

export function formatNumericDraft(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Preview / calculator math while the field may be empty. */
export function previewNumber(draft: string | number, fallback = 0): number {
  if (draft === '' || draft === null || draft === undefined) return fallback
  const n = typeof draft === 'number' ? draft : Number(draft)
  return Number.isFinite(n) ? n : fallback
}

/** Parse draft on save; empty/invalid drafts stay null unless an explicit fallback is provided. */
export function parseDraftFloat(
  draft: string | number,
  opts?: { required?: boolean; fallback?: number | null }
): number | null {
  const t = String(draft).trim()
  if (t === '') {
    return opts?.fallback ?? null
  }
  const n = parseFloat(t)
  if (!Number.isFinite(n)) {
    return opts?.fallback ?? null
  }
  return n
}
