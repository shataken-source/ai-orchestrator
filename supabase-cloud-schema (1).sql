-- ============================================
-- ☁️ AI EMPIRE CLOUD SCHEMA
-- Complete Supabase setup for 24/7 operation
-- ============================================

-- ============================================
-- 1. INBOX TASKS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS inbox_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT UNIQUE NOT NULL,
  assigned_to TEXT NOT NULL,           -- claude, gemini, cursor, human
  from_ai TEXT NOT NULL,               -- who created this task
  task_type TEXT DEFAULT 'COMMAND',    -- COMMAND, FIX, CREATE, DEPLOY, TEST, etc
  priority TEXT DEFAULT 'HIGH',        -- CRITICAL, HIGH, MEDIUM, LOW, INFO
  description TEXT NOT NULL,
  project TEXT,                        -- which project this relates to
  source TEXT,                         -- mobile, voice, api, email, sms
  status TEXT DEFAULT 'pending',       -- pending, in_progress, completed, cancelled
  response_needed BOOLEAN DEFAULT true,
  
  -- Completion fields
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  completion_notes TEXT,
  version TEXT,
  files_changed TEXT[],
  deployed_to TEXT,                    -- test, production
  production_verified BOOLEAN DEFAULT false,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_inbox_tasks_assigned ON inbox_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_inbox_tasks_status ON inbox_tasks(status);
CREATE INDEX IF NOT EXISTS idx_inbox_tasks_created ON inbox_tasks(created_at DESC);

-- ============================================
-- 2. TASK NOTES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS task_notes (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT REFERENCES inbox_tasks(task_id),
  from_ai TEXT NOT NULL,
  content TEXT NOT NULL,
  note_type TEXT DEFAULT 'comment',    -- comment, blocker, question, update
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. PROJECT NOTES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS project_notes (
  id BIGSERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  from_ai TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  note_type TEXT DEFAULT 'info',       -- info, bug, feature, warning
  priority TEXT DEFAULT 'medium',
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project);

-- ============================================
-- 4. AI STATUS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_status (
  ai_name TEXT PRIMARY KEY,
  status TEXT DEFAULT 'offline',       -- online, offline, busy, waiting
  current_task TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  check_interval INTEGER DEFAULT 10,   -- minutes
  metadata JSONB DEFAULT '{}'
);

-- Insert default AI statuses
INSERT INTO ai_status (ai_name, status, check_interval) VALUES
  ('claude', 'online', 10),
  ('gemini', 'online', 10),
  ('cursor', 'online', 5),
  ('human', 'online', 0)
ON CONFLICT (ai_name) DO NOTHING;

-- ============================================
-- 5. COMPLETED TRADES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS completed_trades (
  id BIGSERIAL PRIMARY KEY,
  trade_id TEXT UNIQUE,
  market TEXT NOT NULL,
  side TEXT NOT NULL,                  -- yes, no, buy, sell
  amount DECIMAL(10,2),
  entry_price DECIMAL(10,4),
  exit_price DECIMAL(10,4),
  profit DECIMAL(10,2),
  confidence DECIMAL(3,2),
  ai_reasoning TEXT,
  source TEXT DEFAULT 'alpha-hunter',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trades_created ON completed_trades(created_at DESC);

-- ============================================
-- 6. COMMAND LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS command_log (
  id BIGSERIAL PRIMARY KEY,
  command TEXT NOT NULL,
  source TEXT,                         -- mobile, voice, email, sms
  routed_to TEXT,
  task_id TEXT,
  response TEXT,
  success BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 7. USEFUL VIEWS
-- ============================================

-- Pending tasks by AI
CREATE OR REPLACE VIEW pending_by_ai AS
SELECT 
  assigned_to,
  COUNT(*) as pending_count,
  array_agg(task_id ORDER BY created_at) as task_ids
FROM inbox_tasks
WHERE status = 'pending'
GROUP BY assigned_to;

-- Recent completions
CREATE OR REPLACE VIEW recent_completions AS
SELECT *
FROM inbox_tasks
WHERE status = 'completed'
ORDER BY completed_at DESC
LIMIT 50;

-- Team status overview
CREATE OR REPLACE VIEW team_status AS
SELECT 
  s.ai_name,
  s.status,
  s.current_task,
  s.last_seen,
  s.check_interval,
  COALESCE(p.pending_count, 0) as pending_tasks
FROM ai_status s
LEFT JOIN pending_by_ai p ON s.ai_name = p.assigned_to
ORDER BY s.ai_name;

-- Today's trades
CREATE OR REPLACE VIEW trades_today AS
SELECT *
FROM completed_trades
WHERE created_at >= CURRENT_DATE
ORDER BY created_at DESC;

-- Project health
CREATE OR REPLACE VIEW project_health AS
SELECT 
  project,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE priority = 'CRITICAL' AND status = 'pending') as critical_pending
FROM inbox_tasks
WHERE project IS NOT NULL
GROUP BY project;

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Create a new task
CREATE OR REPLACE FUNCTION create_task(
  p_assigned_to TEXT,
  p_from TEXT,
  p_type TEXT,
  p_priority TEXT,
  p_description TEXT,
  p_project TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'api'
) RETURNS TEXT AS $$
DECLARE
  v_task_id TEXT;
BEGIN
  v_task_id := UPPER(p_from) || '-' || UPPER(p_assigned_to) || '-' || p_type || '-' || 
               TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS');
  
  INSERT INTO inbox_tasks (task_id, assigned_to, from_ai, task_type, priority, description, project, source)
  VALUES (v_task_id, LOWER(p_assigned_to), LOWER(p_from), p_type, p_priority, p_description, p_project, p_source);
  
  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql;

-- Complete a task
CREATE OR REPLACE FUNCTION complete_task(
  p_task_id TEXT,
  p_completed_by TEXT,
  p_notes TEXT DEFAULT NULL,
  p_version TEXT DEFAULT NULL,
  p_files TEXT[] DEFAULT NULL,
  p_deployed_to TEXT DEFAULT NULL,
  p_verified BOOLEAN DEFAULT false
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE inbox_tasks
  SET 
    status = 'completed',
    completed_at = NOW(),
    completed_by = p_completed_by,
    completion_notes = p_notes,
    version = p_version,
    files_changed = p_files,
    deployed_to = p_deployed_to,
    production_verified = p_verified,
    updated_at = NOW()
  WHERE task_id = p_task_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Get pending tasks for an AI
CREATE OR REPLACE FUNCTION get_pending_tasks(p_ai TEXT)
RETURNS SETOF inbox_tasks AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM inbox_tasks
  WHERE assigned_to = LOWER(p_ai)
    AND status = 'pending'
  ORDER BY 
    CASE priority
      WHEN 'CRITICAL' THEN 1
      WHEN 'HIGH' THEN 2
      WHEN 'MEDIUM' THEN 3
      WHEN 'LOW' THEN 4
      ELSE 5
    END,
    created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Update AI status
CREATE OR REPLACE FUNCTION update_ai_status(
  p_ai TEXT,
  p_status TEXT,
  p_current_task TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_status
  SET 
    status = p_status,
    current_task = p_current_task,
    last_seen = NOW()
  WHERE ai_name = LOWER(p_ai);
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. REALTIME SUBSCRIPTIONS
-- ============================================

-- Enable realtime for dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE inbox_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_status;

-- ============================================
-- 10. ROW LEVEL SECURITY (Optional)
-- ============================================

-- For now, service key bypasses RLS
-- Enable if you want fine-grained access control later

-- ALTER TABLE inbox_tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE task_notes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- DONE! 
-- ============================================

-- Test the setup:
-- SELECT * FROM team_status;
-- SELECT create_task('cursor', 'claude', 'TEST', 'HIGH', 'Test task from SQL');
-- SELECT * FROM get_pending_tasks('cursor');
