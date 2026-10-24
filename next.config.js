/** @type {import('next').NextConfig} */
const payWeekOn = String(process.env.PAYROLL_PAY_WEEK_ENABLED || '').toLowerCase().trim() === 'true'

const nextConfig = {
  reactStrictMode: true,
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
