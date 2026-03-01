import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import CustomersPageClient from '@/components/customers/CustomersPageClient'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: { q?: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const query = String(searchParams?.q ?? '').trim()
  let customers: any[] | null = []

  if (profile.role === 'rep') {
    // Reps only see customers from their own projects
    const { data: projectRows } = await supabase
      .from('projects')
      .select('customer_id')
      .eq('org_id', profile.org_id)
      .eq('owner_user_id', profile.id)
      .not('customer_id', 'is', null)

    const customerIds = Array.from(new Set((projectRows || []).map((row) => row.customer_id)))
    if (customerIds.length > 0) {
      let customerQuery = supabase
        .from('customers')
        .select('*')
        .in('id', customerIds)
      
      if (query) {
        customerQuery = customerQuery.or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      }
      
      const { data } = await customerQuery
        .order('created_at', { ascending: false })
        .limit(50)
      customers = data
    }
  } else {
    // Non-reps see all org customers
    let customerQuery = supabase
      .from('customers')
      .select('*')
      .eq('org_id', profile.org_id)
    
    if (query) {
      customerQuery = customerQuery.or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
    }
    
    const { data } = await customerQuery
      .order('created_at', { ascending: false })
      .limit(50)
    customers = data
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CustomersPageClient customers={customers || []} query={query} isAdmin={profile.role === 'admin'} />
      </div>
    </div>
  )
}
