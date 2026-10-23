import LeadView from './LeadView'
import { redirectLeadToFile } from '@/lib/customer-file/redirects'

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  await redirectLeadToFile(params.id)
  return <LeadView params={params} />
}
