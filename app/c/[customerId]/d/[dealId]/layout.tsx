import Nav from '@/components/Nav'
import FileHeader from '@/components/customer-file/FileHeader'
import FileTabs from '@/components/customer-file/FileTabs'
import DesktopOnly from '@/components/customer-file/DesktopOnly'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import { requireAuth } from '@/lib/auth'
import { customerAccessFor } from '@/lib/customer-file/customer-access'
import { loadFile } from '@/lib/customer-file/load'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { canSendDocuments } from '@/lib/signing/access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function CustomerFileLayout({ children, params }: { children: React.ReactNode; params: { customerId: string; dealId: string } }) {
  const ctx = await loadFile(params.customerId, params.dealId)
  const admin = createServiceClient()
  const { authUser, profile } = await requireAuth()
  const canSendForSignature = !(await resolveSalesDocAccessBarred(admin, authUser.id, profile)) && (await canSendDocuments(admin, { id: authUser.id, role: profile.role, custom_role_id: profile.custom_role_id }))
  // Same rule as PATCH /api/customers/[id]: customer-edit permission (reps: own deal only — canEditCategory), and never a field role.
  const canEditCustomer = ctx.canEditCategory && customerAccessFor(ctx.viewer, true).edit
  const base = `/c/${params.customerId}/d/${params.dealId}`
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <FileHeader ctx={ctx} canSendForSignature={canSendForSignature} canEditCustomer={canEditCustomer} />
      <div className="sticky top-0 z-10">
        <FileTabs base={base} tabs={ctx.tabs} labels={ctx.tabLabels} />
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
