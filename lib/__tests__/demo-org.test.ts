/** @jest-environment node */
import { allRecipientsReserved, assertDemoOrg, clearDemoOrgCache, demoLockedFeatureIn, guardReservedRecipients, isDemoOrg, isReservedMailDomain } from '@/lib/demo-org'
import { demoSuppressedChannel, channelSender } from '@/lib/customer-message-channels'

function orgClient(row: Record<string, unknown> | null, error: { message: string; code?: string } | null = null) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) } as never
}

describe('demo org flag', () => {
  beforeEach(() => clearDemoOrgCache())

  it('isDemoOrg: true only for an explicit flag; missing column / error / unknown = not a demo', async () => {
    expect(await isDemoOrg(orgClient({ is_demo: true }), 'o1')).toBe(true)
    clearDemoOrgCache()
    expect(await isDemoOrg(orgClient({ is_demo: false }), 'o2')).toBe(false)
    clearDemoOrgCache()
    expect(await isDemoOrg(orgClient(null, { message: 'column orgs.is_demo does not exist', code: '42703' }), 'o3')).toBe(false)
    expect(await isDemoOrg(orgClient({ is_demo: true }), null)).toBe(false)
  })

  it('assertDemoOrg is uncached and fails closed', async () => {
    await expect(assertDemoOrg(orgClient({ id: 'o', is_demo: true }), 'o')).resolves.toBeUndefined()
    await expect(assertDemoOrg(orgClient({ id: 'o', is_demo: false }), 'o')).rejects.toThrow(/not a demo company/)
    await expect(assertDemoOrg(orgClient({ id: 'o' }), 'o')).rejects.toThrow(/not a demo company/)
    await expect(assertDemoOrg(orgClient(null), 'o')).rejects.toThrow(/no company/)
    await expect(assertDemoOrg(orgClient(null, { message: 'boom' }), 'o')).rejects.toThrow(/could not check/)
  })

  it('locked switches: QuickBooks and AI changes', () => {
    expect(demoLockedFeatureIn({ quickbooks: true })).toBe('quickbooks')
    expect(demoLockedFeatureIn({ aiConnectorWrites: true })).toBe('aiConnectorWrites')
    expect(demoLockedFeatureIn({ quickbooks: false, servicePlans: true })).toBeNull()
  })
})

describe('mail door for reserved example addresses', () => {
  it('only demo.example.com (and below) is reserved — nothing else, so real mail is never swallowed', () => {
    expect(isReservedMailDomain('a@demo.example.com')).toBe(true)
    expect(isReservedMailDomain('Dana <dana@DEMO.example.com>')).toBe(true)
    expect(isReservedMailDomain('a@x.demo.example.com')).toBe(true)
    for (const real of ['a@example.com', 'a@gmail.com', 'a@x.test', 'a@notdemo.example.com', 'a@demo.example.com.evil.io', '', null, undefined]) expect(isReservedMailDomain(real as never)).toBe(false)
  })

  it('a mixed recipient list is NOT swallowed (a real address among them still gets its mail)', () => {
    expect(allRecipientsReserved('a@demo.example.com, b@demo.example.com')).toBe(true)
    expect(allRecipientsReserved('a@demo.example.com', 'real@gmail.com')).toBe(false)
    expect(allRecipientsReserved(undefined, [])).toBe(false)
    expect(allRecipientsReserved([{ address: 'a@demo.example.com' }], 'b@demo.example.com')).toBe(true)
  })

  it('the guarded transport drops demo-only mail and passes everything else through', async () => {
    const sent: unknown[] = []
    const t = guardReservedRecipients({ sendMail: async (m: unknown) => (sent.push(m), { messageId: 'real' }) })
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const dropped = await t.sendMail({ to: 'a@demo.example.com', subject: 's' })
    expect(dropped.messageId).toBe('demo-suppressed')
    expect(sent).toHaveLength(0)
    await t.sendMail({ to: ['a@demo.example.com', 'real@gmail.com'], subject: 's' })
    await t.sendMail({ to: 'real@gmail.com', subject: 's' })
    expect(sent).toHaveLength(2)
    info.mockRestore()
  })
})

describe('demoSuppressedChannel', () => {
  it('claims success without calling the real sender, for email and text', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    for (const c of ['email', 'sms'] as const) {
      const base = channelSender(c)
      const sendSpy = jest.spyOn(base, 'send')
      const ch = demoSuppressedChannel(base)
      expect(ch.available()).toBe(true)
      const r = await ch.send('a@demo.example.com', { subject: 's', html: '<p>x</p>', text: 'x', sms: 'x' } as never, { messageId: 'm1' } as never)
      expect(r.ok).toBe(true)
      expect((r as { providerId?: string }).providerId).toBe('demo-suppressed:m1')
      expect(sendSpy).not.toHaveBeenCalled()
      sendSpy.mockRestore()
    }
    info.mockRestore()
  })
})

describe('mail is decided on the SENDING org', () => {
  const T = 1_000_000
  const { isDemoSenderOrg, clearDemoSenderCache } = jest.requireActual('@/lib/demo-org') as typeof import('@/lib/demo-org')
  type Mode = { ids?: string[]; fail?: boolean; failOne?: boolean }
  const makeClient = (mode: Mode) => {
    const reads = { list: 0, one: 0 }
    const client = {
      from: () => ({
        select: () => ({
          eq: (col: string) => {
            if (col === 'is_demo') {
              reads.list += 1
              return Promise.resolve(mode.fail ? { data: null, error: { message: 'down' } } : { data: (mode.ids ?? []).map((id) => ({ id })), error: null })
            }
            reads.one += 1
            return { maybeSingle: async () => (mode.failOne ? { data: null, error: { message: 'down' } } : { data: { is_demo: false }, error: null }) }
          },
        }),
      }),
    } as never
    return { client, reads }
  }
  const sendWith = async (orgId: string | null, mode: Mode, to = 'someone@gmail.com') => {
    const sent: unknown[] = []
    const { client } = makeClient(mode)
    const t = guardReservedRecipients({ sendMail: async (m: unknown) => (sent.push(m), { messageId: 'real' }) }, orgId ? () => isDemoSenderOrg(client, orgId) : undefined)
    const info = await t.sendMail({ to, subject: 's' })
    return { sent: sent.length, id: info.messageId as string }
  }
  beforeEach(() => {
    clearDemoSenderCache()
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('a demo company\'s mail never leaves, whoever it is addressed to', async () => {
    expect(await sendWith('demo1', { ids: ['demo1'] }, 'prospect@gmail.com')).toEqual({ sent: 0, id: 'demo-suppressed' })
  })

  it('a normal company\'s mail still sends, even to an address that also exists in a demo company', async () => {
    expect(await sendWith('arx', { ids: ['demo1'] }, 'prospect@gmail.com')).toEqual({ sent: 1, id: 'real' })
  })

  it('only @demo.example.com recipients are dropped without knowing the org; nothing else', async () => {
    expect((await sendWith(null, {}, 'a@demo.example.com')).sent).toBe(0)
    expect((await sendWith(null, {}, 'a@gmail.com')).sent).toBe(1)
  })

  it('a normal company costs one read per minute, not one per send', async () => {
    const { client, reads } = makeClient({ ids: ['demo1'] })
    for (let i = 0; i < 50; i++) expect(await isDemoSenderOrg(client, 'arx', T + i)).toBe(false)
    expect(reads).toEqual({ list: 1, one: 0 })
    expect(await isDemoSenderOrg(client, 'arx', T + 61_000)).toBe(false)
    expect(reads.list).toBe(2)
  })

  it('a database error: the demo stays blocked, another company is unaffected (last known set kept)', async () => {
    const good = makeClient({ ids: ['demo1'] }).client
    expect(await isDemoSenderOrg(good, 'arx', T)).toBe(false)
    const down = makeClient({ fail: true }).client
    expect(await isDemoSenderOrg(down, 'demo1', T + 61_000)).toBe(true)
    expect(await isDemoSenderOrg(down, 'arx', T + 61_000)).toBe(false)
  })

  it('never managed to read the list and cannot check the company: fail closed', async () => {
    const down = makeClient({ fail: true, failOne: true }).client
    expect(await isDemoSenderOrg(down, 'whoever', T)).toBe(true)
  })

  it('no raw nodemailer transport outside the guarded factory; the factory and push use the sending-org check', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__' || e.name.startsWith('.')) continue
        const f = path.join(d, e.name)
        if (e.isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(e.name) && /nodemailer\.createTransport|\bcreateTransport\(/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(process.cwd(), f))
      }
    }
    for (const d of ['app', 'lib', 'components', 'scripts']) if (fs.existsSync(d)) walk(d)
    expect(hits).toEqual(['lib/demo-org-mail.ts'])
    expect(fs.readFileSync('lib/demo-org-mail.ts', 'utf8')).toMatch(/isDemoSenderOrg/)
    expect(fs.readFileSync('lib/push-apns.ts', 'utf8')).toMatch(/isDemoSenderOrg/)
    expect(fs.readFileSync('lib/customer-messages-db.ts', 'utf8')).toMatch(/isDemoSenderOrg/)
  })

  it('company-owned send paths pass the sending org to the mail door', () => {
    const fs = require('fs') as typeof import('fs')
    // every getMailTransport() call outside these public / org-less callers must name the sending org
    const allowed = new Set(['lib/public-estimate-lead.ts', 'lib/supplier-order-email.ts', 'lib/customer-message-channels.ts', 'app/api/trial-signup/route.ts'])
    const bare: string[] = []
    const path = require('path') as typeof import('path')
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__' || e.name.startsWith('.')) continue
        const f = path.join(d, e.name)
        if (e.isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(e.name) && /getMailTransport\(\)/.test(fs.readFileSync(f, 'utf8')) && !allowed.has(path.relative(process.cwd(), f))) bare.push(path.relative(process.cwd(), f))
      }
    }
    for (const d of ['app', 'lib']) walk(d)
    expect(bare).toEqual([])
  })
})

describe('seed --demo database guard', () => {
  const { isLocalSupabaseUrl } = jest.requireActual('@/lib/demo-org') as typeof import('@/lib/demo-org')
  it('only a database on this machine counts as local', () => {
    for (const u of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:5432', 'http://host.docker.internal:54321']) expect(isLocalSupabaseUrl(u)).toBe(true)
    for (const u of ['https://abc.supabase.co', 'https://localhost.evil.io', 'https://127.0.0.1.evil.io', '', 'not a url', undefined]) expect(isLocalSupabaseUrl(u as never)).toBe(false)
  })
  it('the script refuses a hosted URL without --i-know-this-is-prod, and the flag is demo-only', () => {
    const src = require('fs').readFileSync('scripts/seed-company.ts', 'utf8') as string
    expect(src).toMatch(/demo && !isLocalSupabaseUrl\(url\) && !args\.includes\('--i-know-this-is-prod'\)/)
    expect(src).toMatch(/!demo && args\.includes\('--i-know-this-is-prod'\)/)
  })
})
