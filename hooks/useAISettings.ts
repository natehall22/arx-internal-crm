import { useEffect, useState } from 'react'

type CachedAISettings = {
  aiEnabled: boolean
  aiAutoNotes: boolean
}

const fallbackAISettings: CachedAISettings = {
  aiEnabled: false,
  aiAutoNotes: false,
}

let aiSettingsCache: CachedAISettings | null = null
let aiSettingsInFlight: Promise<CachedAISettings> | null = null

async function fetchAISettings(): Promise<CachedAISettings> {
  if (aiSettingsCache) {
    return aiSettingsCache
  }

  if (!aiSettingsInFlight) {
    aiSettingsInFlight = fetch('/api/settings')
      .then(async (response) => {
        if (!response.ok) {
          aiSettingsCache = fallbackAISettings
          return fallbackAISettings
        }

        const data = await response.json()
        const userSettings = data?.userSettings || {}

        const resolved: CachedAISettings = {
          aiEnabled: userSettings.ai_enabled ?? false,
          aiAutoNotes: userSettings.ai_auto_notes ?? false,
        }

        aiSettingsCache = resolved
        return resolved
      })
      .catch(() => {
        aiSettingsCache = fallbackAISettings
        return fallbackAISettings
      })
      .finally(() => {
        aiSettingsInFlight = null
      })
  }

  return aiSettingsInFlight
}

export function useAISettings() {
  const [loading, setLoading] = useState(true)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiAutoNotes, setAiAutoNotes] = useState(false)

  useEffect(() => {
    let mounted = true

    fetchAISettings().then((settings) => {
      if (!mounted) return
      setAiEnabled(settings.aiEnabled)
      setAiAutoNotes(settings.aiAutoNotes)
      setLoading(false)
    })

    return () => {
      mounted = false
    }
  }, [])

  return { aiEnabled, aiAutoNotes, loading }
}
