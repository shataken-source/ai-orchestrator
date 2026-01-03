/**
 * ☁️ AI EMPIRE CLOUD ORCHESTRATOR
 * 
 * Runs 24/7 on Railway - no laptop needed!
 * All state stored in Supabase
 * 
 * Endpoints:
 *   GET  /health              - Health check
 *   GET  /api/status          - Full system status
 *   GET  /api/inbox/:ai       - Get AI's pending tasks
 *   POST /api/inbox/:ai/task  - Create task for AI
 *   POST /api/task/:id/complete - Mark task complete
 *   POST /api/command         - Mobile command endpoint
 *   POST /api/webhook/voice   - Alexa/Google webhook
 *   GET  /api/trades/summary  - Trading summary
 *   GET  /api/kill-switch/status - Cost control status
 *   POST /api/kill-switch/activate - Emergency stop
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');

// Kill switch and rate limiting
const {
  killSwitchMiddleware,
  rateLimitMiddleware,
  budgetControlMiddleware,
  killSwitchRoutes,
  getCounters
} = require('./kill-switch');

// Authentication
const {
  authMiddleware,
  dashboardAuth,
  verifyGitHubWebhook,
  verifyAlexaRequest
} = require('./auth-middleware');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// SECURITY MIDDLEWARE (Order matters!)
// ============================================

app.use(killSwitchMiddleware);      // 1. Check if service is killed
app.use(rateLimitMiddleware);       // 2. Rate limiting
app.use(budgetControlMiddleware);   // 3. Budget control
app.use(authMiddleware);            // 4. Authentication (after rate limit to block bad actors)

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  PORT: process.env.PORT || 3333,
  AI_AGENTS: ['claude', 'gemini', 'cursor', 'human'],
  CHECK_INTERVALS: {
    claude: 10,
    gemini: 10,
    cursor: 5,
    human: 0
  },
  PROJECT_OWNERSHIP: {
    claude: ['alpha-hunter', 'prognostication', 'flex', 'ai-orchestrator', 'cevict'],
    gemini: ['smokersrights', 'petreunion', 'popthepopcorn', 'gulfcoastcharters', 'wheretovacation', 'alexa-skill'],
    cursor: 'ALL',
    human: 'ALL'
  }
};

// ============================================
// HEALTH & STATUS
// ============================================

app.get('/health', (req, res) => {
  const counters = getCounters();
  res.json({ 
    status: counters.killSwitch ? 'killed' : 'ok', 
    service: 'AI Empire Cloud Orchestrator',
    version: '2.0.0',
    environment: 'cloud',
    killSwitch: counters.killSwitch,
    requestsToday: counters.requests.today,
    timestamp: new Date().toISOString()
  });
});

// Kill switch routes
killSwitchRoutes(app);

app.get('/api/status', async (req, res) => {
  try {
    // Get team status from Supabase
    const { data: teamStatus, error: teamError } = await supabase
      .from('ai_status')
      .select('*');

    // Get pending task counts
    const { data: pendingTasks, error: taskError } = await supabase
      .from('inbox_tasks')
      .select('assigned_to, id')
      .eq('status', 'pending');

    // Count by AI
    const taskCounts = {};
    CONFIG.AI_AGENTS.forEach(ai => taskCounts[ai] = 0);
    pendingTasks?.forEach(task => {
      const ai = task.assigned_to?.toLowerCase();
      if (taskCounts[ai] !== undefined) taskCounts[ai]++;
    });

    // Get recent completions
    const { data: recentCompletions } = await supabase
      .from('inbox_tasks')
      .select('*')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10);

    res.json({
      status: 'operational',
      environment: 'cloud',
      uptime: process.uptime(),
      agents: CONFIG.AI_AGENTS.map(ai => ({
        name: ai,
        status: teamStatus?.find(t => t.ai_name?.toLowerCase() === ai)?.status || 'unknown',
        pendingTasks: taskCounts[ai],
        projects: CONFIG.PROJECT_OWNERSHIP[ai],
        checkInterval: CONFIG.CHECK_INTERVALS[ai]
      })),
      recentCompletions: recentCompletions?.slice(0, 5) || [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// INBOX ENDPOINTS
// ============================================

// Get pending tasks for an AI
app.get('/api/inbox/:ai', async (req, res) => {
  const ai = req.params.ai.toLowerCase();
  
  if (!CONFIG.AI_AGENTS.includes(ai)) {
    return res.status(400).json({ error: 'Invalid AI name' });
  }

  try {
    const { data, error } = await supabase
      .from('inbox_tasks')
      .select('*')
      .eq('assigned_to', ai)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      ai,
      pendingCount: data.length,
      tasks: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new task
app.post('/api/inbox/:ai/task', async (req, res) => {
  const ai = req.params.ai.toLowerCase();
  const { 
    from = 'api', 
    type = 'COMMAND', 
    priority = 'HIGH', 
    description,
    project,
    responseNeeded = true 
  } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  try {
    const taskId = `${from.toUpperCase()}-${ai.toUpperCase()}-${type}-${Date.now()}`;

    const { data, error } = await supabase
      .from('inbox_tasks')
      .insert({
        task_id: taskId,
        assigned_to: ai,
        from_ai: from,
        task_type: type,
        priority: priority,
        description: description,
        project: project,
        response_needed: responseNeeded,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Trigger webhook/notification if needed
    await notifyTaskCreated(ai, data);

    res.json({
      success: true,
      taskId,
      task: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark task complete
app.post('/api/task/:id/complete', async (req, res) => {
  const taskId = req.params.id;
  const {
    completedBy,
    notes,
    version,
    filesChanged = [],
    deployedTo,
    productionVerified = false
  } = req.body;

  try {
    const { data, error } = await supabase
      .from('inbox_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: completedBy,
        completion_notes: notes,
        version: version,
        files_changed: filesChanged,
        deployed_to: deployedTo,
        production_verified: productionVerified
      })
      .eq('task_id', taskId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      task: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MOBILE COMMAND ENDPOINT
// ============================================

app.post('/api/command', async (req, res) => {
  const {
    command,
    to = 'claude',
    priority = 'HIGH',
    source = 'mobile'
  } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Command required' });
  }

  // Parse and route command intelligently
  const parsed = parseCommand(command, to);

  try {
    const taskId = `MOBILE-${parsed.to.toUpperCase()}-${Date.now()}`;

    const { data, error } = await supabase
      .from('inbox_tasks')
      .insert({
        task_id: taskId,
        assigned_to: parsed.to.toLowerCase(),
        from_ai: 'human',
        task_type: parsed.type,
        priority: priority,
        description: command,
        source: source,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      taskId,
      routedTo: parsed.to,
      message: `Command sent to ${parsed.to}. Processing shortly.`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function parseCommand(command, defaultTo) {
  let to = defaultTo;
  let type = 'COMMAND';
  const lower = command.toLowerCase();

  // Check @mentions
  if (lower.startsWith('@claude')) to = 'claude';
  else if (lower.startsWith('@gemini')) to = 'gemini';
  else if (lower.startsWith('@cursor')) to = 'cursor';

  // Smart routing
  if (lower.includes('profit') || lower.includes('trade') || lower.includes('alpha')) {
    to = 'claude';
    type = 'STATUS';
  } else if (lower.includes('deploy')) {
    to = 'cursor';
    type = 'DEPLOY';
  } else if (lower.includes('fix') || lower.includes('bug')) {
    to = 'claude';
    type = 'FIX';
  } else if (lower.includes('pet') || lower.includes('popcorn') || lower.includes('vacation')) {
    to = 'gemini';
  }

  return { to, type };
}

// ============================================
// VOICE WEBHOOK (Alexa/Google) - With Verification
// ============================================

app.post('/api/webhook/voice', verifyAlexaRequest, async (req, res) => {
  // Handle both Alexa and Google formats
  let command = '';
  let source = 'voice';

  // Alexa format
  if (req.body.request?.intent) {
    const intent = req.body.request.intent;
    command = intent.slots?.command?.value || intent.name;
    source = 'alexa';
  }
  // Google format
  else if (req.body.queryResult) {
    command = req.body.queryResult.queryText;
    source = 'google';
  }
  // Direct format
  else if (req.body.command) {
    command = req.body.command;
  }

  if (!command) {
    return res.json({ 
      speech: "I didn't catch that. What would you like me to do?",
      error: 'No command detected'
    });
  }

  try {
    const parsed = parseCommand(command, 'claude');
    const taskId = `VOICE-${parsed.to.toUpperCase()}-${Date.now()}`;

    await supabase.from('inbox_tasks').insert({
      task_id: taskId,
      assigned_to: parsed.to.toLowerCase(),
      from_ai: 'human',
      task_type: parsed.type,
      priority: 'HIGH',
      description: command,
      source: source,
      status: 'pending'
    });

    const speech = `Got it! I've sent "${command}" to ${parsed.to}. They'll handle it shortly.`;

    // Alexa response
    if (source === 'alexa') {
      return res.json({
        version: '1.0',
        response: {
          outputSpeech: { type: 'PlainText', text: speech },
          shouldEndSession: true
        }
      });
    }

    // Google response
    if (source === 'google') {
      return res.json({
        fulfillmentText: speech
      });
    }

    // Default
    res.json({ success: true, speech, taskId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRADING ENDPOINTS
// ============================================

app.get('/api/trades/summary', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: trades } = await supabase
      .from('completed_trades')
      .select('*')
      .gte('created_at', today);

    const summary = {
      date: today,
      totalTrades: trades?.length || 0,
      wins: trades?.filter(t => t.profit > 0).length || 0,
      losses: trades?.filter(t => t.profit < 0).length || 0,
      totalProfit: trades?.reduce((sum, t) => sum + (t.profit || 0), 0) || 0,
      trades: trades?.slice(0, 10) || []
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades/summary/today', async (req, res) => {
  // Alias for /api/trades/summary
  return res.redirect('/api/trades/summary');
});

// ============================================
// PROJECT NOTES
// ============================================

app.post('/api/project/:name/note', async (req, res) => {
  const project = req.params.name;
  const { from, content, title, type = 'info', priority = 'medium' } = req.body;

  try {
    const { data, error } = await supabase
      .from('project_notes')
      .insert({
        project,
        from_ai: from,
        content,
        title,
        note_type: type,
        priority
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, note: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AI STATUS UPDATE
// ============================================

app.post('/api/ai/:name/status', async (req, res) => {
  const aiName = req.params.name.toLowerCase();
  const { status, currentTask, lastSeen } = req.body;

  try {
    const { data, error } = await supabase
      .from('ai_status')
      .upsert({
        ai_name: aiName,
        status: status,
        current_task: currentTask,
        last_seen: lastSeen || new Date().toISOString()
      }, { onConflict: 'ai_name' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, status: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEARTBEAT ENDPOINT (Bot Health Check)
// ============================================

app.post('/api/heartbeat', async (req, res) => {
  const { ai, status = 'online', currentTask, version } = req.body;
  
  if (!ai) {
    return res.status(400).json({ error: 'AI name required' });
  }
  
  const aiName = ai.toLowerCase();
  
  try {
    // Update status in Supabase
    const { data, error } = await supabase
      .from('ai_status')
      .upsert({
        ai_name: aiName,
        status: status,
        current_task: currentTask,
        last_seen: new Date().toISOString(),
        metadata: { version, heartbeat: true }
      }, { onConflict: 'ai_name' })
      .select()
      .single();
    
    if (error) throw error;
    
    // Get pending tasks for this AI
    const { data: pendingTasks } = await supabase
      .from('inbox_tasks')
      .select('task_id, priority, description')
      .eq('assigned_to', aiName)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);
    
    res.json({
      success: true,
      acknowledged: new Date().toISOString(),
      pendingTasks: pendingTasks?.length || 0,
      nextTasks: pendingTasks || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check for stale bots (no heartbeat in 5 min) - runs every minute
setInterval(async () => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data: staleBots } = await supabase
      .from('ai_status')
      .select('ai_name, last_seen')
      .lt('last_seen', fiveMinutesAgo)
      .neq('status', 'offline')
      .neq('ai_name', 'human'); // Don't mark human as offline
    
    if (staleBots?.length > 0) {
      console.log(`⚠️ Stale bots detected: ${staleBots.map(b => b.ai_name).join(', ')}`);
      
      // Mark as offline
      for (const bot of staleBots) {
        await supabase
          .from('ai_status')
          .update({ status: 'offline' })
          .eq('ai_name', bot.ai_name);
      }
    }
  } catch (error) {
    console.error('Heartbeat check error:', error.message);
  }
}, 60000); // Every minute

// ============================================
// GITHUB WEBHOOK (for Cursor PRs) - With Signature Verification
// ============================================

app.post('/api/webhook/github', verifyGitHubWebhook, async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`GitHub webhook: ${event}`);

  // Handle PR events
  if (event === 'pull_request') {
    const action = payload.action;
    const pr = payload.pull_request;

    if (action === 'opened') {
      // New PR - create task for review
      await supabase.from('inbox_tasks').insert({
        task_id: `GITHUB-PR-${pr.number}-${Date.now()}`,
        assigned_to: 'claude',
        from_ai: 'cursor',
        task_type: 'REVIEW',
        priority: 'HIGH',
        description: `Review PR #${pr.number}: ${pr.title}`,
        metadata: { pr_url: pr.html_url, pr_number: pr.number }
      });
    } else if (action === 'closed' && pr.merged) {
      // PR merged - notify
      await supabase.from('inbox_tasks').insert({
        task_id: `GITHUB-MERGED-${pr.number}-${Date.now()}`,
        assigned_to: 'human',
        from_ai: 'cursor',
        task_type: 'INFO',
        priority: 'LOW',
        description: `PR #${pr.number} merged: ${pr.title}`,
        status: 'completed'
      });
    }
  }

  // Handle push events (deployments)
  if (event === 'push') {
    const repo = payload.repository.name;
    const branch = payload.ref.replace('refs/heads/', '');

    if (branch === 'main' || branch === 'master') {
      console.log(`Deploy triggered for ${repo}`);
    }
  }

  res.json({ received: true });
});

// ============================================
// ACTIVITY LOG (Live Trading Feed)
// ============================================

// In-memory store for last 100 log entries
const activityLog = {
  entries: [],
  maxEntries: 100
};

// POST /api/activity-log - Receive logs from Alpha Hunter
app.post('/api/activity-log', async (req, res) => {
  const { logs } = req.body;
  
  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'logs array required' });
  }
  
  // Add new logs
  for (const log of logs) {
    activityLog.entries.unshift({
      id: Date.now() + Math.random(),
      timestamp: log.timestamp || new Date().toISOString(),
      type: log.type || 'info', // trade, analysis, error, info
      message: log.message || '',
      data: log.data || null,
      receivedAt: new Date().toISOString()
    });
  }
  
  // Trim to max entries
  if (activityLog.entries.length > activityLog.maxEntries) {
    activityLog.entries = activityLog.entries.slice(0, activityLog.maxEntries);
  }
  
  // Also save to Supabase for persistence (optional, async)
  try {
    if (logs.length > 0) {
      await supabase.from('activity_log').insert(
        logs.map(log => ({
          timestamp: log.timestamp || new Date().toISOString(),
          log_type: log.type || 'info',
          message: log.message || '',
          data: log.data || null
        }))
      ).catch(() => {}); // Don't fail if table doesn't exist
    }
  } catch (e) {
    // Silently ignore Supabase errors - memory log still works
  }
  
  res.json({ 
    success: true, 
    received: logs.length,
    totalInMemory: activityLog.entries.length
  });
});

// GET /api/activity-log - Get recent logs
app.get('/api/activity-log', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const since = req.query.since; // ISO timestamp
  
  let entries = activityLog.entries;
  
  // Filter by timestamp if provided
  if (since) {
    entries = entries.filter(e => new Date(e.timestamp) > new Date(since));
  }
  
  res.json({
    count: entries.slice(0, limit).length,
    total: activityLog.entries.length,
    logs: entries.slice(0, limit)
  });
});

// ============================================
// TRADER CONTROL & RISK SETTINGS (Live Control)
// ============================================

// In-memory trader state (also stored in Supabase for persistence)
let traderState = {
  isRunning: true,
  lastStarted: new Date().toISOString(),
  lastStopped: null,
  riskSettings: {
    minConfidence: 60,
    minEdge: 1,
    maxTradeSize: 10,
    dailySpendingLimit: 100,
    dailyLossLimit: 750,
    maxOpenPositions: 5
  }
};

// Initialize from Supabase on startup
async function loadTraderState() {
  try {
    const { data } = await supabase
      .from('trader_config')
      .select('*')
      .eq('id', 'alpha-hunter')
      .single();
    
    if (data) {
      traderState = {
        isRunning: data.is_running ?? true,
        lastStarted: data.last_started,
        lastStopped: data.last_stopped,
        riskSettings: data.risk_settings || traderState.riskSettings
      };
      console.log('[Trader Control] Loaded state from Supabase');
    }
  } catch (e) {
    console.log('[Trader Control] Using default state');
  }
}
loadTraderState();

// GET /api/trader/status - Get trader status and risk settings
app.get('/api/trader/status', async (req, res) => {
  // Get latest stats from activity log
  const recentTrades = activityLog.entries.filter(e => e.type === 'trade').length;
  const recentErrors = activityLog.entries.filter(e => e.type === 'error').length;
  const lastActivity = activityLog.entries[0]?.timestamp || null;
  
  res.json({
    isRunning: traderState.isRunning,
    lastStarted: traderState.lastStarted,
    lastStopped: traderState.lastStopped,
    riskSettings: traderState.riskSettings,
    stats: {
      recentTrades,
      recentErrors,
      lastActivity
    }
  });
});

// POST /api/trader/start - Start the trader
app.post('/api/trader/start', async (req, res) => {
  if (traderState.isRunning) {
    return res.json({ success: true, message: 'Trader already running' });
  }
  
  traderState.isRunning = true;
  traderState.lastStarted = new Date().toISOString();
  
  // Persist to Supabase
  await supabase
    .from('trader_config')
    .upsert({
      id: 'alpha-hunter',
      is_running: true,
      last_started: traderState.lastStarted,
      risk_settings: traderState.riskSettings
    });
  
  // Log the action
  activityLog.entries.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    type: 'info',
    message: '▶️ Trader STARTED via dashboard',
    data: { action: 'start', by: 'dashboard' }
  });
  
  console.log('[Trader Control] ▶️ Trader STARTED');
  res.json({ success: true, message: 'Trader started', state: traderState });
});

// POST /api/trader/stop - Stop the trader (graceful)
app.post('/api/trader/stop', async (req, res) => {
  if (!traderState.isRunning) {
    return res.json({ success: true, message: 'Trader already stopped' });
  }
  
  traderState.isRunning = false;
  traderState.lastStopped = new Date().toISOString();
  
  // Persist to Supabase
  await supabase
    .from('trader_config')
    .upsert({
      id: 'alpha-hunter',
      is_running: false,
      last_stopped: traderState.lastStopped,
      risk_settings: traderState.riskSettings
    });
  
  // Log the action
  activityLog.entries.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    type: 'info',
    message: '⏹️ Trader STOPPED via dashboard',
    data: { action: 'stop', by: 'dashboard' }
  });
  
  console.log('[Trader Control] ⏹️ Trader STOPPED');
  res.json({ success: true, message: 'Trader stopped', state: traderState });
});

// GET /api/trader/risk - Get risk settings
app.get('/api/trader/risk', (req, res) => {
  res.json(traderState.riskSettings);
});

// POST /api/trader/risk - Update risk settings
app.post('/api/trader/risk', async (req, res) => {
  const { minConfidence, minEdge, maxTradeSize, dailySpendingLimit, dailyLossLimit, maxOpenPositions } = req.body;
  
  // Validate inputs
  const updates = {};
  if (minConfidence !== undefined) {
    const val = parseInt(minConfidence);
    if (val >= 50 && val <= 95) updates.minConfidence = val;
  }
  if (minEdge !== undefined) {
    const val = parseFloat(minEdge);
    if (val >= 0.5 && val <= 10) updates.minEdge = val;
  }
  if (maxTradeSize !== undefined) {
    const val = parseInt(maxTradeSize);
    if (val >= 1 && val <= 100) updates.maxTradeSize = val;
  }
  if (dailySpendingLimit !== undefined) {
    const val = parseInt(dailySpendingLimit);
    if (val >= 10 && val <= 1000) updates.dailySpendingLimit = val;
  }
  if (dailyLossLimit !== undefined) {
    const val = parseInt(dailyLossLimit);
    if (val >= 10 && val <= 5000) updates.dailyLossLimit = val;
  }
  if (maxOpenPositions !== undefined) {
    const val = parseInt(maxOpenPositions);
    if (val >= 1 && val <= 20) updates.maxOpenPositions = val;
  }
  
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid updates provided' });
  }
  
  // Apply updates
  traderState.riskSettings = { ...traderState.riskSettings, ...updates };
  
  // Persist to Supabase
  await supabase
    .from('trader_config')
    .upsert({
      id: 'alpha-hunter',
      is_running: traderState.isRunning,
      risk_settings: traderState.riskSettings,
      updated_at: new Date().toISOString()
    });
  
  // Log the change
  activityLog.entries.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    type: 'info',
    message: `⚙️ Risk settings updated: ${JSON.stringify(updates)}`,
    data: { action: 'risk_update', updates }
  });
  
  console.log('[Trader Control] ⚙️ Risk settings updated:', updates);
  res.json({ success: true, message: 'Risk settings updated', settings: traderState.riskSettings });
});

// ============================================
// SMS INBOUND WEBHOOK (Sinch)
// ============================================

app.post('/api/webhook/sinch', async (req, res) => {
  try {
    const payload = req.body;
    
    console.log('[Sinch Webhook] Received:', JSON.stringify(payload));
    
    // Extract sender and message (Sinch can use different field names)
    const sender = payload.from || payload.from_ || payload.sender || '';
    const body = (payload.body || payload.text || payload.message || '').trim().toUpperCase();
    
    if (!sender || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing sender or message body'
      });
    }
    
    // Log the incoming message
    console.log(`[Sinch Webhook] SMS from ${sender}: ${body}`);
    
    // Verify sender is authorized (Jason, Victoria, or Navid)
    const authorizedNumbers = [
      process.env.MY_PHONE_NUMBER,
      process.env.VICTORIA_PHONE,
      process.env.NAVID_PHONE
    ].filter(Boolean);
    
    if (!authorizedNumbers.includes(sender)) {
      console.log(`[Sinch Webhook] Unauthorized sender: ${sender}`);
      return res.json({
        success: false,
        message: 'Unauthorized sender'
      });
    }
    
    // Process commands
    let response = { success: true, action: null, message: '' };
    
    // GOTIT - Guardian Pulse check-in
    if (body === 'GOTIT' || body === 'GOT IT') {
      // Reset Guardian timer (if Guardian Pulse is active)
      response.action = 'guardian_checkin';
      response.message = 'Check-in confirmed, timer reset';
      console.log('[Sinch Webhook] ✅ Guardian check-in confirmed');
    }
    // STATUS - Get system status
    else if (body === 'STATUS' || body === 'STAT') {
      const counters = getCounters();
      const { data: claudeTasks } = await supabase
        .from('inbox_tasks')
        .select('id')
        .eq('assigned_to', 'claude')
        .eq('status', 'pending');
      
      const { data: geminiTasks } = await supabase
        .from('inbox_tasks')
        .select('id')
        .eq('assigned_to', 'gemini')
        .eq('status', 'pending');
      
      response.action = 'status_request';
      response.message = `System OK. Claude: ${claudeTasks?.length || 0} tasks, Gemini: ${geminiTasks?.length || 0} tasks. Requests today: ${counters.requests.today}`;
    }
    // STOP - Emergency stop
    else if (body === 'STOP' || body === 'EMERGENCY') {
      // Trigger kill switch
      const killSwitchResult = await supabase
        .from('kill_switch_events')
        .insert({
          triggered_by: sender,
          reason: 'SMS command: STOP',
          triggered_at: new Date().toISOString()
        });
      
      response.action = 'kill_switch_activated';
      response.message = 'Emergency stop activated via SMS';
      console.log('[Sinch Webhook] 🚨 EMERGENCY STOP activated via SMS');
    }
    // HELP - Show available commands
    else if (body === 'HELP' || body === '?') {
      response.action = 'help';
      response.message = 'Commands: GOTIT (check-in), STATUS (system status), STOP (emergency), HELP (this message)';
    }
    // Unknown command - try to parse as task command
    else {
      // Try to parse as a command for an AI
      const parsed = parseCommand(body, 'claude');
      const taskId = `SMS-${parsed.to.toUpperCase()}-${Date.now()}`;
      
      await supabase.from('inbox_tasks').insert({
        task_id: taskId,
        assigned_to: parsed.to.toLowerCase(),
        from_ai: 'human',
        task_type: parsed.type,
        priority: 'HIGH',
        description: body,
        source: 'sms',
        status: 'pending'
      });
      
      response.action = 'task_created';
      response.message = `Command sent to ${parsed.to}: "${body}"`;
      console.log(`[Sinch Webhook] Created task ${taskId} for ${parsed.to}`);
    }
    
    // Send confirmation SMS back (optional)
    if (process.env.SINCH_API_TOKEN && process.env.SINCH_SERVICE_PLAN_ID) {
      try {
        await sendCevictBriefing(sender, `✅ ${response.message}`);
      } catch (e) {
        console.error('[Sinch Webhook] Failed to send confirmation:', e.message);
      }
    }
    
    res.json(response);
  } catch (error) {
    console.error('[Sinch Webhook] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed'
    });
  }
});

// ============================================
// SMS TEST ENDPOINT
// ============================================

app.post('/api/test/sms', authMiddleware, async (req, res) => {
  const phoneNumber = req.body.phone || process.env.MY_PHONE_NUMBER;
  const customMessage = req.body.message;

  if (!phoneNumber) {
    return res.status(400).json({ 
      error: 'Phone number required. Set MY_PHONE_NUMBER env var or pass in body.' 
    });
  }

  if (!process.env.SINCH_API_TOKEN || !process.env.SINCH_SERVICE_PLAN_ID) {
    return res.status(500).json({ 
      error: 'SMS not configured. Missing SINCH_API_TOKEN or SINCH_SERVICE_PLAN_ID.' 
    });
  }

  try {
    const briefingText = customMessage || await generateDailyBriefing();
    const result = await sendCevictBriefing(phoneNumber, briefingText);

    if (result.success) {
      res.json({
        success: true,
        message: 'SMS sent successfully',
        batchId: result.batchId,
        phoneNumber: phoneNumber,
        textPreview: briefingText.substring(0, 100) + '...'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        details: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// SPORTS PICKS TEST ENDPOINT
// ============================================

app.post('/api/test/picks', authMiddleware, async (req, res) => {
  const phoneNumber = req.body.phone || process.env.MY_PHONE_NUMBER;

  if (!phoneNumber) {
    return res.status(400).json({ 
      error: 'Phone number required. Set MY_PHONE_NUMBER env var or pass in body.' 
    });
  }

  if (!process.env.SINCH_API_TOKEN || !process.env.SINCH_SERVICE_PLAN_ID) {
    return res.status(500).json({ 
      error: 'SMS not configured. Missing SINCH_API_TOKEN or SINCH_SERVICE_PLAN_ID.' 
    });
  }

  try {
    console.log('🎯 Generating sports picks for test...');
    const picksMessage = await generateDailySportsPicks();
    
    if (!picksMessage) {
      return res.json({
        success: false,
        message: 'No picks available to send',
        note: 'Either no high-confidence picks today or database query failed'
      });
    }

    const result = await sendCevictBriefing(phoneNumber, picksMessage);

    if (result.success) {
      res.json({
        success: true,
        message: 'Sports picks SMS sent successfully!',
        batchId: result.batchId,
        phoneNumber: phoneNumber,
        textPreview: picksMessage.substring(0, 200) + '...'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        details: result.error
      });
    }
  } catch (error) {
    console.error('Error in /api/test/picks:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SMS SERVICE (Sinch)
// ============================================

async function sendCevictBriefing(phoneNumber, briefingText) {
  const url = `https://sms.api.sinch.com/xms/v1/${process.env.SINCH_SERVICE_PLAN_ID}/batches`;
  
  try {
    const response = await axios.post(url, {
      from: process.env.SINCH_NUMBER || process.env.SINCH_FROM,
      to: [phoneNumber],
      body: briefingText
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.SINCH_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log("✅ Briefing Sent via Sinch:", response.data.id);
    return { success: true, batchId: response.data.id };
  } catch (error) {
    console.error("❌ SMS Failure:", error.response ? error.response.data : error.message);
    return { success: false, error: error.response ? error.response.data : error.message };
  }
}

async function generateDailyBriefing() {
  try {
    // Get today's trading summary
    const { data: trades } = await supabase
      .from('trade_history')
      .select('*')
      .gte('opened_at', new Date().toISOString().split('T')[0])
      .order('opened_at', { ascending: false })
      .limit(10);

    // Get pending tasks count
    const { data: claudeTasks } = await supabase
      .from('inbox_tasks')
      .select('id')
      .eq('assigned_to', 'claude')
      .eq('status', 'pending');

    const { data: geminiTasks } = await supabase
      .from('inbox_tasks')
      .select('id')
      .eq('assigned_to', 'gemini')
      .eq('status', 'pending');

    const date = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    let briefing = `📊 CEVICT DAILY BRIEFING - ${date}\n\n`;
    
    briefing += `🤖 AI STATUS:\n`;
    briefing += `   Claude: ${claudeTasks?.length || 0} pending tasks\n`;
    briefing += `   Gemini: ${geminiTasks?.length || 0} pending tasks\n\n`;

    if (trades && trades.length > 0) {
      const totalPnL = trades.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
      briefing += `💰 TRADING:\n`;
      briefing += `   Trades today: ${trades.length}\n`;
      briefing += `   P/L: $${totalPnL.toFixed(2)}\n\n`;
    } else {
      briefing += `💰 TRADING: No trades today\n\n`;
    }

    briefing += `🌐 SYSTEM: All services operational\n`;
    briefing += `📡 Dashboard: https://ai-orchestrator-production-7bbf.up.railway.app/dashboard.html`;

    return briefing;
  } catch (error) {
    console.error("Error generating briefing:", error);
    return `📊 CEVICT DAILY BRIEFING\n\nSystem operational. Check dashboard for details.`;
  }
}

// ============================================
// DAILY SPORTS PICKS GENERATOR
// ============================================

async function generateDailySportsPicks() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const MIN_CONFIDENCE = 70;
    let picks = [];

    // Query bot_predictions for sports picks
    const { data: kalshiPicks, error: kalshiError } = await supabase
      .from('bot_predictions')
      .select('*')
      .eq('platform', 'kalshi')
      .gte('confidence', MIN_CONFIDENCE)
      .gte('predicted_at', `${today}T00:00:00Z`)
      .lt('predicted_at', `${today}T23:59:59Z`)
      .order('confidence', { ascending: false })
      .limit(10);

    if (!kalshiError && kalshiPicks) {
      picks = picks.concat(kalshiPicks.filter(p => 
        p.bot_category && ['sports', 'NFL', 'NBA', 'MLB', 'NHL'].includes(p.bot_category)
      ));
    }

    // Query picks table if it exists
    const { data: tablePicks, error: picksError } = await supabase
      .from('picks')
      .select('*')
      .gte('confidence', MIN_CONFIDENCE)
      .eq('game_date', today)
      .order('confidence', { ascending: false })
      .limit(10);

    if (!picksError && tablePicks) {
      picks = picks.concat(tablePicks);
    }

    // Query progno_predictions for sports
    const { data: prognoPicks, error: prognoError } = await supabase
      .from('progno_predictions')
      .select('*')
      .gte('confidence', MIN_CONFIDENCE)
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${today}T23:59:59Z`)
      .order('confidence', { ascending: false })
      .limit(10);

    if (!prognoError && prognoPicks) {
      picks = picks.concat(prognoPicks.filter(p => 
        p.category && ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'sports'].includes(p.category)
      ));
    }

    if (picks.length === 0) {
      console.log('No high-confidence sports picks found for today');
      // Send a message even if no picks
      const date = new Date().toLocaleDateString('en-US', { 
        weekday: 'short',
        month: 'short', 
        day: 'numeric' 
      });
      return `🎯 PROGNO PICKS - ${date}\n\nNo high-confidence picks today (70%+ required).\n\nCheck dashboard for lower confidence options:\nprognostication.com/picks`;
    }

    // Format message
    const date = new Date().toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });

    let message = `🎯 PROGNO PICKS - ${date}\n\n`;

    // Sort by confidence and take top 5
    picks.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    picks = picks.slice(0, 5);

    for (const pick of picks) {
      const sport = pick.sport || pick.bot_category || pick.category || 'Sports';
      const title = (pick.market_title || pick.question || pick.game_matchup || 'Unknown').substring(0, 40);
      const prediction = pick.prediction || pick.predicted_outcome || pick.pick_value || 'N/A';
      const conf = pick.confidence || 0;
      const edge = pick.edge || pick.edge_pct || 0;
      
      message += `${sport}: ${prediction}\n`;
      message += `  ${title}${title.length >= 40 ? '...' : ''}\n`;
      message += `  (${conf}% conf${edge > 0 ? `, ${edge.toFixed(1)}% edge` : ''})\n\n`;
    }

    message += `\n📱 Full details: prognostication.com`;

    return message;
  } catch (error) {
    console.error("Error generating sports picks:", error);
    return null;
  }
}

// ============================================
// NOTIFICATIONS
// ============================================

async function notifyTaskCreated(ai, task) {
  // Could trigger:
  // - Email notification
  // - SMS via Sinch
  // - Webhook to other services
  console.log(`Task created for ${ai}: ${task.task_id}`);
}

// ============================================
// DASHBOARD (Protected!)
// ============================================

app.get('/dashboard', (req, res) => {
  res.redirect('/dashboard.html' + (req.query.key ? `?key=${req.query.key}` : ''));
});

app.get('/dashboard.html', dashboardAuth, async (req, res) => {
  const key = req.query.key || '';
  
  // Serve a simple dashboard with live feed
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI Empire Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #0f172a; color: white; font-family: 'Monaco', 'Menlo', monospace; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .log-trade { color: #22c55e; }
    .log-analysis { color: #eab308; }
    .log-error { color: #ef4444; }
    .log-info { color: #3b82f6; }
    .log-sync { color: #a855f7; }
    #liveFeed {
      max-height: 400px;
      overflow-y: auto;
      scroll-behavior: smooth;
    }
    #liveFeed::-webkit-scrollbar { width: 6px; }
    #liveFeed::-webkit-scrollbar-track { background: #1e293b; }
    #liveFeed::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
    .log-entry { 
      border-left: 3px solid transparent;
      transition: all 0.2s;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.4;
    }
    .log-entry:hover { background: #1e293b; }
    .log-entry.log-trade { border-left-color: #22c55e; }
    .log-entry.log-analysis { border-left-color: #eab308; }
    .log-entry.log-error { border-left-color: #ef4444; }
    .new-entry { animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h1 class="text-xl font-bold">☁️ AI Empire Dashboard</h1>
    <div class="flex items-center gap-4">
      <div id="killSwitch" class="text-sm"></div>
      <button id="feedToggle" onclick="toggleFeed()" class="bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded text-sm">
        📺 Live Feed
      </button>
      <button onclick="toggleControls()" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm">
        ⚙️ Controls
      </button>
    </div>
  </div>
  
  <!-- TRADER CONTROL PANEL -->
  <div id="controlPanel" class="bg-gray-800 rounded-lg p-4 mb-4" style="display: none;">
    <div class="flex justify-between items-center mb-3">
      <h2 class="text-lg font-bold">🎮 Trader Control Panel</h2>
      <div class="flex items-center gap-2">
        <span id="traderStatus" class="px-2 py-1 rounded text-xs font-bold">Loading...</span>
      </div>
    </div>
    
    <!-- Start/Stop Buttons -->
    <div class="flex gap-3 mb-4">
      <button id="btnStart" onclick="startTrader()" class="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-3 rounded-lg font-bold text-lg transition-all">
        ▶️ START
      </button>
      <button id="btnStop" onclick="stopTrader()" class="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-3 rounded-lg font-bold text-lg transition-all">
        ⏹️ STOP
      </button>
    </div>
    
    <!-- Risk Settings -->
    <div class="border-t border-gray-700 pt-3">
      <h3 class="text-sm font-bold mb-3 text-yellow-400">⚡ Risk Settings (Live)</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <!-- Min Confidence -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Min Confidence</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskConfidence" min="50" max="95" value="60" class="flex-1 accent-yellow-500" oninput="updateRiskLabel('Confidence')">
            <span id="riskConfidenceLabel" class="text-sm font-mono w-12 text-right">60%</span>
          </div>
        </div>
        
        <!-- Min Edge -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Min Edge</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskEdge" min="5" max="100" value="10" class="flex-1 accent-yellow-500" oninput="updateRiskLabel('Edge')">
            <span id="riskEdgeLabel" class="text-sm font-mono w-12 text-right">1.0%</span>
          </div>
        </div>
        
        <!-- Max Trade Size -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Max Trade Size</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskTradeSize" min="1" max="50" value="10" class="flex-1 accent-green-500" oninput="updateRiskLabel('TradeSize')">
            <span id="riskTradeSizeLabel" class="text-sm font-mono w-12 text-right">$10</span>
          </div>
        </div>
        
        <!-- Daily Limit -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Daily Limit</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskDailyLimit" min="10" max="500" value="100" step="10" class="flex-1 accent-blue-500" oninput="updateRiskLabel('DailyLimit')">
            <span id="riskDailyLimitLabel" class="text-sm font-mono w-12 text-right">$100</span>
          </div>
        </div>
        
        <!-- Loss Limit -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Loss Limit</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskLossLimit" min="50" max="2000" value="750" step="50" class="flex-1 accent-red-500" oninput="updateRiskLabel('LossLimit')">
            <span id="riskLossLimitLabel" class="text-sm font-mono w-12 text-right">$750</span>
          </div>
        </div>
        
        <!-- Max Positions -->
        <div>
          <label class="text-xs text-gray-400 block mb-1">Max Positions</label>
          <div class="flex items-center gap-2">
            <input type="range" id="riskMaxPositions" min="1" max="15" value="5" class="flex-1 accent-purple-500" oninput="updateRiskLabel('MaxPositions')">
            <span id="riskMaxPositionsLabel" class="text-sm font-mono w-12 text-right">5</span>
          </div>
        </div>
      </div>
      
      <!-- Apply Button -->
      <div class="mt-4 flex justify-between items-center">
        <span id="riskStatus" class="text-xs text-gray-500"></span>
        <button onclick="applyRiskSettings()" class="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded font-bold">
          💾 Apply Changes
        </button>
      </div>
    </div>
  </div>
  
  <!-- Status Cards -->
  <div id="status" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">Loading...</div>
  
  <!-- Live Trading Feed -->
  <div id="feedContainer" class="mb-4">
    <div class="flex justify-between items-center mb-2">
      <h2 class="text-lg font-bold">📡 Alpha Hunter Live Feed</h2>
      <div class="flex items-center gap-2">
        <span id="feedStatus" class="text-xs text-green-400">● Connected</span>
        <button onclick="clearFeed()" class="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Clear</button>
      </div>
    </div>
    <div id="liveFeed" class="bg-gray-900 rounded-lg p-3 font-mono text-xs">
      <div class="text-gray-500">Waiting for activity...</div>
    </div>
  </div>
  
  <!-- Quick Stats -->
  <div id="quickStats" class="grid grid-cols-4 gap-3 mb-4">
    <div class="bg-gray-800 p-3 rounded text-center">
      <div class="text-2xl font-bold text-green-400" id="statTrades">0</div>
      <div class="text-xs text-gray-400">Trades</div>
    </div>
    <div class="bg-gray-800 p-3 rounded text-center">
      <div class="text-2xl font-bold text-yellow-400" id="statAnalysis">0</div>
      <div class="text-xs text-gray-400">Analysis</div>
    </div>
    <div class="bg-gray-800 p-3 rounded text-center">
      <div class="text-2xl font-bold text-red-400" id="statErrors">0</div>
      <div class="text-xs text-gray-400">Errors</div>
    </div>
    <div class="bg-gray-800 p-3 rounded text-center">
      <div class="text-2xl font-bold text-blue-400" id="statTotal">0</div>
      <div class="text-xs text-gray-400">Total</div>
    </div>
  </div>
  
  <div class="text-xs text-gray-600">
    Last updated: <span id="lastUpdate">-</span> | 
    <a href="#" onclick="location.reload()" class="text-blue-500">Refresh</a>
  </div>
  
  <script>
    const API_KEY = '${key}';
    let feedVisible = true;
    let controlsVisible = false;
    let lastLogId = null;
    let stats = { trades: 0, analysis: 0, errors: 0, total: 0 };
    let traderIsRunning = true;
    
    // TRADER CONTROL FUNCTIONS
    function toggleControls() {
      controlsVisible = !controlsVisible;
      document.getElementById('controlPanel').style.display = controlsVisible ? 'block' : 'none';
      if (controlsVisible) loadTraderStatus();
    }
    
    async function loadTraderStatus() {
      try {
        const res = await fetch('/api/trader/status', {
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        traderIsRunning = data.isRunning;
        
        // Update status badge
        const statusEl = document.getElementById('traderStatus');
        if (traderIsRunning) {
          statusEl.textContent = '● RUNNING';
          statusEl.className = 'px-2 py-1 rounded text-xs font-bold bg-green-600';
        } else {
          statusEl.textContent = '● STOPPED';
          statusEl.className = 'px-2 py-1 rounded text-xs font-bold bg-red-600';
        }
        
        // Update buttons
        document.getElementById('btnStart').disabled = traderIsRunning;
        document.getElementById('btnStop').disabled = !traderIsRunning;
        
        // Load risk settings
        const settings = data.riskSettings;
        document.getElementById('riskConfidence').value = settings.minConfidence;
        document.getElementById('riskConfidenceLabel').textContent = settings.minConfidence + '%';
        
        document.getElementById('riskEdge').value = settings.minEdge * 10;
        document.getElementById('riskEdgeLabel').textContent = settings.minEdge.toFixed(1) + '%';
        
        document.getElementById('riskTradeSize').value = settings.maxTradeSize;
        document.getElementById('riskTradeSizeLabel').textContent = '$' + settings.maxTradeSize;
        
        document.getElementById('riskDailyLimit').value = settings.dailySpendingLimit;
        document.getElementById('riskDailyLimitLabel').textContent = '$' + settings.dailySpendingLimit;
        
        document.getElementById('riskLossLimit').value = settings.dailyLossLimit;
        document.getElementById('riskLossLimitLabel').textContent = '$' + settings.dailyLossLimit;
        
        document.getElementById('riskMaxPositions').value = settings.maxOpenPositions;
        document.getElementById('riskMaxPositionsLabel').textContent = settings.maxOpenPositions;
        
      } catch (e) {
        console.error('Failed to load trader status:', e);
      }
    }
    
    async function startTrader() {
      try {
        const res = await fetch('/api/trader/start', {
          method: 'POST',
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        document.getElementById('riskStatus').textContent = '✅ ' + data.message;
        loadTraderStatus();
        loadFeed();
      } catch (e) {
        document.getElementById('riskStatus').textContent = '❌ Failed to start';
      }
    }
    
    async function stopTrader() {
      if (!confirm('⚠️ Stop the trader? This will halt all trading activity.')) return;
      
      try {
        const res = await fetch('/api/trader/stop', {
          method: 'POST',
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        document.getElementById('riskStatus').textContent = '⏹️ ' + data.message;
        loadTraderStatus();
        loadFeed();
      } catch (e) {
        document.getElementById('riskStatus').textContent = '❌ Failed to stop';
      }
    }
    
    function updateRiskLabel(field) {
      const slider = document.getElementById('risk' + field);
      const label = document.getElementById('risk' + field + 'Label');
      const val = parseFloat(slider.value);
      
      switch(field) {
        case 'Confidence':
          label.textContent = val + '%';
          break;
        case 'Edge':
          label.textContent = (val / 10).toFixed(1) + '%';
          break;
        case 'TradeSize':
        case 'DailyLimit':
        case 'LossLimit':
          label.textContent = '$' + val;
          break;
        case 'MaxPositions':
          label.textContent = val;
          break;
      }
    }
    
    async function applyRiskSettings() {
      const settings = {
        minConfidence: parseInt(document.getElementById('riskConfidence').value),
        minEdge: parseFloat(document.getElementById('riskEdge').value) / 10,
        maxTradeSize: parseInt(document.getElementById('riskTradeSize').value),
        dailySpendingLimit: parseInt(document.getElementById('riskDailyLimit').value),
        dailyLossLimit: parseInt(document.getElementById('riskLossLimit').value),
        maxOpenPositions: parseInt(document.getElementById('riskMaxPositions').value)
      };
      
      try {
        const res = await fetch('/api/trader/risk', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-key': API_KEY 
          },
          body: JSON.stringify(settings)
        });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('riskStatus').textContent = '✅ Settings applied!';
          setTimeout(() => {
            document.getElementById('riskStatus').textContent = '';
          }, 3000);
        } else {
          document.getElementById('riskStatus').textContent = '❌ ' + (data.error || 'Failed');
        }
        
        loadFeed(); // Refresh to see the log entry
      } catch (e) {
        document.getElementById('riskStatus').textContent = '❌ Failed to apply settings';
      }
    }
    
    function toggleFeed() {
      feedVisible = !feedVisible;
      document.getElementById('feedContainer').style.display = feedVisible ? 'block' : 'none';
      document.getElementById('feedToggle').textContent = feedVisible ? '📺 Hide Feed' : '📺 Show Feed';
    }
    
    function clearFeed() {
      document.getElementById('liveFeed').innerHTML = '<div class="text-gray-500">Feed cleared...</div>';
      stats = { trades: 0, analysis: 0, errors: 0, total: 0 };
      updateStats();
    }
    
    function updateStats() {
      document.getElementById('statTrades').textContent = stats.trades;
      document.getElementById('statAnalysis').textContent = stats.analysis;
      document.getElementById('statErrors').textContent = stats.errors;
      document.getElementById('statTotal').textContent = stats.total;
    }
    
    function getLogIcon(type) {
      switch(type) {
        case 'trade': return '💰';
        case 'analysis': return '🤖';
        case 'error': return '❌';
        case 'sync': return '📡';
        case 'market': return '📊';
        default: return 'ℹ️';
      }
    }
    
    function formatTime(isoString) {
      return new Date(isoString).toLocaleTimeString('en-US', { 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
      });
    }
    
    async function loadFeed() {
      try {
        const res = await fetch('/api/activity-log?limit=50', {
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        
        if (data.logs && data.logs.length > 0) {
          const feed = document.getElementById('liveFeed');
          const newLogs = lastLogId ? data.logs.filter(l => l.id > lastLogId) : data.logs;
          
          if (newLogs.length > 0 || !lastLogId) {
            // Build HTML for logs
            const logsHtml = data.logs.slice(0, 50).map(log => {
              const isNew = lastLogId && log.id > lastLogId;
              return \`<div class="log-entry log-\${log.type} py-1 px-2 \${isNew ? 'new-entry' : ''}">
                <span class="text-gray-500">[\${formatTime(log.timestamp)}]</span>
                \${getLogIcon(log.type)} \${log.message}
              </div>\`;
            }).join('');
            
            feed.innerHTML = logsHtml || '<div class="text-gray-500">No activity yet...</div>';
            
            // Update stats
            stats.total = data.total;
            stats.trades = data.logs.filter(l => l.type === 'trade').length;
            stats.analysis = data.logs.filter(l => l.type === 'analysis').length;
            stats.errors = data.logs.filter(l => l.type === 'error').length;
            updateStats();
            
            // Track last log ID for new entries
            if (data.logs.length > 0) {
              lastLogId = Math.max(...data.logs.map(l => l.id));
            }
          }
          
          document.getElementById('feedStatus').innerHTML = '● Connected';
          document.getElementById('feedStatus').className = 'text-xs text-green-400';
        }
      } catch (e) {
        document.getElementById('feedStatus').innerHTML = '● Disconnected';
        document.getElementById('feedStatus').className = 'text-xs text-red-400';
      }
    }
    
    async function load() {
      try {
        const res = await fetch('/api/status', {
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        
        document.getElementById('status').innerHTML = data.agents.map(a => \`
          <div class="bg-gray-800 p-3 rounded-lg border-l-4 \${
            a.status === 'online' ? 'border-green-500' : 
            a.status === 'offline' ? 'border-red-500' : 'border-yellow-500'
          }">
            <div class="flex justify-between items-center">
              <h2 class="font-bold capitalize text-sm">\${a.name}</h2>
              <span class="text-xs px-2 py-0.5 rounded \${
                a.status === 'online' ? 'bg-green-600' : 
                a.status === 'offline' ? 'bg-red-600' : 'bg-yellow-600'
              }">\${a.status}</span>
            </div>
            <div class="text-xs text-gray-400 mt-1">Tasks: \${a.pendingTasks}</div>
          </div>
        \`).join('');
        
        const killRes = await fetch('/api/kill-switch/status', {
          headers: { 'x-admin-key': API_KEY }
        });
        const killData = await killRes.json();
        document.getElementById('killSwitch').innerHTML = killData.killSwitch 
          ? '<span class="bg-red-600 px-2 py-1 rounded pulse text-xs">🛑 KILLED</span>'
          : '<span class="bg-green-600 px-2 py-1 rounded text-xs">✅</span>';
        
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
      } catch (e) {
        document.getElementById('status').innerHTML = '<div class="text-red-500 col-span-4">Error: ' + e.message + '</div>';
      }
    }
    
    // Initial load
    load();
    loadFeed();
    
    // Refresh intervals
    setInterval(load, 10000);     // Status every 10s
    setInterval(loadFeed, 5000);  // Feed every 5s
  </script>
</body>
</html>
  `);
});

// ============================================
// START SERVER
// ============================================

app.listen(CONFIG.PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   ☁️  AI EMPIRE CLOUD ORCHESTRATOR v2.1');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Status: ONLINE`);
  console.log(`   Port: ${CONFIG.PORT}`);
  console.log(`   Environment: ${process.env.RAILWAY_ENVIRONMENT || 'local'}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ NOT CONFIGURED!'}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('   🔐 AUTHENTICATION:');
  console.log(`   Admin Key: ${process.env.ADMIN_KEY ? '✅ Configured' : '❌ NOT SET!'}`);
  console.log(`   Dashboard: Protected (requires ?key= parameter)`);
  console.log(`   Webhooks: ${process.env.GITHUB_WEBHOOK_SECRET ? '✅ Verified' : '⚠️ Unverified'}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('   🔒 COST CONTROL:');
  console.log(`   Kill Switch: ${process.env.KILL_SWITCH === 'true' ? '🛑 ACTIVE' : '✅ Ready'}`);
  console.log(`   Rate Limit: 1000 req/min global, 60 req/min per IP`);
  console.log(`   Daily Budget: 50,000 requests`);
  console.log(`   Alerts: ${process.env.ALERT_EMAIL || process.env.HUMAN_EMAIL || 'Not configured'}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('   📡 Endpoints (require x-admin-key header):');
  console.log('   GET  /health                - Health check (public)');
  console.log('   GET  /api/status            - System status');
  console.log('   GET  /api/inbox/:ai         - Get pending tasks');
  console.log('   POST /api/inbox/:ai/task    - Create task');
  console.log('   POST /api/command           - Mobile commands');
  console.log('   POST /api/heartbeat         - Bot health check');
  console.log('   POST /api/webhook/voice     - Alexa/Google (public)');
  console.log('   POST /api/webhook/github    - GitHub events (verified)');
  console.log('   POST /api/webhook/sinch     - Sinch SMS inbound (public)');
  console.log('   GET  /api/kill-switch/status - Cost monitoring');
  console.log('   GET  /dashboard.html?key=X  - Dashboard (protected)');
  console.log('   POST /api/test/sms          - Test SMS briefing');
  console.log('═══════════════════════════════════════════════════════════');
  
  // ============================================
  // CRON JOBS
  // ============================================
  
  // Daily briefing at 08:00 CST (14:00 UTC)
  if (process.env.SINCH_API_TOKEN && process.env.MY_PHONE_NUMBER) {
    // Send system status briefing
    cron.schedule('0 14 * * *', async () => {
      console.log('📱 [CRON] Sending daily briefing SMS...');
      const briefing = await generateDailyBriefing();
      const result = await sendCevictBriefing(process.env.MY_PHONE_NUMBER, briefing);
      if (result.success) {
        console.log('✅ Daily briefing sent successfully');
      } else {
        console.error('❌ Failed to send daily briefing:', result.error);
      }
    }, {
      timezone: "America/Chicago" // CST timezone
    });
    console.log('   📱 SMS Cron: Daily briefing scheduled for 08:00 CST');
    
    // Send sports picks at 08:00 CST
    cron.schedule('0 14 * * *', async () => {
      console.log('🎯 [CRON] Sending daily sports picks SMS...');
      const picks = await generateDailySportsPicks();
      if (picks) {
        const result = await sendCevictBriefing(process.env.MY_PHONE_NUMBER, picks);
        if (result.success) {
          console.log('✅ Daily sports picks sent successfully');
        } else {
          console.error('❌ Failed to send sports picks:', result.error);
        }
      } else {
        console.log('⚠️ No sports picks to send today');
      }
    }, {
      timezone: "America/Chicago" // CST timezone
    });
    console.log('   🎯 SMS Cron: Daily sports picks scheduled for 08:00 CST');
  } else {
    console.log('   ⚠️  SMS Cron: Not configured (missing SINCH_API_TOKEN or MY_PHONE_NUMBER)');
  }
  
  // ============================================
  // PET MATCH ENGINE (24/7)
  // ============================================
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const { startMatchEngine } = require('./match-engine');
      startMatchEngine();
    } catch (error) {
      console.log('   ⚠️  Pet Match Engine: Not available (missing dependencies)');
    }
  } else {
    console.log('   ⚠️  Pet Match Engine: Not configured (missing Supabase credentials)');
  }
});
