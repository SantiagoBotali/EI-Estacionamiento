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


def create_stay(db: Session, created_by_id: int | None = None, notes: str | None = None) -> tuple[Stay, Ticket, str]:
    """
    Create a new stay + ticket atomically.

    Returns:
        (stay, ticket, barcode_svg)
    """
    stay = Stay(
        status=StayStatus.ACTIVE,
        created_by_id=created_by_id,
        notes=notes,
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
    Look up a stay by ticket_code or barcode_value.

    Returns:
        (stay, ticket, amount_expected)

    Raises:
        HTTPException 404 if not found.
        HTTPException 409 if already closed/cancelled.
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
    if stay.status in (StayStatus.CLOSED, StayStatus.CANCELLED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La estadía ya está {stay.status}",
        )

    from app.database import get_setting
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    amount = calculate_price(stay.entry_at, rate_per_hour=rate)
    stay.amount_expected = amount
    db.commit()
    db.refresh(stay)

    return stay, ticket, amount


def close_cash(
    db: Session,
    stay_id: str,
    amount_paid: float,
    closed_by_id: int | None = None,
) -> Stay:
    """
    Close a stay with cash payment.

    Returns:
        Updated stay.
    """
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(status_code=409, detail=f"Estadía en estado {stay.status}")

    from app.models import Payment, PaymentMethod, PaymentStatus

    now = datetime.now(timezone.utc)
    stay.exit_at = now
    stay.amount_paid = amount_paid
    stay.payment_method = PaymentMethod.CASH
    stay.status = StayStatus.CLOSED
    stay.closed_by_id = closed_by_id

    payment = Payment(
        stay_id=stay.id,
        method=PaymentMethod.CASH,
        amount=amount_paid,
        status=PaymentStatus.APPROVED,
        processed_at=now,
    )
    db.add(payment)
    db.commit()
    db.refresh(stay)
    return stay


def create_stay_for_spot(
    db: Session,
    vision_id: int,
    entry_at: "datetime | None" = None,
) -> "Stay | None":
    """
    Create an ACTIVE stay for a specific parking spot.
    Returns None (no-op) if a stay already exists for that spot.
    """
    existing = db.execute(
        select(Stay).where(
            Stay.slot_vision_id == vision_id,
            Stay.status == StayStatus.ACTIVE,
        )
    ).scalar_one_or_none()
    if existing:
        return None

    if entry_at is None:
        entry_at = datetime.now(timezone.utc)

    stay = Stay(status=StayStatus.ACTIVE, slot_vision_id=vision_id, entry_at=entry_at)
    db.add(stay)
    db.flush()
    create_ticket_in_db(db, stay.id)
    db.commit()
    db.refresh(stay)
    return stay


def close_stay_for_spot(db: Session, vision_id: int) -> "Stay | None":
    """
    Close the ACTIVE stay for a specific parking spot.
    Returns None if no active stay found.
    """
    stay = db.execute(
        select(Stay).where(
            Stay.slot_vision_id == vision_id,
            Stay.status == StayStatus.ACTIVE,
        )
    ).scalar_one_or_none()
    if not stay:
        return None

    from app.database import get_setting
    from app.models import Payment, PaymentMethod, PaymentStatus

    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    now = datetime.now(timezone.utc)

    entry = stay.entry_at if stay.entry_at.tzinfo else stay.entry_at.replace(tzinfo=timezone.utc)
    amount = calculate_price(entry, now, rate_per_hour=rate)

    stay.exit_at = now
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
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

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
        stay.exit_at = now
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
    # entry_at: random between today_start and (now - 5 min), capped to 4h ago
    earliest = max(today_start, now - timedelta(hours=4))
    latest = now - timedelta(minutes=5)
    if latest <= earliest:
        latest = now - timedelta(minutes=1)
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
