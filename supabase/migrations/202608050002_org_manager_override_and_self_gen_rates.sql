-- Org-level rates for the two remaining derived commission lines in the published
-- ladder: the manager override (1% of a job's commission base) and the
-- self-generated line (6%).
--
-- Both default to 0 = OFF, following the orgs.inspection_commission_rate precedent
-- (migration 202608010002). Payroll is live and in daily use; a non-zero default
-- would silently start paying new lines on the very next period lock. Set these
-- deliberately when ownership signs off on the comp plan going into effect.
--
-- Per-job overrides still win: an explicit deal_commission_roles row (field_manager /
-- senior_manager for the override, self_gen for the self-generated line) takes
-- precedence over these rates for that job, including a deliberate $0.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS manager_override_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS self_gen_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orgs.manager_override_commission_rate IS
  'Percent of a job''s commission base paid as a manager override, derived from '
  'users.manager_user_id: the first ACTIVE manager above each paying participant, plus '
  'an active participant who themselves hold a manager seat (own production). '
  'Inactive users are transparent links — the override rolls up past them to the next '
  'active rung, and if no active manager exists up the chain no line is emitted rather '
  'than paying a deactivated user. One line per manager per job. Applied only when no '
  'explicit deal_commission_roles field_manager/senior_manager row exists for that job. '
  '0 disables the derived override entirely. Counts inside the sales commission pool cap.';

COMMENT ON COLUMN orgs.self_gen_commission_rate IS
  'Percent of a job''s commission base paid to the closer on a self-generated deal '
  '(opportunities.is_self_generated = true), on top of their normal close commission. '
  'Suppressed when the opportunity also carries a different setter — that combination '
  'is contradictory and would breach the 18 percent pool cap. Applied only when no explicit '
  'deal_commission_roles self_gen row exists for that job. 0 disables the derived line '
  'entirely. Counts inside the sales commission pool cap.';

SELECT pg_notify('pgrst', 'reload schema');
