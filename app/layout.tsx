import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import AppointmentFeedbackPrompt from '@/components/AppointmentFeedbackPrompt'
import SetterFeedbackPrompt from '@/components/SetterFeedbackPrompt'
import { AIAssistantProvider } from '@/components/AIAssistantProvider'
import AIAssistantWrapper from '@/components/AIAssistantWrapper'
import SessionKeepalive from '@/components/SessionKeepalive'
import SessionOnly from '@/components/SessionOnly'
import { Toaster } from '@/components/ui/toast'
import { ConfirmHost } from '@/components/ui/confirm-dialog'
import { getRequestHostFence } from '@/lib/company-host-server'
import { OrgProfileProvider, type InitialOrgProfile } from '@/components/OrgProfileProvider'
import { getAuthContext, hasSessionToken } from '@/lib/auth'
import { clientOrgProfile, loadOrgProfile } from '@/lib/org-profile'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * The signed-in company's industry profile for the first paint (Nav menu order/words, feature switches). Signed out or
 * any failure → null and the client falls back as before. Shares the page's auth resolution (per-request memo in
 * lib/auth.ts). Next's "this page is dynamic" signal is re-thrown, never swallowed.
 */
async function initialOrgProfile(): Promise<InitialOrgProfile> {
  try {
    if (!hasSessionToken()) return null
    const auth = await getAuthContext()
    if (!auth?.profile.org_id) return null
    const p = await loadOrgProfile(createServiceClient(), auth.profile.org_id)
    return { profile: clientOrgProfile(p), features: p.features }
  } catch (e) {
    if ((e as { digest?: unknown })?.digest === 'DYNAMIC_SERVER_USAGE') throw e
    console.error('layout: industry profile not loaded for first paint', e)
    return null
  }
}

/** The original company's metadata — served ONLY on the unfenced legacy address (see generateMetadata). */
const LEGACY_METADATA: Metadata = {
  title: 'ARX Internal CRM',
  description: 'Internal CRM and estimating system for ARX Roofing',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ARX CRM',
  },
  formatDetection: {
    telephone: true,
  },
}

/**
 * Per address (lib/company-host.ts, host only): unfenced legacy address → the original metadata, unchanged. Any
 * company copy (company address or DEPLOYMENT_ORG_ID) → neutral title/description, the company's own logo as icon
 * (via the host-scoped /api/company-logo, never the org id),
 * and no root manifest (the static manifests still carry the original name; a per-company manifest is a follow-up).
 * Cheap: the fence comes from middleware's signed lookup (or the cached one) — no org row read.
 */
export async function generateMetadata(): Promise<Metadata> {
  const fence = await getRequestHostFence()
  if (fence.kind === 'open') return LEGACY_METADATA
  // Host-scoped logo route: no company id in the page (signed-out visitors see this metadata too).
  const icon = fence.kind === 'org' ? '/api/company-logo' : null
  return {
    title: 'CRM',
    description: 'CRM and estimating',
    ...(icon ? { icons: { icon: [{ url: icon }], apple: [{ url: icon }] } } : {}),
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CRM' },
    formatDetection: { telephone: true },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#4f46e5',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const orgProfile = await initialOrgProfile()
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="overscroll-none">
        <OrgProfileProvider initial={orgProfile}>
        <AIAssistantProvider>
          {children}
          <ServiceWorkerRegistration />
          <Toaster />
          <ConfirmHost />
          <SessionOnly>
            <SessionKeepalive />
            <AppointmentFeedbackPrompt />
            <SetterFeedbackPrompt />
            <AIAssistantWrapper />
          </SessionOnly>
        </AIAssistantProvider>
        </OrgProfileProvider>
      </body>
    </html>
  )
}
