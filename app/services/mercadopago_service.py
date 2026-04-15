"""
app/services/mercadopago_service.py
====================================
MercadoPago Checkout Pro integration — Python / FastAPI adaptation of the
F5 project (F5BE mercadoPago.js + middlewares/auth.js).

Public API
----------
crear_preferencia(...)         → Call MP REST API, return preference dict.
validar_firma_webhook(...)     → HMAC-SHA256 guard for inbound webhooks.
cancelar_estadias_timeout(...) → Cron callback: cancel timed-out PAYMENT_PENDING stays.
"""
import hmac
import hashlib
import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Stay, StayStatus, Payment, PaymentMethod, PaymentStatus

logger = logging.getLogger(__name__)

MP_BASE_URL = "https://api.mercadopago.com"


# ─── Preference creation ──────────────────────────────────────────────────────

async def crear_preferencia(
    *,
    title: str,
    precio: float,
    stay_id: str,
    end_point: str = "estadia",
) -> dict:
    """
    Crea una Preference de pago en MercadoPago.

    Equivalente directo de mercadoPagoController.createPreference() del proyecto F5.

    Args:
        title:      Descripción visible en la pantalla de pago de MP.
        precio:     Monto en ARS (float).
        stay_id:    ID de la estadía en BD → se usa como external_reference.
        end_point:  Sufijo para el webhook (siempre 'estadia' en este proyecto).

    Returns:
        El dict completo de la Preference de MP (contiene ``init_point``, ``id``, etc.).

    Raises:
        HTTPException 503 si MP no responde o la solicitud falla.
    """
    if not settings.mp_access_token:
        raise HTTPException(
            status_code=503,
            detail="MercadoPago no configurado: falta MP_ACCESS_TOKEN en el servidor.",
        )

    now = datetime.utcnow()
    expiry = now + timedelta(minutes=20)  # Preference expira en 20 min (< cron timeout de 30)

    # Construir la URL del webhook. Si mp_url_backend ya incluye /webhook, no duplicar.
    webhook_base = settings.mp_url_backend.rstrip("/")
    if not webhook_base:
        webhook_base = "http://localhost:8000/api/payments/mp/webhook"
    notification_url = f"{webhook_base}/{end_point}"

    body = {
        "items": [
            {
                "id": stay_id,
                "title": title,
                "quantity": 1,
                "unit_price": round(precio, 2),
                "currency_id": "ARS",
            }
        ],
        "back_urls": {
            # Al aprobar: redirige a /pago/exito/{stay_id}
            "success": f"{settings.mp_url_frontend_success}/{stay_id}",
            # Al fallar o estar pendiente: redirige a /pago/error
            "failure": settings.mp_url_frontend_failure,
            "pending": settings.mp_url_frontend_failure,
        },
        "notification_url": notification_url,
        "auto_return": "approved",       # Redirige automáticamente al success tras aprobación
        "binary_mode": True,             # Solo aprobado o rechazado (sin estado pendiente)
        "expires": True,
        "expiration_date_from": now.isoformat() + "Z",
        "expiration_date_to": expiry.isoformat() + "Z",
        "external_reference": stay_id,  # ← CLAVE: puente entre MP y la BD
        "statement_descriptor": "EI-ESTACIONAMIENTO",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{MP_BASE_URL}/checkout/preferences",
                json=body,
                headers={
                    "Authorization": f"Bearer {settings.mp_access_token}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        logger.error("MP preference creation failed: %s %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail="Error al contactar con MercadoPago.")
    except httpx.RequestError as exc:
        logger.error("MP connection error: %s", exc)
        raise HTTPException(status_code=503, detail="No se pudo conectar con MercadoPago.")


# ─── Webhook signature validation ─────────────────────────────────────────────

def validar_firma_webhook(headers: dict, data_id: str) -> bool:
    """
    Valida la firma HMAC-SHA256 enviada por MercadoPago en cada notificación.

    Header ``x-signature`` tiene la forma: ``ts=<timestamp>,v1=<hash_hex>``
    Header ``x-request-id`` es el UUID de la request.
    Query param ``data.id`` es el ID numérico del pago.

    El template firmado es exactamente: ``id:<data_id>;request-id:<x_request_id>;ts:<ts>;``

    Returns:
        True si la firma es válida, False en caso contrario.
    """
    secret = settings.mp_webhook_secret
    if not secret:
        # Sin secret configurado: en desarrollo aceptar sin validar (advertir en log)
        logger.warning(
            "MP_WEBHOOK_SECRET no configurado — saltando validación de firma. "
            "Configura la variable de entorno antes de producción."
        )
        return True

    x_signature = headers.get("x-signature", "")
    x_request_id = headers.get("x-request-id", "")

    # Parsear ts y v1 del header x-signature
    parts: dict[str, str] = {}
    for part in x_signature.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            parts[k.strip()] = v.strip()

    ts = parts.get("ts", "")
    hash_recibido = parts.get("v1", "")

    if not ts or not hash_recibido:
        return False

    # Template idéntico al del middleware Express del proyecto F5
    template = f"id:{data_id};request-id:{x_request_id};ts:{ts};"

    firma_calculada = hmac.new(
        secret.encode(),
        template.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(firma_calculada, hash_recibido)


# ─── Cron: cancel timed-out PAYMENT_PENDING stays ────────────────────────────

def cancelar_estadias_timeout(db_factory) -> None:
    """
    Cancela estadías en estado PAYMENT_PENDING sin ``mp_payment_id`` que llevan
    más de ``MP_TIME`` minutos desde que pasaron a ese estado.

    Se llama desde APScheduler cada 5 minutos.

    Equivalente al ``cancelTurno()`` del proyecto F5 (models/turno.js).

    Args:
        db_factory: callable que retorna una Session de SQLAlchemy (SessionLocal).
    """
    db: Session = db_factory()
    try:
        tiempo_limite_min = settings.mp_time
        corte = datetime.now(timezone.utc) - timedelta(minutes=tiempo_limite_min)

        # Estadías PAYMENT_PENDING sin pago aprobado y con fecha_pendiente ya expirada
        stmt = select(Stay).where(
            Stay.status == StayStatus.PAYMENT_PENDING,
            Stay.mp_payment_id.is_(None),
            Stay.fecha_pendiente <= corte,  # type: ignore[arg-type]
        )
        estadias = db.execute(stmt).scalars().all()

        if estadias:
            for estadia in estadias:
                estadia.status = StayStatus.CANCELLED
                # Registrar un Payment REJECTED para trazabilidad
                db.add(Payment(
                    stay_id=estadia.id,
                    method=PaymentMethod.MERCADOPAGO,
                    amount=estadia.amount_expected or 0.0,
                    status=PaymentStatus.REJECTED,
                    processed_at=datetime.now(timezone.utc),
                    external_reference=f"TIMEOUT-{estadia.id[:8].upper()}",
                ))
            db.commit()
            logger.info("[CRON] Canceladas %d estadías por timeout de pago MP.", len(estadias))
    except Exception:
        logger.exception("[CRON] Error al cancelar estadías por timeout.")
        db.rollback()
    finally:
        db.close()
