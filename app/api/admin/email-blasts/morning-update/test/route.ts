import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { MORNING_UPDATE_CONFIG_ROLES } from '@/lib/admin-email-blasts'
import { sendMorningUpdateEmail } from '@/lib/morning-update-email'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const { profile } = await requireAuthApi()

    if (!MORNING_UPDATE_CONFIG_ROLES.has(profile.role as 'owner' | 'admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const email = typeof profile.email === 'string' ? profile.email.trim() : ''
    if (!email.includes('@')) {
      return NextResponse.json({ error: 'Your profile has no email address' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const result = await sendMorningUpdateEmail(supabase, {
      orgId: profile.org_id,
      testToEmails: [email],
    })

    if (result.skipped) {
      return NextResponse.json(
        { error: result.reason || 'Test email was not sent', ...result },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      sent: result.sent,
      to: email,
    })
  } catch (error: unknown) {
    console.error('POST /api/admin/email-blasts/morning-update/test error:', error)
    const message = error instanceof Error ? error.message : 'Failed to send test email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
