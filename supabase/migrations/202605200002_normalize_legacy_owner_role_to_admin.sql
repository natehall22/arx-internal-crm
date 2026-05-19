-- Legacy `owner` matched org super-admin (shown as Admin in-app). Canonical slug is `admin`.
-- Postgres `user_role` enum may retain `owner` for compatibility; normalize existing rows only.
UPDATE public.users SET role = 'admin' WHERE role = 'owner';
