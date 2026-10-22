-- "What's new" announcements: data-driven, reusable, with per-user dismissal stored in the database.
-- Additive. org_id on every row; statuses are real columns (active, starts_at, ends_at), not free text.
--
--  announcements: one row per announcement. `body` holds the short lines for each role group:
--    { "owner": ["line", ...], "ops": [...], "closer": [...], "setter": [...] }   (max 3 short lines per group)
--  announcement_dismissals: one row per (announcement, user) when someone closes the banner — so it stays closed on
--    every device, and owners can see who has and hasn't dismissed.
-- Written/read only through the app's API (service role). No direct API access.

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  slug        text NOT NULL,                       -- stable key, e.g. 'whats-new-2026-10'
  title       text NOT NULL,
  body        jsonb NOT NULL DEFAULT '{}'::jsonb,
  link_url    text NOT NULL DEFAULT '/whats-new',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_org_window ON announcements (org_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS announcement_dismissals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user ON announcement_dismissals (user_id);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON announcements, announcement_dismissals FROM anon, authenticated;
COMMENT ON TABLE announcements IS 'In-app "What''s new" banners: per-role short copy, shown between starts_at and ends_at while active. Service-role only.';
COMMENT ON TABLE announcement_dismissals IS 'Who closed which announcement banner (per user, so it stays closed on every device).';

-- Rollback: DROP TABLE IF EXISTS announcement_dismissals; DROP TABLE IF EXISTS announcements;
