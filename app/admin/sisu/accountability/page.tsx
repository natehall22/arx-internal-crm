import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { createClient } from '@/lib/supabase/server'
import AccountabilityClient from './AccountabilityClient'

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

export default async function AccountabilityPage() {
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
    <div className="min-h-screen bg-slate-950">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-indigo-300 hover:text-indigo-100 text-sm font-medium"
          >
            ← Back to Admin
          </Link>
        </div>
        <AccountabilityClient />
      </div>
    </div>
  )
}
