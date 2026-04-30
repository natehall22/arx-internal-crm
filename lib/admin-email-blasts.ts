import type { SupabaseClient } from '@supabase/supabase-js'
import { getRoleDisplayName } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/database'

export type EmailBlastType = 'sale' | 'job_payment'

export type EmailBlastConfig = {
  enabled: boolean
  role_targets: string[]
  user_targets: string[]
}

export type OrgEmailBlastSettings = Record<EmailBlastType, EmailBlastConfig>

export type EmailBlastDefinition = {
  id: EmailBlastType
  title: string
  description: string
}

const ROLE_OPTIONS: UserRole[] = [
  'owner',
  'admin',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'sales_rep',
  'setter',
  'canvasser',
  'operations',
  'custom',
]

export const EMAIL_BLAST_ROLE_OPTIONS = ROLE_OPTIONS.map((role) => ({
  role,
  label: getRoleDisplayName(role),
}))

export const EMAIL_BLAST_DEFINITIONS: EmailBlastDefinition[] = [
  {
    id: 'sale',
    title: 'Sale Email',
    description: 'Sent when a sale is recorded or a contract is signed.',
  },
  {
    id: 'job_payment',
    title: 'Payment / Funding Email',
    description: 'Sent when a job payment is recorded, including paid-in-full updates.',
  },
]

const DEFAULT_EMAIL_BLAST_SETTINGS: OrgEmailBlastSettings = {
  sale: {
    enabled: true,
    role_targets: [
      'admin',
      'owner',
      'regional_manager',
      'regional_setter_manager',
      'sales_manager',
      'setter_manager',
      'sales_rep',
      'setter',
      'canvasser',
      'custom',
    ],
    user_targets: [],
  },
  job_payment: {
    enabled: true,
    role_targets: ['admin', 'operations'],
    user_targets: [],
  },
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    )
  )
}

function normalizeConfig(value: unknown, fallback: EmailBlastConfig): EmailBlastConfig {
  const obj = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const hasRoleTargets = Object.prototype.hasOwnProperty.call(obj, 'role_targets')
  const hasUserTargets = Object.prototype.hasOwnProperty.call(obj, 'user_targets')
  const roleTargets = normalizeStringArray(obj.role_targets).filter((role) =>
    EMAIL_BLAST_ROLE_OPTIONS.some((option) => option.role === role)
  )
  const userTargets = normalizeStringArray(obj.user_targets)

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled,
    role_targets: hasRoleTargets ? roleTargets : [...fallback.role_targets],
    user_targets: hasUserTargets ? userTargets : [...fallback.user_targets],
  }
}

export function getDefaultOrgEmailBlastSettings(): OrgEmailBlastSettings {
  return JSON.parse(JSON.stringify(DEFAULT_EMAIL_BLAST_SETTINGS)) as OrgEmailBlastSettings
}

export function getOrgEmailBlastSettings(settings: unknown): OrgEmailBlastSettings {
  const notificationSettings =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).notification_settings
      : null
  const emailBlasts =
    notificationSettings && typeof notificationSettings === 'object'
      ? (notificationSettings as Record<string, unknown>).email_blasts
      : null
  const raw = emailBlasts && typeof emailBlasts === 'object'
    ? emailBlasts as Record<string, unknown>
    : {}

  return {
    sale: normalizeConfig(raw.sale, DEFAULT_EMAIL_BLAST_SETTINGS.sale),
    job_payment: normalizeConfig(raw.job_payment, DEFAULT_EMAIL_BLAST_SETTINGS.job_payment),
  }
}

export function mergeOrgSettingsWithEmailBlasts(
  currentSettings: Record<string, unknown> | null | undefined,
  blasts: OrgEmailBlastSettings
): Record<string, unknown> {
  const settings = currentSettings && typeof currentSettings === 'object' ? currentSettings : {}
  const notificationSettings =
    settings.notification_settings && typeof settings.notification_settings === 'object'
      ? settings.notification_settings as Record<string, unknown>
      : {}

  return {
    ...settings,
    notification_settings: {
      ...notificationSettings,
      email_blasts: blasts,
    },
  }
}

export async function resolveEmailBlastRecipients(
  supabase: SupabaseClient,
  params: {
    orgId: string
    blastType: EmailBlastType
    settings?: OrgEmailBlastSettings
  }
): Promise<{ emails: string[]; users: Array<{ id: string; email: string; full_name: string | null; role: string | null }> }> {
  const settings = params.settings || getDefaultOrgEmailBlastSettings()
  const config = settings[params.blastType]

  if (!config?.enabled) {
    return { emails: [], users: [] }
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, active')
    .eq('org_id', params.orgId)
    .eq('active', true)

  if (error) {
    throw error
  }

  const users = (data || [])
    .filter((user) => {
      const email = typeof user.email === 'string' ? user.email.trim() : ''
      if (!email.includes('@')) return false
      return config.user_targets.includes(user.id) || config.role_targets.includes(String(user.role || ''))
    })
    .map((user) => ({
      id: user.id as string,
      email: String(user.email).trim().toLowerCase(),
      full_name: (user.full_name as string | null) ?? null,
      role: (user.role as string | null) ?? null,
    }))

  const uniqueUsers = Array.from(new Map(users.map((user) => [user.email, user])).values())

  return {
    emails: uniqueUsers.map((user) => user.email),
    users: uniqueUsers,
  }
}
