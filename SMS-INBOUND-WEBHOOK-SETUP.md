# 📱 SMS Inbound Webhook Setup

**Status:** ✅ IMPLEMENTED  
**Date:** January 3, 2026

---

## Overview

The Cloud Orchestrator now has an SMS inbound webhook endpoint that receives SMS messages from Sinch and processes commands.

---

## Endpoint

**URL:** `POST /api/webhook/sinch`  
**Authentication:** Public (no auth required - webhook is verified by sender phone number)

---

## Supported Commands

### 1. GOTIT / GOT IT
**Purpose:** Guardian Pulse check-in  
**Action:** Resets the Guardian timer  
**Response:** "Check-in confirmed, timer reset"

### 2. STATUS / STAT
**Purpose:** Get system status  
**Action:** Returns system health, pending tasks, request counts  
**Response:** "System OK. Claude: X tasks, Gemini: Y tasks. Requests today: Z"

### 3. STOP / EMERGENCY
**Purpose:** Emergency stop  
**Action:** Activates kill switch  
**Response:** "Emergency stop activated via SMS"

### 4. HELP / ?
**Purpose:** Show available commands  
**Response:** List of all commands

### 5. Any Other Text
**Purpose:** Create task for AI  
**Action:** Parses command and creates task for Claude or Gemini  
**Response:** "Command sent to [AI]: [your message]"

---

## Authorized Phone Numbers

The webhook only processes messages from these numbers (set in environment variables):

- `MY_PHONE_NUMBER` - Jason's phone
- `VICTORIA_PHONE` - Victoria's phone  
- `NAVID_PHONE` - Navid's phone

**Unauthorized senders are rejected silently.**

---

## Sinch Dashboard Configuration

### Step 1: Configure Webhook URL

1. Go to Sinch Dashboard → Your Service Plan → Settings
2. Find "Inbound SMS" or "Webhooks" section
3. Set webhook URL:
   ```
   https://ai-orchestrator-production-7bbf.up.railway.app/api/webhook/sinch
   ```

### Step 2: Configure Webhook Events

Enable these events:
- ✅ Inbound SMS
- ✅ Delivery Reports (optional)

### Step 3: Test Webhook

Send a test SMS to your Sinch number:
```
STATUS
```

You should receive a confirmation SMS back with system status.

---

## Environment Variables

Add to Railway dashboard:

```
MY_PHONE_NUMBER=+12562645669
VICTORIA_PHONE=+1XXXXXXXXXX
NAVID_PHONE=+1XXXXXXXXXX
```

---

## Webhook Payload Format

Sinch sends webhooks in this format:

```json
{
  "from": "+12562645669",
  "to": "+12085812971",
  "body": "STATUS",
  "type": "mt_text",
  "received_at": "2026-01-03T10:00:00Z"
}
```

The webhook handler supports multiple field name variations:
- `from` or `from_` or `sender`
- `body` or `text` or `message`

---

## Response Format

The webhook returns:

```json
{
  "success": true,
  "action": "status_request",
  "message": "System OK. Claude: 5 tasks, Gemini: 2 tasks. Requests today: 123"
}
```

A confirmation SMS is also sent back to the sender (if SMS is configured).

---

## Use Cases

### 1. Guardian Pulse Check-In
Jason receives daily heartbeat SMS, replies "GOTIT" to reset timer.

### 2. Quick Status Check
Anyone can text "STATUS" to get system health without opening dashboard.

### 3. Emergency Stop
Text "STOP" to immediately halt all services (kill switch).

### 4. AI Commands
Text any command like "check alpha-hunter profits" and it creates a task for Claude/Gemini.

---

## Security

- ✅ Sender verification (only authorized numbers)
- ✅ Public endpoint (no auth header needed - Sinch can't send headers)
- ✅ Command validation
- ✅ Logging of all webhook events

---

## Testing

### Manual Test

```bash
curl -X POST "https://ai-orchestrator-production-7bbf.up.railway.app/api/webhook/sinch" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+12562645669",
    "to": "+12085812971",
    "body": "STATUS"
  }'
```

### Via SMS

1. Send SMS to your Sinch number: `STATUS`
2. Wait for confirmation SMS
3. Check server logs for webhook receipt

---

## Integration with Other Systems

### Guardian Pulse
- `GOTIT` command resets Guardian timer
- Can be extended to update Supabase

### Task Creation
- Any unrecognized command creates a task
- Uses `parseCommand()` to route to Claude/Gemini
- Tasks appear in AI inboxes

### Kill Switch
- `STOP` command activates emergency stop
- Logs event to `kill_switch_events` table

---

## Status

✅ **READY FOR DEPLOYMENT**

- [x] Webhook endpoint created
- [x] Command processing implemented
- [x] Sender verification added
- [x] Public path configured
- [x] Confirmation SMS support
- [ ] Sinch Dashboard configured (pending)
- [ ] Environment variables added (pending)

---

**Next Step:** Configure webhook URL in Sinch Dashboard once service is live! 🚀

