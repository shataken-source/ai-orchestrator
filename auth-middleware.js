/**
 * 🔐 AUTHENTICATION MIDDLEWARE
 * 
 * Protects all API endpoints with API key authentication
 * 
 * Usage:
 *   All requests to /api/* must include header:
 *   x-admin-key: YOUR_ADMIN_KEY
 *   
 *   Or query parameter:
 *   ?key=YOUR_ADMIN_KEY
 */

// ============================================
// CONFIGURATION
// ============================================

const AUTH_CONFIG = {
  // Admin key for full access
  ADMIN_KEY: process.env.ADMIN_KEY || process.env.MASTER_KEY,
  
  // Optional: separate keys for different access levels
  KEYS: {
    admin: process.env.ADMIN_KEY,           // Full access
    bot: process.env.BOT_KEY,               // Bot-only endpoints
    readonly: process.env.READONLY_KEY,     // Read-only access
    dashboard: process.env.DASHBOARD_KEY,   // Dashboard access
  },
  
  // Public endpoints (no auth required)
  PUBLIC_ENDPOINTS: [
    '/health',
    '/api/webhook/voice',      // Alexa/Google need to reach this
    '/api/webhook/github',     // GitHub webhooks
    '/api/webhook/sinch',      // Sinch SMS inbound webhook
  ],
  
  // Webhook secrets (for signed requests)
  WEBHOOK_SECRETS: {
    github: process.env.GITHUB_WEBHOOK_SECRET,
    alexa: process.env.ALEXA_SKILL_ID,
  }
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

function authMiddleware(req, res, next) {
  const path = req.path;
  
  // Allow public endpoints
  if (AUTH_CONFIG.PUBLIC_ENDPOINTS.some(p => path === p || path.startsWith(p))) {
    return next();
  }
  
  // Get key from header or query param
  const apiKey = 
    req.headers['x-admin-key'] || 
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.key;
  
  // No key provided
  if (!apiKey) {
    console.warn(`🔒 Auth failed: No API key - ${req.method} ${path} from ${req.ip}`);
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Provide x-admin-key header or ?key= query parameter'
    });
  }
  
  // Check against valid keys
  const validKeys = Object.values(AUTH_CONFIG.KEYS).filter(Boolean);
  
  if (!validKeys.includes(apiKey) && apiKey !== AUTH_CONFIG.ADMIN_KEY) {
    console.warn(`🔒 Auth failed: Invalid key - ${req.method} ${path} from ${req.ip}`);
    return res.status(403).json({
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
  }
  
  // Determine access level
  req.authLevel = 'admin'; // Default
  if (apiKey === AUTH_CONFIG.KEYS.bot) req.authLevel = 'bot';
  if (apiKey === AUTH_CONFIG.KEYS.readonly) req.authLevel = 'readonly';
  if (apiKey === AUTH_CONFIG.KEYS.dashboard) req.authLevel = 'dashboard';
  
  // Log successful auth (without exposing key)
  console.log(`🔓 Auth OK: ${req.authLevel} - ${req.method} ${path}`);
  
  next();
}

// ============================================
// WEBHOOK VERIFICATION
// ============================================

function verifyGitHubWebhook(req, res, next) {
  // Skip if no secret configured
  if (!AUTH_CONFIG.WEBHOOK_SECRETS.github) {
    return next();
  }
  
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const crypto = require('crypto');
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', AUTH_CONFIG.WEBHOOK_SECRETS.github);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  if (signature !== digest) {
    console.warn('🔒 GitHub webhook signature mismatch');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

function verifyAlexaRequest(req, res, next) {
  // Skip if no skill ID configured
  if (!AUTH_CONFIG.WEBHOOK_SECRETS.alexa) {
    return next();
  }
  
  const skillId = req.body?.session?.application?.applicationId ||
                  req.body?.context?.System?.application?.applicationId;
  
  if (skillId !== AUTH_CONFIG.WEBHOOK_SECRETS.alexa) {
    console.warn('🔒 Alexa skill ID mismatch');
    return res.status(401).json({ error: 'Invalid skill ID' });
  }
  
  next();
}

// ============================================
// DASHBOARD PROTECTION
// ============================================

function dashboardAuth(req, res, next) {
  const dashboardKey = 
    req.query.key || 
    req.headers['x-dashboard-key'];
  
  const validKey = AUTH_CONFIG.KEYS.dashboard || AUTH_CONFIG.ADMIN_KEY;
  
  if (!dashboardKey || dashboardKey !== validKey) {
    // Return a generic 404 to hide the dashboard exists
    return res.status(404).send('Not Found');
  }
  
  next();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  authMiddleware,
  dashboardAuth,
  verifyGitHubWebhook,
  verifyAlexaRequest,
  AUTH_CONFIG
};
