import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { MORNING_UPDATE_CONFIG_ROLES } from '@/lib/admin-email-blasts'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { sendSetterFieldUpdateEmail } from '@/lib/setter-field-update-email'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const { profile } = await requireAuthApi()

    if (!MORNING_UPDATE_CONFIG_ROLES.has(profile.role as 'owner' | 'admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const supabase = createServiceClient()

    const [morningUpdate, setterFieldUpdate] = await Promise.all([
      sendMorningUpdateEmail(supabase, { orgId: profile.org_id }),
      sendSetterFieldUpdateEmail(supabase, { orgId: profile.org_id }),
    ])

    const sent = morningUpdate.sent + setterFieldUpdate.sent
    const failures = [
      morningUpdate.skipped ? `Morning Update: ${morningUpdate.reason || 'not sent'}` : null,
      setterFieldUpdate.skipped ? `Setter TIF: ${setterFieldUpdate.reason || 'not sent'}` : null,
    ].filter(Boolean)

    if (sent === 0) {
      return NextResponse.json(
        {
          error: failures.join('; ') || 'No emails were sent',
          morningUpdate,
          setterFieldUpdate,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      sent,
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
