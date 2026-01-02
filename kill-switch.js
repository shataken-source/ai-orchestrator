/**
 * 🛑 KILL SWITCH & COST CONTROL
 * 
 * Prevents runaway cloud costs with:
 * - Manual kill switch
 * - Rate limiting
 * - Request counting
 * - Auto-shutdown on threshold
 */

const COST_CONFIG = {
  KILL_SWITCH_ENABLED: process.env.KILL_SWITCH === 'true',
  KILL_SWITCH_SECRET: process.env.KILL_SWITCH_SECRET || 'emergency-stop-12345',
  
  RATE_LIMITS: {
    global: 1000,
    perIP: 60,
    perEndpoint: {
      '/api/command': 30,
      '/api/webhook': 60,
      '/api/inbox': 100,
    }
  },
  
  BUDGET: {
    dailyRequestLimit: 50000,
    monthlyRequestLimit: 1000000,
    alertThreshold: 0.8,
  }
};

const counters = {
  requests: {
    total: 0,
    today: 0,
    thisHour: 0,
    thisMinute: 0,
    byIP: new Map(),
    byEndpoint: new Map(),
  },
  lastReset: {
    minute: Date.now(),
    hour: Date.now(),
    day: Date.now(),
  },
  killSwitch: COST_CONFIG.KILL_SWITCH_ENABLED,
  alerts: {
    budgetWarning: false,
    budgetCritical: false,
  }
};

function resetCounters() {
  const now = Date.now();
  
  if (now - counters.lastReset.minute > 60000) {
    counters.requests.thisMinute = 0;
    counters.requests.byIP.clear();
    counters.lastReset.minute = now;
  }
  
  if (now - counters.lastReset.hour > 3600000) {
    counters.requests.thisHour = 0;
    counters.lastReset.hour = now;
  }
  
  if (now - counters.lastReset.day > 86400000) {
    counters.requests.today = 0;
    counters.alerts.budgetWarning = false;
    counters.alerts.budgetCritical = false;
    counters.lastReset.day = now;
  }
}

function killSwitchMiddleware(req, res, next) {
  if (req.path === '/api/kill-switch' || req.path === '/health') {
    return next();
  }
  
  if (counters.killSwitch) {
    return res.status(503).json({
      error: 'Service temporarily disabled',
      reason: 'Kill switch activated',
      message: 'Contact administrator to re-enable'
    });
  }
  
  next();
}

function rateLimitMiddleware(req, res, next) {
  resetCounters();
  
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const endpoint = req.path;
  
  counters.requests.total++;
  counters.requests.today++;
  counters.requests.thisHour++;
  counters.requests.thisMinute++;
  
  const ipCount = (counters.requests.byIP.get(ip) || 0) + 1;
  counters.requests.byIP.set(ip, ipCount);
  
  const endpointCount = (counters.requests.byEndpoint.get(endpoint) || 0) + 1;
  counters.requests.byEndpoint.set(endpoint, endpointCount);
  
  if (counters.requests.thisMinute > COST_CONFIG.RATE_LIMITS.global) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60
    });
  }
  
  if (ipCount > COST_CONFIG.RATE_LIMITS.perIP) {
    return res.status(429).json({
      error: 'Too many requests from this IP',
      retryAfter: 60
    });
  }
  
  const endpointLimit = COST_CONFIG.RATE_LIMITS.perEndpoint[endpoint];
  if (endpointLimit && endpointCount > endpointLimit) {
    return res.status(429).json({
      error: 'Endpoint rate limit exceeded',
      retryAfter: 60
    });
  }
  
  next();
}

async function budgetControlMiddleware(req, res, next) {
  if (counters.requests.today >= COST_CONFIG.BUDGET.dailyRequestLimit) {
    counters.killSwitch = true;
    return res.status(503).json({
      error: 'Daily budget exceeded',
      message: 'Service auto-disabled to prevent cost overrun'
    });
  }
  
  next();
}

function killSwitchRoutes(app) {
  app.get('/api/kill-switch/status', (req, res) => {
    res.json({
      killSwitch: counters.killSwitch,
      counters: {
        total: counters.requests.total,
        today: counters.requests.today,
        thisHour: counters.requests.thisHour,
        thisMinute: counters.requests.thisMinute,
      },
      limits: {
        dailyLimit: COST_CONFIG.BUDGET.dailyRequestLimit,
        dailyUsagePercent: (counters.requests.today / COST_CONFIG.BUDGET.dailyRequestLimit * 100).toFixed(2) + '%',
      },
      alerts: counters.alerts,
    });
  });
  
  app.post('/api/kill-switch/activate', (req, res) => {
    const { secret } = req.body;
    
    if (secret !== COST_CONFIG.KILL_SWITCH_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
    
    counters.killSwitch = true;
    res.json({ success: true, message: 'Kill switch activated' });
  });
  
  app.post('/api/kill-switch/deactivate', (req, res) => {
    const { secret } = req.body;
    
    if (secret !== COST_CONFIG.KILL_SWITCH_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
    
    counters.killSwitch = false;
    res.json({ success: true, message: 'Kill switch deactivated' });
  });
  
  app.get('/api/emergency-stop/:secret', (req, res) => {
    if (req.params.secret !== COST_CONFIG.KILL_SWITCH_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
    
    counters.killSwitch = true;
    res.json({ success: true, message: 'EMERGENCY STOP - Service halted' });
  });
}

function getCounters() {
  return counters;
}

module.exports = {
  killSwitchMiddleware,
  rateLimitMiddleware,
  budgetControlMiddleware,
  killSwitchRoutes,
  getCounters,
  COST_CONFIG
};
