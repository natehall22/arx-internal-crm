'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { userCanDeleteProposal } from '@/lib/proposal-delete-access'

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
  created_by?: string | null
  users?: { full_name: string }
}

export default function ProposalsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    loadProposals()
  }, [])

  const loadProposals = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/proposals')
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        const data = await response.json()
        setError(data.error || 'Failed to load proposals')
        setProposals([])
        return
      }

      const { proposals: proposalsData, role, current_user_id: uid } = await response.json()
      setProposals(proposalsData || [])
      setUserRole(role || '')
      setCurrentUserId(typeof uid === 'string' ? uid : '')
    } catch (err) {
      console.error('Error loading proposals:', err)
      setError('Failed to load proposals')
      setProposals([])
    } finally {
      setLoading(false)
    }
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

  const handleDelete = async (e: React.MouseEvent, proposalId: string, proposalNumber: string) => {
    e.preventDefault()
    e.stopPropagation()

    if (!confirm(`Delete proposal ${proposalNumber}? This cannot be undone.`)) {
      return
    }

    setDeletingId(proposalId)
    try {
      const response = await fetch(`/api/proposals/${proposalId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to delete proposal')
        return
      }

      setProposals(prev => prev.filter(p => p.id !== proposalId))
    } catch (err) {
      console.error('Error deleting proposal:', err)
      alert('Failed to delete proposal')
    } finally {
      setDeletingId(null)
    }
  }

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
              <div
                key={proposal.id}
                className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <Link href={`/proposals/${proposal.id}`} className="flex-1">
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
                  </Link>
                  <div className="flex items-center gap-4">
                    <Link href={`/proposals/${proposal.id}`} className="text-right">
                      <p className="text-2xl font-bold text-indigo-600">
                        ${proposal.total.toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">{proposal.title}</p>
                    </Link>
                    {currentUserId &&
                      userCanDeleteProposal({
                        status: proposal.status,
                        createdBy: proposal.created_by,
                        currentUserId,
                        role: userRole,
                      }) && (
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, proposal.id, proposal.proposal_number)}
                          disabled={deletingId === proposal.id}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Delete proposal"
                        >
                          {deletingId === proposal.id ? (
                            <div className="w-5 h-5 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                          ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          )}
                        </button>
                      )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
