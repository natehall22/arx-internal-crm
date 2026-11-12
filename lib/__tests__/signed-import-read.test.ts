/** @jest-environment node */
/** Move signed documents — what the certificate text and the envelope list give us, and how files are grouped. */
import { dateOn, emailsIn, envelopeIdInName, readCertificateText } from '@/lib/signed-import/cert-text'
import { readEnvelopeIndex } from '@/lib/signed-import/envelope-index'
import { groupItems, stemOf, type ItemFacts } from '@/lib/signed-import/group'
import { parseCsv } from '@/lib/csv'

const CERT = `Certificate Of Completion
Envelope Id: 1A2B3C4D-1111-2222-3333-444455556666
Subject: Roof replacement agreement
Status: Completed
Envelope Originator: Pat Roofer
Sent: 3/4/2024 5:06:07 PM
Completed: 3/6/2024 9:12:44 AM
Signer Events
Jane Smith
jane.smith@example.com
Security Level: Email, Account Authentication
Powered by DocuSign`

describe('certificate text', () => {
  test('envelope id, signers, dates, provider, certificate', () => {
    const f = readCertificateText(CERT)
    expect(f).toMatchObject({ provider: 'docusign', envelopeId: '1A2B3C4D-1111-2222-3333-444455556666', completedOn: '2024-03-06', sentOn: '2024-03-04', notCompleted: false, isCertificate: true })
    expect(f.emails).toEqual(['jane.smith@example.com'])
    expect(f.names).toEqual(['Jane Smith'])
  })
  test('the tool’s own addresses are never signers', () => {
    expect(emailsIn('mail dse@docusign.net or noreply@x.com or jane@home.com')).toEqual(['jane@home.com'])
  })
  test('a signing that is not finished is flagged', () => {
    expect(readCertificateText('Certificate of Completion DocuSign\nStatus: Declined').notCompleted).toBe(true)
  })
  test('"Certificate of Completion" alone (a finished-job form) is not a signing certificate', () => {
    expect(readCertificateText('Certificate of Completion\nThe work at 12 Oak St was finished.').isCertificate).toBe(false)
  })
  test('dates: ISO, US order, day-first when the first number is over 12, month names; junk gives null', () => {
    expect(dateOn('2024-03-04')).toBe('2024-03-04')
    expect(dateOn('3/4/2024 5:06 PM')).toBe('2024-03-04')
    expect(dateOn('25/12/2023')).toBe('2023-12-25')
    expect(dateOn('Mar 4, 2024')).toBe('2024-03-04')
    expect(dateOn('4 March 2024')).toBe('2024-03-04')
    expect(dateOn('13/13/2024')).toBeNull()
    expect(dateOn('soon')).toBeNull()
  })
  test('envelope id in a file name', () => {
    expect(envelopeIdInName('Contract_1a2b3c4d-1111-2222-3333-444455556666.pdf')).toBe('1A2B3C4D-1111-2222-3333-444455556666')
    expect(envelopeIdInName('Contract.pdf')).toBeNull()
  })
  test('hostile text does not hang the readers', () => {
    const t0 = Date.now()
    readCertificateText('Envelope Id: ' + 'a'.repeat(50_000) + '\n' + 'x@'.repeat(20_000))
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

describe('envelope list', () => {
  const csv = (s: string) => readEnvelopeIndex(parseCsv(s))
  test('DocuSign-style headers', () => {
    const r = csv('Envelope Id,Subject,Status,Sent,Completed,Recipient Name,Recipient Email\n1A2B3C4D-1111-2222-3333-444455556666,Roof agreement,Completed,3/4/2024,3/6/2024,Jane Smith,jane@example.com\nE2,Gutter job,Declined,3/4/2024,,Bob Lee,bob@example.com\n')
    expect(r.recognized).toBe(true)
    expect(r.records[0]).toMatchObject({ envelopeId: '1A2B3C4D-1111-2222-3333-444455556666', subject: 'Roof agreement', completedOn: '2024-03-06', notCompleted: false })
    expect(r.records[0].signers).toEqual([{ name: 'Jane Smith', email: 'jane@example.com' }])
    expect(r.records[1].notCompleted).toBe(true)
  })
  test('several signers in one cell', () => {
    const r = csv('Document ID,Title,Signers\nabc123abc123,Deck,"jane@x.com; bob@x.com"\n')
    expect(r.records[0].signers.map((s) => s.email)).toEqual(['jane@x.com', 'bob@x.com'])
  })
  test('a file that is not a list of signed documents is refused with a plain message', () => {
    const r = csv('Color,Size\nred,L\n')
    expect(r.recognized).toBe(false)
    expect(r.message).toMatch(/doesn’t look like a list/)
  })
  test('spreadsheet-damaged cells do not throw', () => {
    expect(() => csv('Envelope Id,Recipient Email\n="1",=HYPERLINK("x")\n')).not.toThrow()
  })
})

const item = (over: Partial<ItemFacts> & { id: string; name: string }): ItemFacts => ({
  sha256: over.id.padEnd(64, '0'),
  dir: '',
  origin: 'files',
  isCertificate: null,
  envelopeId: null,
  emails: [],
  names: [],
  sentOn: null,
  completedOn: null,
  provider: null,
  notCompleted: false,
  ...over,
})

describe('grouping', () => {
  test('a certificate joins its agreement by envelope id from the text', () => {
    const g = groupItems([item({ id: 'a1', name: 'Roof.pdf', envelopeId: 'E1' }), item({ id: 'c1', name: 'Certificate.pdf', isCertificate: true, envelopeId: 'E1', emails: ['jane@x.com'] })], [])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ agreementIds: ['a1'], certificateIds: ['c1'], envelopeIdIsReal: true, key: 'env:e1' })
    expect(g[0].emails).toEqual(['jane@x.com'])
  })
  test('two different envelope ids are never joined, even in one folder', () => {
    const g = groupItems(
      [item({ id: 'a1', name: 'A.pdf', dir: 'Smith', envelopeId: 'E1' }), item({ id: 'c1', name: 'Certificate.pdf', dir: 'Smith', isCertificate: true, envelopeId: 'E2' })],
      []
    )
    expect(g).toHaveLength(2)
  })
  test('a ZIP folder with one certificate and one agreement is one envelope; a crowded folder is not guessed', () => {
    const one = groupItems([item({ id: 'a1', name: 'Contract.pdf', dir: 'Smith', origin: 'z' }), item({ id: 'c1', name: 'Certificate of Completion.pdf', dir: 'Smith', origin: 'z' })], [])
    expect(one).toHaveLength(1)
    const crowded = groupItems(
      [...Array.from({ length: 8 }, (_, i) => item({ id: `a${i}`, name: `Doc ${i}.pdf`, dir: 'All', origin: 'z' })), item({ id: 'c1', name: 'Certificate.pdf', dir: 'All', origin: 'z' })],
      []
    )
    expect(crowded).toHaveLength(9)
  })
  test('loose files pair by name apart from the certificate words', () => {
    expect(stemOf('Smith Roof - Certificate of Completion.pdf')).toBe(stemOf('Smith Roof.pdf'))
    const g = groupItems([item({ id: 'a1', name: 'Smith Roof.pdf' }), item({ id: 'c1', name: 'Smith Roof - Certificate of Completion.pdf' })], [])
    expect(g).toHaveLength(1)
    expect(g[0].certificateIds).toEqual(['c1'])
  })
  test('the envelope list adds signers, subject and dates; a declined row marks the group not completed; company emails are dropped', () => {
    const { records } = readEnvelopeIndex(parseCsv('Envelope Id,Subject,Status,Completed,Recipient Email\nENV-12345678,Roof agreement,Declined,3/6/2024,"jane@x.com; boss@ours.com"\n'))
    const g = groupItems([item({ id: 'a1', name: 'Roof_env-12345678_signed.pdf', envelopeId: null })], records, new Set(['boss@ours.com']))
    expect(g[0]).toMatchObject({ subject: 'Roof agreement', notCompleted: true, completedOn: '2024-03-06', emails: ['jane@x.com'] })
  })
  test('a file with nothing but a name is a group of one with a stand-in id (never a made-up envelope id)', () => {
    const g = groupItems([item({ id: 'a1', name: 'x.pdf' })], [])
    expect(g[0].envelopeIdIsReal).toBe(false)
    expect(g[0].envelopeId).toMatch(/^pair:/)
  })
})
