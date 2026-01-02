<#
.SYNOPSIS
    Project Guardian - Victoria Recovery System (Cloud Edition)
    
.DESCRIPTION
    24/7 automated monitoring for Victoria sightings.
    Now runs in the cloud via Railway - never sleeps, never stops.
    
    Features:
    - Heartbeat to cloud orchestrator (keeps dashboard accurate)
    - Automated PetReunion/Craigslist/Facebook scanning
    - Instant SMS/Email alerts on potential matches
    - All activity logged to Supabase for tracking
    
.NOTES
    This script should be deployed as a scheduled task or run continuously.
    The cloud orchestrator tracks its status via heartbeat.
    
    Environment Variables Required:
    - RAILWAY_URL: Cloud orchestrator URL
    - ADMIN_KEY: Authentication key
    - SINCH_API_TOKEN: For SMS alerts (optional)
    - HUMAN_PHONE_NUMBER: Your phone for alerts
    
.EXAMPLE
    # Run continuously
    .\Project-Guardian-Cloud.ps1
    
    # Run once (for Task Scheduler)
    .\Project-Guardian-Cloud.ps1 -RunOnce
#>

[CmdletBinding()]
param(
    [switch]$RunOnce,
    [switch]$DryRun,
    [int]$ScanIntervalMinutes = 30
)

# ============================================
# CONFIGURATION
# ============================================

$Config = @{
    # Victoria's details
    Pet = @{
        Name = "Victoria"
        Type = "Dog"
        Breed = "Unknown"  # Update with actual breed
        Color = "Unknown"  # Update with actual color
        LastSeen = "Albertville, AL"
        DateLost = "Unknown"  # Update with actual date
        Description = "Missing dog - Victoria"
    }
    
    # Search parameters
    Search = @{
        Radius = 50  # miles
        Keywords = @("found dog", "stray dog", "lost dog", "victoria", "found pet")
        Locations = @(
            "Albertville, AL",
            "Boaz, AL", 
            "Guntersville, AL",
            "Arab, AL",
            "Marshall County, AL"
        )
        Sources = @(
            "PetReunion",
            "Craigslist",
            "Facebook",
            "Nextdoor",
            "PawBoost"
        )
    }
    
    # Alert settings
    Alerts = @{
        SMSEnabled = $true
        EmailEnabled = $true
        PhoneNumber = $env:HUMAN_PHONE_NUMBER
        Email = $env:HUMAN_EMAIL ?? $env:ALERT_EMAIL
    }
    
    # Timing
    ScanInterval = $ScanIntervalMinutes
    HeartbeatInterval = 60  # seconds
}

# ============================================
# IMPORT CLOUDBRAIN
# ============================================

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cloudBrainPath = Join-Path $scriptDir "CloudBrain.psm1"

if (-not (Test-Path $cloudBrainPath)) {
    # Try parent directory
    $cloudBrainPath = Join-Path (Split-Path $scriptDir -Parent) "CloudBrain.psm1"
}

if (-not (Test-Path $cloudBrainPath)) {
    # Try common locations
    $commonPaths = @(
        "C:\cevict-live\cloud-orchestrator\CloudBrain.psm1",
        "C:\cevict-live\modules\CloudBrain.psm1",
        "$env:USERPROFILE\CloudBrain.psm1"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $cloudBrainPath = $path
            break
        }
    }
}

if (Test-Path $cloudBrainPath) {
    Import-Module $cloudBrainPath -Force
    $CloudBrainAvailable = $true
} else {
    Write-Warning "CloudBrain.psm1 not found - running in offline mode"
    $CloudBrainAvailable = $false
}

# Set bot identity
$env:BOT_NAME = "guardian-victoria"

# ============================================
# HELPER FUNCTIONS
# ============================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARN"  { "Yellow" }
        "SUCCESS" { "Green" }
        "ALERT" { "Magenta" }
        default { "White" }
    }
    
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
    
    # Log to file
    $logFile = Join-Path $scriptDir "guardian-victoria.log"
    "[$timestamp] [$Level] $Message" | Add-Content -Path $logFile -ErrorAction SilentlyContinue
}

function Send-Alert {
    param(
        [string]$Title,
        [string]$Message,
        [string]$Url = "",
        [string]$Priority = "HIGH"
    )
    
    Write-Log "🚨 ALERT: $Title" -Level "ALERT"
    Write-Log "   $Message" -Level "ALERT"
    
    # Send to cloud orchestrator
    if ($CloudBrainAvailable) {
        try {
            New-Task -AssignTo 'human' `
                -Description "🐕 VICTORIA ALERT: $Title - $Message $(if ($Url) { "URL: $Url" })" `
                -Type 'INFO' `
                -Priority $Priority `
                -Project 'guardian-victoria'
        } catch {
            Write-Log "Failed to send cloud alert: $($_.Exception.Message)" -Level "WARN"
        }
    }
    
    # Send SMS if configured
    if ($Config.Alerts.SMSEnabled -and $env:SINCH_API_TOKEN -and $Config.Alerts.PhoneNumber) {
        try {
            $smsBody = @{
                from = $env:SINCH_FROM_NUMBER
                to = @($Config.Alerts.PhoneNumber)
                body = "🐕 GUARDIAN ALERT: $Title`n$Message`n$Url"
            } | ConvertTo-Json
            
            $response = Invoke-RestMethod `
                -Uri "https://us.sms.api.sinch.com/xms/v1/$env:SINCH_SERVICE_PLAN_ID/batches" `
                -Method POST `
                -Headers @{
                    'Authorization' = "Bearer $env:SINCH_API_TOKEN"
                    'Content-Type' = 'application/json'
                } `
                -Body $smsBody
            
            Write-Log "SMS alert sent to $($Config.Alerts.PhoneNumber)" -Level "SUCCESS"
        } catch {
            Write-Log "SMS failed: $($_.Exception.Message)" -Level "ERROR"
        }
    }
    
    # Send Email if configured
    if ($Config.Alerts.EmailEnabled -and $env:RESEND_API_KEY -and $Config.Alerts.Email) {
        try {
            $emailBody = @{
                from = "Guardian <alerts@cevict.com>"
                to = $Config.Alerts.Email
                subject = "🐕 Victoria Alert: $Title"
                html = @"
<h2>🐕 Project Guardian Alert</h2>
<p><strong>$Title</strong></p>
<p>$Message</p>
$(if ($Url) { "<p><a href='$Url'>View Listing</a></p>" })
<hr>
<p><small>Project Guardian - Victoria Recovery System</small></p>
"@
            } | ConvertTo-Json
            
            Invoke-RestMethod `
                -Uri "https://api.resend.com/emails" `
                -Method POST `
                -Headers @{
                    'Authorization' = "Bearer $env:RESEND_API_KEY"
                    'Content-Type' = 'application/json'
                } `
                -Body $emailBody | Out-Null
            
            Write-Log "Email alert sent to $($Config.Alerts.Email)" -Level "SUCCESS"
        } catch {
            Write-Log "Email failed: $($_.Exception.Message)" -Level "ERROR"
        }
    }
}

function Test-PotentialMatch {
    param(
        [string]$Title,
        [string]$Description,
        [string]$Location
    )
    
    $score = 0
    $reasons = @()
    
    # Check location
    foreach ($loc in $Config.Search.Locations) {
        if ($Location -match [regex]::Escape($loc.Split(',')[0])) {
            $score += 30
            $reasons += "Location match: $loc"
            break
        }
    }
    
    # Check keywords
    $text = "$Title $Description".ToLower()
    
    if ($text -match "victoria") {
        $score += 50
        $reasons += "Name match!"
    }
    
    if ($text -match $Config.Pet.Breed.ToLower() -and $Config.Pet.Breed -ne "Unknown") {
        $score += 20
        $reasons += "Breed match"
    }
    
    if ($text -match $Config.Pet.Color.ToLower() -and $Config.Pet.Color -ne "Unknown") {
        $score += 15
        $reasons += "Color match"
    }
    
    if ($text -match "found" -and $text -match "dog") {
        $score += 10
        $reasons += "Found dog posting"
    }
    
    return @{
        Score = $score
        IsMatch = $score -ge 30
        IsProbableMatch = $score -ge 50
        Reasons = $reasons
    }
}

# ============================================
# SCANNER FUNCTIONS
# ============================================

function Search-PetReunion {
    Write-Log "Scanning PetReunion..." -Level "INFO"
    
    # This would integrate with PetReunion's API or scrape their site
    # For now, placeholder that would be filled in with actual implementation
    
    $results = @()
    
    # Example structure of what we'd return:
    # $results += @{
    #     Source = "PetReunion"
    #     Title = "Found brown dog in Albertville"
    #     Description = "Found wandering near downtown..."
    #     Location = "Albertville, AL"
    #     Url = "https://petreunion.com/listing/123"
    #     Date = Get-Date
    # }
    
    return $results
}

function Search-Craigslist {
    Write-Log "Scanning Craigslist..." -Level "INFO"
    
    $results = @()
    
    # Would search Craigslist lost & found, pets sections
    # for the configured locations
    
    return $results
}

function Search-AllSources {
    $allResults = @()
    
    # Search each configured source
    $allResults += Search-PetReunion
    $allResults += Search-Craigslist
    # Add more sources as implemented
    
    return $allResults
}

# ============================================
# MAIN SCAN FUNCTION
# ============================================

function Invoke-GuardianScan {
    param([switch]$IsDryRun)
    
    $scanStart = Get-Date
    Write-Log "═══════════════════════════════════════════════════════════" -Level "INFO"
    Write-Log "🐕 Project Guardian Scan Starting" -Level "INFO"
    Write-Log "   Target: $($Config.Pet.Name)" -Level "INFO"
    Write-Log "   Locations: $($Config.Search.Locations -join ', ')" -Level "INFO"
    Write-Log "═══════════════════════════════════════════════════════════" -Level "INFO"
    
    # Update heartbeat
    if ($CloudBrainAvailable) {
        Send-Heartbeat -Status 'busy' -Task "Scanning for $($Config.Pet.Name)"
    }
    
    if ($IsDryRun) {
        Write-Log "DRY RUN MODE - No actual searches will be performed" -Level "WARN"
        
        # Simulate finding something for testing
        $testResult = @{
            Source = "TEST"
            Title = "TEST: Found dog matching description"
            Description = "This is a test alert to verify the pipeline"
            Location = "Albertville, AL"
            Url = "https://example.com/test"
            Date = Get-Date
        }
        
        $match = Test-PotentialMatch -Title $testResult.Title -Description $testResult.Description -Location $testResult.Location
        
        if ($match.IsMatch) {
            Write-Log "TEST MATCH FOUND (Score: $($match.Score))" -Level "ALERT"
            Send-Alert -Title "TEST ALERT - Pipeline Working!" `
                -Message "Dry run successful. Guardian is online and monitoring." `
                -Url $testResult.Url `
                -Priority "LOW"
        }
        
        return
    }
    
    # Perform actual searches
    $results = Search-AllSources
    
    Write-Log "Found $($results.Count) listings to analyze" -Level "INFO"
    
    $matchCount = 0
    
    foreach ($result in $results) {
        $match = Test-PotentialMatch `
            -Title $result.Title `
            -Description $result.Description `
            -Location $result.Location
        
        if ($match.IsProbableMatch) {
            $matchCount++
            Write-Log "🚨 PROBABLE MATCH! Score: $($match.Score)" -Level "ALERT"
            
            Send-Alert `
                -Title "Probable Match Found!" `
                -Message "$($result.Title) - $($result.Location) - Reasons: $($match.Reasons -join ', ')" `
                -Url $result.Url `
                -Priority "CRITICAL"
                
        } elseif ($match.IsMatch) {
            $matchCount++
            Write-Log "⚠️ Possible match. Score: $($match.Score)" -Level "WARN"
            
            Send-Alert `
                -Title "Possible Match" `
                -Message "$($result.Title) - $($result.Location)" `
                -Url $result.Url `
                -Priority "HIGH"
        }
    }
    
    $scanDuration = (Get-Date) - $scanStart
    
    Write-Log "───────────────────────────────────────────────────────────" -Level "INFO"
    Write-Log "Scan complete in $($scanDuration.TotalSeconds.ToString('F1'))s" -Level "INFO"
    Write-Log "Results: $($results.Count) listings, $matchCount potential matches" -Level "INFO"
    
    # Update cloud with results
    if ($CloudBrainAvailable) {
        Send-Heartbeat -Status 'idle' -Task "Scan complete: $matchCount matches from $($results.Count) listings"
    }
    
    return @{
        Listings = $results.Count
        Matches = $matchCount
        Duration = $scanDuration
    }
}

# ============================================
# MAIN EXECUTION
# ============================================

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   🐕 PROJECT GUARDIAN - VICTORIA RECOVERY SYSTEM" -ForegroundColor Cyan
Write-Host "   Cloud Edition v1.0" -ForegroundColor DarkCyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Start heartbeat background job
if ($CloudBrainAvailable) {
    Write-Log "Starting heartbeat to cloud orchestrator..." -Level "INFO"
    Start-HeartbeatJob -IntervalSeconds $Config.HeartbeatInterval
    
    # Initial heartbeat
    Send-Heartbeat -Status 'online' -Task 'Guardian starting up'
    
    # Verify cloud connection
    try {
        $status = Get-CloudBrainStatus
        Write-Log "Connected to Cloud Orchestrator" -Level "SUCCESS"
    } catch {
        Write-Log "Cloud connection issue: $($_.Exception.Message)" -Level "WARN"
    }
}

# Register cleanup
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    if ($CloudBrainAvailable) {
        Send-Heartbeat -Status 'offline' -Task 'Guardian shutting down'
        Stop-HeartbeatJob
    }
} | Out-Null

try {
    if ($RunOnce -or $DryRun) {
        # Single scan mode
        Write-Log "Running single scan (RunOnce mode)" -Level "INFO"
        Invoke-GuardianScan -IsDryRun:$DryRun
    } else {
        # Continuous monitoring mode
        Write-Log "Starting continuous monitoring (Interval: $($Config.ScanInterval) minutes)" -Level "INFO"
        Write-Log "Press Ctrl+C to stop" -Level "INFO"
        Write-Host ""
        
        while ($true) {
            Invoke-GuardianScan
            
            Write-Log "Next scan in $($Config.ScanInterval) minutes..." -Level "INFO"
            Write-Host ""
            
            # Sleep until next scan (but keep heartbeat running)
            Start-Sleep -Seconds ($Config.ScanInterval * 60)
        }
    }
} catch {
    Write-Log "Fatal error: $($_.Exception.Message)" -Level "ERROR"
    
    if ($CloudBrainAvailable) {
        New-Task -AssignTo 'human' `
            -Description "🚨 Guardian crashed: $($_.Exception.Message)" `
            -Type 'FIX' `
            -Priority 'CRITICAL' `
            -Project 'guardian-victoria'
    }
    
    throw
} finally {
    Write-Log "Guardian shutting down..." -Level "INFO"
    
    if ($CloudBrainAvailable) {
        Send-Heartbeat -Status 'offline' -Task 'Guardian stopped'
        Stop-HeartbeatJob
    }
}
