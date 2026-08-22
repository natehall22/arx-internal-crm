import { getNavigationFallbackResponse } from '@/lib/ai/crm-navigation-guide'

/**
 * The navigation guide is a fallback for when no model is reachable — never a pre-filter.
 * It previously ran before the OpenAI call and returned a static menu for any question
 * containing "where" / "how do i" / "find", so real questions never reached the model.
 * Anything it cannot answer specifically must return null so the caller falls through.
 */
describe('getNavigationFallbackResponse', () => {
  // Verbatim from production ai_conversations — both got the generic directory listing.
  it.each([
    'where do i adjust buffer time?',
    'where do I assign a user to a comp plan',
  ])('falls through to the model for: %s', (question) => {
    expect(getNavigationFallbackResponse(question, 'admin')).toBeNull()
  })

  // Questions with no navigation answer at all must return null. Broad single-keyword
  // branches (e.g. anything mentioning "customer") deliberately still match: this function
  // now runs ONLY when OPENAI_API_KEY is absent, and in that degraded mode pointing at a
  // plausible page beats returning nothing.
  it.each([
    'what was the last person that rohda contacted?',
    'which of my deals has the highest margin this month',
    'how do i get better at closing insurance deals',
    'summarize this for me',
  ])('does not hijack open-ended question: %s', (question) => {
    expect(getNavigationFallbackResponse(question, 'admin')).toBeNull()
  })

  it('still answers a specific navigation question it genuinely knows', () => {
    const answer = getNavigationFallbackResponse('where do I find my commissions?', 'closer')
    expect(answer).toContain('/commissions')
  })

  it('still answers the material-order navigation question', () => {
    expect(getNavigationFallbackResponse('how do i add a material order', 'operations')).toContain(
      '/ops'
    )
  })

  // The route degrades to this function when OpenAI is unreachable (bad key, 429, quota,
  // outage). A question the CRM can answer offline must still get a real answer there,
  // rather than the bare 500 the route used to return.
  it('still answers offline-answerable questions used by the degraded path', () => {
    for (const q of [
      'where do I enter labor cost',
      'how do i add a material order',
      'where do I find my commissions?',
    ]) {
      expect(getNavigationFallbackResponse(q, 'admin')).toBeTruthy()
    }
  })

  it('never returns the removed generic directory listing', () => {
    const probes = [
      'where',
      'how do i',
      'how to do the thing',
      'find it',
      'access that',
      'navigate somewhere',
      'go to the place',
    ]
    for (const probe of probes) {
      const answer = getNavigationFallbackResponse(probe, 'admin')
      expect(answer ?? '').not.toContain('I can point you to the right place in ARX CRM')
    }
  })
})
