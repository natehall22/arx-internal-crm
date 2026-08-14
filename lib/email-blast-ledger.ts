import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailBlastType } from '@/lib/admin-email-blasts'
import { EASTERN_TZ } from '@/lib/eastern-datetime'

const UNIQUE_VIOLATION = '23505'

/** Eastern calendar date (YYYY-MM-DD) a morning blast belongs to. */
export function getBlastSendDate(now: Date = new Date(), timeZone = EASTERN_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Reserves today's blast for this org. Returns false when another run already claimed it,
 * which is how the morning retry fires avoid double-sending.
 */
export async function claimDailyBlast(
  supabase: SupabaseClient,
  params: { orgId: string; blastType: EmailBlastType; sendDate: string }
): Promise<boolean> {
  const { error } = await supabase.from('email_blast_sends').insert({
    org_id: params.orgId,
    blast_type: params.blastType,
    send_date: params.sendDate,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false
    throw error
  }

  return true
}

/** Hands the day back so a later fire can retry — used when the claimed send delivered nothing. */
export async function releaseDailyBlast(
  supabase: SupabaseClient,
  params: { orgId: string; blastType: EmailBlastType; sendDate: string }
): Promise<void> {
  const { error } = await supabase
    .from('email_blast_sends')
    .delete()
    .eq('org_id', params.orgId)
    .eq('blast_type', params.blastType)
    .eq('send_date', params.sendDate)
    .is('sent_at', null)

  if (error) {
    console.error('[email-blast-ledger] Failed to release claim:', error.message)
  }
}

/** Reasons that mean "nothing to send today", as opposed to "the send failed and may retry". */
const TERMINAL_SKIP_REASONS = new Set(['no_recipients', 'smtp_not_configured'])

export type BlastResult = { sent: number; skipped: boolean; reason?: string }

/**
 * Runs a blast at most once per org, per type, per Eastern day.
 *
 * Claims the day before sending so the morning's retry fires (and the manual resend page)
 * cannot double-send, and hands the claim back when the send delivered nothing so a later
 * attempt can retry. `force` re-sends a day that is already recorded — the deliberate
 * "send it again anyway" path behind an explicit confirmation.
 */
export async function runClaimedBlast(
  supabase: SupabaseClient,
  params: {
    orgId: string
    blastType: EmailBlastType
    sendDate: string
    force?: boolean
    send: () => Promise<BlastResult>
  }
): Promise<BlastResult> {
  const claim = { orgId: params.orgId, blastType: params.blastType, sendDate: params.sendDate }
  const claimed = await claimDailyBlast(supabase, claim)

  if (!claimed && !params.force) {
    return { sent: 0, skipped: true, reason: `${params.blastType}_already_sent_today` }
  }

  let result: BlastResult
  try {
    result = await params.send()
  } catch (error) {
    // Only give back a claim this call created; a forced re-send must not erase the original.
    if (claimed) await releaseDailyBlast(supabase, claim)
    throw error
  }

  if (result.sent > 0) {
    await recordDailyBlastSent(supabase, { ...claim, recipientsSent: result.sent })
    return result
  }

  // Nothing went out. Keep the claim only when there was genuinely nothing to send —
  // otherwise release it so a later attempt retries.
  if (claimed) {
    if (result.reason && TERMINAL_SKIP_REASONS.has(result.reason)) {
      await recordDailyBlastSent(supabase, { ...claim, recipientsSent: 0 })
    } else {
      await releaseDailyBlast(supabase, claim)
    }
  }

  return result
}

/** Marks the claim as delivered. A recorded row is never retried later in the day. */
export async function recordDailyBlastSent(
  supabase: SupabaseClient,
  params: { orgId: string; blastType: EmailBlastType; sendDate: string; recipientsSent: number }
): Promise<void> {
  const { error } = await supabase
    .from('email_blast_sends')
    .update({ recipients_sent: params.recipientsSent, sent_at: new Date().toISOString() })
    .eq('org_id', params.orgId)
    .eq('blast_type', params.blastType)
    .eq('send_date', params.sendDate)

  if (error) {
    console.error('[email-blast-ledger] Failed to record send:', error.message)
  }
}
