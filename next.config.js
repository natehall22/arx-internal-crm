/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Payroll is one screen now ("Pay this week"); the old pages were folded into it.
      { source: '/admin/payroll/periods', destination: '/admin/payroll', permanent: false },
      { source: '/admin/payroll/weekly', destination: '/admin/payroll', permanent: false },
      { source: '/admin/payroll/statements', destination: '/admin/payroll', permanent: false },
      { source: '/admin/payroll/:periodId/hours', destination: '/admin/payroll?period=:periodId', permanent: false },
    ]
  },
}

module.exports = nextConfig
