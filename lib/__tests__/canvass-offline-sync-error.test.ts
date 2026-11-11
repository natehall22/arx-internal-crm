import { useOfflineStore } from '@/app/(canvass-app)/canvass/lib/offlineStore'

const lead = (id: string) => ({ id, client_lead_id: `c-${id}`, lat: 1, lng: 2, status: 'new', created_at: '2026-11-10T12:00:00Z', synced: false })

function respond(status: number) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 300, status, text: async () => 'nope' }) as unknown as typeof fetch
}

beforeEach(() => {
  localStorage.clear()
  useOfflineStore.setState({ pendingLeads: [], isSyncing: false, syncLockAt: null })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

it('a knock the server refuses for good is kept and marked, not left looking pending forever', async () => {
  useOfflineStore.getState().addLead(lead('a'))
  respond(422)
  await useOfflineStore.getState().syncLeads()
  const [kept] = useOfflineStore.getState().pendingLeads
  expect(kept.id).toBe('a')
  expect(kept.sync_error).toMatchObject({ status: 422 })
})

it('a server error or sign-out stays plain pending (it will be retried)', async () => {
  for (const status of [503, 401]) {
    useOfflineStore.setState({ pendingLeads: [{ ...lead('b'), sync_error: { status: 422, message: '', at: '' } }], isSyncing: false, syncLockAt: null })
    respond(status)
    await useOfflineStore.getState().syncLeads()
    expect(useOfflineStore.getState().pendingLeads[0].sync_error).toBeNull()
  }
})

it('a later success removes the knock as before', async () => {
  useOfflineStore.getState().addLead({ ...lead('c'), sync_error: { status: 422, message: '', at: '' } })
  respond(200)
  await useOfflineStore.getState().syncLeads()
  expect(useOfflineStore.getState().pendingLeads).toEqual([])
})
