'use client'

import { useMemo } from 'react'

import { Button, toast } from '@/components/ui'
import { clientLinkBase } from '@/lib/app-url'
import { buildLeadFormSnippet } from '@/lib/lead-form-snippet'

/**
 * Admin → Campaigns, on each lead source: "Website form". A small form the company pastes into its own website; it posts to
 * this source's webhook, so the lead lands here with the right source, campaign, owner and service.
 */
export default function WebsiteFormBox({ token, services }: { token: string; services: readonly string[] }) {
  const snippet = useMemo(() => buildLeadFormSnippet({ endpoint: clientLinkBase(), token, services }), [token, services])
  return (
    <details className="mt-4 rounded-lg bg-gray-50 p-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-gray-900">Website form</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-gray-900">
          Paste this into a page on your website. People fill it in and the lead shows up here.
          {services.length ? ` The Service list has: ${services.join(', ')}.` : ' To add a Service list, edit this lead source and add the services.'}
        </p>
        <textarea readOnly rows={8} value={snippet} aria-label="Website form code" className="w-full rounded border bg-white p-2 font-mono text-sm text-gray-900" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          className="min-h-[44px] self-start"
          onClick={() => {
            void navigator.clipboard.writeText(snippet).then(() => toast.success('Form code copied'), () => toast.error('Could not copy. Select the code and copy it.'))
          }}
        >
          Copy form code
        </Button>
      </div>
    </details>
  )
}
