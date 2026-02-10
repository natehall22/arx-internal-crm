import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EstimateBuilder from '@/components/EstimateBuilder'

export default async function EstimatePage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, projects(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!estimate) {
    notFound()
  }

  if (profile.role === 'rep' && estimate.projects?.owner_user_id !== profile.id) {
    notFound()
  }

  const { data: lines } = await supabase
    .from('estimate_lines')
    .select('*')
    .eq('estimate_id', params.id)
    .order('sort_order', { ascending: true })

  const { data: pricebookItems } = await supabase
    .from('pricebook_items')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href={`/projects/${estimate.projects.id}`}
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Project
          </Link>
        </div>
        <EstimateBuilder
          estimate={estimate}
          initialLines={lines || []}
          pricebookItems={pricebookItems || []}
          project={estimate.projects}
        />
      </div>
    </div>
  )
}
