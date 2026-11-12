/** Runs public/canvass-sw.js against a fake worker scope to pin what it will and will not cache. */
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

type Handler = (e: unknown) => void
function load() {
  const handlers: Record<string, Handler> = {}
  const stores: Record<string, Map<string, unknown>> = {}
  const open = async (name: string) => {
    const m = (stores[name] ??= new Map())
    return {
      put: async (req: { url?: string } | string, res: unknown) => { m.set(typeof req === 'string' ? req : req.url!, res) },
      keys: async () => Array.from(m.keys()).map((url) => ({ url })),
      delete: async (req: { url?: string } | string) => m.delete(typeof req === 'string' ? req : req.url!),
    }
  }
  const sandbox: Record<string, unknown> = {
    self: { location: { origin: 'https://crm.test' }, addEventListener: (n: string, h: Handler) => { handlers[n] = h }, clients: { matchAll: async () => [] } },
    caches: { open, keys: async () => Object.keys(stores), delete: async (n: string) => delete stores[n], match: async () => undefined },
    fetch: jest.fn(),
    URL,
    console,
    Promise,
  }
  vm.runInNewContext(readFileSync(join(process.cwd(), 'public/canvass-sw.js'), 'utf8'), sandbox)
  return { handlers, stores, sandbox }
}
const resp = (o: Record<string, unknown> = {}) => ({ status: 200, redirected: false, type: 'basic', clone() { return this }, ...o })
async function run(url: string, response: unknown, mode = 'cors') {
  const { handlers, stores, sandbox } = load()
  ;(sandbox.fetch as jest.Mock).mockResolvedValue(response)
  let responded: Promise<unknown> | null = null
  const waits: Promise<unknown>[] = []
  handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (p: Promise<unknown>) => { responded = p }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
  if (responded) await responded
  await Promise.all(waits)
  return { intercepted: responded !== null, stores }
}
const size = (st: Record<string, Map<string, unknown>>) => Object.values(st).reduce((n, m) => n + m.size, 0)

describe('canvass-sw.js caching rules', () => {
  it('caches a same-origin 200', async () => {
    const r = await run('https://crm.test/canvass/stats', resp(), 'navigate')
    expect(size(r.stores)).toBe(1)
  })
  it.each([
    ['cross-origin Google Maps', 'https://maps.googleapis.com/maps/api/js'],
    ['RSC payload', 'https://crm.test/canvass?_rsc=abc'],
    ['next data', 'https://crm.test/_next/data/x/y.json'],
    ['api', 'https://crm.test/api/leads'],
  ])('does not touch %s', async (_n, url) => {
    const r = await run(url, resp())
    expect(r.intercepted).toBe(false)
    expect(size(r.stores)).toBe(0)
  })
  it('never stores a redirected or non-200 response', async () => {
    expect(size((await run('https://crm.test/canvass', resp({ redirected: true }), 'navigate')).stores)).toBe(0)
    expect(size((await run('https://crm.test/canvass', resp({ status: 500 }), 'navigate')).stores)).toBe(0)
    expect(size((await run('https://crm.test/x', resp({ status: 404 }))).stores)).toBe(0)
  })
  it('caps the runtime cache at 60 entries, trimming the oldest', async () => {
    const { handlers, stores, sandbox } = load()
    ;(sandbox.fetch as jest.Mock).mockResolvedValue(resp())
    for (let i = 0; i < 75; i++) {
      const waits: Promise<unknown>[] = []
      let r: Promise<unknown> | null = null
      handlers.fetch({ request: { url: `https://crm.test/page${i}`, method: 'GET', mode: 'cors' }, respondWith: (p: Promise<unknown>) => { r = p }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
      await r
      await Promise.all(waits)
    }
    const runtime = stores['canvass-runtime-v4']
    expect(runtime.size).toBe(60)
    expect(runtime.has('https://crm.test/page0')).toBe(false)
    expect(runtime.has('https://crm.test/page74')).toBe(true)
  })
  it('does not skipWaiting or claim by itself', () => {
    const src = readFileSync(join(process.cwd(), 'public/canvass-sw.js'), 'utf8')
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/clients\.claim\(\)/)
    expect(src.match(/skipWaiting\(\)/g)).toHaveLength(1) // only inside the SKIP_WAITING message handler
  })
})
