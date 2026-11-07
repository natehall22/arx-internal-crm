/** @jest-environment node */
/** next.config.js headers() — security audit M3. Next applies matching entries in order; a later one wins per key. */
const nextConfig = require('../../next.config.js') as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> }

type Entry = Awaited<ReturnType<typeof nextConfig.headers>>[number]
const asMap = (e: Entry) => Object.fromEntries(e.headers.map((h) => [h.key, h.value]))

test('every page gets nosniff, a referrer policy and same-origin-only framing', async () => {
  const entries = await nextConfig.headers()
  const base = entries[0]
  expect(base.source).toBe('/:path*')
  expect(asMap(base)).toEqual(
    expect.objectContaining({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    })
  )
  // No script CSP: Maps and PDF previews depend on it being absent.
  expect(asMap(base)['Content-Security-Policy']).not.toMatch(/script-src|default-src/)
})

test('secret-link pages send no referrer and cannot be framed, after the base entry', async () => {
  const entries = await nextConfig.headers()
  for (const source of ['/contracts/:path*', '/change-orders/sign/:path*', '/comp-agreements/:path*', '/r/:path*', '/crew/:path*']) {
    const i = entries.findIndex((e) => e.source === source)
    expect(i).toBeGreaterThan(0)
    expect(asMap(entries[i])).toEqual(
      expect.objectContaining({
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      })
    )
  }
})
