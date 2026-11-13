'use client'

import { useEffect, useRef, useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'

export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors'
export const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/#settings/Connectors'

/** Copy text; falls back to selecting the visible address (and the old copy command) when the clipboard API is missing. */
async function copyText(text: string, selectFallback: () => void): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  selectFallback()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

/**
 * "Connect your AI": the company's connector address, one big Copy button, and Open Claude / Open ChatGPT which copy the
 * address and open that app's connector settings. Rendered by the caller only when the company's `aiConnector` feature is on.
 */
export default function ConnectAiCard({ address, companyName }: { address: string; companyName: string }) {
  const [copied, setCopied] = useState(false)
  const [selectHint, setSelectHint] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const selectAddress = () => {
    addressRef.current?.focus()
    addressRef.current?.select()
  }

  async function copy(): Promise<boolean> {
    const ok = await copyText(address, selectAddress)
    setSelectHint(!ok)
    if (ok) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    }
    return ok
  }

  async function openApp(url: string) {
    // Open first (inside the tap) so the pop-up is not blocked, then copy.
    window.open(url, '_blank', 'noopener,noreferrer')
    await copy()
  }

  const name = companyName || 'the CRM'
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your AI</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-ui-base text-ink">Ask Claude or ChatGPT about your jobs, customers and schedule. It sees only what you can see.</p>
        <label htmlFor="ai-connector-address" className="mt-3 block text-ui-sm font-semibold text-ink">Your connector address</label>
        <input
          id="ai-connector-address"
          ref={addressRef}
          readOnly
          value={address}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 min-h-tap w-full rounded-md border border-surface-line bg-white px-3 text-base text-ink"
        />
        <Button className="mt-3 min-h-tap w-full" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy address'}
        </Button>
        {selectHint ? <p role="status" className="mt-2 text-ui-sm text-ink">Your browser would not copy it. The address is selected: press and hold, then tap Copy.</p> : null}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Button variant="secondary" className="min-h-tap w-full" onClick={() => void openApp(CLAUDE_CONNECTORS_URL)}>Open Claude</Button>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ui-base text-ink">
              <li>Tap Open Claude. The address is copied for you.</li>
              <li>Tap Add custom connector. Name it {name} and paste the address.</li>
              <li>Tap Connect and sign in to the CRM.</li>
            </ol>
          </div>
          <div>
            <Button variant="secondary" className="min-h-tap w-full" onClick={() => void openApp(CHATGPT_CONNECTORS_URL)}>Open ChatGPT</Button>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ui-base text-ink">
              <li>Tap Open ChatGPT. The address is copied for you.</li>
              <li>Under Connectors, tap Create. Name it {name} and paste the address. If you do not see Create, turn on Developer mode under Connectors, then Advanced.</li>
              <li>Tap Connect and sign in to the CRM.</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
