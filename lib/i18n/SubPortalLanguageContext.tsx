'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Language, t, TranslationKey, getStatusLabel, getWorkOrderTypeLabel, getPriorityLabel } from './sub-portal'

interface LanguageContextType {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: TranslationKey) => string
  getStatusLabel: (status: string) => string
  getWorkOrderTypeLabel: (type: string) => string
  getPriorityLabel: (priority: string) => string
}

const LanguageContext = createContext<LanguageContextType | null>(null)

const STORAGE_KEY = 'arx-sub-portal-lang'

export function SubPortalLanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null
    if (stored === 'en' || stored === 'es') {
      setLangState(stored)
    }
    setMounted(true)
  }, [])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
    localStorage.setItem(STORAGE_KEY, newLang)
  }

  const value: LanguageContextType = {
    lang,
    setLang,
    t: (key: TranslationKey) => t(key, lang),
    getStatusLabel: (status: string) => getStatusLabel(status, lang),
    getWorkOrderTypeLabel: (type: string) => getWorkOrderTypeLabel(type, lang),
    getPriorityLabel: (priority: string) => getPriorityLabel(priority, lang),
  }

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useSubPortalLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useSubPortalLanguage must be used within SubPortalLanguageProvider')
  }
  return context
}

export function LanguageToggle() {
  const { lang, setLang } = useSubPortalLanguage()

  return (
    <div className="flex items-center gap-1 text-sm">
      <button
        onClick={() => setLang('en')}
        className={`px-2 py-1 rounded ${
          lang === 'en' 
            ? 'bg-gray-900 text-white font-medium' 
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        EN
      </button>
      <span className="text-gray-400">|</span>
      <button
        onClick={() => setLang('es')}
        className={`px-2 py-1 rounded ${
          lang === 'es' 
            ? 'bg-gray-900 text-white font-medium' 
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        ES
      </button>
    </div>
  )
}
