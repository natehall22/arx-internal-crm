import ApproveLinkClient from '@/components/payroll/ApproveLinkClient'

export const dynamic = 'force-dynamic'

export default function ApproveLinkPage({ params }: { params: { token: string } }) {
  return <ApproveLinkClient token={params.token} />
}
