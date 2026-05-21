import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'

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

export default async function PrintKitPage() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !ADMIN_TOOL_ROLES.includes(profile.role)) redirect('/dashboard')

  const printTools = [
    {
      title: 'Door Drop Kit',
      description: 'Buyer/seller letter and #10 envelope print kit',
      href: '/admin/door-drop',
    },
    {
      title: 'Appointment Cards',
      description: 'Four-up field marketer appointment cards on Letter paper',
      href: '/admin/print-kit/appointment-cards',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Print Kit</h1>
          <p className="mt-2 text-sm text-gray-600">Printable field marketing pieces and sales leave-behinds.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {printTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="block rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              <h2 className="text-lg font-semibold text-gray-900">{tool.title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">{tool.description}</p>
              <span className="mt-5 inline-flex text-sm font-semibold text-blue-700">Open tool</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
