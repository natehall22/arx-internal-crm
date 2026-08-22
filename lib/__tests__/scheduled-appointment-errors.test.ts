import { mapScheduledAppointmentWriteError } from '@/lib/scheduled-appointment-errors'

describe('mapScheduledAppointmentWriteError', () => {
  it('maps the buffer/overlap trigger to a 409 by errcode', () => {
    const mapped = mapScheduledAppointmentWriteError({ code: '23P01' })
    expect(mapped.status).toBe(409)
    expect(mapped.message).toContain('Admin → Scheduling')
  })

  it.each([
    'Scheduling conflict: closer already has an overlapping appointment',
    'Scheduling conflict: closer already has an appointment within the required 30 minute gap',
  ])('maps trigger wording to a 409 even without the errcode: %s', (message) => {
    expect(mapScheduledAppointmentWriteError({ message }).status).toBe(409)
  })

  it('gives lead-specific copy for the lead-slot unique violation', () => {
    const mapped = mapScheduledAppointmentWriteError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "uniq_active_lead_id_slot"',
    })
    expect(mapped).toEqual({
      message: 'Another active appointment already exists for this lead at this time.',
      status: 409,
    })
  })

  // Regression: the lead_id branch once matched on the message alone, so a foreign-key
  // violation (23503) naming scheduled_appointments_lead_id_fkey returned a misleading
  // "already exists for this lead" 409 instead of surfacing the real failure.
  it('does not claim a duplicate lead appointment for a lead_id FK violation', () => {
    const mapped = mapScheduledAppointmentWriteError({
      code: '23503',
      message:
        'insert or update on table "scheduled_appointments" violates foreign key constraint "scheduled_appointments_lead_id_fkey"',
    })
    expect(mapped.status).toBe(500)
    expect(mapped.message).not.toContain('already exists for this lead')
  })

  it('maps the rapid-duplicate throttle to a 409', () => {
    expect(
      mapScheduledAppointmentWriteError({
        message: 'Rapid duplicate submit blocked: matching appointment was just created',
      }).status
    ).toBe(409)
  })

  it('falls back to the caller message and a 500 for unrelated errors', () => {
    expect(
      mapScheduledAppointmentWriteError({ code: '42703', message: 'column does not exist' }, 'Nope')
    ).toEqual({ message: 'Nope', status: 500 })
  })
})
