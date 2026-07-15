# Claude morning checklist: `buildMonthlyTierMetricMaps` rewrite

Work from top to bottom. Do not ship the payroll rewrite until P0 items are fixed and covered by integration-style tests.

## Confirmed scope

The rewrite adds `eligibilityMode: 'first_qualifying'` to `fetchEffectiveSitOpportunitiesInPeriod` and uses it in two payroll paths:

- `buildMonthlyTierMetricMaps` for setter/owner monthly sit totals, closing-rate tiers, percentage bonuses, and flat monthly bonuses in the admin payroll export.
- `fetchPeriodUnitPayLinesForUser` for per-sit pay lines.

Dashboard, goals, team stats, personal stats, and morning-update metrics currently omit `eligibilityMode`, so they retain the default `latest` behavior. Preserve that unless product requirements explicitly say otherwise.

## P0 — payroll correctness / wrong-person payment risk

### 1. Fix orphaned status attribution for re-knocked leads

Confirmed problem:

- The lead-discovery query orders opportunities newest-first and selects only one opportunity per lead when the status row has no `opportunity_id`.
- `ambiguousLeadIds` is calculated later from the already-reduced opportunity batch. It therefore sees only one opportunity and cannot recognize that the lead was ambiguous.
- The current pure unit test manually supplies `ambiguousLeadIds`, so it proves the picker guard but not the real query path.

Potential CRM impact:

- An orphaned legacy sit can be assigned to the newest re-knocked opportunity.
- That can credit the wrong setter or owner, change monthly sit totals and closing-rate tiers, trigger or suppress a monthly bonus, and create a per-unit sit-pay line for the wrong person.

Required work:

- Detect multiple opportunities for the lead before choosing an opportunity, or establish a deterministic attribution rule backed by real data semantics.
- Never assign one orphaned status row to multiple opportunities.
- Add an end-to-end mocked Supabase test with one lead, two opportunities, different reps, and an orphaned qualifying status row.
- Verify both consumers: monthly tier maps and per-unit sit-pay lines.

### 2. Paginate every query used to discover and reconstruct first qualifying sits

Confirmed problem:

- The status-in-period, opportunities-by-date, opportunities-by-lead, opportunities-by-ID, history-by-opportunity, and history-by-lead reads have no explicit pagination.
- Supabase/PostgREST deployments commonly enforce a maximum returned row count. The exact configured cap for this project has not been confirmed, so verify it rather than assuming a specific number.

Potential CRM impact:

- Truncated history can hide the true first sit and select a later attempt/month.
- Truncated discovery results can omit payable sits entirely.
- The same helper feeds monthly tier bonuses and per-unit sit pay, so one truncation can affect two payroll calculations.

Required work:

- Add a shared pagination strategy or replace the multi-query reconstruction with a database query/RPC that deterministically returns one first qualifying sit per opportunity.
- Preserve org scoping in every query.
- Add tests exceeding the configured row cap, including an earliest qualifying row outside the first returned page.
- Also review the unpaginated `order_form_contracts` query in `buildMonthlyTierMetricMaps`; it drives owner sales counts and closing-rate tiers even though it was not introduced by this sit rewrite.

## P1 — period and timestamp correctness

### 3. Define one payroll timezone and use half-open month boundaries

Confirmed behavior:

- The monthly range is built as UTC midnight through `23:59:59.999Z`.
- Month keys are derived by slicing the first seven characters of the UTC timestamp.
- A late-evening Eastern sit can therefore be grouped into the next UTC calendar month.

The intended payroll timezone is not confirmed. Do not silently assume Eastern time just because the business currently operates there.

Potential CRM impact:

- A sit near month-end can move between monthly tiers, changing sit counts, close rate, percentage bonuses, or flat bonuses.
- Sales use similar UTC month-key behavior, so changing sits alone could make the close-rate numerator and denominator use inconsistent calendar rules.

Required work:

- Confirm the authoritative organization/payroll timezone.
- Build `[monthStart, nextMonthStart)` boundaries in that timezone and derive sit and sale month keys by the same rule.
- Test both sides of midnight at month-end and a daylight-saving transition.
- Regression-test production-job volume, sit totals, and contract sales totals together.

### 4. Remove the unsafe timestamp fallback for payroll eligibility

Confirmed behavior:

- When an opportunity has `inspection_outcome` but no `inspection_outcome_at`, the new picker falls back to `updated_at`, then `created_at`.
- Those timestamps do not prove when the inspection happened.

Potential CRM impact:

- An unrelated opportunity edit or original creation date can fabricate the payroll month for a sit.
- This can create or omit tier credit and per-unit sit pay.

Required work:

- For payroll, require an actual status-row `created_at` or `inspection_outcome_at` unless a documented legacy migration rule provides a trustworthy event date.
- Record/report skipped legacy rows so payroll admins can resolve them instead of silently paying from an unrelated timestamp.
- Add tests for missing, invalid, and conflicting timestamps.

### 5. Fix the end-boundary mismatch

Confirmed behavior:

- `buildMonthlyTierMetricMaps` creates `endIso` as `volTo + 23:59:59.999Z`.
- `fetchEffectiveSitOpportunitiesInPeriod` uses strict `< endIso`.
- A record exactly at `23:59:59.999Z` is excluded, while the contract query uses `<=`.

Potential CRM impact:

- Sit and sale counts can disagree at the exact range boundary.

Required work:

- Prefer a half-open interval ending at the next day/month `00:00:00.000` and use `< endExclusive` consistently.
- Test exact start, one millisecond before end, and exact end-exclusive timestamps.

## P2 — resilience, determinism, and collateral regression coverage

### 6. Decide whether payroll should fail closed instead of returning zero metrics

Confirmed behavior:

- `buildMonthlyTierMetricMaps` catches sit-query failures, logs them, and continues with empty sit maps.
- Contract-query failures are also logged and converted to empty sales maps.

Potential CRM impact:

- Payroll export can complete with zero sits or sales, silently changing tier bonuses and closing rates.

Required work:

- Confirm expected admin UX. For payroll calculations, prefer a visible export failure or an explicit incomplete-data warning over silently valid-looking zeroes.
- Test query failures and assert that incomplete payroll cannot be mistaken for a successful calculation.

### 7. Make equal-timestamp selection deterministic

Confirmed behavior:

- Candidate rows are sorted only by timestamp. Equal timestamps retain input/query order, which is not an explicit business rule.

Potential CRM impact:

- If equal-time rows contain different qualifying outcomes, the selected label can vary. Counts usually remain the same, but downstream reporting and future outcome-specific pay rules could diverge.

Required work:

- Define a tie-breaker, ideally a stable status-row ID or documented outcome precedence.
- Select that field in the queries and test equal timestamps.

### 8. Add integration coverage around the actual consumers

Current coverage gap:

- Existing tests exercise `pickFirstQualifyingInspection` directly.
- They do not exercise query discovery, pagination, ambiguous-lead construction, period boundaries, monthly map aggregation, or the per-unit consumer.

Minimum test matrix:

- First qualifying sit followed by a later re-sit in the same month.
- First sit and re-sit in different months.
- Non-sit attempts before the first qualifying sit.
- Duplicate status rows returned by both opportunity and lead queries; count once.
- Re-knocked lead with two opportunities and different setter/owner assignments.
- Orphaned row with one unambiguous opportunity.
- Orphaned row with multiple opportunities.
- Missing/invalid timestamps.
- Exact period boundaries and configured payroll timezone boundaries.
- More rows than the database/API result cap.
- Empty sit-outcome configuration.
- Query failure behavior.
- Owner with sales but zero sits, sits but zero sales, and sales greater than sits; confirm the intended closing-rate behavior.
- One person occupying multiple participant roles on a job; ensure existing participant deduplication and tier lookup remain correct.

## Verification before handoff

- Run the focused dashboard-sit-metrics tests and new payroll integration tests.
- Run TypeScript type-check.
- Run the broader payroll/comp-plan test suite.
- Compare a small known payroll period before and after the change, listing every changed user/month, sit count, sale count, close rate, and payout. Do not rely only on a total-dollar comparison.
- Confirm dashboard, team stats, personal stats, goals/scorecards, and morning-update metrics still use `latest` semantics and have not changed unexpectedly.
- Do not modify historical inspection records or production payroll data as part of the code fix without explicit approval.
