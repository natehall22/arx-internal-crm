import { redirect } from 'next/navigation'

export default function JobDetailPage({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/projects/${params.id}`)
}
