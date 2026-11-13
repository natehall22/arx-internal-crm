import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CANVASS_SW_SCOPE,
  CANVASS_SW_URL,
  LEGACY_SW_CACHES,
  cleanupLegacyServiceWorkers,
  isLegacyRegistration,
  applyWaitingUpdate,
  registerCanvassServiceWorker,
} from '@/lib/service-worker-scope'

type Worker = { scriptURL: string; postMessage: jest.Mock; addEventListener?: jest.Mock; state?: string }
const worker = (path: string): Worker => ({ scriptURL: `https://crm.test${path}`, postMessage: jest.fn() })
const reg = (scopePath: string, script: string | null, extra: Record<string, unknown> = {}) =>
  ({
    scope: `https://crm.test${scopePath}`,
    active: script ? worker(script) : null,
    waiting: null,
    installing: null,
    unregister: jest.fn().mockResolvedValue(true),
    addEventListener: jest.fn(),
    ...extra,
  }) as unknown as ServiceWorkerRegistration & { unregister: jest.Mock; addEventListener: jest.Mock }

function mockSW(regs: ServiceWorkerRegistration[], registerImpl?: jest.Mock) {
  const sw = {
    getRegistrations: jest.fn().mockResolvedValue(regs),
    register: registerImpl ?? jest.fn(),
    controller: null as unknown,
    addEventListener: jest.fn(),
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
  return sw
}

let deleted: string[]
beforeEach(() => {
  deleted = []
  Object.defineProperty(global, 'caches', {
    configurable: true,
    value: { delete: jest.fn(async (n: string) => { deleted.push(n); return true }), keys: jest.fn(), open: jest.fn() },
  })
})

describe('isLegacyRegistration', () => {
  it('matches the old / scope for both retired scripts, in any worker slot', () => {
    expect(isLegacyRegistration(reg('/', '/sw.js'))).toBe(true)
    expect(isLegacyRegistration(reg('/', '/canvass-sw.js'))).toBe(true)
    expect(isLegacyRegistration(reg('/', null, { waiting: worker('/sw.js') }))).toBe(true)
    expect(isLegacyRegistration(reg('/', null, { installing: worker('/sw.js') }))).toBe(true)
  })
  it('never matches the new /canvass scope or an unrelated worker', () => {
    expect(isLegacyRegistration(reg('/canvass', '/canvass-sw.js'))).toBe(false)
    expect(isLegacyRegistration(reg('/', '/something-else.js'))).toBe(false)
    expect(isLegacyRegistration(reg('/', null))).toBe(false)
  })
})

describe('cleanupLegacyServiceWorkers', () => {
  it('unregisters only legacy registrations and deletes only the deleted worker caches', async () => {
    const oldRoot = reg('/', '/sw.js')
    const oldCanvass = reg('/', '/canvass-sw.js')
    const scoped = reg('/canvass', '/canvass-sw.js')
    mockSW([oldRoot, oldCanvass, scoped])
    expect(await cleanupLegacyServiceWorkers()).toBe(2)
    expect(oldRoot.unregister).toHaveBeenCalled()
    expect(oldCanvass.unregister).toHaveBeenCalled()
    expect(scoped.unregister).not.toHaveBeenCalled()
    expect(deleted.sort()).toEqual([...LEGACY_SW_CACHES].sort())
    expect(deleted).not.toContain('canvass-v3')
  })
  it('leaves the old worker alone until the /canvass worker is active', async () => {
    const oldRoot = reg('/sw.js'.replace('/sw.js', '/'), '/sw.js')
    mockSW([oldRoot, reg('/canvass', null, { installing: worker('/canvass-sw.js') })])
    expect(await cleanupLegacyServiceWorkers()).toBe(0)
    mockSW([oldRoot])
    expect(await cleanupLegacyServiceWorkers()).toBe(0)
    expect(oldRoot.unregister).not.toHaveBeenCalled()
    expect(deleted).toEqual([])
  })
  it('never throws when the browser rejects', async () => {
    const sw = mockSW([])
    sw.getRegistrations.mockRejectedValue(new Error('denied'))
    await expect(cleanupLegacyServiceWorkers()).resolves.toBe(0)
    const bad = reg('/', '/sw.js', { unregister: jest.fn().mockRejectedValue(new Error('x')) })
    mockSW([bad, reg('/canvass', '/canvass-sw.js')])
    await expect(cleanupLegacyServiceWorkers()).resolves.toBe(0)
  })
  it('does not touch IndexedDB or localStorage', async () => {
    const del = jest.fn()
    Object.defineProperty(global, 'indexedDB', { configurable: true, value: { deleteDatabase: del, open: del } })
    localStorage.setItem('canvass-offline-store', '{"state":{"pendingLeads":[{"id":1}]}}')
    mockSW([reg('/', '/sw.js'), reg('/canvass', '/canvass-sw.js')])
    await cleanupLegacyServiceWorkers()
    expect(del).not.toHaveBeenCalled()
    expect(localStorage.getItem('canvass-offline-store')).toContain('pendingLeads')
  })
})

describe('registerCanvassServiceWorker', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('registers at /canvass FIRST and retires the old worker only after the new one activates', async () => {
    const order: string[] = []
    const old = reg('/', '/sw.js', { unregister: jest.fn(async () => { order.push('unregister'); return true }) })
    let onState: (() => void) | undefined
    const installing = { scriptURL: 'https://crm.test/canvass-sw.js', state: 'installing', postMessage: jest.fn(), addEventListener: jest.fn((_: string, cb: () => void) => { onState = cb }) }
    const fresh = reg('/canvass', null, { installing })
    const register = jest.fn(async () => { order.push('register'); return fresh })
    const sw = mockSW([old], register)
    await registerCanvassServiceWorker()
    expect(register).toHaveBeenCalledWith(CANVASS_SW_URL, { scope: CANVASS_SW_SCOPE })
    await flush()
    expect(order).toEqual(['register']) // not active yet: old worker untouched
    installing.state = 'activated'
    ;(fresh as unknown as { active: unknown }).active = installing
    sw.getRegistrations.mockResolvedValue([old, fresh])
    onState!()
    await flush(); await flush()
    expect(order).toEqual(['register', 'unregister'])
  })
  it('a failed install leaves the old worker in place', async () => {
    const old = reg('/', '/sw.js')
    let onState: (() => void) | undefined
    const installing = { scriptURL: 'https://crm.test/canvass-sw.js', state: 'installing', postMessage: jest.fn(), addEventListener: jest.fn((_: string, cb: () => void) => { onState = cb }) }
    mockSW([old], jest.fn().mockResolvedValue(reg('/canvass', null, { installing })))
    await registerCanvassServiceWorker()
    installing.state = 'redundant'
    onState!()
    await flush()
    expect(old.unregister).not.toHaveBeenCalled()
  })
  it('never posts SKIP_WAITING by itself (updates are applied by a tap)', async () => {
    const waiting = worker('/canvass-sw.js')
    mockSW([], jest.fn().mockResolvedValue(reg('/canvass', '/canvass-sw.js', { waiting })))
    await registerCanvassServiceWorker()
    await flush()
    expect(waiting.postMessage).not.toHaveBeenCalled()
    applyWaitingUpdate(reg('/canvass', null, { waiting }))
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
  it('returns null without service worker support', async () => {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker
    expect(await registerCanvassServiceWorker()).toBeNull()
  })
})

describe('config consistency', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('canvass manifest scope equals the worker scope and sw.js is gone', () => {
    expect(JSON.parse(read('public/canvass-manifest.json')).scope).toBe(CANVASS_SW_SCOPE)
    expect(() => read('public/sw.js')).toThrow()
    expect(JSON.parse(read('public/manifest.json')).serviceworker).toBeUndefined()
  })
  it('next.config serves the worker with Service-Worker-Allowed for the same scope', () => {
    const cfg = read('next.config.js')
    expect(cfg).toContain(`'${CANVASS_SW_URL}'`)
    expect(cfg).toContain(`'Service-Worker-Allowed', value: '${CANVASS_SW_SCOPE}'`.replace("'Service-Worker-Allowed'", "key: 'Service-Worker-Allowed'"))
  })
  it('no code deletes IndexedDB or the offline queue key from the worker/cleanup paths', () => {
    for (const f of ['lib/service-worker-scope.ts', 'components/ServiceWorkerRegistration.tsx', 'public/canvass-sw.js']) {
      expect(read(f)).not.toMatch(/deleteDatabase|indexedDB\.|localStorage\./)
    }
  })
})
