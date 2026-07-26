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
    expect(prompt).toContain('you may cite those exact counts')
  })

  it('does not add aggregate citation rules without aggregate appendix', () => {
    const prompt = buildAiChatSystemPrompt({
      fullName: 'Alex',
      role: 'sales_rep',
    })
    expect(prompt).not.toContain('you may cite those exact counts')
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
})
