'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DeleteProjectButtonProps {
  projectId: string
  address?: string
}

export default function DeleteProjectButton({ projectId, address }: DeleteProjectButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        alert(`Failed to delete: ${data.error}`)
        setDeleting(false)
        return
      }

      router.push('/projects')
      router.refresh()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete project')
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="rounded-md border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete Project
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Delete Project</h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>

            <div className="mb-6 p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-red-800">
                <strong>Warning:</strong> Deleting this project will also delete:
              </p>
              <ul className="text-sm text-red-700 mt-2 ml-4 list-disc">
                <li>All estimates linked to this project</li>
                <li>All files and photos</li>
                <li>All activities and notes</li>
              </ul>
              <p className="text-sm text-red-800 mt-2">
                <strong>Note:</strong> Projects with associated production jobs cannot be deleted. Delete the job first.
              </p>
            </div>

            {address && (
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to delete the project at <strong>{address}</strong>?
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Project
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
