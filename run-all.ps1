# Script PowerShell para ejecutar Backend + Frontend simultáneamente
# Uso: .\run-all.ps1

$ErrorActionPreference = 'Continue'

Write-Host "`n" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Estacionamiento SDG+ - Servidor Completo" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Función para detener los procesos al cerrar
$cleanupJobs = @()

Write-Host "[1] Iniciando Backend (FastAPI en puerto 8000)..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    Set-Location $args[0]
    & .\.venv\Scripts\python run.py
} -ArgumentList $scriptPath
$cleanupJobs += $backendJob
Start-Sleep -Seconds 3

Write-Host "[2] Iniciando Frontend (React dev en puerto 5173)..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $args[0]\frontend
    & npm run dev
} -ArgumentList $scriptPath
$cleanupJobs += $frontendJob

Write-Host "`n" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✓ Servidores iniciados:" -ForegroundColor Green
Write-Host "  - Backend:  http://localhost:8000" -ForegroundColor Green
Write-Host "  - Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "  - App:      http://localhost:5173/react/" -ForegroundColor Green
Write-Host "  - Salida:   http://localhost:5173/react/exit" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Presiona Ctrl+C para detener ambos servidores..." -ForegroundColor Cyan
Write-Host ""

# Esperar a que se presione Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 1
        # Verificar si los jobs siguen corriendo
        foreach ($job in $cleanupJobs) {
            if ($job.State -eq 'Failed' -or $job.State -eq 'Completed') {
                Write-Host "Uno de los servidores se detuvo inesperadamente" -ForegroundColor Red
                break
            }
        }
    }
}
catch {
    Write-Host "`nDeteniéndo servidores..." -ForegroundColor Yellow
}

# Detener los jobs
foreach ($job in $cleanupJobs) {
    Stop-Job -Job $job -ErrorAction SilentlyContinue
    Remove-Job -Job $job -ErrorAction SilentlyContinue
}

Write-Host "Servidores detenidos." -ForegroundColor Yellow
