import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { MORNING_UPDATE_CONFIG_ROLES } from '@/lib/admin-email-blasts'
import { getBlastSendDate, runClaimedBlast } from '@/lib/email-blast-ledger'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { sendSetterFieldUpdateEmail } from '@/lib/setter-field-update-email'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()

    if (!MORNING_UPDATE_CONFIG_ROLES.has(profile.role as 'owner' | 'admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // `force` re-sends a day the cron (or an earlier resend) already delivered. Without it
    // this endpoint shares the cron's once-per-day ledger, so a second click is a no-op
    // instead of a duplicate landing in every owner's inbox.
    const body = await request.json().catch(() => ({}))
    const force = body?.force === true

    const supabase = createServiceClient()
    const orgId = profile.org_id
    const sendDate = getBlastSendDate()

    const [morningUpdate, setterFieldUpdate] = await Promise.all([
      runClaimedBlast(supabase, {
        orgId,
        blastType: 'morning_update',
        sendDate,
        force,
        send: () => sendMorningUpdateEmail(supabase, { orgId }),
      }),
      runClaimedBlast(supabase, {
        orgId,
        blastType: 'setter_field_update',
        sendDate,
        force,
        send: () => sendSetterFieldUpdateEmail(supabase, { orgId }),
      }),
    ])

    const sent = morningUpdate.sent + setterFieldUpdate.sent
    const alreadySent = [morningUpdate, setterFieldUpdate].filter((result) =>
      result.reason?.endsWith('_already_sent_today')
    )

    // Everything already went out today — not an error, just nothing left to do.
    if (sent === 0 && alreadySent.length === 2) {
      return NextResponse.json(
        {
          alreadySentToday: true,
          sendDate,
          error: `Today's emails (${sendDate}) already went out. Re-send anyway to deliver a second copy.`,
          morningUpdate,
          setterFieldUpdate,
        },
        { status: 409 }
      )
    }

    const failures = [
      morningUpdate.skipped ? `Morning Update: ${morningUpdate.reason || 'not sent'}` : null,
      setterFieldUpdate.skipped ? `Setter TIF: ${setterFieldUpdate.reason || 'not sent'}` : null,
    ].filter(Boolean)

    if (sent === 0) {
      return NextResponse.json(
        {
          error: failures.join('; ') || 'No emails were sent',
          sendDate,
          morningUpdate,
          setterFieldUpdate,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      sent,
      sendDate,
      morningUpdate,
      setterFieldUpdate,
      warning: failures.length ? failures.join('; ') : undefined,
    })
  } catch (error: unknown) {
    console.error('POST /api/admin/email-blasts/resend-today error:', error)
    const message = error instanceof Error ? error.message : 'Failed to resend morning emails'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
