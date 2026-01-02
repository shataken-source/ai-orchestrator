# ☁️ AI EMPIRE CLOUD ORCHESTRATOR

## Deploy to Railway in 5 Minutes!

### Prerequisites
- GitHub account (you have this ✓)
- Railway account (free tier works)
- Supabase project (you have this ✓)

---

## 🚀 STEP 1: Push This to GitHub

```bash
# Create new repo or use existing
cd C:\cevict-live\cloud-orchestrator

# Initialize git (if needed)
git init
git add .
git commit -m "Cloud orchestrator v2.0"

# Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/ai-orchestrator.git
git push -u origin main
```

Or just copy these files into your existing `ai-orchestrator` repo!

---

## 🚂 STEP 2: Deploy to Railway

### Option A: One-Click (Easiest)
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `ai-orchestrator` repo
5. Railway auto-detects Node.js and deploys!

### Option B: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

---

## 🔐 STEP 3: Add Environment Variables

In Railway dashboard:
1. Click your project
2. Go to "Variables" tab
3. Add these (click "RAW Editor" for easy paste):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...
```

### How to Get Supabase Keys:
1. Go to [supabase.com](https://supabase.com) → Your Project
2. Settings → API
3. Copy `URL` and `service_role` key (not anon!)

---

## 🗄️ STEP 4: Run Supabase Schema

If not already done, run this SQL in Supabase SQL Editor:

```sql
-- See supabase-cloud-schema.sql file
```

---

## ✅ STEP 5: Verify Deployment

Railway gives you a URL like: `https://ai-orchestrator-production.up.railway.app`

Test it:
```bash
# Health check
curl https://YOUR-URL.railway.app/health

# Get status
curl https://YOUR-URL.railway.app/api/status

# Create a test task
curl -X POST https://YOUR-URL.railway.app/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"test from cloud","to":"claude"}'
```

---

## 📱 STEP 6: Update Your Apps

Update these to use the new cloud URL:

### cevict.com (Vercel)
Add environment variable:
```
ORCHESTRATOR_URL=https://YOUR-URL.railway.app
```

### Alexa Skill
Update endpoint to:
```
https://YOUR-URL.railway.app/api/webhook/voice
```

### Google Assistant
Update webhook to:
```
https://YOUR-URL.railway.app/api/webhook/voice
```

### Mobile Command Page
Already configured to use `/api/command` relative path!

---

## 🎯 API ENDPOINTS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/status` | GET | Full system status |
| `/api/inbox/:ai` | GET | Get AI's pending tasks |
| `/api/inbox/:ai/task` | POST | Create task for AI |
| `/api/task/:id/complete` | POST | Mark task done |
| `/api/command` | POST | Mobile commands |
| `/api/webhook/voice` | POST | Alexa/Google |
| `/api/webhook/github` | POST | GitHub events |
| `/api/trades/summary` | GET | Trading summary |
| `/dashboard.html` | GET | Live dashboard |

---

## 🔄 WEBHOOK SETUP

### GitHub Webhook (for auto-deploys)
1. Go to your GitHub repo → Settings → Webhooks
2. Add webhook:
   - URL: `https://YOUR-URL.railway.app/api/webhook/github`
   - Content type: `application/json`
   - Events: Push, Pull requests

### Alexa Webhook
1. Alexa Developer Console → Your Skill → Endpoint
2. Set: `https://YOUR-URL.railway.app/api/webhook/voice`

### Google Actions
1. Actions Console → Webhook
2. Set: `https://YOUR-URL.railway.app/api/webhook/voice`

---

## 🎉 YOU'RE DONE!

The AI Empire now runs 24/7 in the cloud!

Test the full flow:
1. Send command from phone
2. Check Railway logs
3. See task in Supabase
4. Receive confirmation

**Laptop can now sleep forever! 😴**
