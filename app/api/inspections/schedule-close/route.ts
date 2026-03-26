import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSetterEmail } from '@/lib/setter-email'
import { assignNextAvailableCloser, getDefaultTeam } from '@/lib/round-robin'
import {
  fetchOrgAppointmentTypesFromTable,
  getCloseSlotBufferAfterFromTable,
  getCloseSlotDurationFromTable,
} from '@/lib/org-appointment-types'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, full_name, google_calendar_id, google_refresh_token')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }

    const body = await request.json()
    const { 
      original_appointment_id, 
      scheduled_for, 
      notes,
      use_round_robin,
      team_id: teamIdOverride,
    } = body as {
      original_appointment_id: string
      scheduled_for: string
      notes?: string
      /** Use team round-robin (same as canvass / scheduling) to assign the closer — recommended from inspection feedback "Moving to Close". */
      use_round_robin?: boolean
      team_id?: string
    }

    if (!original_appointment_id || !scheduled_for) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get original appointment details
    const { data: originalAppointment, error: appointmentError } = await supabase
      .from('scheduled_appointments')
      .select('*, leads(*)')
      .eq('id', original_appointment_id)
      .single()

    if (appointmentError || !originalAppointment) {
      return NextResponse.json({ error: 'Original appointment not found' }, { status: 404 })
    }

    const admin = createServiceClient()
    const { data: orgRow } = await admin
      .from('orgs')
      .select('inspection_feedback_buffer_minutes, default_scheduling_gap_minutes')
      .eq('id', profile.org_id)
      .single()

    const defaultGap = orgRow?.default_scheduling_gap_minutes ?? 15
    const tableTypes = await fetchOrgAppointmentTypesFromTable(admin, profile.org_id)
    const bufferAfter = getCloseSlotBufferAfterFromTable(tableTypes, 'close', defaultGap)
    const closeDurationMinutes = getCloseSlotDurationFromTable(
      tableTypes,
      'close',
      originalAppointment.duration_minutes ?? 60
    )

    // Parse the scheduled_for - it's a local time string like "YYYY-MM-DDTHH:MM"
    let scheduledForISO: string
    let localDateTimeStr: string
    
    if (scheduled_for.includes('Z') || scheduled_for.includes('+')) {
      scheduledForISO = scheduled_for
      localDateTimeStr = scheduled_for.slice(0, 16)
    } else {
      localDateTimeStr = scheduled_for.length === 16 ? scheduled_for : scheduled_for.slice(0, 16)
      const [datePart, timePart] = localDateTimeStr.split('T')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      const localDate = new Date(year, month - 1, day, hour, minute)
      scheduledForISO = localDate.toISOString()
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    let closeAppointment: any = null

    if (use_round_robin) {
      if (!serviceKey) {
        return NextResponse.json({ error: 'Round-robin scheduling is not configured' }, { status: 500 })
      }

      const { data: inspectionCloser } = await admin
        .from('users')
        .select('team_id')
        .eq('id', originalAppointment.closer_user_id)
        .maybeSingle()

      const { data: inspectorProfile } = await admin
        .from('users')
        .select('team_id')
        .eq('id', user.id)
        .maybeSingle()

      const teamId =
        teamIdOverride ||
        inspectionCloser?.team_id ||
        inspectorProfile?.team_id ||
        (await getDefaultTeam(admin, profile.org_id))

      if (!teamId) {
        return NextResponse.json(
          {
            error:
              'No team found for round-robin. Assign the inspection closer to a team, or pass team_id.',
          },
          { status: 400 }
        )
      }

      const scheduledForDate = new Date(scheduledForISO)
      const assignment = await assignNextAvailableCloser(
        supabaseUrl,
        serviceKey,
        teamId,
        scheduledForDate,
        closeDurationMinutes,
        originalAppointment.lead_id,
        originalAppointment.opportunity_id || undefined,
        originalAppointment.address_text || originalAppointment.leads?.address_text || undefined,
        originalAppointment.canvasser_user_id,
        profile.org_id,
        undefined,
        {
          homeownerName: originalAppointment.leads?.homeowner_name,
          phone: originalAppointment.leads?.phone,
          notes: notes || undefined,
          setterName: undefined,
        },
        orgRow?.default_scheduling_gap_minutes ?? 15,
        bufferAfter
      )

      if (!assignment.success || !assignment.appointmentId) {
        return NextResponse.json(
          { error: assignment.error || 'No available closer for this time slot' },
          { status: 409 }
        )
      }

      const closeNotes =
        notes ||
        `Close appointment - follow up from inspection on ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`

      const { error: patchErr } = await admin
        .from('scheduled_appointments')
        .update({
          appointment_type: 'close',
          notes: closeNotes,
          buffer_after_minutes: bufferAfter,
        })
        .eq('id', assignment.appointmentId)

      if (patchErr) {
        console.error('Failed to tag round-robin appointment as close:', patchErr)
      }

      const { data: rrAppointment } = await admin
        .from('scheduled_appointments')
        .select('*, leads(homeowner_name, address_text, phone)')
        .eq('id', assignment.appointmentId)
        .single()

      closeAppointment = rrAppointment

      const assignedCloserName = assignment.closerName || 'Closer'

      if (originalAppointment.canvasser_user_id && originalAppointment.canvasser_user_id !== user.id) {
        const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
        const customerAddress =
          originalAppointment.leads?.address_text || originalAppointment.address_text || ''

        await supabase.from('notifications').insert({
          org_id: profile.org_id,
          recipient_user_id: originalAppointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Close Appointment Scheduled - ${customerName}`,
          body: `${profile.full_name || 'Rep'} scheduled a close appointment. Assigned closer: ${assignedCloserName}.\n\nCustomer: ${customerName}\nAddress: ${customerAddress}\nScheduled: ${new Date(scheduledForISO).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n\n${notes ? `Notes: ${notes}` : ''}`,
          data: {
            appointment_id: assignment.appointmentId,
            original_appointment_id,
            opportunity_id: originalAppointment.opportunity_id,
            lead_id: originalAppointment.lead_id,
            closer_name: assignedCloserName,
            round_robin: true,
          },
        })

        try {
          const { data: setterUser } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', originalAppointment.canvasser_user_id)
            .single()
          if (setterUser?.email) {
            const whenLabel = new Date(scheduledForISO).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'full',
              timeStyle: 'short',
            })
            await sendSetterEmail({
              to: setterUser.email,
              setterName: setterUser.full_name,
              subject: `Close appointment scheduled: ${customerName}`,
              introHtml: `<p style="color: #374151;">${profile.full_name || 'Your rep'} scheduled a close appointment. <strong>Assigned closer: ${assignedCloserName}</strong>.</p>`,
              rows: [
                { label: 'Customer', value: customerName },
                { label: 'Address', value: customerAddress || 'N/A' },
                { label: 'Scheduled', value: `${whenLabel} ET` },
                ...(notes ? [{ label: 'Notes', value: notes }] : []),
              ],
            })
          }
        } catch (e) {
          console.error('Close appointment setter email failed:', e)
        }
      }

      await supabase.from('activities').insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'appointment_scheduled',
        body: `Close appointment scheduled (round-robin → ${assignedCloserName}) for ${new Date(scheduledForISO).toLocaleString()}${notes ? ` - ${notes}` : ''}`,
      })

      if (originalAppointment.opportunity_id && assignment.appointmentId) {
        const { error: closeRowError } = await supabase.from('close_appointments').insert({
          org_id: profile.org_id,
          opportunity_id: originalAppointment.opportunity_id,
          scheduled_appointment_id: assignment.appointmentId,
          scheduled_for: scheduledForISO,
        })
        if (closeRowError) {
          console.error('close_appointments insert (non-fatal):', closeRowError)
        }
      }

      return NextResponse.json({
        success: true,
        appointment: closeAppointment,
        assigned_closer: { id: assignment.closerId, name: assignment.closerName },
        round_robin: true,
      })
    }

    // Manual: inspector / current user is the closer (legacy)
    const { data: insertedClose, error: createError } = await supabase
      .from('scheduled_appointments')
      .insert({
        org_id: profile.org_id,
        lead_id: originalAppointment.lead_id,
        opportunity_id: originalAppointment.opportunity_id,
        closer_user_id: user.id,
        canvasser_user_id: originalAppointment.canvasser_user_id,
        scheduled_for: scheduledForISO,
        duration_minutes: closeDurationMinutes,
        buffer_after_minutes: bufferAfter,
        status: 'scheduled',
        address_text: originalAppointment.address_text,
        notes: notes || `Close appointment - follow up from inspection on ${new Date(originalAppointment.scheduled_for).toLocaleDateString()}`,
        appointment_type: 'close',
      })
      .select()
      .single()

    if (createError) {
      console.error('Create close appointment error:', createError)
      return NextResponse.json({ error: 'Failed to create close appointment' }, { status: 500 })
    }

    closeAppointment = insertedClose

    // Create Google Calendar event if user has calendar connected
    if (profile.google_refresh_token && profile.google_calendar_id) {
      try {
        const { createCalendarEvent } = await import('@/lib/google-calendar')
        
        const timezone = 'America/New_York'
        const startDateTime = `${localDateTimeStr}:00`
        const durationMinutes = closeDurationMinutes
        
        const [datePart, timePart] = localDateTimeStr.split('T')
        const timeOnly = timePart?.split(':') || ['00', '00']
        let endHour = parseInt(timeOnly[0], 10)
        let endMin = parseInt(timeOnly[1], 10) + durationMinutes
        
        while (endMin >= 60) {
          endMin -= 60
          endHour += 1
        }
        
        const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`

        const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
        const address = originalAppointment.address_text || originalAppointment.leads?.address_text || ''

        const event = await createCalendarEvent(profile.google_refresh_token, {
          summary: `Close Appointment - ${customerName}`,
          description: `Close appointment with ${customerName}\n\nAddress: ${address}\n\nNotes: ${notes || 'Follow up from inspection'}`,
          location: address,
          start: {
            dateTime: startDateTime,
            timeZone: timezone,
          },
          end: {
            dateTime: endDateTime,
            timeZone: timezone,
          },
        }, profile.google_calendar_id)

        if (event?.id) {
          await supabase
            .from('scheduled_appointments')
            .update({ google_event_id: event.id })
            .eq('id', closeAppointment.id)
        }
      } catch (calendarError) {
        console.error('Calendar event creation error:', calendarError)
      }
    }

    // Notify the setter about the close appointment
    if (originalAppointment.canvasser_user_id && originalAppointment.canvasser_user_id !== user.id) {
      const customerName = originalAppointment.leads?.homeowner_name || 'Customer'
      const customerAddress = originalAppointment.leads?.address_text || originalAppointment.address_text || ''
      
      await supabase
        .from('notifications')
        .insert({
          org_id: profile.org_id,
          recipient_user_id: originalAppointment.canvasser_user_id,
          actor_user_id: user.id,
          type: 'inspection_outcome',
          title: `Close Appointment Scheduled - ${customerName}`,
          body: `Great news! ${profile.full_name || 'Closer'} has scheduled a close appointment.\n\nCustomer: ${customerName}\nAddress: ${customerAddress}\nScheduled: ${new Date(scheduledForISO).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}\n\n${notes ? `Notes: ${notes}` : ''}`,
          data: {
            appointment_id: closeAppointment.id,
            original_appointment_id,
            opportunity_id: originalAppointment.opportunity_id,
            lead_id: originalAppointment.lead_id,
            closer_name: profile.full_name,
          },
        })

      try {
        const { data: setterUser } = await supabase
          .from('users')
          .select('email, full_name')
          .eq('id', originalAppointment.canvasser_user_id)
          .single()
        if (setterUser?.email) {
          const whenLabel = new Date(scheduledForISO).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'full',
            timeStyle: 'short',
          })
          await sendSetterEmail({
            to: setterUser.email,
            setterName: setterUser.full_name,
            subject: `Close appointment scheduled: ${customerName}`,
            introHtml: `<p style="color: #374151;">${profile.full_name || 'Your closer'} scheduled a close appointment for your lead.</p>`,
            rows: [
              { label: 'Customer', value: customerName },
              { label: 'Address', value: customerAddress || 'N/A' },
              { label: 'Scheduled', value: `${whenLabel} ET` },
              ...(notes ? [{ label: 'Notes', value: notes }] : []),
            ],
          })
        }
      } catch (e) {
        console.error('Close appointment setter email failed:', e)
      }
    }

    // Create activity record
    await supabase
      .from('activities')
      .insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        lead_id: originalAppointment.lead_id,
        user_id: user.id,
        type: 'appointment_scheduled',
        body: `Close appointment scheduled for ${new Date(scheduledForISO).toLocaleString()}${notes ? ` - ${notes}` : ''}`,
      })

    // Persist a close_appointments row for opportunity UI / close-feedback flow (non-fatal if table missing).
    if (originalAppointment.opportunity_id && closeAppointment?.id) {
      const { error: closeRowError } = await supabase.from('close_appointments').insert({
        org_id: profile.org_id,
        opportunity_id: originalAppointment.opportunity_id,
        scheduled_appointment_id: closeAppointment.id,
        scheduled_for: scheduledForISO,
      })
      if (closeRowError) {
        console.error('close_appointments insert (non-fatal):', closeRowError)
      }
    }

    return NextResponse.json({ 
      success: true, 
      appointment: closeAppointment,
    })

  } catch (error) {
    console.error('Schedule close error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
