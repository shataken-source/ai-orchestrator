# 🚀 Railway Environment Variables Update

**For Pet Image Matching System**

---

## Required Variables to Add

Go to: **Railway Dashboard → ai-orchestrator → Variables**

Add these new environment variables:

```
OPENAI_API_KEY=sk-proj-...your-key...
```

---

## Full Environment Variables Checklist

| Variable | Status | Purpose |
|----------|--------|---------|
| `SUPABASE_URL` | ✅ Already set | Database connection |
| `SUPABASE_SERVICE_KEY` | ✅ Already set | Database auth |
| `SINCH_API_TOKEN` | ✅ Already set | SMS notifications |
| `SINCH_SERVICE_PLAN_ID` | ✅ Already set | SMS account |
| `SINCH_NUMBER` | ✅ Already set | SMS from number |
| `MY_PHONE_NUMBER` | ✅ Already set | Jason's phone |
| `OPENAI_API_KEY` | ➕ **ADD THIS** | Vector generation |

---

## How to Add

1. Open Railway Dashboard
2. Click on `ai-orchestrator` service
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Add:
   - Key: `OPENAI_API_KEY`
   - Value: Your OpenAI API key (starts with `sk-`)
6. Railway will auto-redeploy

---

## Verify Deployment

After Railway redeploys, check the logs for:

```
╔═══════════════════════════════════════════════════════════╗
║         🐕 PET MATCH ENGINE - STARTING                     ║
╚═══════════════════════════════════════════════════════════╝
   Match Threshold: 85%
   Max Distance: 50 miles
   Check Interval: 5 minutes

✅ Match engine running - checking every 5 minutes
```

---

## Test Endpoint

Once deployed, test the match engine:

```bash
curl "https://ai-orchestrator-production-7bbf.up.railway.app/api/health" \
  -H "x-admin-key: 84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb"
```

---

## Match Engine Status

The match engine is integrated into `server.js` and starts automatically.

It runs every 5 minutes to:
1. Check all lost pets with vectors
2. Compare against found pets
3. Send SMS notifications on matches

No manual start required - it's a background process.

