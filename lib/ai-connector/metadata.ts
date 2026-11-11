import { AI_SCOPES } from '@/lib/ai-connector/config'
import { mcpResource } from '@/lib/ai-connector/urls'

/** RFC 9728 protected resource metadata for the MCP endpoint of this address. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...AI_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'CRM',
  }
}

/** RFC 8414 authorization server metadata. `issuer` equals the address exactly (clients compare it as a string). */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...AI_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }
}
