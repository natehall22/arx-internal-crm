-- Manager hierarchy
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_manager_user_id ON users(manager_user_id);
