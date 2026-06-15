import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import {
  getCloseOutcomeAction,
  getCloseOutcomeInsideSalesHandoff,
  getValidCloseOutcomeIdsFromSettings,
  type CloseOutcomeConfigRow,
} from '@/lib/close-outcomes'
import {
  HANDOFF_INSIDE_SALES_PIPELINE_PREFIX,
  KNOCKBACK_PIPELINE_PREFIX,
  REP_WORKING_HANDOFF_PIPELINE_PREFIX,
} from '@/lib/inside-sales-follow-up'
import { sendSetterEmail } from '@/lib/setter-email'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
} from '@/lib/org-appointment-types'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }

  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  return null
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function canViewOpportunity(profile: { role: string; id: string }, opportunity: { owner_user_id: string | null }) {
  if (profile.role === 'rep') {
    return opportunity.owner_user_id === profile.id
  }
  return true
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sessionData = getSessionFromRequest(request)

    if (!sessionData?.access_token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${sessionData.access_token}` } },
    })

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(sessionData.access_token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const opportunityId = body.opportunity_id as string
    const closeAppointmentId = body.close_appointment_id as string | undefined
    const scheduledAppointmentId = body.scheduled_appointment_id as string | undefined
    const outcome = body.outcome as string
    const notes = (body.notes as string | undefined) || null
    const follow_up_date = body.follow_up_date as string | undefined

    if (!opportunityId || !outcome) {
      return NextResponse.json({ error: 'opportunity_id and outcome are required' }, { status: 400 })
    }

    const { data: orgForOutcomes } = await admin
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const closeOutcomeRows = orgForOutcomes?.settings?.close_outcomes as CloseOutcomeConfigRow[] | undefined
    const validCloseIds = getValidCloseOutcomeIdsFromSettings(closeOutcomeRows)
    const outcomeNorm = String(outcome).toLowerCase()
    const outcomeAllowed = validCloseIds.some((id) => id.toLowerCase() === outcomeNorm)
    if (!outcomeAllowed) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    }

    if (outcomeNorm === 'insurance_follow_up' && !follow_up_date) {
      return NextResponse.json(
        { error: 'follow_up_date is required for insurance follow-up' },
        { status: 400 }
      )
    }

    if (outcomeNorm === 'insurance_follow_up' && follow_up_date) {
      const parsed = new Date(follow_up_date)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid follow_up_date' }, { status: 400 })
      }
    }

    if (!closeAppointmentId && !scheduledAppointmentId) {
      return NextResponse.json(
        { error: 'close_appointment_id or scheduled_appointment_id is required' },
        { status: 400 }
      )
    }

    const { data: opportunity, error: oppError } = await admin
      .from('opportunities')
      .select('id, org_id, owner_user_id, lead_id, status, pipeline_stage')
      .eq('id', opportunityId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (oppError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (!canViewOpportunity(profile, opportunity)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()

    let targetCloseId: string | null = null

    if (closeAppointmentId) {
      const { data: existing, error: exErr } = await admin
        .from('close_appointments')
        .select('id')
        .eq('id', closeAppointmentId)
        .eq('opportunity_id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (exErr || !existing) {
        return NextResponse.json({ error: 'Close appointment not found' }, { status: 404 })
      }

      const { error: upErr } = await admin
        .from('close_appointments')
        .update({
          outcome,
          notes,
          submitted_by: user.id,
          outcome_submitted_at: now,
        })
        .eq('id', closeAppointmentId)

      if (upErr) {
        console.error('close_appointments update', upErr)
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }
      targetCloseId = closeAppointmentId
    } else if (scheduledAppointmentId) {
      const { data: sa, error: saErr } = await admin
        .from('scheduled_appointments')
        .select('id, scheduled_for, org_id, opportunity_id')
        .eq('id', scheduledAppointmentId)
        .eq('opportunity_id', opportunityId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (saErr || !sa) {
        return NextResponse.json({ error: 'Scheduled appointment not found' }, { status: 404 })
      }

      const { data: existingCa } = await admin
        .from('close_appointments')
        .select('id')
        .eq('scheduled_appointment_id', scheduledAppointmentId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (existingCa?.id) {
        const { error: upErr } = await admin
          .from('close_appointments')
          .update({
            outcome,
            notes,
            submitted_by: user.id,
            outcome_submitted_at: now,
          })
          .eq('id', existingCa.id)

        if (upErr) {
          return NextResponse.json({ error: upErr.message }, { status: 500 })
        }
        targetCloseId = existingCa.id
      } else {
        const { data: inserted, error: insErr } = await admin
          .from('close_appointments')
          .insert({
            org_id: profile.org_id,
            opportunity_id: opportunityId,
            scheduled_appointment_id: scheduledAppointmentId,
            scheduled_for: sa.scheduled_for,
            outcome,
            notes,
            submitted_by: user.id,
            outcome_submitted_at: now,
          })
          .select('id')
          .single()

        if (insErr || !inserted) {
          console.error('close_appointments insert', insErr)
          return NextResponse.json({ error: insErr?.message || 'Failed to save' }, { status: 500 })
        }
        targetCloseId = inserted.id
      }
    }

    const oppUpdate: Record<string, unknown> = {}
    const closeAction = getCloseOutcomeAction(closeOutcomeRows, outcome)
    const insideSalesHandoff = getCloseOutcomeInsideSalesHandoff(closeOutcomeRows, outcome)
    const closesAsSold = closeAction === 'won'
    const closesAsLost = closeAction === 'lost'
    const opportunityAlreadyFinal = opportunity.status === 'won' || opportunity.status === 'lost'

    const knockbackReason = body.knockback_reason as string | undefined
    const knockbackMonths = typeof body.knockback_follow_up_months === 'number'
      ? body.knockback_follow_up_months
      : null
    const validKnockbackReasons = ['credit_fail', 'not_ready', 'price_objection']
    const validKnockbackMonths = [2, 4, 6]
    const hasPartialKnockback =
      Boolean(knockbackReason) !== Boolean(knockbackMonths)
    if (hasPartialKnockback) {
      return NextResponse.json(
        { error: 'Knockback requires both a reason and follow-up months (2, 4, or 6)' },
        { status: 400 }
      )
    }
    const isOnInsurancePipeline =
      String(opportunity.pipeline_stage || '').startsWith('rep_working_insurance') ||
      String(opportunity.pipeline_stage || '').startsWith('inside_sales_insurance')
    const validKnockback =
      knockbackReason &&
      outcomeNorm !== 'insurance_follow_up' &&
      !isOnInsurancePipeline &&
      validKnockbackReasons.includes(knockbackReason) &&
      knockbackMonths &&
      validKnockbackMonths.includes(knockbackMonths)

    if (closesAsSold) {
      oppUpdate.status = 'won'
    } else if (closesAsLost) {
      oppUpdate.status = 'lost'
    } else if (validKnockback) {
      const followUpDate = new Date()
      followUpDate.setMonth(followUpDate.getMonth() + knockbackMonths)
      oppUpdate.knockback_reason = knockbackReason
      oppUpdate.knockback_follow_up_months = knockbackMonths
      oppUpdate.pipeline_stage = KNOCKBACK_PIPELINE_PREFIX
      oppUpdate.follow_up_at = followUpDate.toISOString()
      oppUpdate.assigned_user_id = null
    } else if (!opportunityAlreadyFinal && insideSalesHandoff.enabled) {
      const delayDays = insideSalesHandoff.delayDays ?? 0
      const followUpAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
      oppUpdate.pipeline_stage =
        delayDays > 0 ? REP_WORKING_HANDOFF_PIPELINE_PREFIX : HANDOFF_INSIDE_SALES_PIPELINE_PREFIX
      oppUpdate.assigned_user_id = null
      oppUpdate.follow_up_at = followUpAt
    }
    if (outcomeNorm === 'insurance_follow_up' || outcomeNorm === 'waiting_on_insurance') {
      oppUpdate.job_source = 'insurance'
      oppUpdate.insurance_stage = 'contingency_signed'
    }

    if (Object.keys(oppUpdate).length > 0) {
      await admin.from('opportunities').update(oppUpdate).eq('id', opportunityId).eq('org_id', profile.org_id)
    }

    await admin.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: opportunityId,
      lead_id: opportunity.lead_id,
      user_id: profile.id,
      type: 'status_change',
      body: `Close appointment feedback: ${outcome.replace(/_/g, ' ')}${notes ? ` — ${notes}` : ''}`,
    })

    if (outcomeNorm === 'insurance_follow_up' && follow_up_date) {
      const { data: leadRow } = await admin
        .from('leads')
        .select('id, address_text, homeowner_name, owner_user_id')
        .eq('id', opportunity.lead_id)
        .maybeSingle()

      const { data: orgRow } = await admin
        .from('orgs')
        .select('default_scheduling_gap_minutes, inspection_feedback_buffer_minutes')
        .eq('id', profile.org_id)
        .single()

      const defaultGap = orgRow?.default_scheduling_gap_minutes ?? 15
      const tableAptTypes = await fetchOrgAppointmentTypesFromTable(admin, profile.org_id)
      const bufferAfter = getCloseSlotBufferAfterFromTable(
        tableAptTypes,
        'insurance_follow_up',
        defaultGap
      )
      const durationMinutes = getCloseSlotDurationFromTable(
        tableAptTypes,
        'insurance_follow_up',
        30
      )

      const followUpDateTime = new Date(follow_up_date)

      const { data: followUpAppointment, error: fuErr } = await admin
        .from('scheduled_appointments')
        .insert({
          org_id: profile.org_id,
          lead_id: opportunity.lead_id,
          opportunity_id: opportunityId,
          closer_user_id: user.id,
          canvasser_user_id: leadRow?.owner_user_id || null,
          scheduled_for: followUpDateTime.toISOString(),
          duration_minutes: durationMinutes,
          buffer_after_minutes: bufferAfter,
          address_text: leadRow?.address_text || null,
          status: 'scheduled',
          notes: `Insurance follow-up after close feedback${notes ? `: ${notes}` : ''}`,
          appointment_type: 'insurance_follow_up',
        })
        .select('id, scheduled_for, duration_minutes, buffer_after_minutes, closer_user_id')
        .single()

      if (fuErr) {
        console.error('insurance follow-up from close feedback', fuErr)
        return NextResponse.json({ error: fuErr.message }, { status: 500 })
      }

      if (followUpAppointment?.id) {
        const promptAt = computeInspectionFeedbackPromptAt(
          followUpAppointment.scheduled_for,
          followUpAppointment.duration_minutes || durationMinutes,
          followUpAppointment.buffer_after_minutes ?? bufferAfter,
          orgRow?.inspection_feedback_buffer_minutes ?? 0
        )
        const { error: promptError } = await admin.from('pending_status_prompts').upsert(
          {
            org_id: profile.org_id,
            appointment_id: followUpAppointment.id,
            closer_user_id: followUpAppointment.closer_user_id || user.id,
            prompt_at: promptAt,
            completed: false,
            dismissed: false,
          },
          { onConflict: 'appointment_id' }
        )
        if (promptError) {
          console.error('insurance follow-up prompt from close feedback', promptError)
        }
      }

      const setterId = leadRow?.owner_user_id
      if (setterId && setterId !== user.id) {
        try {
          const { data: setterUser } = await admin
            .from('users')
            .select('email, full_name')
            .eq('id', setterId)
            .maybeSingle()
          const customerName = leadRow?.homeowner_name || 'Customer'
          if (setterUser?.email) {
            const whenLabel = followUpDateTime.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'full',
              timeStyle: 'short',
            })
            await sendSetterEmail({
              to: setterUser.email,
              recipientUserId: setterId,
              setterName: setterUser.full_name,
              subject: `Insurance follow-up scheduled: ${customerName}`,
              introHtml: `<p style="color: #374151;">A closer scheduled an insurance follow-up after a close visit.</p>`,
              rows: [
                { label: 'Customer', value: customerName },
                { label: 'Address', value: leadRow?.address_text || 'N/A' },
                { label: 'Scheduled', value: `${whenLabel} ET` },
              ],
            })
          }
        } catch (e) {
          console.error('Setter email (close insurance follow-up):', e)
        }
      }
    }

    revalidatePath(`/opportunities/${opportunityId}`)
    revalidatePath('/opportunities')

    return NextResponse.json({ success: true, close_appointment_id: targetCloseId })
  } catch (e) {
    console.error('POST /api/close-appointments/submit', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
