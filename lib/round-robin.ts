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

function hasBufferedConflict(
  slotStart: Date,
  slotEnd: Date,
  existingStart: Date,
  existingEnd: Date,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): boolean {
  const blockedStart = new Date(existingStart.getTime() - bufferAfterMinutes * 60 * 1000)
  const blockedEnd = new Date(existingEnd.getTime() + bufferBeforeMinutes * 60 * 1000)
  return slotStart < blockedEnd && slotEnd > blockedStart
}

async function hasDbConflictForCloser(
  supabase: any,
  closerUserId: string,
  scheduledFor: Date,
  durationMinutes: number,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): Promise<boolean> {
  const slotStart = scheduledFor
  const slotEnd = new Date(scheduledFor.getTime() + durationMinutes * 60 * 1000)
  const queryStart = new Date(slotStart.getTime() - 12 * 60 * 60 * 1000)
  const queryEnd = new Date(slotEnd.getTime() + 12 * 60 * 60 * 1000)

  const { data: existingAppointments, error } = await supabase
    .from('scheduled_appointments')
    .select('id, scheduled_for, duration_minutes')
    .eq('closer_user_id', closerUserId)
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_for', queryStart.toISOString())
    .lte('scheduled_for', queryEnd.toISOString())

  if (error) {
    console.error('Round-robin: Failed DB conflict query:', error)
    // Fail closed to prevent overbooking when conflict check cannot run reliably.
    return true
  }

  return (existingAppointments || []).some((appt: ScheduledAppointment) => {
    const existingStart = new Date(appt.scheduled_for)
    const existingEnd = new Date(existingStart.getTime() + appt.duration_minutes * 60 * 1000)
    return hasBufferedConflict(
      slotStart,
      slotEnd,
      existingStart,
      existingEnd,
      bufferBeforeMinutes,
      bufferAfterMinutes
    )
  })
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
    /** Lead setter (canvasser) — shown on the closer's calendar invite */
    setterName?: string | null
    /** Inspection rep for the prior visit — show on close invites so the assigned closer sees context */
    inspectorName?: string | null
    /** Calendar title + wording: inspection (default) vs close follow-up */
    eventLabel?: 'inspection' | 'close'
  },
  /** Fallback when closer queue has no buffer (Admin → default gap between appointments). */
  defaultSchedulingGapMinutes?: number,
  /** Stored on scheduled_appointments.buffer_after_minutes (Admin → Scheduling per appointment type). */
  scheduledAppointmentBufferMinutes?: number
): Promise<AssignmentResult> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const orgDefaultGap = defaultSchedulingGapMinutes ?? 15

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
          const hasDbConflict = await hasDbConflictForCloser(
            supabase,
            closer.user_id,
            scheduledFor,
            durationMinutes,
            bufferBefore,
            bufferAfter
          )

          if (hasDbConflict) {
            console.log(`Round-robin: ${closer.user?.full_name} has DB conflict at requested time`)
            continue
          }

          // Build rich description for calendar event
          const customerName = customerDetails?.homeownerName || 'Customer'
          let setterInviteEmail: string | null = null
          if (canvasserUserId && canvasserUserId !== closer.user_id) {
            const { data: setterUser } = await supabase
              .from('users')
              .select('email')
              .eq('id', canvasserUserId)
              .maybeSingle()
            if (setterUser?.email && setterUser.email.includes('@')) {
              setterInviteEmail = setterUser.email
            }
          }

          const eventKind = customerDetails?.eventLabel === 'close' ? 'close' : 'inspection'
          const titlePrefix = eventKind === 'close' ? 'Close' : 'Inspection'
          const descriptionLines = [
            `Customer: ${customerName}`,
            customerDetails?.phone ? `Phone: ${customerDetails.phone}` : '',
            address ? `Address: ${address}` : '',
            customerDetails?.setterName ? `Setter: ${customerDetails.setterName}` : '',
            customerDetails?.inspectorName ? `Inspector: ${customerDetails.inspectorName}` : '',
            customerDetails?.notes ? `Notes:\n${customerDetails.notes}` : '',
          ]
            .filter(Boolean)
            .join('\n')

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

          // Create one closer-owned event and include setter as attendee when available.
          let googleEventId: string | undefined
          try {
            console.log(`Round-robin: Creating calendar event for ${closer.user?.full_name}:`, {
              summary: `${titlePrefix}: ${customerName}`,
              start: { dateTime: startLocalTime, timeZone: teamTimezone },
              end: { dateTime: endLocalTime, timeZone: teamTimezone },
            })
            const event = await createCalendarEvent(
              accessToken,
              {
                summary: `${titlePrefix}: ${customerName}`,
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
                attendees: setterInviteEmail ? [{ email: setterInviteEmail }] : undefined,
              },
              'primary',
              setterInviteEmail ? 'all' : 'none'
            )
            googleEventId = event.id
            console.log(`Round-robin: Calendar event created successfully, ID: ${googleEventId}`)
          } catch (calendarError: any) {
            console.error('Failed to create calendar event:', calendarError?.message || calendarError)
            // Continue anyway - appointment can still be created
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
            googleEventId,
            orgDefaultGap,
            scheduledAppointmentBufferMinutes
          )
          if (result.success) {
            return result
          }

          console.log(
            `Round-robin: Failed to create appointment for ${closer.user?.full_name}, trying next closer: ${result.error}`
          )
          continue
        }
      } catch (availabilityError: any) {
        console.error(`Round-robin: Failed to check availability for ${closer.user?.full_name}:`, availabilityError?.message || availabilityError)
        continue // Try next closer
      }
    }

    console.log(`Round-robin: Checked ${orderedClosers.length} closers, none available via calendar checks`)
    return { success: false, error: 'No available closers at that time' }
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
  googleEventId?: string,
  defaultGapMinutes?: number,
  scheduledRowBufferAfter?: number
): Promise<AssignmentResult> {
  const slotStart = scheduledFor
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000)
  const bufferBefore = closer.buffer_before ?? 0
  const orgGap = defaultGapMinutes ?? 15
  const bufferAfter = closer.buffer_after ?? closer.buffer_minutes ?? orgGap
  const rowBufferAfter = scheduledRowBufferAfter !== undefined ? scheduledRowBufferAfter : orgGap
  const hasConflict = await hasDbConflictForCloser(
    supabase,
    closer.user_id,
    slotStart,
    durationMinutes,
    bufferBefore,
    bufferAfter
  )

  if (hasConflict) {
    console.log('Round-robin: Aborting createAppointment due to detected DB conflict', {
      closerUserId: closer.user_id,
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      bufferBefore,
      bufferAfter,
    })
    return { success: false, error: 'Appointment conflicts with existing schedule' }
  }

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
      buffer_after_minutes: rowBufferAfter,
      status: 'scheduled',
      address_text: address,
    })
    .select()
    .single()

  if (appointmentError) {
    console.error('Failed to create appointment:', appointmentError)

    // Idempotency fallback: if a duplicate request already created this slot,
    // reuse it instead of failing the scheduling flow.
    if (leadId) {
      const { data: existingAppointment } = await supabase
        .from('scheduled_appointments')
        .select('id, google_event_id')
        .eq('lead_id', leadId)
        .eq('closer_user_id', closer.user_id)
        .eq('scheduled_for', scheduledFor.toISOString())
        .in('status', ['scheduled', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingAppointment?.id) {
        return {
          success: true,
          closerId: closer.user_id,
          closerName: closer.user?.full_name || 'Unknown',
          appointmentId: existingAppointment.id,
          googleEventId: existingAppointment.google_event_id || googleEventId,
        }
      }
    }

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
