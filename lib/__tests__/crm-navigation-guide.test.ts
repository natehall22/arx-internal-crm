import {
  buildAiChatSystemPrompt,
  generateContextualSuggestions,
  getNavigationFallbackResponse,
  getRoleNavigationHint,
} from '@/lib/ai/crm-navigation-guide'

describe('crm-navigation-guide', () => {
  it('includes role focus for operations users', () => {
    const hint = getRoleNavigationHint('operations')
    expect(hint).toContain('Ops')
  })

  it('builds a system prompt with navigation guide and record context', () => {
    const prompt = buildAiChatSystemPrompt({
      fullName: 'Steve',
      role: 'operations',
      recordContextAppendix: '\n\nCurrent Lead Context:\n- Name: Jane',
    })
    expect(prompt).toContain('Steve')
    expect(prompt).toContain('navigation and guidance')
    expect(prompt).toContain('/ops')
    expect(prompt).toContain('Jane')
  })

  it('returns labor cost navigation fallback', () => {
    const response = getNavigationFallbackResponse('where do I enter labor cost', 'operations')
    expect(response).toContain('Labor Cost')
    expect(response).toContain('/ops/jobs/[id]')
  })

  it('returns navigation suggestions for general context', () => {
    const suggestions = generateContextualSuggestions(null, null)
    expect(suggestions.some((s) => s.toLowerCase().includes('labor cost'))).toBe(true)
  })

  it('does not false-positive on "pay the sub" for commissions', () => {
    const response = getNavigationFallbackResponse('pay the sub for this job', 'operations')
    expect(response).toContain('Labor Cost')
    expect(response).toContain('Job Files Workspace')
  })

  it('does not false-positive on "I paid the sub" for commissions', () => {
    const response = getNavigationFallbackResponse('I paid the sub for this job', 'operations')
    expect(response).toContain('Labor Cost')
  })

  it('does not misroute "schedule the crew" to inspection scheduling', () => {
    const response = getNavigationFallbackResponse('how do I schedule the crew on this job', 'operations')
    expect(response).not.toContain('Schedule Inspection')
  })

  it('returns job-context suggestions for crew assignment', () => {
    const suggestions = generateContextualSuggestions('job', 'abc-123')
    expect(suggestions.some((s) => s.toLowerCase().includes('crew'))).toBe(true)
    expect(suggestions.some((s) => s.toLowerCase().includes('cost line'))).toBe(true)
  })
})
