-- Test accounts never earn pay lines, a default pay plan, leaderboard or report credit. Nullable/additive: NULL = real user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN users.is_test_account IS 'TRUE for internal test/demo accounts. Excluded from payroll, role defaults, leaderboards and reports.';
-- Rollback: ALTER TABLE users DROP COLUMN is_test_account;
