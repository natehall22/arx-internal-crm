-- Stale canvass pin ownership: audit trail when working owner moves to a re-knocking rep.
-- Additive/nullable only — live system.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ownership_reassigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ownership_history JSONB;

COMMENT ON COLUMN leads.ownership_reassigned_at IS
  'When owner_user_id was last reassigned to a different rep (stale pin re-knock).';

COMMENT ON COLUMN leads.ownership_history IS
  'Append-only audit: { from_user_id, from_pin_attributed_user_id, to_user_id, reassigned_at, prior_knock_at }[].';
