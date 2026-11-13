import type { Metadata, Viewport } from 'next'

import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const metadata: Metadata = {
  title: 'Canvass - Field Sales App',
  description: 'Mobile canvassing app for door-to-door sales',
  manifest: '/canvass-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Canvass',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // Android Chrome: the on-screen keyboard shrinks the page instead of covering the bottom of the form
  interactiveWidget: 'resizes-content',
  themeColor: '#4F46E5',
}

export default async function CanvassAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { profile, authUser } = await requireAuth()
  // Company switched door knocking off (Settings → Features): the whole canvass app is gone.
  await requireOrgFeaturePage(profile.org_id, 'canvassing')
  const admin = createServiceClient()
  const effective = await resolveEffectivePermissionNames(admin, authUser.id, {
    role: profile.role as string,
    custom_role_id: profile.custom_role_id ?? null,
  })

  if (!effectiveHasPermission(effective, 'canvass:view')) {
    redirect('/leads')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {children}
    </div>
  )
}
