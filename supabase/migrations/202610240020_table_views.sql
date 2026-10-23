-- Saved views for the shared DataTable: a named search + sort per user per table. Additive.
CREATE TABLE IF NOT EXISTS table_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_key   TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, table_key, name)
);
CREATE INDEX IF NOT EXISTS idx_table_views_user ON table_views(user_id, table_key);
ALTER TABLE table_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON table_views FROM anon, authenticated;
-- Rollback: DROP TABLE table_views;
