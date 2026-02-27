import { requireAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { 
  createCalendarEvent, 
  refreshAccessToken,
  isSlotAvailable,
  CalendarEvent 
} from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Helper to get valid access token (refresh if needed)
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  const { data: tokenData } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!tokenData) return null

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
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

      return refreshed.access_token
    } catch (error) {
      console.error('Failed to refresh token:', error)
      return null
    }
  }

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
  opportunityId: string | null
): Promise<{ synced: boolean; eventId?: string; error?: string }> {
  try {
    const googleAccessToken = await getValidAccessToken(adminClient, closerUserId)
    
    if (!googleAccessToken) {
      return { synced: false, error: 'Closer does not have Google Calendar connected' }
    }

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
    }

    const createdEvent = await createCalendarEvent(googleAccessToken, event)
    return { synced: true, eventId: createdEvent.id }
  } catch (error) {
    console.error('Google Calendar sync error:', error)
    return { synced: false, error: error instanceof Error ? error.message : 'Calendar sync failed' }
  }
}

// Helper to sync appointment to setter's Google Calendar (visibility only, can be double-booked)
async function syncToSetterCalendar(
  adminClient: any,
  setterUserId: string,
  closerName: string | null,
  scheduledFor: string,
  durationMinutes: number,
  homeownerName: string | null,
  addressText: string | null,
  phone: string | null,
  leadId: string,
  opportunityId: string | null
): Promise<{ synced: boolean; eventId?: string; error?: string }> {
  try {
    const googleAccessToken = await getValidAccessToken(adminClient, setterUserId)
    
    if (!googleAccessToken) {
      return { synced: false, error: 'Setter does not have Google Calendar connected' }
    }

    // Get timezone from setter's team
    const timezone = await getTimezoneForUser(adminClient, setterUserId)

    // scheduledFor is in format "YYYY-MM-DDTHH:MM" (local time)
    // We need to send it to Google Calendar with the timezone, NOT as UTC
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

    // Different title for setter - shows it's their set appointment
    const event: CalendarEvent = {
      summary: `[Set] ${homeownerName || 'Customer'}${closerName ? ` → ${closerName}` : ''}`,
      description: [
        'Appointment you scheduled',
        closerName ? `Closer: ${closerName}` : '',
        `Customer: ${homeownerName || 'N/A'}`,
        phone ? `Phone: ${phone}` : '',
        addressText ? `Address: ${addressText}` : '',
      ].filter(Boolean).join('\n'),
      location: addressText || undefined,
      start: {
        dateTime: startDateTime,
        timeZone: timezone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: timezone,
      },
    }

    const createdEvent = await createCalendarEvent(googleAccessToken, event)
    return { synced: true, eventId: createdEvent.id }
  } catch (error) {
    console.error('Setter calendar sync error:', error)
    return { synced: false, error: error instanceof Error ? error.message : 'Setter calendar sync failed' }
  }
}

// Helper to check closer availability via Google Calendar
async function checkCloserAvailability(
  adminClient: any,
  closerUserId: string,
  scheduledFor: string,
  durationMinutes: number
): Promise<{ available: boolean; hasCalendar: boolean; error?: string }> {
  try {
    const googleAccessToken = await getValidAccessToken(adminClient, closerUserId)
    
    if (!googleAccessToken) {
      // No calendar connected - assume available
      return { available: true, hasCalendar: false }
    }

    // Get closer's buffer settings
    const { data: settings } = await adminClient
      .from('user_settings')
      .select('appointment_buffer_minutes')
      .eq('user_id', closerUserId)
      .single()

    const bufferMinutes = settings?.appointment_buffer_minutes || 30

    const startTime = new Date(scheduledFor)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)

    const available = await isSlotAvailable(googleAccessToken, startTime, endTime, bufferMinutes)
    return { available, hasCalendar: true }
  } catch (error) {
    console.error('Availability check error:', error)
    // On error, assume available to not block scheduling
    return { available: true, hasCalendar: false, error: error instanceof Error ? error.message : 'Check failed' }
  }
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireAuth()
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
      // DST in US is roughly second Sunday of March to first Sunday of November
      const targetMonth = month
      const isDST = targetMonth >= 3 && targetMonth <= 10 // Rough DST check
      
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

    // Get default inspection duration from appointment_types
    let inspectionDuration = 60 // default
    const { data: inspectionType } = await supabase
      .from('appointment_types')
      .select('duration_minutes')
      .eq('org_id', profile.org_id)
      .eq('category', 'inspection')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    
    if (inspectionType?.duration_minutes) {
      inspectionDuration = inspectionType.duration_minutes
    }

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

    // Round-robin assignment if no closer specified
    if (useRoundRobin && inspectionScheduledFor) {
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
            undefined, // opportunity_id - will be created below
            leadRow.address_text,
            profile.id, // canvasser
            profile.org_id,
            undefined, // timezone - will use team default
            {
              homeownerName: leadRow.homeowner_name,
              phone: leadRow.phone,
              notes: leadRow.canvass_notes || leadRow.notes,
            }
          )

          console.log('Round-robin assignment result:', assignment)

          if (assignment.success && assignment.closerId) {
            closerUserId = assignment.closerId
            assignedCloserName = assignment.closerName || null
            appointmentId = assignment.appointmentId || null

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

    if (scheduleInspection) {
      const { data: existingOpportunity } = await supabase
        .from('opportunities')
        .select('id')
        .eq('lead_id', leadRow.id)
        .maybeSingle()

      if (existingOpportunity?.id) {
        opportunityId = existingOpportunity.id
      } else {
        // The setter is the original lead owner (canvasser who set the appointment)
        const setterId = leadRow.owner_user_id || profile.id
        const { data: createdOpportunity, error: oppError } = await supabase
          .from('opportunities')
          .insert({
            org_id: profile.org_id,
            lead_id: leadRow.id,
            owner_user_id: closerUserId || leadRow.owner_user_id || profile.id,
            setter_user_id: setterId, // Track the setter for comp plans
            status: 'open',
            project_type: 'roofing',
            address_text: leadRow.address_text,
            lat: leadRow.lat,
            lng: leadRow.lng,
            notes: leadRow.notes,
          })
          .select('id')
          .single()

        if (oppError) {
          console.error('Opportunity creation error:', oppError)
        }
        opportunityId = createdOpportunity?.id ?? null
      }

      // Create scheduled_appointments record if not already created by round-robin
      // This ensures appointments are tracked even when closer is manually selected
      if (!appointmentId && closerUserId && inspectionScheduledFor) {
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
            status: 'scheduled',
            address_text: leadRow.address_text,
          })
          .select('id')
          .single()

        if (apptError) {
          console.error('Appointment creation error:', apptError)
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
    }

    // Sync to Google Calendar if we have a closer and scheduled time
    // SKIP if round-robin was used - it already creates calendar events
    let calendarSynced = false
    let setterCalendarSynced = false
    let googleEventId: string | null = null
    let calendarError: string | null = null
    let setterCalendarError: string | null = null
    
    // Only sync calendars manually if round-robin was NOT used
    // Round-robin already handles calendar event creation in assignNextAvailableCloser()
    const roundRobinHandledCalendar = useRoundRobin && assignedCloserName
    
    if (scheduleInspection && closerUserId && inspectionScheduledFor && !roundRobinHandledCalendar) {
      // Get closer's name for setter calendar event
      const { data: closerData } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', closerUserId)
        .single()
      const closerName = closerData?.full_name || assignedCloserName
      
      // Sync to closer's calendar (they need to be available)
      // Use local time for Google Calendar API (not UTC)
      const calendarResult = await syncToGoogleCalendar(
        supabase,
        closerUserId,
        inspectionLocalTime!, // Use local time, not UTC
        inspectionDuration,
        leadRow.homeowner_name,
        leadRow.address_text,
        leadRow.phone,
        leadRow.notes,
        leadRow.canvass_notes,
        leadRow.id,
        opportunityId
      )
      
      calendarSynced = calendarResult.synced
      googleEventId = calendarResult.eventId || null
      calendarError = calendarResult.error || null
      
      if (!calendarSynced) {
        console.log('Closer calendar sync failed:', calendarError)
      }
      
      // Store Google event ID in the appointment if we have one
      if (appointmentId && googleEventId) {
        await supabase
          .from('scheduled_appointments')
          .update({ google_event_id: googleEventId })
          .eq('id', appointmentId)
      }
      
      // Create pending status prompt for feedback after appointment
      if (appointmentId && closerUserId) {
        const appointmentEndTime = new Date(new Date(inspectionScheduledFor).getTime() + 60 * 60 * 1000) // +1 hour
        try {
          await supabase
            .from('pending_status_prompts')
            .insert({
              org_id: profile.org_id,
              appointment_id: appointmentId,
              closer_user_id: closerUserId,
              prompt_at: appointmentEndTime.toISOString(),
            })
        } catch (promptError) {
          console.error('Failed to create pending prompt:', promptError)
          // Non-critical, continue
        }
      }
      
      // Also sync to setter's calendar (for visibility - they can be double-booked)
      // Only if setter is different from closer
      if (profile.id !== closerUserId) {
        const setterResult = await syncToSetterCalendar(
          supabase,
          profile.id, // setter is the current user who scheduled
          closerName,
          inspectionLocalTime!, // Use local time, not UTC
          inspectionDuration,
          leadRow.homeowner_name,
          leadRow.address_text,
          leadRow.phone,
          leadRow.id,
          opportunityId
        )
        setterCalendarSynced = setterResult.synced
        setterCalendarError = setterResult.error || null
        
        if (!setterCalendarSynced) {
          console.log('Setter calendar sync failed:', setterCalendarError)
        }
      }
    } else if (roundRobinHandledCalendar) {
      // Round-robin already synced calendars
      calendarSynced = true
      setterCalendarSynced = true
      console.log('Calendar sync handled by round-robin assignment')
    }

    if (scheduleInspection) {
      let activityBody = assignedCloserName 
        ? `Inspection scheduled from canvassing. Assigned to ${assignedCloserName} via round-robin.`
        : 'Inspection scheduled from canvassing.'
      
      if (calendarSynced && setterCalendarSynced) {
        activityBody += ' Added to closer and setter calendars.'
      } else if (calendarSynced) {
        activityBody += ' Added to closer calendar.'
      } else if (setterCalendarSynced) {
        activityBody += ' Added to setter calendar.'
      }
      
      await supabase.from('activities').insert({
        org_id: profile.org_id,
        lead_id: leadRow.id,
        user_id: profile.id,
        type: 'status_change',
        body: activityBody,
      })
      
      // Notify the closer about the new appointment
      if (closerUserId && closerUserId !== profile.id) {
        const { data: setterProfile } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', profile.id)
          .single()
        
        const setterName = setterProfile?.full_name || 'A setter'
        const scheduledTime = inspectionScheduledFor 
          ? new Date(inspectionScheduledFor).toLocaleString('en-US', {
              weekday: 'short',
              month: 'short', 
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            })
          : 'TBD'
        
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
    }

    if (opportunityId) {
      await supabase.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId,
        user_id: profile.id,
        type: 'status_change',
        body: 'Opportunity created from canvassing inspection.',
      })
    }

    const result = {
      lead_id: leadRow.id,
      opportunity_id: opportunityId,
      assigned_closer: assignedCloserName,
      appointment_id: appointmentId,
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
    const { profile } = await requireAuth()
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
