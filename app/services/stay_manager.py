"""
app/services/stay_manager.py — Stay lifecycle management.
"""
import logging
from datetime import datetime, timezone

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
