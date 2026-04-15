# CLAUDE.md — Sistema de Estacionamiento SDG+

## Cómo correr

### Opción 1: Todo junto en una terminal (RECOMENDADO)

```bash
cd "D:/Proyectos PTF/Estacionamiento - SDG +"

# Bash (Git Bash / WSL)
./run-all.sh

# Batch (Command Prompt)
run-all.bat

# O PowerShell
.\run-all.ps1
```
Inicia Backend + Frontend simultáneamente.
- App: http://localhost:5173/react/
- Salida: http://localhost:5173/react/exit
- API: http://localhost:8000/

### Opción 2: Terminales separadas

```bash
# Terminal 1: Backend (FastAPI)
cd "D:/Proyectos PTF/Estacionamiento - SDG +"
.venv/Scripts/python run.py
# → http://localhost:8000/

# Terminal 2: Frontend React (dev)
cd frontend && npm run dev
# → http://localhost:5173/react/

# Frontend React (build para producción)
cd frontend && npm run build
# FastAPI sirve el build desde /react/*
```

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | FastAPI + Uvicorn (port 8000) |
| Base de datos | SQLAlchemy 2.0 + SQLite (`parking.db`) |
| Auth | python-jose JWT + passlib[bcrypt] (**bcrypt==4.0.1**, NO usar 5.x**) |
| Visión | OpenCV + scikit-learn SVC (`model.p`) |
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS |
| Templates legacy | Jinja2 + Tailwind CDN + Plotly.js |

## Usuarios por defecto

| Rol | Usuario | Contraseña | URL |
|-----|---------|-----------|-----|
| Admin | `admin` | `admin123` | `/admin/login` o `/react/` |
| Empleado | `empleado` | `emp123` | `/employee/login` o `/react/` |
| Público | — | — | `/` |

## Estructura de archivos clave

```
app/
  main.py            — FastAPI app + lifespan (inicia detector, seedea DB)
  config.py          — pydantic-settings (protected_namespaces=() para model_path)
  database.py        — engine SQLite, get_db, init_db, seed_db
  models.py          — ORM models (User, Stay, ParkingSlot, Tariff, ...)
  schemas.py         — Pydantic v2 schemas
  security.py        — JWT, bcrypt, require_employee / require_admin
  api/
    auth.py          — POST /auth/token
    public.py        — GET / (mapa), /state, /stream (SSE 1s)
    employee.py      — panel HTML + stays CRUD
    admin.py         — dashboard HTML + KPIs
    payments.py      — simulate_payment, MP webhook stub
    camera.py        — GET /api/camera/feed?token=xxx (MJPEG)
  services/
    vision_adapter.py  — singleton thread-safe
    tariff.py          — gracia 15min, $1200 ARS/hr, mín $300
    ticketing.py       — EST-YYYYMMDD-NNNN + barcode SVG
    stay_manager.py    — create, lookup, close_cash, active stays
    payment_service.py — simulate_payment, mp webhook stub
vision/
  utils.py           — get_parking_spots_bboxes, empty_or_not (SVC, 15x15, /255)
  detector.py        — hilo daemon, 25ms/frame, step=30, video loop
frontend/            — React app (Vite)
  src/
    pages/           — AdminDashboard, EmployeePanel, Login, PublicMap
    components/      — tabs, cards, etc.
  dist/              — build output (servido por FastAPI en /react/*)
templates/           — Jinja2 (legacy, aún en uso en algunas rutas)
static/              — assets estáticos
run.py               — entry point (WindowsSelectorEventLoopPolicy para Windows)
```

## Reglas importantes del dominio

- **Pago**: SOLO manual (escaneo de ticket o cobro en efectivo desde el panel). No hay cobro automático.
- **Tarifa**: 15 min de gracia → $1200 ARS/hr (redondeo al cuarto de hora por exceso) → mínimo $300 ARS post-gracia. Valor almacenado en DB.
- **Visión**: El modelo SVC clasifica clase 0 = vacío, clase 1 = ocupado. Las features deben normalizarse `/255.0`. 14 spots totales.
- **Camera auth**: El endpoint `/api/camera/feed` acepta JWT como query param `?token=xxx` (los `<img>` tags no pueden enviar Bearer headers).
- **slot_vision_id**: Existe en el modelo `Stay` pero NO se muestra en la UI.

## Tabs de cada panel (React)

| Panel | Tabs |
|-------|------|
| Admin | `operations \| finance \| stays \| dashboards \| camera \| live` |
| Empleado | `map \| camera \| stays \| new` |

`stays` del admin usa los mismos endpoints de empleado (`require_employee` acepta ADMIN).

## KPIs Admin — períodos

- Autos hoy / duración promedio / hora pico / gráfico por hora → **día actual (UTC)**
- Gráfico autos/día → **últimos 7 días**
- Tasa de ocupación → **tiempo real (visión)**
- `GET /api/admin/kpis/rollup?granularity=daily|monthly|yearly`

## Gotchas / bugs resueltos (no reintroducir)

1. **SVC normalización**: `flat = resized.flatten().astype(np.float32) / 255.0` en `vision/utils.py`
2. **SVC inversión de clases**: `return int(prediction[0]) == 0` (0 = vacío = True)
3. **bcrypt**: pinear `bcrypt==4.0.1` en requirements.txt
4. **Windows asyncio**: `asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())` en `run.py`
5. **SQLite threads**: `connect_args={"check_same_thread": False}`
6. **pydantic-settings**: `protected_namespaces=()` en `app/config.py`
7. **stay.status tipo**: `stay.status` es `str` (no enum) desde DB → usar `stay.status` NO `stay.status.value` en respuestas JSON

## Archivos legacy (NO modificar)

- `app.py` — Flask API original (puerto 5000)
- `main.py` — detector CV headful original (cv2.imshow)
- `template.html` — mapa HTML original (polling Flask)
