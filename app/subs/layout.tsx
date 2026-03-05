import { SubPortalLanguageProvider } from '@/lib/i18n/SubPortalLanguageContext'

export default function SubsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SubPortalLanguageProvider>
      {children}
    </SubPortalLanguageProvider>
  )
}
