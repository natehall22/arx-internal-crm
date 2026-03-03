'use client'

import { useState, useEffect } from 'react'

interface GenerateJobPacketButtonProps {
  jobId: string
}

interface PacketInfo {
  has_packet: boolean
  url: string | null
  generated_at: string | null
}

export default function GenerateJobPacketButton({ jobId }: GenerateJobPacketButtonProps) {
  const [generating, setGenerating] = useState(false)
  const [packetInfo, setPacketInfo] = useState<PacketInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkExistingPacket()
  }, [jobId])

  const checkExistingPacket = async () => {
    try {
      // Try both API paths for compatibility
      let response = await fetch(`/api/jobs/${jobId}/job-packet`)
      if (!response.ok) {
        response = await fetch(`/api/ops/jobs/${jobId}/packet`)
      }
      if (response.ok) {
        const data = await response.json()
        setPacketInfo(data)
      }
    } catch (err) {
      console.error('Error checking packet:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async (force: boolean = false) => {
    setGenerating(true)
    try {
      // Try both API paths for compatibility
      let response = await fetch(`/api/jobs/${jobId}/job-packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      
      if (!response.ok) {
        response = await fetch(`/api/ops/jobs/${jobId}/packet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        })
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate packet')
      }

      const data = await response.json()
      setPacketInfo({
        has_packet: true,
        url: data.url,
        generated_at: data.generated_at,
      })

      // Open the PDF in a new tab
      if (data.url) {
        window.open(data.url, '_blank')
      }
    } catch (err: any) {
      console.error('Error generating packet:', err)
      alert(err.message || 'Failed to generate job packet')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-100 text-gray-400"
      >
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading...
      </button>
    )
  }

  if (packetInfo?.has_packet && packetInfo.url) {
    return (
      <div className="inline-flex items-center gap-1">
        <a
          href={packetInfo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download Job Packet
        </a>
        <button
          onClick={() => handleGenerate(true)}
          disabled={generating}
          className="inline-flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"
          title="Regenerate PDF"
        >
          {generating ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => handleGenerate(false)}
      disabled={generating}
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md ${
        generating
          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
          : 'bg-indigo-600 text-white hover:bg-indigo-700'
      }`}
    >
      {generating ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating...
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Generate Job Packet
        </>
      )}
    </button>
  )
}
