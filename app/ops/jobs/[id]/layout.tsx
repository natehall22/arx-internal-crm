import OpsJobAIContextLayout from './OpsJobAIContextLayout'

export default function OpsJobLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  return <OpsJobAIContextLayout jobId={params.id}>{children}</OpsJobAIContextLayout>
}
