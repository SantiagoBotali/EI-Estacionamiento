import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import PaymentOut, PaymentResponse, StayOut
from app.security import require_employee
from app.services.payment_service import process_mp_webhook, simulate_payment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/simulate/{stay_id}", response_model=PaymentResponse)
async def simulate_payment_endpoint(
    stay_id: str,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    payment, stay = simulate_payment(db, stay_id, closed_by_id=current_user.id)
    return PaymentResponse(
        payment=PaymentOut.model_validate(payment),
        stay=StayOut.model_validate(stay),
    )


@router.post("/mercadopago/webhook")
async def mercadopago_webhook(request: Request, db: Session = Depends(get_db)):
    """
    MercadoPago webhook / IPN endpoint.

    MP sends either:
      - IPN (older): GET ?id=xxx&topic=payment
      - Webhook v2: POST {"action": "payment.updated", "data": {"id": "xxx"}}

    We accept POST with JSON body. For IPN, MP also sends a GET — handle both.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    # Also accept query params (IPN mode)
    params = dict(request.query_params)
    if params.get("topic") and params.get("id"):
        payload = {"topic": params["topic"], "id": params["id"]}

    result = process_mp_webhook(db, payload)
    return result


@router.get("/mercadopago/webhook")
async def mercadopago_webhook_get(request: Request, db: Session = Depends(get_db)):
    """Handle IPN GET notifications from MercadoPago."""
    params = dict(request.query_params)
    payload = {}
    if params.get("topic") and params.get("id"):
        payload = {"topic": params["topic"], "id": params["id"]}
    result = process_mp_webhook(db, payload)
    return result
