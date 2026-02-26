# Arquitectura del Sistema de Estacionamiento Inteligente

---

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Diagrama de arquitectura general](#3-diagrama-de-arquitectura-general)
4. [Estructura de capas](#4-estructura-de-capas)
5. [Módulo de visión artificial](#5-módulo-de-visión-artificial)
6. [Modelo de datos](#6-modelo-de-datos)
7. [API REST — mapa de endpoints](#7-api-rest--mapa-de-endpoints)
8. [Sistema de autenticación y roles](#8-sistema-de-autenticación-y-roles)
9. [Flujos de negocio](#9-flujos-de-negocio)
10. [Sistema de tarifas](#10-sistema-de-tarifas)
11. [Comunicación en tiempo real](#11-comunicación-en-tiempo-real)
12. [Interfaces de usuario](#12-interfaces-de-usuario)
13. [Concurrencia y threading](#13-concurrencia-y-threading)
14. [Decisiones de diseño y trade-offs](#14-decisiones-de-diseño-y-trade-offs)

---

## 1. Visión general

El sistema es una aplicación web monolítica que integra visión artificial, gestión de estadías y facturación para un estacionamiento de 14 espacios. Opera completamente en local sin dependencias externas obligatorias.

```
┌─────────────────────────────────────────────────────────────┐
│                    SISTEMA DE ESTACIONAMIENTO               │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │  Detector de │   │   FastAPI    │   │   Navegador  │   │
│  │   Video CV   │──▶│   Backend   │──▶│  (Empleado / │   │
│  │ (hilo daemon)│   │  (puerto    │   │   Admin /    │   │
│  └──────────────┘   │   8000)     │   │   Público)   │   │
│                     └──────┬──────┘   └──────────────┘   │
│                            │                               │
│                     ┌──────▼──────┐                        │
│                     │  SQLite DB  │                        │
│                     │ (parking.db)│                        │
│                     └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

**Principios de diseño:**
- Mínima complejidad operacional (SQLite, sin Docker, sin microservicios)
- Separación clara entre la capa de visión y la capa web
- Comunicación en tiempo real sin WebSockets (SSE + MJPEG)
- Control de acceso basado en roles (RBAC) con JWT

---

## 2. Stack tecnológico

| Capa | Tecnología | Versión | Rol |
|------|-----------|---------|-----|
| **Servidor web** | FastAPI + Uvicorn | 0.115.0 / 0.30.6 | Framework ASGI async |
| **ORM** | SQLAlchemy | 2.0.35 | Acceso a base de datos |
| **Base de datos** | SQLite | — | Persistencia local |
| **Validación** | Pydantic v2 | 2.9.2 | Schemas y configuración |
| **Autenticación** | python-jose + passlib | 3.3.0 / 1.7.4 | JWT + bcrypt |
| **Visión artificial** | OpenCV | 4.10.0 | Procesamiento de video |
| **ML** | scikit-learn | 1.5.2 | Clasificador SVC |
| **Templates** | Jinja2 | 3.1.4 | Renderizado HTML |
| **Frontend** | Tailwind CDN + Plotly.js | — | UI + gráficos |
| **Códigos de barras** | python-barcode | 0.15.1 | Tickets Code128 SVG |
| **Imágenes** | Pillow | 10.4.0 | Procesamiento de imágenes |
| **Async I/O** | aiofiles | 24.1.0 | Lectura de archivos async |

---

## 3. Diagrama de arquitectura general

```
                          ┌─────────────────────────────────────────────────┐
                          │               PROCESO PRINCIPAL                  │
                          │                                                  │
  Media/                  │  ┌─────────────────────────────────────────────┐│
  parking_crop_loop.mp4 ──┼─▶│           HILO DAEMON (ParkingDetector)     ││
  mask_crop.png ──────────┼─▶│                                             ││
  model.p ────────────────┼─▶│  cap.read() → crop → SVC.predict()         ││
                          │  │       cada 30 frames (~1 seg)               ││
                          │  └──────────────────┬──────────────────────────┘│
                          │                     │ update_state()             │
                          │                     ▼ update_frame_only()        │
                          │  ┌──────────────────────────────────────────────┐│
                          │  │         VisionAdapter (Singleton)            ││
                          │  │         threading.Lock()                     ││
                          │  │  _spots: list[dict]   _frame: ndarray        ││
                          │  └────────┬─────────────────────┬───────────────┘│
                          │           │ get_state()          │ get_latest_frame()
                          │           ▼                      ▼                │
                          │  ┌─────────────────┐  ┌──────────────────────┐  │
                          │  │  FastAPI Routes  │  │  FastAPI Routes      │  │
                          │  │  (async)         │  │  (async)             │  │
                          │  │                  │  │                      │  │
                          │  │  /api/public/    │  │  /api/camera/feed    │  │
                          │  │  parking/stream  │  │  MJPEG stream        │  │
                          │  │  (SSE 1s)        │  │  (~25 fps)           │  │
                          │  └────────┬─────────┘  └──────────┬───────────┘  │
                          │           │                        │              │
                          └───────────┼────────────────────────┼──────────────┘
                                      │                        │
                             ┌────────▼────────────────────────▼────────┐
                             │              NAVEGADORES                   │
                             │                                           │
                             │  Público: EventSource SSE → renderState() │
                             │  Empleado: <img src="...feed?token=...">  │
                             │  Admin: Plotly.js + fetch KPIs            │
                             └───────────────────────────────────────────┘
```

---

## 4. Estructura de capas

```
app/
├── api/              ← CAPA DE PRESENTACIÓN
│   ├── auth.py       │  Routers FastAPI, validación HTTP,
│   ├── public.py     │  renderizado de templates,
│   ├── employee.py   │  respuestas JSON / HTML / SSE
│   ├── admin.py      │
│   ├── payments.py   │
│   └── camera.py     │
│
├── services/         ← CAPA DE NEGOCIO
│   ├── vision_adapter.py  │  Lógica de dominio pura,
│   ├── tariff.py          │  cálculo de precios,
│   ├── ticketing.py       │  gestión de tickets,
│   ├── stay_manager.py    │  ciclo de vida de estadías
│   └── payment_service.py │
│
├── models.py         ← CAPA DE DATOS (ORM)
├── database.py       ← CAPA DE DATOS (engine + sesiones)
├── schemas.py        ← DTOs (Pydantic v2)
├── security.py       ← SEGURIDAD (JWT + RBAC)
└── config.py         ← CONFIGURACIÓN (pydantic-settings)

vision/
├── detector.py       ← HILO DE PROCESAMIENTO (fuera del event loop)
└── utils.py          ← UTILIDADES CV (OpenCV + SVC)
```

**Flujo de una petición HTTP típica:**

```
Navegador
   │  HTTP Request
   ▼
FastAPI Router (api/*.py)
   │  Depende de security.py → verifica JWT → rol
   │  Depende de get_db() → sesión SQLAlchemy
   ▼
Service (services/*.py)
   │  Lógica de negocio
   │  Consultas ORM a models.py
   ▼
SQLite (parking.db)
   │  Resultado
   ▼
Service → Schema (Pydantic) → JSON Response
```

---

## 5. Módulo de visión artificial

### Pipeline de clasificación

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PIPELINE DE VISIÓN                               │
│                                                                     │
│  mask_crop.png                                                      │
│       │                                                             │
│       ▼                                                             │
│  cv2.connectedComponentsWithStats()                                 │
│       │                                                             │
│       ▼                                                             │
│  14 bounding boxes (x, y, w, h) ──────────────┐                   │
│                                                │                   │
│  parking_crop_loop.mp4                         │                   │
│       │                                        │                   │
│       ▼  cada frame (25ms)                     │                   │
│  cap.read() → frame BGR                        │                   │
│       │                                        │                   │
│       │  cada 30 frames (~1s)                  │                   │
│       ▼                                        ▼                   │
│  Para cada spot i:                   frame[y:y+h, x:x+w]          │
│       │                                        │                   │
│       ▼                                        ▼                   │
│  cv2.resize(crop, (15,15))                                         │
│       │                                                             │
│       ▼                                                             │
│  flatten().astype(float32) / 255.0    ← NORMALIZACIÓN CRÍTICA      │
│  → vector de 675 features (15×15×3)                                │
│       │                                                             │
│       ▼                                                             │
│  SVC.predict(features)                                              │
│       │                                                             │
│       ├── clase 0 → empty = True  (LIBRE)                          │
│       └── clase 1 → empty = False (OCUPADO)                        │
│                                                                     │
│  Resultado → VisionAdapter.update_state(spots, frame)              │
└─────────────────────────────────────────────────────────────────────┘
```

### Detalles del modelo SVC

| Parámetro | Valor |
|-----------|-------|
| Tipo | Support Vector Classifier (kernel RBF) |
| Features de entrada | 675 valores float32 (15×15×3 BGR normalizado) |
| Clases | 0 = vacío, 1 = ocupado |
| Archivo | `model.p` (pickle de scikit-learn) |
| Cache | Instancia reutilizada entre frames (dict global) |

### Timing del detector

```
Frame timeline (25ms por frame = ~40fps):

Frame 0   → read() → classify all 14 spots → update_state() + update_frame_only()
Frame 1   → read() → (sin clasificación)   → update_frame_only()
Frame 2   → read() → (sin clasificación)   → update_frame_only()
...
Frame 29  → read() → (sin clasificación)   → update_frame_only()
Frame 30  → read() → classify all 14 spots → update_state() + update_frame_only()
...
```

La clasificación ocurre cada 30 frames (~750ms), pero el frame de cámara se actualiza en cada ciclo.

---

## 6. Modelo de datos

### Diagrama entidad-relación

```
┌──────────────────┐       ┌──────────────────────────┐
│      User        │       │         Stay             │
├──────────────────┤       ├──────────────────────────┤
│ id (PK)          │       │ id (PK, UUID)            │
│ username         │       │ entry_at                 │
│ hashed_password  │   ┌───│ exit_at                  │
│ role (ENUM)      │   │   │ status (ENUM)            │
│  EMPLOYEE        │   │   │  ACTIVE                  │
│  ADMIN           │   │   │  PAYMENT_PENDING         │
│ is_active        │   │   │  PAID                    │
│ created_at       │   │   │  CLOSED                  │
└──────────┬───────┘   │   │  CANCELLED               │
           │           │   │ amount_expected          │
           │ created_by│   │ amount_paid              │
           └───────────┼───│ payment_method (ENUM)    │
                       │   │  CASH                    │
           ┌───────────┤   │  SIMULATED               │
           │ closed_by │   │  MERCADOPAGO             │
           └───────────┘   │ notes                    │
                           │ created_by_id (FK→User)  │
                           │ closed_by_id (FK→User)   │
                           └────────┬─────────────────┘
                                    │ stay_id
                    ┌───────────────┼───────────────────┐
                    ▼               ▼                   │
          ┌─────────────────┐  ┌──────────────────┐    │
          │     Ticket      │  │    Payment       │    │
          ├─────────────────┤  ├──────────────────┤    │
          │ id (PK)         │  │ id (PK)          │    │
          │ stay_id (FK)    │  │ stay_id (FK)     │    │
          │ ticket_code     │  │ method (ENUM)    │    │
          │  EST-YYYYMMDD-  │  │ amount           │    │
          │  NNNN           │  │ status (ENUM)    │    │
          │ barcode_value   │  │  PENDING         │    │
          │  (UUID)         │  │  APPROVED        │    │
          │ created_at      │  │  REJECTED        │    │
          └─────────────────┘  │ external_ref     │    │
                               │ mp_payment_id    │    │
                               │ created_at       │    │
                               │ processed_at     │    │
                               │ raw_data (JSON)  │    │
                               └──────────────────┘    │
                                                        │
┌─────────────────────┐    ┌──────────────────────┐    │
│    ParkingSlot      │    │  OccupancySnapshot   │    │
├─────────────────────┤    ├──────────────────────┤    │
│ id (PK)             │    │ id (PK)              │    │
│ slot_number         │    │ timestamp            │    │
│ vision_id (UNIQUE)  │    │ total                │    │
│  1–14               │    │ occupied             │    │
│ status (ENUM)       │    │ free                 │    │
│  FREE               │    └──────────────────────┘    │
│  OCCUPIED           │                                │
│ demo_override (bool)│    ┌──────────────────────┐    │
└─────────────────────┘    │   SystemSetting      │    │
                           ├──────────────────────┤    │
                           │ id (PK)              │    │
                           │ key (UNIQUE)         │    │
                           │ value                │    │
                           └──────────────────────┘    │
```

### Ciclo de vida de una estadía (Stay)

```
                    ┌─────────────┐
                    │   ACTIVE    │◀── create_stay() / POST /api/public/entry
                    └──────┬──────┘
                           │
              ┌────────────┴───────────────┐
              │                            │
              ▼                            ▼
    ┌──────────────────┐         ┌──────────────────┐
    │ PAYMENT_PENDING  │         │ close_cash()      │
    │ (futuro uso)     │         │ simulate_payment()│
    └────────┬─────────┘         └────────┬──────────┘
             │                            │
             ▼                            ▼
    ┌──────────────────┐         ┌──────────────────┐
    │     CLOSED       │◀────────│     CLOSED       │
    └──────────────────┘         └──────────────────┘

    ┌──────────────────┐
    │   CANCELLED      │◀── Cancelación manual (no implementada en UI)
    └──────────────────┘
```

---

## 7. API REST — mapa de endpoints

### Acceso público (sin autenticación)

```
GET  /                              → Mapa público (HTML)
GET  /kiosk                         → Kiosco de entrada (HTML)
POST /api/public/entry              → Crear estadía + ticket
GET  /api/public/parking/state      → Estado actual (JSON)
GET  /api/public/parking/stream     → Stream SSE (1s updates)
POST /auth/token                    → Login → JWT
GET  /docs                          → Swagger UI
```

### Acceso empleados (rol EMPLOYEE o ADMIN)

```
GET  /api/employee/login            → Página de login (HTML)
GET  /api/employee/panel            → Panel (HTML)
POST /api/employee/stays/create     → Nueva estadía
POST /api/employee/stays/lookup     → Buscar por código
POST /api/employee/stays/{id}/close-cash   → Cobrar en efectivo
GET  /api/employee/stays/active     → Listar estadías activas
GET  /api/employee/demo/slots       → Listar espacios (demo)
POST /api/employee/demo/slot/{id}   → Forzar estado de espacio
POST /api/employee/demo/reset       → Limpiar overrides
GET  /api/camera/feed?token=<JWT>   → Stream MJPEG
POST /api/payments/simulate/{id}    → Pago simulado
```

### Acceso administrador (rol ADMIN)

```
GET  /api/admin/login               → Página de login (HTML)
GET  /api/admin/dashboard           → Dashboard (HTML)
GET  /api/admin/kpis/operations     → KPIs operativos (JSON)
GET  /api/admin/kpis/finance        → KPIs financieros (JSON)
GET  /api/admin/settings/tariff     → Consultar tarifa
PUT  /api/admin/settings/tariff     → Actualizar tarifa
```

### Mapa visual de acceso por rol

```
Endpoint                            PÚBLICO   EMPLOYEE   ADMIN
─────────────────────────────────   ───────   ────────   ─────
GET /                                  ✓         ✓         ✓
GET /kiosk                             ✓         ✓         ✓
POST /api/public/entry                 ✓         ✓         ✓
GET /api/public/parking/state          ✓         ✓         ✓
GET /api/public/parking/stream         ✓         ✓         ✓
POST /auth/token                       ✓         ✓         ✓
GET /api/employee/panel                ✗         ✓         ✓
POST /api/employee/stays/*             ✗         ✓         ✓
GET /api/camera/feed?token=            ✗         ✓         ✓
POST /api/payments/simulate/*          ✗         ✓         ✓
GET /api/admin/dashboard               ✗         ✗         ✓
GET /api/admin/kpis/*                  ✗         ✗         ✓
PUT /api/admin/settings/tariff         ✗         ✗         ✓
```

---

## 8. Sistema de autenticación y roles

### Flujo de autenticación JWT

```
  Cliente                              Servidor
     │                                    │
     │  POST /auth/token                  │
     │  username=X&password=Y             │
     │ ──────────────────────────────────▶│
     │                                    │  authenticate_user()
     │                                    │  bcrypt.verify(plain, hashed)
     │                                    │  create_access_token({sub, role})
     │                                    │  HS256 signed
     │  200 OK                            │
     │  { access_token, role, username }  │
     │ ◀──────────────────────────────────│
     │                                    │
     │  localStorage.setItem(token)       │
     │                                    │
     │  GET /api/employee/panel           │
     │  Authorization: Bearer <token>     │
     │ ──────────────────────────────────▶│
     │                                    │  jwt.decode(token, secret)
     │                                    │  get_current_user() → User
     │                                    │  require_employee() → check role
     │  200 OK (HTML panel)              │
     │ ◀──────────────────────────────────│
```

### Caso especial: autenticación del stream de cámara

Los elementos `<img>` del navegador no pueden enviar headers `Authorization`. Para el feed MJPEG se usa el token como query parameter:

```
GET /api/camera/feed?token=eyJhbGciOiJIUzI1NiJ9...

  Cliente HTML          FastAPI /api/camera/feed
      │                         │
      │  <img src="/api/camera/feed?token=JWT">
      │ ───────────────────────▶│
      │                         │ _validate_token(token)
      │                         │ jwt.decode(token)
      │                         │ verificar role in (EMPLOYEE, ADMIN)
      │  multipart/x-mixed-replace stream
      │ ◀───────────────────────│
```

### Jerarquía de roles

```
          ADMIN
         /     \
        ▼       ▼
   EMPLOYEE   (todos los accesos de EMPLOYEE)
      │         + dashboard, KPIs, configuración
      ▼
  (accesos de EMPLOYEE)
  panel, estadías, cámara,
  pagos, demo
```

Token JWT — payload:
```json
{
  "sub": "admin",
  "role": "ADMIN",
  "exp": 1740000000
}
```

---

## 9. Flujos de negocio

### Flujo de ingreso de vehículo (kiosco)

```
  Kiosco (/kiosk)                 Backend                     DB
      │                              │                          │
      │  Toca "INGRESAR"             │                          │
      │  POST /api/public/entry      │                          │
      │ ────────────────────────────▶│                          │
      │                              │  create_stay()           │
      │                              │ ──────────────────────── │
      │                              │  INSERT Stay (ACTIVE)    │
      │                              │  generate_ticket_code()  │
      │                              │   → EST-20260226-0001    │
      │                              │  generate_barcode_svg()  │
      │                              │   → Code128 SVG          │
      │                              │  INSERT Ticket           │
      │                              │ ──────────────────────── │
      │  { ticket_code,              │                          │
      │    entry_at,                 │                          │
      │    barcode_svg }             │                          │
      │ ◀────────────────────────────│                          │
      │                              │                          │
      │  Muestra ticket 5s → idle    │                          │
```

### Flujo de cobro en efectivo (empleado)

```
  Empleado (panel)             Backend                  DB
      │                            │                     │
      │  Ingresa código de ticket  │                     │
      │  POST /stays/lookup        │                     │
      │  { query: "EST-2026..." }  │                     │
      │ ──────────────────────────▶│                     │
      │                            │  SELECT Ticket      │
      │                            │   JOIN Stay         │
      │                            │  calculate_price()  │
      │  { stay, ticket, amount }  │                     │
      │ ◀──────────────────────────│                     │
      │                            │                     │
      │  Confirma monto            │                     │
      │  POST /stays/{id}/close-cash                     │
      │  { amount_paid: 800 }      │                     │
      │ ──────────────────────────▶│                     │
      │                            │  UPDATE Stay        │
      │                            │   status=CLOSED     │
      │                            │   exit_at=NOW       │
      │                            │   amount_paid=800   │
      │                            │  INSERT Payment     │
      │                            │   method=CASH       │
      │                            │   status=APPROVED   │
      │  { stay (CLOSED) }         │                     │
      │ ◀──────────────────────────│                     │
```

### Flujo de consulta de KPIs (administrador)

```
  Admin (dashboard)             Backend                  DB
      │                            │                     │
      │  GET /api/admin/kpis/operations                  │
      │ ──────────────────────────▶│                     │
      │                            │  SELECT stays       │
      │                            │   WHERE entry_at    │
      │                            │   >= today_start    │
      │                            │  Calcular:          │
      │                            │   autos_hoy         │
      │                            │   duracion_promedio │
      │                            │   hora_pico         │
      │                            │   autos_por_hora[]  │
      │                            │   autos_por_dia[]   │
      │  OperationsKPI (JSON)      │                     │
      │ ◀──────────────────────────│                     │
      │                            │                     │
      │  Plotly.js renderiza       │                     │
      │  gráficos de barras        │                     │
```

---

## 10. Sistema de tarifas

### Lógica de cálculo

```
┌────────────────────────────────────────────────────────┐
│                   calculate_price()                    │
│                                                        │
│  entrada: entry_at, exit_at (o NOW)                   │
│                                                        │
│  duration_minutes = (exit_at - entry_at) / 60         │
│                                                        │
│  ¿duration_minutes ≤ 15 (gracia)?                     │
│       ├── SÍ → return 0.0                             │
│       └── NO ──┐                                      │
│                ▼                                      │
│  billable_minutes = duration_minutes - 15             │
│  billable_hours = billable_minutes / 60               │
│                                                        │
│  billable_hours_rounded = ceil(hours × 4) / 4        │
│  (redondeo al cuarto de hora por exceso)              │
│                                                        │
│  amount = billable_hours_rounded × rate_per_hour      │
│  return max(amount, minimum_charge)                   │
└────────────────────────────────────────────────────────┘
```

### Tabla de ejemplos

```
Duración    Tiempo billable  Redondeo  Cálculo        Total
─────────   ───────────────  ────────  ─────────      ─────
0–15 min    0                —         gracia          $0
20 min      5 min            0.25h     0.25 × $800    $300 (mín)
30 min      15 min           0.25h     0.25 × $800    $300 (mín)
45 min      30 min           0.50h     0.50 × $800    $400
60 min      45 min           0.75h     0.75 × $800    $600
90 min      75 min           1.25h     1.25 × $800    $1.000
120 min     105 min          1.75h     1.75 × $800    $1.400
```

La tarifa por hora es configurable desde la UI de administración y se persiste en `SystemSetting`.

---

## 11. Comunicación en tiempo real

### Server-Sent Events (SSE) — Mapa público

```
  Navegador                        FastAPI /api/public/parking/stream
      │                                     │
      │  GET /api/public/parking/stream     │
      │  Accept: text/event-stream          │
      │ ───────────────────────────────────▶│
      │                                     │  StreamingResponse
      │  ← ── ── ── ── ── ── ── ── ── ── ──│  _sse_generator()
      │                                     │  while not disconnected:
      │  data: {"spots":[...],...}          │    await asyncio.sleep(1)
      │ ◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │    state = adapter.get_state()
      │  (cada 1 segundo)                   │    yield f"data: {json}\n\n"
      │                                     │
      │  Si conexión cae:                   │
      │  EventSource reconecta en 3s        │
```

### MJPEG Stream — Feed de cámara

```
  <img> element                    FastAPI /api/camera/feed
      │                                     │
      │  GET /api/camera/feed?token=JWT     │
      │ ───────────────────────────────────▶│
      │                                     │  StreamingResponse
      │  Content-Type:                      │  media_type: multipart/x-mixed-replace
      │  multipart/x-mixed-replace;         │
      │  boundary=frame                     │  _mjpeg_generator():
      │                                     │    while not disconnected:
      │  --frame\r\n                        │      frame = adapter.get_latest_frame()
      │  Content-Type: image/jpeg\r\n       │      jpg = cv2.imencode('.jpg', frame,
      │  \r\n                               │            quality=80)
      │  <jpeg bytes>                       │      await asyncio.sleep(0.04)  # ~25fps
      │  --frame\r\n                        │      yield boundary + jpg
      │  ...                                │
      │ ◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
```

---

## 12. Interfaces de usuario

### Árbol de navegación

```
http://localhost:8000/
│
├── /                          → Mapa público (SSE, sin auth)
├── /kiosk                     → Kiosco de entrada (sin auth)
│
├── /employee/login            → Login empleado
│   └── /employee/panel        → Panel empleado [EMPLOYEE|ADMIN]
│       ├── Tab: Mapa
│       ├── Tab: Cámara (MJPEG)
│       ├── Tab: Buscar estadía
│       ├── Tab: Estadías activas
│       ├── Tab: Nueva estadía
│       └── Tab: Demo
│
├── /admin/login               → Login administrador
│   └── /admin/dashboard       → Dashboard admin [ADMIN]
│       ├── Tab: Operaciones (KPIs + Plotly)
│       ├── Tab: Finanzas (KPIs + Plotly)
│       ├── Tab: Cámara (MJPEG + stats)
│       └── Tab: En Vivo (iframe del mapa)
│
└── /docs                      → Swagger UI (FastAPI auto-generado)
```

### Layout del mapa público

```
┌─────────────────────────────────────────────────────┐
│          SISTEMA DE ESTACIONAMIENTO INTELIGENTE     │
│              ● EN VIVO                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│    ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │
│    │  🚗  │  │      │  │  🚗  │  │      │         │
│    │  1   │  │  2   │  │  3   │  │  4   │         │
│    └──────┘  └──────┘  └──────┘  └──────┘         │
│    ─────────────────────────────────────           │
│    ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │
│    │      │  │  🚗  │  │      │  │  🚗  │         │
│    │  5   │  │  6   │  │  7   │  │  8   │         │
│    └──────┘  └──────┘  └──────┘  └──────┘         │
│                   ...                              │
│                                                     │
├─────────────────────────────────────────────────────┤
│    8 LIBRES  /  6 OCUPADOS  /  14 TOTAL            │
└─────────────────────────────────────────────────────┘

  🚗 = espacio ocupado (car.png rotado)
  □  = espacio libre (transparente)
```

---

## 13. Concurrencia y threading

### Modelo de concurrencia

```
┌─────────────────────────────────────────────────────────────┐
│                    PROCESO PYTHON                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              EVENT LOOP (asyncio)                    │  │
│  │                                                      │  │
│  │  Coroutines FastAPI:                                 │  │
│  │  - GET /api/public/parking/stream (SSE, cada 1s)    │  │
│  │  - GET /api/camera/feed (MJPEG, cada 40ms)          │  │
│  │  - POST /api/employee/stays/create                  │  │
│  │  - GET /api/admin/kpis/operations                   │  │
│  │  - ... (todos los handlers HTTP)                    │  │
│  │                                                      │  │
│  │  run_in_executor() para operaciones bloqueantes:     │  │
│  │  - cv2.imencode() (JPEG encoding)                   │  │
│  │  - SQLAlchemy sync queries                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        HILO DAEMON (ParkingDetector)                 │  │
│  │                                                      │  │
│  │  - cap.read() → frame (bloqueante, OK en hilo)      │  │
│  │  - SVC.predict() (bloqueante, OK en hilo)           │  │
│  │  - VisionAdapter.update_state() (lock corto)        │  │
│  │  - VisionAdapter.update_frame_only() (lock corto)   │  │
│  │  - time.sleep(0.025) (25ms entre frames)            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              VisionAdapter (Singleton)               │  │
│  │                                                      │  │
│  │  threading.Lock() protege:                          │  │
│  │  - _spots (escrito por detector, leído por handlers) │  │
│  │  - _frame (escrito por detector, leído por camera)  │  │
│  │  - _last_updated                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Garantías de thread-safety

| Operación | Mecanismo |
|-----------|-----------|
| Leer estado de spots | `VisionAdapter._state_lock` (threading.Lock) |
| Leer frame de cámara | `VisionAdapter._state_lock` + `.copy()` |
| Escritura desde detector | `VisionAdapter._state_lock` |
| Singleton VisionAdapter | Double-checked locking con `VisionAdapter._lock` |
| Sesiones SQLAlchemy | `check_same_thread=False` + `get_db()` por request |

---

## 14. Decisiones de diseño y trade-offs

### SQLite en lugar de PostgreSQL

**Decisión:** Base de datos embebida (SQLite).

**Justificación:** El sistema opera en un único servidor local. SQLite elimina la necesidad de instalar y configurar un servidor de base de datos separado, simplificando el despliegue. Para un estacionamiento de 14 espacios, el volumen de escrituras es bajo (máximo 1 por vehículo).

**Trade-off:** No escala horizontalmente. Si se desplegara en múltiples servidores o con tráfico muy alto, se requeriría migrar a PostgreSQL (el ORM SQLAlchemy lo haría transparente).

---

### Hilo daemon en lugar de proceso separado para visión

**Decisión:** El detector corre en un hilo daemon del mismo proceso Python.

**Justificación:** Simplifica la comunicación (memoria compartida via `VisionAdapter`). No requiere IPC, queues ni serialización. El `threading.Lock` es suficiente para el patrón productor/consumidor con un solo productor.

**Trade-off:** El GIL de Python limita el paralelismo real. Sin embargo, OpenCV libera el GIL durante operaciones I/O y C++ nativas, por lo que en la práctica no hay contención significativa.

---

### SSE en lugar de WebSockets para el mapa

**Decisión:** Server-Sent Events (unidireccional) en lugar de WebSockets (bidireccional).

**Justificación:** El mapa público solo necesita recibir datos del servidor. SSE es más simple, funciona con HTTP/1.1 sin upgrade, y los navegadores reconectan automáticamente.

**Trade-off:** Si en el futuro se necesitara enviar comandos desde el cliente (ej. seleccionar un espacio), habría que agregar endpoints REST separados o migrar a WebSockets.

---

### JWT por query parameter para cámara

**Decisión:** El token se pasa como `?token=<JWT>` en lugar de `Authorization: Bearer`.

**Justificación:** Los elementos HTML `<img>` no permiten headers customizados. Alternativas como cookies o proxies agregarían complejidad.

**Trade-off:** El token queda expuesto en logs del servidor y en el historial del navegador. Mitigación: el token expira en 8 horas y el endpoint es solo de lectura.

---

### bcrypt 4.0.1 fijado (pinned)

**Decisión:** `bcrypt==4.0.1` explícito en `requirements.txt`.

**Justificación:** bcrypt 5.x eliminó el atributo `__about__` que passlib utiliza internamente, causando un `AttributeError` en tiempo de ejecución. passlib no tiene soporte activo para bcrypt 5.x.

**Trade-off:** Versión de bcrypt más antigua, pero la funcionalidad de hashing es idéntica y segura.

---

### Modelo ML en archivo pickle

**Decisión:** El modelo SVC se carga desde `model.p` (pickle de scikit-learn).

**Justificación:** El modelo fue entrenado externamente y se reutiliza sin reentrenamiento. Pickle es el formato nativo de scikit-learn y no requiere dependencias adicionales.

**Trade-off:** Los archivos pickle pueden ejecutar código arbitrario si son maliciosos. Solo debe usarse `model.p` de fuentes confiables.

---

### Demo Mode en base de datos

**Decisión:** Los overrides de demo se persisten en `ParkingSlot.demo_override` (columna booleana en DB).

**Justificación:** Permite que los overrides sobrevivan reinicios del servidor durante sesiones de demostración. El estado real de visión siempre está disponible y los overrides son opcionales.

**Trade-off:** Requiere resetear manualmente los overrides antes de volver a producción.

---

*Última actualización: Febrero 2026*
