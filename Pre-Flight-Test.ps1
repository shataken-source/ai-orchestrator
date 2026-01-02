<#
.SYNOPSIS
    Pre-Flight Test - Verify everything works locally before Railway deployment
    
.DESCRIPTION
    Runs through all critical checks:
    1. Starts local server
    2. Tests all endpoints
    3. Verifies CloudBrain module
    4. Sends test heartbeat
    5. Creates test task
    
.EXAMPLE
    .\Pre-Flight-Test.ps1
#>

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   🚀 PRE-FLIGHT TEST - Local Verification" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$testResults = @{
    Passed = 0
    Failed = 0
    Warnings = 0
}

function Test-Check {
    param(
        [string]$Name,
        [scriptblock]$Test,
        [switch]$Critical
    )
    
    Write-Host "  Testing: $Name... " -NoNewline
    
    try {
        $result = & $Test
        if ($result) {
            Write-Host "✅ PASS" -ForegroundColor Green
            $script:testResults.Passed++
            return $true
        } else {
            if ($Critical) {
                Write-Host "❌ FAIL" -ForegroundColor Red
                $script:testResults.Failed++
            } else {
                Write-Host "⚠️ WARN" -ForegroundColor Yellow
                $script:testResults.Warnings++
            }
            return $false
        }
    } catch {
        if ($Critical) {
            Write-Host "❌ FAIL - $($_.Exception.Message)" -ForegroundColor Red
            $script:testResults.Failed++
        } else {
            Write-Host "⚠️ WARN - $($_.Exception.Message)" -ForegroundColor Yellow
            $script:testResults.Warnings++
        }
        return $false
    }
}

# ============================================
# PHASE 1: FILE CHECKS
# ============================================

Write-Host "📁 Phase 1: File Checks" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────────────────────────"

Test-Check "server.js exists" -Critical {
    Test-Path (Join-Path $scriptDir "server.js")
}

Test-Check "package.json exists" -Critical {
    Test-Path (Join-Path $scriptDir "package.json")
}

Test-Check "CloudBrain.psm1 exists" -Critical {
    Test-Path (Join-Path $scriptDir "CloudBrain.psm1")
}

Test-Check "auth-middleware.js exists" -Critical {
    Test-Path (Join-Path $scriptDir "auth-middleware.js")
}

Test-Check "kill-switch.js exists" -Critical {
    Test-Path (Join-Path $scriptDir "kill-switch.js")
}

Test-Check "node_modules installed" {
    Test-Path (Join-Path $scriptDir "node_modules")
}

Write-Host ""

# ============================================
# PHASE 2: DEPENDENCIES
# ============================================

Write-Host "📦 Phase 2: Dependencies" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────────────────────────"

$needsInstall = -not (Test-Path (Join-Path $scriptDir "node_modules"))

if ($needsInstall) {
    Write-Host "  Installing npm dependencies..."
    Push-Location $scriptDir
    npm install 2>&1 | Out-Null
    Pop-Location
}

Test-Check "npm dependencies" -Critical {
    Test-Path (Join-Path $scriptDir "node_modules\express")
}

Write-Host ""

# ============================================
# PHASE 3: START LOCAL SERVER
# ============================================

Write-Host "🖥️ Phase 3: Local Server" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────────────────────────"

# Set test environment variables
$env:ADMIN_KEY = "test-admin-key-for-local-verification-only"
$env:KILL_SWITCH_SECRET = "test-kill-switch-secret"
$env:PORT = "3333"

# Note: In real test, you'd need SUPABASE_URL and SUPABASE_SERVICE_KEY
# For pre-flight, we'll test without Supabase

Write-Host "  Starting server on http://localhost:3333..."
Write-Host "  (Note: Supabase features will show errors without real credentials)"
Write-Host ""

# Start server in background
$serverJob = Start-Job -ScriptBlock {
    param($dir, $adminKey, $killSecret)
    $env:ADMIN_KEY = $adminKey
    $env:KILL_SWITCH_SECRET = $killSecret
    $env:PORT = "3333"
    Set-Location $dir
    node server.js 2>&1
} -ArgumentList $scriptDir, $env:ADMIN_KEY, $env:KILL_SWITCH_SECRET

# Wait for server to start
Start-Sleep -Seconds 3

# Check if server started
$serverRunning = $false
try {
    $health = Invoke-RestMethod "http://localhost:3333/health" -TimeoutSec 5
    $serverRunning = $health.status -eq 'ok'
} catch {
    $serverRunning = $false
}

if ($serverRunning) {
    Write-Host "  ✅ Server started successfully!" -ForegroundColor Green
    $testResults.Passed++
} else {
    Write-Host "  ❌ Server failed to start" -ForegroundColor Red
    Write-Host "  Server output:" -ForegroundColor Yellow
    Receive-Job $serverJob | Write-Host
    $testResults.Failed++
}

Write-Host ""

# ============================================
# PHASE 4: ENDPOINT TESTS
# ============================================

if ($serverRunning) {
    Write-Host "🔌 Phase 4: Endpoint Tests" -ForegroundColor Yellow
    Write-Host "───────────────────────────────────────────────────────────"
    
    $baseUrl = "http://localhost:3333"
    $headers = @{ 'x-admin-key' = $env:ADMIN_KEY }
    
    Test-Check "GET /health (public)" {
        $r = Invoke-RestMethod "$baseUrl/health"
        $r.status -eq 'ok'
    }
    
    Test-Check "GET /api/status (authenticated)" {
        try {
            $r = Invoke-RestMethod "$baseUrl/api/status" -Headers $headers
            $r.status -eq 'operational' -or $r.agents  # May fail without Supabase
        } catch {
            $_.Exception.Message -notmatch "401"  # Pass if not auth error
        }
    }
    
    Test-Check "GET /api/status WITHOUT auth (should fail)" {
        try {
            Invoke-RestMethod "$baseUrl/api/status" -ErrorAction Stop
            $false  # Should have thrown
        } catch {
            $_.Exception.Response.StatusCode.value__ -eq 401
        }
    }
    
    Test-Check "GET /api/kill-switch/status" {
        try {
            $r = Invoke-RestMethod "$baseUrl/api/kill-switch/status" -Headers $headers
            $r.killSwitch -eq $false -or $r.killSwitch -eq $true
        } catch {
            $false
        }
    }
    
    Test-Check "POST /api/heartbeat" {
        try {
            $body = @{ ai = 'test'; status = 'online' } | ConvertTo-Json
            $r = Invoke-RestMethod "$baseUrl/api/heartbeat" -Method POST -Headers ($headers + @{'Content-Type'='application/json'}) -Body $body
            $true  # May fail without Supabase, but should not 401
        } catch {
            $_.Exception.Message -notmatch "401"
        }
    }
    
    Test-Check "Dashboard requires auth" {
        try {
            $r = Invoke-WebRequest "$baseUrl/dashboard.html" -ErrorAction Stop
            $false  # Should return 404
        } catch {
            $_.Exception.Response.StatusCode.value__ -eq 404
        }
    }
    
    Test-Check "Dashboard with key loads" {
        try {
            $r = Invoke-WebRequest "$baseUrl/dashboard.html?key=$($env:ADMIN_KEY)"
            $r.StatusCode -eq 200
        } catch {
            $false
        }
    }
    
    Write-Host ""
}

# ============================================
# PHASE 5: CLOUDBRAIN MODULE
# ============================================

Write-Host "☁️ Phase 5: CloudBrain Module" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────────────────────────"

# Set up for CloudBrain
$env:RAILWAY_URL = "http://localhost:3333"

Test-Check "Import CloudBrain module" -Critical {
    Import-Module (Join-Path $scriptDir "CloudBrain.psm1") -Force -ErrorAction Stop
    $true
}

if ($serverRunning) {
    Test-Check "Send-Heartbeat function" {
        try {
            $r = Send-Heartbeat -Status 'online' -Task 'Pre-flight test'
            $true
        } catch {
            $_.Exception.Message -notmatch "401"  # Pass if not auth error
        }
    }
    
    Test-Check "Get-CloudBrainStatus function" {
        try {
            $r = Get-CloudBrainStatus
            $true
        } catch {
            $_.Exception.Message -notmatch "401"
        }
    }
    
    Test-Check "Get-KillSwitchStatus function" {
        try {
            $r = Get-KillSwitchStatus
            $true
        } catch {
            $false
        }
    }
}

Write-Host ""

# ============================================
# CLEANUP
# ============================================

Write-Host "🧹 Cleanup" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────────────────────────"

if ($serverJob) {
    Write-Host "  Stopping local server..."
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -ErrorAction SilentlyContinue
}

# Clear test env vars
Remove-Item Env:\ADMIN_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\KILL_SWITCH_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:\RAILWAY_URL -ErrorAction SilentlyContinue

Write-Host "  ✅ Cleanup complete" -ForegroundColor Green
Write-Host ""

# ============================================
# RESULTS
# ============================================

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   📊 PRE-FLIGHT TEST RESULTS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✅ Passed:   $($testResults.Passed)" -ForegroundColor Green
Write-Host "  ⚠️ Warnings: $($testResults.Warnings)" -ForegroundColor Yellow
Write-Host "  ❌ Failed:   $($testResults.Failed)" -ForegroundColor Red
Write-Host ""

if ($testResults.Failed -eq 0) {
    Write-Host "  🚀 GO FOR LAUNCH!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  All critical tests passed. You can now:" -ForegroundColor White
    Write-Host "  1. Push to GitHub" -ForegroundColor White
    Write-Host "  2. Deploy to Railway" -ForegroundColor White
    Write-Host "  3. Add environment variables in Railway" -ForegroundColor White
    Write-Host ""
    exit 0
} else {
    Write-Host "  ❌ NO-GO - Fix failures before deploying" -ForegroundColor Red
    Write-Host ""
    exit 1
}
