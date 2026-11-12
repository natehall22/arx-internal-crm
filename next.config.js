/** @type {import('next').NextConfig} */
const payWeekOn = String(process.env.PAYROLL_PAY_WEEK_ENABLED || '').toLowerCase().trim() === 'true'

// Security headers (audit M3, 2026-11-07). No script CSP on purpose (Maps, PDFs, inline styles); framing is limited to
// our own origin because job sheets, supplier orders and signed contracts preview same-origin PDFs in an iframe.
const BASE_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
]
// Pages opened from a secret link (signing, customer report, crew photos): the token must never leave in a Referer
// header, and nothing may frame them (clickjacking a signature). Later entries override the base for the same key.
const TOKEN_PAGE_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]
const TOKEN_PAGE_SOURCES = [
  '/contracts/:path*', // /contracts/sign/<token>, /contracts/<token>, /contracts/<token>/rep
  '/change-orders/sign/:path*',
  '/comp-agreements/:path*', // sign/<token>, receipt/<token>
  '/r/:path*',
  '/crew/:path*',
  '/oauth/:path*', // AI connector consent screen: nothing may frame the Allow button
]

const nextConfig = {
  reactStrictMode: true,
  // unpdf (PDF text, signed-document import) is ESM-only and ships its own pdf.js: load it at run time instead of bundling it.
  experimental: { serverComponentsExternalPackages: ['unpdf'] },
  async headers() {
    return [
      { source: '/:path*', headers: BASE_SECURITY_HEADERS },
      // The canvass worker is registered at scope /canvass, narrower than its URL's directory (/), which the browser only allows with this header.
      { source: '/canvass-sw.js', headers: [{ key: 'Service-Worker-Allowed', value: '/canvass' }] },
      ...TOKEN_PAGE_SOURCES.map((source) => ({ source, headers: TOKEN_PAGE_HEADERS })),
    ]
  },
  async redirects() {
    return [
      // Payroll is one screen now ("Pay this week"); the old pages were folded into it. Only once PAYROLL_PAY_WEEK_ENABLED is on — until then the old pages stay.
      ...(payWeekOn ? [
        { source: '/admin/payroll/periods', destination: '/admin/payroll', permanent: false },
        { source: '/admin/payroll/weekly', destination: '/admin/payroll', permanent: false },
        { source: '/admin/payroll/statements', has: [{ type: 'query', key: 'period_id', value: '(?<pid>[0-9a-fA-F-]{36})' }], destination: '/admin/payroll?period=:pid', permanent: false },
        { source: '/admin/payroll/statements', destination: '/admin/payroll', permanent: false },
        { source: '/admin/payroll/:periodId/hours', destination: '/admin/payroll?period=:periodId', permanent: false },
      ] : []),
      // Bookmarks that were live on main (page stubs removed by the Settings/nav cleanup): one list, here, instead of a file each.
      { source: '/jobs', destination: '/ops', permanent: false },
      { source: '/jobs/:id', destination: '/projects/:id', permanent: false }, // the old id is a project id; /projects/:id lands on its file
      { source: '/ops/jobs/:id/material-order/print', destination: '/ops/jobs/:id/sheets', permanent: false },
      { source: '/ops/jobs/:id/run-sheet', destination: '/ops/jobs/:id/sheets', permanent: false },
      { source: '/admin/canvass-territories', destination: '/canvass?areas=1', permanent: false },
      { source: '/admin/incentives', destination: '/admin/sisu/incentives', permanent: false },
      { source: '/admin/sisu', destination: '/admin/sisu/incentives', permanent: false },
    ]
  },
}

module.exports = nextConfig
