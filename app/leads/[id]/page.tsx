import LeadView from './LeadView'

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  return <LeadView params={params} />
}
