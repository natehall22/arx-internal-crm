import { requireAuth } from '@/lib/auth'

import SuppliersClient from './SuppliersClient'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  await requireAuth()
  return <SuppliersClient />
}
