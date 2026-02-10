import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: { q?: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const query = String(searchParams?.q ?? '').trim()
  let customers: any[] | null = []

  if (query) {
    if (profile.role === 'rep') {
      const { data: projectRows } = await supabase
        .from('projects')
        .select('customer_id')
        .eq('org_id', profile.org_id)
        .eq('owner_user_id', profile.id)
        .not('customer_id', 'is', null)

      const customerIds = Array.from(new Set((projectRows || []).map((row) => row.customer_id)))
      if (customerIds.length > 0) {
        const { data } = await supabase
          .from('customers')
          .select('*')
          .in('id', customerIds)
          .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
          .order('created_at', { ascending: false })
        customers = data
      }
    } else {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('org_id', profile.org_id)
        .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .order('created_at', { ascending: false })
      customers = data
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <Link
            href="/customers/new"
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
          >
            New Customer
          </Link>
        </div>

        <form className="mb-6 flex flex-wrap items-center gap-3" action="/customers" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by customer name, phone, or email"
            className="w-full md:w-96 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Search
          </button>
        </form>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {query ? (
                customers && customers.length > 0 ? (
                  customers.map((customer: any) => (
                    <tr key={customer.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {customer.name || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {customer.phone || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {customer.email || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {customer.address_text || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                      No customers found
                    </td>
                  </tr>
                )
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    Search by customer name, phone, or email to open a customer file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
