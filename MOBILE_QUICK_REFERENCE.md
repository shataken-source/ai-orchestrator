# 📱 MOBILE QUICK REFERENCE

**Save this URL as a bookmark on your phone!**

---

## 🎛️ DASHBOARD (Main Control Center)

```
https://ai-orchestrator-production-7bbf.up.railway.app/dashboard.html?key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb
```

**Bookmark Name:** `AI Empire Dashboard`  
**Refresh every:** 10 seconds (auto)  

---

## ⚡ QUICK COMMANDS (Copy & Paste into Mobile Browser)

### **1. Check System Status**
```
https://ai-orchestrator-production-7bbf.up.railway.app/api/status?key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb
```

### **2. Check Alpha-Hunter Profits**
Use Shortcuts app or paste into Postman/Paw:
```
POST https://ai-orchestrator-production-7bbf.up.railway.app/api/command?key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb
Body: {"command": "check alpha-hunter profits"}
```

### **3. Emergency Kill Switch**
```
POST https://ai-orchestrator-production-7bbf.up.railway.app/api/kill-switch/activate?secret=victoria-emergency-stop-2026&key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb
```

---

## 📋 MOST COMMON COMMANDS

| Command | What It Does |
|---------|--------------|
| `"check alpha-hunter profits"` | Get trading bot P&L |
| `"deploy petreunion updates"` | Deploy PetReunion to production |
| `"@cursor fix the login bug"` | Send task directly to Cursor |
| `"generate SEO content for petreunion"` | Send to Gemini for content |
| `"status"` | Get full system status |

---

## 🔑 YOUR ADMIN KEY (Do Not Share)

```
84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb
```

**Emergency Kill Switch Secret:**
```
victoria-emergency-stop-2026
```

---

## 📞 ALEXA INTEGRATION (Coming Soon)

```
"Alexa, ask AI Empire to check alpha hunter profits"
"Alexa, tell AI Empire to deploy pet reunion"
"Alexa, ask AI Empire what is the system status"
```

---

## 🚨 IF SOMETHING GOES WRONG

1. **Check Health:**  
   `https://ai-orchestrator-production-7bbf.up.railway.app/health`

2. **Activate Kill Switch:**  
   `POST /api/kill-switch/activate?secret=victoria-emergency-stop-2026&key=YOUR_KEY`

3. **Contact Human:**  
   Email: `shataken@gmail.com`

---

## 💡 iOS SHORTCUTS (Optional)

### **Create Shortcut: "Check Trading Bot"**
1. Open Shortcuts app
2. New Shortcut → Add Action → Get Contents of URL
3. URL: `https://ai-orchestrator-production-7bbf.up.railway.app/api/command?key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb`
4. Method: POST
5. Request Body: JSON
   ```json
   {"command": "check alpha-hunter profits"}
   ```
6. Add "Show Result" action
7. Name it "Check Trading Bot"
8. Add to Home Screen

### **Create Shortcut: "Emergency Stop"**
Same as above, but:
- URL: `https://ai-orchestrator-production-7bbf.up.railway.app/api/kill-switch/activate?secret=victoria-emergency-stop-2026&key=84f08fc8449510e4839aa899a708413822fa7fe34abfc027df90aa4246afb7cb`
- Method: POST
- Name: "🚨 EMERGENCY STOP"
- Make it RED

---

## 📊 WHAT TO MONITOR

**Daily:**
- Dashboard shows all agents online
- No pending tasks older than 1 hour
- Kill switch status = `false`

**Weekly:**
- Check `/api/trades/summary` for P&L
- Review completed tasks count
- Verify no rate limit hits

**Monthly:**
- Review Railway bill (should be ~$5-10/month)
- Check Supabase storage (<100MB)

---

**Last Updated:** January 2, 2026  
**Status:** ✅ LIVE IN PRODUCTION

