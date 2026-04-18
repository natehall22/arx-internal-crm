import { requireAuthApi } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionBufferAfterFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  createCalendarEvent,
  refreshAccessToken,
  getFreeBusy,
  CalendarEvent,
} from '@/lib/google-calendar'
import { hasBufferedConflict } from '@/lib/scheduling-buffer'
import { getOrgDefaultSchedulingGapMinutes, resolveSchedulingBuffers } from '@/lib/org-scheduling-gap'
import nodemailer from 'nodemailer'
import { formatDateTimeInTimezone } from '@/lib/timezone'
import { pickValidEmail } from '@/lib/setter-email'

export const dynamic = 'force-dynamic'

function formatInspectionTimeEt(iso: string | null | undefined): string {
  if (!iso) return 'TBD'
  return `${formatDateTimeInTimezone(iso)} ET`
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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
    .single()

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
  orgDefaultGapMinutes: number
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

    const { bufferBefore, bufferAfter } = resolveSchedulingBuffers(
      queueEntry ?? undefined,
      settings ?? undefined,
      orgDefaultGapMinutes
    )

    // Always enforce DB conflict checks, even when calendar tokens fail.
    const queryStart = new Date(startTime.getTime() - 12 * 60 * 60 * 1000)
    const queryEnd = new Date(endTime.getTime() + 12 * 60 * 60 * 1000)
    const { data: existingAppointments, error: dbError } = await adminClient
      .from('scheduled_appointments')
      .select('scheduled_for, duration_minutes')
      .eq('closer_user_id', closerUserId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('scheduled_for', queryStart.toISOString())
      .lte('scheduled_for', queryEnd.toISOString())

    if (dbError) {
      console.error('Closer availability DB check error:', dbError)
      return { available: false, hasCalendar: false, error: 'Unable to verify schedule conflicts' }
    }

    const hasDbConflict = (existingAppointments || []).some((appt: any) => {
      const apptStart = new Date(appt.scheduled_for)
      const apptEnd = new Date(apptStart.getTime() + (appt.duration_minutes || 60) * 60 * 1000)
      const blockedStart = new Date(apptStart.getTime() - bufferAfter * 60 * 1000)
      const blockedEnd = new Date(apptEnd.getTime() + bufferBefore * 60 * 1000)
      return startTime < blockedEnd && endTime > blockedStart
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
    const supabase = getAdminClient()
    const body = await request.json().catch(() => ({}))

    const leadId = String(body.lead_id || '')
    let closerUserId = body.closer_user_id ? String(body.closer_user_id) : null
    let teamIdForRoundRobin: string | null = null
    
    // Check if closer_user_id is actually a team selection (format: "team:uuid")
    if (closerUserId && closerUserId.startsWith('team:')) {
      teamIdForRoundRobin = closerUserId.replace('team:', '')
      closerUserId = null // Will be assigned via round-robin
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
      } else if (teamIdForRoundRobin) {
        const { data: team } = await supabase
          .from('teams')
          .select('timezone')
          .eq('id', teamIdForRoundRobin)
          .single()
        if (team?.timezone) {
          closerTimezone = team.timezone
        }
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
      
      const [datePart, timePart] = localTimeStr.split('T')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      
      // Determine timezone offset based on the TARGET date (for DST handling)
      // DST in US starts second Sunday of March, ends first Sunday of November
      // More accurate check: March 8+ through November 1- (approximate)
      const isDST = (month > 3 && month < 11) || 
                    (month === 3 && day >= 8) || 
                    (month === 11 && day < 7)
      
      let tzOffsetHours = 5 // Default to Eastern Standard Time
      if (closerTimezone === 'America/New_York' || closerTimezone === 'America/Detroit' || closerTimezone === 'US/Eastern') {
        tzOffsetHours = isDST ? 4 : 5
      } else if (closerTimezone === 'America/Chicago' || closerTimezone === 'US/Central') {
        tzOffsetHours = isDST ? 5 : 6
      } else if (closerTimezone === 'America/Denver' || closerTimezone === 'US/Mountain') {
        tzOffsetHours = isDST ? 6 : 7
      } else if (closerTimezone === 'America/Los_Angeles' || closerTimezone === 'US/Pacific') {
        tzOffsetHours = isDST ? 7 : 8
      } else if (closerTimezone === 'America/Phoenix') {
        tzOffsetHours = 7 // Arizona doesn't observe DST
      }
      
      const utcDate = new Date(Date.UTC(year, month - 1, day, hour + tzOffsetHours, minute, 0))
      inspectionScheduledFor = utcDate.toISOString()
      
      console.log(`Inspection time conversion: local=${localTimeStr} (${closerTimezone}, offset=${tzOffsetHours}h, isDST=${isDST}) -> UTC=${inspectionScheduledFor}`)
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

    // Log incoming data for debugging
    console.log('Canvass lead payload:', {
      lat: body.lat,
      lng: body.lng,
      canvass_disposition: body.canvass_disposition,
      homeowner_name: body.homeowner_name,
    })

    const leadPayload: Record<string, any> = {
      homeowner_name: body.homeowner_name || null,
      phone: body.phone || null,
      email: body.email || null,
      address_text: body.address_text || null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      notes: body.notes || null,
      canvass_disposition: body.canvass_disposition || null,
      canvass_notes: body.canvass_notes || null,
      closer_user_id: closerUserId,
      inspection_scheduled_for: inspectionScheduledFor,
    }

    if (Object.prototype.hasOwnProperty.call(body, 'source')) {
      leadPayload.source = body.source || null
    }

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
    /** True when this request created a new lead row (not an update). Used to roll back on scheduling failure. */
    const isNewLeadCreate = !leadId
    /** True only when we inserted a new opportunities row in this request (not reused existing). */
    let opportunityInsertedThisRequest = false

    if (leadId) {
      const { data: updatedLead, error: updateError } = await supabase
        .from('leads')
        .update(leadPayload)
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
      // Lead owner is always the setter (person who knocked the door)
      // Closer is tracked separately in closer_user_id
      const { data: createdLead, error: createError } = await supabase
        .from('leads')
        .insert({
          org_id: profile.org_id,
          owner_user_id: profile.id, // Setter is always the owner
          status: scheduleInspection ? 'inspection' : 'new',
          source: body.source || 'door_to_door',
          ...leadPayload,
        })
        .select('*')
        .single()

      if (createError) {
        console.error('Lead creation error:', createError)
        return NextResponse.json({ error: `Failed to create lead: ${createError.message}` }, { status: 400 })
      }
      leadRow = createdLead
      console.log('Created lead:', { id: leadRow?.id, lat: leadRow?.lat, lng: leadRow?.lng, disposition: leadRow?.canvass_disposition })
    }

    if (!leadRow) {
      return NextResponse.json({ error: 'Unable to save lead' }, { status: 400 })
    }

    let opportunityId: string | null = null
    let assignedCloserName: string | null = null
    let appointmentId: string | null = null
    let roundRobinGoogleEventId: string | null = null
    let reusedExistingAppointment = false

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

    // Round-robin assignment if no closer specified
    if (useRoundRobin && inspectionScheduledFor && !appointmentId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (supabaseUrl && supabaseServiceKey) {
        const serviceClient = createServiceClient(supabaseUrl, supabaseServiceKey)
        
        // Use explicitly selected team, or fall back to user's team or default team
        const teamId = teamIdForRoundRobin || profile.team_id || await getDefaultTeam(serviceClient, profile.org_id)

        console.log('Round-robin assignment:', {
          teamIdForRoundRobin,
          profileTeamId: profile.team_id,
          resolvedTeamId: teamId,
          scheduledFor: inspectionScheduledFor,
        })

        if (teamId) {
          const assignment = await assignNextAvailableCloser(
            supabaseUrl,
            supabaseServiceKey,
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

            // Update lead with assigned closer (but keep owner_user_id as setter)
            await supabase
              .from('leads')
              .update({ 
                closer_user_id: closerUserId
                // NOTE: Don't change owner_user_id - setter keeps credit for door knock
              })
              .eq('id', leadRow.id)
          } else {
            console.log('Round-robin assignment failed:', assignment.error)
          }
        } else {
          console.log('No team found for round-robin assignment')
        }
      }
    }

    // Do not allow "scheduled" inspections without an assigned closer (round-robin failure, empty queue, etc.).
    if (scheduleInspection && inspectionScheduledFor && !closerUserId) {
      // Lead was already inserted; without rollback the user retries and gets duplicate Sheryl Blacks.
      if (isNewLeadCreate && leadRow?.id) {
        await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
        console.log('Rolled back new lead after NO_CLOSER_ASSIGNED:', leadRow.id)
      }
      return NextResponse.json(
        {
          error:
            'No closer could be assigned for this time. Choose another time, pick an individual closer, or ask an admin to check the team closer queue and calendars.',
          code: 'NO_CLOSER_ASSIGNED',
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
          orgSchedulingGap
        )

        if (!availabilityCheck.available) {
          if (isNewLeadCreate && leadRow?.id) {
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
          const { data: existingAfterConflict } = await supabase
            .from('scheduled_appointments')
            .select('id, google_event_id')
            .eq('org_id', profile.org_id)
            .eq('lead_id', leadRow.id)
            .eq('closer_user_id', closerUserId)
            .eq('scheduled_for', inspectionScheduledFor)
            .in('status', ['scheduled', 'confirmed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (existingAfterConflict?.id) {
            appointmentId = existingAfterConflict.id
            roundRobinGoogleEventId = existingAfterConflict.google_event_id || roundRobinGoogleEventId
            reusedExistingAppointment = true
          } else {
            if (isNewLeadCreate && leadRow?.id) {
              if (opportunityInsertedThisRequest && opportunityId) {
                await supabase.from('opportunities').delete().eq('id', opportunityId).eq('org_id', profile.org_id)
              }
              await supabase.from('leads').delete().eq('id', leadRow.id).eq('org_id', profile.org_id)
              console.log('Rolled back new lead after appointment insert failure:', leadRow.id)
            }
            return NextResponse.json(
              {
                error: 'Failed to create appointment',
                details: apptError.message,
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
            from: 'info@arxroofing.com',
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
        }

        // Also email assigned closer for canvass inspection assignment.
        try {
          const { data: closerProfile } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', closerUserId)
            .single()

          if (closerProfile?.email) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://arx-internal-crm.vercel.app'
            const recordUrl = opportunityId ? `${appUrl}/opportunities/${opportunityId}` : `${appUrl}/leads/${leadRow.id}`
            const closerName = closerProfile.full_name || 'Closer'

            const transporter = getMailTransport()
            await transporter.sendMail({
              from: 'info@arxroofing.com',
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

// DELETE - Delete a lead/pin
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

    const supabase = getAdminClient()

    // First verify the lead exists and belongs to this org
    const { data: lead, error: fetchError } = await supabase
      .from('leads')
      .select('id, org_id, owner_user_id')
      .eq('id', leadId)
      .single()

    if (fetchError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (lead.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Only allow deletion by owner or admin
    const isAdmin = profile.role === 'admin'
    const isOwner = lead.owner_user_id === profile.id
    
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Only the pin owner or admin can delete this pin' }, { status: 403 })
    }

    // Delete the lead
    const { error: deleteError } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId)

    if (deleteError) {
      console.error('Delete lead error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted_id: leadId })
  } catch (error) {
    console.error('Delete lead error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete lead' 
    }, { status: 500 })
  }
}
