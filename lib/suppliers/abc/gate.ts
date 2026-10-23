import type { OpenApproval } from '@/lib/suppliers/abc/settings-db'

export type GateDecision =
  | { action: 'allow' }
  | { action: 'allow_and_consume'; approvalId: string }
  | { action: 'request'; message: string }
  | { action: 'block'; message: string }

/** An order needs a second person at/over the threshold, or whenever the amount can't be worked out (unknown counts as over). */
export function needsSecondApprover(estimatedTotalCents: number | null, thresholdCents: number): boolean {
  return estimatedTotalCents === null || estimatedTotalCents >= thresholdCents
}

/**
 * The second-approver rule, as a pure decision:
 *  - small, known orders go through;
 *  - otherwise the FIRST person's send only records a request (nothing goes out);
 *  - a DIFFERENT owner opening the same order and pressing Send approves it and places it;
 *  - nobody approves their own request, and a changed order (different content hash) starts over.
 */
export function decideSecondApproval(args: {
  estimatedTotalCents: number | null
  thresholdCents: number
  actor: { id: string; isOwner: boolean }
  open: OpenApproval | null
}): GateDecision {
  if (!needsSecondApprover(args.estimatedTotalCents, args.thresholdCents)) return { action: 'allow' }
  const reason =
    args.estimatedTotalCents === null
      ? 'This order has lines with no estimated price, so its size is unknown.'
      : 'This order is over the company limit.'
  if (!args.open) {
    return { action: 'request', message: `${reason} A second person (an owner) has to approve it. Your request is saved — ask them to open this job and press Send.` }
  }
  if (args.open.requestedBy === args.actor.id) {
    return { action: 'block', message: 'Waiting for a second person (an owner) to approve this order. You cannot approve your own.' }
  }
  if (!args.actor.isOwner) {
    return { action: 'block', message: 'Only an owner can approve an order this size.' }
  }
  return { action: 'allow_and_consume', approvalId: args.open.id }
}
