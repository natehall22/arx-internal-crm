'use client'

import { useState, useTransition } from 'react'

interface ProjectStatusUpdateProps {
  projectId: string
  currentStatus: string
  updateStatusAction: (formData: FormData) => Promise<void>
}

export default function ProjectStatusUpdate({ 
  projectId, 
  currentStatus, 
  updateStatusAction 
}: ProjectStatusUpdateProps) {
  const [isPending, startTransition] = useTransition()
  const [showSuccess, setShowSuccess] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState(currentStatus)

  const handleSubmit = async (formData: FormData) => {
    startTransition(async () => {
      await updateStatusAction(formData)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    })
  }

  return (
    <div className="relative">
      <form action={handleSubmit} className="mt-1 flex items-center gap-2">
        <select
          name="status"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="text-sm rounded-md border border-gray-300 px-2 py-1"
          disabled={isPending}
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="on_hold">On Hold</option>
          <option value="complete">Complete</option>
          <option value="collected">Collected</option>
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? 'Updating...' : 'Update'}
        </button>
      </form>
      
      {showSuccess && (
        <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-green-100 text-green-800 text-xs rounded-md shadow-sm border border-green-200 whitespace-nowrap z-10">
          Status updated successfully!
        </div>
      )}
    </div>
  )
}
