'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { createClientBrowser } from '@/lib/supabase/client'

interface Proposal {
  id: string
  proposal_number: string
  customer_name: string
  customer_address: string
  title: string
  status: string
  total: number
  created_at: string
  sent_at: string | null
  users?: { full_name: string }
}

export default function ProposalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const supabase = createClientBrowser()

  useEffect(() => {
    loadProposals()
  }, [])

  const loadProposals = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      router.push('/dashboard')
      return
    }

    let query = supabase
      .from('proposals')
      .select('*, users(full_name)')
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    // Non-admin users only see their own proposals
    if (!['admin', 'regional_manager', 'sales_manager', 'manager'].includes(profile.role)) {
      query = query.eq('created_by', user.id)
    }

    const { data } = await query
    setProposals(data || [])
    setLoading(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700'
      case 'sent': return 'bg-blue-100 text-blue-700'
      case 'viewed': return 'bg-amber-100 text-amber-700'
      case 'accepted': return 'bg-green-100 text-green-700'
      case 'declined': return 'bg-red-100 text-red-700'
      case 'expired': return 'bg-gray-100 text-gray-500'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const filteredProposals = proposals.filter(p => {
    if (filter !== 'all' && p.status !== filter) return false
    if (search) {
      const searchLower = search.toLowerCase()
      return (
        p.customer_name.toLowerCase().includes(searchLower) ||
        p.proposal_number.toLowerCase().includes(searchLower) ||
        p.customer_address.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const stats = {
    total: proposals.length,
    draft: proposals.filter(p => p.status === 'draft').length,
    sent: proposals.filter(p => p.status === 'sent').length,
    accepted: proposals.filter(p => p.status === 'accepted').length,
    totalValue: proposals.filter(p => p.status === 'accepted').reduce((sum, p) => sum + p.total, 0),
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Proposals</h1>
            <p className="text-gray-500 mt-1">Create and manage customer proposals</p>
          </div>
          <Link
            href="/proposals/builder"
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Proposal
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-gray-500">Total Proposals</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-gray-500">Drafts</p>
            <p className="text-2xl font-bold text-gray-900">{stats.draft}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-gray-500">Sent</p>
            <p className="text-2xl font-bold text-blue-600">{stats.sent}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-sm text-gray-500">Accepted Value</p>
            <p className="text-2xl font-bold text-green-600">${stats.totalValue.toLocaleString()}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search proposals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {['all', 'draft', 'sent', 'viewed', 'accepted', 'declined'].map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                  filter === status
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-600 border hover:bg-gray-50'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Proposals List */}
        {filteredProposals.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No proposals found</h3>
            <p className="text-gray-500 mb-6">Create your first proposal to get started</p>
            <Link
              href="/proposals/builder"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700"
            >
              Create Proposal
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredProposals.map((proposal) => (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="block bg-white rounded-xl shadow-sm border p-6 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">{proposal.proposal_number}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(proposal.status)}`}>
                        {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-gray-900">{proposal.customer_name}</p>
                    <p className="text-sm text-gray-500">{proposal.customer_address}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Created {new Date(proposal.created_at).toLocaleDateString()}
                      {proposal.users?.full_name && ` by ${proposal.users.full_name}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-indigo-600">
                      ${proposal.total.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500">{proposal.title}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
