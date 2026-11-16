'use client'

/**
 * "History: versions shown to the customer" on the proposal page. Each row is a stored snapshot (lib/proposal-snapshots.ts);
 * View PDF rebuilds that exact PDF with the same renderer the download uses. Hidden when there are none (or the list can't be read).
 */
import { useEffect, useState } from 'react'

import { renderProposalPdfBlob } from '@/components/proposal-pdf-render'
import { toast } from '@/components/ui/toast'
import { formatMoney } from '@/lib/format'
import type { ProposalPdfSnapshot, SnapshotSummary } from '@/lib/proposal-snapshots'

const REASON_LABEL: Record<SnapshotSummary['reason'], string> = { pdf: 'PDF made', sent: 'Marked sent', quote_link: 'Quote link' }

export default function ProposalSnapshotHistory({ proposalId, refreshKey = 0 }: { proposalId: string; refreshKey?: number }) {
  const [items, setItems] = useState<SnapshotSummary[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/proposals/${proposalId}/snapshots`)
      .then((r) => (r.ok ? r.json() : { snapshots: [] }))
      .then((d) => { if (alive) setItems(Array.isArray(d.snapshots) ? d.snapshots : []) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [proposalId, refreshKey])

  if (items.length === 0) return null

  const view = async (id: string) => {
    setBusy(id)
    // Open the tab inside the tap (mobile browsers block a window opened after the wait), then point it at the PDF.
    const tab = window.open('', '_blank')
    try {
      const res = await fetch(`/api/proposals/${proposalId}/snapshots?id=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error('not found')
      const { snapshot } = (await res.json()) as { snapshot: ProposalPdfSnapshot }
      const url = URL.createObjectURL(await renderProposalPdfBlob(snapshot))
      if (tab) tab.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = 'proposal.pdf'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
    } catch {
      tab?.close()
      toast.error('Could not rebuild that PDF. Please try again.')
    }
    setBusy(null)
  }

  return (
    <div className="mt-8 pt-8 border-t" data-testid="proposal-snapshot-history">
      <h3 className="text-lg font-semibold text-gray-900">History: versions shown to the customer</h3>
      <ul className="mt-4 space-y-3">
        {items.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[#2c2c2a]">
              <p className="text-base font-medium">{new Date(s.createdAt).toLocaleString()}</p>
              <p className="text-sm">
                {REASON_LABEL[s.reason] ?? s.reason}
                {s.createdByName ? ` · ${s.createdByName}` : ''}
                {s.total != null ? ` · ${formatMoney(s.total)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => view(s.id)}
              disabled={busy !== null}
              className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-[#2c2c2a] hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
            >
              {busy === s.id ? 'Building…' : 'View PDF'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
