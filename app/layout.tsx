import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import AppointmentFeedbackPrompt from '@/components/AppointmentFeedbackPrompt'
import SetterFeedbackPrompt from '@/components/SetterFeedbackPrompt'
import { AIAssistantProvider } from '@/components/AIAssistantProvider'
import AIAssistantWrapper from '@/components/AIAssistantWrapper'
import SessionKeepalive from '@/components/SessionKeepalive'

export const metadata: Metadata = {
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#4f46e5',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" sizes="192x192" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="overscroll-none">
        <AIAssistantProvider>
          {children}
          <ServiceWorkerRegistration />
          <SessionKeepalive />
          <AppointmentFeedbackPrompt />
          <SetterFeedbackPrompt />
          <AIAssistantWrapper />
        </AIAssistantProvider>
      </body>
    </html>
  )
}
