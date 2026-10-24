/**
 * A small in-memory stand-in for the Supabase client, enough for the payroll pipeline (select / insert / upsert / update /
 * delete with eq, neq, in, is, lt/lte/gt/gte, not, or, order, limit, range, single, maybeSingle) plus `rpc`. Unknown
 * tables are empty. Every write is logged so a test can compare what two code paths wrote.
 */
type Row = Record<string, unknown>
export type WriteLog = Array<{ table: string; op: 'insert' | 'upsert' | 'update' | 'delete'; rows: Row[] }>

export function createFakeDb(
  seed: Record<string, Row[]>,
  opts: { relations?: Record<string, Record<string, { table: string; fk: string }>>; rpc?: Record<string, (args: Record<string, unknown>, tables: Record<string, Row[]>) => unknown> } = {}
) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const writes: WriteLog = []
  let autoId = 1
  const rel = opts.relations ?? {}

  const matchOr = (row: Row, expr: string) =>
    expr.split(',').some((part) => {
      const m = part.trim().match(/^([a-z_]+)\.(is|gte|lte|gt|lt|eq|neq)\.(.*)$/i)
      if (!m) return true
      const [, col, op, rawVal] = m
      const val = rawVal.replace(/^"|"$/g, '')
      const cell = row[col]
      if (op === 'is') return val === 'null' ? cell == null : cell === (val === 'true')
      return cmp(cell, op, val)
    })
  const cmp = (cell: unknown, op: string, val: unknown) => {
    if (cell == null) return false
    const a = cell as never
    const b = val as never
    switch (op) {
      case 'eq': return a === b
      case 'neq': return a !== b
      case 'gte': return a >= b
      case 'lte': return a <= b
      case 'gt': return a > b
      case 'lt': return a < b
    }
    return true
  }

  function builder(table: string) {
    let rows = (tables[table] ??= [])
    let filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let onConflict: string | null = null
    let orderBy: Array<{ col: string; asc: boolean }> = []
    let lim: number | null = null
    let range: [number, number] | null = null
    let single: 'one' | 'maybe' | null = null
    let selectCols = '*'
    let head = false
    let count = false

    const embed = (r: Row): Row => {
      const out = { ...r }
      for (const m of Array.from(selectCols.matchAll(/([a-z_]+)\(([^)]*)\)/g))) {
        const name = m[1]
        const rl = rel[table]?.[name]
        if (rl) out[name] = (tables[rl.table] ?? []).find((x) => x.id === r[rl.fk]) ?? null
      }
      return out
    }
    const run = () => {
      let data: Row[]
      if (op === 'insert') {
        data = payload.map((p) => ({ id: p.id ?? `gen-${autoId++}`, ...p }))
        rows.push(...data)
        writes.push({ table, op, rows: data })
      } else if (op === 'upsert') {
        const keys = (onConflict ?? 'id').split(',')
        data = payload.map((p) => {
          const hit = rows.find((r) => keys.every((k) => r[k] === p[k]))
          if (hit) { Object.assign(hit, p); return hit }
          const n = { id: p.id ?? `gen-${autoId++}`, ...p }
          rows.push(n)
          return n
        })
        writes.push({ table, op, rows: data.map((d) => ({ ...d })) })
      } else if (op === 'update') {
        data = rows.filter((r) => filters.every((f) => f(r)))
        data.forEach((r) => Object.assign(r, patch))
        writes.push({ table, op, rows: data.map((d) => ({ ...d, ...patch })) })
      } else if (op === 'delete') {
        data = rows.filter((r) => filters.every((f) => f(r)))
        tables[table] = rows = rows.filter((r) => !data.includes(r))
        writes.push({ table, op, rows: data })
      } else {
        data = rows.filter((r) => filters.every((f) => f(r)))
        for (const o of [...orderBy].reverse()) data = [...data].sort((a, b) => (String(a[o.col] ?? '') < String(b[o.col] ?? '') ? -1 : 1) * (o.asc ? 1 : -1))
      }
      const total = data.length
      if (range) data = data.slice(range[0], range[1] + 1)
      if (lim != null) data = data.slice(0, lim)
      const shaped = op === 'select' ? data.map(embed) : data
      if (single) return { data: shaped[0] ?? null, error: null, count: total }
      return { data: head ? null : shaped, error: null, count: count ? total : null }
    }
    const api: Record<string, unknown> = {
      select(cols = '*', o?: { count?: string; head?: boolean }) { if (op === 'select') selectCols = cols; head = !!o?.head; count = !!o?.count; return api },
      insert(p: Row | Row[]) { op = 'insert'; payload = Array.isArray(p) ? p : [p]; return api },
      upsert(p: Row | Row[], o?: { onConflict?: string }) { op = 'upsert'; payload = Array.isArray(p) ? p : [p]; onConflict = o?.onConflict ?? null; return api },
      update(p: Row) { op = 'update'; patch = p; return api },
      delete() { op = 'delete'; return api },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return api },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return api },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return api },
      is(c: string, v: unknown) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return api },
      not(c: string, o: string, v: unknown) { filters.push((r) => (o === 'is' ? !(v === null ? r[c] == null : r[c] === v) : o === 'in' ? !String(v).replace(/[()]/g, '').split(',').includes(String(r[c])) : true)); return api },
      lt(c: string, v: unknown) { filters.push((r) => cmp(r[c], 'lt', v)); return api },
      lte(c: string, v: unknown) { filters.push((r) => cmp(r[c], 'lte', v)); return api },
      gt(c: string, v: unknown) { filters.push((r) => cmp(r[c], 'gt', v)); return api },
      gte(c: string, v: unknown) { filters.push((r) => cmp(r[c], 'gte', v)); return api },
      or(expr: string) { filters.push((r) => matchOr(r, expr)); return api },
      order(c: string, o?: { ascending?: boolean }) { orderBy.push({ col: c, asc: o?.ascending !== false }); return api },
      limit(n: number) { lim = n; return api },
      range(a: number, b: number) { range = [a, b]; return api },
      maybeSingle() { single = 'maybe'; return Promise.resolve(run()) },
      single() { single = 'one'; return Promise.resolve(run()) },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej) },
    }
    return api
  }

  return {
    client: { from: (t: string) => builder(t), rpc: async (name: string, args: Record<string, unknown>) => {
      const fn = opts.rpc?.[name]
      if (!fn) return { data: null, error: null }
      // A handler that throws is a Postgres exception: everything it wrote is rolled back (one transaction).
      const before = JSON.parse(JSON.stringify(tables)) as Record<string, Row[]>
      try {
        return { data: fn(args, tables) ?? null, error: null }
      } catch (e) {
        for (const k of Object.keys(tables)) delete tables[k]
        Object.assign(tables, before)
        return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }
      }
    } } as never,
    tables,
    writes,
  }
}
