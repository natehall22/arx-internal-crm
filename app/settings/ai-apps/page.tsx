import Nav from '@/components/Nav'
import ConnectedAiApps from '@/components/ai-connector/ConnectedAiApps'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AiAppsPage() {
  await requireAuth()
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <PageHeader title="Connected AI apps" subtitle="AI apps you have allowed to read the CRM as you." />
        <ConnectedAiApps />
      </main>
    </div>
  )
}
