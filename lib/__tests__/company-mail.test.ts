/** @jest-environment node */
const sendMailSmtp = jest.fn(async () => ({ messageId: 'smtp-1', accepted: ['c@x.test'], rejected: [] }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: sendMailSmtp }) } }))
jest.mock('@/lib/support/send-guard', () => ({ assertNoSupportSend: async () => undefined }))
jest.mock('@/lib/demo-org', () => ({
  ...jest.requireActual('@/lib/demo-org'),
  isDemoSenderOrg: async (_c: unknown, id: string) => id === 'demo',
}))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildResendPayload, companyFromHeader, resetCompanyMailWarning, sanitizeDisplayName } from '@/lib/company-mail'

const db = createFakeDb({
  orgs: [
    { id: 'arx', name: 'Original Co', email: 'info@original.test', original_brand: true },
    { id: 'p', name: 'Precision "Roofing"\r\nBcc: x@evil.test <a>', email: 'office@precision.test' },
    { id: 'q', name: 'No Email Co', email: 'not-an-email' },
    { id: 'demo', name: 'Demo Co', email: 'demo@demo.example.com' },
  ],
}).client
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db }))

import { getMailTransport } from '@/lib/setter-email'

const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'rs_1' }) }))
const env = { k: process.env.RESEND_API_KEY, d: process.env.COMPANY_MAIL_FROM_DOMAIN }
beforeEach(() => {
  sendMailSmtp.mockClear()
  fetchMock.mockClear()
  resetCompanyMailWarning()
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
