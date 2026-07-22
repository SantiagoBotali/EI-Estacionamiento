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
