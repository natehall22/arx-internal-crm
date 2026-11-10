#!/usr/bin/env node
// Org-scope check: blocks NEW database queries on company-owned tables that are not limited to one company.
// The service-role client skips row-level security, so the only thing keeping company A out of company B's rows is the
// query itself. With ONE shared database for every company, one missed filter is a cross-company leak.
// Existing findings are grandfathered per FILE in scripts/org-scope-baseline.json; a file may never hold more than its
// baseline (a new file holds none), and the baseline may never be higher than the one on origin/main.
//
//   node scripts/org-scope-check.mjs            check (gate)
//   node scripts/org-scope-check.mjs --list     print every finding (file:line table op)
//   node scripts/org-scope-check.mjs --update   shrink the baseline after you fixed findings
//
// THE RULE (read by the TypeScript parser, not regex). A query chain `<x>.from('<company table>')` passes when ANY of:
//   1. it filters the company: .eq('org_id', …) | .in('org_id', …) | .filter('org_id', …) | .match({ org_id: … }),
//      anywhere in the chain or on the same builder variable later in the same function (`q = q.eq('org_id', …)`);
//   2. it goes through the scoped helper: orgDb(client, orgId).from(…) (lib/supabase/org-db.ts) — scoped by construction;
//   3. it filters by a value that was itself loaded company-scoped in the same function: the value's root variable is
//      `{ data: x }` from a chain that passes this rule, an alias / for-of item / array-callback item of such a variable,
//      or the signed-in caller (`await requireAuth()` / `requireAuthApi()` / `getAuthContext()`). A filter by a URL id,
//      a request body field or a function parameter does NOT pass — that is the hole this check exists for;
//   4. it is an insert: org_id is NOT NULL on every listed table, so the database already refuses a row with no company
//      (which company is set is the writer's job; this check cannot see it);
//   6. it filters by a secret-token column (token, signing_token, *_token_hash, webhook_token): a public link or webhook
//      reaches exactly the row its secret names, in whichever company owns it — that is the design;
//   5. it carries a reason: `// org-scope-ok: <why>` on the .from(…) line, or between the line above the statement and it (e.g. a cron that works
//      every company on purpose, or a row reached by a signed token). The reason must say why.
// An upsert (INSERT … ON CONFLICT DO UPDATE) can overwrite and re-home another company's row on its conflict key, so it
// passes only when its literal onConflict includes org_id, or with 5 (say how the key was checked first).
// .rpc(…) calls are not checked (SQL functions must scope themselves). Client components ('use client') are skipped:
// they only have the browser client, which row-level security limits.
//
// Company tables = every table with an org_id column in supabase/migrations (numbered files only) plus EXTRA_TABLES
// below (tables that exist in the live database but were created outside the migration files; checked against
// information_schema 2026-11-10).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
const ts = createRequire(import.meta.url)('typescript')

const BASELINE = 'scripts/org-scope-baseline.json'
const EXTRA_TABLES = ['appointment_types', 'estimate_line_items', 'job_cost_order_migration_log', 'payroll_statement_deliveries', 'projects']
const FILTER_METHODS = new Set(['eq', 'in', 'filter', 'match'])
const OPS = ['select', 'insert', 'update', 'upsert', 'delete']
// Calls that return the signed-in caller's own identity (lib/auth.ts, lib/supabase-api-request-auth.ts, lib/threads/api.ts).
const AUTH_CALLS = new Set(['requireAuth', 'requireAuthApi', 'getAuthContext', 'resolveApiRequestAuthUser', 'threadAuth'])
// Columns that hold a random secret handed to one outside party (signing links, review links, webhooks).
const SECRET_TOKEN_COLUMN = /^(token|[a-z_]*_token|[a-z_]*_token_hash)$/
const ALLOW = /org-scope-ok:\s*\S.{2,}/
// Factories that return a client carrying the signed-in user's token (row-level security applies). A chain on one of
// these is not checked; RLS policies are their own audit. Anything else (the service client, a function parameter of
// unknown origin) IS checked. Ignored in a file that reads the service key, where createClient may be service-role.
const RLS_FACTORIES = new Set(['createClient', 'createServerClient', 'createClientBrowser', 'getClientBrowser', 'createRequestScopedClient', 'createAnonClient', 'getAuthClient'])

// ---------- company tables from migrations ----------
export function orgTablesFromMigrations(dir = 'supabase/migrations') {
  const tables = new Map()
  const norm = (s) => s.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
  for (const f of readdirSync(dir).filter((f) => /^\d.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').replace(/--[^\n]*/g, '')
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi
    let m
    while ((m = create.exec(sql))) {
      let i = create.lastIndex
      let depth = 1
      while (i < sql.length && depth) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') depth--
        i++
      }
      const name = norm(m[1])
      if (name.includes('.')) continue
      const hasOrg = /(^|,|\()\s*org_id\s/im.test(sql.slice(create.lastIndex, i - 1))
      if (hasOrg || !tables.has(name)) tables.set(name, hasOrg || tables.get(name) === true)
    }
    const add = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?org_id\s/gi
    while ((m = add.exec(sql))) if (!norm(m[1]).includes('.')) tables.set(norm(m[1]), true)
    const drop = /drop\s+table\s+(?:if\s+exists\s+)?([\w."]+)/gi
    while ((m = drop.exec(sql))) tables.delete(norm(m[1]))
  }
  return new Set([...[...tables].filter(([, v]) => v).map(([k]) => k), ...EXTRA_TABLES])
}

// ---------- files ----------
const INCLUDE = /^(app|lib|components|hooks|middleware\.ts|supabase\/functions)(\/|$)/
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const EXCLUDE = /(^|\/)(__tests__|__mocks__|e2e|test-helpers)\/|\.(test|spec)\.[a-z]+$|\.d\.ts$/

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  return [...new Set(out.split('\0'))].filter((f) => f && INCLUDE.test(f) && EXT.test(f) && !EXCLUDE.test(f) && existsSync(f))
}

// ---------- analysis ----------
const strip = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))))
    n = n.expression
  return n
}
const strLit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null)
const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n)

/** Method calls hanging off `node`: node.a(..).b(..) -> [{name:'a',args},{name:'b',args}], plus the outermost node. */
function chainUp(node) {
  const calls = []
  let cur = node
  while (cur.parent && ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur && cur.parent.parent && ts.isCallExpression(cur.parent.parent) && cur.parent.parent.expression === cur.parent) {
    calls.push({ name: cur.parent.name.text, args: cur.parent.parent.arguments, node: cur.parent.parent })
    cur = cur.parent.parent
  }
  return { calls, top: cur }
}

/** Walks down a call chain to its `.from(...)` call, if any. */
function fromCallBelow(expr) {
  let n = strip(expr)
  while (n && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    if (n.expression.name.text === 'from') return n
    n = strip(n.expression.expression)
  }
  return null
}

/** Root identifier of a value: job.id -> job, rows.map(r => r.id) -> rows, ids[0] -> ids, auth.profile.org_id -> auth. */
function rootIdent(n) {
  n = strip(n)
  for (;;) {
    if (!n) return null
    if (ts.isIdentifier(n)) return n
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = strip(n.expression)
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) n = strip(n.expression.expression)
    else if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) n = strip(n.left)
    else return null
  }
}

function scopeOf(node) {
  let p = node.parent
  while (p && !(ts.isBlock(p) || ts.isSourceFile(p) || isFn(p) || ts.isForOfStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isCatchClause(p))) p = p.parent
  return p
}
const contains = (outer, inner) => inner.pos >= outer.pos && inner.end <= outer.end

function analyzeFile(file, text, orgTables) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const first = sf.statements[0]
  if (first && ts.isExpressionStatement(first) && strLit(first.expression) === 'use client') return []
  const lines = text.split('\n')

  // name -> [{ nameNode, kind, init, scope, decl }]
  const decls = new Map()
  const addDecl = (nameNode, kind, init, decl) => {
    if (!nameNode || !ts.isIdentifier(nameNode)) return
    const arr = decls.get(nameNode.text) || []
    arr.push({ nameNode, kind, init, scope: scopeOf(decl), decl })
    decls.set(nameNode.text, arr)
  }
  const fromCalls = []
  ;(function visit(n) {
    if (ts.isVariableDeclaration(n)) {
      if (ts.isIdentifier(n.name)) addDecl(n.name, 'var', n.initializer, n)
      else if (ts.isObjectBindingPattern(n.name))
        for (const el of n.name.elements) {
          const prop = el.propertyName ? el.propertyName.getText(sf) : ts.isIdentifier(el.name) ? el.name.text : ''
          if (ts.isIdentifier(el.name)) addDecl(el.name, 'prop:' + prop, n.initializer, n)
          else if (ts.isObjectBindingPattern(el.name))
            for (const inner of el.name.elements) if (ts.isIdentifier(inner.name)) addDecl(inner.name, 'prop:' + prop, n.initializer, n)
        }
      else if (ts.isArrayBindingPattern(n.name)) {
        // const [{ data: a }, { data: b }] = await Promise.all([chainA, chainB]) — each element binds to its own chain
        const init = n.initializer && strip(n.initializer)
        const all =
          init && ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'all' && init.arguments[0] && ts.isArrayLiteralExpression(init.arguments[0])
            ? init.arguments[0].elements
            : null
        n.name.elements.forEach((el, i) => {
          if (ts.isOmittedExpression(el)) return
          if (ts.isIdentifier(el.name)) addDecl(el.name, 'item', n.initializer, n)
          else if (ts.isObjectBindingPattern(el.name) && all && all[i])
            for (const inner of el.name.elements) {
              const prop = inner.propertyName ? inner.propertyName.getText(sf) : ts.isIdentifier(inner.name) ? inner.name.text : ''
              if (ts.isIdentifier(inner.name)) addDecl(inner.name, 'prop:' + prop, all[i], n)
            }
        })
      }
    }
    if (ts.isParameter(n)) {
      const fn = n.parent
      // array callback item: rows.map((r) => …) / rows.forEach(r => …)
      const call = fn && fn.parent && ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn) ? fn.parent : null
      const recv = call && ts.isPropertyAccessExpression(call.expression) && /^(map|forEach|filter|flatMap|find|some|every|reduce)$/.test(call.expression.name.text) ? call.expression.expression : null
      if (ts.isIdentifier(n.name)) {
        const d = { nameNode: n.name, kind: recv ? 'item' : 'param', init: recv, scope: fn, decl: n }
        const arr = decls.get(n.name.text) || []
        arr.push(d)
        decls.set(n.name.text, arr)
      }
    }
    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer))
      for (const d of n.initializer.declarations) if (ts.isIdentifier(d.name)) {
        const arr = decls.get(d.name.text) || []
        arr.push({ nameNode: d.name, kind: 'item', init: n.expression, scope: n, decl: d })
        decls.set(d.name.text, arr)
      }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'from') {
      const table = strLit(n.arguments[0])
      const recv = n.expression.expression
      const storage = (ts.isPropertyAccessExpression(recv) && recv.name.text === 'storage') || (ts.isIdentifier(recv) && /storage|bucket/i.test(recv.text))
      if (table && orgTables.has(table) && !storage) fromCalls.push({ call: n, table })
    }
    ts.forEachChild(n, visit)
  })(sf)

  const resolve = (id) => {
    const cands = (decls.get(id.text) || []).filter((d) => d.nameNode !== id && d.scope && contains(d.scope, id))
    cands.sort((a, b) => b.scope.pos - a.scope.pos)
    return cands[0] || null
  }

  const readsServiceKey = text.includes('SUPABASE_SERVICE_ROLE_KEY')
  const callName = (n) => {
    n = strip(n)
    if (!n || !ts.isCallExpression(n)) return null
    const e = n.expression
    return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null
  }
  function rlsClient(recv) {
    if (readsServiceKey) return false
    if (RLS_FACTORIES.has(callName(recv))) return true
    let id = ts.isPropertyAccessExpression(recv) ? null : recv
    for (let i = 0; id && ts.isIdentifier(id) && i < 4; i++) {
      const d = resolve(id)
      if (!d || !d.init || d.kind === 'param' || d.kind === 'item') return false
      if (RLS_FACTORIES.has(callName(d.init))) return true
      const init = strip(d.init)
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) return rlsWrapper(init.expression)
      id = init
    }
    return false
  }

  // A function in this file whose body signs the caller in (an AUTH_CALLS call or x.auth.getUser), directly or through
  // another such local function: what it returns is the caller's own identity. Same idea for local functions that only
  // ever build a user-token client (RLS) and never the service client.
  const AUTH_BODY = new RegExp(`\\b(${[...AUTH_CALLS].join('|')})\\s*\\(|\\.auth\\.getUser\\s*\\(`)
  const RLS_BODY = new RegExp(`\\b(${[...RLS_FACTORIES].join('|')})\\s*\\(`)
  function localFnText(id) {
    if (!id || !ts.isIdentifier(id)) return null
    const fn = sf.statements.find((st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === id.text)
    if (fn) return fn.getText(sf)
    const d = resolve(id)
    const init = d && d.init && strip(d.init)
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init.getText(sf) : null
  }
  function bodyMatches(id, re, seen = new Set()) {
    const text = localFnText(id)
    if (!text || seen.has(id.text)) return false
    seen.add(id.text)
    if (re.test(text)) return true
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (m[1] === id.text) continue
      const fake = ts.factory.createIdentifier(m[1])
      if (sf.statements.some((st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === m[1]) && bodyMatches(fake, re, seen)) return true
    }
    return false
  }
  const authWrapper = (id) => bodyMatches(id, AUTH_BODY)
  const rlsWrapper = (id) => {
    const text = localFnText(id)
    return !!text && !/createServiceClient|admin|service/i.test(text) && bodyMatches(id, RLS_BODY)
  }

  // `let profile; … profile = x.profile` / `;({ profile } = await requireAuthApi())`: every assignment must be org-loaded.
  function assignedOrgLoaded(name, d, depth) {
    const rhs = []
    ;(function walk(n) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = n.left
        if (ts.isIdentifier(left) && left.text === name) rhs.push(n.right)
        else if (ts.isObjectLiteralExpression(left) && left.properties.some((p) => (ts.isShorthandPropertyAssignment(p) && p.name.text === name) || (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer) && p.initializer.text === name))) rhs.push(n.right)
      }
      ts.forEachChild(n, walk)
    })(d.scope)
    if (!rhs.length) return false
    return rhs.every((r) => {
      const e = strip(r)
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && (AUTH_CALLS.has(e.expression.text) || authWrapper(e.expression))) return true
      const fc = fromCallBelow(e)
      if (fc) return chainScoped(fc, depth + 1)
      const root = rootIdent(e)
      return !!root && root.text !== name && orgLoaded(root, depth + 1)
    })
  }

  function scopedLocalLoader(name, depth) {
    let fnNode = sf.statements.find((st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === name)
    if (!fnNode) {
      for (const st of sf.statements)
        if (ts.isVariableStatement(st))
          for (const dcl of st.declarationList.declarations)
            if (ts.isIdentifier(dcl.name) && dcl.name.text === name && dcl.initializer && (ts.isArrowFunction(dcl.initializer) || ts.isFunctionExpression(dcl.initializer))) fnNode = dcl.initializer
    }
    if (!fnNode) return false
    const inside = fromCalls.filter(({ call }) => contains(fnNode, call))
    return inside.length > 0 && inside.every(({ call }) => chainScoped(call, depth + 1))
  }

  const memo = new Map()
  // Is the value rooted at `id` something loaded company-scoped (or the signed-in caller)?
  function orgLoaded(id, depth = 0) {
    if (!id || depth > 6) return false
    const d = resolve(id)
    if (d && !d.init && d.kind === 'var') return assignedOrgLoaded(id.text, d, depth)
    if (!d || !d.init) return false
    const init = strip(d.init)
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && (AUTH_CALLS.has(init.expression.text) || authWrapper(init.expression))) return true
    // the signed-in user from a token check: (await x.auth.getUser(token)).data.user
    if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'getUser' && ts.isPropertyAccessExpression(strip(init.expression.expression)) && strip(init.expression.expression).name.text === 'auth') return true
    // a local loader: `const partner = await loadPartner(supabase, orgId, id)` where every company-table query inside
    // loadPartner passes this rule
    if ((d.kind === 'var' || d.kind === 'prop:data') && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && scopedLocalLoader(init.expression.text, depth)) return true
    if (d.kind === 'prop:data' || d.kind === 'var' || d.kind === 'item') {
      const fc = fromCallBelow(init)
      if (fc && d.kind !== 'item') return chainScoped(fc, depth + 1)
      const r = rootIdent(init)
      if (r) return orgLoaded(r, depth + 1)
    }
    if (d.kind.startsWith('prop:')) {
      const r = rootIdent(init)
      if (r) return orgLoaded(r, depth + 1)
    }
    return false
  }

  function isScopeFilter(c, depth) {
    if (!FILTER_METHODS.has(c.name)) return false
    if (c.name === 'match') {
      const o = strip(c.args[0])
      return !!o && ts.isObjectLiteralExpression(o) && o.properties.some((p) => p.name && p.name.getText(sf).replace(/['"]/g, '') === 'org_id')
    }
    const col = strLit(c.args[0])
    if (col === 'org_id') return true
    // rule 6: reached by an unguessable secret (signing / review / webhook token or its hash): the token IS the access
    if (col && SECRET_TOKEN_COLUMN.test(col)) return true
    const val = c.name === 'filter' ? c.args[2] : c.args[1]
    return !!val && (orgLoaded(rootIdent(val), depth) || verifiedEarlier(val, c.node, depth))
  }

  // Rule 3b: the same value was already matched by an EARLIER company-scoped load in the same function, and the function
  // bails (return/throw) when that load comes back empty — e.g. load the appointment with .eq('id', params.id)
  // .eq('org_id', org), `if (!appt) return 404`, then update .eq('id', params.id).
  const enclosingFn = (n) => {
    let p = n.parent
    while (p && !isFn(p) && !ts.isSourceFile(p)) p = p.parent
    return p
  }
  const norm = (n) => n.getText(sf).replace(/\s+/g, '').replace(/\?\./g, '.')
  // return / throw / notFound() / redirect() inside a statement (not inside a nested function)
  function bails(stmt) {
    let yes = false
    ;(function b(x) {
      if (ts.isReturnStatement(x) || ts.isThrowStatement(x)) yes = true
      else if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && /^(notFound|redirect|permanentRedirect)$/.test(x.expression.text)) yes = true
      else if (!isFn(x)) ts.forEachChild(x, b)
    })(stmt)
    return yes
  }
  // Variables holding a chain's rows: `const { data: X } = await <chain>` or `= await <builderVar>.single()`.
  function dataVarsOf(fromCall) {
    const out = []
    const fromDecl = (decl) => {
      if (!decl || !ts.isVariableDeclaration(decl) || !ts.isObjectBindingPattern(decl.name)) return
      for (const el of decl.name.elements) {
        const prop = el.propertyName ? el.propertyName.getText(sf) : ts.isIdentifier(el.name) ? el.name.text : ''
        if (prop === 'data' && ts.isIdentifier(el.name)) out.push({ name: el.name.text, declEnd: decl.end })
      }
    }
    const { top } = chainUp(fromCall)
    let holder = top
    while (holder.parent && (ts.isAwaitExpression(holder.parent) || ts.isParenthesizedExpression(holder.parent))) holder = holder.parent
    if (holder.parent && ts.isVariableDeclaration(holder.parent) && holder.parent.initializer === holder) {
      const decl = holder.parent
      if (ts.isIdentifier(decl.name)) {
        // builder variable: find `{ data } = await <name>...`
        const bname = decl.name.text
        ;(function walk(n) {
          if (ts.isVariableDeclaration(n) && n.initializer && n !== decl) {
            const r = rootIdent(n.initializer)
            if (r && r.text === bname) fromDecl(n)
          }
          ts.forEachChild(n, walk)
        })(enclosingFn(fromCall))
      } else fromDecl(decl)
    }
    return out
  }
  // Rule 3c: load by id, then `if (!X || X.org_id !== profile.org_id) return 404` BEFORE anything else touches X (the
  // next statements of the same block that mention X may only be empty-checks that bail, then the company check).
  function orgCheckedAfterLoad(fromCall) {
    const { top } = chainUp(fromCall)
    let stmt = top
    while (stmt && !ts.isVariableStatement(stmt)) stmt = stmt.parent
    if (!stmt || !stmt.parent || !('statements' in stmt.parent)) return false
    const siblings = stmt.parent.statements
    return dataVarsOf(fromCall).some(({ name }) => {
      const mentions = new RegExp(`\\b${name}\\b`)
      const orgCheck = new RegExp(`\\b${name}(\\?)?\\.org_id\\s*!==?`)
      const emptyCheck = new RegExp(`^(!\\s*${name}|${name}\\s*[=!]==?\\s*(null|undefined)|[\\w$]+\\s*\\|\\|\\s*!\\s*${name})$`)
      for (let i = siblings.indexOf(stmt) + 1; i < siblings.length; i++) {
        const st = siblings[i]
        if (!mentions.test(st.getText(sf))) continue
        if (!ts.isIfStatement(st) || !bails(st.thenStatement)) return false
        const cond = st.expression.getText(sf).replace(/\s+/g, ' ').trim()
        if (orgCheck.test(cond)) return !cond.includes('&&') // 'a && b' would let some callers through
        if (!emptyCheck.test(cond)) return false
      }
      return false
    })
  }

  // `if (X) { …here… }` / `if (X?.id && …) { …here… }`: only runs when the scoped load found the row.
  function insideTruthyIf(atNode, name, declEnd) {
    for (let p = atNode.parent; p && !isFn(p); p = p.parent) {
      if (ts.isIfStatement(p) && p.pos >= declEnd && contains(p.thenStatement, atNode)) {
        const conj = p.expression.getText(sf).split('&&').map((x) => x.trim().replace(/^\(|\)$/g, ''))
        if (conj.some((c) => new RegExp(`^${name}((\\?)?\\.[\\w$]+)*$`).test(c))) return true
      }
    }
    return false
  }
  function verifiedEarlier(val, atNode, depth) {
    if (depth > 4) return false
    const fn = enclosingFn(atNode)
    const want = norm(val)
    for (const { call } of fromCalls) {
      if (call.pos >= atNode.pos || enclosingFn(call) !== fn) continue
      const calls = builderCalls(call).all
      const valOf = (c) => (c.name === 'filter' ? c.args[2] : c.args[1])
      const matches = calls.some((c) => FILTER_METHODS.has(c.name) && c.name !== 'match' && valOf(c) && norm(valOf(c)) === want)
      if (!matches || !calls.some((c) => c.name === 'select')) continue
      if (!chainScoped(call, depth + 1)) continue
      // result bound to `{ data: X }` (directly, or from the builder variable) and checked empty with a bail before use
      const guarded = dataVarsOf(call).some(({ name, declEnd }) =>
        insideTruthyIf(atNode, name, declEnd) ||
        (function find(n) {
          if (n.pos > atNode.pos) return false
          if (ts.isIfStatement(n) && n.pos >= declEnd && new RegExp(`!\\s*${name}\\b|\\b${name}\\s*[=!]==?\\s*(null|undefined)`).test(n.expression.getText(sf)) && bails(n.thenStatement)) return true
          return ts.forEachChild(n, find) || false
        })(fn),
      )
      if (guarded) return true
    }
    return false
  }

  // An upsert is INSERT … ON CONFLICT DO UPDATE: on a key another company owns it overwrites (and re-homes) their row,
  // whatever org_id the payload carries. Only a conflict target that includes org_id keeps it inside one company.
  function upsertConflictHasOrg(c) {
    const opts = c && strip(c.args[1])
    if (!opts || !ts.isObjectLiteralExpression(opts)) return false
    const oc = opts.properties.find((p) => p.name && p.name.getText(sf) === 'onConflict')
    const v = oc && ts.isPropertyAssignment(oc) ? strLit(oc.initializer) : null
    return !!v && v.split(',').map((x) => x.trim()).includes('org_id')
  }

  // …or a conflict-key value in a literal payload is itself company-checked (rule 3 / 3b): the conflicting row then points
  // at one of this company's rows (or its signed-in user), so it is this company's row. E.g.
  // upsert({ org_id, job_id: params.id, … }, { onConflict: 'job_id' }) after the job was loaded with .eq('org_id').
  function upsertKeysVerified(c, depth) {
    const opts = c && strip(c.args[1])
    let cols = ['id']
    if (opts && ts.isObjectLiteralExpression(opts)) {
      const oc = opts.properties.find((p) => p.name && p.name.getText(sf) === 'onConflict')
      if (oc) {
        const v = ts.isPropertyAssignment(oc) ? strLit(oc.initializer) : null
        if (!v) return false
        cols = v.split(',').map((x) => x.trim())
      }
    }
    const payload = strip(c.args[0])
    const objs = payload && ts.isArrayLiteralExpression(payload) ? payload.elements.map(strip) : [payload]
    if (!objs.length || !objs.every((o) => o && ts.isObjectLiteralExpression(o))) return false
    return objs.every((o) =>
      cols.some((col) => {
        const prop = o.properties.find((p) => p.name && p.name.getText(sf).replace(/['"]/g, '') === col)
        if (!prop) return false
        const val = ts.isShorthandPropertyAssignment(prop) ? prop.name : ts.isPropertyAssignment(prop) ? prop.initializer : null
        return !!val && (orgLoaded(rootIdent(val), depth) || verifiedEarlier(val, c.node, depth))
      }),
    )
  }

  function payloadHasOrg(arg) {
    const a = strip(arg)
    if (!a) return false
    const objHas = (o) => ts.isObjectLiteralExpression(o) && o.properties.some((p) => p.name && p.name.getText(sf).replace(/['"]/g, '') === 'org_id')
    if (ts.isObjectLiteralExpression(a)) return objHas(a)
    if (ts.isArrayLiteralExpression(a)) return a.elements.length > 0 && a.elements.every((e) => objHas(strip(e)))
    return false
  }

  // All method calls applied to this builder, following `const q = <chain>` / `q = q.eq(…)` in the same function.
  function builderCalls(fromCall) {
    const { calls, top } = chainUp(fromCall)
    const all = [...calls]
    let holder = top
    while (holder.parent && (ts.isParenthesizedExpression(holder.parent) || ts.isAsExpression(holder.parent) || ts.isNonNullExpression(holder.parent))) holder = holder.parent
    let name = null
    if (ts.isVariableDeclaration(holder.parent) && holder.parent.initializer === holder && ts.isIdentifier(holder.parent.name)) name = holder.parent.name
    else if (ts.isBinaryExpression(holder.parent) && holder.parent.right === holder && holder.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(holder.parent.left)) name = holder.parent.left
    if (name) {
      let fn = fromCall.parent
      while (fn && !isFn(fn) && !ts.isSourceFile(fn)) fn = fn.parent
      ;(function walk(n) {
        if (ts.isIdentifier(n) && n.text === name.text && n !== name) all.push(...chainUp(n).calls)
        ts.forEachChild(n, walk)
      })(fn)
    }
    return { all, own: calls }
  }

  function chainScoped(fromCall, depth = 0) {
    if (memo.has(fromCall)) return memo.get(fromCall)
    memo.set(fromCall, false) // cycle guard
    const recv = strip(fromCall.expression.expression)
    let ok = rlsClient(recv)
    if (ok) {
      // user-token client: RLS applies
    } else if (ts.isCallExpression(recv) && ts.isIdentifier(recv.expression) && recv.expression.text === 'orgDb') ok = true
    else if (ts.isIdentifier(recv)) {
      const d = resolve(recv)
      const init = d && d.init && strip(d.init)
      if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'orgDb') ok = true
    }
    if (!ok) {
      const { all } = builderCalls(fromCall)
      const op = all.find((c) => OPS.includes(c.name))?.name
      if (op === 'insert') ok = true
      else if (op === 'upsert') ok = upsertConflictHasOrg(all.find((c) => c.name === 'upsert')) || upsertKeysVerified(all.find((c) => c.name === 'upsert'), depth)
      else ok = all.some((c) => isScopeFilter(c, depth)) || (op === 'select' && orgCheckedAfterLoad(fromCall))
    }
    memo.set(fromCall, ok)
    return ok
  }

  // For --list triage only: where the filter values come from. 'request' = URL params / query / body (reachable by id).
  const REQUEST_TEXT = /\bparams\b|searchParams|\.json\(\)|\bbody\b|formData|\breq(uest)?\b/
  function valueSource(calls) {
    let src = 'none'
    for (const c of calls) {
      if (!FILTER_METHODS.has(c.name)) continue
      const val = c.name === 'filter' ? c.args[2] : c.args[1]
      let id = val && rootIdent(val)
      for (let i = 0; id && i < 6; i++) {
        if (/^(params|body|searchParams|request|req)$/.test(id.text)) return 'request'
        const d = resolve(id)
        if (!d) break
        if (d.kind === 'param') { src = 'fn-param'; break }
        if (d.init && REQUEST_TEXT.test(d.init.getText(sf).slice(0, 200))) return 'request'
        id = d.init && rootIdent(d.init)
        if (src === 'none') src = 'local'
      }
    }
    return src
  }

  const findings = []
  for (const { call, table } of fromCalls) {
    if (chainScoped(call)) continue
    const line = sf.getLineAndCharacterOfPosition(call.expression.name.getStart(sf)).line
    // the reason may sit on the .from(…) line, or anywhere from the line above the statement down to it
    let stmt = call
    while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent) && !ts.isCaseClause(stmt.parent)) stmt = stmt.parent
    const stmtLine = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line
    let allowed = false
    for (let l = Math.max(0, stmtLine - 1); l <= line && !allowed; l++) allowed = ALLOW.test(lines[l] || '')
    if (allowed) continue
    const all = builderCalls(call).all
    const op = all.find((c) => OPS.includes(c.name))?.name || 'builder'
    const filters = all.filter((c) => FILTER_METHODS.has(c.name) || c.name === 'neq' || c.name === 'or').map((c) => `${c.name}(${c.args.map((a) => a.getText(sf).replace(/\s+/g, ' ').slice(0, 40)).join(', ')})`)
    findings.push({ file, line: line + 1, table, op, source: valueSource(all), filters: filters.join(' ') || '-', text: (lines[line] || '').trim().slice(0, 140) })
  }
  return findings
}

export function scan(files = sourceFiles(), orgTables = orgTablesFromMigrations()) {
  const all = []
  for (const f of files) all.push(...analyzeFile(f, readFileSync(f, 'utf8'), orgTables))
  return all
}
export { analyzeFile }

// ---------- ratchet ----------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const findings = scan()
  const counts = {}
  for (const f of findings) counts[f.file] = (counts[f.file] || 0) + 1
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0)
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

  if (process.argv.includes('--list')) {
    for (const f of findings) console.log(`${f.file}:${f.line}\t${f.table}\t${f.op}\t${f.source}\t${f.filters}`)
    console.log(`\n${findings.length} unscoped chains in ${Object.keys(counts).length} files`)
    process.exit(0)
  }
  if (process.argv.includes('--init')) {
    let onMain = false
    try { execFileSync('git', ['cat-file', '-e', `origin/main:${BASELINE}`], { stdio: 'ignore' }); onMain = true } catch {}
    if (existsSync(BASELINE) || onMain) { console.error('org-scope-check: a baseline already exists; use --update (shrink only).'); process.exit(1) }
    writeFileSync(BASELINE, JSON.stringify(sorted(counts), null, 2) + '\n')
    console.log(`org-scope-check: baseline created with ${findings.length} findings in ${Object.keys(counts).length} files.`)
    process.exit(0)
  }

  let mainBaseline = null
  try { mainBaseline = JSON.parse(execFileSync('git', ['show', `origin/main:${BASELINE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch {}
  if (mainBaseline) {
    const raised = Object.keys(baseline).filter((f) => baseline[f] > (mainBaseline[f] ?? 0))
    if (raised.length || total(baseline) > total(mainBaseline)) {
      console.error(`org-scope-check: ${BASELINE} allows more than origin/main does (${raised.join(', ') || 'total'}). The baseline can only go down.`)
      process.exit(1)
    }
  }

  const grew = Object.keys(counts).filter((f) => counts[f] > (baseline[f] ?? 0))
  if (grew.length) {
    console.error('org-scope-check: NEW query on a company table with no company filter (cross-company data risk).')
    for (const file of grew) {
      console.error(`\n  ${file}: ${counts[file]} now, ${baseline[file] ?? 0} allowed`)
      for (const f of findings.filter((x) => x.file === file)) console.error(`    ${f.file}:${f.line}  ${f.table} ${f.op}  ${f.text}`)
    }
    console.error("\nFix: add .eq('org_id', orgId), use orgDb(client, orgId) from lib/supabase/org-db.ts, filter by a row you loaded")
    console.error('company-scoped, or (only when it is truly cross-company on purpose) add `// org-scope-ok: <why>` above the .from(…) line.')
    console.error('The rule is at the top of scripts/org-scope-check.mjs. The baseline cannot be raised.')
    process.exit(1)
  }
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify(sorted(counts), null, 2) + '\n')
    console.log(`org-scope-check: baseline lowered from ${total(baseline)} to ${findings.length}.`)
    process.exit(0)
  }
  const shrunk = total(baseline) - findings.length
  console.log(`org-scope-check: pass (${findings.length} grandfathered unscoped chains${shrunk > 0 ? `; ${shrunk} fixed - run with --update to lock that in` : ''}).`)
}
