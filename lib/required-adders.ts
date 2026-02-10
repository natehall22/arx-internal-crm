import type { EstimateLine, Project, PricebookItem } from '@/lib/types/database'

export interface RequiredAdderIssue {
  type: 'missing' | 'insufficient'
  message: string
  category: 'roofing' | 'siding' | 'windows'
  requiredItem?: {
    category: string
    itemType: string
    name: string
    unit: string
    minQty?: number
  }
}

export function validateRequiredAdders(
  lines: EstimateLine[],
  project: Project | null
): RequiredAdderIssue[] {
  const issues: RequiredAdderIssue[] = []

  if (!project) {
    return issues
  }

  // Check for Roof Install lines
  const hasRoofInstall = lines.some(
    (line) => line.category === 'roofing' && line.name.toLowerCase().includes('roof install')
  )

  // Check for Tear-off lines
  const hasTearoff = lines.some(
    (line) => line.category === 'roofing' && (line.name.toLowerCase().includes('tear-off') || line.name.toLowerCase().includes('tear off'))
  )

  // Check for Window Install lines
  const hasWindowInstall = lines.some(
    (line) => line.category === 'windows' && line.name.toLowerCase().includes('window install')
  )

  // ROOFING RULES
  if (hasRoofInstall) {
    // Require Dump/Haul Away
    const hasDumpHaul = lines.some(
      (line) =>
        (line.name.toLowerCase().includes('dump') || line.name.toLowerCase().includes('haul')) &&
        line.unit === 'job'
    )
    if (!hasDumpHaul) {
      issues.push({
        type: 'missing',
        message: 'Dump/Haul Away is required when Roof Install is present',
        category: 'roofing',
        requiredItem: {
          category: 'addons',
          itemType: 'dumpster',
          name: 'Dump/Haul Away',
          unit: 'job',
        },
      })
    }

    // Require Pipe Boots >= vents_count
    const pipeBootsLine = lines.find((line) =>
      line.name.toLowerCase().includes('pipe boot')
    )
    const pipeBootsQty = pipeBootsLine ? pipeBootsLine.qty : 0
    if (pipeBootsQty < (project.vents_count || 0)) {
      issues.push({
        type: 'insufficient',
        message: `Pipe Boots quantity (${pipeBootsQty}) must be at least ${project.vents_count} (vents count)`,
        category: 'roofing',
        requiredItem: {
          category: 'addons',
          itemType: 'addon',
          name: 'Pipe Boots',
          unit: 'each',
          minQty: project.vents_count || 0,
        },
      })
    }
  }

  if (hasTearoff) {
    // Require Clean-up/Magnetic Sweep
    const hasCleanup = lines.some(
      (line) =>
        (line.name.toLowerCase().includes('clean') ||
          line.name.toLowerCase().includes('magnetic') ||
          line.name.toLowerCase().includes('sweep')) &&
        line.unit === 'job'
    )
    if (!hasCleanup) {
      issues.push({
        type: 'missing',
        message: 'Clean-up/Magnetic Sweep is required when Tear-off is present',
        category: 'roofing',
        requiredItem: {
          category: 'addons',
          itemType: 'cleanup',
          name: 'Clean-up/Magnetic Sweep',
          unit: 'job',
        },
      })
    }
  }

  // WINDOWS RULES
  if (hasWindowInstall && project.total_windows > 0) {
    const windowDisposalLine = lines.find((line) =>
      line.name.toLowerCase().includes('window disposal')
    )
    const disposalQty = windowDisposalLine ? windowDisposalLine.qty : 0
    if (disposalQty < project.total_windows) {
      issues.push({
        type: 'insufficient',
        message: `Window Disposal quantity (${disposalQty}) must equal total windows (${project.total_windows})`,
        category: 'windows',
        requiredItem: {
          category: 'addons',
          itemType: 'disposal',
          name: 'Window Disposal',
          unit: 'each',
          minQty: project.total_windows,
        },
      })
    }
  }

  return issues
}
