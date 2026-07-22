# Diseño: Cierre de Caja Simplificado

**Fecha:** 2026-07-22  
**Estado:** Aprobado

---

## Contexto

El sistema actual tiene un flujo de cierre de caja complejo: turnos (1/2/3), modo demo/simulación, fondo fijo, apertura y cierre en dos pasos, y controles de reset. Todo esto se elimina. Se reemplaza por un único cierre atómico basado en las estadías cobradas desde el último cierre.

---

## Objetivo

- Un solo botón "Cerrar Caja" que calcula totales desde el último cierre
- El empleado selecciona su nombre y cuenta el efectivo físico
- El cierre se guarda con timestamp para poder auditar qué empleado corresponde a ese horario
- Historial de todos los cierres visible en panel empleado y panel admin

---

## Modelo de datos — `CashClosing`

Reemplaza el modelo actual. Se elimina: `shift`, `is_demo`, `initial_cash`, `remesa`.  
**Requiere eliminar `parking.db`** y dejar que `init_db` lo recree.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | String(36) UUID | Primary key |
| `employee_name` | String(64) | Nombre del empleado que cierra. Valores válidos: "Joaquin Zubiri", "Santiago Botali", "Gino Fina" |
| `period_from` | DateTime (tz) | Inicio del período cubierto. `closed_at` del cierre anterior, o `datetime(1970,1,1)` si es el primero |
| `period_to` | DateTime (tz) | Momento exacto del cierre (timestamp del sistema) |
| `cash_amount` | Float | Suma de pagos con método CASH aprobados en el período |
| `digital_amount` | Float | Suma de pagos con método MERCADOPAGO aprobados en el período |
| `total_amount` | Float | `cash_amount + digital_amount` |
| `stay_count` | Integer | Cantidad de estadías con al menos un pago aprobado en el período |
| `actual_cash` | Float | Monto en efectivo físicamente contado por el empleado |
| `difference` | Float | `actual_cash - cash_amount` (positivo = sobrante, negativo = faltante) |
| `notes` | Text, nullable | Observaciones opcionales |
| `closed_at` | DateTime (tz) | Timestamp del cierre, generado por el servidor |
| `closed_by_id` | FK → users, nullable | ID del usuario del sistema que ejecutó la acción |

Sin campo `status` — el cierre siempre se crea en estado definitivo (no hay estado OPEN).

---

## Período cubierto

El período de un cierre cubre desde el `period_from` hasta el `period_to` (inclusive).

- `period_from` = `closed_at` del cierre inmediatamente anterior (ordenado por `closed_at`)
- Si no hay cierre anterior, `period_from` = `datetime(1970, 1, 1, tzinfo=utc)` (cubre todo el historial)
- Los pagos incluidos son aquellos con `processed_at >= period_from AND processed_at < period_to`
- `period_to` se asigna en el servidor al momento de crear el cierre

---

## Backend

### Servicio — `app/services/cash_closing_service.py`

Se reemplaza completamente. Funciones nuevas:

**`get_closing_preview(db) -> dict`**
- Busca el último cierre por `closed_at` DESC
- Calcula `period_from` (epoch si no hay anterior)
- Suma pagos CASH aprobados en el período → `cash_amount`
- Suma pagos MERCADOPAGO aprobados en el período → `digital_amount`
- Cuenta estadías distintas con pagos en el período → `stay_count`
- Devuelve: `{ period_from, period_to (now), cash_amount, digital_amount, total_amount, stay_count }`

**`create_closing(db, employee_name, actual_cash, notes, closed_by_id) -> CashClosing`**
- Valida que `employee_name` sea uno de los 3 valores permitidos
- Llama a `get_closing_preview(db)` para obtener los totales
- Crea el registro `CashClosing` con todos los campos calculados
- Commit y retorna el objeto

### API — `app/api/employee.py`

**Endpoints que se eliminan:**
- `POST /api/employee/cash-closings` (apertura con shift)
- `PATCH /api/employee/cash-closings/{id}/close`
- `PATCH /api/employee/cash-closings/{id}/quick-close`
- `DELETE /api/employee/cash-closings/reset-today`
- `GET /api/employee/cash-closings/{shift}/suggested-initial`
- `GET /api/employee/cash-closings/summary/today`

**Endpoints que se eliminan — payments:**
- `POST /api/payments/simulate/{stay_id}`

**Endpoints nuevos:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/employee/cash-closings/preview` | require_employee | Devuelve preview sin guardar |
| `POST` | `/api/employee/cash-closings` | require_employee | Crea el cierre atómicamente |
| `GET` | `/api/employee/cash-closings` | require_employee | Lista todos los cierres, más reciente primero |

### Schemas nuevos (`app/schemas.py`)

```python
class CashClosingPreview(BaseModel):
    period_from: datetime
    period_to: datetime
    cash_amount: float
    digital_amount: float
    total_amount: float
    stay_count: int

class CashClosingCreate(BaseModel):
    employee_name: str  # validado contra lista de 3
    actual_cash: float
    notes: str | None = None

class CashClosingOut(BaseModel):
    id: str
    employee_name: str
    period_from: datetime
    period_to: datetime
    cash_amount: float
    digital_amount: float
    total_amount: float
    stay_count: int
    actual_cash: float
    difference: float
    notes: str | None
    closed_at: datetime
    closed_by_id: int | None
    model_config = ConfigDict(from_attributes=True)
```

---

## Frontend

### Panel Empleado — tab "Cierre de caja" (`PanelPage.tsx`)

**Se elimina:**
- Modo demo completo (banner, controles de demo, demoShift, demoOpenClosing, etc.)
- Selección de turno
- Botones: "Apertura de caja", "Resetear demo", "Cierre rápido"
- Toda la lógica de `openCashClosing`, `openCashClosingWithForce`, `resetTodayClosings`, `quickCloseDemoClosing`
- `simulatePayment` (y el botón "Simular pago" en el panel de estadías si existe)

**Se agrega:**

1. **Preview card** (carga al entrar al tab, botón "Actualizar"):
   - Efectivo cobrado en estadías
   - Digital cobrado en estadías
   - Total combinado
   - Cantidad de estadías del período
   - Período cubierto (desde → hasta)

2. **Formulario de cierre:**
   - Select: "Empleado que cierra" → opciones: Joaquin Zubiri / Santiago Botali / Gino Fina
   - Input numérico: "Monto en efectivo contado"
   - Diferencia en tiempo real: `contado - efectivo esperado` (verde si ≥ 0, rojo si < 0)
   - Textarea opcional: "Observaciones"
   - Botón "Cerrar Caja" → confirmación con dialog → POST → toast de éxito

3. **Historial de cierres** (tabla debajo del formulario):
   - Columnas: Fecha/hora, Empleado, Período cubierto, Efectivo esperado, Contado, Digital, Total, Diferencia
   - Ordenado por más reciente primero

### Panel Admin — `DashboardPage.tsx`

- Agregar tab o sección "Caja" en el panel de finanzas
- Misma tabla de historial de cierres (solo lectura)
- Los datos se obtienen del mismo endpoint `GET /api/employee/cash-closings`

### API client — `frontend/src/api/employee.ts`

**Se eliminan:**
- `openCashClosing`, `openCashClosingWithForce`, `closeCashClosing`
- `getTodaySummary`, `getSuggestedInitial`
- `resetTodayClosings`, `quickCloseDemoClosing`
- `simulatePayment`
- Interfaces: `TodaySummary`, partes obsoletas de `CashClosing`

**Se agregan:**
```typescript
interface CashClosingPreview {
  period_from: string
  period_to: string
  cash_amount: number
  digital_amount: number
  total_amount: number
  stay_count: number
}

interface CashClosing {
  id: string
  employee_name: string
  period_from: string
  period_to: string
  cash_amount: number
  digital_amount: number
  total_amount: number
  stay_count: number
  actual_cash: number
  difference: number
  notes?: string
  closed_at: string
  closed_by_id?: number
}

function getCashClosingPreview(): Promise<CashClosingPreview>
function createCashClosing(data: { employee_name: string; actual_cash: number; notes?: string }): Promise<CashClosing>
function listCashClosings(): Promise<CashClosing[]>
```

---

## Migración de base de datos

Pasos al desplegar:
1. Detener el servidor
2. Eliminar `parking.db`
3. Iniciar el servidor → `init_db` + `seed_db` recrean usuarios y tarifa

Los datos históricos de estadías y pagos existentes se pierden (aceptable en entorno de desarrollo/demo).

---

## Empleados válidos

Los únicos valores aceptados para `employee_name`:
- `"Joaquin Zubiri"`
- `"Santiago Botali"`
- `"Gino Fina"`

Validado tanto en el backend (HTTPException 422 si no coincide) como en el frontend (select con opciones fijas).
