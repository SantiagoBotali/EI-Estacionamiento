# Cierre de Caja Simplificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el flujo de cierre de caja por turnos/demo con un único cierre atómico basado en estadías cobradas desde el último cierre, con selección de empleado y registro de timestamp.

**Architecture:** El backend calcula totales de pagos aprobados (CASH + MP) desde el último cierre guardado; el frontend presenta un preview, un formulario de cierre y un historial. La DB se recrea desde cero (eliminar `parking.db`).

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + SQLite (backend) · Vite + React 18 + TypeScript + Tailwind (frontend)

## Global Constraints

- Empleados válidos exactamente: `"Joaquin Zubiri"`, `"Santiago Botali"`, `"Gino Fina"` — validar en backend y mostrar como opciones fijas en frontend.
- El período cubierto por un cierre: `period_from = closed_at del cierre anterior` (o `datetime(1970,1,1,utc)` si no hay anterior), `period_to = datetime.now(utc)` asignado en el servidor al momento del cierre.
- La diferencia es `actual_cash - cash_amount` (solo sobre el efectivo; el digital no se cuenta físicamente).
- No hay estado OPEN: el cierre se crea definitivo en un solo POST.
- No hay tests automatizados en el proyecto; la verificación es manual con curl/browser.
- Nunca usar `stay.status.value` — `stay.status` ya es `str`.
- bcrypt debe ser `==4.0.1` en requirements.txt.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `app/models.py` | Modificar | Reemplazar modelo `CashClosing`, eliminar enum `CashClosingStatus` |
| `app/schemas.py` | Modificar | Eliminar schemas viejos de caja, agregar `CashClosingPreview`, `CashClosingCreate`, `CashClosingOut` |
| `app/services/cash_closing_service.py` | Reescribir | `get_closing_preview`, `create_closing`, `list_closings` |
| `app/api/employee.py` | Modificar | Reemplazar endpoints de caja, eliminar endpoints obsoletos |
| `app/api/payments.py` | Modificar | Eliminar endpoint `POST /api/payments/simulate/{stay_id}` |
| `frontend/src/api/employee.ts` | Modificar | Eliminar funciones/interfaces obsoletas, agregar nuevas |
| `frontend/src/pages/employee/PanelPage.tsx` | Modificar | Reescribir `CashTab` |
| `frontend/src/pages/admin/DashboardPage.tsx` | Modificar | Agregar sección de historial de cierres en tab Finanzas |

---

## Task 1: Modelo de DB y migración

**Files:**
- Modify: `app/models.py`
- Delete: `parking.db` (en raíz del proyecto)

**Interfaces:**
- Produces: `class CashClosing` con campos: `id`, `employee_name`, `period_from`, `period_to`, `cash_amount`, `digital_amount`, `total_amount`, `stay_count`, `actual_cash`, `difference`, `notes`, `closed_at`, `closed_by_id`

- [ ] **Step 1: Leer el modelo actual para confirmar qué reemplazar**

  Abrir `app/models.py` y localizar `CashClosingStatus` (línea ~139) y `CashClosing` (línea ~144). Ambos se reemplazan por completo.

- [ ] **Step 2: Reemplazar `CashClosingStatus` y `CashClosing` en `app/models.py`**

  Reemplazar desde `class CashClosingStatus` hasta el final del archivo con:

  ```python
  class CashClosing(Base):
      __tablename__ = "cash_closings"

      id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
      employee_name: Mapped[str] = mapped_column(String(64), nullable=False)
      period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
      period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
      cash_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
      digital_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
      total_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
      stay_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
      actual_cash: Mapped[float] = mapped_column(Float, nullable=False)
      difference: Mapped[float] = mapped_column(Float, nullable=False)
      notes: Mapped[str | None] = mapped_column(Text, nullable=True)
      closed_at: Mapped[datetime] = mapped_column(
          DateTime(timezone=True), nullable=False, default=_utcnow
      )
      closed_by_id: Mapped[int | None] = mapped_column(
          Integer, ForeignKey("users.id"), nullable=True
      )

      closed_by: Mapped["User | None"] = relationship("User", foreign_keys=[closed_by_id])
  ```

  Verificar que los imports al inicio del archivo ya incluyen `Integer` (lo tienen).

- [ ] **Step 3: Eliminar `parking.db` para forzar recreación**

  ```bash
  rm "parking.db"
  ```

  Si el servidor está corriendo, detenerlo primero.

- [ ] **Step 4: Verificar que el servidor arranca sin errores**

  ```bash
  .venv/Scripts/python run.py
  ```

  Expected: el servidor inicia, `init_db` recrea la tabla `cash_closings` con el nuevo esquema, `seed_db` crea usuarios `admin`/`empleado`. Sin errores de SQLAlchemy en la consola.

- [ ] **Step 5: Commit**

  ```bash
  git add app/models.py
  git commit -m "feat: simplify CashClosing model - remove shifts/demo, add employee_name and period fields"
  ```

---

## Task 2: Servicio de cierre de caja

**Files:**
- Rewrite: `app/services/cash_closing_service.py`

**Interfaces:**
- Consumes: `CashClosing`, `Payment`, `PaymentMethod`, `PaymentStatus` de `app.models`
- Produces:
  - `get_closing_preview(db: Session) -> dict` — keys: `period_from`, `period_to`, `cash_amount`, `digital_amount`, `total_amount`, `stay_count`
  - `create_closing(db, employee_name, actual_cash, notes, closed_by_id) -> CashClosing`
  - `list_closings(db) -> list[CashClosing]`
  - `VALID_EMPLOYEES: list[str]`

- [ ] **Step 1: Reescribir `app/services/cash_closing_service.py` completamente**

  ```python
  from datetime import datetime, timezone
  from sqlalchemy import select, func
  from sqlalchemy.orm import Session
  from fastapi import HTTPException

  from app.models import CashClosing, Payment, PaymentMethod, PaymentStatus

  VALID_EMPLOYEES = ["Joaquin Zubiri", "Santiago Botali", "Gino Fina"]


  def get_closing_preview(db: Session) -> dict:
      """
      Calcula los totales de pagos desde el último cierre hasta ahora (sin guardar).
      period_from = closed_at del cierre anterior, o epoch si no hay ninguno.
      """
      now = datetime.now(timezone.utc)

      last_closing = db.execute(
          select(CashClosing).order_by(CashClosing.closed_at.desc())
      ).scalars().first()

      period_from = (
          last_closing.closed_at
          if last_closing
          else datetime(1970, 1, 1, tzinfo=timezone.utc)
      )

      # Normalizar timezone
      if period_from.tzinfo is None:
          period_from = period_from.replace(tzinfo=timezone.utc)

      # Suma de pagos CASH aprobados en el período
      cash_result = db.execute(
          select(func.coalesce(func.sum(Payment.amount), 0.0)).where(
              Payment.method == PaymentMethod.CASH,
              Payment.status == PaymentStatus.APPROVED,
              Payment.processed_at >= period_from,
              Payment.processed_at < now,
          )
      ).scalar()
      cash_amount = round(float(cash_result or 0.0), 2)

      # Suma de pagos MERCADOPAGO aprobados en el período
      digital_result = db.execute(
          select(func.coalesce(func.sum(Payment.amount), 0.0)).where(
              Payment.method == PaymentMethod.MERCADOPAGO,
              Payment.status == PaymentStatus.APPROVED,
              Payment.processed_at >= period_from,
              Payment.processed_at < now,
          )
      ).scalar()
      digital_amount = round(float(digital_result or 0.0), 2)

      # Cantidad de estadías distintas con pagos aprobados en el período
      stay_count_result = db.execute(
          select(func.count(func.distinct(Payment.stay_id))).where(
              Payment.status == PaymentStatus.APPROVED,
              Payment.processed_at >= period_from,
              Payment.processed_at < now,
          )
      ).scalar()
      stay_count = int(stay_count_result or 0)

      return {
          "period_from": period_from,
          "period_to": now,
          "cash_amount": cash_amount,
          "digital_amount": digital_amount,
          "total_amount": round(cash_amount + digital_amount, 2),
          "stay_count": stay_count,
      }


  def create_closing(
      db: Session,
      employee_name: str,
      actual_cash: float,
      notes: str | None,
      closed_by_id: int | None,
  ) -> CashClosing:
      """Crea un cierre de caja atómico."""
      if employee_name not in VALID_EMPLOYEES:
          raise HTTPException(
              status_code=422,
              detail=f"Empleado inválido. Opciones: {VALID_EMPLOYEES}",
          )

      preview = get_closing_preview(db)

      closing = CashClosing(
          employee_name=employee_name,
          period_from=preview["period_from"],
          period_to=preview["period_to"],
          cash_amount=preview["cash_amount"],
          digital_amount=preview["digital_amount"],
          total_amount=preview["total_amount"],
          stay_count=preview["stay_count"],
          actual_cash=actual_cash,
          difference=round(actual_cash - preview["cash_amount"], 2),
          notes=notes,
          closed_at=preview["period_to"],
          closed_by_id=closed_by_id,
      )
      db.add(closing)
      db.commit()
      db.refresh(closing)
      return closing


  def list_closings(db: Session) -> list[CashClosing]:
      """Retorna todos los cierres ordenados por más reciente primero."""
      return db.execute(
          select(CashClosing).order_by(CashClosing.closed_at.desc())
      ).scalars().all()
  ```

- [ ] **Step 2: Verificar que el servicio importa sin errores**

  ```bash
  .venv/Scripts/python -c "from app.services.cash_closing_service import get_closing_preview, create_closing, list_closings, VALID_EMPLOYEES; print('OK', VALID_EMPLOYEES)"
  ```

  Expected: `OK ['Joaquin Zubiri', 'Santiago Botali', 'Gino Fina']`

- [ ] **Step 3: Commit**

  ```bash
  git add app/services/cash_closing_service.py
  git commit -m "feat: rewrite cash closing service - atomic closing based on stays since last close"
  ```

---

## Task 3: Schemas de Pydantic

**Files:**
- Modify: `app/schemas.py`

**Interfaces:**
- Consumes: nada externo
- Produces:
  - `CashClosingPreview(BaseModel)` — fields: `period_from: datetime`, `period_to: datetime`, `cash_amount: float`, `digital_amount: float`, `total_amount: float`, `stay_count: int`
  - `CashClosingCreate(BaseModel)` — fields: `employee_name: str`, `actual_cash: float`, `notes: Optional[str]`
  - `CashClosingOut(BaseModel)` — fields: `id`, `employee_name`, `period_from`, `period_to`, `cash_amount`, `digital_amount`, `total_amount`, `stay_count`, `actual_cash`, `difference`, `notes`, `closed_at`, `closed_by_id`

- [ ] **Step 1: Reemplazar la sección `# ─── Cash Closing` en `app/schemas.py`**

  Localizar el bloque que comienza en `# ─── Cash Closing ────` (~línea 166) y reemplazarlo con:

  ```python
  # ─── Cash Closing ────────────────────────────────────────────────────────────

  class CashClosingPreview(BaseModel):
      period_from: datetime
      period_to: datetime
      cash_amount: float
      digital_amount: float
      total_amount: float
      stay_count: int


  class CashClosingCreate(BaseModel):
      employee_name: str
      actual_cash: float
      notes: Optional[str] = None


  class CashClosingOut(BaseModel):
      model_config = ConfigDict(from_attributes=True)

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
      notes: Optional[str] = None
      closed_at: datetime
      closed_by_id: Optional[int] = None
  ```

  Los schemas eliminados son: `CashClosingOpen`, `CashClosingClose`, `CashClosingOut` (viejo), `TodaySummary`.

- [ ] **Step 2: Verificar que schemas importan sin errores**

  ```bash
  .venv/Scripts/python -c "from app.schemas import CashClosingPreview, CashClosingCreate, CashClosingOut; print('OK')"
  ```

  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add app/schemas.py
  git commit -m "feat: replace cash closing schemas - CashClosingPreview, CashClosingCreate, CashClosingOut"
  ```

---

## Task 4: API endpoints

**Files:**
- Modify: `app/api/employee.py`
- Modify: `app/api/payments.py`

**Interfaces:**
- Consumes: `CashClosingPreview`, `CashClosingCreate`, `CashClosingOut` de `app.schemas`; `get_closing_preview`, `create_closing`, `list_closings` de `app.services.cash_closing_service`
- Produces:
  - `GET  /api/employee/cash-closings/preview` → `CashClosingPreview`
  - `POST /api/employee/cash-closings` → `CashClosingOut` (201)
  - `GET  /api/employee/cash-closings` → `list[CashClosingOut]`

- [ ] **Step 1: Actualizar imports en `app/api/employee.py`**

  Localizar la línea de imports de schemas (línea ~14):
  ```python
  from app.schemas import (
      CashClosingOpen,
      CashClosingClose,
      CashClosingOut,
      StayCreate,
      StayCreateResponse,
      StayLookupRequest,
      StayLookupResponse,
      StayOut,
      TariffSettings,
      TicketOut,
      TodaySummary,
  )
  ```

  Reemplazarla con:
  ```python
  from app.schemas import (
      CashClosingPreview,
      CashClosingCreate,
      CashClosingOut,
      StayCreate,
      StayCreateResponse,
      StayLookupRequest,
      StayLookupResponse,
      StayOut,
      TariffSettings,
      TicketOut,
  )
  ```

- [ ] **Step 2: Reemplazar toda la sección `# ─── Cash Closing API` en `app/api/employee.py`**

  Localizar el bloque que comienza en `# ─── Cash Closing API ──────` (~línea 188) y reemplazarlo con:

  ```python
  # ─── Cash Closing API ─────────────────────────────────────────────────────────

  @router.get("/cash-closings/preview", response_model=CashClosingPreview)
  async def preview_cash_closing(
      _: User = Depends(require_employee),
      db: Session = Depends(get_db),
  ):
      """Calcula los totales del período sin guardar el cierre."""
      from app.services.cash_closing_service import get_closing_preview
      return get_closing_preview(db)


  @router.post("/cash-closings", response_model=CashClosingOut, status_code=201)
  async def create_cash_closing(
      payload: CashClosingCreate,
      current_user: User = Depends(require_employee),
      db: Session = Depends(get_db),
  ):
      """Crea un cierre de caja atómico."""
      from app.services.cash_closing_service import create_closing
      closing = create_closing(
          db, payload.employee_name, payload.actual_cash, payload.notes, current_user.id
      )
      return CashClosingOut.model_validate(closing)


  @router.get("/cash-closings", response_model=list[CashClosingOut])
  async def list_cash_closings(
      _: User = Depends(require_employee),
      db: Session = Depends(get_db),
  ):
      """Lista todos los cierres, más reciente primero."""
      from app.services.cash_closing_service import list_closings
      closings = list_closings(db)
      return [CashClosingOut.model_validate(c) for c in closings]
  ```

  **Nota:** También eliminar el endpoint `quick-close` y todos los demás endpoints viejos del bloque (todo lo que estaba después de `# ─── Cash Closing API` hasta el final del archivo).

- [ ] **Step 3: Eliminar el endpoint de simulación en `app/api/payments.py`**

  Eliminar el endpoint `POST /api/payments/simulate/{stay_id}` (líneas 16-26). El archivo queda con solo el webhook de MercadoPago. También eliminar el import de `simulate_payment` que ya no se usa:

  Línea a eliminar del import:
  ```python
  from app.services.payment_service import process_mp_webhook, simulate_payment
  ```
  Reemplazar con:
  ```python
  from app.services.payment_service import process_mp_webhook
  ```

  Y eliminar también los imports no usados `PaymentOut`, `PaymentResponse`, `StayOut`:
  ```python
  from app.schemas import PaymentOut, PaymentResponse, StayOut
  ```
  Reemplazar con (si no quedan otros usos):
  ```python
  # schemas no requeridos en este módulo tras eliminar simulate
  ```
  O simplemente eliminar esa línea de import por completo.

- [ ] **Step 4: Verificar que el servidor arranca y responde**

  Iniciar el servidor y probar los 3 endpoints nuevos:

  ```bash
  # Preview (requiere token — obtener primero)
  curl -s -X POST http://localhost:8000/auth/token \
    -d "username=empleado&password=emp123&grant_type=password" \
    -H "Content-Type: application/x-www-form-urlencoded" | python -m json.tool

  # Guardar el token y usarlo:
  TOKEN="<access_token del paso anterior>"

  curl -s http://localhost:8000/api/employee/cash-closings/preview \
    -H "Authorization: Bearer $TOKEN" | python -m json.tool
  ```

  Expected: JSON con `period_from`, `period_to`, `cash_amount: 0.0`, `digital_amount: 0.0`, `total_amount: 0.0`, `stay_count: 0`

  ```bash
  # Crear cierre
  curl -s -X POST http://localhost:8000/api/employee/cash-closings \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"employee_name":"Santiago Botali","actual_cash":1500.0,"notes":"Test"}' \
    | python -m json.tool
  ```

  Expected: JSON con `id`, `employee_name: "Santiago Botali"`, `difference: 1500.0`, etc.

  ```bash
  # Listar cierres
  curl -s http://localhost:8000/api/employee/cash-closings \
    -H "Authorization: Bearer $TOKEN" | python -m json.tool
  ```

  Expected: array con el cierre recién creado.

  ```bash
  # Empleado inválido debe retornar 422
  curl -s -X POST http://localhost:8000/api/employee/cash-closings \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"employee_name":"Pepe","actual_cash":100.0}' | python -m json.tool
  ```

  Expected: `{"detail": "Empleado inválido. Opciones: [...]"}`

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/employee.py app/api/payments.py
  git commit -m "feat: replace cash closing API endpoints, remove simulate payment endpoint"
  ```

---

## Task 5: Frontend — API client

**Files:**
- Modify: `frontend/src/api/employee.ts`

**Interfaces:**
- Produces:
  - `interface CashClosingPreview` — fields: `period_from: string`, `period_to: string`, `cash_amount: number`, `digital_amount: number`, `total_amount: number`, `stay_count: number`
  - `interface CashClosing` — fields: `id`, `employee_name`, `period_from`, `period_to`, `cash_amount`, `digital_amount`, `total_amount`, `stay_count`, `actual_cash`, `difference`, `notes?`, `closed_at`, `closed_by_id?`
  - `function getCashClosingPreview(): Promise<CashClosingPreview>`
  - `function createCashClosing(data: { employee_name: string; actual_cash: number; notes?: string }): Promise<CashClosing>`
  - `function listCashClosings(): Promise<CashClosing[]>`
  - `const EMPLOYEES: string[]` — exportado para uso en UI

- [ ] **Step 1: Reemplazar la sección `// ─── Cash Closing` en `frontend/src/api/employee.ts`**

  Localizar el bloque que comienza en `// ─── Cash Closing ──────` (~línea 84) hasta el final del archivo y reemplazarlo con:

  ```typescript
  // ─── Cash Closing ─────────────────────────────────────────────────────────

  export const EMPLOYEES = ['Joaquin Zubiri', 'Santiago Botali', 'Gino Fina'] as const

  export interface CashClosingPreview {
    period_from: string
    period_to: string
    cash_amount: number
    digital_amount: number
    total_amount: number
    stay_count: number
  }

  export interface CashClosing {
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

  export function getCashClosingPreview(): Promise<CashClosingPreview> {
    return apiFetch('/api/employee/cash-closings/preview')
  }

  export function createCashClosing(data: {
    employee_name: string
    actual_cash: number
    notes?: string
  }): Promise<CashClosing> {
    return apiFetch('/api/employee/cash-closings', { method: 'POST', body: data })
  }

  export function listCashClosings(): Promise<CashClosing[]> {
    return apiFetch('/api/employee/cash-closings')
  }
  ```

  También eliminar `simulatePayment` de las funciones anteriores (línea ~79-81).

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/api/employee.ts
  git commit -m "feat: update employee API client - new cash closing functions, remove simulate/demo"
  ```

---

## Task 6: Employee panel — CashTab

**Files:**
- Modify: `frontend/src/pages/employee/PanelPage.tsx`

**Interfaces:**
- Consumes: `getCashClosingPreview`, `createCashClosing`, `listCashClosings`, `EMPLOYEES`, `CashClosingPreview`, `CashClosing` de `../../api/employee`
- Consumes: `formatCurrency`, `formatDateTime` de `../../lib/utils`

- [ ] **Step 1: Actualizar imports de `../../api/employee` en `PanelPage.tsx`**

  Localizar el bloque de import de `../../api/employee` (líneas 16-22) y reemplazarlo con:

  ```typescript
  import {
    getActiveStays, lookupStay, createStay, closeCash,
    getEmployeeTariff, generateTodayStays,
    getCashClosingPreview, createCashClosing, listCashClosings, EMPLOYEES,
    type ActiveStay, type StayLookupResponse, type TariffInfo,
    type CashClosingPreview, type CashClosing,
  } from '../../api/employee'
  ```

  También actualizar los imports de lucide-react para eliminar `Sparkles` si no se usa en otro lado, y mantener `Banknote`, `CreditCard`, `Loader2`, `RefreshCw`.

- [ ] **Step 2: Reemplazar el componente `CashTab` completo en `PanelPage.tsx`**

  Localizar la función `CashTab` que empieza en `function CashTab({ toast }` (~línea 644) y reemplazarla completamente con:

  ```tsx
  /* ─────────────────────────────────────────────────────────────
     Tab: Caja
  ───────────────────────────────────────────────────────────── */
  function CashTab({ toast }: { toast: ReturnType<typeof useToast> }) {
    const [preview, setPreview] = useState<CashClosingPreview | null>(null)
    const [history, setHistory] = useState<CashClosing[]>([])
    const [loading, setLoading] = useState(true)
    const [employeeName, setEmployeeName] = useState('')
    const [actualCash, setActualCash] = useState('')
    const [notes, setNotes] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [confirming, setConfirming] = useState(false)

    const loadData = useCallback(async () => {
      setLoading(true)
      try {
        const [p, h] = await Promise.all([getCashClosingPreview(), listCashClosings()])
        setPreview(p)
        setHistory(h)
      } catch (e) {
        toast('error', (e as Error).message)
      } finally {
        setLoading(false)
      }
    }, [toast])

    useEffect(() => { loadData() }, [loadData])

    const actualCashNum = parseFloat(actualCash) || 0
    const liveDiff = preview ? actualCashNum - preview.cash_amount : 0
    const canSubmit = employeeName !== '' && actualCash.trim() !== ''

    const handleClose = async () => {
      if (!canSubmit) return
      setSubmitting(true)
      try {
        await createCashClosing({
          employee_name: employeeName,
          actual_cash: actualCashNum,
          notes: notes.trim() || undefined,
        })
        toast('success', 'Caja cerrada correctamente')
        setEmployeeName('')
        setActualCash('')
        setNotes('')
        setConfirming(false)
        loadData()
      } catch (e) {
        toast('error', (e as Error).message)
      } finally {
        setSubmitting(false)
      }
    }

    if (loading) {
      return (
        <div className="h-40 flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-slate-600" />
        </div>
      )
    }

    return (
      <div className="space-y-6">
        <SectionHeader icon={<Banknote className="w-5 h-5" />} title="Cierre de caja" />

        {/* ── Preview del período actual ── */}
        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                Período actual
              </p>
              <button
                onClick={loadData}
                disabled={loading}
                className="btn-secondary py-1 px-3 text-xs flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>

            <div className="text-[11px] text-slate-500 mb-1">
              Desde:{' '}
              <span className="text-slate-400">
                {preview.period_from === '1970-01-01T00:00:00Z' || new Date(preview.period_from).getFullYear() === 1970
                  ? 'Inicio del historial'
                  : formatDateTime(preview.period_from)}
              </span>
              {' → '}
              Hasta ahora
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(preview.cash_amount)}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Efectivo cobrado</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-purple-400">{formatCurrency(preview.digital_amount)}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Digital cobrado</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-white">{formatCurrency(preview.total_amount)}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Total combinado</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-lg font-bold text-blue-400">{preview.stay_count}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Estadías del período</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Formulario de cierre ── */}
        <div className="card p-6 space-y-4 border-emerald-700/30">
          <h3 className="font-semibold text-white">Realizar cierre de caja</h3>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Empleado que cierra
            </label>
            <select
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              className="input w-full"
            >
              <option value="">— Seleccionar empleado —</option>
              {EMPLOYEES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Monto en efectivo contado
            </label>
            <input
              type="number"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              placeholder="0.00"
              step="0.01"
              className="input w-full"
            />
          </div>

          {actualCash && preview && (
            <div className={`flex justify-between items-center text-sm font-semibold p-2.5 rounded border ${liveDiff >= 0 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40'}`}>
              <span>Diferencia (contado vs esperado en efectivo)</span>
              <span>{liveDiff >= 0 ? '+' : ''}{formatCurrency(liveDiff)}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Observaciones (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Diferencia por billete roto..."
              rows={2}
              className="input w-full resize-none"
            />
          </div>

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={!canSubmit}
              className="btn-success w-full justify-center py-2"
            >
              <CreditCard className="w-4 h-4" />
              Cerrar Caja
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-300 font-semibold text-center">
                ¿Confirmar cierre de caja por {employeeName}?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="btn-secondary flex-1 justify-center py-2"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleClose}
                  disabled={submitting}
                  className="btn-success flex-1 justify-center py-2"
                >
                  {submitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Cerrando…</>
                    : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Historial de cierres ── */}
        {history.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Historial de cierres
            </p>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700/60 bg-slate-900/40">
                      <th className="th">Fecha y hora</th>
                      <th className="th">Empleado</th>
                      <th className="th">Efectivo esperado</th>
                      <th className="th">Contado</th>
                      <th className="th">Digital</th>
                      <th className="th">Total</th>
                      <th className="th">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((c) => (
                      <tr key={c.id} className="table-row">
                        <td className="td text-slate-300 text-sm">{formatDateTime(c.closed_at)}</td>
                        <td className="td font-semibold text-white">{c.employee_name}</td>
                        <td className="td text-slate-200">{formatCurrency(c.cash_amount)}</td>
                        <td className="td text-slate-200">{formatCurrency(c.actual_cash)}</td>
                        <td className="td text-purple-300">{formatCurrency(c.digital_amount)}</td>
                        <td className="td font-semibold text-white">{formatCurrency(c.total_amount)}</td>
                        <td className={`td font-semibold ${c.difference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c.difference >= 0 ? '+' : ''}{formatCurrency(c.difference)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {history.length === 0 && !loading && (
          <p className="text-center text-slate-600 text-sm py-4">No hay cierres registrados aún.</p>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 3: Eliminar variables y funciones huérfanas de la función `CashTab` antigua**

  Verificar que estas referencias ya no existen en el componente (fueron parte del viejo `CashTab`):
  - `demoMode`, `demoShift`, `resetting`, `confirmDialog`, `fondoFijo`, `realCurrentShift`, `schedules`
  - `handleRealOpen`, `handleRealClose`, `handleDemoOpen`, `handleDemoClose`, `handleDemoQuickClose`, `handleReset`
  - `realOpenClosing`, `demoOpenClosing`, `realExpectedTotal`, `realActualNum`, etc.

  Si TypeScript reporta imports no usados (`Sparkles`, `openCashClosing`, etc.), eliminarlos del bloque de import en el Step 1.

- [ ] **Step 4: Verificar en browser**

  Correr el frontend:
  ```bash
  cd frontend && npm run dev
  ```

  Ir a `http://localhost:5173/react/` → login como `empleado/emp123` → tab "Caja".

  Verificar:
  - Las 4 tarjetas de preview se muestran con valores (posiblemente $0 si no hay pagos)
  - El select muestra los 3 empleados
  - El botón "Cerrar Caja" se activa solo cuando hay empleado y monto contado
  - Al confirmar aparece el paso de confirmación
  - Tras cerrar, el historial aparece con la fila del cierre recién creado
  - La diferencia se muestra en verde (sobrante) o rojo (faltante)

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/pages/employee/PanelPage.tsx
  git commit -m "feat: rewrite CashTab - simple atomic close with employee selector and history"
  ```

---

## Task 7: Admin panel — historial de cierres

**Files:**
- Modify: `frontend/src/pages/admin/DashboardPage.tsx`

**Interfaces:**
- Consumes: `listCashClosings`, `CashClosing` de `../../api/employee`
- Consumes: `formatCurrency`, `formatDateTime` de `../../lib/utils`

- [ ] **Step 1: Agregar imports en `DashboardPage.tsx`**

  Localizar el bloque de import de `../../api/employee` (líneas ~18-23):
  ```typescript
  import {
    getActiveStays, lookupStay, closeCash,
    getEmployeeTariff, generateTodayStays,
    type ActiveStay, type StayLookupResponse, type TariffInfo,
  } from '../../api/employee'
  ```

  Reemplazarlo con:
  ```typescript
  import {
    getActiveStays, lookupStay, closeCash,
    getEmployeeTariff, generateTodayStays,
    listCashClosings,
    type ActiveStay, type StayLookupResponse, type TariffInfo, type CashClosing,
  } from '../../api/employee'
  ```

- [ ] **Step 2: Agregar sección de cierres al final de `FinanceTab` en `DashboardPage.tsx`**

  Localizar la función `FinanceTab` y agregar, al final de su JSX (antes del `return` closing), un nuevo componente interno `CashClosingHistory` que se monta dentro de `FinanceTab`:

  Agregar este componente justo antes de `function FinanceTab`:

  ```tsx
  /* ─────────────────────────────────────────────────────────────
     Sub-componente: Historial de cierres de caja (para admin)
  ───────────────────────────────────────────────────────────── */
  function CashClosingHistory({ toast }: { toast: ReturnType<typeof useToast> }) {
    const [history, setHistory] = useState<CashClosing[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      listCashClosings()
        .then(setHistory)
        .catch((e) => toast('error', (e as Error).message))
        .finally(() => setLoading(false))
    }, [toast])

    if (loading) {
      return (
        <div className="h-20 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Historial de cierres de caja
        </p>
        {history.length === 0 ? (
          <p className="text-slate-600 text-sm py-3">No hay cierres registrados aún.</p>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-900/40">
                    <th className="th">Fecha y hora</th>
                    <th className="th">Empleado</th>
                    <th className="th">Estadías</th>
                    <th className="th">Efectivo esperado</th>
                    <th className="th">Contado</th>
                    <th className="th">Digital</th>
                    <th className="th">Total</th>
                    <th className="th">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id} className="table-row">
                      <td className="td text-slate-300 text-sm">{formatDateTime(c.closed_at)}</td>
                      <td className="td font-semibold text-white">{c.employee_name}</td>
                      <td className="td text-slate-400">{c.stay_count}</td>
                      <td className="td text-slate-200">{formatCurrency(c.cash_amount)}</td>
                      <td className="td text-slate-200">{formatCurrency(c.actual_cash)}</td>
                      <td className="td text-purple-300">{formatCurrency(c.digital_amount)}</td>
                      <td className="td font-semibold text-white">{formatCurrency(c.total_amount)}</td>
                      <td className={`td font-semibold ${c.difference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.difference >= 0 ? '+' : ''}{formatCurrency(c.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 3: Montar `CashClosingHistory` al final del JSX de `FinanceTab`**

  Dentro de la función `FinanceTab`, localizar el `return (...)` y agregar `<CashClosingHistory toast={toast} />` al final del contenido, antes del `</div>` de cierre del contenedor principal:

  ```tsx
  {/* ... resto del contenido de FinanceTab ... */}

  {/* ── Historial de cierres de caja ── */}
  <CashClosingHistory toast={toast} />
  ```

- [ ] **Step 4: Verificar en browser**

  Ir a `http://localhost:5173/react/` → login como `admin/admin123` → tab "Finanzas".

  Verificar:
  - La sección "Historial de cierres de caja" aparece al final del tab
  - Si se realizó un cierre desde el panel empleado, aparece listado aquí
  - La tabla muestra: fecha/hora, empleado, estadías, efectivo esperado, contado, digital, total, diferencia

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/pages/admin/DashboardPage.tsx
  git commit -m "feat: add cash closing history to admin finance tab"
  ```

---

## Self-Review

### Spec coverage

| Requisito del spec | Task que lo implementa |
|---|---|
| Eliminar simulación de caja (demo mode) | Task 2, 4, 5, 6 |
| Modelo CashClosing simplificado | Task 1 |
| Período = desde último cierre | Task 2 (`get_closing_preview`) |
| employee_name validado (3 opciones) | Task 2 (`create_closing`), Task 3 (schema), Task 6 (select) |
| actual_cash + difference | Task 2, Task 6 (live preview) |
| cash_amount / digital_amount separados | Task 2, Task 6 (preview cards) |
| Cierre atómico (sin OPEN state) | Task 2, Task 4 |
| Endpoints: preview, POST, GET list | Task 4 |
| Frontend employee: preview + form + history | Task 6 |
| Frontend admin: historial de cierres | Task 7 |
| Migración DB (delete parking.db) | Task 1 |
| Eliminar /api/payments/simulate | Task 4 |

### Placeholders

Ninguno detectado. Todo el código está completo en cada step.

### Type consistency

- `CashClosingPreview` producida en Task 3 → consumida en Task 5 → consumida en Task 6 ✓
- `CashClosing` producida en Task 3 y Task 5 → consumida en Task 6 y Task 7 ✓
- `getCashClosingPreview`, `createCashClosing`, `listCashClosings`, `EMPLOYEES` producidas en Task 5 → consumidas en Task 6 ✓
- `listCashClosings`, `CashClosing` consumidas en Task 7 están producidas en Task 5 ✓
- `get_closing_preview`, `create_closing`, `list_closings` producidas en Task 2 → consumidas en Task 4 ✓
