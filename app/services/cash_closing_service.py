from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func, and_, delete as sql_delete
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import CashClosing, Payment, PaymentMethod, PaymentStatus


def _get_fondo_fijo(db: Session) -> float:
    from app.database import get_setting
    return float(get_setting(db, "fondo_fijo", "5000.0"))


def get_current_shift_info() -> tuple[int, str, datetime, datetime]:
    """
    Get current shift info in ARS timezone (UTC-3).
    Returns (shift_num, date_ars, shift_start_utc, shift_end_utc).

    Shifts (ARS):
    - Shift 1: 06:00-14:00
    - Shift 2: 14:00-22:00
    - Shift 3: 22:00-06:00 (next day)
    """
    now_utc = datetime.now(timezone.utc)
    now_ars = now_utc - timedelta(hours=3)

    hour_ars = now_ars.hour
    date_ars_str = now_ars.strftime("%Y-%m-%d")

    if 6 <= hour_ars < 14:
        shift_num = 1
        shift_start_ars = now_ars.replace(hour=6, minute=0, second=0, microsecond=0)
        shift_end_ars = now_ars.replace(hour=14, minute=0, second=0, microsecond=0)
    elif 14 <= hour_ars < 22:
        shift_num = 2
        shift_start_ars = now_ars.replace(hour=14, minute=0, second=0, microsecond=0)
        shift_end_ars = now_ars.replace(hour=22, minute=0, second=0, microsecond=0)
    else:
        shift_num = 3
        shift_start_ars = now_ars.replace(hour=22, minute=0, second=0, microsecond=0)
        shift_end_ars = (now_ars + timedelta(days=1)).replace(hour=6, minute=0, second=0, microsecond=0)

    shift_start_utc = shift_start_ars + timedelta(hours=3)
    shift_end_utc = shift_end_ars + timedelta(hours=3)

    return shift_num, date_ars_str, shift_start_utc, shift_end_utc


def calculate_expected_cash(db: Session, date_ars: str, shift: int) -> float:
    """Sum of approved CASH payments within the shift window (UTC)."""
    date_obj = datetime.strptime(date_ars, "%Y-%m-%d").date()

    if shift == 1:
        shift_start_ars = datetime.combine(date_obj, datetime.min.time()).replace(hour=6)
        shift_end_ars = datetime.combine(date_obj, datetime.min.time()).replace(hour=14)
    elif shift == 2:
        shift_start_ars = datetime.combine(date_obj, datetime.min.time()).replace(hour=14)
        shift_end_ars = datetime.combine(date_obj, datetime.min.time()).replace(hour=22)
    else:
        shift_start_ars = datetime.combine(date_obj, datetime.min.time()).replace(hour=22)
        shift_end_ars = datetime.combine(date_obj + timedelta(days=1), datetime.min.time()).replace(hour=6)

    shift_start_utc = shift_start_ars.replace(tzinfo=timezone.utc) + timedelta(hours=3)
    shift_end_utc = shift_end_ars.replace(tzinfo=timezone.utc) + timedelta(hours=3)

    result = db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0.0))
        .where(
            and_(
                Payment.method == PaymentMethod.CASH,
                Payment.status == PaymentStatus.APPROVED,
                Payment.processed_at >= shift_start_utc,
                Payment.processed_at < shift_end_utc,
            )
        )
    ).scalar()

    return float(result or 0.0)


def open_cash_closing(
    db: Session,
    shift: int,
    initial_cash: float,
    opened_by_id: int,
    force_demo: bool = False,
    is_demo: bool = False,
) -> CashClosing:
    """
    Open a cash closing.

    Demo path (is_demo=True): zero validations — deletes any existing demo record for
    the shift and creates a fresh one.  Never touches real records.

    Real path (is_demo=False): enforces sequential opening unless force_demo=True.
    """
    _, date_ars, _, _ = get_current_shift_info()

    if is_demo:
        # ── Demo: no validations, replace any existing demo record ──────────────
        db.execute(
            sql_delete(CashClosing).where(
                and_(
                    CashClosing.date == date_ars,
                    CashClosing.shift == shift,
                    CashClosing.is_demo.is_(True),
                )
            )
        )
        db.flush()

    else:
        # ── Real: existence check + optional sequence enforcement ────────────────
        existing = db.execute(
            select(CashClosing).where(
                and_(
                    CashClosing.date == date_ars,
                    CashClosing.shift == shift,
                    CashClosing.is_demo.is_(False),
                )
            )
        ).scalar_one_or_none()

        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe un cierre para el turno {shift} del {date_ars}",
            )

        if not force_demo and shift > 1:
            for prev_shift in range(1, shift):
                prev = db.execute(
                    select(CashClosing).where(
                        and_(
                            CashClosing.date == date_ars,
                            CashClosing.shift == prev_shift,
                            CashClosing.is_demo.is_(False),
                        )
                    )
                ).scalar_one_or_none()

                if not prev:
                    raise HTTPException(
                        status_code=409,
                        detail=f"No se puede abrir el turno {shift}: el turno {prev_shift} aún no fue abierto.",
                    )
                if prev.status != "CLOSED":
                    raise HTTPException(
                        status_code=409,
                        detail=f"No se puede abrir el turno {shift}: el turno {prev_shift} sigue abierto.",
                    )

    expected = calculate_expected_cash(db, date_ars, shift)

    closing = CashClosing(
        date=date_ars,
        shift=shift,
        initial_cash=initial_cash,
        expected_cash=expected,
        is_demo=is_demo,
    )
    db.add(closing)
    db.commit()
    db.refresh(closing)
    return closing


def close_cash_closing(
    db: Session, closing_id: str, actual_cash: float, notes: str | None, closed_by_id: int
) -> CashClosing:
    """
    Close a cash closing (real or demo).

    Accounting model (fondo fijo):
    - difference = actual_cash - (initial_cash + expected_cash)  ← counting discrepancy
    - remesa     = actual_cash - initial_cash                    ← amount to withdraw to safe
    """
    closing = db.execute(
        select(CashClosing).where(CashClosing.id == closing_id)
    ).scalar_one_or_none()

    if not closing:
        raise HTTPException(status_code=404, detail="Cash closing not found")

    if closing.status == "CLOSED":
        raise HTTPException(status_code=409, detail="Cash closing already closed")

    expected = calculate_expected_cash(db, closing.date, closing.shift)

    difference = actual_cash - (closing.initial_cash + expected)
    remesa = actual_cash - closing.initial_cash

    closing.expected_cash = expected
    closing.actual_cash = actual_cash
    closing.difference = difference
    closing.remesa = remesa
    closing.notes = notes
    closing.status = "CLOSED"
    closing.closed_at = datetime.now(timezone.utc)
    closing.closed_by_id = closed_by_id

    db.commit()
    db.refresh(closing)
    return closing


def list_closings(db: Session, date_ars: str | None = None) -> list[CashClosing]:
    query = select(CashClosing)
    if date_ars:
        query = query.where(CashClosing.date == date_ars)
    # Sort: shift ascending, then real before demo
    return db.execute(query.order_by(CashClosing.shift, CashClosing.is_demo)).scalars().all()


def get_next_shift_initial_cash(db: Session, date_ars: str, shift: int) -> float:
    """Returns fondo_fijo — every shift always opens with the same fixed float."""
    return _get_fondo_fijo(db)


def reset_today_closings(db: Session) -> int:
    """Delete only DEMO cash closings for today. Real records are never touched."""
    _, date_ars, _, _ = get_current_shift_info()
    result = db.execute(
        sql_delete(CashClosing).where(
            and_(
                CashClosing.date == date_ars,
                CashClosing.is_demo.is_(True),
            )
        )
    )
    db.commit()
    return result.rowcount


def get_today_summary(db: Session) -> dict:
    """
    Today's summary.
    - closings: ALL records (real + demo), sorted by shift then is_demo
    - KPI totals (total_expected, total_remesa, total_difference): real records only
    - open_closing: real OPEN closing for the current shift
    """
    current_shift, date_ars, _, _ = get_current_shift_info()
    fondo_fijo = _get_fondo_fijo(db)

    closings = list_closings(db, date_ars)
    real_closings = [c for c in closings if not c.is_demo]

    total_expected = sum(c.expected_cash for c in real_closings)
    total_actual = sum(c.actual_cash or 0.0 for c in real_closings if c.status == "CLOSED")
    total_remesa = sum(c.remesa or 0.0 for c in real_closings if c.status == "CLOSED")
    total_difference = None
    if real_closings and all(c.status == "CLOSED" for c in real_closings):
        total_difference = sum((c.difference or 0.0) for c in real_closings)

    open_closing = next(
        (c for c in real_closings if c.shift == current_shift and c.status == "OPEN"),
        None,
    )

    return {
        "date": date_ars,
        "current_shift": current_shift,
        "closings": closings,
        "total_expected": total_expected,
        "total_actual": total_actual,
        "total_remesa": total_remesa,
        "total_difference": total_difference,
        "open_closing": open_closing,
        "fondo_fijo": fondo_fijo,
    }
