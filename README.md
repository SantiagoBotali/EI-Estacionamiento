# Sistema de Estacionamiento Inteligente

Sistema de gestión de estacionamiento con visión artificial, diseñado para detectar la ocupación de espacios en tiempo real mediante análisis de video, con panel de empleados, dashboard administrativo y emisión de tickets.

---

## Requisitos previos

- **Python 3.10 o superior** (probado en Python 3.12)
- **Git** (opcional, para clonar el repositorio)
- Los archivos de media deben estar presentes en la carpeta `Media/`:
  - `parking_crop_loop.mp4` — video del estacionamiento
  - `mask_crop.png` — máscara de zonas de detección
  - `car.png` — icono de vehículo para el mapa
- El archivo `model.p` debe estar en la raíz del proyecto (modelo SVC entrenado)

---

## Instalación

### 1. Clonar o descargar el proyecto

```bash
git clone <url-del-repositorio>
cd "Estacionamiento - SDG +"
```

### 2. Crear el entorno virtual

```bash
python -m venv .venv
```

### 3. Activar el entorno virtual

**Windows (CMD):**
```cmd
.venv\Scripts\activate
```

**Windows (PowerShell):**
```powershell
.venv\Scripts\Activate.ps1
```

**Linux / macOS:**
```bash
source .venv/bin/activate
```

### 4. Instalar dependencias

```bash
pip install -r requirements.txt
```

> **Importante:** `bcrypt==4.0.1` está fijado en `requirements.txt`. No actualizar a bcrypt 5.x ya que es incompatible con `passlib`.

---

## Ejecución

```bash
python run.py
```

El servidor arranca en `http://localhost:8000/`.

Al iniciar, el sistema realiza automáticamente:
1. Creación de la base de datos SQLite (`parking.db`)
2. Creación de usuarios por defecto (admin y empleado)
3. Inserción de datos históricos de ejemplo (85 estadías)
4. Inicio del detector de visión artificial (hilo daemon en segundo plano)

---

## Acceso al sistema

| Interfaz | URL | Usuario | Contraseña |
|----------|-----|---------|------------|
| Mapa público | `http://localhost:8000/` | — | — |
| Kiosco de entrada | `http://localhost:8000/kiosk` | — | — |
| Panel de empleados | `http://localhost:8000/employee/login` | `empleado` | `emp123` |
| Dashboard de administración | `http://localhost:8000/admin/login` | `admin` | `admin123` |
| Documentación de la API | `http://localhost:8000/docs` | — | — |

---

## Descripción de interfaces

### Mapa público (`/`)
Vista de solo lectura accesible desde cualquier navegador sin autenticación. Muestra en tiempo real el estado de cada espacio del estacionamiento mediante un stream SSE (Server-Sent Events) que se actualiza cada segundo. Los espacios ocupados muestran un ícono de auto; los libres aparecen transparentes. En la barra superior se indica la cantidad de espacios libres, ocupados y el total.

### Kiosco de entrada (`/kiosk`)
Pantalla de autoservicio pensada para una tablet en la entrada del estacionamiento. El usuario toca el botón para registrar su ingreso y el sistema emite un ticket con código único (formato `EST-YYYYMMDD-NNNN`) y un código de barras Code128. El ticket se muestra durante 5 segundos y luego la pantalla vuelve al estado inicial.

### Panel de empleados (`/employee/login`)
Interfaz de gestión operativa con cinco secciones:

- **Mapa:** visualización del estado actual del estacionamiento.
- **Cámara:** stream de video en vivo (MJPEG) desde la cámara del sistema.
- **Buscar estadía:** búsqueda por código de ticket o UUID de código de barras; permite cobrar en efectivo o con pago simulado.
- **Estadías activas:** listado de todos los vehículos actualmente en el estacionamiento con duración y monto estimado.
- **Nueva estadía:** registro manual de ingreso con emisión de ticket imprimible.
- **Demo:** herramienta para forzar manualmente el estado de cada espacio (útil para pruebas sin vehículos reales).

### Dashboard de administración (`/admin/login`)
Panel analítico con cuatro secciones:

- **Operaciones:** KPIs del día (autos ingresados, duración promedio, hora pico, tasa de ocupación), gráficos de autos por hora y por día.
- **Finanzas:** ingresos del día y del mes, ticket promedio, monto pendiente de cobro, gráficos de ingresos por día y distribución por método de pago.
- **Cámara:** feed de video en vivo con estadísticas de ocupación al costado.
- **En vivo:** mapa público embebido en tiempo real.

Desde este panel también se puede modificar la tarifa por hora directamente.

---

## Tarifas

| Concepto | Valor |
|----------|-------|
| Período de gracia | 15 minutos (gratis) |
| Tarifa | $800 ARS / hora |
| Unidad de cobro | Cuartos de hora (redondeado hacia arriba) |
| Mínimo (luego de gracia) | $300 ARS |

**Ejemplos:**
- 0–15 min → $0 (gracia)
- 20 min → $300 (mínimo)
- 45 min → $400 (30 min billables → 0.5h → $400)
- 1h 30min → $1.200 (1h 15min billables → 1.5h → $1.200)

La tarifa es configurable desde el dashboard de administración.

---

## Métodos de pago disponibles

| Método | Descripción |
|--------|-------------|
| **Efectivo** | El empleado registra el pago en mano |
| **Pago simulado** | Aprobación automática para pruebas y demos |
| **MercadoPago** | Stub de webhook implementado (pendiente integración real) |

---

## Configuración opcional

Se puede crear un archivo `.env` en la raíz del proyecto para sobreescribir la configuración por defecto:

```env
SECRET_KEY=mi-clave-secreta-segura
ACCESS_TOKEN_EXPIRE_MINUTES=480
GRACE_PERIOD_MINUTES=15
RATE_PER_HOUR=800.0
MINIMUM_CHARGE=300.0
DEBUG=false
```

---

## Estructura del proyecto

```
.
├── run.py                  # Punto de entrada
├── requirements.txt        # Dependencias Python
├── model.p                 # Modelo SVC entrenado (clasificación de espacios)
├── parking.db              # Base de datos SQLite (generada al iniciar)
├── app/
│   ├── main.py             # Aplicación FastAPI + ciclo de vida
│   ├── config.py           # Configuración centralizada
│   ├── database.py         # Motor SQLite + ORM + seed
│   ├── models.py           # 6 modelos ORM (Usuario, Espacio, Estadía, etc.)
│   ├── schemas.py          # Esquemas Pydantic v2
│   ├── security.py         # JWT + bcrypt + control de roles
│   ├── api/
│   │   ├── auth.py         # POST /auth/token
│   │   ├── public.py       # Mapa, estado, stream SSE
│   │   ├── employee.py     # Panel de empleados + CRUD de estadías
│   │   ├── admin.py        # Dashboard + KPIs
│   │   ├── payments.py     # Pago simulado + webhook MP
│   │   └── camera.py       # Stream MJPEG (autenticado por query param)
│   └── services/
│       ├── vision_adapter.py   # Singleton hilo-seguro (detector ↔ API)
│       ├── tariff.py           # Cálculo de tarifas
│       ├── ticketing.py        # Generación de tickets y códigos de barras
│       ├── stay_manager.py     # Ciclo de vida de estadías
│       └── payment_service.py  # Procesamiento de pagos
├── vision/
│   ├── utils.py            # Clasificación de espacios (SVC + OpenCV)
│   └── detector.py         # Hilo daemon de procesamiento de video
├── templates/
│   ├── public/             # Mapa, kiosco, ticket imprimible
│   ├── employee/           # Login y panel de empleados
│   └── admin/              # Login y dashboard
├── static/
│   └── css/styles.css      # Variables CSS globales
└── Media/
    ├── parking_crop_loop.mp4   # Video de entrada al detector
    ├── mask_crop.png           # Máscara de 14 espacios
    └── car.png                 # Ícono de vehículo
```

---

## Frontend React

El proyecto incluye una interfaz React (Vite + TypeScript + Tailwind) que reemplaza los paneles Jinja2 del empleado y del administrador. FastAPI la sirve en `/react/*` cuando existe el build compilado.

### Requisitos adicionales

- **Node.js 18 o superior** (incluye `npm`)

### Opción A — Desarrollo (hot reload)

En una terminal aparte, mientras el backend corre:

```bash
cd frontend
npm install        # solo la primera vez
npm run dev
```

El dev server queda en `http://localhost:5173/react/`. Vite redirige las llamadas a la API al backend en `localhost:8000` automáticamente (configurado en `vite.config.ts`).

> El backend debe estar corriendo en paralelo (`python run.py`) para que la API responda.

### Opción B — Build para producción (recomendada)

```bash
cd frontend
npm install        # solo la primera vez
npm run build
```

Esto genera la carpeta `frontend/dist/`. FastAPI la detecta al iniciar y sirve la app en `http://localhost:8000/react/`. No se necesita servidor Node en producción.

### Acceso al frontend React

| Interfaz | URL (dev) | URL (producción) |
|----------|-----------|-----------------|
| Panel de empleados | `http://localhost:5173/react/employee` | `http://localhost:8000/react/employee` |
| Dashboard de administración | `http://localhost:5173/react/admin` | `http://localhost:8000/react/admin` |

Las credenciales son las mismas que en la versión Jinja2 (`empleado / emp123`, `admin / admin123`).

### Estructura del frontend

```
frontend/
├── src/
│   ├── components/     # Componentes reutilizables (tablas, gráficos, mapa)
│   ├── pages/          # Páginas por rol (Employee, Admin)
│   ├── hooks/          # Custom hooks (autenticación, SSE, fetch)
│   ├── types/          # Tipos TypeScript compartidos
│   └── main.tsx        # Entry point
├── index.html
├── vite.config.ts      # Proxy a localhost:8000 + base path /react/
├── tailwind.config.js
└── package.json
```

---

## Solución de problemas comunes

**Error al iniciar: `bcrypt` incompatible**
```
AttributeError: module 'bcrypt' has no attribute '__about__'
```
Solución: `pip install bcrypt==4.0.1`

---

**El detector no detecta espacios correctamente**

Verificar que `model.p`, `Media/mask_crop.png` y `Media/parking_crop_loop.mp4` existen en las rutas correctas. El modelo fue entrenado con features normalizadas en [0.0, 1.0].

---

**Error en Windows con asyncio (Python 3.12)**
```
RuntimeError: no running event loop
```
Ya corregido en `run.py` con `WindowsSelectorEventLoopPolicy`. No modificar ese archivo.

---

**La cámara no muestra imagen**

El stream de cámara requiere autenticación. Asegurarse de estar logueado y que el token JWT esté almacenado en `localStorage`. El endpoint `/api/camera/feed?token=<JWT>` requiere rol EMPLOYEE o ADMIN.
