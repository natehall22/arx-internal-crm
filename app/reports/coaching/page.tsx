export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import CoachingClient from './CoachingClient'

const ALLOWED_ROLES = ['admin', 'sales_manager', 'setter_manager', 'regional_manager', 'rep', 'sales_rep', 'closer', 'canvasser', 'setter']

export default async function CoachingPage() {
  const { profile } = await requireAuth()

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect('/dashboard')
  }

  const isManager = ['admin', 'sales_manager', 'setter_manager', 'regional_manager'].includes(profile.role)

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <CoachingClient
        currentUserId={profile.id}
        currentUserName={profile.full_name || 'You'}
        currentUserRole={profile.role}
        isManager={isManager}
      />
    </div>
  )
}
