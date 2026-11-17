/** @jest-environment node */
const sendMailSmtp = jest.fn(async () => ({ messageId: 'smtp-1', accepted: ['c@x.test'], rejected: [] }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: sendMailSmtp }) } }))
jest.mock('@/lib/support/send-guard', () => ({ assertNoSupportSend: async () => undefined }))
jest.mock('@/lib/demo-org', () => ({
  ...jest.requireActual('@/lib/demo-org'),
  isDemoSenderOrg: async (_c: unknown, id: string) => id === 'demo',
}))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildResendPayload, companyFromHeader, parseAddresses, resendTuning, resetCompanyMailWarning, sanitizeDisplayName } from '@/lib/company-mail'
import { isUnknownSmtpOutcome } from '@/lib/customer-message-channels'

const fake = createFakeDb({
  orgs: [
    { id: 'arx', name: 'Original Co', email: 'info@original.test', original_brand: true },
    { id: 'p', original_brand: false, name: 'Precision "Roofing"\r\nBcc: x@evil.test <a>', email: 'office@precision.test' },
    { id: 'q', original_brand: false, name: 'No Email Co', email: 'not-an-email' },
    { id: 'demo', original_brand: false, name: 'Demo Co', email: 'demo@demo.example.com' },
  ],
})
let db: any = fake.client
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db }))

import { getMailTransport } from '@/lib/setter-email'

const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'rs_1' }) }))
const sleepMock = jest.fn(async () => undefined)
const env = { k: process.env.RESEND_API_KEY, d: process.env.COMPANY_MAIL_FROM_DOMAIN }
beforeEach(() => {
  sendMailSmtp.mockClear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ id: 'rs_1' }) }))
  sleepMock.mockClear()
  resetCompanyMailWarning()
  db = fake.client
  resendTuning.gapMs = 0
  resendTuning.sleep = sleepMock
  ;(global as any).fetch = fetchMock
  process.env.RESEND_API_KEY = 're_test'
  process.env.COMPANY_MAIL_FROM_DOMAIN = 'mail.product.test'
})
afterAll(() => {
  if (env.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = env.k
  if (env.d === undefined) delete process.env.COMPANY_MAIL_FROM_DOMAIN; else process.env.COMPANY_MAIL_FROM_DOMAIN = env.d
})

const msg = { from: 'ignored <x@y.test>', to: 'cust@x.test', subject: 'Hi', html: '<p>hi</p>', text: 'hi' }

it('original company: SMTP, unchanged, Resend never called', async () => {
  await getMailTransport('arx').sendMail(msg)
  expect(sendMailSmtp).toHaveBeenCalledWith(msg)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('no company (marketing forms): SMTP', async () => {
  await getMailTransport(null).sendMail(msg)
  expect(sendMailSmtp).toHaveBeenCalledTimes(1)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('other company: Resend payload with product-domain From, Reply-To, base64 attachments', async () => {
  const pdf = Buffer.from('%PDF-1.4 test')
  const out = await getMailTransport('p').sendMail({ ...msg, to: ['a@x.test', 'b@x.test'], cc: 'c@x.test', attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }], headers: { 'List-Unsubscribe': '<https://u.test>' } })
  expect(sendMailSmtp).not.toHaveBeenCalled()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
  expect(url).toBe('https://api.resend.com/emails')
  expect(init.headers.Authorization).toBe('Bearer re_test')
  const body = JSON.parse(init.body)
  expect(body.from).toMatch(/^"[^"\r\n<>\\]+" <no-reply@mail\.product\.test>$/)
  expect(body.reply_to).toBe('office@precision.test')
  expect(body.to).toEqual(['a@x.test', 'b@x.test'])
  expect(body.cc).toEqual(['c@x.test'])
  expect(body.attachments).toEqual([{ filename: 'a.pdf', content: pdf.toString('base64'), content_type: 'application/pdf' }])
  expect(body.headers).toEqual({ 'List-Unsubscribe': '<https://u.test>' })
  expect(out.messageId).toBe('rs_1')
})

it('caller reply-to wins when valid; invalid company email gives no reply_to', async () => {
  await getMailTransport('p').sendMail({ ...msg, replyTo: 'rep@precision.test' })
  expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).reply_to).toBe('rep@precision.test')
  await getMailTransport('q').sendMail(msg)
  expect(JSON.parse((fetchMock.mock.calls[1] as any)[1].body).reply_to).toBeUndefined()
})

it('Resend failure throws (callers handle it like an SMTP failure)', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ message: 'bad domain' }) } as any)
  await expect(getMailTransport('p').sendMail(msg)).rejects.toThrow(/Resend 422/)
})

describe('safety gates', () => {
  it('no org marked original yet: everyone stays on SMTP', async () => {
    db = createFakeDb({ orgs: [{ id: 'p', original_brand: false, name: 'P', email: 'o@p.test' }] }).client
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await getMailTransport('p').sendMail(msg)
    expect(sendMailSmtp).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  it('env set + company row missing: throws, never SMTP', async () => {
    await expect(getMailTransport('ghost').sendMail(msg)).rejects.toThrow(/not found/)
    expect(sendMailSmtp).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('env set + read error: retried once, then throws, never SMTP', async () => {
    let calls = 0
    db = { from: () => { calls++; const q: any = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: { message: 'boom' } }), then: (r: any) => r({ data: null, error: { message: 'boom' } }) }; return q } }
    await expect(getMailTransport('p').sendMail(msg)).rejects.toThrow(/could not read/)
    expect(calls).toBe(2)
    expect(sendMailSmtp).not.toHaveBeenCalled()
  })
  it('original-check result is cached 5 minutes (one read for many sends)', async () => {
    const spy = jest.spyOn(fake.client, 'from')
    await getMailTransport('p').sendMail(msg)
    await getMailTransport('p').sendMail(msg)
    const originalChecks = spy.mock.calls.filter((c) => c[0] === 'orgs').length
    expect(originalChecks).toBe(3) // 1 shared original check + 1 row read per send
    spy.mockRestore()
  })
})

describe('transport behavior', () => {
  it('passes an abort signal (15 s timeout)', async () => {
    await getMailTransport('p').sendMail(msg)
    expect((fetchMock.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal)
  })
  it('429: honors Retry-After, same Idempotency-Key, up to 3 attempts, then throws', async () => {
    const r429 = { ok: false, status: 429, headers: { get: () => '2' }, json: async () => ({ message: 'slow down' }) }
    fetchMock.mockResolvedValueOnce(r429 as any).mockResolvedValueOnce(r429 as any).mockResolvedValueOnce(r429 as any)
    await expect(getMailTransport('p').sendMail({ ...msg, messageId: '<cr-1@x.test>' })).rejects.toThrow(/Resend 429/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleepMock).toHaveBeenCalledWith(2000)
    const keys = fetchMock.mock.calls.map((c: any) => c[1].headers['Idempotency-Key'])
    expect(keys).toEqual(['cr-1@x.test', 'cr-1@x.test', 'cr-1@x.test'])
  })
  it('429 then success returns the id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) } as any)
    const out = await getMailTransport('p').sendMail(msg)
    expect(out.messageId).toBe('rs_1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('network error / timeout: not retried, unknown outcome shape', async () => {
    const t = new Error('t'); t.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(t)
    const e: any = await getMailTransport('p').sendMail(msg).catch((x) => x)
    expect(e.code).toBe('ETIMEDOUT')
    expect(isUnknownSmtpOutcome(e)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const e2: any = await getMailTransport('p').sendMail(msg).catch((x) => x)
    expect(isUnknownSmtpOutcome(e2)).toBe(true)
  })
  it('an HTTP error is a definite failure (not unknown)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) } as any)
    const e: any = await getMailTransport('p').sendMail(msg).catch((x) => x)
    expect(isUnknownSmtpOutcome(e)).toBe(false)
  })
})

describe('payload fidelity', () => {
  const route = { apiKey: 'k', domain: 'd.test', companyName: 'Co', companyEmail: 'co@x.test' }
  it('messageId, inReplyTo, references and array headers become headers; Idempotency-Key from messageId', async () => {
    const p: any = buildResendPayload(route, { to: 'a@x.test', subject: 's', messageId: 'abc@h', inReplyTo: '<p@h>', references: ['<r1@h>', 'r2@h'], headers: { 'X-Multi': ['a', 'b'], 'X-Obj': { value: 'v' } } })
    expect(p.headers).toEqual({ 'Message-ID': '<abc@h>', 'In-Reply-To': '<p@h>', References: '<r1@h> <r2@h>', 'X-Multi': 'a, b', 'X-Obj': 'v' })
    await getMailTransport('p').sendMail({ ...msg, messageId: '<abc@h>' })
    expect((fetchMock.mock.calls[0] as any)[1].headers['Idempotency-Key']).toBe('abc@h')
  })
  it('array-of-{key,value} headers', () => {
    const p: any = buildResendPayload(route, { to: 'a@x.test', subject: 's', headers: [{ key: 'X-A', value: '1' }] })
    expect(p.headers).toEqual({ 'X-A': '1' })
  })
  it('replyTo forms: string, "Name <addr>", object, array; invalid falls back to company email', () => {
    const rt = (v: unknown) => (buildResendPayload(route, { to: 'a@x.test', subject: 's', replyTo: v }) as any).reply_to
    expect(rt('rep@x.test')).toBe('rep@x.test')
    expect(rt('Rep Name <rep@x.test>')).toBe('rep@x.test')
    expect(rt({ name: 'R', address: 'rep@x.test' })).toBe('rep@x.test')
    expect(rt(['a@x.test', { address: 'b@x.test' }])).toEqual(['a@x.test', 'b@x.test'])
    expect(rt('garbage')).toBe('co@x.test')
  })
  it('"Smith, John" <j@x.test> parses as ONE recipient', () => {
    expect(parseAddresses('"Smith, John" <j@x.test>, b@x.test')).toEqual([{ name: 'Smith, John', address: 'j@x.test' }, { name: '', address: 'b@x.test' }])
    const p: any = buildResendPayload(route, { to: '"Smith, John" <j@x.test>', subject: 's' })
    expect(p.to).toEqual(['"Smith, John" <j@x.test>'])
  })
  it('attachments: path / href / stream content throw; string content and base64 string ok', () => {
    const b = (a: any) => () => buildResendPayload(route, { to: 'a@x.test', subject: 's', attachments: [a] })
    expect(b({ filename: 'a.pdf', path: '/etc/passwd' })).toThrow(/path/)
    expect(b({ filename: 'a.pdf', href: 'http://x' })).toThrow(/path/)
    expect(b({ filename: 'a.pdf', content: new (require('stream').Readable)() })).toThrow(/Buffer or string/)
    expect(b({ filename: 'a.pdf' })).toThrow(/Buffer or string/)
    const p: any = buildResendPayload(route, { to: 'a@x.test', subject: 's', attachments: [{ filename: 'a.txt', content: 'hi' }, { filename: 'b.bin', content: 'aGk=', encoding: 'base64' }] })
    expect(p.attachments.map((a: any) => a.content)).toEqual([Buffer.from('hi').toString('base64'), 'aGk='])
  })
})


it('demo company mail stays suppressed, not sent either way', async () => {
  const r = await getMailTransport('demo').sendMail(msg)
  expect(r.messageId).toBe('demo-suppressed')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(sendMailSmtp).not.toHaveBeenCalled()
})

it('env missing: old SMTP path, warns once', async () => {
  delete process.env.RESEND_API_KEY
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  await getMailTransport('p').sendMail(msg)
  await getMailTransport('p').sendMail(msg)
  expect(sendMailSmtp).toHaveBeenCalledTimes(2)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledTimes(1)
  warn.mockRestore()
})

describe('header injection', () => {
  it('display name is stripped of quotes, CR/LF, angle brackets and capped', () => {
    expect(sanitizeDisplayName('A"B\r\nBcc: x@evil.test <c>\\')).toBe('A B Bcc: x@evil.test c')
    expect(sanitizeDisplayName('x'.repeat(500)).length).toBe(80)
    expect(companyFromHeader('"\r\n<>', 'd.test')).toBe('no-reply@d.test')
    expect(companyFromHeader('Smith & Sons', 'd.test')).toBe('"Smith & Sons" <no-reply@d.test>')
  })
  it('subject / header values and attachment names cannot carry a newline', () => {
    const p = buildResendPayload({ apiKey: 'k', domain: 'd.test', companyName: 'Co', companyEmail: null }, { to: 'a@x.test', subject: 'Hi\r\nBcc: evil@x.test', headers: { 'X-A': 'v\r\nBcc: e@x.test', 'Bad Key': 'x' }, attachments: [{ filename: 'a\r\n.pdf', content: 'abc' }] })
    expect(p.subject).toBe('Hi Bcc: evil@x.test')
    expect(p.headers).toEqual({ 'X-A': 'v Bcc: e@x.test' })
    expect((p.attachments as any)[0].filename).toBe('a .pdf')
  })
})
