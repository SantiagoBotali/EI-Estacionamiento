import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db, get_setting
from app.models import Payment, PaymentStatus, Stay, StayStatus, SystemSetting, User
from app.schemas import FinanceKPI, OperationsKPI, TariffSettings, TariffUpdate
from app.security import require_admin
from app.services.vision_adapter import VisionAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])
templates = Jinja2Templates(directory="templates")


# ─── HTML Pages ──────────────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse, include_in_schema=False)
async def admin_login_page(request: Request):
    return templates.TemplateResponse("admin/login.html", {"request": request})


@router.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def admin_dashboard_page(request: Request):
    return templates.TemplateResponse("admin/dashboard.html", {"request": request})


# ─── KPI Endpoints ────────────────────────────────────────────────────────────

@router.get("/kpis/operations", response_model=OperationsKPI)
async def operations_kpis(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)

    # Autos hoy
    autos_hoy_stmt = select(func.count(Stay.id)).where(Stay.entry_at >= today_start)
    autos_hoy = db.execute(autos_hoy_stmt).scalar() or 0

    # Duración promedio (stays cerradas hoy)
    closed_today = (
        db.execute(
            select(Stay)
            .where(
                Stay.status == StayStatus.CLOSED,
                Stay.exit_at >= today_start,
            )
        )
        .scalars()
        .all()
    )
    durations = []
    for s in closed_today:
        if s.exit_at and s.entry_at:
            entry = s.entry_at if s.entry_at.tzinfo else s.entry_at.replace(tzinfo=timezone.utc)
            exit_ = s.exit_at if s.exit_at.tzinfo else s.exit_at.replace(tzinfo=timezone.utc)
            durations.append((exit_ - entry).total_seconds() / 60)
    duracion_prom = sum(durations) / len(durations) if durations else 0.0

    # Hora pico (hour with most entries today)
    hora_pico = None
    all_today = (
        db.execute(select(Stay).where(Stay.entry_at >= today_start)).scalars().all()
    )
    if all_today:
        hours: dict[int, int] = {}
        for s in all_today:
            h = s.entry_at.hour
            hours[h] = hours.get(h, 0) + 1
        peak_h = max(hours, key=lambda x: hours[x])
        hora_pico = f"{peak_h:02d}:00 – {peak_h + 1:02d}:00"

    # Tasa de ocupación actual
    adapter = VisionAdapter.get_instance()
    state = adapter.get_state()
    tasa = state["occupancy_rate"] * 100 if state["total"] > 0 else 0.0

    # Autos por hora (hoy)
    autos_por_hora = []
    for h in range(24):
        hour_start = today_start + timedelta(hours=h)
        hour_end = hour_start + timedelta(hours=1)
        cnt_stmt = select(func.count(Stay.id)).where(
            Stay.entry_at >= hour_start,
            Stay.entry_at < hour_end,
        )
        cnt = db.execute(cnt_stmt).scalar() or 0
        autos_por_hora.append({"hour": f"{h:02d}:00", "count": cnt})

    # Autos por día (últimos 7 días)
    autos_por_dia = []
    for d in range(6, -1, -1):
        day_start = today_start - timedelta(days=d)
        day_end = day_start + timedelta(days=1)
        cnt_stmt = select(func.count(Stay.id)).where(
            Stay.entry_at >= day_start,
            Stay.entry_at < day_end,
        )
        cnt = db.execute(cnt_stmt).scalar() or 0
        autos_por_dia.append({"date": day_start.strftime("%d/%m"), "count": cnt})

    return OperationsKPI(
        autos_hoy=autos_hoy,
        duracion_promedio_min=round(duracion_prom, 1),
        hora_pico=hora_pico,
        tasa_ocupacion_pct=round(tasa, 1),
        autos_por_hora=autos_por_hora,
        autos_por_dia=autos_por_dia,
    )


@router.get("/kpis/finance", response_model=FinanceKPI)
async def finance_kpis(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)

    approved_payments = (
        db.execute(
            select(Payment).where(Payment.status == PaymentStatus.APPROVED)
        )
        .scalars()
        .all()
    )

    def _ts(p: Payment) -> datetime:
        ts = p.processed_at or p.created_at
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)

    # Ingresos hoy
    ingresos_hoy = sum(p.amount for p in approved_payments if _ts(p) >= today_start)

    # Ingresos mes
    ingresos_mes = sum(p.amount for p in approved_payments if _ts(p) >= month_start)

    # Ticket promedio
    ticket_prom = ingresos_mes / len(approved_payments) if approved_payments else 0.0

    # Pendiente (stays ACTIVE o PAYMENT_PENDING)
    pending_stmt = select(func.coalesce(func.sum(Stay.amount_expected), 0)).where(
        Stay.status.in_([StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING])
    )
    pendiente = db.execute(pending_stmt).scalar() or 0.0

    # Ingresos por día (últimos 7 días)
    ingresos_por_dia = []
    for d in range(6, -1, -1):
        day_start = today_start - timedelta(days=d)
        day_end = day_start + timedelta(days=1)
        total = sum(
            p.amount for p in approved_payments
            if day_start <= _ts(p) < day_end
        )
        ingresos_por_dia.append({"date": day_start.strftime("%d/%m"), "amount": round(total, 2)})

    # Por método
    method_totals: dict[str, float] = {}
    for p in approved_payments:
        method_totals[p.method] = method_totals.get(p.method, 0) + p.amount
    por_metodo = [{"method": m, "amount": round(a, 2)} for m, a in method_totals.items()]

    return FinanceKPI(
        ingresos_hoy=round(ingresos_hoy, 2),
        ingresos_mes=round(ingresos_mes, 2),
        ticket_promedio=round(ticket_prom, 2),
        pendiente=round(pendiente, 2),
        ingresos_por_dia=ingresos_por_dia,
        por_metodo=por_metodo,
    )


# ─── Tariff Settings ──────────────────────────────────────────────────────────

@router.get("/settings/tariff", response_model=TariffSettings)
async def get_tariff_settings(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))
    return TariffSettings(rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace)


@router.put("/settings/tariff")
async def update_tariff_settings(
    body: TariffUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if body.rate_per_hour is not None:
        row = db.get(SystemSetting, "rate_per_hour")
        if row:
            row.value = str(body.rate_per_hour)
        else:
            db.add(SystemSetting(key="rate_per_hour", value=str(body.rate_per_hour)))
        db.commit()
    return {"ok": True}
