import { requireAuthApi } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionBufferAfterFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import {
  createCalendarEvent,
  refreshAccessToken,
  getFreeBusy,
  CalendarEvent,
} from '@/lib/google-calendar'
import { hasBufferedConflict, existingBuffersForAppointment } from '@/lib/scheduling-buffer'
import { getOrgDefaultSchedulingGapMinutes, resolveSchedulingBuffers } from '@/lib/org-scheduling-gap'
import nodemailer from 'nodemailer'
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { formatDateTimeInTimezone } from '@/lib/timezone'
import { inspectionLocalWallClockToUtcIso } from '@/lib/inspection-local-wall-clock'
import { pickValidEmail } from '@/lib/setter-email'
import { canReceiveCanvassAppointment } from '@/lib/canvass-appointment-eligibility'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
import { ensureLeadHasMapPinOrThrow } from '@/lib/lead-map-pin'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import { deleteCanvassLeadWithDependencies } from '@/lib/canvass-lead-delete'
import { createServiceClient } from '@/lib/supabase/service'
import { getAttributedCanvassLeadUserId, isCanvassDoorEligible } from '@/lib/canvass-lead-attribution'

export const dynamic = 'force-dynamic'

const REASSIGN_AFTER_DAYS = 14

type OwnershipHistoryEntry = {
  from_user_id: string
  from_pin_attributed_user_id: string | null
  to_user_id: string
  reassigned_at: string
  prior_knock_at: string
}

function appendOwnershipHistory(
  existing: unknown,
  entry: OwnershipHistoryEntry,
): OwnershipHistoryEntry[] {
  const history = Array.isArray(existing) ? (existing as OwnershipHistoryEntry[]) : []
  const isDuplicate = history.some(
    (h) =>
      h.from_user_id === entry.from_user_id &&
      h.to_user_id === entry.to_user_id &&
      h.prior_knock_at === entry.prior_knock_at,
  )
  if (isDuplicate) return history
  return [...history, entry]
}

function formatInspectionTimeEt(iso: string | null | undefined): string {
  if (!iso) return 'TBD'
  return `${formatDateTimeInTimezone(iso)} ET`
}

/** Map Postgres / trigger errors from scheduled_appointments INSERT to a clearer canvass message. */
function formatScheduledAppointmentInsertError(dbMessage: string): string {
  const m = dbMessage.toLowerCase()
  if (m.includes('on conflict') && m.includes('unique or exclusion constraint')) {
    return 'Database is missing a required index on pending_status_prompts. Apply migration 125_pending_status_prompts_unique_appointment_id.sql (or ask an admin to run Supabase migrations).'
  }
  if (m.includes('scheduling conflict') || m.includes('overlapping appointment')) {
    return 'That time is too close to another appointment for this closer. Choose a different time.'
  }
  if (m.includes('rapid duplicate') || m.includes('duplicate key') || m.includes('unique constraint')) {
    return 'This time was already booked (duplicate or double-tap). Wait a moment and try again, or pick another slot.'
  }
  return `Could not save the appointment (${dbMessage})`
}

function getMailTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

// Helper to get valid access token (refresh if needed)
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  console.log(`getValidAccessToken: Looking up token for user ${userId}`)
  
  const { data: tokenData, error: tokenError } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (tokenError) {
    console.log(`getValidAccessToken: Error fetching token:`, tokenError.message)
  }
  
  if (!tokenData) {
    console.log(`getValidAccessToken: No token found for user ${userId}`)
    return null
  }
  
  console.log(`getValidAccessToken: Token found, expires_at: ${tokenData.expires_at}`)

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, try to refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log(`getValidAccessToken: Token expires soon, attempting refresh...`)
    try {
      const refreshed = await refreshAccessToken(tokenData.refresh_token)
      
      // Update token in database
      await adminClient
        .from('user_google_tokens')
        .update({
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at.toISOString(),
        })
        .eq('user_id', userId)

      console.log(`getValidAccessToken: Token refreshed successfully`)
      return refreshed.access_token
    } catch (error) {
      console.error('Failed to refresh token:', error)
      // If refresh fails but token hasn't actually expired yet, try using it anyway
      if (expiresAt > now) {
        console.log(`getValidAccessToken: Refresh failed but token not yet expired, using existing token`)
        return tokenData.access_token
      }
      return null
    }
  }

  console.log(`getValidAccessToken: Token is valid, returning`)
  return tokenData.access_token
}

// Helper to get timezone for a user based on their team
async function getTimezoneForUser(adminClient: any, userId: string): Promise<string> {
  try {
    const { data: userProfile } = await adminClient
      .from('users')
      .select('team_id')
      .eq('id', userId)
      .single()
    
    if (userProfile?.team_id) {
      const { data: team } = await adminClient
        .from('teams')
        .select('timezone')
        .eq('id', userProfile.team_id)
        .single()
      
      if (team?.timezone) {
        return team.timezone
      }
    }
  } catch (e) {
    console.log('Could not fetch team timezone, using default')
  }
  
  return 'America/New_York' // Default to Eastern
}

// Helper to sync appointment to Google Calendar for closer
async function syncToGoogleCalendar(
  adminClient: any,
  closerUserId: string,
  scheduledFor: string,
  durationMinutes: number,
  homeownerName: string | null,
  addressText: string | null,
  phone: string | null,
  notes: string | null,
  canvassNotes: string | null,
  leadId: string,
  opportunityId: string | null,
  setterName: string | null = null,
  setterEmail: string | null = null
): Promise<{ synced: boolean; eventId?: string; error?: string; setterInvited?: boolean }> {
  console.log('=== SYNC TO GOOGLE CALENDAR ===')
  console.log('closerUserId:', closerUserId)
  console.log('scheduledFor:', scheduledFor)
  console.log('durationMinutes:', durationMinutes)
  
  try {
    const googleAccessToken = await getValidAccessToken(adminClient, closerUserId)
    
    if (!googleAccessToken) {
      console.log('syncToGoogleCalendar: No access token available')
      return { synced: false, error: 'Closer does not have Google Calendar connected' }
    }
    
    console.log('syncToGoogleCalendar: Got access token, proceeding with event creation')

    // Get timezone from closer's team
    const timezone = await getTimezoneForUser(adminClient, closerUserId)

    // scheduledFor is in format "YYYY-MM-DDTHH:MM" (local time in closer's timezone)
    // We need to send it to Google Calendar with the timezone, NOT as UTC
    // Google Calendar API accepts dateTime in format "YYYY-MM-DDTHH:MM:SS" with a separate timeZone field
    const startDateTime = scheduledFor.includes(':') && scheduledFor.length === 16 
      ? `${scheduledFor}:00`  // Add seconds if not present
      : scheduledFor
    
    // Calculate end time by parsing the local time and adding duration
    const [datePart, timePart] = scheduledFor.split('T')
    const [hourStr, minStr] = timePart.split(':')
    let endHour = parseInt(hourStr, 10)
    let endMin = parseInt(minStr, 10) + durationMinutes
    
    // Handle minute overflow
    while (endMin >= 60) {
      endMin -= 60
      endHour += 1
    }
    
    const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

    const event: CalendarEvent = {
      summary: `Inspection: ${homeownerName || 'Customer'}`,
      description: [
        `Customer: ${homeownerName || 'N/A'}`,
        phone ? `Phone: ${phone}` : '',
        addressText ? `Address: ${addressText}` : '',
        setterName ? `Setter: ${setterName}` : '',
        '',
        canvassNotes ? `Canvass Notes:\n${canvassNotes}` : '',
        notes ? `Additional Notes:\n${notes}` : '',
      ].filter(line => line !== undefined && line !== '').join('\n').trim(),
      location: addressText || undefined,
      start: {
        dateTime: startDateTime,
        timeZone: timezone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: timezone,
      },
      attendees: setterEmail ? [{ email: setterEmail }] : undefined,
    }

    console.log('Creating Google Calendar event:', {
      summary: event.summary,
      start: event.start,
      end: event.end,
      scheduledForInput: scheduledFor,
    })

    const createdEvent = await createCalendarEvent(
      googleAccessToken,
      event,
      'primary',
      setterEmail ? 'all' : 'none'
    )
    console.log('Google Calendar event created:', createdEvent.id)
    return { synced: true, eventId: createdEvent.id, setterInvited: Boolean(setterEmail) }
  } catch (error) {
    console.error('Google Calendar sync error:', error)
    return { synced: false, error: error instanceof Error ? error.message : 'Calendar sync failed' }
  }
}

// Helper to check closer availability via Google Calendar
async function checkCloserAvailability(
  adminClient: any,
  closerUserId: string,
  scheduledFor: string,
  durationMinutes: number,
  /** From orgs.default_scheduling_gap_minutes (Admin → Scheduling) */
  orgDefaultGapMinutes: number,
  /** appointment_types.buffer_after_minutes for the type being booked (Admin → Scheduling) */
  appointmentTypeBufferAfterMinutes?: number
): Promise<{ available: boolean; hasCalendar: boolean; error?: string }> {
  try {
    const startTime = new Date(scheduledFor)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)

    // Pull buffer settings using the same precedence as availability APIs.
    const [{ data: queueEntry }, { data: settings }] = await Promise.all([
      adminClient
        .from('team_closer_queue')
        .select('buffer_before, buffer_after, buffer_minutes')
        .eq('user_id', closerUserId)
        .eq('active', true)
        .limit(1)
        .maybeSingle(),
      adminClient
        .from('user_settings')
        .select('appointment_buffer_minutes, appointment_buffer_before, appointment_buffer_after')
        .eq('user_id', closerUserId)
        .maybeSingle(),
    ])

    const { bufferBefore, bufferAfter, baselineBufferAfter } = resolveSchedulingBuffers(
      queueEntry ?? undefined,
      settings ?? undefined,
      orgDefaultGapMinutes,
      appointmentTypeBufferAfterMinutes
    )

    // Always enforce DB conflict checks, even when calendar tokens fail.
    const queryStart = new Date(startTime.getTime() - 12 * 60 * 60 * 1000)
    const queryEnd = new Date(endTime.getTime() + 12 * 60 * 60 * 1000)
    const { data: existingAppointments, error: dbError } = await adminClient
      .from('scheduled_appointments')
      .select('scheduled_for, duration_minutes, buffer_after_minutes')
      .eq('closer_user_id', closerUserId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('scheduled_for', queryStart.toISOString())
      .lte('scheduled_for', queryEnd.toISOString())

    if (dbError) {
      console.error('Closer availability DB check error:', dbError)
      return { available: false, hasCalendar: false, error: 'Unable to verify schedule conflicts' }
    }

    // Shared rule (lib/scheduling-buffer): the gap must satisfy both the candidate's
    // and the booked appointment's own trailing-gap requirement.
    const hasDbConflict = (existingAppointments || []).some((appt: any) => {
      const apptStart = new Date(appt.scheduled_for)
      const apptEnd = new Date(apptStart.getTime() + (appt.duration_minutes || 60) * 60 * 1000)
      return hasBufferedConflict(
        startTime,
        endTime,
        apptStart,
        apptEnd,
        bufferBefore,
        bufferAfter,
        existingBuffersForAppointment(appt.buffer_after_minutes, baselineBufferAfter, bufferBefore)
      )
    })

    if (hasDbConflict) {
      return { available: false, hasCalendar: true, error: 'Closer already has an appointment at this time' }
    }

    const googleAccessToken = await getValidAccessToken(adminClient, closerUserId)

    if (!googleAccessToken) {
      // No calendar connected - DB check above is still authoritative.
      return { available: true, hasCalendar: false }
    }

    const windowStart = new Date(startTime.getTime() - 12 * 60 * 60 * 1000)
    const windowEnd = new Date(endTime.getTime() + 12 * 60 * 60 * 1000)
    const busySlots = await getFreeBusy(googleAccessToken, windowStart, windowEnd)
    const hasGoogleConflict = busySlots.some((busy: { start: string; end: string }) => {
      const busyStart = new Date(busy.start)
      const busyEnd = new Date(busy.end)
      return hasBufferedConflict(startTime, endTime, busyStart, busyEnd, bufferBefore, bufferAfter)
    })
    return { available: !hasGoogleConflict, hasCalendar: true }
  } catch (error) {
    console.error('Availability check error:', error)
    // Fail closed to prevent double-booking when availability cannot be verified.
    return { available: false, hasCalendar: false, error: error instanceof Error ? error.message : 'Check failed' }
  }
}

export async function POST(request: Request) {
  try {
    const { profile, authUser } = await requireAuthApi()
    const supabase = createServiceClient()
    const body = await request.json().catch(() => ({}))

    const leadId = String(body.lead_id || '')
    let closerUserId = body.closer_user_id ? String(body.closer_user_id) : null
    let teamIdForRoundRobin: string | null = null
    
    // Check if closer_user_id is actually a team selection (format: "team:uuid")
    let roundRobinTeamTimezone: string | null = null
    if (closerUserId && closerUserId.startsWith('team:')) {
      teamIdForRoundRobin = closerUserId.replace('team:', '')
      closerUserId = null // Will be assigned via round-robin
    }

    if (teamIdForRoundRobin) {
      const { data: rrTeam, error: rrTeamError } = await supabase
        .from('teams')
        .select('id, org_id, timezone')
        .eq('id', teamIdForRoundRobin)
        .maybeSingle()

      if (rrTeamError || !rrTeam || rrTeam.org_id !== profile.org_id) {
        return NextResponse.json(
          {
            error: 'That team is not available for scheduling in your organization.',
            code: 'TEAM_NOT_ALLOWED',
          },
          { status: 403 },
        )
      }
      roundRobinTeamTimezone = rrTeam.timezone ?? null
    }
    
    const scheduleInspection = Boolean(body.schedule_inspection)
    
    console.log('Canvass lead API called:', {
      scheduleInspection,
      closerUserId,
      teamIdForRoundRobin,
      inspection_scheduled_for: body.inspection_scheduled_for,
      leadId,
      userId: profile.id,
    })
    
    // Parse inspection time - the client sends local time (e.g., "2026-02-17T09:00")
    // We store UTC in the database but need local time for Google Calendar API
    let inspectionScheduledFor: string | null = null // UTC for database
    let inspectionLocalTime: string | null = null // Local time for Google Calendar
    let closerTimezone = 'America/New_York' // Default, will be updated based on closer/team
    
    if (body.inspection_scheduled_for) {
      const localTimeStr = body.inspection_scheduled_for // e.g., "2026-02-17T09:00"
      inspectionLocalTime = localTimeStr // Keep original for calendar sync
      
      // Get timezone from closer or team (if available)
      if (closerUserId) {
        closerTimezone = await getTimezoneForUser(supabase, closerUserId)
      } else if (teamIdForRoundRobin && roundRobinTeamTimezone) {
        closerTimezone = roundRobinTeamTimezone
      } else if (profile.team_id) {
        const { data: team } = await supabase
          .from('teams')
          .select('timezone')
          .eq('id', profile.team_id)
          .single()
        if (team?.timezone) {
          closerTimezone = team.timezone
        }
      }
      
      inspectionScheduledFor = inspectionLocalWallClockToUtcIso(localTimeStr, closerTimezone)

      console.log(
        `Inspection time conversion: local=${localTimeStr} (${closerTimezone}) -> UTC=${inspectionScheduledFor}`
      )
    }
    // Use round-robin if team was selected OR if no closer was specified
    const useRoundRobin = body.use_round_robin !== false && !closerUserId && scheduleInspection
    
    console.log('Round-robin decision:', {
      'body.use_round_robin': body.use_round_robin,
      'closerUserId': closerUserId,
      'scheduleInspection': scheduleInspection,
      'useRoundRobin': useRoundRobin,
      'teamIdForRoundRobin': teamIdForRoundRobin,
    })

    // Inspection duration: Admin → Scheduling → appointment_types (inspection category)
    const inspectionTypeRows = await fetchOrgAppointmentTypesFromTable(supabase, profile.org_id)
    const inspectionDuration = getInspectionDurationFromTable(inspectionTypeRows, 60)

    if (scheduleInspection && inspectionScheduledFor && closerUserId) {
      const { data: selectedCloser, error: closerError } = await supabase
        .from('users')
        .select('id, role, active, can_receive_appointments')
        .eq('id', closerUserId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (closerError || !selectedCloser || !canReceiveCanvassAppointment(selectedCloser)) {
        return NextResponse.json(
          {
            error:
              'That user is not available for inspection appointments. Choose a calendar-connected closer or a round-robin team.',
            code: 'CLOSER_NOT_ELIGIBLE',
          },
          { status: 409 }
        )
      }

      const googleAccessToken = await getValidAccessToken(supabase, closerUserId)
      if (!googleAccessToken) {
        return NextResponse.json(
          {
            error:
              'That closer does not have Google Calendar connected. Choose another closer or connect their calendar before scheduling.',
            code: 'CALENDAR_NOT_CONNECTED',
          },
          { status: 409 }
        )
      }
    }

    const rep_lat             = body.rep_lat             ?? null
    const rep_lng             = body.rep_lng             ?? null
    const rep_geo_accuracy    = body.rep_geo_accuracy    ?? null
    const rep_geo_captured_at = body.rep_geo_captured_at ?? null

    // Log incoming data for debugging
    console.log('Canvass lead payload:', {
      lat: body.lat,
      lng: body.lng,
      canvass_disposition: body.canvass_disposition,
      homeowner_name: body.homeowner_name,
    })

    const leadPayload: Record<string, any> = {
      closer_user_id: closerUserId,
      inspection_scheduled_for: inspectionScheduledFor,
    }

    const patchLeadFieldIfPresent = (key: string, value: unknown) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        leadPayload[key] = value
      }
    }

    patchLeadFieldIfPresent('homeowner_name', body.homeowner_name || null)
    patchLeadFieldIfPresent('phone', body.phone || null)
    patchLeadFieldIfPresent('email', body.email || null)
    patchLeadFieldIfPresent('address_text', body.address_text || null)
    patchLeadFieldIfPresent('notes', body.notes || null)
    patchLeadFieldIfPresent('canvass_disposition', body.canvass_disposition || null)
    patchLeadFieldIfPresent('canvass_notes', body.canvass_notes || null)

    // Existing-pin edits from the canvass map intentionally omit coordinates.
    // Only write lat/lng when the client explicitly sends them; otherwise we
    // would erase the saved house pin during appointment scheduling.
    patchLeadFieldIfPresent('lat', body.lat ?? null)
    patchLeadFieldIfPresent('lng', body.lng ?? null)
    patchLeadFieldIfPresent('source', body.source || null)

    if (scheduleInspection) {
      leadPayload.status = 'inspection'
      // Note: We don't change canvass_disposition here - the frontend map uses lead.status
      // to determine the pin color for scheduled inspections
      leadPayload.inspection_scheduled_at = new Date().toISOString()
      // NOTE: We no longer change lead.owner_user_id to the closer
      // The lead owner stays as the setter (who knocked the door)
      // The closer is tracked in lead.closer_user_id and opportunity.owner_user_id
      // This ensures the setter gets credit for door knocks in stats
      if (closerUserId) {
        leadPayload.closer_user_id = closerUserId
      }
    }

    let leadRow: any = null
    /** True when this request inserted a new lead row (not update or client-id dedupe reuse). */
    let insertedNewLeadThisRequest = false
    /** True only when we inserted a new opportunities row in this request (not reused existing). */
    let opportunityInsertedThisRequest = false

    const clientLeadId =
      typeof body.client_lead_id === 'string' && body.client_lead_id.trim()
        ? body.client_lead_id.trim()
        : null

    if (leadId) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select(
          'rep_lat, owner_user_id, pin_attributed_user_id, updated_at, created_at, ownership_history',
        )
        .eq('id', leadId)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      let ownershipPatch: Record<string, unknown> = {}
      if (existingLead) {
        const lastKnockAt = existingLead.updated_at ?? existingLead.created_at
        const isDifferentRep =
          !!existingLead.owner_user_id && existingLead.owner_user_id !== profile.id
        const isStale =
          !!lastKnockAt &&
          Date.now() - new Date(lastKnockAt).getTime() >= REASSIGN_AFTER_DAYS * 86_400_000

        if (isDifferentRep && isStale && existingLead.owner_user_id) {
          const reassignedAt = new Date().toISOString()
          ownershipPatch = {
            owner_user_id: profile.id,
            ownership_reassigned_at: reassignedAt,
            ownership_history: appendOwnershipHistory(existingLead.ownership_history, {
              from_user_id: existingLead.owner_user_id,
              from_pin_attributed_user_id: existingLead.pin_attributed_user_id ?? null,
              to_user_id: profile.id,
              reassigned_at: reassignedAt,
              prior_knock_at: lastKnockAt,
            }),
          }
        }
      }

      const updatePayload = {
        ...leadPayload,
        ...ownershipPatch,
        // Only set rep geo on update if not already captured (first-touch wins)
        ...(rep_lat != null && !existingLead?.rep_lat
          ? { rep_lat, rep_lng, rep_geo_accuracy, rep_geo_captured_at }
          : {}),
      }

      const { data: updatedLead, error: updateError } = await supabase
        .from('leads')
        .update(updatePayload)
        .eq('id', leadId)
        .eq('org_id', profile.org_id)
        .select('*')
        .single()

      if (updateError) {
        console.error('Lead update error:', updateError)
        return NextResponse.json({ error: `Failed to update lead: ${updateError.message}` }, { status: 400 })
      }
      leadRow = updatedLead
    } else {
      if (clientLeadId) {
        const dedupeSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: existingByClientId } = await supabase
          .from('leads')
          .select('*')
          .eq('org_id', profile.org_id)
          .eq('owner_user_id', profile.id)
          .eq('client_lead_id', clientLeadId)
          .gte('created_at', dedupeSince)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingByClientId) {
          leadRow = existingByClientId
          console.log('Reusing existing lead for client_lead_id dedupe:', {
            client_lead_id: clientLeadId,
            lead_id: existingByClientId.id,
          })
        }
      }

      if (!leadRow) {
      // Lead owner is always the setter (person who knocked the door)
      // Closer is tracked separately in closer_user_id
      const { data: createdLead, error: createError } = await supabase
        .from('leads')
        .insert({
          org_id: profile.org_id,
          status: scheduleInspection ? 'inspection' : 'new',
          source: body.source || 'door_to_door',
          ...leadPayload,
          client_lead_id: clientLeadId,
          rep_lat,
          rep_lng,
          rep_geo_accuracy,
          rep_geo_captured_at,
          // After spread so a stray `owner_user_id` on payload can never override the authenticated canvasser
          owner_user_id: profile.id,
        })
        .select('*')
        .single()

      if (createError) {
        // Unique-violation on client_lead_id means a concurrent request for the same
        // retry won the race and already inserted this lead — the pre-insert dedupe
        // check above is query-then-insert and has a narrow TOCTOU window on its own.
        // Reuse the winner's row instead of failing this request.
        if (createError.code === '23505' && clientLeadId) {
          const { data: raceWinner } = await supabase
            .from('leads')
            .select('*')
            .eq('org_id', profile.org_id)
            .eq('owner_user_id', profile.id)
            .eq('client_lead_id', clientLeadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (raceWinner) {
            leadRow = raceWinner
            console.log('Reusing lead created by concurrent request (unique-violation race):', {
              client_lead_id: clientLeadId,
              lead_id: raceWinner.id,
            })
          } else {
            console.error('Lead creation error (unique-violation, no row found on re-query):', createError)
            return NextResponse.json({ error: `Failed to create lead: ${createError.message}` }, { status: 400 })
          }
        } else {
          console.error('Lead creation error:', createError)
          return NextResponse.json({ error: `Failed to create lead: ${createError.message}` }, { status: 400 })
        }
      } else {
        leadRow = createdLead
        insertedNewLeadThisRequest = true
        console.log('Created lead:', { id: leadRow?.id, lat: leadRow?.lat, lng: leadRow?.lng, disposition: leadRow?.canvass_disposition })
      }
      }
    }

    if (!leadRow) {
      return NextResponse.json({ error: 'Unable to save lead' }, { status: 400 })
    }

    // Log a knock event whenever this request touches a lead that counts as a canvass
    // door. This is what the dashboard "doors knocked" stat, the sisu leaderboard, setter
    // ramp gating, and Heat door-count badges all read from (see
    // 202608250001_canvass_knocks.sql) — leads.created_at alone never saw a re-knock of a
    // pre-existing pin, because that request UPDATEs the lead row in place with no fresh
    // created_at.
    //
    // isCanvassDoorEligible mirrors the exact OR the dashboard RPCs / setter ramp / Heat
    // apply on read: an unconditional source match (door_to_door/canvass/door_knock/csv_import
    // — e.g. a rep drops a pin with no disposition yet) OR any other non-web/inbound
    // source that carries a disposition. Gating on disposition alone would silently stop
    // counting undispositioned pin drops that the read side still counts.
    //
    // log_canvass_knock() decides server-side whether this is actually a new knock —
    // same-visit-window dedupe against the knock's OWN timestamp (not "now") — and,
    // unless suppressed, logs it under a per-lead advisory lock. That dedupe is why this
    // call is unconditional even when leadRow was reused from ANOTHER request rather than
    // inserted/updated here (offline-queue retry replaying an already-synced create, or
    // losing a concurrent client_lead_id insert race, both carry forward the SAME
    // knocked_at as the original attempt): if the original request's own knock already
    // landed, this call is a same-timestamp no-op; if that original write silently failed
    // (log_canvass_knock errors are non-blocking, below), this retry is what recovers it,
    // rather than a hard-coded skip permanently losing the door either way.
    //
    // knockedAt: the canvass app is offline-first (Zustand + IndexedDB queue —
    // app/(canvass-app)/canvass/lib/offlineStore.ts) — a rep can knock dozens of doors
    // with no signal and sync hours or days later. Passing the client's own capture time
    // (body.knocked_at, set unconditionally at save time in page.tsx, independent of
    // whether geolocation permission was granted) is what lets log_canvass_knock stamp
    // the row with when the knock actually happened rather than when this request
    // happened to reach the server — otherwise a whole offline batch lands on the sync
    // date and can shift doors into the wrong setter-ramp pay period. Falling back to
    // undefined (server NOW()) covers any caller that predates this field.
    const newDisposition = typeof leadRow.canvass_disposition === 'string' ? leadRow.canvass_disposition : null
    // Parse before sending rather than forwarding the raw string: an unparseable value
    // reaches Postgres as a failed TIMESTAMPTZ cast, which throws the whole RPC. Because
    // the knock call below is deliberately non-blocking (the lead save already returned
    // 200, and the offline queue drops its entry on that 200), that error would silently
    // and permanently cost the rep a door on a payroll-driving count. Falling back to
    // undefined lets the server stamp NOW() — a slightly-wrong timestamp beats a lost door.
    const knockedAtRaw = typeof body.knocked_at === 'string' ? body.knocked_at : undefined
    const knockedAtParsed = knockedAtRaw ? new Date(knockedAtRaw) : null
    const knockedAt =
      knockedAtParsed && Number.isFinite(knockedAtParsed.getTime())
        ? knockedAtParsed.toISOString()
        : undefined
    if (knockedAtRaw && !knockedAt) {
      console.error('Ignoring unparseable knocked_at, falling back to server time:', knockedAtRaw)
    }
    if (isCanvassDoorEligible({ source: leadRow.source, canvass_disposition: newDisposition })) {
      // A genuine field knock (the canvass app always sends knocked_at — see above) credits
      // whoever is actually at the door THIS visit, not whoever first dropped the pin: like
      // SalesRabbit/Terros, re-knocking someone else's existing pin is the knocking rep's own
      // door, not the original setter's forever. Non-field callers (e.g. schedule-inspection's
      // server-to-server forward, which never sends knocked_at) keep the frozen pin attribution
      // so an office action can't mint door credit for whoever happens to click "schedule."
      const knockUserId =
        knockedAtRaw !== undefined ? profile.id : getAttributedCanvassLeadUserId(leadRow) ?? profile.id
      const { error: knockError } = await supabase.rpc('log_canvass_knock', {
        p_org_id: profile.org_id,
        p_lead_id: leadRow.id,
        p_user_id: knockUserId,
        p_disposition: newDisposition,
        p_source: leadRow.source ?? null,
        p_created_at: knockedAt ?? null,
      })
      if (knockError) {
        // Non-blocking: the lead save already succeeded and must not fail because the
        // stats side-effect did. Logged so a missed knock is diagnosable, not silent.
        console.error('Failed to log canvass knock:', knockError)
      }
    }

    if (scheduleInspection) {
      try {
        const mapPin = await ensureLeadHasMapPinOrThrow(supabase, {
          id: leadRow.id,
          org_id: profile.org_id,
          address_text: leadRow.address_text,
          lat: leadRow.lat,
          lng: leadRow.lng,
        })
        leadRow = { ...leadRow, lat: mapPin.lat, lng: mapPin.lng }
      } catch (pinError) {
        if (insertedNewLeadThisRequest && leadRow?.id) {
          await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
          console.log('Rolled back new lead after map pin failure:', leadRow.id)
        }
        return NextResponse.json(
          {
            error: pinError instanceof Error ? pinError.message : 'Could not place a house pin for this inspection.',
            code: 'MAP_PIN_FAILED',
          },
          { status: 400 }
        )
      }
    }

    let opportunityId: string | null = null
    let assignedCloserName: string | null = null
    let appointmentId: string | null = null
    let roundRobinGoogleEventId: string | null = null
    let reusedExistingAppointment = false
    /** Set when team RR runs but does not assign (for support / client debugging). */
    let roundRobinFailureDetail: string | undefined

    const orgSchedulingGap = scheduleInspection
      ? await getOrgDefaultSchedulingGapMinutes(supabase, profile.org_id)
      : 15

    const inspectionBufferAfter = getInspectionBufferAfterFromTable(
      inspectionTypeRows,
      orgSchedulingGap
    )

    // Idempotency guard: if this lead already has an appointment at this exact slot,
    // reuse it instead of creating/syncing duplicates.
    if (scheduleInspection && inspectionScheduledFor) {
      const { data: existingAppointment } = await supabase
        .from('scheduled_appointments')
        .select('id, closer_user_id, google_event_id')
        .eq('org_id', profile.org_id)
        .eq('lead_id', leadRow.id)
        .eq('scheduled_for', inspectionScheduledFor)
        .in('status', ['scheduled', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingAppointment?.id) {
        appointmentId = existingAppointment.id
        closerUserId = closerUserId || existingAppointment.closer_user_id || null
        roundRobinGoogleEventId = existingAppointment.google_event_id || null
        reusedExistingAppointment = true
        console.log('Reusing existing appointment to avoid duplicate scheduling:', {
          appointmentId,
          closerUserId,
          hasGoogleEventId: Boolean(roundRobinGoogleEventId),
        })
      }
    }

    // Round-robin assignment if no closer specified (use same admin Supabase client as the rest
    // of this route — do not gate on separate env reads; if lead insert worked, RR can run).
    if (useRoundRobin && inspectionScheduledFor && !appointmentId) {
      const teamId =
        teamIdForRoundRobin || profile.team_id || (await getDefaultTeam(supabase, profile.org_id))

      console.log('Round-robin assignment:', {
        teamIdForRoundRobin,
        profileTeamId: profile.team_id,
        resolvedTeamId: teamId,
        scheduledFor: inspectionScheduledFor,
      })

      if (teamId) {
        const assignment = await assignNextAvailableCloser(
          supabase,
          teamId,
          new Date(inspectionScheduledFor),
          inspectionDuration,
          leadRow.id,
          undefined, // opportunity_id is linked after we resolve/create it below
          leadRow.address_text,
          profile.id, // canvasser
          profile.org_id,
          undefined, // timezone - will use team default
          {
            homeownerName: leadRow.homeowner_name,
            phone: leadRow.phone,
            notes: leadRow.canvass_notes || leadRow.notes,
            setterName: profile.full_name,
            setterEmailHint: pickValidEmail(profile.email, authUser.email),
          },
          orgSchedulingGap,
          inspectionBufferAfter
        )

        console.log('Round-robin assignment result:', assignment)

        if (assignment.success && assignment.closerId) {
          closerUserId = assignment.closerId
          assignedCloserName = assignment.closerName || null
          appointmentId = assignment.appointmentId || null
          roundRobinGoogleEventId = assignment.googleEventId || null

          await supabase
            .from('leads')
            .update({
              closer_user_id: closerUserId,
            })
            .eq('id', leadRow.id)
        } else {
          console.log('Round-robin assignment failed:', assignment.error)
          roundRobinFailureDetail = assignment.error
        }
      } else {
        console.log('No team found for round-robin assignment')
        roundRobinFailureDetail =
          'No team resolved for round-robin (setter has no team and none was selected).'
      }
    }

    // Race / double-submit: another request may have already round-robin assigned this lead+slot
    // (calendar invite sent) while this request's RR failed or ran with stale state.
    if (scheduleInspection && inspectionScheduledFor && !closerUserId && leadRow?.id) {
      const { data: raceAppt } = await supabase
        .from('scheduled_appointments')
        .select('id, closer_user_id, google_event_id')
        .eq('org_id', profile.org_id)
        .eq('lead_id', leadRow.id)
        .eq('scheduled_for', inspectionScheduledFor)
        .in('status', ['scheduled', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (raceAppt?.closer_user_id) {
        closerUserId = raceAppt.closer_user_id
        appointmentId = raceAppt.id
        roundRobinGoogleEventId = raceAppt.google_event_id || roundRobinGoogleEventId
        reusedExistingAppointment = true
        const { data: closerNameRow } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', closerUserId)
          .maybeSingle()
        assignedCloserName = closerNameRow?.full_name ?? assignedCloserName
        await supabase.from('leads').update({ closer_user_id: closerUserId }).eq('id', leadRow.id)
        console.log('Recovered closer from existing appointment (concurrent scheduling):', {
          leadId: leadRow.id,
          closerUserId,
          appointmentId,
        })
      }
    }

    // Do not allow "scheduled" inspections without an assigned closer (round-robin failure, empty queue, etc.).
    if (scheduleInspection && inspectionScheduledFor && !closerUserId) {
      // Lead was already inserted; without rollback the user retries and gets duplicate Sheryl Blacks.
      if (insertedNewLeadThisRequest && leadRow?.id) {
        await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
        console.log('Rolled back new lead after NO_CLOSER_ASSIGNED:', leadRow.id)
      }
      return NextResponse.json(
        {
          error:
            'No closer could be assigned for this time. Choose another time, pick an individual closer, or ask an admin to check the team closer queue and calendars.',
          code: 'NO_CLOSER_ASSIGNED',
          round_robin_detail: roundRobinFailureDetail,
        },
        { status: 409 }
      )
    }

    if (scheduleInspection) {
      const { data: existingOpportunity } = await supabase
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('lead_id', leadRow.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      opportunityId = existingOpportunity?.id ?? null

      // Restore legacy behavior: scheduling an inspection should create an opportunity.
      if (!opportunityId) {
        const opportunityInsertPayload = {
          org_id: profile.org_id,
          lead_id: leadRow.id,
          customer_id: leadRow.customer_id || null,
          owner_user_id: closerUserId || leadRow.owner_user_id || profile.id,
          setter_user_id: profile.id,
          status: 'open',
          project_type: 'roofing',
          address_text: leadRow.address_text || null,
          lat: leadRow.lat ?? null,
          lng: leadRow.lng ?? null,
          notes: leadRow.notes || null,
        }

        const { data: newOpportunity, error: newOpportunityError } = await supabase
          .from('opportunities')
          .insert(opportunityInsertPayload)
          .select('id')
          .single()

        if (newOpportunityError) {
          console.error('Failed to create opportunity during inspection scheduling:', newOpportunityError)
          const { data: fallbackOpportunity } = await supabase
            .from('opportunities')
            .select('id')
            .eq('org_id', profile.org_id)
            .eq('lead_id', leadRow.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          opportunityId = fallbackOpportunity?.id ?? null
        } else {
          opportunityId = newOpportunity?.id ?? null
          if (opportunityId) opportunityInsertedThisRequest = true
        }
      }

      // Create scheduled_appointments record if not already created by round-robin
      // This ensures appointments are tracked even when closer is manually selected
      if (!appointmentId && closerUserId && inspectionScheduledFor) {
        const availabilityCheck = await checkCloserAvailability(
          supabase,
          closerUserId,
          inspectionScheduledFor,
          inspectionDuration,
          orgSchedulingGap,
          inspectionBufferAfter
        )

        if (!availabilityCheck.available) {
          if (insertedNewLeadThisRequest && leadRow?.id) {
            if (opportunityInsertedThisRequest && opportunityId) {
              await supabase.from('opportunities').delete().eq('id', opportunityId).eq('org_id', profile.org_id)
            }
            await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
            console.log('Rolled back new lead (and new opportunity if any) after SCHEDULING_CONFLICT:', leadRow.id)
          }
          return NextResponse.json(
            {
              error: availabilityCheck.error || 'Selected closer is not available at that time',
              code: 'SCHEDULING_CONFLICT',
              closer_user_id: closerUserId,
              scheduled_for: inspectionScheduledFor,
            },
            { status: 409 }
          )
        }

        const { data: createdAppointment, error: apptError } = await supabase
          .from('scheduled_appointments')
          .insert({
            org_id: profile.org_id,
            lead_id: leadRow.id,
            opportunity_id: opportunityId,
            closer_user_id: closerUserId,
            canvasser_user_id: profile.id,
            scheduled_for: inspectionScheduledFor,
            duration_minutes: inspectionDuration,
            buffer_after_minutes: inspectionBufferAfter,
            status: 'scheduled',
            address_text: leadRow.address_text,
          })
          .select('id')
          .single()

        if (apptError) {
          console.error('Appointment creation error:', apptError)
          // Unique index is on (lead_id, scheduled_for) only — recovery must not require closer_user_id,
          // or we miss races / double-submit / RR+manual edge cases.
          const { data: existingAfterConflict } = await supabase
            .from('scheduled_appointments')
            .select('id, google_event_id, closer_user_id')
            .eq('org_id', profile.org_id)
            .eq('lead_id', leadRow.id)
            .eq('scheduled_for', inspectionScheduledFor)
            .in('status', ['scheduled', 'confirmed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (existingAfterConflict?.id) {
            appointmentId = existingAfterConflict.id
            roundRobinGoogleEventId = existingAfterConflict.google_event_id || roundRobinGoogleEventId
            reusedExistingAppointment = true
            if (existingAfterConflict.closer_user_id) {
              closerUserId = existingAfterConflict.closer_user_id
              await supabase
                .from('leads')
                .update({ closer_user_id: closerUserId })
                .eq('id', leadRow.id)
            }
            console.log('Recovered existing appointment row after insert error:', {
              appointmentId,
              reason: apptError.message,
            })
          } else {
            if (insertedNewLeadThisRequest && leadRow?.id) {
              if (opportunityInsertedThisRequest && opportunityId) {
                await supabase.from('opportunities').delete().eq('id', opportunityId).eq('org_id', profile.org_id)
              }
              await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
              console.log('Rolled back new lead after appointment insert failure:', leadRow.id)
            }
            return NextResponse.json(
              {
                error: formatScheduledAppointmentInsertError(apptError.message),
                details: apptError.message,
                code: 'APPOINTMENT_INSERT_FAILED',
              },
              { status: 400 }
            )
          }
        } else {
          appointmentId = createdAppointment?.id ?? null
          console.log('Created scheduled appointment:', appointmentId)
        }
      }

      // Update appointment with opportunity_id if round-robin created it without one
      if (appointmentId && opportunityId) {
        await supabase
          .from('scheduled_appointments')
          .update({ opportunity_id: opportunityId })
          .eq('id', appointmentId)
      }

      // Round-robin can create scheduled_appointments + Google Calendar before the opportunity
      // insert above. If that insert failed, the calendar still shows the job but Opportunities
      // and lead↔opp linking break — recover here and backfill opportunity_id on orphan rows.
      if (leadRow?.id && closerUserId) {
        if (!opportunityId) {
          const recoveryPayload = {
            org_id: profile.org_id,
            lead_id: leadRow.id,
            customer_id: leadRow.customer_id || null,
            owner_user_id: closerUserId || leadRow.owner_user_id || profile.id,
            setter_user_id: profile.id,
            status: 'open' as const,
            project_type: 'roofing' as const,
            address_text: leadRow.address_text || null,
            lat: leadRow.lat ?? null,
            lng: leadRow.lng ?? null,
            notes: leadRow.notes || null,
          }
          const { data: recovered, error: recoveryError } = await supabase
            .from('opportunities')
            .insert(recoveryPayload)
            .select('id')
            .single()

          if (recoveryError) {
            console.error('Failed to recover opportunity after inspection scheduling:', recoveryError)
          } else if (recovered?.id) {
            opportunityId = recovered.id
            opportunityInsertedThisRequest = true
          }
        }
        if (opportunityId) {
          await supabase
            .from('scheduled_appointments')
            .update({ opportunity_id: opportunityId })
            .eq('lead_id', leadRow.id)
            .eq('org_id', profile.org_id)
            .is('opportunity_id', null)
            .in('status', ['scheduled', 'confirmed'])
        }
      }
    }

    // Google Calendar wiring (closer’s calendar = user_google_tokens for closer_user_id):
    // 1) Team round-robin: assignNextAvailableCloser creates the event when a token exists; result in roundRobinGoogleEventId.
    // 2) If RR assigned but event creation failed, roundRobinHandledCalendar is false → backup sync runs (same closer).
    // 3) Manual closer pick: no RR → syncToGoogleCalendar uses closer’s paired token via getValidAccessToken.
    // syncToGoogleCalendar returns synced:false + error if the closer has no token (appointment still exists in CRM).
    let calendarSynced = false
    let setterCalendarSynced = false
    let googleEventId: string | null = roundRobinGoogleEventId
    let calendarError: string | null = null
    let setterCalendarError: string | null = null
    
    // Only treat RR as having handled the calendar if it actually returned a Google event id.
    const roundRobinHandledCalendar = useRoundRobin && Boolean(roundRobinGoogleEventId)
    // Secondary sync: needs local slot string for Google (same as client sent in inspection_scheduled_for).
    const shouldRunSecondaryCalendarSync = Boolean(
      scheduleInspection &&
      closerUserId &&
      inspectionScheduledFor &&
      inspectionLocalTime &&
      !roundRobinHandledCalendar &&
      !googleEventId
    )
    
    console.log('=== CALENDAR SYNC DECISION ===')
    console.log('scheduleInspection:', scheduleInspection)
    console.log('closerUserId:', closerUserId)
    console.log('inspectionScheduledFor:', inspectionScheduledFor)
    console.log('inspectionLocalTime:', inspectionLocalTime)
    console.log('useRoundRobin:', useRoundRobin)
    console.log('assignedCloserName:', assignedCloserName)
    console.log('roundRobinHandledCalendar:', roundRobinHandledCalendar)
    console.log('Will sync calendar:', shouldRunSecondaryCalendarSync)
    
    if (shouldRunSecondaryCalendarSync) {
      const resolvedCloserUserId = closerUserId as string
      const resolvedInspectionScheduledFor = inspectionScheduledFor as string
      const resolvedInspectionLocalTime = inspectionLocalTime as string

      // Sync to closer's calendar only — setter gets a confirmation email instead of a calendar invite
      const calendarResult = await syncToGoogleCalendar(
        supabase,
        resolvedCloserUserId,
        resolvedInspectionLocalTime,
        inspectionDuration,
        leadRow.homeowner_name,
        leadRow.address_text,
        leadRow.phone,
        leadRow.notes,
        leadRow.canvass_notes,
        leadRow.id,
        opportunityId,
        profile.full_name, // Setter name (shown in event description only)
        null // No setter calendar invite
      )

      calendarSynced = calendarResult.synced
      googleEventId = calendarResult.eventId || null
      calendarError = calendarResult.error || null

      if (!calendarSynced) {
        console.log('Closer calendar sync failed:', calendarError)
      }

      // Send setter a confirmation email (not a calendar invite on this path)
      if (profile.id !== resolvedCloserUserId) {
        try {
          let setterEmail = pickValidEmail(profile.email, authUser.email)
          if (!setterEmail) {
            const { data: setterData } = await supabase
              .from('users')
              .select('email')
              .eq('id', profile.id)
              .maybeSingle()
            setterEmail = pickValidEmail(setterData?.email)
          }

          if (setterEmail) {
            const { data: closerProfile } = await supabase
              .from('users')
              .select('full_name')
              .eq('id', resolvedCloserUserId)
              .maybeSingle()

            const closerName = closerProfile?.full_name || 'Unassigned'
            const setterName = profile.full_name || 'Setter'
            const scheduledTime = formatInspectionTimeEt(resolvedInspectionScheduledFor)

            const { sendSetterEmail } = await import('@/lib/setter-email')
            await sendSetterEmail({
              to: setterEmail,
              recipientUserId: profile.id,
              setterName,
              subject: `🚀 ${leadRow.homeowner_name || 'Customer'} Inspection Set 🚀`,
              introHtml: `<p style="color:#374151;">Your inspection has been scheduled. Here are the details:</p>`,
              rows: [
                { label: 'Customer', value: leadRow.homeowner_name || 'Unknown' },
                { label: 'Address', value: leadRow.address_text || 'TBD' },
                { label: 'Date & Time', value: scheduledTime },
                { label: 'Inspector / Closer', value: closerName },
              ],
            })
          }
        } catch (setterEmailError) {
          // Non-blocking
          console.error('Failed to send setter confirmation email:', setterEmailError)
        }
      }
      
      // Store Google event ID in the appointment if we have one
      if (appointmentId && googleEventId) {
        await supabase
          .from('scheduled_appointments')
          .update({ google_event_id: googleEventId })
          .eq('id', appointmentId)
      }
      
      // pending_status_prompt is created by DB trigger (aligned with org + type buffers)

    } else if (roundRobinHandledCalendar) {
      // Round-robin already synced calendars
      calendarSynced = true
      setterCalendarSynced = true
      console.log('Calendar sync handled by round-robin assignment')
    } else if (scheduleInspection && googleEventId) {
      // Existing event already linked to this appointment slot.
      calendarSynced = true
      console.log('Skipping calendar sync because appointment already has Google event:', googleEventId)
    }

    if (scheduleInspection) {
      let activityBody = assignedCloserName 
        ? `Inspection scheduled from canvassing. Assigned to ${assignedCloserName} via round-robin.`
        : 'Inspection scheduled from canvassing.'
      
      if (calendarSynced) {
        activityBody += ' Added to closer calendar.'
      }
      
      await supabase.from('activities').insert({
        org_id: profile.org_id,
        lead_id: leadRow.id,
        user_id: profile.id,
        type: 'status_change',
        body: activityBody,
      })

      // Alert if an inspection is scheduled without an assigned closer.
      if (!closerUserId) {
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
          const leadUrl = `${appUrl}/leads/${leadRow.id}`
          const scheduledTime = formatInspectionTimeEt(inspectionScheduledFor)

          const transporter = getMailTransport()
          await transporter.sendMail({
            from: getCrmEmailFrom(),
            to: 'nathan@arxroofing.com',
            subject: '!!!!!ATERT!!!!! Usassigned closer',
            text: `An inspection was scheduled without an assigned closer.\n\nLead: ${leadRow.homeowner_name || 'Unknown'}\nAddress: ${leadRow.address_text || 'TBD'}\nScheduled: ${scheduledTime}\nLead URL: ${leadUrl}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                <h2 style="margin: 0 0 12px; color: #b91c1c;">Inspection Scheduled Without Closer</h2>
                <p style="color: #374151; margin: 0 0 6px;"><strong>Lead:</strong> ${leadRow.homeowner_name || 'Unknown'}</p>
                <p style="color: #374151; margin: 0 0 6px;"><strong>Address:</strong> ${leadRow.address_text || 'TBD'}</p>
                <p style="color: #374151; margin: 0 0 12px;"><strong>Scheduled:</strong> ${scheduledTime}</p>
                <p style="margin: 0;"><a href="${leadUrl}" style="color: #4f46e5; text-decoration: none;">Open lead in CRM</a></p>
              </div>
            `,
          })
        } catch (alertEmailError) {
          // Non-blocking: scheduling should still complete.
          console.error('Failed to send unassigned-closer alert email:', alertEmailError)
        }
      }
      
      // Notify the closer about the new appointment
      if (closerUserId) {
        const { data: setterProfile } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', profile.id)
          .single()
        
        const setterName = setterProfile?.full_name || 'A setter'
        const scheduledTime = formatInspectionTimeEt(inspectionScheduledFor)
        
        if (closerUserId !== profile.id) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            recipient_user_id: closerUserId,
            actor_user_id: profile.id,
            type: 'appointment_assigned',
            title: 'New Inspection Assigned',
            body: `${setterName} scheduled an inspection for you at ${leadRow.address_text || 'address TBD'} on ${scheduledTime}${!calendarSynced ? ' (Calendar not synced - please add manually)' : ''}`,
            link_url: opportunityId ? `/opportunities/${opportunityId}` : `/leads/${leadRow.id}`,
          })
          // Best-effort APNs — append only; does not change scheduling logic.
          const { sendPushToUserBackground } = await import('@/lib/push-apns')
          sendPushToUserBackground(
            closerUserId,
            'New Inspection Assigned',
            `${setterName} scheduled an inspection for you at ${leadRow.address_text || 'address TBD'} on ${scheduledTime}`,
            { type: 'appointment' }
          )
        }

        // Also email assigned closer for canvass inspection assignment.
        try {
          const { data: closerProfile } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', closerUserId)
            .single()

          if (
            closerProfile?.email &&
            (await isUserActiveForTransactionalEmail(createServiceClient(), closerUserId))
          ) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
            const recordUrl = opportunityId ? `${appUrl}/opportunities/${opportunityId}` : `${appUrl}/leads/${leadRow.id}`
            const closerName = closerProfile.full_name || 'Closer'

            const transporter = getMailTransport()
            await transporter.sendMail({
              from: getCrmEmailFrom(),
              to: closerProfile.email,
              subject: 'You were assigned an inspection',
              text: `Hi ${closerName},\n\nYou were just assigned an inspection.\n\nLead Name: ${leadRow.homeowner_name || 'Unknown'}\nAddress: ${leadRow.address_text || 'TBD'}\nPhone: ${leadRow.phone || 'N/A'}\nScheduled: ${scheduledTime}\nSet by: ${setterName}\n\nOpen in CRM: ${recordUrl}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
                  <h2 style="margin: 0 0 12px; color: #111827;">You were assigned an inspection</h2>
                  <p style="color: #374151;">Hi ${closerName},</p>
                  <p style="color: #374151;">You were just assigned an inspection.</p>
                  <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
                    <tr><td style="padding: 6px 0; color: #6B7280; width: 120px;">Lead Name:</td><td style="padding: 6px 0; color: #111827;">${leadRow.homeowner_name || 'Unknown'}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6B7280; width: 120px;">Address:</td><td style="padding: 6px 0; color: #111827;">${leadRow.address_text || 'TBD'}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6B7280;">Phone:</td><td style="padding: 6px 0; color: #111827;">${leadRow.phone || 'N/A'}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6B7280;">Scheduled:</td><td style="padding: 6px 0; color: #111827;">${scheduledTime}</td></tr>
                    <tr><td style="padding: 6px 0; color: #6B7280;">Set by:</td><td style="padding: 6px 0; color: #111827;">${setterName}</td></tr>
                  </table>
                  <p><a href="${recordUrl}" style="color: #4f46e5; text-decoration: none;">Open in CRM</a></p>
                </div>
              `,
            })
          }
        } catch (emailError) {
          // Non-blocking: scheduling flow should still complete even if email fails.
          console.error('Failed to send closer assignment email:', emailError)
        }
      }
    }

    const result = {
      lead_id: leadRow.id,
      /** Echo for canvass map: client uses this when opportunity_id is still null */
      schedule_inspection: scheduleInspection,
      status: leadRow.status ?? null,
      opportunity_id: opportunityId,
      assigned_closer: assignedCloserName,
      appointment_id: appointmentId,
      reused_existing_appointment: reusedExistingAppointment,
      calendar_synced: calendarSynced,
      calendar_error: calendarError,
      setter_calendar_synced: setterCalendarSynced,
      setter_calendar_error: setterCalendarError,
      google_event_id: googleEventId,
    }
    
    console.log('Canvass lead API result:', result)
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Canvass lead API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to process lead' 
    }, { status: 500 })
  }
}

// DELETE - Delete a lead/pin (cascades pristine pre-inspection appointments + calendar)
export async function DELETE(request: Request) {
  try {
    const { profile } = await requireAuthApi()
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('id')

    if (!leadId) {
      return NextResponse.json({ error: 'Lead ID is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const result = await deleteCanvassLeadWithDependencies({
      admin: supabase,
      orgId: profile.org_id,
      leadId,
      actorUserId: profile.id,
      actorRole: profile.role,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      deleted_id: result.deleted_id,
      ...(result.calendarWarnings.length > 0
        ? { calendarSync: { warnings: result.calendarWarnings } }
        : {}),
    })
  } catch (error) {
    console.error('Delete lead error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete lead' 
    }, { status: 500 })
  }
}
