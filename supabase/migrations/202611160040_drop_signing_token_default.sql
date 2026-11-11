-- APPLY AFTER THE CODE IS LIVE (never before): the code that was live before the signing-safety deploy creates contracts
-- without a token and relies on this column's random DEFAULT; dropping it first would email /contracts/sign/null.
-- The new code writes signing_token = NULL explicitly (hash + encrypted copy), so nothing needs the default any more.
ALTER TABLE order_form_contracts ALTER COLUMN signing_token DROP DEFAULT;
SELECT pg_notify('pgrst', 'reload schema');
