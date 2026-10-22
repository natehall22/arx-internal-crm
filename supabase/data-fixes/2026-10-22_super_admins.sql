-- Super admins (ARX owners): Nathan Hall, Andrew Waltz, Steve (Stevo Potts). Emails confirmed against users 2026-10-22.
-- Run after migration 202610210010. Preview (read-only), then the fix.
SELECT id, full_name, email, role, active, is_super_admin FROM users
WHERE role = 'admin' AND lower(email) IN ('nathan@arxroofing.com','andrew@waltz.construction','stpotts2@gmail.com');

BEGIN;
UPDATE users SET is_super_admin = TRUE
WHERE role = 'admin' AND active IS TRUE
  AND lower(email) IN ('nathan@arxroofing.com', 'andrew@waltz.construction', 'stpotts2@gmail.com');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users
  WHERE is_super_admin AND lower(email) IN ('nathan@arxroofing.com', 'andrew@waltz.construction', 'stpotts2@gmail.com');
  IF n <> 3 THEN RAISE EXCEPTION 'expected exactly 3 owners flagged, found %', n; END IF;
END $$;
COMMIT;
-- Rollback: UPDATE users SET is_super_admin = FALSE WHERE lower(email) IN ('nathan@arxroofing.com','andrew@waltz.construction','stpotts2@gmail.com');
