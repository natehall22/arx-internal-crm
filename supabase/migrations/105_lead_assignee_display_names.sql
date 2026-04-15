-- Preserve setter/closer names on leads when users are deactivated or deleted.
-- Dashboard team stats: include inactive users who still belong to the team (same team_id).

ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_display_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closer_display_name TEXT;

UPDATE leads l
SET owner_display_name = u.full_name
FROM users u
WHERE u.id = l.owner_user_id
  AND l.owner_user_id IS NOT NULL
  AND (l.owner_display_name IS NULL OR btrim(l.owner_display_name) = '');

UPDATE leads l
SET closer_display_name = u.full_name
FROM users u
WHERE u.id = l.closer_user_id
  AND l.closer_user_id IS NOT NULL
  AND (l.closer_display_name IS NULL OR btrim(l.closer_display_name) = '');

-- Keep display names in sync while assignees still exist (all insert/update paths).
CREATE OR REPLACE FUNCTION leads_set_assignee_display_names()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id) THEN
    IF NEW.owner_user_id IS NOT NULL THEN
      SELECT full_name INTO NEW.owner_display_name FROM users WHERE id = NEW.owner_user_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.closer_user_id IS DISTINCT FROM OLD.closer_user_id) THEN
    IF NEW.closer_user_id IS NOT NULL THEN
      SELECT full_name INTO NEW.closer_display_name FROM users WHERE id = NEW.closer_user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_assignee_display_names ON leads;
CREATE TRIGGER leads_assignee_display_names
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION leads_set_assignee_display_names();

-- Extend existing user-delete hook (see 043_preserve_user_data_on_delete.sql)
CREATE OR REPLACE FUNCTION preserve_user_name_on_delete()
RETURNS TRIGGER AS $$
DECLARE
  user_name TEXT;
BEGIN
  user_name := OLD.full_name;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_appointments') THEN
    UPDATE scheduled_appointments
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
    UPDATE activities
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    UPDATE commissions
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_status_updates') THEN
    UPDATE inspection_status_updates
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
    UPDATE leads
    SET owner_display_name = COALESCE(owner_display_name, user_name)
    WHERE owner_user_id = OLD.id;

    UPDATE leads
    SET closer_display_name = COALESCE(closer_display_name, user_name)
    WHERE closer_user_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
