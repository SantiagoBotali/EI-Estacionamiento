"""
app/services/payment_service.py — MercadoPago and cash payment handling.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

import mercadopago
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Stay, Payment, StayStatus, PaymentMethod, PaymentStatus

logger = logging.getLogger(__name__)


def _sdk() -> mercadopago.SDK:
    return mercadopago.SDK(settings.mp_access_token)


# ─── Simulate (legacy, kept for backward compat) ─────────────────────────────

def simulate_payment(db: Session, stay_id: str, closed_by_id: int | None = None) -> tuple[Payment, Stay]:
    """Simulate an approved payment for a stay (legacy endpoint)."""
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(status_code=409, detail=f"Estadía en estado {stay.status}")

    from app.services.tariff import calculate_price
    from app.database import get_setting

    now = datetime.now(timezone.utc)
    now_ars = now.replace(tzinfo=None) - timedelta(hours=3)
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))
    amount = calculate_price(stay.entry_at, now, rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace)

    payment = Payment(
        stay_id=stay.id,
        method=PaymentMethod.SIMULATED,
        amount=amount,
        status=PaymentStatus.APPROVED,
        processed_at=now,
        external_reference=f"SIM-{stay_id[:8].upper()}",
    )
    db.add(payment)

    stay.exit_at = now_ars
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


# ─── MercadoPago ─────────────────────────────────────────────────────────────

def create_mp_preference(db: Session, stay_id: str) -> dict:
    """
    Create a MercadoPago QR Punto de Venta order for a stay.

    Returns:
        {
            "qr_data": str,          # encode this as the QR image (native MP app)
            "checkout_url": str,     # browser fallback (init_point / sandbox_init_point)
            "amount": float,
            "payment_id": str,
        }
    """
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        raise HTTPException(
            status_code=409,
            detail=f"Estadía en estado {stay.status} — no se puede iniciar pago",
        )

    from app.services.tariff import calculate_price
    from app.database import get_setting

    now = datetime.now(timezone.utc)
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))
    amount = calculate_price(stay.entry_at, now, rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace)

    # Update stay to PAYMENT_PENDING
    stay.status = StayStatus.PAYMENT_PENDING
    stay.amount_expected = amount

    # Reuse or create a pending Payment record
    existing = db.execute(
        select(Payment).where(
            Payment.stay_id == stay_id,
            Payment.method == PaymentMethod.MERCADOPAGO,
            Payment.status == PaymentStatus.PENDING,
        )
    ).scalar_one_or_none()

    if existing:
        payment = existing
    else:
        payment = Payment(
            stay_id=stay.id,
            method=PaymentMethod.MERCADOPAGO,
            amount=amount,
            status=PaymentStatus.PENDING,
            external_reference=stay_id,
        )
        db.add(payment)

    db.flush()

    ticket_code = stay.ticket.ticket_code if stay.ticket else stay_id[:8].upper()

    # ── 1. QR Punto de Venta — solo disponible con token de producción (APP_USR-)
    #    Con token TEST- la API instore/qr no está habilitada → se omite
    from app.services.mp_qr import create_qr_order

    is_test_token = settings.mp_access_token.startswith("TEST-")
    qr_data = ""
    in_store_order_id = ""
    if not is_test_token:
        try:
            qr_result = create_qr_order(db, stay_id, amount, ticket_code)
            qr_data = qr_result.get("qr_data", "")
            in_store_order_id = qr_result.get("in_store_order_id", "")
        except Exception as exc:
            logger.warning("QR POS order failed, will use Checkout Pro only: %s", exc)
    else:
        logger.info("TEST token detected — skipping QR POS, using Checkout Pro only")

    # ── 2. Checkout Pro — URL de fallback para el navegador ───────────────────
    base_url = settings.mp_base_url.rstrip("/")
    preference_data = {
        "items": [
            {
                "id": stay_id,
                "title": f"Estacionamiento SDG+ — {ticket_code}",
                "quantity": 1,
                "unit_price": float(amount) if amount > 0 else 1.0,
                "currency_id": "ARS",
            }
        ],
        "external_reference": stay_id,
        "notification_url": f"{base_url}/api/payments/mercadopago/webhook",
        "statement_descriptor": "ESTACIONAMIENTO SDG",
    }

    sdk = _sdk()
    checkout_url = ""
    init_point_url = ""
    preference_id = ""
    try:
        pref_result = sdk.preference().create(preference_data)
        if pref_result["status"] in (200, 201):
            pref = pref_result["response"]
            preference_id = pref.get("id", "")
            init_point_url = pref.get("init_point", "")
            sandbox_init_point = pref.get("sandbox_init_point", "")
            checkout_url = sandbox_init_point if settings.mp_sandbox else init_point_url
        else:
            logger.warning("Checkout Pro preference failed: %s", pref_result)
    except Exception as exc:
        logger.warning("Checkout Pro request failed (red/conexión): %s", exc)
        db.commit()
        raise HTTPException(
            status_code=503,
            detail="No se pudo conectar con MercadoPago. Verificá la conexión a internet del servidor.",
        )

    payment.raw_data = json.dumps({
        "preference_id": preference_id,
        "in_store_order_id": in_store_order_id,
    })

    db.commit()
    db.refresh(payment)
    db.refresh(stay)

    if not qr_data and not init_point_url and not checkout_url:
        raise HTTPException(
            status_code=502,
            detail="No se pudo generar el QR ni la URL de pago. Verificá las credenciales MP.",
        )

    # qr_data para mostrar en el QR de la pantalla:
    #   - Sandbox: usa sandbox_init_point → abre el browser móvil con el checkout de prueba
    #   - Producción: usa EMV (QR POS) si está disponible, sino init_point (universal link → app MP)
    if settings.mp_sandbox:
        qr_for_display = qr_data or checkout_url or init_point_url
    else:
        qr_for_display = qr_data or init_point_url or checkout_url

    logger.info(
        "MP payment initiated for stay %s — emv_qr=%s init_point=%s amount=%.2f",
        stay_id, bool(qr_data), bool(init_point_url), amount,
    )

    return {
        "qr_data": qr_for_display,      # EMV o init_point — siempre algo escaneable
        "checkout_url": checkout_url,   # URL para botón "Abrir en navegador"
        "amount": amount,
        "payment_id": payment.id,
        "is_emv": bool(qr_data),        # True = QR nativo de MP, False = URL
    }


def check_mp_payment(db: Session, stay_id: str) -> dict:
    """
    Poll MercadoPago API to check if a payment for this stay was approved.

    Returns:
        {
            "status": "approved" | "pending" | "rejected" | "not_found",
            "stay": StayOut-compatible dict (only when approved),
            "mp_payment_id": str | None,
        }
    """
    stmt = select(Stay).where(Stay.id == stay_id)
    stay = db.execute(stmt).scalar_one_or_none()

    if stay is None:
        raise HTTPException(status_code=404, detail="Estadía no encontrada")

    # If already closed, return success immediately
    if stay.status == StayStatus.CLOSED:
        return {
            "status": "approved",
            "stay_id": stay.id,
            "amount_paid": float(stay.amount_paid or 0),
            "exit_at": stay.exit_at.isoformat() if stay.exit_at else None,
        }

    # Search MP payments by external_reference (= stay_id)
    sdk = _sdk()
    search_result = sdk.payment().search({"external_reference": stay_id})

    if search_result["status"] != 200:
        logger.warning("MP payment search failed for stay %s: %s", stay_id, search_result)
        return {"status": "pending", "stay_id": stay_id}

    payments_found = search_result["response"].get("results", [])

    approved = next(
        (p for p in payments_found if p.get("status") == "approved"),
        None,
    )

    if not approved:
        # Check for rejected
        rejected = next(
            (p for p in payments_found if p.get("status") in ("rejected", "cancelled")),
            None,
        )
        if rejected:
            return {"status": "rejected", "stay_id": stay_id}
        return {"status": "pending", "stay_id": stay_id}

    # Payment approved — close the stay
    mp_payment_id = str(approved["id"])
    mp_amount = float(approved.get("transaction_amount", stay.amount_expected or 0))
    now = datetime.now(timezone.utc)
    now_ars = now.replace(tzinfo=None) - timedelta(hours=3)

    # Update or create Payment record
    pending_payment = db.execute(
        select(Payment).where(
            Payment.stay_id == stay_id,
            Payment.method == PaymentMethod.MERCADOPAGO,
            Payment.status == PaymentStatus.PENDING,
        )
    ).scalar_one_or_none()

    if pending_payment:
        pending_payment.status = PaymentStatus.APPROVED
        pending_payment.mp_payment_id = mp_payment_id
        pending_payment.processed_at = now
        pending_payment.amount = mp_amount
        pending_payment.raw_data = json.dumps(approved)
    else:
        # Edge case: no pending record found, create one
        new_payment = Payment(
            stay_id=stay_id,
            method=PaymentMethod.MERCADOPAGO,
            amount=mp_amount,
            status=PaymentStatus.APPROVED,
            external_reference=stay_id,
            mp_payment_id=mp_payment_id,
            processed_at=now,
            raw_data=json.dumps(approved),
        )
        db.add(new_payment)

    stay.exit_at = now_ars
    stay.amount_paid = mp_amount
    stay.payment_method = PaymentMethod.MERCADOPAGO
    stay.status = StayStatus.CLOSED

    db.commit()
    db.refresh(stay)

    from app.services.mp_qr import delete_qr_order
    delete_qr_order(db)

    logger.info(
        "MP payment approved for stay %s — mp_payment_id=%s amount=%.2f",
        stay_id, mp_payment_id, mp_amount,
    )

    return {
        "status": "approved",
        "stay_id": stay.id,
        "amount_paid": float(stay.amount_paid or 0),
        "exit_at": stay.exit_at.isoformat(),
        "mp_payment_id": mp_payment_id,
    }


def process_mp_webhook(db: Session, payload: dict) -> dict:
    """
    Process a MercadoPago webhook notification (IPN / webhook v2).
    """
    logger.info("MercadoPago webhook received: %s", payload)

    # MP sends different event types
    topic = payload.get("topic") or payload.get("type")
    resource_id = (
        payload.get("id")
        or payload.get("data", {}).get("id")
    )

    if topic not in ("payment", "merchant_order") or not resource_id:
        return {"received": True, "status": "ignored", "topic": topic}

    try:
        sdk = _sdk()
        result = sdk.payment().get(str(resource_id))

        if result["status"] != 200:
            logger.warning("MP get payment failed for id %s: %s", resource_id, result)
            return {"received": True, "status": "fetch_failed"}

        mp_payment = result["response"]
        external_ref = mp_payment.get("external_reference")

        if not external_ref:
            return {"received": True, "status": "no_external_reference"}

        # Delegate to check_and_close logic
        from app.database import SessionLocal
        with SessionLocal() as webhook_db:
            outcome = check_mp_payment(webhook_db, external_ref)
            return {"received": True, "status": outcome["status"]}

    except Exception as e:
        logger.exception("Error processing MP webhook: %s", e)
        return {"received": True, "status": "error", "detail": str(e)}
