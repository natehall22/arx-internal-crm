import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import AdminIncentivesClient from './AdminIncentivesClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

export default async function AdminIncentivesPage() {
  const supabase = createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role)) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Admin
          </Link>
        </div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Sisu</h1>
          <p className="text-gray-500 mt-1">
            Manage Heats, Sisu cycles, and achievement badges
          </p>
        </div>
        <AdminIncentivesClient currentUserId={user.id} />
      </div>
    </div>
  )
}
