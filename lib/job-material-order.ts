/**
 * Materials Order Sheet — the one-page "what to buy" hand-off ops sends to the supplier.
 *
 * Sibling of {@link buildJobRunSheet}: the run sheet goes to the crew, this goes to the supplier.
 * It is not a second assembly — it is a view of the run sheet's. Squares, LF, starter, customer,
 * proposal, and the product/accessory text all come off the same {@link JobRunSheetData}, so the
 * two sheets cannot disagree about a job. (They did: the run sheet read raw `proposals.sold_squares`
 * while this read the sold-scope resolver, and 26-0046 printed 79.67 sq to the crew and 80.0 sq to
 * the supplier.) Assembled fresh per request and never cached.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { buildJobRunSheet, type JobRunSheetData, type RunSheetChangeOrder } from '@/lib/job-run-sheet'
import type { DisplayMaterialsOrderItem } from '@/lib/materials-order-overrides'

export type JobMaterialOrderSection = {
  title: string
  rows: DisplayMaterialsOrderItem[]
}

export type JobMaterialOrderData = {
  jobId: string
  orgName: string
  orgPhone: string | null
  jobNumber: string
  customerName: string
  address: string | null
  proposalNumber: string | null
  /** The run sheet's "Materials & products" as it prints, ops edits included — the supplier needs the product line. */
  product: string | null
  /** The run sheet's "Accessories" as it prints, so what was sold sits next to the "confirm" rows. */
  accessories: string | null
  /** Signed COs — added/removed work that is NOT reflected in the computed quantities. */
  changeOrders: RunSheetChangeOrder[]
  sections: JobMaterialOrderSection[]
  /** True when nothing at all resolved — the caller should say so rather than print an empty sheet. */
  isEmpty: boolean
  generatedAt: string
}

export function materialOrderFromRunSheet(sheet: JobRunSheetData): JobMaterialOrderData {
  // Excluded rows are ops saying "not on this order" — they must not reach the supplier.
  const items = sheet.materialOrder.filter((item) => !item.isExcluded)

  const sections: JobMaterialOrderSection[] = [
    { title: 'Order', rows: items.filter((i) => i.status === 'ready') },
    { title: 'Confirm before ordering', rows: items.filter((i) => i.status === 'confirm') },
    { title: 'Manual — count in field', rows: items.filter((i) => i.status === 'manual') },
  ].filter((section) => section.rows.length > 0)

  return {
    jobId: sheet.jobId,
    orgName: sheet.orgName,
    orgPhone: sheet.orgPhone,
    jobNumber: sheet.jobNumber || sheet.jobId,
    customerName: sheet.homeowner.name,
    address: sheet.address ?? null,
    proposalNumber: sheet.proposalNumber,
    product: sheet.fields.materials_and_products.value,
    accessories: sheet.fields.accessories.value,
    changeOrders: sheet.changeOrders,
    sections,
    isEmpty: items.length === 0,
    generatedAt: sheet.generatedAt,
  }
}

export async function buildJobMaterialOrder(
  admin: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<JobMaterialOrderData | null> {
  const sheet = await buildJobRunSheet(admin, orgId, jobId)
  return sheet ? materialOrderFromRunSheet(sheet) : null
}
