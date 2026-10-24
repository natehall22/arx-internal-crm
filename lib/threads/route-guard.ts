import { NextResponse } from 'next/server'

import { isThreadSchemaMissing, SCHEMA_PENDING_MESSAGE, ThreadSchemaPendingError } from '@/lib/threads/schema-guard'

export function schemaPendingResponse() {
  return NextResponse.json({ error: SCHEMA_PENDING_MESSAGE, code: 'schema_pending' }, { status: 503, headers: { 'Retry-After': '60' } })
}

/** Wraps a thread route handler: a missing-schema error becomes a 503 `schema_pending`; every other error still propagates. */
export function guardThreadSchema<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (e) {
      if (e instanceof ThreadSchemaPendingError || isThreadSchemaMissing(e)) return schemaPendingResponse()
      throw e
    }
  }
}
