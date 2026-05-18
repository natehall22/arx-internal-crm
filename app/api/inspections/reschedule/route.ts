import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'
import { createCalendarEvent, deleteCalendarEvent, refreshAccessToken, CalendarEvent } from '@/lib/google-calendar'
import { computeInspectionFeedbackPromptAt } from '@/lib/scheduling-prompt'
import { sendSetterEmail } from '@/lib/setter-email'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
  getInspectionBufferAfterFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'
import { formatDateTimeInTimezone } from '@/lib/timezone'
import { inspectionLocalWallClockToUtcIso } from '@/lib/inspection-local-wall-clock'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Helper to get valid access token
async function getValidAccessToken(adminClient: any, userId: string): Promise<string | null> {
  const { data: tokenData } = await adminClient
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!tokenData) return null

  const expiresAt = new Date(tokenData.expires_at)
  const now = new Date()

  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(tokenData.refresh_token)
      await adminClient
        .from('user_google_tokens')
        .update({
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at.toISOString(),
        })
        .eq('user_id', userId)
      return refreshed.access_token
    } catch {
      return null
    }
  }

  return tokenData.access_token
}

// Helper to get timezone for user
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
      
      if (team?.timezone) return team.timezone
    }
  } catch {}
  return 'America/New_York'
}

export async function POST(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authContext.authUser.id
    const profile = authContext.profile

    if (!profile.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const supabase = getAdminClient()

    const body = await request.json()
    const { 
      original_appointment_id,
      new_scheduled_for,
      notes,
    } = body

    if (!original_appointment_id || !new_scheduled_for) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get original appointment with lead info
    const { data: originalAppointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*, leads(homeowner_name, phone, address_text)')
      .eq('id', original_appointment_id)
      .single()

    if (appointmentError || !originalAppointment) {
      return NextResponse.json({ error: 'Original appointment not found' }, { status: 404 })
    }

    // Mark original appointment as cancelled/rescheduled
    await supabase
      .from('scheduled_appointments')
      .update({ 
        status: 'cancelled',
        notes: (originalAppointment.notes || '') + '\nRescheduled to new appointment.'
      })
      .eq('id', original_appointment_id)

    // Get the timezone for proper conversion
    const timezone = originalAppointment.closer_user_id 
      ? await getTimezoneForUser(supabase, originalAppointment.closer_user_id)
      : 'America/New_York'
    
    // new_scheduled_for can be either:
    // 1. Local time string: "YYYY-MM-DDTHH:MM" (preferred, from schedule page)
    // 2. ISO string: "YYYY-MM-DDTHH:MM:SS.sssZ" (legacy, from other sources)
    
    let scheduledForISO: string
    let localDateTimeStr: string
    
    if (new_scheduled_for.includes('Z') || new_scheduled_for.includes('+')) {
      // It's already an ISO/UTC string - use as-is for storage
      scheduledForISO = new_scheduled_for
      // For display/calendar, we'll need to convert - but this is the legacy path
      localDateTimeStr = new_scheduled_for.slice(0, 16) // Best effort
    } else {
      // Local wall-clock string "YYYY-MM-DDTHH:MM" in the assigned closer's team timezone.
      // Use the same conversion as canvass / iOS scheduling (see inspectionLocalWallClockToUtcIso).
      localDateTimeStr =
        new_scheduled_for.length === 16
          ? new_scheduled_for
          : new_scheduled_for.slice(0, 16)
      scheduledForISO = inspectionLocalWallClockToUtcIso(localDateTimeStr, timezone)
    }
    
    const newScheduledDate = new Date(scheduledForISO)

    const { data: orgRow } = await supabase
      .from('orgs')
      .select('inspection_feedback_buffer_minutes, default_scheduling_gap_minutes')
      .eq('id', profile.org_id)
      .single()

    const orgFeedbackBuffer = orgRow?.inspection_feedback_buffer_minutes ?? 0
    const defaultGap = orgRow?.default_scheduling_gap_minutes ?? 15
    const typeKey =
      (originalAppointment as { appointment_type?: string | null }).appointment_type || 'inspection'

    const tableAptRows = await fetchOrgAppointmentTypesFromTable(supabase, profile.org_id)
    const fallbackDur = originalAppointment.duration_minutes ?? 60
    let newSlotDuration = fallbackDur
    if (typeKey === 'inspection' || !typeKey) {
      newSlotDuration = getInspectionDurationFromTable(tableAptRows, fallbackDur)
    } else if (typeKey === 'close') {
      newSlotDuration = getCloseSlotDurationFromTable(tableAptRows, 'close', fallbackDur)
    } else if (typeKey === 'follow_up') {
      newSlotDuration = getCloseSlotDurationFromTable(tableAptRows, 'follow_up', fallbackDur)
    } else if (typeKey === 'insurance_follow_up') {
      newSlotDuration = getCloseSlotDurationFromTable(tableAptRows, 'insurance_follow_up', fallbackDur)
    }

    let bufferAfter = defaultGap
    if (typeKey === 'inspection' || !typeKey) {
      bufferAfter = getInspectionBufferAfterFromTable(tableAptRows, defaultGap)
    } else if (typeKey === 'close') {
      bufferAfter = getCloseSlotBufferAfterFromTable(tableAptRows, 'close', defaultGap)
    } else if (typeKey === 'follow_up') {
      bufferAfter = getCloseSlotBufferAfterFromTable(tableAptRows, 'follow_up', defaultGap)
    } else if (typeKey === 'insurance_follow_up') {
      bufferAfter = getCloseSlotBufferAfterFromTable(tableAptRows, 'insurance_follow_up', defaultGap)
    } else {
      bufferAfter = getInspectionBufferAfterFromTable(tableAptRows, defaultGap)
    }

    // Create new appointment with same setter (ensure closer is set so feedback prompts can be created)
    const { data: newAppointment, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: originalAppointment.closer_user_id || userId,
        canvasser_user_id: originalAppointment.canvasser_user_id,
        scheduled_for: scheduledForISO,
        duration_minutes: newSlotDuration,
        buffer_after_minutes: bufferAfter,
        status: 'scheduled',
        address_text: originalAppointment.address_text,
        notes: notes || `Rescheduled from ${formatDateTimeInTimezone(originalAppointment.scheduled_for)} ET`,
        appointment_type: typeKey,
      })
      .select()
      .single()

    if (createError) {
      console.error('Create appointment error:', createError)
      return NextResponse.json({ error: 'Failed to create new appointment' }, { status: 500 })
    }

    // Sync to closer's Google Calendar
    let calendarSynced = false
    let googleEventId: string | null = null
    
    if (originalAppointment.closer_user_id) {
      const accessToken = await getValidAccessToken(supabase, originalAppointment.closer_user_id)
      
      if (accessToken) {
        try {
          // Delete the old calendar event first
          if (originalAppointment.google_event_id) {
            try {
              await deleteCalendarEvent(accessToken, originalAppointment.google_event_id)
            } catch (deleteError) {
              console.error('Failed to delete old calendar event:', deleteError)
              // Continue anyway - the old event might already be deleted
            }
          }
          
          // Use the local time string for Google Calendar (with timezone)
          // localDateTimeStr is in format "YYYY-MM-DDTHH:MM"
          const startDateTime = `${localDateTimeStr}:00`
          
          // Calculate end time by parsing the local time and adding duration
          const [datePart, timePart] = localDateTimeStr.split('T')
          const timeOnly = timePart?.split(':') || ['00', '00']
          let endHour = parseInt(timeOnly[0], 10)
          let endMin = parseInt(timeOnly[1], 10) + newSlotDuration
          
          // Handle minute overflow
          while (endMin >= 60) {
            endMin -= 60
            endHour += 1
          }
          
          const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`
          
          // Get lead's canvass notes for the calendar event
          const { data: leadData } = await supabase
            .from('leads')
            .select('canvass_notes')
            .eq('id', originalAppointment.lead_id)
            .single()
          
          let setterInviteEmail: string | null = null
          const setterId = originalAppointment.canvasser_user_id
          const closerId = originalAppointment.closer_user_id
          if (setterId && closerId && setterId !== closerId) {
            const { data: setterRow } = await supabase
              .from('users')
              .select('email')
              .eq('id', setterId)
              .maybeSingle()
            if (setterRow?.email && String(setterRow.email).includes('@')) {
              setterInviteEmail = setterRow.email
            }
          }

          const event: CalendarEvent = {
            summary: `Inspection: ${originalAppointment.leads?.homeowner_name || 'Customer'} (Rescheduled)`,
            description: [
              `Customer: ${originalAppointment.leads?.homeowner_name || 'N/A'}`,
              originalAppointment.leads?.phone ? `Phone: ${originalAppointment.leads.phone}` : '',
              originalAppointment.leads?.address_text ? `Address: ${originalAppointment.leads.address_text}` : '',
              '',
              leadData?.canvass_notes ? `Canvass Notes:\n${leadData.canvass_notes}` : '',
              notes ? `Reschedule Notes:\n${notes}` : '',
            ].filter(line => line !== undefined && line !== '').join('\n').trim(),
            location: originalAppointment.leads?.address_text || originalAppointment.address_text || undefined,
            start: {
              dateTime: startDateTime,
              timeZone: timezone,
            },
            end: {
              dateTime: endDateTime,
              timeZone: timezone,
            },
            attendees: setterInviteEmail ? [{ email: setterInviteEmail }] : undefined,
          }
          
          const createdEvent = await createCalendarEvent(
            accessToken,
            event,
            'primary',
            setterInviteEmail ? 'all' : 'none'
          )
          googleEventId = createdEvent.id || null
          calendarSynced = true
          
          // Update appointment with Google event ID
          await supabase
            .from('scheduled_appointments')
            .update({ google_event_id: googleEventId })
            .eq('id', newAppointment.id)
        } catch (calendarError) {
          console.error('Calendar sync error:', calendarError)
        }
      }
    }

    // Create status update for original appointment
    await supabase
      .from('inspection_status_updates')
      .insert({
        org_id: profile.org_id,
        appointment_id: original_appointment_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        closer_user_id: userId,
        setter_user_id: originalAppointment.canvasser_user_id,
        outcome: 'rescheduled',
        notes: `Rescheduled to ${new Date(new_scheduled_for).toLocaleDateString()}`,
      })

    // Mark pending prompt as completed
    await supabase
      .from('pending_status_prompts')
      .update({ completed: true })
      .eq('appointment_id', original_appointment_id)

    // Queue inspection feedback at appointment start (aligns with round-robin + status route)
    const { data: orgForPrompt } = await supabase
      .from('orgs')
      .select('inspection_feedback_buffer_minutes')
      .eq('id', profile.org_id)
      .single()
    const durationMin = newAppointment.duration_minutes || 60
    const bufferAfterNew = newAppointment.buffer_after_minutes ?? 0
    const orgFb = orgForPrompt?.inspection_feedback_buffer_minutes ?? 0
    const closerForPrompt = newAppointment.closer_user_id || userId
    const promptAt = computeInspectionFeedbackPromptAt(
      newAppointment.scheduled_for,
      durationMin,
      bufferAfterNew,
      orgFb
    )
    await supabase.from('pending_status_prompts').upsert(
      {
        org_id: profile.org_id,
        appointment_id: newAppointment.id,
        closer_user_id: closerForPrompt,
        prompt_at: promptAt,
        completed: false,
        dismissed: false,
      },
      { onConflict: 'appointment_id' }
    )

    // Notify setter about reschedule
    const notificationData = {
      original_appointment_id,
      new_appointment_id: newAppointment.id,
      lead_id: originalAppointment.lead_id,
      opportunity_id: originalAppointment.opportunity_id,
    }
    
    const rescheduleMessage = `Appointment with ${originalAppointment.leads?.homeowner_name || 'customer'} has been rescheduled to ${formatDateTimeInTimezone(scheduledForISO)} ET`
    
    if (originalAppointment.canvasser_user_id) {
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          user_id: originalAppointment.canvasser_user_id,
          type: 'reschedule',
          title: 'Appointment Rescheduled',
          body: rescheduleMessage,
          data: notificationData,
        })

      if (originalAppointment.canvasser_user_id !== userId) {
        try {
          const { data: setterUser } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', originalAppointment.canvasser_user_id)
            .single()
          const { data: closerProfile } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .single()
          if (setterUser?.email) {
            await sendSetterEmail({
              to: setterUser.email,
              recipientUserId: originalAppointment.canvasser_user_id,
              setterName: setterUser.full_name,
              subject: `Inspection rescheduled: ${originalAppointment.leads?.homeowner_name || 'Customer'}`,
              introHtml: `<p style="color: #374151;">${closerProfile?.full_name || 'Your closer'} rescheduled an inspection to a new time.</p>`,
              rows: [
                {
                  label: 'New date & time',
                  value: newScheduledDate.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    dateStyle: 'full',
                    timeStyle: 'short',
                  }) + ' ET',
                },
                {
                  label: 'Address',
                  value:
                    originalAppointment.leads?.address_text ||
                    originalAppointment.address_text ||
                    'N/A',
                },
              ],
            })
          }
        } catch (e) {
          console.error('Reschedule setter email failed:', e)
        }
      }
      
      // Get setter's manager and notify them
      const { data: setter } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.canvasser_user_id)
        .single()
      
      if (setter?.team_id) {
        // Find team manager
        const { data: teamManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', setter.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', userId)
        
        for (const manager of teamManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            recipient_user_id: manager.id,
            actor_user_id: userId,
            type: 'reschedule',
            title: 'Team Appointment Rescheduled',
            body: rescheduleMessage,
            data: notificationData,
          })
        }
      }
    }
    
    // Notify closer's manager if different from setter's manager
    if (originalAppointment.closer_user_id) {
      const { data: closer } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.closer_user_id)
        .single()
      
      if (closer?.team_id) {
        const { data: closerManagers } = await supabase
          .from('users')
          .select('id')
          .eq('team_id', closer.team_id)
          .in('role', ['sales_manager', 'regional_manager', 'admin'])
          .neq('id', userId)
        
        for (const manager of closerManagers || []) {
          await supabase.from('notifications').insert({
            org_id: profile.org_id,
            recipient_user_id: manager.id,
            actor_user_id: userId,
            type: 'reschedule',
            title: 'Team Appointment Rescheduled',
            body: rescheduleMessage,
            data: notificationData,
          })
        }
      }
    }

    // Create activity
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: userId,
        type: 'status_change',
        body: `Appointment rescheduled to ${formatDateTimeInTimezone(scheduledForISO)} ET`,
      })

    return NextResponse.json({ 
      success: true, 
      new_appointment: newAppointment,
    })

  } catch (error) {
    console.error('Reschedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
