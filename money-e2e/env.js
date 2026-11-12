// Points every createServiceClient() at the local PostgREST (via the /rest/v1 prefix proxy) with a service_role token signed for it.
const crypto = require('crypto')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const head = b64({ alg: 'HS256', typ: 'JWT' })
const body = b64({ role: 'service_role', iss: 'supabase' })
const secret = process.env.MONEY_JWT_SECRET || 'money-e2e-secret-money-e2e-secret-0123456789'
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.MONEY_REST_URL || 'http://127.0.0.1:3098'
process.env.SUPABASE_SERVICE_ROLE_KEY = `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
process.env.TZ = 'UTC'
