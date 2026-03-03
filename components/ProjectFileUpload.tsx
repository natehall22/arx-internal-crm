'use client'

import { useState } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface ProjectFileUploadProps {
  projectId: string
  orgId: string
}

export default function ProjectFileUpload({ projectId, orgId }: ProjectFileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [selectedTag, setSelectedTag] = useState('document')
  const router = useRouter()

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const supabase = createClientBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        alert('Please log in to upload files')
        return
      }

      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${file.name}`
      const storagePath = `org/${orgId}/projects/${projectId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        alert('Failed to upload file: ' + uploadError.message)
        return
      }

      const { error: dbError } = await supabase.from('files').insert({
        org_id: orgId,
        project_id: projectId,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        size_bytes: file.size,
        tag: selectedTag,
        uploaded_by: user.id,
      })

      if (dbError) {
        console.error('DB error:', dbError)
        alert('Failed to save file record')
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
