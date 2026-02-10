import type { Metadata, Viewport } from 'next'

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

export default function CanvassAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      {children}
    </div>
  )
}
