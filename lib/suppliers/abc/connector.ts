import { randomUUID } from 'node:crypto'

import { submitAbcOrder } from '@/lib/suppliers/abc/client'
import { abcCredentials, abcGloballyEnabled } from '@/lib/suppliers/abc/config'
import { buildAbcOrder, lineProblems } from '@/lib/suppliers/abc/payload'
import type { SupplierOrderConnector } from '@/lib/suppliers/send-order'
import type { LineSnapshot, SupplierRecord } from '@/lib/material-sourcing'

/** Why ABC ordering is off for this supplier right now, or null. Used by the preview AND again at transmit. */
export function abcChannelProblem(supplier: SupplierRecord, lines?: LineSnapshot[]): string | null {
  const s = supplier.api
  if (!s) return `${supplier.name} is set to order by API but has no ABC connection settings. Ask an owner to finish them (or switch it to email).`
  if (!abcGloballyEnabled()) return 'Ordering through ABC is switched off for the whole system. Email the order instead.'
  if (!s.orgOrderingEnabled) return 'Ordering through supplier APIs is switched off for the company. An owner can turn it on.'
  if (!s.orderingEnabled) return `Ordering through the API is switched off for ${supplier.name}. Email the order instead.`
  if (!abcCredentials(s.environment)) return `ABC ${s.environment} sign-in is not set up in this deployment.`
  if (lines) {
    const bad = lineProblems(lines, s.itemMap)
    if (bad.length > 0) return `Cannot send to ABC yet: ${bad[0]}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ''}. Email the order instead.`
  }
  return null
}

/** ABC has no change/cancel call in the order API, so only a first order may go through it: a "revision" or "resend" would create a SECOND order at the branch. */
export function abcKindProblem(kind: string): string | null {
  return kind === 'order' ? null : 'ABC orders cannot be changed or cancelled through the API. Call the branch, then record it here.'
}

export const abcSupplyConnector: SupplierOrderConnector = {
  label: 'ABC Supply ordering API',
  canHandle: (supplier) => supplier.connectionType === 'api' && supplier.api?.provider === 'abc_supply',
  problem: (supplier, lines) => abcChannelProblem(supplier, lines),
  kindProblem: abcKindProblem,
  async transmit(order) {
    // Re-check every switch at the last moment: a switch flipped after the preview must win.
    const problem = abcChannelProblem(order.supplier, order.lines)
    if (problem) throw new Error(`refused: ${problem}`)
    const kindProblem = abcKindProblem(order.kind)
    if (kindProblem) throw new Error(`refused: ${kindProblem}`)
    const settings = order.supplier.api!
    const built = buildAbcOrder({
      settings,
      requestId: randomUUID(),
      poLabel: order.poLabel,
      jobNumber: order.jobNumber,
      deliveryDate: order.deliveryDate,
      deliveryAddress: order.deliveryAddress,
      deliveryNotes: order.deliveryNotes,
      note: order.note,
      lines: order.lines,
    })
    if (!built.ok) throw new Error(`refused: ${built.problems[0]}`)
    const result = await submitAbcOrder(settings.environment, built.body)
    return { reference: result.confirmationNumber }
  },
}
