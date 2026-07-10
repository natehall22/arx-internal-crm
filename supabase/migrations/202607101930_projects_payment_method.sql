-- Ops job financial source syncs payment method onto the linked project.
-- Read paths already select projects.payment_method with a legacy fallback; PATCH failed without this column.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

COMMENT ON COLUMN projects.payment_method IS
  'Payment method for the job (cash, finance, insurance, other). Synced from ops financial source.';
