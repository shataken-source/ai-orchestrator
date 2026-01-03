-- Trader Configuration Table
-- Stores live trader state and risk settings
-- Created: 2026-01-03

CREATE TABLE IF NOT EXISTS trader_config (
  id TEXT PRIMARY KEY DEFAULT 'alpha-hunter',
  is_running BOOLEAN DEFAULT TRUE,
  last_started TIMESTAMPTZ,
  last_stopped TIMESTAMPTZ,
  risk_settings JSONB DEFAULT '{
    "minConfidence": 60,
    "minEdge": 1,
    "maxTradeSize": 10,
    "dailySpendingLimit": 100,
    "dailyLossLimit": 750,
    "maxOpenPositions": 5
  }'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO trader_config (id, is_running, risk_settings)
VALUES (
  'alpha-hunter',
  true,
  '{"minConfidence": 60, "minEdge": 1, "maxTradeSize": 10, "dailySpendingLimit": 100, "dailyLossLimit": 750, "maxOpenPositions": 5}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE trader_config ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON trader_config
  FOR ALL USING (true) WITH CHECK (true);

-- Create activity_log table if not exists
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  log_type TEXT,
  message TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(log_type);

-- Enable RLS
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON activity_log
  FOR ALL USING (true) WITH CHECK (true);

