-- APPLIED 2026-10-25 (Nathan: "make sure the test-account flag is applied so n8rhall disappears").
UPDATE users SET is_test_account = TRUE, show_in_reports = FALSE WHERE id = '203e7bb2-c1f0-49bf-b650-5b49ebef11b4'; -- n8rhall
-- Rollback: UPDATE users SET is_test_account = FALSE, show_in_reports = TRUE WHERE id = '203e7bb2-c1f0-49bf-b650-5b49ebef11b4';
