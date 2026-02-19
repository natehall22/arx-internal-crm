-- Migration to preserve user data when a user is deleted
-- Changes CASCADE to SET NULL for user references in important tables

-- Fix scheduled_appointments - preserve appointments when user deleted
ALTER TABLE scheduled_appointments 
  DROP CONSTRAINT IF EXISTS scheduled_appointments_user_id_fkey;
ALTER TABLE scheduled_appointments 
  ADD CONSTRAINT scheduled_appointments_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix notes - preserve notes when user deleted  
ALTER TABLE notes 
  DROP CONSTRAINT IF EXISTS notes_user_id_fkey;
ALTER TABLE notes 
  ADD CONSTRAINT notes_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix activities - preserve activity history when user deleted
ALTER TABLE activities 
  DROP CONSTRAINT IF EXISTS activities_user_id_fkey;
ALTER TABLE activities 
  ADD CONSTRAINT activities_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix inspection_status_updates - preserve inspection records when closer deleted
ALTER TABLE inspection_status_updates 
  DROP CONSTRAINT IF EXISTS inspection_status_updates_closer_user_id_fkey;
ALTER TABLE inspection_status_updates 
  ADD CONSTRAINT inspection_status_updates_closer_user_id_fkey 
  FOREIGN KEY (closer_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix commissions - preserve commission records when user deleted
ALTER TABLE commissions 
  DROP CONSTRAINT IF EXISTS commissions_user_id_fkey;
ALTER TABLE commissions 
  ADD CONSTRAINT commissions_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix user_comp_plans - preserve comp plan history when user deleted
ALTER TABLE user_comp_plans 
  DROP CONSTRAINT IF EXISTS user_comp_plans_user_id_fkey;
ALTER TABLE user_comp_plans 
  ADD CONSTRAINT user_comp_plans_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Make user_id nullable in tables that need it
ALTER TABLE scheduled_appointments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE notes ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE activities ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE commissions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE user_comp_plans ALTER COLUMN user_id DROP NOT NULL;

-- Add deleted_user_name column to preserve the name after deletion
ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
ALTER TABLE inspection_status_updates ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;

-- Create a function to preserve user name before deletion
CREATE OR REPLACE FUNCTION preserve_user_name_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Update scheduled_appointments
  UPDATE scheduled_appointments 
  SET deleted_user_name = (SELECT full_name FROM users WHERE id = OLD.id)
  WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  
  -- Update notes
  UPDATE notes 
  SET deleted_user_name = (SELECT full_name FROM users WHERE id = OLD.id)
  WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  
  -- Update activities
  UPDATE activities 
  SET deleted_user_name = (SELECT full_name FROM users WHERE id = OLD.id)
  WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  
  -- Update commissions
  UPDATE commissions 
  SET deleted_user_name = (SELECT full_name FROM users WHERE id = OLD.id)
  WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  
  -- Update inspection_status_updates
  UPDATE inspection_status_updates 
  SET deleted_user_name = (SELECT full_name FROM users WHERE id = OLD.id)
  WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run before user deletion
DROP TRIGGER IF EXISTS preserve_user_name_trigger ON users;
CREATE TRIGGER preserve_user_name_trigger
  BEFORE DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION preserve_user_name_on_delete();
