"""
app/api/payments.py
====================
Payment endpoints:

  POST /api/payments/simulate/{stay_id}      — simulated payment (dev/demo)
  POST /api/payments/mp/initiate/{stay_id}   — create MP preference & return init_point
  POST /api/payments/mp/webhook/{end_point}  — receive MP webhook notification (HMAC validated)
"""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Stay, Payment, StayStatus, PaymentMethod, PaymentStatus, User
from app.schemas import MPInitiateResponse, PaymentOut, PaymentResponse, StayOut
from app.security import require_employee
from app.services.mercadopago_service import crear_preferencia, validar_firma_webhook
from app.services.payment_service import simulate_payment
from app.services.tariff import calculate_price
from app.services.stay_manager import _make_aware

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/payments", tags=["payments"])


# ─── Simulate (dev / demo) ────────────────────────────────────────────────────

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


# ─── MercadoPago: initiate ────────────────────────────────────────────────────

@router.post("/mp/initiate/{stay_id}", response_model=MPInitiateResponse)
async def mp_initiate(
    stay_id: str,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    """
    El empleado registra el egreso del vehículo y elige pagar con MercadoPago.

    Flow:
    1. Valida que la estadía exista y esté ACTIVE o PAYMENT_PENDING.
    2. Calcula el monto.
    3. Crea una Preference en MercadoPago.
    4. Actualiza la estadía a PAYMENT_PENDING y guarda url_preferencia_pago.
    5. Crea un Payment record PENDING para trazabilidad.
    6. Retorna la URL al frontend → el frontend hace window.open(url, '_blank').
    """
    stay = db.execute(select(Stay).where(Stay.id == stay_id)).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada.")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(
            status_code=409,
            detail=f"No se puede cobrar con MP en estado '{stay.status}'.",
        )

    # ── 1. Calcular monto ────────────────────────────────────────────────────
    from app.database import get_setting
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    now = datetime.now(timezone.utc)
    amount = calculate_price(_make_aware(stay.entry_at), now, rate_per_hour=rate, minimum_charge=minimum)

    # ── 2. Crear Preference en MP ────────────────────────────────────────────
    ticket_code = stay.ticket.ticket_code if stay.ticket else stay.id[:8].upper()
    preference = await crear_preferencia(
        title=f"Estacionamiento SDG+ | Ticket {ticket_code}",
        precio=amount,
        stay_id=stay.id,
        end_point="estadia",
    )

    init_point: str = preference.get("init_point", "")
    if not init_point:
        logger.error("MP preference did not return init_point. Response: %s", preference)
        raise HTTPException(status_code=502, detail="MercadoPago no devolvió la URL de pago.")

    # ── 3. Actualizar estadía ────────────────────────────────────────────────
    now_for_exit = datetime.now(timezone.utc)
    stay.exit_at = now_for_exit
    stay.amount_expected = amount
    stay.status = StayStatus.PAYMENT_PENDING
    stay.url_preferencia_pago = init_point
    stay.fecha_pendiente = now_for_exit
    stay.closed_by_id = current_user.id

    # ── 4. Registrar el intento de pago ─────────────────────────────────────
    payment_record = Payment(
        stay_id=stay.id,
        method=PaymentMethod.MERCADOPAGO,
        amount=amount,
        status=PaymentStatus.PENDING,
        external_reference=stay.id,  # = external_reference en MP
    )
    db.add(payment_record)
    db.commit()
    db.refresh(stay)

    logger.info(
        "MP preference created for stay %s | amount=%.2f | url=%s",
        stay.id,
        amount,
        init_point,
    )

    return MPInitiateResponse(
        stay=StayOut.model_validate(stay),
        url_preferencia_pago=init_point,
    )


# ─── MercadoPago: webhook ────────────────────────────────────────────────────

@router.post("/mp/webhook/{end_point}", status_code=200)
async def mp_webhook(
    end_point: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Recibe notificaciones de pago de MercadoPago.

    Seguridad:
    - Valida la firma HMAC-SHA256 (x-signature header) antes de procesar.
    - Siempre responde HTTP 200; de lo contrario MP reintenta indefinidamente.

    Endpoint registrado en el panel de MP:
        https://<tu-backend>/api/payments/mp/webhook/estadia

    end_point actualmente soportado: 'estadia'
    """
    # El ID del pago viene en la query string como ?data.id=<id>
    data_id = request.query_params.get("data.id", "")

    # ── Validar firma HMAC ────────────────────────────────────────────────────
    if not validar_firma_webhook(dict(request.headers), data_id):
        logger.warning("MP webhook: firma inválida para data_id=%s", data_id)
        raise HTTPException(status_code=401, detail="Firma inválida.")

    # ── Leer body ─────────────────────────────────────────────────────────────
    try:
        body = await request.json()
    except Exception:
        # Algunas notificaciones de prueba de MP envían body vacío
        return {"status": "ok"}

    # Solo procesar notificaciones de tipo "payment"
    # data_id == "123456" es el ID de prueba del panel de MP (test notification)
    if body.get("type") != "payment" or data_id == "123456":
        return {"status": "ok"}

    # ── Consultar el pago completo a la API de MP ─────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.mercadopago.com/v1/payments/{data_id}",
                headers={"Authorization": f"Bearer {settings.mp_access_token}"},
            )
            resp.raise_for_status()
            payment_data = resp.json()
    except Exception:
        logger.exception("MP webhook: error consultando pago %s", data_id)
        # Responder 200 para evitar reintentos de MP
        return {"status": "ok"}

    # ── Procesar solo pagos aprobados ─────────────────────────────────────────
    if payment_data.get("status") != "approved":
        return {"status": "ok"}

    stay_id: str = str(payment_data.get("external_reference", ""))
    mp_payment_id: str = str(payment_data.get("id", ""))

    if not stay_id or not mp_payment_id:
        logger.error("MP webhook: faltan external_reference o id en el pago %s", data_id)
        return {"status": "ok"}

    if end_point == "estadia":
        stay = db.execute(select(Stay).where(Stay.id == stay_id)).scalar_one_or_none()

        if stay is None:
            logger.warning("MP webhook: estadía %s no encontrada.", stay_id)
            return {"status": "ok"}

        if stay.status != StayStatus.PAYMENT_PENDING:
            # Ya procesado (idempotencia) o en estado incorrecto
            logger.info(
                "MP webhook: estadía %s ignorada (estado=%s).", stay_id, stay.status
            )
            return {"status": "ok"}

        # ── Actualizar estadía a CLOSED ───────────────────────────────────────
        now = datetime.now(timezone.utc)
        stay.mp_payment_id = mp_payment_id
        stay.status = StayStatus.CLOSED
        stay.payment_method = PaymentMethod.MERCADOPAGO
        stay.amount_paid = stay.amount_expected

        # Actualizar el Payment record PENDING a APPROVED
        pending_payment = (
            db.execute(
                select(Payment).where(
                    Payment.stay_id == stay_id,
                    Payment.method == PaymentMethod.MERCADOPAGO,
                    Payment.status == PaymentStatus.PENDING,
                )
            )
            .scalars()
            .first()
        )
        if pending_payment:
            pending_payment.status = PaymentStatus.APPROVED
            pending_payment.mp_payment_id = mp_payment_id
            pending_payment.processed_at = now
        else:
            # Por si el registro PENDING no existe (edge case), crear uno nuevo
            db.add(Payment(
                stay_id=stay.id,
                method=PaymentMethod.MERCADOPAGO,
                amount=stay.amount_expected or 0.0,
                status=PaymentStatus.APPROVED,
                external_reference=stay_id,
                mp_payment_id=mp_payment_id,
                processed_at=now,
            ))

        db.commit()
        logger.info(
            "MP webhook: estadía %s → CLOSED | mp_payment_id=%s | amount=%.2f",
            stay_id,
            mp_payment_id,
            stay.amount_paid,
        )
    else:
        logger.warning("MP webhook: endpoint desconocido '%s'", end_point)

    # SIEMPRE responder 200 (de lo contrario MP reintenta)
    return {"status": "ok"}
