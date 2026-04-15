#!/bin/bash

# Script bash para ejecutar Backend + Frontend simultáneamente
# Uso: ./run-all.sh (desde Git Bash o WSL)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "========================================"
echo "  Estacionamiento SDG+ - Servidor Completo"
echo "========================================"
echo ""

# Trap Ctrl+C para limpiar
cleanup() {
    echo ""
    echo "Deteniendo servidores..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Iniciar Backend
echo "[1] Iniciando Backend (FastAPI en puerto 8000)..."
.venv/Scripts/python run.py &
BACKEND_PID=$!
sleep 3

# Iniciar Frontend
echo "[2] Iniciando Frontend (React dev en puerto 5173)..."
cd frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "========================================"
echo "  ✓ Servidores iniciados:"
echo "  - Backend:  http://localhost:8000"
echo "  - Frontend: http://localhost:5173"
echo "  - App:      http://localhost:5173/react/"
echo "  - Salida:   http://localhost:5173/react/exit"
echo "========================================"
echo ""
echo "Presiona Ctrl+C para detener ambos servidores..."
echo ""

# Esperar a que terminen
wait
