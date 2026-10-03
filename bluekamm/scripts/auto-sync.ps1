# BluKaam Connection - Real-time Git Auto-Sync
# This script monitors your project folder and automatically pushes changes to GitHub, Render & GitHub Pages.

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   BluKaam Connection - Auto-Sync Started                  " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Watching: $projectDir" -ForegroundColor White
Write-Host " Target:   GitHub (main) -> Render & GitHub Pages" -ForegroundColor White
Write-Host " Mode:     Auto-commit & push on every code change" -ForegroundColor White
Write-Host " Status:   ACTIVE (Keep this window open while working)" -ForegroundColor Yellow
Write-Host "============================================================`n" -ForegroundColor Cyan

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $projectDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::CreationTime

while ($true) {
    # Wait up to 3 seconds for a file change event
    $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 3000)

    # Check if git status has any changes
    try {
        $status = (git status --porcelain 2>$null)
        if ($status) {
            # Debounce: wait 5 seconds for user to finish saving/editing multiple files
            Start-Sleep -Seconds 5

            $status = (git status --porcelain 2>$null)
            if ($status) {
                $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                Write-Host "[$timestamp] Detected changes! Syncing to GitHub..." -ForegroundColor Cyan

                git add .
                git commit -m "Auto update: $timestamp"
                $pushResult = git push origin main 2>&1

                if ($LASTEXITCODE -eq 0) {
                    Write-Host "[$timestamp] [SUCCESS] Pushed to GitHub!" -ForegroundColor Green
                    Write-Host "             Render & GitHub Pages are automatically updating now.`n" -ForegroundColor Green
                } else {
                    Write-Host "[$timestamp] [WARNING] Push failed (check internet connection): $pushResult`n" -ForegroundColor Red
                }
            }
        }
    } catch {
        # Continue loop on transient errors
        Start-Sleep -Seconds 2
    }
}
