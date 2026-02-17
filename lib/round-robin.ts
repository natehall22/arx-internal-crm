import { createClient } from '@supabase/supabase-js'
import { refreshAccessToken, isSlotAvailable, createCalendarEvent } from './google-calendar'
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
  timezone?: string
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

    // Track closers without calendars as fallback
    const closersWithoutCalendar: CloserWithToken[] = []

    // Try each closer in priority order - first pass: only closers WITH calendars
    for (const closer of closers as CloserWithToken[]) {
      // Get their Google token
      const { data: token } = await supabase
        .from('user_google_tokens')
        .select('*')
        .eq('user_id', closer.user_id)
        .single()

      if (!token) {
        // Closer has no calendar connected - save for fallback
        console.log(`Round-robin: Closer ${closer.user?.full_name} has no calendar, saving as fallback`)
        closersWithoutCalendar.push(closer)
        continue // Try next closer with calendar first
      }

      // Check if token needs refresh
      let accessToken = token.access_token
      if (new Date(token.expires_at) < new Date()) {
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
        } catch (refreshError) {
          console.error('Failed to refresh token for closer:', closer.user_id)
          continue // Try next closer
        }
      }

      // Check calendar availability
      const endTime = new Date(scheduledFor.getTime() + durationMinutes * 60 * 1000)
      
      try {
        console.log(`Round-robin: Checking availability for ${closer.user?.full_name} at ${scheduledFor.toISOString()}`)
        const available = await isSlotAvailable(
          accessToken,
          scheduledFor,
          endTime,
          closer.buffer_minutes
        )

        console.log(`Round-robin: ${closer.user?.full_name} availability: ${available ? 'AVAILABLE' : 'BUSY'}`)

        if (available) {
          // Get setter's email if they exist
          let setterEmail: string | undefined
          if (canvasserUserId) {
            const { data: setter } = await supabase
              .from('users')
              .select('email')
              .eq('id', canvasserUserId)
              .single()
            setterEmail = setter?.email || undefined
          }

          // Create calendar event for closer (with setter as attendee)
          let googleEventId: string | undefined
          try {
            const attendees = setterEmail ? [{ email: setterEmail }] : undefined
            const event = await createCalendarEvent(accessToken, {
              summary: `Inspection - ${address || 'TBD'}`,
              description: `Scheduled inspection${leadId ? ` for lead ${leadId}` : ''}`,
              location: address,
              start: {
                dateTime: scheduledFor.toISOString(),
                timeZone: teamTimezone,
              },
              end: {
                dateTime: endTime.toISOString(),
                timeZone: teamTimezone,
              },
              attendees,
            })
            googleEventId = event.id
          } catch (calendarError) {
            console.error('Failed to create calendar event:', calendarError)
            // Continue anyway - appointment can still be created
          }

          // Also create calendar event for setter if they have Google Calendar connected
          if (canvasserUserId) {
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

                // Create event on setter's calendar (with closer as attendee)
                await createCalendarEvent(setterAccessToken, {
                  summary: `Inspection - ${address || 'TBD'}`,
                  description: `Scheduled inspection${leadId ? ` for lead ${leadId}` : ''}\nCloser: ${closer.user?.full_name || 'Assigned closer'}`,
                  location: address,
                  start: {
                    dateTime: scheduledFor.toISOString(),
                    timeZone: teamTimezone,
                  },
                  end: {
                    dateTime: endTime.toISOString(),
                    timeZone: teamTimezone,
                  },
                  attendees: closer.user?.email ? [{ email: closer.user.email }] : undefined,
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
      } catch (availabilityError) {
        console.error('Failed to check availability for closer:', closer.user_id, availabilityError)
        continue // Try next closer
      }
    }

    // Fallback: If no closers with calendars are available, use first closer without calendar
    if (closersWithoutCalendar.length > 0) {
      console.log(`Round-robin: No closers with calendars available, using fallback closer: ${closersWithoutCalendar[0].user?.full_name}`)
      const fallbackCloser = closersWithoutCalendar[0]
      
      // Create event on setter's calendar if they have one
      if (canvasserUserId) {
        try {
          const { data: setterToken } = await supabase
            .from('user_google_tokens')
            .select('*')
            .eq('user_id', canvasserUserId)
            .single()

          if (setterToken) {
            let setterAccessToken = setterToken.access_token
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

            const endTime = new Date(scheduledFor.getTime() + durationMinutes * 60 * 1000)
            await createCalendarEvent(setterAccessToken, {
              summary: `Inspection - ${address || 'TBD'}`,
              description: `Scheduled inspection${leadId ? ` for lead ${leadId}` : ''}\nCloser: ${fallbackCloser.user?.full_name || 'Assigned closer'} (no calendar connected)`,
              location: address,
              start: {
                dateTime: scheduledFor.toISOString(),
                timeZone: teamTimezone,
              },
              end: {
                dateTime: endTime.toISOString(),
                timeZone: teamTimezone,
              },
              attendees: fallbackCloser.user?.email ? [{ email: fallbackCloser.user.email }] : undefined,
            })
          }
        } catch (setterCalendarError) {
          console.error('Failed to create setter calendar event for fallback:', setterCalendarError)
        }
      }

      const result = await createAppointment(
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
      return result
    }

    console.log('Round-robin: No closers available at requested time')
    return { success: false, error: 'No closers available at this time' }
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
