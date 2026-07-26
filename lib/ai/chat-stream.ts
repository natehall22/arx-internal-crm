/**
 * CRM AI chat SSE helpers.
 *
 * Server emits:
 *   data: {"type":"token","content":"..."}\n\n
 *   data: {"type":"done","conversationId":"...","response":"<full text>"}\n\n
 *   data: {"type":"error","error":"..."}\n\n
 */
export type AiChatStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'done'; conversationId: string | null; response: string }
  | { type: 'error'; error: string }

export function formatAiChatSseEvent(event: AiChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function parseAiChatSseLine(line: string): AiChatStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return null

  const payload = trimmed.slice(6)
  if (payload === '[DONE]') return null

  try {
    const parsed: unknown = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null

    const event = parsed as { type?: unknown }
    if (event.type === 'token') {
      const content = (parsed as { content?: unknown }).content
      return typeof content === 'string' ? { type: 'token', content } : null
    }
    if (event.type === 'done') {
      const row = parsed as { conversationId?: unknown; response?: unknown }
      return {
        type: 'done',
        conversationId:
          typeof row.conversationId === 'string' ? row.conversationId : null,
        response: typeof row.response === 'string' ? row.response : '',
      }
    }
    if (event.type === 'error') {
      const error = (parsed as { error?: unknown }).error
      return typeof error === 'string' ? { type: 'error', error } : null
    }
  } catch {
    return null
  }

  return null
}

/** Split an SSE chunk (may be partial) into parsed events and leftover buffer. */
export function parseAiChatSseChunk(
  chunk: string,
  buffer: string
): { events: AiChatStreamEvent[]; remainder: string } {
  const combined = buffer + chunk
  const parts = combined.split('\n\n')
  const remainder = parts.pop() ?? ''
  const events: AiChatStreamEvent[] = []

  for (const part of parts) {
    for (const line of part.split('\n')) {
      const event = parseAiChatSseLine(line)
      if (event) events.push(event)
    }
  }

  return { events, remainder }
}

export function assembleTokenContent(tokens: string[]): string {
  return tokens.join('')
}

export async function consumeAiChatSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AiChatStreamEvent) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const { events, remainder } = parseAiChatSseChunk(decoder.decode(value, { stream: true }), buffer)
    buffer = remainder
    for (const event of events) {
      onEvent(event)
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      const event = parseAiChatSseLine(line)
      if (event) onEvent(event)
    }
  }
}
