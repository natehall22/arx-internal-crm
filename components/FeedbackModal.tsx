'use client'

import { useState, useEffect } from 'react'

interface FeedbackModalProps {
  isOpen: boolean
  onClose: () => void
  userName: string
  userEmail: string
}

type TabType = 'bug' | 'feature'
type SeverityType = 'low' | 'medium' | 'urgent'

export default function FeedbackModal({ isOpen, onClose, userName, userEmail }: FeedbackModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('bug')
  const [severity, setSeverity] = useState<SeverityType>('medium')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('bug')
      setSeverity('medium')
      setDescription('')
      setSuccess(false)
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError('Please provide a description')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeTab,
          description: description.trim(),
          severity: activeTab === 'bug' ? severity : null,
          rep_name: userName,
          rep_email: userEmail,
          page_url: window.location.href,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to submit feedback')
      }

      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 2000)

    } catch (err) {
      setError('Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const severityConfig = {
    low: { label: 'Low', bg: 'bg-gray-100', text: 'text-gray-700', selectedBg: 'bg-gray-600', selectedText: 'text-white' },
    medium: { label: 'Medium', bg: 'bg-yellow-100', text: 'text-yellow-700', selectedBg: 'bg-yellow-500', selectedText: 'text-white' },
    urgent: { label: 'Urgent', bg: 'bg-red-100', text: 'text-red-700', selectedBg: 'bg-red-600', selectedText: 'text-white' },
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {activeTab === 'bug' ? 'Bug Report Submitted!' : 'Feature Request Submitted!'}
          </h2>
          <p className="text-sm text-gray-500 mt-2">Thank you for your feedback.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Send Feedback</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('bug')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'bug'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            🐛 Report a Bug
          </button>
          <button
            onClick={() => setActiveTab('feature')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'feature'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            💡 Request a Feature
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Bug Report Tab */}
          {activeTab === 'bug' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Severity
                </label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'urgent'] as SeverityType[]).map((sev) => {
                    const config = severityConfig[sev]
                    const isSelected = severity === sev
                    return (
                      <button
                        key={sev}
                        onClick={() => setSeverity(sev)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                          isSelected
                            ? `${config.selectedBg} ${config.selectedText}`
                            : `${config.bg} ${config.text} hover:opacity-80`
                        }`}
                      >
                        {config.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What happened? What were you trying to do? *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Describe the bug in detail..."
                />
              </div>
            </>
          )}

          {/* Feature Request Tab */}
          {activeTab === 'feature' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Describe the feature you'd like... *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="What feature would help you work better?"
              />
            </div>
          )}

          {/* User Info (read-only) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Your Name
              </label>
              <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">
                {userName || 'Unknown'}
              </p>
            </div>
            {activeTab === 'bug' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Your Email
                </label>
                <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg truncate">
                  {userEmail || 'Unknown'}
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !description.trim()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : activeTab === 'bug' ? 'Submit Bug Report' : 'Submit Feature Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
