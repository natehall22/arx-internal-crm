/** @jest-environment jsdom */
/** The phone outbox keeps tap order even when the first tap waits for its location; resends after a 5xx; drops a permanent refusal into `failed`. */
import { useTimeClockQueue } from '@/lib/time-clock-queue'

const sent: Array<Record<string, unknown>> = []
let status = 200
beforeEach(() => {
  sent.length = 0
  status = 200
  useTimeClockQueue.setState({ pending: [], failed: [], sending: false })
  global.fetch = jest.fn(async (_u: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(String(init?.body)))
    return { ok: status < 300, status, json: async () => (status === 400 ? { error: 'Pick who', permanent: true } : { ok: true }) } as Response
  }) as never
})

it('a tap waiting for its location holds the line; the next tap never jumps ahead', async () => {
  let give: (v: { lat: number; lng: number }) => void = () => {}
  const loc = new Promise<{ lat: number; lng: number }>((r) => (give = r))
  const q = useTimeClockQueue.getState()
  q.enqueue('/api/time/clock', { tapId: 'tap-aaaaaaaa', action: 'clock_in' }, loc)
  q.enqueue('/api/time/clock', { tapId: 'tap-bbbbbbbb', action: 'break_start' })
  await new Promise((r) => setTimeout(r, 20))
  expect(sent).toHaveLength(0)
  give({ lat: 30.1, lng: -84.3 })
  await new Promise((r) => setTimeout(r, 50))
  expect(sent.map((b) => b.tapId)).toEqual(['tap-aaaaaaaa', 'tap-bbbbbbbb'])
  expect(sent[0]).toMatchObject({ lat: 30.1, lng: -84.3 })
  expect(typeof sent[0].deviceNow).toBe('string')
})

it('server trouble keeps the tap; a permanent refusal moves it to failed', async () => {
  status = 503
  useTimeClockQueue.getState().enqueue('/x', { tapId: 'tap-cccccccc' })
  await new Promise((r) => setTimeout(r, 20))
  expect(useTimeClockQueue.getState().pending).toHaveLength(1)
  status = 400
  await useTimeClockQueue.getState().flush()
  expect(useTimeClockQueue.getState().pending).toHaveLength(0)
  expect(useTimeClockQueue.getState().failed[0]).toMatchObject({ id: 'tap-cccccccc', error: 'Pick who' })
})
