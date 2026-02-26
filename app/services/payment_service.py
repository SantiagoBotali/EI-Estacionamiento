"""
app/services/payment_service.py — Simulated and MercadoPago payment handling.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Stay, Payment, StayStatus, PaymentMethod, PaymentStatus

logger = logging.getLogger(__name__)


def simulate_payment(db: Session, stay_id: str, closed_by_id: int | None = None) -> tuple[Payment, Stay]:
    """
    Simulate an approved payment for a stay.

    Returns:
        (payment, updated_stay)
    """
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(status_code=409, detail=f"Estadía en estado {stay.status}")

    from app.services.tariff import calculate_price

    now = datetime.now(timezone.utc)
    amount = calculate_price(stay.entry_at, now)

    payment = Payment(
        stay_id=stay.id,
        method=PaymentMethod.SIMULATED,
        amount=amount,
        status=PaymentStatus.APPROVED,
        processed_at=now,
        external_reference=f"SIM-{stay_id[:8].upper()}",
    )
    db.add(payment)

    stay.exit_at = now
    stay.amount_paid = amount
    stay.amount_expected = amount
    stay.payment_method = PaymentMethod.SIMULATED
    stay.status = StayStatus.CLOSED
    stay.closed_by_id = closed_by_id

    db.commit()
    db.refresh(payment)
    db.refresh(stay)

    logger.info("Simulated payment approved for stay %s: ARS %.2f", stay_id, amount)
    return payment, stay


def process_mp_webhook(payload: dict) -> dict:
    """
    Process a MercadoPago webhook notification.

    TODO: Implement real MP signature validation and payment status update.
    """
    logger.info("MercadoPago webhook received: %s", payload)

    # TODO: Validate x-signature header from MP
    # TODO: Fetch payment from MP API using payload["data"]["id"]
    # TODO: Update Payment record and Stay accordingly

    return {"received": True, "status": "logged"}


# TODO: MP preference creation
# def create_mp_preference(stay: Stay, back_url: str) -> dict:
#     """
#     Create a MercadoPago payment preference.
#
#     Requires:
#         - mercadopago SDK: pip install mercadopago
#         - MP_ACCESS_TOKEN in settings
#
#     Returns:
#         {"init_point": str, "preference_id": str}
#     """
#     import mercadopago
#     sdk = mercadopago.SDK(settings.mp_access_token)
#     preference_data = {
#         "items": [{
#             "title": f"Estacionamiento {stay.ticket.ticket_code}",
#             "quantity": 1,
#             "unit_price": stay.amount_expected,
#             "currency_id": "ARS",
#         }],
#         "back_urls": {
#             "success": f"{back_url}/payment/success",
#             "failure": f"{back_url}/payment/failure",
#         },
#         "external_reference": stay.id,
#     }
#     result = sdk.preference().create(preference_data)
#     return result["response"]
