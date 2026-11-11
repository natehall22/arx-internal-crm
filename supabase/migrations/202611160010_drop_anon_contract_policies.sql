-- Migration 064 created two policies that let the anon role read and update EVERY row of order_form_contracts
-- (USING (true)). Production already has only the org-scoped policies (checked 2026-11-11), but a database built from the
-- migration files would still be open to anyone holding the public anon key. Nothing in the app uses them: every signing
-- page and route reads and writes with the service client. Idempotent; no other change.
DROP POLICY IF EXISTS "Anon can read contracts by token" ON order_form_contracts;
DROP POLICY IF EXISTS "Anon can update contracts by token" ON order_form_contracts;
