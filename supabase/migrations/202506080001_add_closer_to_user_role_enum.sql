-- Add `closer` as a first-class user_role enum value.
-- Previously `closer` was used in frontend code and deal_commission_roles (TEXT field)
-- but was absent from the enum, causing getPermissions('closer') to return undefined.
-- The effective-permissions alias (closer → sales_rep) remains valid as a fallback.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'closer'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'closer';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
