"""
app/services/stay_manager.py — Stay lifecycle management.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.orm import Session, joinedload

from app.models import Stay, Ticket, StayStatus
from app.services.tariff import calculate_price
from app.services.ticketing import create_ticket_in_db

logger = logging.getLogger(__name__)

MAX_ACTIVE_STAYS = 14  # physical parking spots


def _check_capacity(db: Session) -> None:
    """Raise 409 if the parking lot is already at full capacity."""
    count = db.execute(
        select(Stay).where(Stay.status.in_([StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING]))
    ).scalars().all()
    if len(count) >= MAX_ACTIVE_STAYS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Estacionamiento lleno: ya hay {MAX_ACTIVE_STAYS} estadías activas.",
        )


def create_stay(db: Session, created_by_id: int | None = None, notes: str | None = None) -> tuple[Stay, Ticket, str]:
    """
    Create a new stay + ticket atomically.

    Returns:
        (stay, ticket, barcode_svg)
    """
    _check_capacity(db)

    stay = Stay(
        status=StayStatus.ACTIVE,
        created_by_id=created_by_id,
        notes=notes,
        entry_at=datetime.utcnow() - timedelta(hours=3),  # naive ARS for correct browser display
    )
    db.add(stay)
    db.flush()  # get stay.id before creating ticket

    ticket, barcode_svg = create_ticket_in_db(db, stay.id)
    db.flush()

    db.commit()
    db.refresh(stay)
    db.refresh(ticket)

    return stay, ticket, barcode_svg


def lookup_stay(db: Session, query: str) -> tuple[Stay, Ticket, float]:
    """
    Look up a stay by ticket_code or barcode_value (including closed/cancelled).

    Returns:
        (stay, ticket, amount)
        - active/pending: calculated current amount
        - closed: amount_paid (final charged amount)
        - cancelled: 0

    Raises:
        HTTPException 404 if not found.
    """
    stmt = (
        select(Ticket)
        .options(joinedload(Ticket.stay))
        .where(
            or_(
                Ticket.ticket_code == query,
                Ticket.barcode_value == query,
            )
        )
    )
    ticket = db.execute(stmt).scalar_one_or_none()

    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró estadía con código: {query}",
        )

    stay = ticket.stay

    if stay.status == StayStatus.CLOSED:
        return stay, ticket, float(stay.amount_paid or 0)

    if stay.status == StayStatus.CANCELLED:
        return stay, ticket, 0.0

    from app.database import get_setting
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))
    amount = calculate_price(stay.entry_at, rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace)
    stay.amount_expected = amount
    db.commit()
    db.refresh(stay)

    return stay, ticket, amount


def close_cash(
    db: Session,
    stay_id: str,
    closed_by_id: int | None = None,
) -> Stay:
    """
    Close a stay with cash payment. Amount is always calculated server-side.

    Returns:
        Updated stay.
    """
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(status_code=409, detail=f"Estadía en estado {stay.status}")

    from app.database import get_setting
    from app.models import Payment, PaymentMethod, PaymentStatus

    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))
    now = datetime.now(timezone.utc)
    now_ars = now.replace(tzinfo=None) - timedelta(hours=3)
    amount = calculate_price(stay.entry_at, now, rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace)

    stay.exit_at = now_ars
    stay.amount_paid = amount
    stay.amount_expected = amount
    stay.payment_method = PaymentMethod.CASH
    stay.status = StayStatus.CLOSED
    stay.closed_by_id = closed_by_id

    payment = Payment(
        stay_id=stay.id,
        method=PaymentMethod.CASH,
        amount=amount,
        status=PaymentStatus.APPROVED,
        processed_at=now,
    )
    db.add(payment)
    db.commit()
    db.refresh(stay)
    return stay


def generate_today_active_stays(
    db: Session,
    occupied_vision_ids: list[int],
) -> list[Stay]:
    """
    Close every current ACTIVE/PAYMENT_PENDING stay, then create a fresh
    ACTIVE stay for each occupied spot with a random entry_at earlier today.
    """
    import random

    now = datetime.now(timezone.utc)

    from app.database import get_setting
    from app.models import Payment, PaymentMethod, PaymentStatus

    rate = float(get_setting(db, "rate_per_hour", "1200.0"))

    # ── Close all current active stays ───────────────────────────────────────
    active = (
        db.execute(
            select(Stay).where(Stay.status.in_([StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING]))
        )
        .scalars()
        .all()
    )
    for stay in active:
        entry = stay.entry_at if stay.entry_at.tzinfo else stay.entry_at.replace(tzinfo=timezone.utc)
        amount = calculate_price(entry, now, rate_per_hour=rate)
        now_ars = now.replace(tzinfo=None) - timedelta(hours=3)
        stay.exit_at = now_ars
        stay.status = StayStatus.CLOSED
        stay.amount_expected = amount
        stay.amount_paid = amount
        stay.payment_method = PaymentMethod.CASH
        db.add(Payment(
            stay_id=stay.id,
            method=PaymentMethod.CASH,
            amount=amount,
            status=PaymentStatus.APPROVED,
            processed_at=now,
        ))
    db.commit()

    # ── Create fresh active stays ─────────────────────────────────────────────
    now_ars = datetime.utcnow() - timedelta(hours=3)
    open_hour = 7
    if now_ars.hour >= open_hour:
        earliest = now_ars.replace(hour=open_hour, minute=0, second=0, microsecond=0)
    else:
        earliest = now_ars.replace(hour=0, minute=0, second=0, microsecond=0)
    latest = now_ars - timedelta(minutes=5)
    if latest <= earliest:
        latest = now_ars - timedelta(minutes=1)
    span_sec = max(1, int((latest - earliest).total_seconds()))

    new_stays: list[Stay] = []
    for vision_id in occupied_vision_ids:
        offset = timedelta(seconds=random.randint(0, span_sec))
        entry_at = earliest + offset
        stay = Stay(
            status=StayStatus.ACTIVE,
            slot_vision_id=vision_id,
            entry_at=entry_at,
        )
        db.add(stay)
        db.flush()
        create_ticket_in_db(db, stay.id)
        new_stays.append(stay)

    db.commit()
    for stay in new_stays:
        db.refresh(stay)
    return new_stays


def get_active_stays(db: Session) -> list[Stay]:
    """Return all ACTIVE and PAYMENT_PENDING stays with amount_expected calculated."""
    from app.database import get_setting
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    now = datetime.now(timezone.utc)

    stmt = (
        select(Stay)
        .options(joinedload(Stay.ticket))
        .where(Stay.status.in_([StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING]))
        .order_by(Stay.entry_at.asc())
    )
    stays = db.execute(stmt).scalars().all()
    for stay in stays:
        stay.amount_expected = calculate_price(stay.entry_at, now, rate_per_hour=rate)
    return stays
