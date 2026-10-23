import { expect, test, type Page } from '@playwright/test'

import { REPORT_TEMPLATES } from '../lib/reporting/templates'
import { ANNOUNCEMENTS, BANNER, DEFAULT_PLANS, COST_LINES, SUPPLIERS, PAY_WEEK, REPORT_RESULT, SALE_CREDIT, SUPPLIER_PREVIEW, SUPPLIER_VIEW, TEMPLATE_META, USERS } from './fixtures'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockApi(page: Page) {
  await page.route('**/api/me/effective-permissions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner', fullAccess: true, permissions: [] }) }))
  // Any direct Supabase call from a component (browser client) gets an empty answer.
  await page.route('http://127.0.0.1:9/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    const m = route.request().method()
    if (/\/api\/ops\/jobs\/[^/]+\/payments$/.test(p)) return route.fulfill(json({ payments: [{ id: 'pay1', job_id: 'job-1', paid_at: '2026-10-10', amount_cents: 1632500, payment_type: 'final', method: 'financing', payer: 'financing', note: null, created_at: '2026-10-10T12:00:00Z', created_by: 'u1', funding_status: 'cleared' }], collected_cents: 1632500, collected_dollars: 16325, sale_amount_cents: 1632500, sale_amount_dollars: 16325, remaining_cents: 0, remaining_dollars: 0, payment_count: 1, paid_in_full: true, paid_by_payments: true }))
    if (/\/api\/ops\/jobs\/[^/]+\/notes$/.test(p)) return route.fulfill(json({ notes: [{ id: 'n1', note: 'Customer asked for the crew to park on the street, not the driveway. @Stevo Potts please confirm the dumpster drop.', is_internal: true, created_at: '2026-10-11T14:00:00Z', user: { full_name: 'Nathan Hall' } }] }))
    if (/\/api\/ops\/jobs\/[^/]+\/trades$/.test(p)) return route.fulfill(json({ trades: [] }))
    if (p.endsWith('/supplier-orders/preview')) return route.fulfill(json(SUPPLIER_PREVIEW))
    if (p.endsWith('/supplier-orders')) return route.fulfill(json(SUPPLIER_VIEW))
    if (p.endsWith('/cost-lines')) return route.fulfill(json(COST_LINES))
    if (p === '/api/reports/run') return route.fulfill(json(m === 'GET' ? TEMPLATE_META(REPORT_TEMPLATES.filter((t) => !t.finance || true)) : REPORT_RESULT))
    if (p === '/api/reports/saved') return route.fulfill(json({ reports: [{ id: 's1', name: 'Inspections Scheduled', spec: REPORT_TEMPLATES[0].spec, schedule: 'daily', created_by: 'u1' }], me: 'u1' }))
    if (p === '/api/announcements/active') return route.fulfill(json(BANNER))
    if (p === '/api/admin/announcements') return route.fulfill(json(ANNOUNCEMENTS))
    if (p === '/api/admin/suppliers') return route.fulfill(json(SUPPLIERS))
    if (p === '/api/admin/payroll/pay-week') return route.fulfill(json(PAY_WEEK))
    if (p.endsWith('/sale-credit')) return route.fulfill(json(SALE_CREDIT))
    if (p === '/api/referral-partners/summary') return route.fulfill(json({ assigned_count: 9, opening_soon: [{ id: 'rp1', name: 'Concord Realty Group', days_until_open: 3 }], opening_soon_count: 1, jobs_this_month: 2 }))
    if (p === '/api/admin/comp-plans/defaults') return route.fulfill(json(DEFAULT_PLANS))
    if (p === '/api/users') return route.fulfill(json(USERS))
    if (p.includes('/effective-permissions')) return route.fulfill(json({ permissions: [], fullAccess: true }))
    return route.fulfill(json({}))
  })
}

type Screen = { name: string; path: string; ready: string; states?: Array<{ name: string; run: (page: Page) => Promise<void> }> }

const SCREENS: Screen[] = [
  { name: 'force-paid-dialog', path: '/dev-harness/force-paid', ready: 'textarea, input' },
  { name: 'sale-credit-confirm', path: '/dev-harness/sale-credit', ready: 'text=Send Agreement',
    states: [{ name: 'credit-step', run: async (p) => {
      for (let i = 0; i < 3; i++) {
        if (await p.getByText('Sale credit', { exact: true }).first().isVisible().catch(() => false)) break
        await p.getByRole('button', { name: 'Next' }).click()
        await p.waitForTimeout(250)
      }
      await p.waitForSelector('text=Sale credit')
    } }] },
  { name: 'needs-you', path: '/dev-harness/needs-you', ready: 'text=Needs you' },
  { name: 'job-documents-banner', path: '/dev-harness/job-documents', ready: 'text=Job documents' },
  { name: 'pay-banners', path: '/dev-harness/pay-banners', ready: 'text=Mark' },
  { name: 'suppliers-admin', path: '/dev-harness/suppliers-admin', ready: 'text=Suppliers',
    states: [{ name: 'edit', run: async (p) => { await p.getByRole('button', { name: /Edit ABC Supply/ }).click(); await p.waitForSelector('text=Edit supplier') } }] },
  { name: 'announcement-banner', path: '/dev-harness/announcement-banner', ready: 'text=See what',
    states: [{ name: 'size', run: async (p) => {
      const box = await p.getByRole('region', { name: "What's new" }).boundingBox()
      const main = await p.getByRole('button', { name: 'Page main action' }).boundingBox()
      const vp = p.viewportSize()!
      // banner text clamps to two lines on phones (~44-70px tall) and never covers the page's main action
      if (!box || box.height > 96) throw new Error(`banner too tall on a phone: ${box?.height}px`)
      if (box.width > vp.width) throw new Error('banner wider than the screen')
      if (!main || main.y < box.y + box.height - 1) throw new Error('banner overlaps the page main action')
    } }] },
  { name: 'announcements-admin', path: '/dev-harness/announcements-admin', ready: 'text=Announcements',
    states: [{ name: 'edit', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).click(); await p.waitForSelector('text=Edit announcement') } }] },
  { name: 'materials-cost-entry', path: '/dev-harness/materials-costs', ready: 'text=Total job costs',
    states: [{ name: 'add-cost-open', run: async (p) => { await p.getByRole('button', { name: /Job Cost/i }).first().click(); await p.waitForTimeout(300) } }] },
  { name: 'contract-signing', path: '/dev-harness/contract-signing', ready: 'text=Pat Customer' },
  { name: 'change-order-signing', path: '/dev-harness/change-order-signing', ready: 'text=CO-1' },
  { name: 'crew-photo-capture', path: '/dev-harness/crew-capture', ready: 'text=Front of house' },
  { name: 'payroll-attribution', path: '/dev-harness/payroll-attribution', ready: 'text=Payroll attribution' },
  { name: 'ops-board', path: '/dev-harness/ops-board', ready: 'text=26-0041',
    states: [{ name: 'board-view', run: async (p) => { await p.getByRole('button', { name: 'Board', exact: true }).click(); await p.waitForTimeout(300) } }] },
  { name: 'job-page', path: '/dev-harness/job-page', ready: 'text=26-0042',
    states: ['Details', 'Materials', 'Financials', 'Photos & files', 'Notes'].map((tab) => ({
      name: `tab-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      run: async (p: Page) => { await p.getByRole('button', { name: tab, exact: true }).click(); await p.waitForTimeout(500) },
    })) },
  { name: 'supplier-orders', path: '/dev-harness/supplier-orders', ready: 'text=Supplier orders',
    states: [{ name: 'preview-open', run: async (p) => { await p.getByRole('button', { name: /Review & send to ABC Supply/ }).click(); await p.waitForSelector('text=Send to ABC Supply') } }] },
  { name: 'reports-home', path: '/dev-harness/reports-home', ready: 'text=Performance at a glance' },
  { name: 'reports-explore', path: '/dev-harness/reports-explore', ready: 'text=Sales by closer',
    states: [
      { name: 'chart', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.waitForSelector('text=Nathan Hall') } },
      { name: 'table', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByRole('button', { name: 'Show table' }).click() } },
      { name: 'drill', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByText('Nathan Hall').first().click() } },
    ] },
  { name: 'job-sheets-editor', path: '/dev-harness/job-sheets', ready: 'text=Scope of work',
    states: [{ name: 'editing', run: async (p) => { await p.locator('textarea').first().click(); await p.locator('textarea').first().fill('Edited scope for the crew.'); await p.waitForTimeout(200) } }] },
  { name: 'dashboard-tiles', path: '/dev-harness/dashboard', ready: 'text=Doors' },
  { name: 'nav-shell', path: '/dev-harness/nav', ready: 'text=Page content',
    states: [{ name: 'search-open', run: async (p) => { await p.route('**/api/search**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ kind: 'customer', id: 'c1', title: 'ASHLEY GAINES', subtitle: '1001 LYERLY RIDGE RD NW, CONCORD NC 28027 · (704)707-6274', href: '#' }, { kind: 'proposal', id: 'p1', title: 'ASHLEY P GAINES · #P-00118', subtitle: '(704)707-6274 · accepted', href: '#' }, { kind: 'job', id: 'j1', title: 'Job 26-0026', subtitle: '1001 LYERLY RIDGE RD NW · complete', href: '#' }] }) }));
      await p.getByRole('button', { name: 'Search' }).first().click(); await p.getByRole('combobox', { name: 'Search' }).fill('gaienes'); await p.waitForSelector('text=ASHLEY GAINES') } }, { name: 'more-open', run: async (p) => { await p.getByRole('button', { name: 'More' }).click(); await p.waitForSelector('[role=dialog] >> text=Logout') } }] },
  { name: 'settings-hub', path: '/dev-harness/settings-hub', ready: 'text=People & access',
    states: [{ name: 'searching', run: async (p) => { await p.getByRole('searchbox').fill('commission'); await p.waitForTimeout(200) } }] },
  { name: 'today-queues', path: '/dev-harness/today', ready: 'text=Proposals waiting for a signature' },
  { name: 'ui-kit', path: '/dev-harness/ui-kit', ready: 'text=Pay this week',
    states: [{ name: 'sheet-open', run: async (p) => { await p.getByRole('button', { name: 'Open sheet' }).click(); await p.waitForSelector('text=Save this view') } }] },
  { name: 'default-plans-card', path: '/dev-harness/default-plans', ready: 'text=Default pay plan by role' },
  { name: 'pay-week', path: '/dev-harness/pay-week', ready: 'text=Needs you (3)',
    states: [
      { name: 'person-open', run: async (p) => { await p.getByRole('button', { name: /Jordan Vale/ }).click(); await p.waitForSelector('text=Change') } },
      { name: 'by-job', run: async (p) => { await p.getByRole('tab', { name: /By job/ }).click(); await p.waitForSelector('text=Job 26-0141') } },
      { name: 'approve-sheet', run: async (p) => { await p.getByRole('button', { name: /^Approve/ }).click(); await p.waitForSelector('text=Email each person their statement') } },
    ] },
]

/** Interactive elements a thumb has to hit. Inline text links inside a sentence are exempt. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = []
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button]'))
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.tagName === 'A' && el.closest('p, li > span, td')) continue
      if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) continue
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
}

async function smallInputText(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea'))
      .filter((el) => el.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('type') || ''} ${getComputedStyle(el).fontSize}`)
  )
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    const variants = [{ name: 'default', run: async () => {} }, ...(screen.states ?? [])]
    for (const v of variants) {
      test(`${screen.name} / ${v.name}`, async ({ page }, info) => {
        await mockApi(page)
        await page.goto(screen.path)
        await page.waitForSelector(screen.ready, { timeout: 30_000 })
        await v.run(page)
        await page.waitForTimeout(300)

        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, inner: window.innerWidth }))
        await page.screenshot({ path: `e2e/screenshots/${info.project.name}-${screen.name}-${v.name}.png`, fullPage: true })
        if (widths.scroll > widths.inner) {
          const culprits = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth
            const out: string[] = []
            document.querySelectorAll('body *').forEach((el) => {
              const r = (el as HTMLElement).getBoundingClientRect()
              if (r.right <= vw + 1 || r.width === 0) return
              let p = el.parentElement
              while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return; p = p.parentElement }
              out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(r.right)}`)
            })
            return out.slice(0, 6)
          })
          console.log(`OVERFLOW ${info.project.name} ${screen.name}/${v.name}:\n  ${culprits.join('\n  ')}`)
        }
        const small = await smallTargets(page)
        const smallText = await smallInputText(page)
        if (process.env.REPORT) {
          console.log(`REPORT ${info.project.name} ${screen.name}/${v.name} scroll=${widths.scroll}/${widths.inner} small=${small.length} text=${smallText.length}\n  ${Array.from(new Set([...small.slice(0, 12), ...smallText.slice(0, 6)])).join('\n  ')}`)
          return
        }
        expect(widths.scroll, `page scrolls sideways: scrollWidth ${widths.scroll} > viewport ${widths.inner}`).toBeLessThanOrEqual(widths.inner)
        expect(small, `tap targets under 44px:\n${small.join('\n')}`).toEqual([])
        expect(smallText, `inputs under 16px (iOS zooms on focus):\n${smallText.join('\n')}`).toEqual([])
      })
    }
  })
}
