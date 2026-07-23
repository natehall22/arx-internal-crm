import type { InsideSalesQueueKind } from '@/lib/inside-sales-follow-up'

/**
 * Priority + presentation engine for the inside-sales queue.
 * Single source of truth for call ordering, the card "story", and retirement,
 * shared by the queue API, the /inside-sales page, and the queue-maintenance cron.
 */

export type HandoffContext = {
  claim_filed?: 'yes' | 'no' | 'customer_filing' | null
  claim_number?: string | null
  insurance_carrier?: string | null
  adjuster_meeting_at?: string | null
  decision_maker?: string | null
  best_call_window?: 'morning' | 'afternoon' | 'evening' | 'anytime' | null
  context_line?: string | null
}

export type PriorityInput = {
  followUpKind: InsideSalesQueueKind
  callableNow: boolean
  /** opportunity.follow_up_at */
  followUpAt: string | null
  /** when the lead became callable (eligibleAtIso from callability) */
  eligibleAtIso: string | null
  /** inspection_outcome_at, falls back to created_at upstream */
  enteredQueueAt: string | null
  attemptCount: number
  lastAttemptAt: string | null
}

/**
 * Lower tier = called sooner. Within a tier, sort by tieBreakMs ascending.
 * 1 — scheduled call due/overdue (most overdue first)
 * 2 — never attempted, fresh (callable < 72h; newest first — speed to lead)
 * 3 — never attempted backlog (oldest first)
 * 4 — attempted, cadence due (longest since last attempt first)
 * 5 — attempted, cadence not yet due (soonest-due first)
 * 6 — future scheduled follow-up (soonest first)
 * 7 — not yet callable / rep grace (soonest to open first)
 */
export type QueuePriority = { tier: number; tieBreakMs: number }

const DAY_MS = 24 * 60 * 60 * 1000
const FRESH_WINDOW_MS = 72 * 60 * 60 * 1000

/** Days to wait after the Nth attempt before the lead is due again (decaying cadence). */
export const ATTEMPT_CADENCE_DAYS = [1, 2, 3, 5, 7, 10]

export function cadenceDaysForAttempts(attemptCount: number): number {
  if (attemptCount <= 0) return 0
  const idx = Math.min(attemptCount, ATTEMPT_CADENCE_DAYS.length) - 1
  return ATTEMPT_CADENCE_DAYS[idx]
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

export function getQueuePriority(input: PriorityInput, nowMs = Date.now()): QueuePriority {
  const followUpMs = ms(input.followUpAt)
  const eligibleMs = ms(input.eligibleAtIso)

  if (!input.callableNow) {
    // Rep grace or admin wait — sinks below everything callable.
    return { tier: 7, tieBreakMs: eligibleMs ?? Number.MAX_SAFE_INTEGER }
  }

  if (followUpMs !== null && followUpMs > nowMs) {
    return { tier: 6, tieBreakMs: followUpMs }
  }

  if (followUpMs !== null && followUpMs <= nowMs) {
    // Scheduled call that is due — most overdue first.
    return { tier: 1, tieBreakMs: followUpMs }
  }

  const enteredMs = ms(input.enteredQueueAt)

  if (input.attemptCount === 0) {
    const becameCallableMs = eligibleMs ?? enteredMs
    if (becameCallableMs !== null && nowMs - becameCallableMs <= FRESH_WINDOW_MS) {
      // Speed to lead: newest fresh lead first.
      return { tier: 2, tieBreakMs: -becameCallableMs }
    }
    return { tier: 3, tieBreakMs: enteredMs ?? Number.MAX_SAFE_INTEGER }
  }

  const lastAttemptMs = ms(input.lastAttemptAt)
  const dueAtMs =
    lastAttemptMs !== null
      ? lastAttemptMs + cadenceDaysForAttempts(input.attemptCount) * DAY_MS
      : nowMs
  if (dueAtMs <= nowMs) {
    return { tier: 4, tieBreakMs: lastAttemptMs ?? 0 }
  }
  return { tier: 5, tieBreakMs: dueAtMs }
}

export function comparePriority(a: QueuePriority, b: QueuePriority): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  return a.tieBreakMs - b.tieBreakMs
}

// ---------------------------------------------------------------------------
// Card story + call objective
// ---------------------------------------------------------------------------

export type StoryInput = {
  followUpKind: InsideSalesQueueKind
  /** Normalized inspection outcome id (e.g. insurance_follow_up) or null */
  outcomeId: string | null
  /** Admin label for the outcome ("Cancelled At Door/Didn't Pitch") */
  outcomeLabel: string | null
  knockbackReason: string | null
  enteredQueueAt: string | null
  handoffContext: HandoffContext | null
}

export type QueueStory = {
  /** One plain-English sentence: what happened and when. */
  story: string
  /** Imperative call objective, e.g. "Rebook the inspection". */
  objective: string
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
}

const KNOCKBACK_STORIES: Record<string, { story: string; objective: string }> = {
  credit_fail: {
    story: 'Closer met them but financing fell through',
    objective: 'Re-check finances and rebook the closer',
  },
  not_ready: {
    story: 'Closer met them but they were not ready to move forward',
    objective: 'Warm them up and rebook the closer',
  },
  price_objection: {
    story: 'Closer met them but price was the blocker',
    objective: 'Revisit budget and rebook the closer',
  },
}

export function getQueueStory(input: StoryInput): QueueStory {
  const when = shortDate(input.enteredQueueAt)
  const suffix = when ? ` on ${when}` : ''
  const ctx = input.handoffContext

  if (input.followUpKind === 'knockback') {
    const base = (input.knockbackReason && KNOCKBACK_STORIES[input.knockbackReason]) || {
      story: 'Closer met them but the deal knocked back',
      objective: 'Re-qualify and rebook the closer',
    }
    return { story: `${base.story}${suffix}.`, objective: base.objective }
  }

  if (input.followUpKind === 'storm') {
    return {
      story: `Recent storm activity (est.) was reported near this address${suffix}.`,
      objective: 'Offer a free inspection — property may have been impacted (est.)',
    }
  }

  if (input.followUpKind === 'didnt_sit') {
    return {
      story: `Inspection was booked but the customer did not sit${suffix}. Nobody has been pitched.`,
      objective: 'Rebook the inspection',
    }
  }

  // handoff
  const outcome = input.outcomeId || ''
  if (outcome === 'insurance_follow_up') {
    const claim =
      ctx?.claim_filed === 'yes'
        ? ` Claim filed${ctx.insurance_carrier ? ` with ${ctx.insurance_carrier}` : ''}${ctx.claim_number ? ` (#${ctx.claim_number})` : ''}.`
        : ctx?.claim_filed === 'customer_filing'
          ? ' Customer said they would file the claim themselves.'
          : ctx?.claim_filed === 'no'
            ? ' Claim was NOT filed yet.'
            : ''
    const adjuster = ctx?.adjuster_meeting_at
      ? ` Adjuster meeting ${shortDate(ctx.adjuster_meeting_at)}.`
      : ''
    return {
      story: `Roof inspected${suffix}; going through insurance.${claim}${adjuster}`,
      objective: ctx?.adjuster_meeting_at
        ? 'Confirm the adjuster meeting and ARX attendance'
        : ctx?.claim_filed === 'yes'
          ? 'Get the adjuster meeting date'
          : 'Confirm the claim got filed and get the claim number',
    }
  }
  if (outcome === 'failed_credit') {
    return {
      story: `Inspected${suffix} but financing did not qualify.`,
      objective: 'Re-check finances and rebook the closer',
    }
  }
  if (outcome === 'rescheduled') {
    return {
      story: `Appointment was rescheduled${suffix} and never completed.`,
      objective: 'Lock in the new inspection time',
    }
  }
  if (outcome === 'said_no') {
    return {
      story: `Customer said no after the presentation${suffix}.`,
      objective: 'Revive interest and rebook the closer',
    }
  }
  const label = input.outcomeLabel || 'follow-up'
  if (/cancel/i.test(label)) {
    return {
      story: `Customer cancelled at the door${suffix} — nobody has pitched them.`,
      objective: 'Rebook the inspection',
    }
  }
  if (/follow ?up/i.test(label)) {
    return {
      story: `Closer marked them "${label}"${suffix} — interested, but not then.`,
      objective: 'Re-open the conversation and rebook',
    }
  }
  return {
    story: `Inspection outcome "${label}"${suffix} — needs a call to move forward.`,
    objective: 'Re-engage and rebook',
  }
}

// ---------------------------------------------------------------------------
// Cadence suggestion after a logged result
// ---------------------------------------------------------------------------

/** Suggested next follow-up delay (days) after a logged call result; null = let the rep decide. */
export function suggestedNextAttemptDays(result: string): number | null {
  const r = result.trim().toLowerCase()
  if (r === 'no answer') return 2
  if (r === 'left voicemail') return 3
  if (r === 'wrong number') return null
  if (r === 'not interested') return null
  if (r.startsWith('spoke')) return null // rep sets it from the conversation
  if (r === 'no response yet' || r === 'sent text') return 2
  return null
}

// ---------------------------------------------------------------------------
// Auto-retirement
// ---------------------------------------------------------------------------

export const RETIRE_MIN_ATTEMPTS = 6
export const RETIRE_QUIET_DAYS = 7

export type RetirementInput = {
  attemptCount: number
  lastAttemptAt: string | null
  followUpAt: string | null
}

/**
 * A lead retires (auto-unresponsive) only after real effort: 6+ logged attempts,
 * nothing in the last 7 days, and no scheduled follow-up callback (past or future).
 * Never retires never-attempted leads — those are a backlog problem, not a dead lead.
 */
export function shouldAutoRetire(input: RetirementInput, nowMs = Date.now()): boolean {
  if (input.attemptCount < RETIRE_MIN_ATTEMPTS) return false
  const lastMs = ms(input.lastAttemptAt)
  if (lastMs === null || nowMs - lastMs < RETIRE_QUIET_DAYS * DAY_MS) return false
  // Any follow_up_at (rep-booked call, rescheduled callback, etc.) keeps the lead callable.
  if (input.followUpAt) return false
  return true
}
