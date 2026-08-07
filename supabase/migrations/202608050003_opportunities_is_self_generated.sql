-- Explicit "the closer generated this deal themselves" flag.
--
-- Until now "self-generated" existed ONLY as prose in the comp agreement templates:
-- no flag, no column, no lead source. leads.source in production is canvass /
-- door_to_door / csv_import plus a small tail — none of which mark self-gen.
--
-- The only available inference was opportunities.setter_user_id = owner_user_id
-- (69 of 364 opportunities, ~19% at time of writing). That inference is NOT good
-- enough to pay a 6% commission line from on its own: an admin backfilling a missing
-- setter to the closer produces exactly the same shape as a genuine self-gen. So
-- payroll reads this stored column, and the inference is used ONCE here to seed
-- history — recorded as such, so it stays auditable and distinguishable from a value
-- a human actually confirmed.
--
-- Nullable and additive per the live-system rule. NULL = never reviewed = not
-- self-gen for payroll purposes (lib/job-self-gen-attribution.ts requires strictly
-- true), so this migration alone changes nobody's pay. The 6% line stays off until
-- orgs.self_gen_commission_rate is set to a non-zero value.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS is_self_generated BOOLEAN;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS self_generated_source TEXT;

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_self_generated_source_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_self_generated_source_check
  CHECK (
    self_generated_source IS NULL
    OR self_generated_source IN ('inferred_setter_equals_owner', 'manual')
  );

COMMENT ON COLUMN opportunities.is_self_generated IS
  'True when the closer sourced this deal themselves (no separate setter). Read by '
  'payroll for the self-gen commission line. NULL means never reviewed and is treated '
  'as not self-generated.';

COMMENT ON COLUMN opportunities.self_generated_source IS
  'How is_self_generated got its value: ''inferred_setter_equals_owner'' = seeded by '
  'the backfill in migration 202608050003 from setter_user_id = owner_user_id; '
  '''manual'' = set by a human. Keeps the derivation distinguishable from a confirmed '
  'value so a payroll admin can see which rows were guessed.';

-- Backfill: preserve history, and only ever touch rows that have not been set yet.
-- Re-runnable — the WHERE clause makes it a no-op on a second apply, and it will
-- never overwrite a value a human has since confirmed.
UPDATE opportunities
SET
  is_self_generated = TRUE,
  self_generated_source = 'inferred_setter_equals_owner'
WHERE is_self_generated IS NULL
  AND setter_user_id IS NOT NULL
  AND owner_user_id IS NOT NULL
  AND setter_user_id = owner_user_id;

-- Rows with a genuinely different setter are recorded as an explicit FALSE from the
-- same inference, so "reviewed and not self-gen" is distinguishable from "never
-- looked at" (NULL) — e.g. an opportunity with no setter recorded at all.
UPDATE opportunities
SET
  is_self_generated = FALSE,
  self_generated_source = 'inferred_setter_equals_owner'
WHERE is_self_generated IS NULL
  AND setter_user_id IS NOT NULL
  AND owner_user_id IS NOT NULL
  AND setter_user_id <> owner_user_id;

CREATE INDEX IF NOT EXISTS idx_opportunities_self_generated
  ON opportunities (org_id, is_self_generated)
  WHERE is_self_generated IS TRUE;

SELECT pg_notify('pgrst', 'reload schema');
