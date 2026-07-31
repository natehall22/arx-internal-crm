type AIAssistantPanelMode = 'closed' | 'minimized' | 'open'

type AIAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const SHELL_STORAGE_KEY = 'arx-ai-assistant-shell-v1'
const ALLOWLIST_LATCH_KEY = 'arx-ai-assistant-allowlisted'

type PersistedShell = {
  panelMode: AIAssistantPanelMode
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>
  conversationId: string | null
  input: string
}

export function readAiAssistantAllowlistLatch(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(ALLOWLIST_LATCH_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAiAssistantAllowlistLatch(allowed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (allowed) {
      sessionStorage.setItem(ALLOWLIST_LATCH_KEY, '1')
    } else {
      sessionStorage.removeItem(ALLOWLIST_LATCH_KEY)
    }
  } catch {
    // ignore quota / private mode
  }
}

export function readAiAssistantShellStorage(): {
  panelMode: AIAssistantPanelMode
  messages: AIAssistantMessage[]
  conversationId: string | null
  input: string
} | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SHELL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedShell
    if (
      parsed.panelMode !== 'closed' &&
      parsed.panelMode !== 'minimized' &&
      parsed.panelMode !== 'open'
    ) {
      return null
    }
    return {
      panelMode: parsed.panelMode,
      messages: (parsed.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
      })),
      conversationId: parsed.conversationId ?? null,
      input: parsed.input ?? '',
    }
  } catch {
    return null
  }
}

export function writeAiAssistantShellStorage(payload: {
  panelMode: AIAssistantPanelMode
  messages: AIAssistantMessage[]
  conversationId: string | null
  input: string
}): void {
  if (typeof window === 'undefined') return
  try {
    const toStore: PersistedShell = {
      panelMode: payload.panelMode,
      conversationId: payload.conversationId,
      input: payload.input,
      messages: payload.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })),
    }
    sessionStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // ignore
  }
}

export function clearAiAssistantShellStorage(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(SHELL_STORAGE_KEY)
  } catch {
    // ignore
  }
}
