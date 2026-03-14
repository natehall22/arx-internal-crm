import { createClient } from '@supabase/supabase-js'
import { refreshAccessToken, getFreeBusy, createCalendarEvent } from './google-calendar'
import type { TeamCloserQueue, UserGoogleToken, ScheduledAppointment } from './types/database'

type CloserWithToken = TeamCloserQueue & {
  user: {
    id: string
    full_name: string | null
    email: string | null
  }
  google_token?: UserGoogleToken | null
}

interface AssignmentResult {
  success: boolean
  closerId?: string
  closerName?: string
  appointmentId?: string
  googleEventId?: string
  error?: string
}

/**
 * Get the next available closer from the round-robin queue
 * Checks calendar availability if Google Calendar is connected
 */
export async function assignNextAvailableCloser(
  supabaseUrl: string,
  supabaseServiceKey: string,
  teamId: string,
  scheduledFor: Date,
  durationMinutes: number = 60,
  leadId?: string,
  opportunityId?: string,
  address?: string,
  canvasserUserId?: string,
  orgId?: string,
  timezone?: string,
  // Additional details for calendar event
  customerDetails?: {
    homeownerName?: string | null
    phone?: string | null
    notes?: string | null
    setterName?: string | null
  }
): Promise<AssignmentResult> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get team timezone if not provided
    let teamTimezone = timezone || 'America/New_York'
    if (!timezone) {
      const { data: team } = await supabase
        .from('teams')
        .select('timezone')
        .eq('id', teamId)
        .single()
      
      if (team?.timezone) {
        teamTimezone = team.timezone
      }
    }

    // Get active closers in priority order
    const { data: closers, error: closersError } = await supabase
      .from('team_closer_queue')
      .select(`
        *,
        user:users(id, full_name, email)
      `)
      .eq('team_id', teamId)
      .eq('active', true)
      .order('priority', { ascending: true })

    if (closersError || !closers || closers.length === 0) {
      console.log('Round-robin: No active closers found in queue for team', teamId)
      return { success: false, error: 'No active closers in queue' }
    }

    console.log(`Round-robin: Found ${closers.length} active closers in team ${teamId}:`, 
      closers.map((c: any) => ({ id: c.user_id, name: c.user?.full_name, priority: c.priority })))

    const orderedClosers = closers as CloserWithToken[]

    // Try each closer in priority order - prefer closers with available calendars.
    for (const closer of orderedClosers) {
      console.log(`Round-robin: Processing closer ${closer.user?.full_name} (${closer.user_id})`)
      
      // Get their Google token
      const { data: token, error: tokenError } = await supabase
        .from('user_google_tokens')
        .select('*')
        .eq('user_id', closer.user_id)
        .single()

      if (tokenError) {
        console.log(`Round-robin: Token lookup error for ${closer.user?.full_name}:`, tokenError.message)
      }

      if (!token) {
        // Closer has no calendar connected - skip entirely
        console.log(`Round-robin: Skipping ${closer.user?.full_name} - no Google Calendar connected`)
        continue
      }

      console.log(`Round-robin: Token found for ${closer.user?.full_name}, expires_at: ${token.expires_at}`)

      // Check if token needs refresh
      let accessToken = token.access_token
      const expiresAt = new Date(token.expires_at)
      const now = new Date()
      
      if (expiresAt < now) {
        console.log(`Round-robin: Token expired for ${closer.user?.full_name}, attempting refresh...`)
        try {
          const refreshed = await refreshAccessToken(token.refresh_token)
          accessToken = refreshed.access_token
          
          // Update token in database
          await supabase
            .from('user_google_tokens')
            .update({
              access_token: refreshed.access_token,
              expires_at: refreshed.expires_at.toISOString(),
            })
            .eq('id', token.id)
          console.log(`Round-robin: Token refreshed successfully for ${closer.user?.full_name}`)
        } catch (refreshError: any) {
          console.error(`Round-robin: Failed to refresh token for ${closer.user?.full_name}:`, refreshError?.message || refreshError)
          // If refresh fails but token was recently valid, try using it anyway
          // (Google tokens sometimes work slightly past expiry)
          if (now.getTime() - expiresAt.getTime() < 5 * 60 * 1000) {
            console.log(`Round-robin: Token recently expired, attempting to use anyway`)
          } else {
            continue // Try next closer
          }
        }
      } else {
        console.log(`Round-robin: Token still valid for ${closer.user?.full_name}`)
      }

      // Check calendar availability
      const endTime = new Date(scheduledFor.getTime() + durationMinutes * 60 * 1000)
      
      // Match canvass availability API behavior:
      // use separate before/after queue buffers and fall back to legacy buffer_minutes.
      const bufferBefore = closer.buffer_before ?? 0
      const bufferAfter = closer.buffer_after ?? closer.buffer_minutes ?? 15
      
      try {
        console.log(
          `Round-robin: Checking availability for ${closer.user?.full_name} at ${scheduledFor.toISOString()} with buffers before=${bufferBefore}min after=${bufferAfter}min`
        )

        const bufferedStart = new Date(scheduledFor.getTime() - bufferBefore * 60 * 1000)
        const bufferedEnd = new Date(endTime.getTime() + bufferAfter * 60 * 1000)
        const busySlots = await getFreeBusy(accessToken, bufferedStart, bufferedEnd)
        const available = busySlots.length === 0

        console.log(`Round-robin: ${closer.user?.full_name} availability: ${available ? 'AVAILABLE' : 'BUSY'}`)

        if (available) {
          // Build rich description for calendar event
          const customerName = customerDetails?.homeownerName || 'Customer'
          const descriptionLines = [
            `Customer: ${customerName}`,
            customerDetails?.phone ? `Phone: ${customerDetails.phone}` : '',
            address ? `Address: ${address}` : '',
            customerDetails?.setterName ? `Set by: ${customerDetails.setterName}` : '',
            customerDetails?.notes ? `\nNotes:\n${customerDetails.notes}` : '',
          ].filter(Boolean).join('\n')

          // Format datetime for Google Calendar API
          // Google expects local time format (YYYY-MM-DDTHH:MM:SS) with separate timezone field
          // Convert UTC Date to local time string in the target timezone
          const formatForCalendar = (date: Date, tz: string): string => {
            const parts = new Intl.DateTimeFormat('en-CA', {
              timeZone: tz,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }).formatToParts(date)
            
            const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
            return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
          }
          
          const startLocalTime = formatForCalendar(scheduledFor, teamTimezone)
          const endLocalTime = formatForCalendar(endTime, teamTimezone)

          // Create calendar event for closer (NO attendees to avoid duplicate invites)
          let googleEventId: string | undefined
          try {
            console.log(`Round-robin: Creating calendar event for ${closer.user?.full_name}:`, {
              summary: `Inspection: ${customerName}`,
              start: { dateTime: startLocalTime, timeZone: teamTimezone },
              end: { dateTime: endLocalTime, timeZone: teamTimezone },
            })
            const event = await createCalendarEvent(accessToken, {
              summary: `Inspection: ${customerName}`,
              description: descriptionLines,
              location: address,
              start: {
                dateTime: startLocalTime,
                timeZone: teamTimezone,
              },
              end: {
                dateTime: endLocalTime,
                timeZone: teamTimezone,
              },
            })
            googleEventId = event.id
            console.log(`Round-robin: Calendar event created successfully, ID: ${googleEventId}`)
          } catch (calendarError: any) {
            console.error('Failed to create calendar event:', calendarError?.message || calendarError)
            // Continue anyway - appointment can still be created
          }

          // Create calendar event for setter ONLY if they are different from the closer
          // Skip if closer is self-setting (they already have the event on their calendar)
          const isSelfSet = canvasserUserId === closer.user_id
          
          if (canvasserUserId && !isSelfSet) {
            try {
              const { data: setterToken } = await supabase
                .from('user_google_tokens')
                .select('*')
                .eq('user_id', canvasserUserId)
                .single()

              if (setterToken) {
                let setterAccessToken = setterToken.access_token
                // Refresh token if expired
                if (new Date(setterToken.expires_at) < new Date()) {
                  const refreshed = await refreshAccessToken(setterToken.refresh_token)
                  setterAccessToken = refreshed.access_token
                  await supabase
                    .from('user_google_tokens')
                    .update({
                      access_token: refreshed.access_token,
                      expires_at: refreshed.expires_at.toISOString(),
                    })
                    .eq('id', setterToken.id)
                }

                // Create event on setter's calendar (for their visibility)
                const setterDescription = [
                  'Appointment you scheduled',
                  `Closer: ${closer.user?.full_name || 'Assigned closer'}`,
                  `Customer: ${customerName}`,
                  customerDetails?.phone ? `Phone: ${customerDetails.phone}` : '',
                  address ? `Address: ${address}` : '',
                ].filter(Boolean).join('\n')

                await createCalendarEvent(setterAccessToken, {
                  summary: `[Set] ${customerName} → ${closer.user?.full_name || 'Closer'}`,
                  description: setterDescription,
                  location: address,
                  start: {
                    dateTime: startLocalTime,
                    timeZone: teamTimezone,
                  },
                  end: {
                    dateTime: endLocalTime,
                    timeZone: teamTimezone,
                  },
                })
              }
            } catch (setterCalendarError) {
              console.error('Failed to create setter calendar event:', setterCalendarError)
              // Non-critical, continue
            }
          }

          const result = await createAppointment(
            supabase,
            closer,
            scheduledFor,
            durationMinutes,
            leadId,
            opportunityId,
            address,
            canvasserUserId,
            orgId,
            googleEventId
          )
          return result
        }
      } catch (availabilityError: any) {
        console.error(`Round-robin: Failed to check availability for ${closer.user?.full_name}:`, availabilityError?.message || availabilityError)
        continue // Try next closer
      }
    }

    console.log(`Round-robin: Checked ${orderedClosers.length} closers, none available via calendar checks`)

    // Fallback: assign next active closer in queue even without calendar token availability.
    // This keeps inspection scheduling operational and avoids unassigned inspections.
    const fallbackCloser = orderedClosers[0]
    if (fallbackCloser) {
      console.log(
        `Round-robin: Fallback assignment to ${fallbackCloser.user?.full_name || fallbackCloser.user_id} (no calendar availability confirmation)`
      )
      const fallbackResult = await createAppointment(
        supabase,
        fallbackCloser,
        scheduledFor,
        durationMinutes,
        leadId,
        opportunityId,
        address,
        canvasserUserId,
        orgId
      )
      if (fallbackResult.success) {
        return fallbackResult
      }
    }

    return { success: false, error: 'No active closers available for assignment' }
  } catch (error) {
    console.error('Round-robin assignment error:', error)
    return { success: false, error: 'Assignment failed' }
  }
}

async function createAppointment(
  supabase: any,
  closer: CloserWithToken,
  scheduledFor: Date,
  durationMinutes: number,
  leadId?: string,
  opportunityId?: string,
  address?: string,
  canvasserUserId?: string,
  orgId?: string,
  googleEventId?: string
): Promise<AssignmentResult> {
  // Create appointment record
  const { data: appointment, error: appointmentError } = await supabase
    .from('scheduled_appointments')
    .insert({
      org_id: orgId || closer.org_id,
      lead_id: leadId,
      opportunity_id: opportunityId,
      closer_user_id: closer.user_id,
      canvasser_user_id: canvasserUserId,
      google_event_id: googleEventId,
      scheduled_for: scheduledFor.toISOString(),
      duration_minutes: durationMinutes,
      status: 'scheduled',
      address_text: address,
    })
    .select()
    .single()

  if (appointmentError) {
    console.error('Failed to create appointment:', appointmentError)
    return { success: false, error: 'Failed to create appointment' }
  }

  // Update last_assigned_at for the closer
  await supabase
    .from('team_closer_queue')
    .update({ last_assigned_at: new Date().toISOString() })
    .eq('id', closer.id)

  // Create pending status prompt for feedback after appointment ends
  const appointmentEndTime = new Date(scheduledFor.getTime() + durationMinutes * 60 * 1000)
  try {
    await supabase
      .from('pending_status_prompts')
      .insert({
        org_id: orgId || closer.org_id,
        appointment_id: appointment.id,
        closer_user_id: closer.user_id,
        prompt_at: appointmentEndTime.toISOString(),
      })
  } catch (promptError) {
    console.error('Failed to create pending prompt:', promptError)
    // Non-critical, continue
  }

  return {
    success: true,
    closerId: closer.user_id,
    closerName: closer.user?.full_name || 'Unknown',
    appointmentId: appointment.id,
    googleEventId,
  }
}

/**
 * Get the default team for round-robin assignment
 * Returns the first team in the org, or null if none exist
 */
export async function getDefaultTeam(
  supabase: any,
  orgId: string
): Promise<string | null> {
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('org_id', orgId)
    .limit(1)
    .single()

  return team?.id || null
}
