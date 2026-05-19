import type { Metadata, Viewport } from 'next'

import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
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
  themeColor: '#4F46E5',
}

export default async function CanvassAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { profile, authUser } = await requireAuth()
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
