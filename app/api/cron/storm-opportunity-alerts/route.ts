import { NextRequest, NextResponse } from 'next/server'
import { getRecentStormReportsInBbox } from '@/lib/roofradar-open-data'
import { createServiceClient } from '@/lib/supabase/service'
import { isInsideSalesRoleLike } from '@/lib/inside-sales-follow-up'
import { footprintFromEnv } from '@/lib/weather-footprint'
import { getMailTransport } from '@/lib/setter-email'
import {
  buildStormActivityNote,
  buildStormAlertDigestHtml,
  buildStormAlertDigestText,
  buildStormNotificationBody,
  buildStormNotificationTitle,
  filterStormReportsForAlerts,
  isStormOpportunityEligible,
  isOnUnresolvedStormPipelineStage,
  matchStormReportsToOpportunity,
  resolveOpportunityCoordinates,
  shouldSkipStormAlertEntirely,
  shouldSkipStormRouting,
  stormAlertEmailTo,
  stormOpportunityAlertsEnabled,
  stormPipelineStageForRouting,
  STORM_IEM_FETCH_WINDOW_DAYS,
  type StormAlertDigestRow,
  type StormMatchResult,
  type StormOpportunityCandidate,
} from '@/lib/storm-opportunity-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function verifyCronSecret(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET env var not set — storm-opportunity-alerts will not run')
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

type AppointmentRow = {
  opportunity_id: string
  appointment_type: string
  status: string
  scheduled_for: string
}

export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request)
  if (authFailure) return authFailure

  if (!stormOpportunityAlertsEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'STORM_OPPORTUNITY_ALERTS_ENABLED off' })
  }

  const admin = createServiceClient()
  const now = new Date()
  const nowIso = now.toISOString()
  const footprint = footprintFromEnv()

  try {
    const [hailRaw, windRaw] = await Promise.all([
      getRecentStormReportsInBbox(footprint, 'hail', STORM_IEM_FETCH_WINDOW_DAYS),
      getRecentStormReportsInBbox(footprint, 'wind', STORM_IEM_FETCH_WINDOW_DAYS),
    ])
    const hailReports = filterStormReportsForAlerts(hailRaw, 'hail', now)
    const windReports = filterStormReportsForAlerts(windRaw, 'wind', now)

    const { data: opportunities, error: oppError } = await admin
      .from('opportunities')
      .select(
        'id, org_id, lead_id, status, lat, lng, pipeline_stage, assigned_user_id, address_text, leads(homeowner_name, phone, lat, lng, installation_agreement_signed_at)'
      )
      .neq('status', 'won')
      .limit(8000)

    if (oppError) {
      console.error('storm-opportunity-alerts: opportunity fetch error', oppError)
      return NextResponse.json({ error: oppError.message }, { status: 500 })
    }

    const rawOpportunities = opportunities || []
    const opportunityIds = rawOpportunities.map((row: any) => row.id)

    const appointmentsByOpportunityId = new Map<string, AppointmentRow[]>()
    if (opportunityIds.length > 0) {
      const { data: appointmentRows, error: apptError } = await admin
        .from('scheduled_appointments')
        .select('opportunity_id, appointment_type, status, scheduled_for')
        .in('opportunity_id', opportunityIds)
        .in('appointment_type', ['inspection', 'close'])

      if (apptError) {
        console.error('storm-opportunity-alerts: appointment fetch error', apptError)
        return NextResponse.json({ error: apptError.message }, { status: 500 })
      }

      for (const row of appointmentRows || []) {
        if (!row.opportunity_id) continue
        const current = appointmentsByOpportunityId.get(row.opportunity_id) || []
        current.push(row as AppointmentRow)
        appointmentsByOpportunityId.set(row.opportunity_id, current)
      }
    }

    const insideSalesUsersByOrgId = new Map<string, any[]>()
    const matches: StormMatchResult[] = []

    for (const raw of rawOpportunities) {
      const lead = Array.isArray(raw.leads) ? raw.leads[0] : raw.leads
      const candidate: StormOpportunityCandidate = {
        id: raw.id,
        org_id: raw.org_id,
        lead_id: raw.lead_id,
        status: raw.status,
        lat: raw.lat == null ? null : Number(raw.lat),
        lng: raw.lng == null ? null : Number(raw.lng),
        pipeline_stage: raw.pipeline_stage,
        assigned_user_id: raw.assigned_user_id,
        installation_agreement_signed_at: lead?.installation_agreement_signed_at ?? null,
        address_text: raw.address_text,
        homeowner_name: lead?.homeowner_name ?? null,
        phone: lead?.phone ?? null,
      }

      const coords = resolveOpportunityCoordinates(candidate, lead)
      if (!coords) continue

      const appointments = appointmentsByOpportunityId.get(raw.id) || []
      if (!isStormOpportunityEligible(candidate, coords, footprint, appointments, now)) continue

      matches.push(...matchStormReportsToOpportunity(candidate, coords, hailReports, windReports))
    }

    let inserted = 0
    let routed = 0
    let notedOnly = 0
    let skippedCloserMidDeal = 0
    const digestRows: StormAlertDigestRow[] = []
    const routedOpportunityIds = new Set<string>()
    const notifiedOpportunityIds = new Set<string>()

    const markAlertRouted = async (alertId: string, opportunityId: string): Promise<boolean> => {
      const { error: markRoutedError } = await admin
        .from('storm_opportunity_alerts')
        .update({ routed: true })
        .eq('id', alertId)

      if (markRoutedError) {
        console.error(
          'storm-opportunity-alerts: mark routed error',
          opportunityId,
          alertId,
          markRoutedError
        )
        return false
      }
      return true
    }

    for (const match of matches) {
      const appointments = appointmentsByOpportunityId.get(match.opportunity.id) || []
      if (shouldSkipStormAlertEntirely(match.opportunity, appointments, now)) {
        skippedCloserMidDeal += 1
        continue
      }

      let alertId: string | null = null
      let isNewAlert = false

      const { data: insertedRow, error: insertError } = await admin
        .from('storm_opportunity_alerts')
        .insert({
          org_id: match.opportunity.org_id,
          opportunity_id: match.opportunity.id,
          event_date: match.eventDate,
          layer: match.layer,
          magnitude: match.report.magnitude,
          damage: match.report.damage,
          storm_lat: match.report.lat,
          storm_lng: match.report.lng,
          distance_miles: match.distanceMiles,
          routed: false,
        })
        .select('id, routed')
        .maybeSingle()

      if (insertError) {
        if (insertError.code !== '23505') {
          console.error('storm-opportunity-alerts: insert error', match.opportunity.id, insertError)
          continue
        }

        const { data: existingRow, error: existingError } = await admin
          .from('storm_opportunity_alerts')
          .select('id, routed')
          .eq('org_id', match.opportunity.org_id)
          .eq('opportunity_id', match.opportunity.id)
          .eq('event_date', match.eventDate)
          .eq('layer', match.layer)
          .maybeSingle()

        if (existingError || !existingRow?.id) {
          console.error('storm-opportunity-alerts: dedupe fetch error', match.opportunity.id, existingError)
          continue
        }

        alertId = existingRow.id
        if (existingRow.routed) {
          continue
        }
      } else if (insertedRow?.id) {
        alertId = insertedRow.id
        isNewAlert = true
        inserted += 1
      } else {
        continue
      }

      const customerName = match.opportunity.homeowner_name || 'Customer'
      const skipRouting = shouldSkipStormRouting(match.opportunity.pipeline_stage, appointments, now)
      let didRoute = false

      if (!skipRouting) {
        const alreadyOnStormStage = isOnUnresolvedStormPipelineStage(match.opportunity.pipeline_stage)
        const alreadyRoutedThisRun = routedOpportunityIds.has(match.opportunity.id)

        if (alreadyOnStormStage || alreadyRoutedThisRun) {
          didRoute = await markAlertRouted(alertId, match.opportunity.id)
        } else {
          const updatePayload: Record<string, unknown> = {
            pipeline_stage: stormPipelineStageForRouting(),
            assigned_user_id: null,
            follow_up_at: nowIso,
          }
          if (String(match.opportunity.status || '').trim().toLowerCase() === 'lost') {
            updatePayload.status = 'open'
          }

          const { data: updated, error: updateError } = await admin
            .from('opportunities')
            .update(updatePayload)
            .eq('id', match.opportunity.id)
            .eq('org_id', match.opportunity.org_id)
            // Won-race guard: never clobber an opp that sold between fetch and write.
            .neq('status', 'won')
            .in('status', ['open', 'in_progress', 'lost'])
            .select('id')
            .maybeSingle()

          if (updateError) {
            console.error('storm-opportunity-alerts: route error', match.opportunity.id, updateError)
          } else if (updated?.id) {
            routedOpportunityIds.add(match.opportunity.id)
            routed += 1
            didRoute = await markAlertRouted(alertId, match.opportunity.id)
          }
        }
      } else if (isNewAlert) {
        notedOnly += 1
      }

      // Only note/notify/digest when we routed successfully or intentionally skipped routing
      // (mid-deal / rep grace / already on another IS queue). Failed route leaves routed=false for retry.
      const allowSideEffects = skipRouting || didRoute
      if (isNewAlert && allowSideEffects) {
        const activityBody = buildStormActivityNote(match)
        await admin.from('activities').insert({
          org_id: match.opportunity.org_id,
          opportunity_id: match.opportunity.id,
          lead_id: match.opportunity.lead_id,
          user_id: null,
          type: 'status_change',
          body: activityBody,
        })

        if (!notifiedOpportunityIds.has(match.opportunity.id)) {
          notifiedOpportunityIds.add(match.opportunity.id)

          let insideSalesUsers = insideSalesUsersByOrgId.get(match.opportunity.org_id)
          if (insideSalesUsers === undefined) {
            const { data: fetchedInsideSalesUsers } = await admin
              .from('users')
              .select('id, role, active, custom_roles(name, display_name)')
              .eq('org_id', match.opportunity.org_id)
              .eq('active', true)
            insideSalesUsers = fetchedInsideSalesUsers || []
            insideSalesUsersByOrgId.set(match.opportunity.org_id, insideSalesUsers)
          }

          const recipients = (insideSalesUsers || []).filter((candidate: any) => {
            const customRole = Array.isArray(candidate.custom_roles)
              ? candidate.custom_roles[0]
              : candidate.custom_roles
            return isInsideSalesRoleLike({
              role: candidate.role,
              customRoleName: customRole?.name || null,
              customRoleDisplayName: customRole?.display_name || null,
            })
          })

          if (recipients.length > 0) {
            await admin.from('notifications').insert(
              recipients.map((recipient: any) => ({
                org_id: match.opportunity.org_id,
                recipient_user_id: recipient.id,
                actor_user_id: null,
                type: 'inside_sales_follow_up',
                title: buildStormNotificationTitle(customerName),
                body: buildStormNotificationBody(match, customerName),
                data: {
                  opportunity_id: match.opportunity.id,
                  lead_id: match.opportunity.lead_id,
                  queue_type: didRoute ? 'storm_follow_up' : 'storm_note',
                  pipeline_stage: didRoute
                    ? stormPipelineStageForRouting()
                    : match.opportunity.pipeline_stage,
                  automated: true,
                  storm_layer: match.layer,
                  storm_event_date: match.eventDate,
                },
              }))
            )
          }
        }

        digestRows.push({
          customerName,
          address: match.opportunity.address_text || '',
          layer: match.layer,
          eventDate: match.eventDate,
          magnitudeLabel:
            match.layer === 'hail'
              ? `est. ${match.report.magnitude.toFixed(2)} in hail`
              : match.report.damage
                ? 'est. wind damage'
                : `est. ${Math.round(match.report.magnitude)} mph wind`,
          distanceMiles: match.distanceMiles,
          routed: didRoute,
          opportunityId: match.opportunity.id,
        })
      }
    }

    if (digestRows.length > 0) {
      const to = stormAlertEmailTo()
      if (process.env.SMTP_HOST && to.includes('@')) {
        try {
          const transporter = getMailTransport()
          const subject = `Storm opportunity alerts (est.): ${digestRows.length} new`
          await transporter.sendMail({
            from: 'info@arxroofing.com',
            to,
            subject,
            text: buildStormAlertDigestText(digestRows),
            html: buildStormAlertDigestHtml(digestRows),
          })
        } catch (emailError) {
          console.error('storm-opportunity-alerts: email failed', emailError)
        }
      }
    }

    console.log(
      `storm-opportunity-alerts: inserted ${inserted}, routed ${routed}, noted ${notedOnly}, skippedCloserMidDeal ${skippedCloserMidDeal}`
    )

    return NextResponse.json({
      ok: true,
      hailReports: hailReports.length,
      windReports: windReports.length,
      matches: matches.length,
      inserted,
      routed,
      notedOnly,
      skippedCloserMidDeal,
      emailed: digestRows.length > 0,
    })
  } catch (err) {
    console.error('storm-opportunity-alerts: unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
