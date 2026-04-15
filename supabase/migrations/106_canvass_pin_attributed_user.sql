-- Canvass map visibility: when a user row is deleted, owner_user_id becomes NULL (FK)
-- but team/region filters use .in(owner_user_id, ...), which hides those pins.
-- pin_attributed_user_id is NOT a foreign key — it keeps the original setter id forever.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pin_attributed_user_id UUID;

COMMENT ON COLUMN leads.pin_attributed_user_id IS
  'Original canvass setter (first owner_user_id). Not a FK — survives user delete for map filters.';

UPDATE leads
SET pin_attributed_user_id = owner_user_id
WHERE owner_user_id IS NOT NULL
  AND pin_attributed_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_org_created_pin_owner
  ON leads (org_id, created_at)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Extend assignee trigger: freeze first setter on the pin for map attribution
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

  IF NEW.owner_user_id IS NOT NULL THEN
    NEW.pin_attributed_user_id := COALESCE(NEW.pin_attributed_user_id, NEW.owner_user_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Before user delete: snapshot pin attribution (redundant if already set)
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

    UPDATE leads
    SET pin_attributed_user_id = COALESCE(pin_attributed_user_id, owner_user_id)
    WHERE owner_user_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
