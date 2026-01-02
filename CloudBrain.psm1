#Requires -Version 5.1
<#
.SYNOPSIS
    CloudBrain.psm1 - Universal Adapter for AI Empire Cloud Orchestrator
    PowerShell 5.1 Compatible Version
#>

# ============================================
# CONFIGURATION
# ============================================

function Get-ConfigValue {
    param([string]$EnvVar1, [string]$EnvVar2, [string]$Default)
    $val = [Environment]::GetEnvironmentVariable($EnvVar1)
    if (-not $val -and $EnvVar2) { $val = [Environment]::GetEnvironmentVariable($EnvVar2) }
    if (-not $val) { $val = $Default }
    return $val
}

$script:CloudBrainConfig = @{
    BaseUrl = Get-ConfigValue 'RAILWAY_URL' 'ORCHESTRATOR_URL' 'http://localhost:3333'
    AdminKey = Get-ConfigValue 'ADMIN_KEY' 'MASTER_KEY' ''
    BotName = Get-ConfigValue 'BOT_NAME' '' 'powershell'
    Version = '1.0.0'
    Timeout = 30
}

# ============================================
# INTERNAL HELPERS
# ============================================

function Test-CloudBrainConfig {
    if (-not $script:CloudBrainConfig.AdminKey) {
        throw @"
CloudBrain Error: ADMIN_KEY not set!

Please set the environment variable:
  `$env:ADMIN_KEY = 'your-64-character-key'
  `$env:RAILWAY_URL = 'https://your-app.up.railway.app'

Or run: Set-CloudBrainConfig -AdminKey 'xxx' -BaseUrl 'https://...'
"@
    }
    
    if ($script:CloudBrainConfig.BaseUrl -eq 'http://localhost:3333') {
        Write-Warning "CloudBrain: Using localhost. Set RAILWAY_URL for cloud."
    }
    
    return $true
}

function Invoke-CloudBrainApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Endpoint,
        
        [ValidateSet('GET', 'POST', 'PUT', 'DELETE')]
        [string]$Method = 'GET',
        
        [hashtable]$Body = @{}
    )
    
    Test-CloudBrainConfig | Out-Null
    
    $url = "$($script:CloudBrainConfig.BaseUrl)$Endpoint"
    
    $headers = @{
        'x-admin-key' = $script:CloudBrainConfig.AdminKey
        'Content-Type' = 'application/json'
        'User-Agent' = "CloudBrain-PowerShell/$($script:CloudBrainConfig.Version)"
    }
    
    $params = @{
        Uri = $url
        Method = $Method
        Headers = $headers
        TimeoutSec = $script:CloudBrainConfig.Timeout
        ErrorAction = 'Stop'
    }
    
    if ($Method -in @('POST', 'PUT') -and $Body.Count -gt 0) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
    }
    
    try {
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        $errorMessage = $_.ErrorDetails.Message
        
        switch ($statusCode) {
            401 { throw "CloudBrain Auth Failed: Invalid or missing ADMIN_KEY" }
            403 { throw "CloudBrain Forbidden: Key doesn't have permission" }
            429 { throw "CloudBrain Rate Limited: Too many requests. Wait and retry." }
            503 { throw "CloudBrain Service Disabled: Kill switch may be active" }
            default { throw "CloudBrain Error ($statusCode): $errorMessage - $($_.Exception.Message)" }
        }
    }
}

# ============================================
# PUBLIC FUNCTIONS
# ============================================

function Set-CloudBrainConfig {
    [CmdletBinding()]
    param(
        [string]$BaseUrl,
        [string]$AdminKey,
        [string]$BotName
    )
    
    if ($BaseUrl) { $script:CloudBrainConfig.BaseUrl = $BaseUrl.TrimEnd('/') }
    if ($AdminKey) { $script:CloudBrainConfig.AdminKey = $AdminKey }
    if ($BotName) { $script:CloudBrainConfig.BotName = $BotName }
    
    Write-Host "CloudBrain configured:" -ForegroundColor Green
    Write-Host "   URL: $($script:CloudBrainConfig.BaseUrl)"
    Write-Host "   Bot: $($script:CloudBrainConfig.BotName)"
    if ($script:CloudBrainConfig.AdminKey) {
        Write-Host "   Key: $($script:CloudBrainConfig.AdminKey.Substring(0,8))..."
    }
}

function Get-CloudBrainStatus {
    [CmdletBinding()]
    param()
    
    $status = Invoke-CloudBrainApi -Endpoint '/api/status' -Method 'GET'
    
    Write-Host ""
    Write-Host "AI Empire Cloud Status" -ForegroundColor Cyan
    Write-Host "=======================================" -ForegroundColor DarkGray
    
    $statusColor = 'Green'
    if ($status.status -ne 'operational') { $statusColor = 'Red' }
    Write-Host "Status: $($status.status)" -ForegroundColor $statusColor
    Write-Host "Uptime: $([math]::Round($status.uptime / 60, 1)) minutes"
    Write-Host ""
    
    foreach ($agent in $status.agents) {
        $color = 'Yellow'
        if ($agent.status -eq 'online') { $color = 'Green' }
        if ($agent.status -eq 'offline') { $color = 'Red' }
        
        Write-Host "  $($agent.name.ToUpper()): " -NoNewline
        Write-Host "$($agent.status)" -ForegroundColor $color -NoNewline
        Write-Host " ($($agent.pendingTasks) pending)"
    }
    
    return $status
}

function Send-Heartbeat {
    [CmdletBinding()]
    param(
        [ValidateSet('online', 'busy', 'idle', 'offline')]
        [string]$Status = 'online',
        
        [string]$Task = $null,
        
        [string]$AiName
    )
    
    if (-not $AiName) { $AiName = $script:CloudBrainConfig.BotName }
    
    $body = @{
        ai = $AiName.ToLower()
        status = $Status
        version = $script:CloudBrainConfig.Version
    }
    
    if ($Task) {
        $body.currentTask = $Task
    }
    
    $response = Invoke-CloudBrainApi -Endpoint '/api/heartbeat' -Method 'POST' -Body $body
    
    Write-Host "Heartbeat sent: " -NoNewline -ForegroundColor Green
    Write-Host "$AiName = $Status" -NoNewline
    if ($response.pendingTasks -gt 0) {
        Write-Host " ($($response.pendingTasks) tasks waiting)" -ForegroundColor Yellow
    } else {
        Write-Host ""
    }
    
    return $response
}

function Get-NextTask {
    [CmdletBinding()]
    param(
        [string]$AiName,
        [int]$First = 0
    )
    
    if (-not $AiName) { $AiName = $script:CloudBrainConfig.BotName }
    
    $response = Invoke-CloudBrainApi -Endpoint "/api/inbox/$($AiName.ToLower())" -Method 'GET'
    
    $tasks = $response.tasks
    
    if ($First -gt 0 -and $tasks.Count -gt $First) {
        $tasks = $tasks | Select-Object -First $First
    }
    
    if ($tasks.Count -eq 0) {
        Write-Host "No pending tasks for $AiName" -ForegroundColor DarkGray
    } else {
        Write-Host "Found $($tasks.Count) task(s) for $AiName" -ForegroundColor Cyan
        foreach ($task in $tasks) {
            $priorityColor = 'Gray'
            if ($task.priority -eq 'CRITICAL') { $priorityColor = 'Red' }
            if ($task.priority -eq 'HIGH') { $priorityColor = 'Yellow' }
            if ($task.priority -eq 'MEDIUM') { $priorityColor = 'White' }
            
            $desc = $task.description
            if ($desc.Length -gt 50) { $desc = $desc.Substring(0, 50) }
            Write-Host "   [$($task.priority)] " -NoNewline -ForegroundColor $priorityColor
            Write-Host "$($task.task_id): $desc..."
        }
    }
    
    return $tasks
}

function Complete-Task {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TaskId,
        
        [Parameter(Mandatory)]
        [string]$Result,
        
        [string[]]$FilesChanged = @(),
        
        [ValidateSet('test', 'production', '')]
        [string]$DeployedTo = '',
        
        [switch]$ProductionVerified
    )
    
    $body = @{
        completedBy = $script:CloudBrainConfig.BotName
        notes = $Result
        version = $script:CloudBrainConfig.Version
    }
    
    if ($FilesChanged.Count -gt 0) {
        $body.filesChanged = $FilesChanged
    }
    
    if ($DeployedTo) {
        $body.deployedTo = $DeployedTo
        $body.productionVerified = $ProductionVerified.IsPresent
    }
    
    $response = Invoke-CloudBrainApi -Endpoint "/api/task/$TaskId/complete" -Method 'POST' -Body $body
    
    if ($response.success) {
        Write-Host "Task completed: $TaskId" -ForegroundColor Green
    } else {
        Write-Host "Failed to complete task: $TaskId" -ForegroundColor Red
    }
    
    return $response
}

function New-Task {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('claude', 'gemini', 'cursor', 'human')]
        [string]$AssignTo,
        
        [Parameter(Mandatory)]
        [string]$Description,
        
        [ValidateSet('COMMAND', 'FIX', 'CREATE', 'DEPLOY', 'TEST', 'REVIEW', 'INFO')]
        [string]$Type = 'COMMAND',
        
        [ValidateSet('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')]
        [string]$Priority = 'HIGH',
        
        [string]$Project = ''
    )
    
    $body = @{
        from = $script:CloudBrainConfig.BotName
        type = $Type
        priority = $Priority
        description = $Description
    }
    
    if ($Project) {
        $body.project = $Project
    }
    
    $response = Invoke-CloudBrainApi -Endpoint "/api/inbox/$($AssignTo.ToLower())/task" -Method 'POST' -Body $body
    
    if ($response.success) {
        Write-Host "Task created: $($response.taskId)" -ForegroundColor Green
        Write-Host "   Assigned to: $AssignTo"
        Write-Host "   Priority: $Priority"
    }
    
    return $response
}

function Send-Command {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Command,
        
        [ValidateSet('claude', 'gemini', 'cursor', '')]
        [string]$To = '',
        
        [ValidateSet('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')]
        [string]$Priority = 'HIGH'
    )
    
    $body = @{
        command = $Command
        priority = $Priority
        source = 'powershell'
    }
    
    if ($To) {
        $body.to = $To.ToLower()
    }
    
    $response = Invoke-CloudBrainApi -Endpoint '/api/command' -Method 'POST' -Body $body
    
    if ($response.success) {
        Write-Host "Command sent: " -NoNewline -ForegroundColor Green
        Write-Host $Command
        Write-Host "   Routed to: $($response.routedTo)" -ForegroundColor Cyan
        Write-Host "   Task ID: $($response.taskId)"
    }
    
    return $response
}

function Get-KillSwitchStatus {
    [CmdletBinding()]
    param()
    
    $response = Invoke-CloudBrainApi -Endpoint '/api/kill-switch/status' -Method 'GET'
    
    Write-Host ""
    Write-Host "Cost Control Status" -ForegroundColor Cyan
    Write-Host "=======================================" -ForegroundColor DarkGray
    
    if ($response.killSwitch) {
        Write-Host "Kill Switch: " -NoNewline
        Write-Host "ACTIVE" -ForegroundColor Red
    } else {
        Write-Host "Kill Switch: " -NoNewline
        Write-Host "Ready" -ForegroundColor Green
    }
    
    Write-Host "Requests Today: $($response.counters.today) / $($response.limits.dailyLimit)"
    Write-Host "Usage: $($response.limits.dailyUsagePercent)"
    
    return $response
}

# ============================================
# BACKGROUND HEARTBEAT JOB
# ============================================

$script:HeartbeatJob = $null

function Start-HeartbeatJob {
    [CmdletBinding()]
    param(
        [int]$IntervalSeconds = 60
    )
    
    $script:HeartbeatJob = Start-Job -Name 'CloudBrainHeartbeat' -ScriptBlock {
        param($BaseUrl, $AdminKey, $BotName, $Interval)
        
        while ($true) {
            try {
                $body = @{
                    ai = $BotName
                    status = 'online'
                } | ConvertTo-Json
                
                Invoke-RestMethod -Uri "$BaseUrl/api/heartbeat" -Method POST `
                    -Headers @{ 'x-admin-key' = $AdminKey; 'Content-Type' = 'application/json' } `
                    -Body $body -ErrorAction SilentlyContinue | Out-Null
            } catch { }
            
            Start-Sleep -Seconds $Interval
        }
    } -ArgumentList $script:CloudBrainConfig.BaseUrl, $script:CloudBrainConfig.AdminKey, $script:CloudBrainConfig.BotName, $IntervalSeconds
    
    Write-Host "Heartbeat job started (every ${IntervalSeconds}s)" -ForegroundColor Green
}

function Stop-HeartbeatJob {
    if ($script:HeartbeatJob) {
        Stop-Job -Job $script:HeartbeatJob -ErrorAction SilentlyContinue
        Remove-Job -Job $script:HeartbeatJob -ErrorAction SilentlyContinue
        $script:HeartbeatJob = $null
        Write-Host "Heartbeat job stopped" -ForegroundColor Yellow
    }
}

# ============================================
# MODULE INITIALIZATION
# ============================================

Export-ModuleMember -Function @(
    'Set-CloudBrainConfig',
    'Get-CloudBrainStatus',
    'Send-Heartbeat',
    'Get-NextTask',
    'Complete-Task',
    'New-Task',
    'Send-Command',
    'Get-KillSwitchStatus',
    'Start-HeartbeatJob',
    'Stop-HeartbeatJob'
)

Write-Host ""
Write-Host "CloudBrain Module Loaded" -ForegroundColor Cyan
Write-Host "   Version: $($script:CloudBrainConfig.Version)"
Write-Host "   URL: $($script:CloudBrainConfig.BaseUrl)"
if ($script:CloudBrainConfig.AdminKey) {
    Write-Host "   Auth: Configured" -ForegroundColor Green
} else {
    Write-Host "   Auth: Set ADMIN_KEY env var!" -ForegroundColor Red
}
Write-Host ""
