/** @jest-environment node */
/**
 * Customer account page (/customers/[id]) Files tab: field roles — including base role rep + a custom role named "Canvasser"
 * — get no Files tab and no file query at all, even with customers:view. A closer still gets the tab and their own files.
 */
import { renderToStaticMarkup } from 'react-dom/server'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = '9089d4ad-f46c-405b-9798-6751d45a7051'
const CUST = 'c0000000-0000-4000-8000-000000000001'

let profile: Record<string, unknown> = {}
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn(async () => ({ profile, authUser: { id: profile.id } })) }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
jest.mock('@/components/Nav', () => () => null)
jest.mock('@/components/ReferralsSection', () => () => null)
jest.mock('@/components/customers/CustomerInfoCard', () => () => null)
jest.mock('@/components/customers/CustomerFilesUpload', () => () => <div>ADD-FILES-BOX</div>)
jest.mock('@/lib/effective-permissions', () => ({
  resolveEffectivePermissionNames: jest.fn(async () => ({ fullAccess: false, permissionNames: new Set<string>(['customers:view']) })),
}))
jest.mock('@/lib/ops-access', () => ({
  resolveOpsAccess: jest.fn(async () => ({ canJobBoard: false, canEditJobs: false, canViewJobFinancials: false })),
}))

let db: ReturnType<typeof createFakeDb>
const fileQueries: string[] = []
const client = () => ({
  from: (t: string) => {
    if (t === 'files') fileQueries.push(t)
    return (db.client as any).from(t)
  },
  rpc: (n: string, a: Record<string, unknown>) => (db.client as any).rpc(n, a),
})
jest.mock('@/lib/supabase/server', () => ({ createClient: () => client() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client() }))

import CustomerDetailPage from '@/app/customers/[id]/page'

beforeEach(() => {
  fileQueries.length = 0
  db = createFakeDb({
    customers: [{ id: CUST, org_id: ORG, name: 'Ashley Gaines' }],
    projects: [{ id: 'b1000000-0000-4000-8000-000000000001', org_id: ORG, customer_id: CUST, owner_user_id: 'u-rep', opportunity_id: null, lead_id: null, production_jobs: [] }],
    opportunities: [],
    leads: [],
    activities: [],
    scheduled_appointments: [],
    permission_denials: [],
    custom_roles: [{ id: 'cr-canvasser', name: 'Canvasser', display_name: 'Canvasser' }],
    files: [{ id: 'f1', org_id: ORG, customer_id: CUST, opportunity_id: null, project_id: null, lead_id: null, job_id: null, file_name: 'w9.pdf', tag: 'document', storage_path: `org/${ORG}/customers/${CUST}/f1_w9.pdf`, created_at: '2026-11-01' }],
  })
})

async function render(tab: string) {
  const el = await CustomerDetailPage({ params: { id: CUST }, searchParams: { tab } })
  return renderToStaticMarkup(el)
}

describe('customer account page: field roles get no Files tab', () => {
  it.each([
    ['setter', { role: 'setter', custom_role_id: null }],
    ['canvasser', { role: 'canvasser', custom_role_id: null }],
    ['rep + custom role "Canvasser"', { role: 'rep', custom_role_id: 'cr-canvasser' }],
  ])('%s with customers:view: no Files tab link, no file list, no file query', async (_n, p) => {
    profile = { id: 'u-rep', org_id: ORG, ...p }
    const html = await render('files')
    expect(html).not.toContain('?tab=files')
    expect(html).not.toContain('w9.pdf')
    expect(html).not.toContain('ADD-FILES-BOX')
    expect(fileQueries).toEqual([])
  })

  it('a plain closer on their own customer keeps the tab, the list and the add box', async () => {
    profile = { id: 'u-rep', org_id: ORG, role: 'rep', custom_role_id: null }
    const html = await render('files')
    expect(html).toContain('?tab=files')
    expect(html).toContain('w9.pdf')
    expect(html).toContain('ADD-FILES-BOX')
  })
})
