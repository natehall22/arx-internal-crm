import fs from 'fs'
import path from 'path'

import { SEQUENTIAL_DIGITS, SEQUENTIAL_DIGITS_DESC, TEST_CUSTOMER_NAME_SOURCE } from '@/lib/customers'

// The SQL backfill cannot import the TS helper, so its copy of the filler-phone / test-name rule is pinned to it here.
const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/data-fixes/2026-10-27_link_orphan_opportunities.sql'), 'utf8')

describe('SQL backfill carries the same placeholder rules as lib/customers.ts', () => {
  it('same sequential-digit strings', () => {
    expect(sql).toContain(`'${SEQUENTIAL_DIGITS}'`)
    expect(sql).toContain(`'${SEQUENTIAL_DIGITS_DESC}'`)
  })

  it('same test-name pattern (Postgres \\y is the word boundary \\b)', () => {
    expect(sql).toContain(TEST_CUSTOMER_NAME_SOURCE.replace('\\b', '\\y'))
  })

  it('the backfill no longer keeps its own filler list', () => {
    expect(sql).not.toContain("IN ('1234567890','0123456789')")
    expect(sql).toContain('release_backups.is_placeholder_phone(l.phone)')
  })
})
