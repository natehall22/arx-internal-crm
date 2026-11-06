/** @jest-environment node */
/**
 * Job catch-up rollout guard: with the org setting OFF the Production Board and both job-page bodies render
 * byte-for-byte what they rendered before catch-up existed. The snapshots in __snapshots__/ were recorded from
 * origin/main 18f45b84 (before this feature) and must not change while catch-up is off.
 */
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/ops',
  useSearchParams: () => new URLSearchParams(),
  notFound: jest.fn(),
  redirect: jest.fn(),
}))

import OpsClient from '@/app/ops/OpsClient'
import JobDetailClient from '@/app/ops/jobs/[id]/JobDetailClient'
import { HARNESS_JOB, HARNESS_JOB_0037, HARNESS_OPS_JOBS } from '@/e2e/fixtures'

beforeAll(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-11-06T15:00:00Z'))
})
afterAll(() => jest.useRealTimers())

const jobProps = {
  paymentMethod: 'finance',
  userRole: 'admin',
  canViewReportFinancials: true,
  canViewProfitability: true,
  canDeleteProductionJob: false,
  canViewJobBilling: true,
  canEditPayrollAttribution: true,
  canEditFinancialSource: false,
  isSuperAdmin: true,
  financialSourceProposalOptions: [],
  changeOrdersSection: null,
}

describe('catch-up OFF renders exactly as before', () => {
  it('Production Board', () => {
    const html = renderToStaticMarkup(<OpsClient initialJobs={HARNESS_OPS_JOBS as never} orgId="org-1" canViewProfitability />)
    expect(html).toMatchSnapshot()
    expect(renderToStaticMarkup(<OpsClient initialJobs={HARNESS_OPS_JOBS as never} orgId="org-1" canViewProfitability catchUp={undefined} />)).toBe(html)
    expect(html).not.toContain('catch-up')
  })

  it('job page, current body', () => {
    const html = renderToStaticMarkup(<JobDetailClient initialJob={HARNESS_JOB as never} {...jobProps} />)
    expect(html).toMatchSnapshot()
    expect(renderToStaticMarkup(<JobDetailClient initialJob={HARNESS_JOB as never} {...jobProps} catchUp={null} />)).toBe(html)
  })

  it('job page, five-tab body (v2)', () => {
    const html = renderToStaticMarkup(<JobDetailClient v2 canEditJobs initialJob={HARNESS_JOB_0037 as never} {...jobProps} />)
    expect(html).toMatchSnapshot()
    expect(renderToStaticMarkup(<JobDetailClient v2 canEditJobs initialJob={HARNESS_JOB_0037 as never} {...jobProps} catchUp={null} />)).toBe(html)
  })
})

const CATCH_UP = {
  jobId: 'job-1', threadHref: '/c/c1/d/o1/notes', stage: 'Sold', nextStep: 'Waiting on permit', owner: 'Steve', ownerKind: 'assigned' as const, ownerUserId: 'u-steve',
  lastUpdate: { at: '2026-11-04T14:00:00Z', what: 'Permit office says Monday.', who: 'Steve Potts', kind: 'note' as const },
  ageDays: 2, idleWorkingDays: 2, ageLabel: '2d', stuck: true, reasons: ["Crew starts 2026-11-08 and the permit isn't approved yet."],
  line: 'Steve · Waiting on permit · 2d', lastContact: null, contactIsNote: false,
  recent: [{ at: '2026-11-04T14:00:00Z', what: 'Permit office says Monday.', who: 'Steve Potts', kind: 'note' as const }], done: false,
}

describe('catch-up ON', () => {
  it('board cards carry the one line, amber when stuck', () => {
    const jobs = HARNESS_OPS_JOBS.map((j, i) => (i === 0 ? { ...j, catch_up: CATCH_UP } : j))
    const html = renderToStaticMarkup(<OpsClient initialJobs={jobs as never} orgId="org-1" canViewProfitability catchUp={{ enabled: true, stuckDays: 7 }} />)
    expect(html).toContain('Steve · Waiting on permit · 2d')
    expect(html).toContain('data-stuck="true"')
    expect(html.match(/data-testid="catch-up-line"/g)).toHaveLength(1)
  })

  it('both job bodies show "Where this stands" at the top, with no dollar amounts from it', () => {
    for (const v2 of [false, true]) {
      const html = renderToStaticMarkup(<JobDetailClient v2={v2} initialJob={(v2 ? HARNESS_JOB_0037 : HARNESS_JOB) as never} {...jobProps} catchUp={CATCH_UP} />)
      const start = html.indexOf('data-testid="catch-up-box"')
      const box = html.slice(start, html.indexOf('</section>', start))
      expect(box).toContain('Where this stands')
      expect(box).toContain('Waiting on permit')
      expect(box).toContain('Stuck — why')
      expect(box).toContain('href="/c/c1/d/o1/notes"')
      expect(box).not.toMatch(/\$/)
    }
  })
})

describe('owner banner + board "No owner" (catch-up on only)', () => {
  const NO_OWNER = { ...CATCH_UP, owner: 'No owner', ownerKind: 'unassigned' as const, ownerUserId: null, line: 'No owner · Waiting on permit · 2d' }
  const UNKNOWN = { ...CATCH_UP, owner: '', ownerKind: 'unknown' as const, ownerUserId: null, line: 'Waiting on permit · 2d' }
  const page = (catchUp: unknown, v2: boolean, canEditJobs: boolean) =>
    renderToStaticMarkup(<JobDetailClient v2={v2} canEditJobs={canEditJobs} initialJob={(v2 ? HARNESS_JOB_0037 : HARNESS_JOB) as never} {...jobProps} catchUp={catchUp as never} />)

  it('no owner → red banner at the very top of both bodies, before the back link and the job identity', () => {
    for (const v2 of [false, true]) {
      const html = page(NO_OWNER, v2, true)
      const banner = html.indexOf('data-testid="no-owner-banner"')
      expect(banner).toBeGreaterThan(-1)
      expect(banner).toBeLessThan(html.indexOf('Back to Production Board'))
      expect(banner).toBeLessThan(html.indexOf('data-testid="catch-up-box"'))
      expect(html).toContain('No owner — assign one')
      expect(html).toMatch(/data-testid="no-owner-banner"[^>]*class="[^"]*bg-red-800[^"]*text-white/)
    }
  })

  it('picker only for people who can edit jobs; others see the banner without it', () => {
    const editor = page(NO_OWNER, false, true)
    const bannerOf = (html: string) => html.slice(html.indexOf('data-testid="no-owner-banner"'), html.indexOf('data-testid="catch-up-box"'))
    expect(bannerOf(editor)).toContain('data-testid="owner-select"')
    const viewer = page(NO_OWNER, false, false)
    expect(bannerOf(viewer)).toContain('No owner — assign one')
    expect(bannerOf(viewer)).not.toContain('owner-select')
    expect(viewer).not.toContain('data-testid="owner-select"')
  })

  it('owner set → no banner; owner column missing (migration not applied) → no banner, no "No owner"', () => {
    expect(page(CATCH_UP, false, true)).not.toContain('no-owner-banner')
    const unknown = page(UNKNOWN, true, true)
    expect(unknown).not.toContain('no-owner-banner')
    expect(unknown).not.toContain('No owner')
  })

  it('board: "No owner" in red where the owner would be; nothing when the owner is unknown', () => {
    const board = (cu: unknown) => renderToStaticMarkup(<OpsClient initialJobs={HARNESS_OPS_JOBS.map((j, i) => (i === 0 ? { ...j, catch_up: cu } : j)) as never} orgId="org-1" canViewProfitability catchUp={{ enabled: true, stuckDays: 7, viewerId: 'u1' }} />)
    expect(board(NO_OWNER)).toMatch(/data-testid="catch-up-no-owner" class="[^"]*text-red-800[^"]*">No owner<\/span> · Waiting on permit · 2d/)
    expect(board(UNKNOWN)).not.toContain('catch-up-no-owner')
  })
})
