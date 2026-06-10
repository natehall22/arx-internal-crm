-- Rename week1_paid_at / week2_paid_at to week1_qualified_at / week2_qualified_at.
-- "paid_at" was semantically wrong — these timestamps record when the rep qualified,
-- not when they were paid. Payroll is tracked separately via payroll_bonus_lines.
ALTER TABLE program_444_enrollments
  RENAME COLUMN week1_paid_at TO week1_qualified_at;

ALTER TABLE program_444_enrollments
  RENAME COLUMN week2_paid_at TO week2_qualified_at;
