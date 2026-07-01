import type { MaterialsOrderItem } from '@/lib/materials-order-list'

export type JobMaterialOrderOverrideRow = {
  id: string
  job_id: string
  item_key: string
  qty_text: string | null
  excluded: boolean
  note: string | null
  updated_by: string | null
  updated_at: string
}

export type MaterialOrderOverrideInput = {
  qty_text?: string | null
  excluded?: boolean
  note?: string | null
}

export type DisplayMaterialsOrderItem = MaterialsOrderItem & {
  computedQty: string | null
  computedDetail: string | null
  computedNote: string | null
  isExcluded: boolean
  isEdited: boolean
  overrideNote: string | null
}

export function applyMaterialOrderOverrides(
  items: MaterialsOrderItem[],
  overrides: JobMaterialOrderOverrideRow[]
): DisplayMaterialsOrderItem[] {
  const byKey = new Map(overrides.map((o) => [o.item_key, o]))

  return items.map((item) => {
    const override = byKey.get(item.key)
    const isExcluded = override?.excluded === true
    const hasQtyOverride = override?.qty_text != null && override.qty_text.trim() !== ''
    const hasNoteOverride = override?.note != null && override.note.trim() !== ''
    const isEdited = isExcluded || hasQtyOverride || hasNoteOverride

    return {
      ...item,
      qty: isExcluded ? null : hasQtyOverride ? override!.qty_text!.trim() : item.qty,
      note: hasNoteOverride ? override!.note!.trim() : item.note,
      computedQty: item.qty,
      computedDetail: item.detail,
      computedNote: item.note,
      isExcluded,
      isEdited,
      overrideNote: hasNoteOverride ? override!.note!.trim() : null,
    }
  })
}
