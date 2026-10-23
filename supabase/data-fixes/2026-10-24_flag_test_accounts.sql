-- Flag known test accounts (run AFTER migration 202610240030). Preview first:
SELECT id, full_name, email, role, active, show_in_reports FROM users WHERE id IN ('203e7bb2-c1f0-49bf-b650-5b49ebef11b4' /* n8rhall */, '7c7c8c39-1cae-4f98-83aa-6efc6e3d1235' /* ARX Measure Test Rep */);
-- show_in_reports=false is the existing switch the leaderboards/team stats already honour; is_test_account covers pay + report credit.
-- UPDATE users SET is_test_account = TRUE, show_in_reports = FALSE WHERE id IN ('203e7bb2-c1f0-49bf-b650-5b49ebef11b4', '7c7c8c39-1cae-4f98-83aa-6efc6e3d1235');
-- Rollback: UPDATE users SET is_test_account = FALSE WHERE id IN (...same ids...);
