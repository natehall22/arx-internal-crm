import { expect, test, type Page } from '@playwright/test'

import { REPORT_TEMPLATES } from '../lib/reporting/templates'
import { ANNOUNCEMENTS, BANNER, COST_LINES, SUPPLIERS, PAYROLL_PERIODS, REPORT_RESULT, SALE_CREDIT, SUPPLIER_PREVIEW, SUPPLIER_VIEW, TEMPLATE_META, USERS } from './fixtures'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    const m = route.request().method()
    if (p.endsWith('/supplier-orders/preview')) return route.fulfill(json(SUPPLIER_PREVIEW))
    if (p.endsWith('/supplier-orders')) return route.fulfill(json(SUPPLIER_VIEW))
    if (p.endsWith('/cost-lines')) return route.fulfill(json(COST_LINES))
    if (p === '/api/reports/run') return route.fulfill(json(m === 'GET' ? TEMPLATE_META(REPORT_TEMPLATES.filter((t) => !t.finance || true)) : REPORT_RESULT))
    if (p === '/api/reports/saved') return route.fulfill(json({ reports: [{ id: 's1', name: 'Inspections Scheduled', spec: REPORT_TEMPLATES[0].spec, schedule: 'daily', created_by: 'u1' }], me: 'u1' }))
    if (p === '/api/announcements/active') return route.fulfill(json(BANNER))
    if (p === '/api/admin/announcements') return route.fulfill(json(ANNOUNCEMENTS))
    if (p === '/api/admin/suppliers') return route.fulfill(json(SUPPLIERS))
    if (p === '/api/admin/payroll/periods') return route.fulfill(json(PAYROLL_PERIODS))
    if (p.endsWith('/sale-credit')) return route.fulfill(json(SALE_CREDIT))
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
  { name: 'supplier-orders', path: '/dev-harness/supplier-orders', ready: 'text=Supplier orders',
    states: [{ name: 'preview-open', run: async (p) => { await p.getByRole('button', { name: /Review & send to ABC Supply/ }).click(); await p.waitForSelector('text=Send to ABC Supply') } }] },
  { name: 'reports-home', path: '/dev-harness/reports-home', ready: 'text=Performance at a glance' },
  { name: 'reports-explore', path: '/dev-harness/reports-explore', ready: 'text=Sales by closer',
    states: [
      { name: 'chart', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.waitForSelector('text=Nathan Hall') } },
      { name: 'table', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByRole('button', { name: 'Show table' }).click() } },
      { name: 'drill', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByText('Nathan Hall').first().click() } },
    ] },
  { name: 'payroll-periods', path: '/dev-harness/payroll-periods', ready: 'text=2026-W42' },
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
      if (el.closest('nav, header')) continue // shared site header, not part of these screens
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
