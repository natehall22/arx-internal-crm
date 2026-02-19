-- Migration to preserve user data when a user is deleted
-- Changes CASCADE to SET NULL for user references in important tables
-- Only modifies tables that exist

-- =============================================
-- 1. SCHEDULED_APPOINTMENTS (closer_user_id)
-- =============================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_appointments') THEN
    -- Drop existing constraint
    ALTER TABLE scheduled_appointments DROP CONSTRAINT IF EXISTS scheduled_appointments_closer_user_id_fkey;
    
    -- Add new constraint with SET NULL
    ALTER TABLE scheduled_appointments 
      ADD CONSTRAINT scheduled_appointments_closer_user_id_fkey 
      FOREIGN KEY (closer_user_id) REFERENCES users(id) ON DELETE SET NULL;
    
    -- Make column nullable
    ALTER TABLE scheduled_appointments ALTER COLUMN closer_user_id DROP NOT NULL;
    
    -- Add column to preserve deleted user name
    ALTER TABLE scheduled_appointments ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
  END IF;
END $$;

-- =============================================
-- 2. INSPECTION_STATUS_UPDATES (closer_user_id)
-- =============================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_status_updates') THEN
    ALTER TABLE inspection_status_updates DROP CONSTRAINT IF EXISTS inspection_status_updates_closer_user_id_fkey;
    
    ALTER TABLE inspection_status_updates 
      ADD CONSTRAINT inspection_status_updates_closer_user_id_fkey 
      FOREIGN KEY (closer_user_id) REFERENCES users(id) ON DELETE SET NULL;
    
    ALTER TABLE inspection_status_updates ALTER COLUMN closer_user_id DROP NOT NULL;
    
    ALTER TABLE inspection_status_updates ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
  END IF;
END $$;

-- =============================================
-- 3. ACTIVITIES (user_id)
-- =============================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
    ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_user_id_fkey;
    
    ALTER TABLE activities 
      ADD CONSTRAINT activities_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    
    ALTER TABLE activities ALTER COLUMN user_id DROP NOT NULL;
    
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
  END IF;
END $$;

-- =============================================
-- 4. COMMISSIONS (user_id)
-- =============================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_user_id_fkey;
    
    ALTER TABLE commissions 
      ADD CONSTRAINT commissions_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    
    ALTER TABLE commissions ALTER COLUMN user_id DROP NOT NULL;
    
    ALTER TABLE commissions ADD COLUMN IF NOT EXISTS deleted_user_name TEXT;
  END IF;
END $$;

-- =============================================
-- 5. USER_COMP_PLANS (user_id)
-- =============================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_comp_plans') THEN
    ALTER TABLE user_comp_plans DROP CONSTRAINT IF EXISTS user_comp_plans_user_id_fkey;
    
    ALTER TABLE user_comp_plans 
      ADD CONSTRAINT user_comp_plans_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    
    ALTER TABLE user_comp_plans ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- =============================================
-- 6. TRIGGER TO PRESERVE USER NAME ON DELETE
-- =============================================
CREATE OR REPLACE FUNCTION preserve_user_name_on_delete()
RETURNS TRIGGER AS $$
DECLARE
  user_name TEXT;
BEGIN
  -- Get the user's name
  user_name := OLD.full_name;
  
  -- Update scheduled_appointments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_appointments') THEN
    UPDATE scheduled_appointments 
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;
  
  -- Update activities
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
    UPDATE activities 
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;
  
  -- Update commissions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    UPDATE commissions 
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;
  
  -- Update inspection_status_updates
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_status_updates') THEN
    UPDATE inspection_status_updates 
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run before user deletion
DROP TRIGGER IF EXISTS preserve_user_name_trigger ON users;
CREATE TRIGGER preserve_user_name_trigger
  BEFORE DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION preserve_user_name_on_delete();
