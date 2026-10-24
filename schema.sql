PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('ari','jade')),
 sender TEXT NOT NULL CHECK(sender IN ('user','assistant')), message_text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 4),
 is_consecutive INTEGER NOT NULL DEFAULT 0, depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 due_timestamp TEXT, dependency_lag_minutes REAL, estimated_duration_minutes INTEGER NOT NULL DEFAULT 45 CHECK(estimated_duration_minutes BETWEEN 1 AND 1440),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','archived')),
 is_bonus INTEGER NOT NULL DEFAULT 0, original_scheduled_date TEXT, original_due_timestamp TEXT,
 ai_audit_criteria TEXT, requires_video INTEGER NOT NULL DEFAULT 0,
 is_academic INTEGER NOT NULL DEFAULT 0, is_retrieval_drill INTEGER NOT NULL DEFAULT 0, paused_by_sickness INTEGER NOT NULL DEFAULT 0, pause_started_at TEXT, previous_priority INTEGER,
 curriculum_unit_id TEXT REFERENCES curriculum_units(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_timestamp);
CREATE TABLE IF NOT EXISTS subtasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, is_completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_receipts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, verdict TEXT NOT NULL CHECK(verdict IN ('passed','failed')), score INTEGER CHECK(score BETWEEN 1 AND 10), critique TEXT NOT NULL, evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS daily_health_logs (
 date TEXT PRIMARY KEY, sleep_hours REAL CHECK(sleep_hours BETWEEN 0 AND 24), energy_score INTEGER CHECK(energy_score BETWEEN 0 AND 100),
 is_sick INTEGER NOT NULL DEFAULT 0, sickness_notes TEXT, medicine_target_count INTEGER NOT NULL DEFAULT 0 CHECK(medicine_target_count BETWEEN 0 AND 100),
 medicine_taken_count INTEGER NOT NULL DEFAULT 0 CHECK(medicine_taken_count BETWEEN 0 AND 100), workout_completed INTEGER NOT NULL DEFAULT 0,
 workout_type TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS study_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, google_maps_url TEXT, service_type TEXT, quietness_rating INTEGER CHECK(quietness_rating BETWEEN 1 AND 5), commute_minutes_one_way INTEGER NOT NULL CHECK(commute_minutes_one_way BETWEEN 0 AND 720), average_cost_sar REAL CHECK(average_cost_sar >= 0), notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS location_items (id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES study_locations(id) ON DELETE CASCADE, item_name TEXT NOT NULL, price_sar REAL NOT NULL CHECK(price_sar >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS idea_vault (id TEXT PRIMARY KEY, content TEXT NOT NULL, domain_tag TEXT NOT NULL DEFAULT 'general', is_locked INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_synthesized INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS idea_captures (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, submitted INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL DEFAULT '', domain_tag TEXT NOT NULL DEFAULT 'general', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS curriculum_units (
 id TEXT PRIMARY KEY, exam_name TEXT NOT NULL, unit_number INTEGER NOT NULL, topic_title TEXT NOT NULL,
 difficulty_level INTEGER NOT NULL DEFAULT 3 CHECK(difficulty_level BETWEEN 1 AND 5), estimated_hours REAL NOT NULL DEFAULT 2 CHECK(estimated_hours > 0),
 is_main_objective INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','completed')),
 target_completion_date TEXT, exam_date TEXT, subject_slug TEXT, last_reviewed_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS budget_entries (
 id TEXT PRIMARY KEY, wallet_source TEXT NOT NULL, merchant TEXT, amount_sar REAL NOT NULL,
 balance_after_sar REAL, transaction_timestamp TEXT NOT NULL, sms_hash TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_budget_time ON budget_entries(transaction_timestamp);
CREATE TABLE IF NOT EXISTS diary_entries (id TEXT PRIMARY KEY, entry_text TEXT NOT NULL, mood_tag TEXT, alignment TEXT NOT NULL DEFAULT 'left', font_size INTEGER NOT NULL DEFAULT 18, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS focus_sessions (
 id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, duration_minutes INTEGER NOT NULL DEFAULT 25 CHECK(duration_minutes BETWEEN 1 AND 360),
 session_type TEXT NOT NULL DEFAULT 'pomodoro' CHECK(session_type IN ('pomodoro','break','deep_work')),
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, cancelled_at TEXT, last_reminder_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_focus ON focus_sessions((1)) WHERE completed_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE IF NOT EXISTS leisure_windows (id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at > starts_at));
-- Deliberately no INSERT statements. Every table starts empty.
