import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import CustomersPageClient from '@/components/customers/CustomersPageClient'
import NewCustomerPlan from '@/components/service-plans/NewCustomerPlan'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { notFound } from 'next/navigation'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { resolveServicePlanAccess } from '@/lib/service-plans-access'
import { loadPlanCustomerIds } from '@/lib/service-plans-db'
import { loadCustomerCategories, loadOrgCategories } from '@/lib/categories-db'
import { customerFileDefaultFor } from '@/lib/customer-file/redirects'
import { loadOrgProfile } from '@/lib/org-profile'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: { q?: string }
}) {
  const { profile, authUser } = await requireAuth()
  const supabase = createClient()
  const customerPermissions = await resolveEffectivePermissionNames(createServiceClient(), authUser.id, profile)
  if (!canAccessCustomerRecordsFromPermissionNames(customerPermissions)) {
    notFound()
  }

  const query = String(searchParams?.q ?? '').trim()
  const rep = isRepLikeCustomerRecordRole(profile.role)

  let customers: any[] = []
  if (rep) {
    // Reps only see customers from their own projects
    const { data: projectRows } = await supabase
      .from('projects')
      .select('customer_id')
      .eq('org_id', profile.org_id)
      .eq('owner_user_id', profile.id)
      .not('customer_id', 'is', null)
    const customerIds = Array.from(new Set((projectRows || []).map((row) => row.customer_id)))
    if (customerIds.length > 0) {
      const { data } = await supabase.from('customers').select('id, name, phone, email, address_text').in('id', customerIds).order('created_at', { ascending: false }).limit(1000)
      customers = (data ?? []).map((c) => ({ ...c, bought: true }))
    }
  } else {
    // Non-reps: the org's customers, newest first. The table filters (Customers / Prospects) and searches the loaded rows.
    let customerQuery = supabase.from('customers').select('id, name, phone, email, address_text').eq('org_id', profile.org_id)
    // A ?q= link searches the whole customer list on the server (the table's own search only covers what is loaded).
    if (query) customerQuery = customerQuery.or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,address_text.ilike.%${query}%`)
    const { data } = await customerQuery.order('created_at', { ascending: false }).limit(3000)
    const ids = (data ?? []).map((c) => c.id as string)
    // Who has bought (a project or a won deal): asked only for the customers on screen, so no row cap can mislabel anyone.
    const buyers = new Set<string>()
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400)
      const [proj, won] = await Promise.all([
        supabase.from('projects').select('customer_id').eq('org_id', profile.org_id).in('customer_id', chunk),
        supabase.from('opportunities').select('customer_id').eq('org_id', profile.org_id).eq('status', 'won').in('customer_id', chunk),
      ])
      for (const r of [...(proj.data ?? []), ...(won.data ?? [])]) if (r.customer_id) buyers.add(r.customer_id as string)
    }
    customers = (data ?? []).map((c) => ({ ...c, bought: buyers.has(c.id as string) }))
  }

  // Work category on each row (its own read: a missing column can never blank the list) and the company's list for the filter.
  const adminForCategories = createServiceClient()
  const [categoryById, categories] = await Promise.all([
    loadCustomerCategories(adminForCategories, profile.org_id, customers.map((c) => c.id as string)),
    loadOrgCategories(adminForCategories, profile.org_id),
  ])
  customers = customers.map((c) => ({ ...c, category: categoryById.get(c.id as string) ?? null }))

  // Service plans on: anyone with a plan (any status) has bought — a "New customer + plan" has no project or won deal.
  // Recurring / One-time (active plan or not) only for viewers who may see plans.
  const plansAccess = rep ? null : await resolveServicePlanAccess(adminForCategories, authUser.id, profile).catch(() => null)
  const planIds = plansAccess?.feature ? await loadPlanCustomerIds(adminForCategories, profile.org_id).catch(() => null) : null
  const showRecurring = !!planIds && plansAccess?.view === true
  if (planIds) {
    customers = customers.map((c) => ({
      ...c,
      bought: c.bought || planIds.onPlan.has(c.id as string),
      ...(showRecurring ? { recurring: planIds.recurring.has(c.id as string) } : {}),
    }))
  }

  // Rows open the Customer File where it is the company's customer page; the roof-linking tools (Link / Create from a
  // project or job, Backfill) belong to companies that price from a roof, and Backfill shows only when something is unlinked.
  const orgProfile = await loadOrgProfile(adminForCategories, profile.org_id)
  const fileDefault = customerFileDefaultFor(profile.role, orgProfile.id)
  const linkTools = orgProfile.features.squaresPricing
  let unlinked = 0
  if (profile.role === 'admin' && linkTools) {
    const [p, j] = await Promise.all([
      adminForCategories.from('projects').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).is('customer_id', null),
      adminForCategories.from('production_jobs').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).is('customer_id', null),
    ])
    unlinked = (p.count ?? 0) + (j.count ?? 0)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Service companies: the common job is a new customer signing up for a plan (shows only when service plans are on). */}
        {!rep ? (
          <div className="mb-4 flex justify-end">
            <NewCustomerPlan size="md" />
          </div>
        ) : null}
        <CustomersPageClient customers={customers} categories={categories} showRecurring={showRecurring} query={query} isAdmin={profile.role === 'admin' && unlinked > 0} customerFile={fileDefault} showLinkTools={linkTools} />
      </div>
    </div>
  )
}
