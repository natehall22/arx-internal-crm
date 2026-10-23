import { expect, test } from '@playwright/test'

// Desktop layout of the app shell: fixed sidebar, content pushed right, no sideways scroll.
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })

test('desktop sidebar', async ({ page }, info) => {
  await page.route('http://127.0.0.1:9/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/me/effective-permissions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner', fullAccess: true, permissions: [] }) }))
  await page.route('**/api/**', (r) => (r.request().url().includes('effective-permissions') ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })))
  await page.goto('/dev-harness/nav')
  await page.waitForSelector('text=Page content')
  const side = page.locator('aside[aria-label="Main"]')
  await expect(side).toBeVisible()
  for (const label of ['Today', 'Pipeline', 'Jobs', 'Customers', 'Money', 'Insights']) await expect(side.getByRole('link', { name: label, exact: true })).toBeVisible()
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, pad: parseFloat(getComputedStyle(document.body).paddingLeft) }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner)
  expect(widths.pad).toBe(240)
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-desktop-shell.png` })
})

test('pay this week on desktop', async ({ page }, info) => {
  const { PAY_WEEK } = await import('./fixtures')
  await page.route('http://127.0.0.1:9/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/admin/payroll/pay-week', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAY_WEEK) }))
  await page.goto('/dev-harness/pay-week')
  await page.waitForSelector('text=Needs you (3)')
  await page.getByRole('button', { name: /Jordan Vale/ }).click()
  await page.getByRole('button', { name: /^Approve/ }).waitFor()
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner)
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-desktop-pay-week.png` })
})
