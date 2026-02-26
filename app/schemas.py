from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


# ─── Auth ───────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


# ─── User ───────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    is_active: bool
    created_at: datetime


# ─── Parking Slot ────────────────────────────────────────────────────────────

class ParkingSlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slot_number: str
    vision_id: int
    status: str
    demo_override: bool
    last_updated: datetime


# ─── Parking State (public) ──────────────────────────────────────────────────

class SpotState(BaseModel):
    id: int
    x: int
    y: int
    w: int
    h: int
    empty: bool


class ParkingState(BaseModel):
    spots: list[SpotState]
    free: int
    total: int
    occupancy_rate: float
    last_updated: Optional[str] = None


# ─── Stay ────────────────────────────────────────────────────────────────────

class StayCreate(BaseModel):
    notes: Optional[str] = None


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    stay_id: str
    ticket_code: str
    barcode_value: str
    created_at: datetime


class StayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    entry_at: datetime
    exit_at: Optional[datetime] = None
    status: str
    amount_expected: Optional[float] = None
    amount_paid: Optional[float] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    ticket: Optional[TicketOut] = None


class StayCreateResponse(BaseModel):
    stay: StayOut
    ticket: TicketOut
    barcode_svg: str
    amount_expected: Optional[float] = None


class StayLookupRequest(BaseModel):
    query: str  # ticket_code or barcode_value


class StayLookupResponse(BaseModel):
    stay: StayOut
    ticket: TicketOut
    amount_expected: float


class CloseCashRequest(BaseModel):
    amount: float


# ─── Payment ─────────────────────────────────────────────────────────────────

class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    stay_id: str
    method: str
    amount: float
    status: str
    created_at: datetime
    processed_at: Optional[datetime] = None


class PaymentResponse(BaseModel):
    payment: PaymentOut
    stay: StayOut


# ─── Demo Mode ───────────────────────────────────────────────────────────────

class DemoSlotToggle(BaseModel):
    occupied: bool


# ─── Tariff Settings ─────────────────────────────────────────────────────────

class TariffSettings(BaseModel):
    rate_per_hour: float
    minimum_charge: float
    grace_period_minutes: int


class TariffUpdate(BaseModel):
    rate_per_hour: Optional[float] = None


# ─── Admin KPIs ──────────────────────────────────────────────────────────────

class OperationsKPI(BaseModel):
    autos_hoy: int
    duracion_promedio_min: float
    hora_pico: Optional[str]
    tasa_ocupacion_pct: float
    autos_por_hora: list[dict]   # [{hour, count}]
    autos_por_dia: list[dict]    # [{date, count}]


class FinanceKPI(BaseModel):
    ingresos_hoy: float
    ingresos_mes: float
    ticket_promedio: float
    pendiente: float
    ingresos_por_dia: list[dict]  # [{date, amount}]
    por_metodo: list[dict]        # [{method, amount}]
