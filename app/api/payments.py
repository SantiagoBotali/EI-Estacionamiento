import logging

from fastapi import APIRouter, Depends
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
async def mercadopago_webhook(payload: dict):
    """
    MercadoPago webhook endpoint.
    TODO: Implement real MP signature validation and payment processing.
    """
    result = process_mp_webhook(payload)
    return result
