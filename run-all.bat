@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================
echo  Estacionamiento SDG+ - Servidor Completo
echo ========================================
echo.

REM Get the directory where this script is located
cd /d "%~dp0"

REM Start Backend (FastAPI)
echo [1] Iniciando backend (FastAPI en puerto 8000)...
start "Backend - FastAPI" cmd /k ".venv\Scripts\python run.py"
timeout /t 3 /nobreak

REM Start Frontend (React dev server)
echo [2] Iniciando frontend (React dev en puerto 5173)...
start "Frontend - React" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================
echo  Servidores iniciados:
echo  - Backend:  http://localhost:8000
echo  - Frontend: http://localhost:5173
echo  - App:      http://localhost:5173/react/
echo  - Salida:   http://localhost:5173/react/exit
echo ========================================
echo.
echo Presiona Enter para salir...
pause

REM Kill the background windows when main script ends
taskkill /FI "WINDOWTITLE eq Backend - FastAPI" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend - React" /T /F >nul 2>&1
