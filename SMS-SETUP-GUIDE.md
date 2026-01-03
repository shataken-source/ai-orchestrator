# SMS Daily Briefing Setup Guide

## Overview

The Cloud Orchestrator now sends daily SMS briefings at 08:00 CST via Sinch API.

## Environment Variables

Add these to Railway dashboard (Variables tab):

```
SINCH_SERVICE_PLAN_ID=5ead1f97ab94481c80d3a52e13de95bb
SINCH_API_TOKEN=78f84e980220406892c2cfccf515e755
SINCH_NUMBER=+12085812971
MY_PHONE_NUMBER=+12562645669
```

**Note:** `SINCH_NUMBER` can also be set as `SINCH_FROM` (backwards compatible)

## Installation

After deploying, install new dependencies:

```bash
npm install
```

## Testing

### Manual Test Endpoint

Send a test SMS briefing:

```bash
curl -X POST "https://ai-orchestrator-production-7bbf.up.railway.app/api/test/sms" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+12562645669", "message": "Test briefing message"}'
```

Or use default phone number from env:

```bash
curl -X POST "https://ai-orchestrator-production-7bbf.up.railway.app/api/test/sms" \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

### Custom Message

```bash
curl -X POST "https://ai-orchestrator-production-7bbf.up.railway.app/api/test/sms" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Custom briefing text here"}'
```

## Daily Briefing Content

The briefing includes:
- Date and time
- AI status (Claude and Gemini pending tasks)
- Trading summary (trades today, P/L)
- System status
- Dashboard link

## Cron Schedule

- **Time:** 08:00 CST (14:00 UTC)
- **Timezone:** America/Chicago
- **Frequency:** Daily

## Troubleshooting

### SMS Not Sending

1. Check environment variables are set in Railway
2. Verify Sinch credentials are correct
3. Check server logs for error messages
4. Test endpoint manually to verify API connection

### Cron Not Running

1. Verify `node-cron` is installed: `npm list node-cron`
2. Check server startup logs for cron confirmation
3. Verify timezone is correct (America/Chicago)

### Missing Dependencies

```bash
cd cloud-orchestrator
npm install axios node-cron
```

## API Reference

### POST /api/test/sms

**Headers:**
- `x-admin-key`: Admin authentication key
- `Content-Type`: application/json

**Body (optional):**
```json
{
  "phone": "+12562645669",  // Optional, uses MY_PHONE_NUMBER if not provided
  "message": "Custom text"  // Optional, generates daily briefing if not provided
}
```

**Response:**
```json
{
  "success": true,
  "message": "SMS sent successfully",
  "batchId": "sinch-batch-id",
  "phoneNumber": "+12562645669",
  "textPreview": "📊 CEVICT DAILY BRIEFING..."
}
```

## Status

✅ **COMPLETED**
- SMS function integrated
- Cron job configured
- Test endpoint created
- Ready for deployment

