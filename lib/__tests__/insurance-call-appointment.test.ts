import { bookInsuranceCallAppointment } from '@/lib/insurance-call-appointment'

type QueryResult = { data: unknown; error: unknown }

function makeSupabaseMock(handlers: {
  maybeSingle?: () => Promise<QueryResult>
  single?: () => Promise<QueryResult>
  update?: () => Promise<QueryResult>
}) {
  const chain: Record<string, jest.Mock> = {}
  const self = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return undefined
        if (!chain[prop]) {
          chain[prop] = jest.fn(() => self)
        }
        return chain[prop]
      },
    }
  )

  if (handlers.maybeSingle) {
    chain.maybeSingle = jest.fn(handlers.maybeSingle)
  }
  if (handlers.single) {
    chain.single = jest.fn(handlers.single)
  }
  if (handlers.update) {
    chain.update = jest.fn(() => {
      const updateResult = handlers.update!
      const updateChain: Record<string, jest.Mock> = {}
      const updateSelf: Record<string, unknown> = {}
      Object.assign(updateSelf, {
        eq: jest.fn(() => {
          const eqChain = new Proxy(
            {},
            {
              get(_target, eqProp: string) {
                if (eqProp === 'then') {
                  return (resolve: (value: QueryResult) => void) => {
                    void updateResult().then(resolve)
                  }
                }
                return jest.fn(() => eqChain)
              },
            }
          )
          return eqChain
        }),
      })
      return updateSelf
    })
  }

  return {
    from: jest.fn(() => self),
    chain: self,
    chainMocks: chain,
  }
}

describe('bookInsuranceCallAppointment', () => {
  const baseParams = {
    orgId: 'org-1',
    leadId: 'lead-1',
    opportunityId: null as string | null,
    insuranceCallAtIso: '2026-07-15T18:00:00.000Z',
    bookedByName: 'Closer Rep',
    sanitizedHandoffContext: null,
    appointment: { canvasser_user_id: 'setter-1', address_text: '123 Main' },
    lead: { owner_user_id: 'setter-1', address_text: '123 Main' },
  }

  it('inserts a new insurance_call when none exists for the lead', async () => {
    const mock = makeSupabaseMock({
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 'apt-new' }, error: null }),
    })

    const supabase = mock as unknown as Parameters<typeof bookInsuranceCallAppointment>[0]
    const result = await bookInsuranceCallAppointment(supabase, baseParams)

    expect(result).toEqual({ appointmentId: 'apt-new', error: null })
    expect(mock.from).toHaveBeenCalledWith('scheduled_appointments')
    expect(mock.chainMocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        appointment_type: 'insurance_call',
        closer_user_id: null,
        opportunity_id: null,
        scheduled_for: baseParams.insuranceCallAtIso,
      })
    )
  })

  it('updates an existing orphan insurance_call instead of inserting', async () => {
    const mock = makeSupabaseMock({
      maybeSingle: async () => ({ data: { id: 'apt-existing' }, error: null }),
      update: async () => ({ data: null, error: null }),
    })

    const supabase = mock as unknown as Parameters<typeof bookInsuranceCallAppointment>[0]
    const result = await bookInsuranceCallAppointment(supabase, {
      ...baseParams,
      sanitizedHandoffContext: { context_line: 'Adjuster next week' },
    })

    expect(result).toEqual({ appointmentId: 'apt-existing', error: null })
    expect(mock.chainMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduled_for: baseParams.insuranceCallAtIso,
        notes: expect.stringContaining('Adjuster next week'),
      })
    )
    expect(mock.chainMocks.insert).toBeUndefined()
  })

  it('returns an error when insert fails so callers can abort before opportunity writes', async () => {
    const mock = makeSupabaseMock({
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: { message: 'db down' } }),
    })

    const supabase = mock as unknown as Parameters<typeof bookInsuranceCallAppointment>[0]
    const result = await bookInsuranceCallAppointment(supabase, baseParams)

    expect(result.appointmentId).toBeNull()
    expect(result.error).toMatch(/Failed to schedule/)
  })
})
