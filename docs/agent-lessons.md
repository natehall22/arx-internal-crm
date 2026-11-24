# Agent lessons — read before building, append after

Every builder and reviewer reads this first. When a review or a live check catches something a builder should
have caught, add ONE line here (date, pattern, the check that would have caught it). Keep it short; merge duplicates.

## The loop (every change)
1. **Build** → builder runs its own checklist below before reporting "done".
2. **Review** → a separate reviewer (bigger model, never the builder) does bug-bot + collateral impact.
3. **Fix** → findings go straight back to the SAME builder. Medium or higher must be fixed or explicitly argued.
4. **Re-review** → the same reviewer re-checks only the fixes + anything they touch. Repeat 3–4 until no Medium+.
5. **Gates** on the exact commit, then push, then **live check** in the real app (never "fixed" before that).
6. **Learn** → every finding that reached step 2+ becomes a lesson line below if it is a repeatable pattern.

## Builder self-check (before reporting done)
- Re-read your own diff top to bottom as a reviewer would. List what you did NOT cover.
- Every id from a URL/body: loaded org-scoped and permission-checked before use?
- Double tap / two tabs / retry: does it create a second row, send twice, or re-close something reopened?
- Deploy order: does the code read a column/table the migration adds? Add a fallback or say so loudly.
- Times shown to people: company time zone, never raw ISO / UTC, never the phone clock for business days.
- Text that leaves the building (email, push, SMS, crew page, customer page): could it carry internal or private words?
- Field roles and people without money access: can they reach it?
- Roofing company (ARX) unchanged unless the feature is switched on? Snapshot diffs explained?
- Kill every dev server / playwright web server you started (leftovers starve the build of memory).

## Lessons
- 2026-11-23 · Leftover playwright dev server (port 3111) held ~2 GB and OOM-killed `next build` in gates. Kill it after phone tests.
- 2026-11-23 · Phone tables: a wide table inside a flex/grid child pushes the whole page sideways and floats the fixed bottom nav. Phones get stacked cards (`sm:hidden`), table `hidden sm:block`.
- 2026-11-23 · Change logs printed raw ISO timestamps (UTC → wrong day in the evening). Format in the company zone at read time.
- 2026-11-23 · `Number(null ?? NaN) !== Number(null ?? NaN)` is always true → fake "empty → empty" history lines. Compare with a null-safe sameValue.
- 2026-11-23 · New sheets minted a fresh idempotency key per open → a stale page could create a second record. Refuse when the source is already done unless the key matches.
- 2026-11-23 · Prefilling crew-visible fields from office-only text (reminders) can leak internal notes to crews. Leave crew-visible fields blank unless the source is crew-safe.
- 2026-11-23 · Code that selects a new column breaks every screen if deployed before its migration. Either fall back on missing-column errors or block deploy order explicitly.
- 2026-11-23 · Auto-created drafts made a mis-tap irreversible for crews (reopen blocked by the billed guard). Any automatic money row needs an automatic undo path.
- 2026-11-23 · Notification emails/push sent full private-note bodies outside the CRM. Restricted content → notification says only that something exists.
- 2026-11-23 · An automatic void/status change ran check-then-update by id; a send or payment in between was overwritten. Status changes = conditional update (`.eq('status', expected)`, check row count) and check open pay links / online payments first.
- 2026-11-23 · A builder's own slice-edit deleted three unrelated functions; caught only by re-reading the diff. Always re-read the full diff before reporting.
- 2026-11-23 · Rewrapping a query in a helper silently dropped its org filter. After refactoring a query, re-check org scope on every chain it touches.
- 2026-11-23 · Whatever access a reply inherits (audience, readers, pricing flag) comes from the parent row on the server, never the client draft.
- 2026-11-23 · A new "can read" field must be selected by every reader that applies the read rule; a missed select fails closed and hides rows from people who should see them.
- 2026-11-23 · `ADD CONSTRAINT … NOT VALID` + `VALIDATE` in the same migration still scans under the exclusive lock; split them if lock time matters.
- 2026-11-23 · Compare change-log values in full before truncating/formatting; a filter on the shortened text hides real edits.
- 2026-11-23 · A retry/duplicate check must use exactly the writer's own match (key format, customer).
- 2026-11-23 · A locked prefilled dropdown needs a plan when its option isn't loaded: show a message, never silently pick another.
- 2026-11-23 · When a function now throws on a lost race, check every caller already guards or catches it; a lost race is a normal answer, not a 500.
- 2026-11-23 · eslint-disable for a rule the config doesn't load (@typescript-eslint/no-var-requires) is itself a lint ERROR. Run eslint on test files too.
- 2026-11-24 · A migration that drops/replaces a policy or constraint needs Nathan's click in Supabase; overnight it can't be applied. Code must work without it (fallback), and queue the apply for when he's present.
- 2026-11-24 · "Hidden everywhere" promised but sales side, ops pages, morning email and id-keyed routes were left open. Before building any visibility rule, list EVERY reader of the tables it touches (incl. redirect fallbacks, emails, AI tools, id-keyed routes reached from notification links) and scope or explicitly deny each.
- 2026-11-24 · Spreading cleaned input (`...v`) into an insert picks up any new column → insert breaks before the migration. Strip new fields; save them separately and tolerantly.
- 2026-11-24 · Renumbering stops on paper while the phone keeps the old numbers. One numbering helper for every surface that shows the same list.
- 2026-11-24 · A side save after a committed transaction returned early and skipped history/follow-ups. After a commit, side-effect failures warn and continue.
- 2026-11-24 · A keyword rule over free text (checklist labels, names) matched 'Beds' on every mowing visit. Test keyword rules against the product's own example wording.
- 2026-11-24 · Scoping handler by handler skipped one verb in an already-scoped file (proposal builder PUT) and write routes taking a related id in the body (jobId). After gating a route file, check EVERY exported handler; grep write routes that take related ids in the body.
- 2026-11-24 · A per-recipient filter that fails open (read error → nobody treated as limited) sends restricted data. Restriction lookups fail CLOSED.
- 2026-11-24 · 'Route too big to gate' is not a reason to skip it: a record gate is one line at the top of each handler, after the id is parsed.
