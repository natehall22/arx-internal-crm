import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  INSURANCE_FOLLOW_UP_GRACE_DAYS,
  INSURANCE_FOLLOW_UP_PIPELINE_PREFIX,
  REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — promote-insurance-follow-ups will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const nowIso = new Date().toISOString()
  const graceCutoffIso = new Date(
    Date.now() - INSURANCE_FOLLOW_UP_GRACE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  try {
    const { data: candidates, error: fetchError } = await admin
      .from('opportunities')
      .select('id, org_id, lead_id, assigned_user_id, follow_up_at, inspection_outcome, inspection_outcome_at, pipeline_stage, leads(homeowner_name, phone, address_text)')
      .eq('inspection_outcome', 'insurance_follow_up')
      .neq('status', 'won')
      .neq('status', 'lost')
      .limit(1000)

    if (fetchError) {
      console.error('promote-insurance-follow-ups: fetch error', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const overdueOpportunities = (candidates || []).filter((opportunity: any) => {
      const pipelineStage = String(opportunity.pipeline_stage || '').trim().toLowerCase()
      if (
        pipelineStage === INSURANCE_FOLLOW_UP_PIPELINE_PREFIX ||
        pipelineStage.startsWith(`${INSURANCE_FOLLOW_UP_PIPELINE_PREFIX}_`)
      ) {
        return false
      }

      if (pipelineStage === REP_WORKING_INSURANCE_FOLLOW_UP_PIPELINE_PREFIX) {
        return Boolean(opportunity.follow_up_at) && String(opportunity.follow_up_at) <= nowIso
      }

      if (!pipelineStage) {
        return Boolean(opportunity.inspection_outcome_at) && String(opportunity.inspection_outcome_at) <= graceCutoffIso
      }

      return false
    })

    if (overdueOpportunities.length === 0) {
      return NextResponse.json({ promoted: 0, message: 'Nothing to promote' })
    }

    let promoted = 0

    for (const opportunity of overdueOpportunities) {
      const { data: updatedOpportunity, error: updateError } = await admin
        .from('opportunities')
        .update({
          pipeline_stage: INSURANCE_FOLLOW_UP_PIPELINE_PREFIX,
          assigned_user_id: null,
          follow_up_at: nowIso,
        })
        .eq('id', opportunity.id)
        .eq('org_id', opportunity.org_id)
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('promote-insurance-follow-ups: update error', opportunity.id, updateError)
        continue
      }

      if (!updatedOpportunity) {
        continue
      }

      promoted += 1

      await admin.from('activities').insert({
        org_id: opportunity.org_id,
        opportunity_id: opportunity.id,
        lead_id: opportunity.lead_id,
        user_id: null,
        type: 'status_change',
        body: 'Insurance follow-up automatically moved to inside sales after 7 days.',
      })

      const { data: insideSalesUsers } = await admin
        .from('users')
        .select('id, role, active, custom_roles(name, display_name)')
        .eq('org_id', opportunity.org_id)
        .eq('active', true)

      const customer = Array.isArray(opportunity.leads) ? opportunity.leads[0] : opportunity.leads
      const customerName = customer?.homeowner_name || 'Customer'
      const customerAddress = customer?.address_text || ''
      const customerPhone = customer?.phone || ''

      const insideSalesRecipients = (insideSalesUsers || []).filter((candidate: any) => {
        const customRole = Array.isArray(candidate.custom_roles)
          ? candidate.custom_roles[0]
          : candidate.custom_roles

        return isInsideSalesRoleLike({
          role: candidate.role,
          customRoleName: customRole?.name || null,
          customRoleDisplayName: customRole?.display_name || null,
        })
      })

      if (insideSalesRecipients.length > 0) {
        await admin.from('notifications').insert(
          insideSalesRecipients.map((recipient: any) => ({
            org_id: opportunity.org_id,
            recipient_user_id: recipient.id,
            actor_user_id: null,
            type: 'inside_sales_follow_up',
            title: `Inside Sales Follow-Up: ${customerName}`,
            body: [
              `Customer: ${customerName}`,
              customerAddress ? `Address: ${customerAddress}` : null,
              customerPhone ? `Phone: ${customerPhone}` : null,
              'Reason: Insurance follow-up aged into inside sales after 7 days',
            ]
              .filter(Boolean)
              .join('\n'),
            data: {
              opportunity_id: opportunity.id,
              lead_id: opportunity.lead_id,
              queue_type: 'insurance_follow_up',
              pipeline_stage: INSURANCE_FOLLOW_UP_PIPELINE_PREFIX,
              automated: true,
            },
          }))
        )
      }
    }

    console.log(`promote-insurance-follow-ups: promoted ${promoted} opportunities`)
    return NextResponse.json({ promoted })
  } catch (err) {
    console.error('promote-insurance-follow-ups: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
