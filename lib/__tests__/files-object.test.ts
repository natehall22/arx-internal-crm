import {
  classifyFilesPath,
  customerSignedDocPath,
  customerSignedDocUrl,
  fieldRoleMayReadFilesPath,
  filesDocHref,
  filesObjectHref,
  filesPathFromStoredUrl,
  isPlausibleSigningToken,
  isSafeFilesPath,
} from '@/lib/files/files-object'

const SB = 'https://anzqkklwcgaoeunzpqjh.supabase.co'
const ORG = '9089d4ad-f46c-405b-9798-6751d45a7051'
const pub = (path: string) => `${SB}/storage/v1/object/public/files/${path}`

describe('filesPathFromStoredUrl', () => {
  it('returns the path of a public files-bucket URL', () => {
    expect(filesPathFromStoredUrl(pub(`org/${ORG}/contracts/contract_1_2.pdf`), SB)).toBe(`org/${ORG}/contracts/contract_1_2.pdf`)
  })

  it('drops a cache-busting query (?t=) and a hash', () => {
    expect(filesPathFromStoredUrl(`${pub(`proposals/${ORG}/p1/property-1.jpg`)}?t=1730000000000`, SB)).toBe(
      `proposals/${ORG}/p1/property-1.jpg`
    )
    expect(filesPathFromStoredUrl(`${pub('a/b.png')}#x`, SB)).toBe('a/b.png')
    expect(filesPathFromStoredUrl('org/x/logo.png?t=5', SB)).toBe('org/x/logo.png')
  })

  it('handles the legacy change-orders/ prefix', () => {
    expect(filesPathFromStoredUrl(pub('change-orders/abc/CO_001_1.pdf'), SB)).toBe('change-orders/abc/CO_001_1.pdf')
  })

  it('decodes percent-encoded segments', () => {
    expect(filesPathFromStoredUrl(pub(`org/${ORG}/opportunities/o1/contracts/1_my%20contract.pdf`), SB)).toBe(
      `org/${ORG}/opportunities/o1/contracts/1_my contract.pdf`
    )
    expect(filesPathFromStoredUrl(pub('a/%E2%9C%93.pdf'), SB)).toBe('a/✓.pdf')
  })

  it('accepts signed and render URLs for the files bucket', () => {
    expect(filesPathFromStoredUrl(`${SB}/storage/v1/object/sign/files/a/b.pdf?token=xyz`, SB)).toBe('a/b.pdf')
    expect(filesPathFromStoredUrl(`${SB}/storage/v1/render/image/public/files/a/b.png?width=10`, SB)).toBe('a/b.png')
  })

  it('passes plain paths through', () => {
    expect(filesPathFromStoredUrl(`org/${ORG}/change-orders/p1/CO_1.pdf`, SB)).toBe(`org/${ORG}/change-orders/p1/CO_1.pdf`)
    expect(filesPathFromStoredUrl(`  ${ORG}/jobs/j1/job-packet-1.pdf  `, SB)).toBe(`${ORG}/jobs/j1/job-packet-1.pdf`)
  })

  it('returns null for other buckets, foreign hosts and non-storage URLs', () => {
    expect(filesPathFromStoredUrl(`${SB}/storage/v1/object/public/contracts/org/x/c.pdf`, SB)).toBeNull()
    expect(filesPathFromStoredUrl(`${SB}/storage/v1/object/public/job-files/x/c.pdf`, SB)).toBeNull()
    expect(filesPathFromStoredUrl('https://evil.example.com/storage/v1/object/public/files/a/b.pdf', SB)).toBeNull()
    expect(filesPathFromStoredUrl('https://other.supabase.co/storage/v1/object/public/files/a/b.pdf', SB)).toBeNull()
    expect(filesPathFromStoredUrl('https://maps.googleapis.com/maps/api/staticmap?center=x', SB)).toBeNull()
    expect(filesPathFromStoredUrl('data:image/png;base64,AAAA', SB)).toBeNull()
    expect(filesPathFromStoredUrl('/invoices/1/print', SB)).toBeNull()
    expect(filesPathFromStoredUrl('//evil.example.com/a.pdf', SB)).toBeNull()
  })

  it('falls back to any *.supabase.co host when the project URL is not configured', () => {
    expect(filesPathFromStoredUrl(pub('a/b.pdf'), '')).toBe('a/b.pdf')
    expect(filesPathFromStoredUrl('https://evil.example.com/storage/v1/object/public/files/a/b.pdf', '')).toBeNull()
  })

  it('rejects empty and unsafe input', () => {
    expect(filesPathFromStoredUrl(null, SB)).toBeNull()
    expect(filesPathFromStoredUrl('', SB)).toBeNull()
    expect(filesPathFromStoredUrl('   ', SB)).toBeNull()
    expect(filesPathFromStoredUrl('org/../secret.pdf', SB)).toBeNull()
    // The URL parser resolves encoded dot segments itself; what comes out is an ordinary in-bucket path (or another bucket → null).
    expect(filesPathFromStoredUrl(pub('org/%2E%2E/secret.pdf'), SB)).toBe('secret.pdf')
    expect(filesPathFromStoredUrl(pub('%2E%2E/contracts/c.pdf'), SB)).toBeNull()
    expect(filesPathFromStoredUrl(pub('org/a%2F..%2Fb.pdf'), SB)).toBeNull()
    expect(filesPathFromStoredUrl(pub('a/%E0%A4%A.pdf'), SB)).toBeNull() // malformed escape
    expect(filesPathFromStoredUrl('a//b.pdf', SB)).toBeNull()
    expect(filesPathFromStoredUrl('a\\b.pdf', SB)).toBeNull()
  })
})

describe('isSafeFilesPath', () => {
  it('allows ordinary nested paths and rejects dot segments', () => {
    expect(isSafeFilesPath('org/a/b.pdf')).toBe(true)
    expect(isSafeFilesPath('installation agreement.pdf')).toBe(true)
    expect(isSafeFilesPath('./a')).toBe(false)
    expect(isSafeFilesPath('a/')).toBe(false)
    expect(isSafeFilesPath('x'.repeat(1025))).toBe(false)
  })
})

describe('filesObjectHref / filesDocHref', () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  })
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD
  })

  it('builds an encoded same-origin route link', () => {
    expect(filesObjectHref(pub(`org/${ORG}/contracts/a b.pdf`))).toBe(
      `/api/files/object?path=${encodeURIComponent(`org/${ORG}/contracts/a b.pdf`)}`
    )
    expect(filesObjectHref('https://maps.googleapis.com/x')).toBeNull()
    expect(filesObjectHref(null)).toBeNull()
  })

  it('prefers the storage path and keeps non-files URLs unchanged', () => {
    expect(filesDocHref('org/x/change-orders/p/CO.pdf', pub('org/x/change-orders/p/OLD.pdf'))).toBe(
      `/api/files/object?path=${encodeURIComponent('org/x/change-orders/p/CO.pdf')}`
    )
    expect(filesDocHref(null, pub('org/x/contracts/c.pdf'))).toBe(`/api/files/object?path=${encodeURIComponent('org/x/contracts/c.pdf')}`)
    const contractsBucket = `${SB}/storage/v1/object/public/contracts/org/x/contracts/c.pdf`
    expect(filesDocHref('org/x/contracts/c.pdf', contractsBucket)).toBe(contractsBucket)
    expect(filesDocHref(null, null)).toBeNull()
  })
})

describe('classifyFilesPath + fieldRoleMayReadFilesPath', () => {
  it('classifies each part of the bucket', () => {
    expect(classifyFilesPath(`org/${ORG}/contracts/c.pdf`)).toMatchObject({ kind: 'org', orgId: ORG, area: 'contracts' })
    expect(classifyFilesPath(`proposals/${ORG}/p1/property-1.jpg`)).toEqual({ kind: 'proposal_image', orgId: ORG })
    expect(classifyFilesPath('change-orders/abc/CO.pdf')).toEqual({ kind: 'legacy_change_order' })
    expect(classifyFilesPath(`${ORG}/jobs/j1/job-packet-17.pdf`)).toEqual({ kind: 'job_packet', orgId: ORG, jobId: 'j1' })
    expect(classifyFilesPath('work-orders/wo1/work_done_1_0.jpg')).toEqual({ kind: 'work_order_photo' })
    expect(classifyFilesPath('c1d2/photo.jpg')).toEqual({ kind: 'other' })
    expect(classifyFilesPath('installation agreement.pdf')).toEqual({ kind: 'other' })
  })

  it('lets field roles read only non-money, non-production paths', () => {
    const may = (p: string) => fieldRoleMayReadFilesPath(classifyFilesPath(p))
    expect(may(`org/${ORG}/logo.png`)).toBe(true)
    expect(may(`proposals/${ORG}/p1/property-1.jpg`)).toBe(true)
    expect(may(`org/${ORG}/opportunities/o1/photo.jpg`)).toBe(true)
    expect(may(`org/${ORG}/opportunities/o1/contracts/1_c.pdf`)).toBe(false)
    expect(may(`org/${ORG}/opportunities/o1/design/1_d.pdf`)).toBe(false)
    expect(may(`org/${ORG}/contracts/c.pdf`)).toBe(false)
    expect(may(`org/${ORG}/contracts/audit/c.pdf`)).toBe(false)
    expect(may(`org/${ORG}/change-orders/p/CO.pdf`)).toBe(false)
    expect(may(`org/${ORG}/proposals/e1.pdf`)).toBe(false)
    expect(may(`org/${ORG}/projects/p1/file.pdf`)).toBe(false)
    expect(may('change-orders/abc/CO.pdf')).toBe(false)
    expect(may(`${ORG}/jobs/j1/job-packet-1.pdf`)).toBe(false)
    expect(may('work-orders/wo1/x.jpg')).toBe(false)
    expect(may('c1d2/photo.jpg')).toBe(false)
  })
})

describe('customer signed-document links', () => {
  it('checks token shape per kind', () => {
    expect(isPlausibleSigningToken('contract', '0b5d2485-9aba-4c1e-8f00-1234567890ab')).toBe(true)
    expect(isPlausibleSigningToken('contract', 'a'.repeat(64))).toBe(false)
    expect(isPlausibleSigningToken('change-order', 'ab'.repeat(32))).toBe(true)
    expect(isPlausibleSigningToken('change-order', '0b5d2485-9aba-4c1e-8f00-1234567890ab')).toBe(false)
    expect(isPlausibleSigningToken('change-order', `${'ab'.repeat(31)}'-`)).toBe(false)
  })

  it('builds relative and absolute links', () => {
    expect(customerSignedDocPath('contract', 'tok')).toBe('/api/files/signed/contract/tok')
    expect(customerSignedDocUrl('change-order', 'tok', 'https://crm.example.com/')).toBe(
      'https://crm.example.com/api/files/signed/change-order/tok'
    )
  })
})


describe('encoded traversal and unsafe characters', () => {
  const { isSafeFilesPath, filesPathFromStoredUrl, storageSafeFileName } = require('../files/files-object')
  it.each([
    'org/a/%2e%2e/%2e%2e/org/b/contracts/x.pdf',
    'org/a/.%2e/org/b/x.pdf',
    'org/a/%2E./org/b/x.pdf',
    'proposals/a/%2e%2e/%2e%2e/org/b/contracts/x.pdf',
    'org/a/x%2fy.pdf',
    'org/a/x%5cy.pdf',
  ])('refuses %s', (p: string) => {
    expect(isSafeFilesPath(p)).toBe(false)
    expect(filesPathFromStoredUrl(p, 'https://example.supabase.co')).toBeNull()
  })
  it.each(['org/a/x?y.pdf', 'org/a/x#y.pdf'])('refuses %s as a path to sign', (p: string) => {
    // A bare stored value drops its query/fragment (stored ?t= cache busters), but the path itself is never signable.
    expect(isSafeFilesPath(p)).toBe(false)
  })
  it('refuses a double-encoded traversal inside a stored public URL', () => {
    expect(
      filesPathFromStoredUrl(
        'https://example.supabase.co/storage/v1/object/public/files/org/a/%252e%252e/org/b/x.pdf',
        'https://example.supabase.co'
      )
    ).toBeNull()
  })
  it('makes upload names key-safe', () => {
    expect(storageSafeFileName('Smith 50% #2?.pdf')).toBe('Smith_50_2_.pdf')
    expect(storageSafeFileName('..secret')).toBe('_secret')
    expect(isSafeFilesPath(`org/a/projects/p/1-${storageSafeFileName('a b%c.pdf')}`)).toBe(true)
  })
})
