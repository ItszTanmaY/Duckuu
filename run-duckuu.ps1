# Duckuu Desktop Companion & OS Agent PowerShell Launcher
[CmdletBinding()]
param()

$Host.UI.RawUI.WindowTitle = "Duckuu Desktop Companion & OS Agent"
Set-Location -Path $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "       Duckuu Desktop Companion & OS Agent" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan

$env:PYTHONPATH = $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"

# Check if port 8000 is already active
$portActive = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue

if ($portActive) {
    Write-Host "[*] Duckuu Backend is already running on http://127.0.0.1:8000" -ForegroundColor Green
} else {
    Write-Host "[*] Starting Duckuu FastAPI & WebSocket backend on 127.0.0.1:8000..." -ForegroundColor Cyan
    $backendProc = Start-Process -FilePath "python" -ArgumentList "-m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000" -WindowStyle Minimized -PassThru
    Write-Host "[*] Waiting for backend to initialize..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}

# Ensure desktop shell is compiled
if (-not (Test-Path "dist-electron\main.js")) {
    Write-Host "[*] Compiling desktop shell (first-time build)..." -ForegroundColor Yellow
    npm run build
}

Write-Host "[*] Launching Duckuu Desktop Pet (Pet Window + Frosted Chat Popup)..." -ForegroundColor Green
Write-Host "[*] Close the Duckuu window or press Ctrl+C to exit." -ForegroundColor DarkGray

try {
    npx electron .
} finally {
    Write-Host "`n[*] Stopping local backend server..." -ForegroundColor DarkGray
    $connections = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        } catch {}
    }
    Write-Host "[*] All Duckuu processes stopped cleanly." -ForegroundColor Green
}
