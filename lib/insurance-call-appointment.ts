import type { SupabaseClient } from '@supabase/supabase-js'

export type BookInsuranceCallAppointmentParams = {
  orgId: string
  leadId: string
  opportunityId: string | null
  insuranceCallAtIso: string
  bookedByName: string | null | undefined
  sanitizedHandoffContext: Record<string, string> | null
  appointment: { canvasser_user_id?: string | null; address_text?: string | null } | null
  lead: { owner_user_id?: string | null; address_text?: string | null } | null
}

/** Book or reschedule the inside-sales insurance_call row before opportunity writes (fail fast). */
export async function bookInsuranceCallAppointment(
  supabase: SupabaseClient,
  params: BookInsuranceCallAppointmentParams
): Promise<{ appointmentId: string | null; error: string | null }> {
  const insuranceCallBaseQuery = () =>
    supabase
      .from('scheduled_appointments')
      .select('id')
      .eq('org_id', params.orgId)
      .eq('lead_id', params.leadId)
      .eq('appointment_type', 'insurance_call')
      .eq('status', 'scheduled')

  let existingInsuranceCall: { id: string } | null = null
  if (params.opportunityId) {
    const { data: byOpportunity } = await insuranceCallBaseQuery()
      .eq('opportunity_id', params.opportunityId)
      .maybeSingle()
    existingInsuranceCall = byOpportunity
    if (!existingInsuranceCall) {
      const { data: orphanByLead } = await insuranceCallBaseQuery()
        .is('opportunity_id', null)
        .maybeSingle()
      existingInsuranceCall = orphanByLead
    }
  } else {
    const { data: byLeadOnly } = await insuranceCallBaseQuery().is('opportunity_id', null).maybeSingle()
    existingInsuranceCall = byLeadOnly
  }

  const notes = [
    `Inside-sales insurance call booked by ${params.bookedByName || 'the closer'} at the inspection.`,
    params.sanitizedHandoffContext?.context_line
      ? `Context: ${params.sanitizedHandoffContext.context_line}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  if (existingInsuranceCall?.id) {
    const { error: updateInsuranceCallError } = await supabase
      .from('scheduled_appointments')
      .update({
        scheduled_for: params.insuranceCallAtIso,
        opportunity_id: params.opportunityId || null,
        notes,
      })
      .eq('id', existingInsuranceCall.id)
      .eq('org_id', params.orgId)

    if (updateInsuranceCallError) {
      console.error('Failed to update insurance-call appointment:', updateInsuranceCallError)
      return { appointmentId: null, error: 'Failed to schedule inside-sales insurance call on the calendar' }
    }
    return { appointmentId: existingInsuranceCall.id, error: null }
  }

  const { data: insuranceCallAppointment, error: insuranceCallError } = await supabase
    .from('scheduled_appointments')
    .insert({
      org_id: params.orgId,
      lead_id: params.leadId,
      opportunity_id: params.opportunityId || null,
      closer_user_id: null,
      canvasser_user_id: params.appointment?.canvasser_user_id || params.lead?.owner_user_id || null,
      scheduled_for: params.insuranceCallAtIso,
      duration_minutes: 15,
      address_text: params.appointment?.address_text || params.lead?.address_text || null,
      status: 'scheduled',
      notes,
      appointment_type: 'insurance_call',
    })
    .select('id')
    .single()

  if (insuranceCallError || !insuranceCallAppointment?.id) {
    console.error('Failed to create insurance-call appointment:', insuranceCallError)
    return { appointmentId: null, error: 'Failed to schedule inside-sales insurance call on the calendar' }
  }

  return { appointmentId: insuranceCallAppointment.id, error: null }
}
