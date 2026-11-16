/**
 * Browser side of the snapshot record: POST what was shown. It NEVER throws and never blocks — a failed save (network, 4xx/5xx,
 * table not there yet) returns false and the PDF download / send carries on exactly as before.
 */
import type { ProposalPdfSnapshot } from '@/lib/proposal-snapshots'

export async function postProposalSnapshot(
  proposalId: string,
  reason: 'pdf' | 'sent',
  snapshot: ProposalPdfSnapshot,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(`/api/proposals/${proposalId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, snapshot }),
    })
    return res.ok
  } catch (err) {
    console.error('Proposal snapshot not saved:', err)
    return false
  }
}
