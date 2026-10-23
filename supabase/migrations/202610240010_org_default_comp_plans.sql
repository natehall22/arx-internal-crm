-- Org default pay plan per role: used ONLY when a person has no assignment on the sale date, and ONLY for sale
-- dates on/after the default's own effective_from (so history is never restated — Nathan 2026-08-07: no backdating).
-- Additive; no existing row changes. Written/read only through the app (service role).
CREATE TABLE IF NOT EXISTS org_default_comp_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                                   -- users.role slug the default applies to
  comp_plan_id    UUID NOT NULL REFERENCES comp_plans(id) ON DELETE RESTRICT,
  effective_from  DATE NOT NULL,
  change_reason   TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, role, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_org_default_comp_plans_org ON org_default_comp_plans(org_id, role, effective_from DESC);
COMMENT ON TABLE org_default_comp_plans IS 'Per-role fallback pay plan, effective-dated. A later row for the same role supersedes an earlier one from its effective_from; nothing is ever edited in place.';
ALTER TABLE org_default_comp_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_default_comp_plans FROM anon, authenticated;

-- Rollback: DROP TABLE org_default_comp_plans;
