import {
  assembleTokenContent,
  formatAiChatSseEvent,
  parseAiChatSseChunk,
  parseAiChatSseLine,
} from '@/lib/ai/chat-stream'

describe('formatAiChatSseEvent', () => {
  it('formats token events', () => {
    expect(formatAiChatSseEvent({ type: 'token', content: 'Hi' })).toBe(
      'data: {"type":"token","content":"Hi"}\n\n'
    )
  })

  it('formats done events', () => {
    expect(
      formatAiChatSseEvent({
        type: 'done',
        conversationId: 'abc-123',
        response: 'Full reply',
      })
    ).toBe(
      'data: {"type":"done","conversationId":"abc-123","response":"Full reply"}\n\n'
    )
  })
})

describe('parseAiChatSseLine', () => {
  it('parses token, done, and error events', () => {
    expect(parseAiChatSseLine('data: {"type":"token","content":"a"}')).toEqual({
      type: 'token',
      content: 'a',
    })
    expect(
      parseAiChatSseLine(
        'data: {"type":"done","conversationId":"id-1","response":"done text"}'
      )
    ).toEqual({
      type: 'done',
      conversationId: 'id-1',
      response: 'done text',
    })
    expect(parseAiChatSseLine('data: {"type":"error","error":"boom"}')).toEqual({
      type: 'error',
      error: 'boom',
    })
  })

  it('ignores invalid lines and [DONE]', () => {
    expect(parseAiChatSseLine('data: [DONE]')).toBeNull()
    expect(parseAiChatSseLine('event: ping')).toBeNull()
    expect(parseAiChatSseLine('data: not-json')).toBeNull()
  })
})

describe('parseAiChatSseChunk', () => {
  it('handles partial chunks across reads', () => {
    let remainder = ''
    const first = parseAiChatSseChunk('data: {"type":"token","content":"Hel', remainder)
    remainder = first.remainder
    expect(first.events).toEqual([])

    const second = parseAiChatSseChunk('lo"}\n\ndata: {"type":"token","content":"!"}\n\n', remainder)
    expect(second.events).toEqual([
      { type: 'token', content: 'Hello' },
      { type: 'token', content: '!' },
    ])
    expect(second.remainder).toBe('')
  })
})

describe('assembleTokenContent', () => {
  it('joins streamed token fragments', () => {
    expect(assembleTokenContent(['Where ', 'do I ', 'go?'])).toBe('Where do I go?')
  })
})
