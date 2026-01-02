<#
.SYNOPSIS
    Example: Integrating CloudBrain into an existing PowerShell script
    
.DESCRIPTION
    This shows how to modify your existing scripts (scrapers, guardians, etc.)
    to work with the Cloud Orchestrator.
    
.NOTES
    The key changes are:
    1. Import CloudBrain at the top
    2. Start heartbeat job
    3. Check for tasks periodically (or run based on tasks)
    4. Report completion
#>

# ============================================
# 1. IMPORT CLOUDBRAIN
# ============================================

# Get the directory where this script lives
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Import CloudBrain (assumes it's in the same folder or parent)
$cloudBrainPath = Join-Path $scriptDir "CloudBrain.psm1"
if (-not (Test-Path $cloudBrainPath)) {
    $cloudBrainPath = Join-Path (Split-Path $scriptDir -Parent) "CloudBrain.psm1"
}

if (Test-Path $cloudBrainPath) {
    Import-Module $cloudBrainPath -Force
} else {
    Write-Error "CloudBrain.psm1 not found! Place it in: $scriptDir"
    exit 1
}

# ============================================
# 2. CONFIGURATION
# ============================================

# Override bot name for this specific script
$env:BOT_NAME = 'scraper-petreunion'

# ============================================
# 3. START HEARTBEAT
# ============================================

# This runs in the background, sending heartbeat every 60s
Start-HeartbeatJob -IntervalSeconds 60

# Register cleanup to stop heartbeat on exit
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    Stop-HeartbeatJob
}

# ============================================
# 4. MAIN WORK LOOP
# ============================================

Write-Host "🚀 Starting PetReunion Scraper" -ForegroundColor Cyan
Write-Host "   Connected to Cloud Orchestrator"
Write-Host ""

try {
    # Send initial heartbeat manually
    Send-Heartbeat -Status 'online' -Task 'Starting up'
    
    # OPTION A: Task-driven mode (wait for tasks)
    # Uncomment this if the script should only run when there's a task
    <#
    while ($true) {
        $tasks = Get-NextTask -First 1
        
        if ($tasks.Count -gt 0) {
            $task = $tasks[0]
            
            Send-Heartbeat -Status 'busy' -Task $task.description
            
            # Do the work based on task
            Write-Host "Processing: $($task.description)"
            
            # ... your scraping logic here ...
            
            # Mark complete
            Complete-Task -TaskId $task.task_id -Result "Scraped X listings"
        }
        
        Start-Sleep -Seconds 30
    }
    #>
    
    # OPTION B: Scheduled mode (run on a schedule, report status)
    # This is for scripts that run periodically via Task Scheduler
    
    Send-Heartbeat -Status 'busy' -Task 'Scraping PetReunion listings'
    
    # ===== YOUR EXISTING LOGIC HERE =====
    
    # Example: Scrape some data
    $results = @{
        ListingsFound = 0
        NewListings = 0
        Errors = 0
    }
    
    Write-Host "Scraping PetReunion..." -ForegroundColor Yellow
    
    # Simulate scraping work
    for ($i = 1; $i -le 5; $i++) {
        Write-Host "  Page $i..."
        Start-Sleep -Seconds 1
        $results.ListingsFound += 10
        $results.NewListings += 2
        
        # Update heartbeat with progress
        Send-Heartbeat -Status 'busy' -Task "Scraping page $i of 5"
    }
    
    # ===== END YOUR LOGIC =====
    
    # Report results to orchestrator
    $summary = "Scraped $($results.ListingsFound) listings, $($results.NewListings) new"
    
    # Create a completion note
    New-Task -AssignTo 'human' -Description $summary -Type 'INFO' -Priority 'LOW' -Project 'petreunion'
    
    Write-Host ""
    Write-Host "✅ Scraping complete!" -ForegroundColor Green
    Write-Host "   $summary"
    
    # Final heartbeat
    Send-Heartbeat -Status 'idle' -Task 'Completed scraping run'
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    
    # Report error to orchestrator
    New-Task -AssignTo 'human' -Description "Scraper error: $($_.Exception.Message)" -Type 'FIX' -Priority 'HIGH' -Project 'petreunion'
    
    Send-Heartbeat -Status 'online' -Task "Error: $($_.Exception.Message)"
    
} finally {
    # Always clean up
    Stop-HeartbeatJob
}

Write-Host ""
Write-Host "Script finished. Heartbeat stopped." -ForegroundColor DarkGray
