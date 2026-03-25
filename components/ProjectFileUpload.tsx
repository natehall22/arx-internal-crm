'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ProjectFileUploadProps {
  projectId: string
}

export default function ProjectFileUpload({ projectId }: ProjectFileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [selectedTag, setSelectedTag] = useState('document')
  const router = useRouter()

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tag', selectedTag)

      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Failed to upload file')
        return
      }

      router.refresh()
    } catch (err) {
      console.error('Upload error:', err)
      alert('Failed to upload file')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="flex items-center gap-2 mt-4">
      <select
        value={selectedTag}
        onChange={(e) => setSelectedTag(e.target.value)}
        className="text-sm border border-gray-300 rounded px-2 py-1"
      >
        <option value="document">Document</option>
        <option value="photo">Photo</option>
        <option value="contract">Contract</option>
        <option value="permit">Permit</option>
        <option value="invoice">Invoice</option>
        <option value="other">Other</option>
      </select>
      <label className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded cursor-pointer ${
        uploading 
          ? 'bg-gray-100 text-gray-400 cursor-wait' 
          : 'bg-indigo-600 text-white hover:bg-indigo-700'
      }`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {uploading ? 'Uploading...' : 'Upload File'}
        <input
          type="file"
          className="hidden"
          onChange={handleUpload}
          disabled={uploading}
        />
      </label>
    </div>
  )
}
