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
  
  // Serve a simple dashboard
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI Empire Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #0f172a; color: white; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-bold">☁️ AI Empire Cloud Orchestrator</h1>
    <div id="killSwitch" class="text-sm"></div>
  </div>
  <div id="status" class="grid grid-cols-2 md:grid-cols-4 gap-4">Loading...</div>
  <div class="mt-4">
    <h2 class="text-lg font-bold mb-2">📋 Recent Tasks</h2>
    <div id="tasks" class="text-sm text-gray-400">Loading...</div>
  </div>
  <div class="mt-4 text-xs text-gray-600">
    Last updated: <span id="lastUpdate">-</span>
  </div>
  <script>
    const API_KEY = '${key}';
    
    async function load() {
      try {
        const res = await fetch('/api/status', {
          headers: { 'x-admin-key': API_KEY }
        });
        const data = await res.json();
        
        document.getElementById('status').innerHTML = data.agents.map(a => \`
          <div class="bg-gray-800 p-4 rounded-lg border-l-4 \${
            a.status === 'online' ? 'border-green-500' : 
            a.status === 'offline' ? 'border-red-500' : 'border-yellow-500'
          }">
            <div class="flex justify-between items-center">
              <h2 class="font-bold capitalize">\${a.name}</h2>
              <span class="text-xs px-2 py-1 rounded \${
                a.status === 'online' ? 'bg-green-600' : 
                a.status === 'offline' ? 'bg-red-600' : 'bg-yellow-600'
              }">\${a.status}</span>
            </div>
            <div class="text-sm text-gray-400 mt-1">Pending: \${a.pendingTasks}</div>
            <div class="text-xs text-gray-500 mt-1">\${a.projects === 'ALL' ? 'All projects' : a.projects?.slice(0,2).join(', ') + '...'}</div>
          </div>
        \`).join('');
        
        const killRes = await fetch('/api/kill-switch/status', {
          headers: { 'x-admin-key': API_KEY }
        });
        const killData = await killRes.json();
        document.getElementById('killSwitch').innerHTML = killData.killSwitch 
          ? '<span class="bg-red-600 px-2 py-1 rounded pulse">🛑 KILLED</span>'
          : '<span class="bg-green-600 px-2 py-1 rounded">✅ Active</span> ' + 
            '<span class="text-gray-500">(' + killData.counters.today + ' req today)</span>';
        
        document.getElementById('tasks').innerHTML = data.recentCompletions?.slice(0,3).map(t =>
          \`<div class="bg-gray-800 p-2 rounded mb-1">\${t.task_id}: \${t.description?.slice(0,50)}...</div>\`
        ).join('') || 'No recent tasks';
        
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
      } catch (e) {
        document.getElementById('status').innerHTML = '<div class="text-red-500">Error: ' + e.message + '</div>';
      }
    }
    load();
    setInterval(load, 10000);
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
  console.log('   GET  /api/kill-switch/status - Cost monitoring');
  console.log('   GET  /dashboard.html?key=X  - Dashboard (protected)');
  console.log('═══════════════════════════════════════════════════════════');
});
