import Nav from '@/components/Nav'
import FileHeader from '@/components/customer-file/FileHeader'
import FileTabs from '@/components/customer-file/FileTabs'
import DesktopOnly from '@/components/customer-file/DesktopOnly'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import { loadFile } from '@/lib/customer-file/load'

export const dynamic = 'force-dynamic'

export default async function CustomerFileLayout({ children, params }: { children: React.ReactNode; params: { customerId: string; dealId: string } }) {
  const ctx = await loadFile(params.customerId, params.dealId)
  const base = `/c/${params.customerId}/d/${params.dealId}`
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <FileHeader ctx={ctx} />
      <div className="sticky top-0 z-10">
        <FileTabs base={base} tabs={ctx.tabs} />
      </div>
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <main className="min-w-0">{children}</main>
        <aside className="hidden lg:block">
          <div className="sticky top-16">
            <DesktopOnly>
              <ThreadPanel customerId={params.customerId} dealId={params.dealId} />
            </DesktopOnly>
          </div>
        </aside>
      </div>
    </div>
  )
}
