import fs from 'fs'
import path from 'path'

import {
  buildAiChatSystemPrompt,
  generateContextualSuggestions,
  getNavigationFallbackResponse,
  getRoleNavigationHint,
} from '@/lib/ai/crm-navigation-guide'

const REPO_ROOT = path.resolve(__dirname, '../..')
const APP_DIR = path.join(REPO_ROOT, 'app')
const GUIDE_SOURCE_PATH = path.join(REPO_ROOT, 'lib/ai/crm-navigation-guide.ts')

function extractGuideRoutePaths(source: string): string[] {
  const paths: string[] = []
  const re = /\\`(\/[a-zA-Z0-9_\-\[\]\/]+)\\`/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    paths.push(match[1])
  }
  return paths.filter((value, index) => paths.indexOf(value) === index)
}

function findAppPageForRoute(routePath: string, appDir: string): string | null {
  const segments = routePath.split('/').filter(Boolean)

  function walk(dir: string, segmentIndex: number): string | null {
    if (segmentIndex >= segments.length) {
      const pagePath = path.join(dir, 'page.tsx')
      return fs.existsSync(pagePath) ? pagePath : null
    }

    const target = segments[segmentIndex]
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const entryPath = path.join(dir, entry.name)

      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        const found = walk(entryPath, segmentIndex)
        if (found) return found
        continue
      }

      if (entry.name === target) {
        const found = walk(entryPath, segmentIndex + 1)
        if (found) return found
      }
    }

    return null
  }

  return walk(appDir, 0)
}

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

  it('includes aggregate appendix and citation rules when provided', () => {
    const prompt = buildAiChatSystemPrompt({
      fullName: 'Alex',
      role: 'sales_rep',
      aggregateContextAppendix:
        '\n\n<crm_aggregate_data>\n- My leads this week: 3\n</crm_aggregate_data>',
    })
    expect(prompt).toContain('My leads this week: 3')
    expect(prompt).toContain('lead with the exact count')
  })

  it('does not add aggregate citation rules without aggregate appendix', () => {
    const prompt = buildAiChatSystemPrompt({
      fullName: 'Alex',
      role: 'sales_rep',
    })
    expect(prompt).not.toContain('lead with the exact count')
    expect(prompt).toContain('/leads')
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
    expect(suggestions.some((s) => s.toLowerCase().includes('material order'))).toBe(true)
    expect(suggestions.some((s) => s.toLowerCase().includes('status'))).toBe(true)
  })

  it('paves job record paths in labor cost fallback', () => {
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const response = getNavigationFallbackResponse(
      'where do I enter labor cost on this job',
      'operations',
      { type: 'job', id: jobId }
    )
    expect(response).toContain(`/ops/jobs/${jobId}`)
    expect(response).not.toContain('[id]')
  })

  it('returns material order fallback', () => {
    const response = getNavigationFallbackResponse('how do I add a material order', 'operations')
    expect(response).toContain('Add Material Order')
    expect(response).toContain('/orders')
  })

  it('returns crew assignment fallback without inspection misroute', () => {
    const response = getNavigationFallbackResponse(
      'how do I schedule the crew on this job',
      'operations'
    )
    expect(response).toContain('Reassign crew or sub')
    expect(response).not.toContain('Schedule inspection')
  })

  it('returns pipeline fallback pointing to live lists not reports', () => {
    const response = getNavigationFallbackResponse('how many leads do I have this week', 'setter')
    expect(response).toContain('/leads')
    expect(response).not.toContain('/reports')
  })

  it('returns job status next-step fallback on job context', () => {
    const response = getNavigationFallbackResponse("what's next", 'operations', {
      type: 'job',
      id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(response).toContain('Overview')
    expect(response).toContain('Material Ordering')
  })

  it('cites only App Router routes that exist on disk', () => {
    const source = fs.readFileSync(GUIDE_SOURCE_PATH, 'utf8')
    const routePaths = extractGuideRoutePaths(source)

    expect(routePaths.length).toBeGreaterThan(0)

    for (const routePath of routePaths) {
      const pagePath = findAppPageForRoute(routePath, APP_DIR)
      expect(pagePath).not.toBeNull()
      if (!pagePath) {
        throw new Error(`Dead navigation guide path: ${routePath}`)
      }
    }
  })

  it('paveRecordPath does not double-prefix job paths in labor cost fallback', () => {
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const response = getNavigationFallbackResponse(
      'where do I enter labor cost on this job',
      'operations',
      { type: 'job', id: jobId }
    )
    expect(response).toContain(`/ops/jobs/${jobId}`)
    expect(response).not.toContain('/ops/jobs/ops/jobs/')
  })

  it('returns roof report fallback for roof report photo questions', () => {
    const response = getNavigationFallbackResponse('where do roof report photos go', 'closer')
    expect(response).toContain('/opportunities/[id]/report')
    expect(response).toContain('Roof Report')
    expect(response?.indexOf('/opportunities/')).toBeLessThan(
      response?.indexOf('Photos & files') ?? Infinity
    )
  })

  it('routes upload report photos to roof report builder not job photos tab', () => {
    const response = getNavigationFallbackResponse('where do I upload report photos', 'closer')
    expect(response).toContain('/opportunities/[id]/report')
    expect(response).not.toMatch(/Job Board.*Photos & files.*primary/i)
  })

  it('returns ambiguous photo fallback listing all three destinations', () => {
    const response = getNavigationFallbackResponse('where do I upload photos', 'sales_rep')
    expect(response).toContain('/opportunities/[id]/report')
    expect(response).toContain('/proposals/[id]')
    expect(response).toContain('Photos & files')
    expect(response).toContain('/ops/jobs/[id]')
  })

  it('returns job-context photo fallback with paved job path', () => {
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const response = getNavigationFallbackResponse(
      'where do photos go on this job',
      'operations',
      { type: 'job', id: jobId }
    )
    expect(response).toContain(`/ops/jobs/${jobId}`)
    expect(response).toContain('Photos & files')
    expect(response).toContain('/opportunities/[id]/report')
  })

  it('returns inside sales fallback', () => {
    const response = getNavigationFallbackResponse('where is inside sales', 'inside_sales')
    expect(response).toContain('/inside-sales')
  })

  it('returns referrals fallback with lead and customer paths', () => {
    const response = getNavigationFallbackResponse('where do referrals go', 'sales_rep')
    expect(response).toContain('/customers/')
    expect(response).toContain('/leads/[id]')
  })

  it('includes system prompt rules for empty links and photo disambiguation', () => {
    const prompt = buildAiChatSystemPrompt({ fullName: 'Nathan', role: 'owner' })
    expect(prompt).toMatch(/empty markdown links/i)
    expect(prompt).toMatch(/Photo-type disambiguation|disambiguate among/i)
    expect(prompt).toMatch(/Only cite App Router paths/i)
  })

  it('includes roof report suggestion chips for opportunity context', () => {
    const suggestions = generateContextualSuggestions('opportunity', 'opp-1')
    expect(suggestions.some((s) => s.toLowerCase().includes('roof report'))).toBe(true)
  })

  it('returns pricebook path for pricebook questions', () => {
    const response = getNavigationFallbackResponse('where is the pricebook', 'sales_rep')
    expect(response).toContain('/pricebook')
    expect(response).not.toBeNull()
  })
})
