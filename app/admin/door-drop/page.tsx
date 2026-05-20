import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DoorDropClient from './DoorDropClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const ADMIN_TOOL_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

export default async function DoorDropPage() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !ADMIN_TOOL_ROLES.includes(profile.role)) redirect('/dashboard')

  return <DoorDropClient />
}
