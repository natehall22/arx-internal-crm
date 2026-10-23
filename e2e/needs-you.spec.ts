import { expect, test } from '@playwright/test'

/**
 * /whats-new is announcements only. The harness renders the real WhatsNewView for EVERY role group (setter, closer, ops,
 * owner, …) with the real screenshot table; none of them may show the "Needs you" box or its screenshot.
 */
test("What's new shows no Needs-you box for any role group", async ({ page }) => {
  await page.goto('/dev-harness/whats-new')
  await page.waitForSelector("text=What's new")
  const groups = await page.locator('[data-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))
  expect(groups).toEqual(expect.arrayContaining(['setter', 'closer', 'ops', 'owner']))
  for (const g of groups) {
    const section = page.locator(`[data-group="${g}"]`)
    await expect(section.locator('#needs-you-heading')).toHaveCount(0)
    await expect(section.getByRole('heading', { name: /needs you/i })).toHaveCount(0)
    expect(await section.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute('src')))).not.toContainEqual(expect.stringContaining('needs-you'))
  }
  // …and specifically the setter's page: announcement copy, no live work box, no screenshots of one.
  const setter = page.locator('[data-group="setter"]')
  await expect(setter.getByText('An example announcement line.')).toBeVisible()
  await expect(setter.getByText(/needs you/i)).toHaveCount(0)
})
