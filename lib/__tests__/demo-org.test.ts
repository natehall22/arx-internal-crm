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

describe('every mail path is suppressed for a demo company, unchanged for others', () => {
  const { anyRecipientInDemoOrg, clearDemoRecipientCache, recipientAddresses } = jest.requireActual('@/lib/demo-org') as typeof import('@/lib/demo-org')
  // orgs -> demo ids; users/customers/leads -> rows whose email is in `known` and org is demo
  const client = (demoIds: string[], known: Record<string, string[]>) =>
    ({
      from: (table: string) => {
        if (table === 'orgs') return { select: () => ({ eq: async () => ({ data: demoIds.map((id) => ({ id })), error: null }) }) }
        return {
          select: () => ({
            in: (_c: string, orgs: string[]) => ({
              in: (_e: string, emails: string[]) => ({
                limit: async () => ({ data: emails.some((e) => (known[table] ?? []).includes(e)) && orgs.length ? [{ id: 'x' }] : [], error: null }),
              }),
            }),
          }),
        }
      },
    }) as never

  beforeEach(() => clearDemoRecipientCache())

  it('a real address stored in a demo org is suppressed; the same address elsewhere is not', async () => {
    const sent: unknown[] = []
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const demoT = guardReservedRecipients({ sendMail: async (m: unknown) => (sent.push(m), { messageId: 'real' }) }, (a) =>
      anyRecipientInDemoOrg(client(['demo1'], { customers: ['prospect@gmail.com'] }), a)
    )
    expect((await demoT.sendMail({ to: 'Prospect <prospect@gmail.com>', subject: 's' })).messageId).toBe('demo-suppressed')
    expect(sent).toHaveLength(0)
    clearDemoRecipientCache()
    const realT = guardReservedRecipients({ sendMail: async (m: unknown) => (sent.push(m), { messageId: 'real' }) }, (a) =>
      anyRecipientInDemoOrg(client([], {}), a)
    )
    expect((await realT.sendMail({ to: 'prospect@gmail.com', subject: 's' })).messageId).toBe('real')
    expect(sent).toHaveLength(1)
    info.mockRestore()
  })

  it('recipientAddresses normalizes every shape', () => {
    expect(recipientAddresses('A <a@x.com>, b@y.com', [{ address: 'C@z.com' }], undefined)).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
  })

  it('no raw nodemailer transport exists outside the guarded factory, and the factory wires the org check', () => {
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
    expect(fs.readFileSync('lib/demo-org-mail.ts', 'utf8')).toMatch(/anyRecipientInDemoOrg/)
    expect(fs.readFileSync('lib/push-apns.ts', 'utf8')).toMatch(/isDemoOrg/)
  })
})
