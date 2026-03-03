export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import NewWorkOrderClient from './NewWorkOrderClient'

interface PageProps {
  searchParams?: {
    customer?: string
    customer_id?: string
    project?: string
    project_id?: string
    job_id?: string
    address?: string
  }
}

export default async function NewWorkOrderPage({ searchParams }: PageProps) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const [customersRes, projectsRes, usersRes, subsRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, address_text')
      .eq('org_id', profile.org_id)
      .order('name'),
    supabase
      .from('projects')
      .select('id, address_text, customer_id, customers(name)')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .in('role', ['operations', 'admin', 'regional_manager', 'sales_manager'])
      .order('full_name'),
    supabase
      .from('sub_contractors')
      .select('id, company_name, contact_name, services')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('company_name'),
  ])

  const initialCustomerId = searchParams?.customer || searchParams?.customer_id || undefined
  const initialProjectId = searchParams?.project || searchParams?.project_id || undefined
  const initialJobId = searchParams?.job_id || undefined
  const initialAddress = searchParams?.address || undefined

  return (
    <NewWorkOrderClient
      customers={customersRes.data || []}
      projects={projectsRes.data || []}
      users={usersRes.data || []}
      subs={subsRes.data || []}
      orgId={profile.org_id}
      userId={profile.id}
      initialCustomerId={initialCustomerId}
      initialProjectId={initialProjectId}
      initialJobId={initialJobId}
      initialAddress={initialAddress}
    />
  )
}
