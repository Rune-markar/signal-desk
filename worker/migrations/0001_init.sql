PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_user_expires_idx
  ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  user_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, ip_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 1 CHECK (quiet_hours_enabled IN (0, 1)),
  quiet_from TEXT NOT NULL DEFAULT '22:00',
  quiet_to TEXT NOT NULL DEFAULT '07:00',
  push_enabled INTEGER NOT NULL DEFAULT 0 CHECK (push_enabled IN (0, 1)),
  demo_mode INTEGER NOT NULL DEFAULT 0 CHECK (demo_mode IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS monitors (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('market', 'news', 'website', 'report')),
  source_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'error')),
  schedule_frequency TEXT NOT NULL CHECK (schedule_frequency IN ('hourly', 'daily', 'weekdays', 'weekly')),
  schedule_time TEXT NOT NULL,
  schedule_timezone TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  notifications_enabled INTEGER NOT NULL CHECK (notifications_enabled IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('native', 'chatgpt-manual', 'demo')),
  last_run_at TEXT,
  last_success_at TEXT,
  next_run_at TEXT,
  last_outcome TEXT NOT NULL CHECK (last_outcome IN ('matched', 'clear', 'failed', 'never')),
  last_summary TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  error_message TEXT,
  lease_until TEXT,
  lease_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS monitors_due_idx
  ON monitors(user_id, status, next_run_at);

CREATE INDEX IF NOT EXISTS monitors_lease_idx
  ON monitors(user_id, lease_until);

CREATE TABLE IF NOT EXISTS runs (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  monitor_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'clear', 'failed', 'simulated')),
  summary TEXT NOT NULL,
  evidence_urls TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS runs_user_finished_idx
  ON runs(user_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS runs_monitor_finished_idx
  ON runs(user_id, monitor_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  monitor_title TEXT NOT NULL,
  run_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'snoozed')),
  detected_at TEXT NOT NULL,
  read_at TEXT,
  snoozed_until TEXT,
  source_url TEXT,
  dedupe_key TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, dedupe_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notifications_user_status_idx
  ON notifications(user_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, endpoint),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cron_executions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, scheduled_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cron_executions_started_idx
  ON cron_executions(user_id, started_at DESC);
