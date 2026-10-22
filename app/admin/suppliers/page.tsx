import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { canManageSuppliers } from '@/lib/supplier-admin'

import SuppliersClient from './SuppliersClient'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const { profile } = await requireAuth()
  if (!canManageSuppliers(profile)) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-xl p-6 text-[#2c2c2a]">
          <h1 className="text-xl font-bold">Suppliers</h1>
          <p className="mt-2">Only owners can manage suppliers.</p>
        </main>
      </>
    )
  }
  return (
    <>
      <Nav />
      <SuppliersClient />
    </>
  )
}
