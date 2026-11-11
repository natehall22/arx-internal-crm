/**
 * AI connector — fixed settings. One place for scopes, lifetimes and the app addresses (OAuth redirect URIs) we trust.
 * `crm:read` looks things up. `crm:write` (phase 2) lets the AI PROPOSE a change; nothing is saved until the person confirms
 * that exact change (preview + one-time confirm key). It needs the company's separate "AI can make changes" switch AND the
 * person's own approval on the consent screen, and it is always capped by what the person may do in the app.
 * (Phase 3 adds `crm:upload`.)
 */
export const AI_CONNECTOR_FEATURE = 'aiConnector' as const
/** The owner's second switch: AI can make changes (default OFF). Needs `aiConnector` on as well. */
export const AI_WRITES_FEATURE = 'aiConnectorWrites' as const
export const AI_SCOPES = ['crm:read', 'crm:write'] as const
export type AiScope = (typeof AI_SCOPES)[number]
export const DEFAULT_SCOPES: readonly AiScope[] = ['crm:read']
export const WRITE_SCOPE: AiScope = 'crm:write'

/** A proposed change can be approved by the person for this long; after that it is gone and must be asked for again. */
export const CHANGE_TTL_SECONDS = 10 * 60
/** Unconfirmed proposals one person may hold at a time. */
export const MAX_PENDING_CHANGES = 20
/** Proposals nobody confirmed are deleted after this many days (applied changes are kept as the record). */
export const PENDING_CHANGE_KEEP_DAYS = 2
/** Failed changes are kept this long (never less than 30 days) so an owner can look at them. */
export const FAILED_CHANGE_KEEP_DAYS = 30
/** A change still `applying` after this long is stuck (a crash mid-save): a note is retried once, anything else goes to the owner. */
export const APPLY_STALE_SECONDS = 120
export const MAX_APPLY_ATTEMPTS = 2

export const CODE_TTL_SECONDS = 10 * 60
export const ACCESS_TTL_SECONDS = 60 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60
/** A connection ends this long after the person approved it, however often it refreshes. They approve again. */
export const GRANT_MAX_LIFETIME_SECONDS = 90 * 24 * 60 * 60
/** Apps that registered but never signed anyone in are deleted after this many days. */
export const UNUSED_CLIENT_DAYS = 7

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
/**
 * Limits count per app / person / company. The per-address numbers are only a loose backstop: Claude and ChatGPT send
 * every user's requests from a small shared set of addresses, so a tight per-address limit would lock real people out.
 */
export const RATE_LIMITS = {
  userPerMinute: 60,
  orgPerMinute: 300,
  clientTokenPerMinute: 120,
  /** Writes: asking for a preview is cheap, saving is the thing to bound. Per person and per company. */
  writePreviewPerMinute: 20,
  writeConfirmPerMinute: 10,
  writeConfirmPerDay: 200,
  orgWriteConfirmPerDay: 1000,
  tokenPerIpPerMinute: 1200,
  authorizePerIpPerMinute: 1200,
  registerPerIpPerMinute: 120,
  registerPerIpPerDay: 500,
  registerGlobalPerDay: 5000,
} as const
