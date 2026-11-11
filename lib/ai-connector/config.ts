/**
 * AI connector — fixed settings. One place for scopes, lifetimes and the app addresses (OAuth redirect URIs) we trust.
 * Phase 1 is read-only: the only scope is `crm:read` (phase 2 adds `crm:write`, phase 3 `crm:upload`).
 */
export const AI_CONNECTOR_FEATURE = 'aiConnector' as const
export const AI_SCOPES = ['crm:read'] as const
export type AiScope = (typeof AI_SCOPES)[number]
export const DEFAULT_SCOPES: readonly AiScope[] = ['crm:read']

export const CODE_TTL_SECONDS = 10 * 60
export const ACCESS_TTL_SECONDS = 60 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

/** Token prefixes make a leaked key recognisable in logs and secret scanners. */
export const ACCESS_PREFIX = 'aat_'
export const REFRESH_PREFIX = 'art_'
export const CODE_PREFIX = 'aac_'
export const CLIENT_PREFIX = 'aic_'

/** Exact callback addresses of the AI apps we have verified against their own documentation (2026-11-11). */
export const BUILTIN_REDIRECT_URIS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
]
/** ChatGPT's per-connection callback (used when the sign-in server does not send `iss`): https://chatgpt.com/connector/oauth/<id>. */
export const CHATGPT_CALLBACK_ID = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/

/** What the consent screen calls an app, by where it sends the person back. Never taken from what the app says about itself. */
export const REDIRECT_APP_LABELS: ReadonlyArray<{ test: (uri: string) => boolean; label: string }> = [
  { test: (u) => u.startsWith('https://claude.ai/') || u.startsWith('https://claude.com/'), label: 'Claude' },
  { test: (u) => u.startsWith('https://chatgpt.com/'), label: 'ChatGPT' },
]

/** Sites allowed to call /mcp from a web page (Origin check). Server-to-server callers send no Origin. */
export const ALLOWED_BROWSER_ORIGINS: readonly string[] = ['https://claude.ai', 'https://claude.com', 'https://chatgpt.com']

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

export const MAX_TOOL_RESULT_CHARS = 24_000
export const RATE_LIMITS = {
  userPerMinute: 60,
  orgPerMinute: 300,
  tokenPerIpPerMinute: 30,
  registerPerIpPerMinute: 10,
} as const
