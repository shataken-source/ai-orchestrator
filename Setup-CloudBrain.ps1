<#
.SYNOPSIS
    CloudBrain Setup Script
    
.DESCRIPTION
    Quick setup to configure CloudBrain for your environment.
    Run this once after deploying to Railway.

.EXAMPLE
    .\Setup-CloudBrain.ps1
#>

Write-Host ""
Write-Host "☁️  CloudBrain Setup" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

# Check if already configured
if ($env:ADMIN_KEY -and $env:RAILWAY_URL) {
    Write-Host "✅ CloudBrain already configured!" -ForegroundColor Green
    Write-Host "   URL: $env:RAILWAY_URL"
    Write-Host "   Key: $($env:ADMIN_KEY.Substring(0,8))..."
    Write-Host ""
    Write-Host "To reconfigure, clear the environment variables first:"
    Write-Host '   Remove-Item Env:\ADMIN_KEY'
    Write-Host '   Remove-Item Env:\RAILWAY_URL'
    exit 0
}

# Get Railway URL
Write-Host "Enter your Railway URL" -ForegroundColor Yellow
Write-Host "(e.g., https://ai-orchestrator-production-xxxx.up.railway.app)"
$railwayUrl = Read-Host "URL"

if (-not $railwayUrl) {
    Write-Host "❌ URL is required!" -ForegroundColor Red
    exit 1
}

# Validate URL
$railwayUrl = $railwayUrl.TrimEnd('/')
if (-not $railwayUrl.StartsWith('http')) {
    $railwayUrl = "https://$railwayUrl"
}

# Get Admin Key
Write-Host ""
Write-Host "Enter your ADMIN_KEY" -ForegroundColor Yellow
Write-Host "(The 64-character key you set in Railway Variables)"
$adminKey = Read-Host "Key" -AsSecureString
$adminKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminKey)
)

if (-not $adminKeyPlain -or $adminKeyPlain.Length -lt 16) {
    Write-Host "❌ Admin key seems too short. Should be 32-64 characters." -ForegroundColor Red
    exit 1
}

# Get Bot Name (optional)
Write-Host ""
Write-Host "Enter a name for this bot (optional, default: powershell)" -ForegroundColor Yellow
$botName = Read-Host "Bot Name"
if (-not $botName) { $botName = "powershell" }

# Set environment variables for current session
$env:RAILWAY_URL = $railwayUrl
$env:ADMIN_KEY = $adminKeyPlain
$env:BOT_NAME = $botName

Write-Host ""
Write-Host "✅ Environment configured for this session!" -ForegroundColor Green

# Test connection
Write-Host ""
Write-Host "Testing connection..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$railwayUrl/health" -TimeoutSec 10
    Write-Host "✅ Connection successful!" -ForegroundColor Green
    Write-Host "   Service: $($response.service)"
    Write-Host "   Status: $($response.status)"
} catch {
    Write-Host "❌ Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Check your Railway URL and ensure the service is running."
}

# Offer to persist
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "To make this permanent, add to your PowerShell profile:" -ForegroundColor Yellow
Write-Host ""
Write-Host '  $env:RAILWAY_URL = "' -NoNewline
Write-Host $railwayUrl -ForegroundColor Cyan -NoNewline
Write-Host '"'
Write-Host '  $env:ADMIN_KEY = "' -NoNewline
Write-Host "$($adminKeyPlain.Substring(0,4))...your-key..." -ForegroundColor Cyan -NoNewline
Write-Host '"'
Write-Host '  $env:BOT_NAME = "' -NoNewline
Write-Host $botName -ForegroundColor Cyan -NoNewline
Write-Host '"'
Write-Host ""
Write-Host "Profile location: $PROFILE"
Write-Host ""

# Save to profile?
$saveToProfile = Read-Host "Add to PowerShell profile? (y/N)"
if ($saveToProfile -eq 'y' -or $saveToProfile -eq 'Y') {
    $profileDir = Split-Path $PROFILE -Parent
    if (-not (Test-Path $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }
    
    $profileContent = @"

# CloudBrain Configuration (added by Setup-CloudBrain.ps1)
`$env:RAILWAY_URL = "$railwayUrl"
`$env:ADMIN_KEY = "$adminKeyPlain"
`$env:BOT_NAME = "$botName"
"@
    
    Add-Content -Path $PROFILE -Value $profileContent
    Write-Host "✅ Added to profile: $PROFILE" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "Setup complete! Now you can use CloudBrain:" -ForegroundColor Green
Write-Host ""
Write-Host "  Import-Module .\CloudBrain.psm1"
Write-Host "  Send-Heartbeat -Status 'online'"
Write-Host "  Get-NextTask"
Write-Host ""
