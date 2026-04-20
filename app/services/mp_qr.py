"""
app/services/mp_qr.py — MercadoPago QR Punto de Venta API.

Uses the /instore/orders/qr/ API which produces a qr_data string (EMV format)
that the MercadoPago app recognises natively — opens the in-app payment flow
when scanned, no browser redirect.
"""
import logging

import requests
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

MP_API = "https://api.mercadopago.com"
EXTERNAL_POS_ID = "SDGPOS01"   # must be alphanumeric only


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.mp_access_token}",
        "Content-Type": "application/json",
    }


# ─── Seller setup (cached in DB) ─────────────────────────────────────────────

def get_mp_user_id(db: Session) -> str:
    """Return the seller's MP user ID, fetching and caching it if needed."""
    from app.database import get_setting, set_setting

    uid = get_setting(db, "mp_user_id", "")
    if uid:
        return uid

    r = requests.get(f"{MP_API}/users/me", headers=_headers(), timeout=10)
    r.raise_for_status()
    uid = str(r.json()["id"])
    set_setting(db, "mp_user_id", uid)
    logger.info("MP user_id fetched and cached: %s", uid)
    return uid


def _get_or_create_store(db: Session, user_id: str) -> int:
    """Return the numeric MP store ID, creating the store if needed."""
    from app.database import get_setting, set_setting

    store_id = get_setting(db, "mp_store_id", "")
    if store_id:
        return int(store_id)

    # city_name must match MP's accepted list; "Buenos Aires" is always valid
    payload = {
        "name": "Estacionamiento SDG+",
        "external_id": "SDGSTORE01",
        "location": {
            "street_name": "Av. Corrientes",
            "street_number": "1234",
            "city_name": "Buenos Aires",
            "state_name": "Buenos Aires",
            "zip_code": "1043",
            "latitude": -34.6037,
            "longitude": -58.3816,
        },
    }
    r = requests.post(
        f"{MP_API}/users/{user_id}/stores",
        json=payload,
        headers=_headers(),
        timeout=10,
    )
    if not r.ok:
        logger.error(
            "MP store creation failed %s — response: %s",
            r.status_code, r.text,
        )
        r.raise_for_status()
    sid = r.json()["id"]
    set_setting(db, "mp_store_id", str(sid))
    logger.info("MP store created: id=%s", sid)
    return sid


def get_or_create_pos(db: Session) -> tuple[str, str]:
    """
    Ensure a POS exists for the seller.
    Returns (user_id, external_pos_id).
    """
    from app.database import get_setting, set_setting

    user_id = get_mp_user_id(db)

    # Check cache
    if get_setting(db, "mp_pos_ready", "") == "1":
        return user_id, EXTERNAL_POS_ID

    # Check if POS already exists
    r = requests.get(f"{MP_API}/pos", headers=_headers(), timeout=10)
    if r.ok:
        for pos in r.json().get("results", []):
            if pos.get("external_id") == EXTERNAL_POS_ID:
                set_setting(db, "mp_pos_ready", "1")
                logger.info("MP POS already exists: %s", EXTERNAL_POS_ID)
                return user_id, EXTERNAL_POS_ID

    # Create store then POS
    store_id = _get_or_create_store(db, user_id)

    payload = {
        "name": "Caja SDG+ 1",
        "external_id": EXTERNAL_POS_ID,
        "store_id": store_id,
        "fixed_amount": False,
    }
    r = requests.post(f"{MP_API}/pos", json=payload, headers=_headers(), timeout=10)
    if r.ok:
        set_setting(db, "mp_pos_ready", "1")
        logger.info("MP POS created: %s", r.json().get("id"))
    else:
        logger.error("MP POS creation failed %s — response: %s", r.status_code, r.text)
        raise RuntimeError(f"No se pudo crear el POS en MP ({r.status_code}): {r.text}")

    return user_id, EXTERNAL_POS_ID


# ─── QR order lifecycle ───────────────────────────────────────────────────────

def create_qr_order(
    db: Session,
    stay_id: str,
    amount: float,
    ticket_code: str,
) -> dict:
    """
    PUT a QR order on the POS. Returns the MP response which includes:
        - qr_data: str   ← EMV QR format, encode as QR image
        - in_store_order_id: str

    When a buyer scans qr_data with the MercadoPago app it opens the
    native in-app payment flow without a browser redirect.
    """
    user_id, external_pos_id = get_or_create_pos(db)
    base_url = settings.mp_base_url.rstrip("/")
    unit_price = round(float(amount), 2)

    payload = {
        "external_reference": stay_id,
        "title": "Estacionamiento SDG+",
        "description": f"Ticket {ticket_code}",
        "notification_url": f"{base_url}/api/payments/mercadopago/webhook",
        "total_amount": unit_price,
        "items": [
            {
                "title": "Tiempo de estacionamiento",
                "unit_price": unit_price,
                "quantity": 1,
                "unit_measure": "unit",
                "total_amount": unit_price,
            }
        ],
        "cash_out": {"amount": 0},
    }

    url = (
        f"{MP_API}/instore/orders/qr/seller/collectors"
        f"/{user_id}/pos/{external_pos_id}/qrs"
    )
    r = requests.put(url, json=payload, headers=_headers(), timeout=15)

    if not r.ok:
        logger.error(
            "QR order creation failed %s — body: %s",
            r.status_code, r.text,
        )
        raise RuntimeError(f"MP QR order failed ({r.status_code}): {r.text}")

    data = r.json()
    logger.info(
        "QR order created for stay %s — in_store_order_id=%s",
        stay_id, data.get("in_store_order_id"),
    )
    return data  # {"qr_data": "...", "in_store_order_id": "..."}


def delete_qr_order(db: Session) -> None:
    """Clear the active QR order from the POS (call after payment or cancellation)."""
    try:
        user_id, external_pos_id = get_or_create_pos(db)
        url = (
            f"{MP_API}/instore/orders/qr/seller/collectors"
            f"/{user_id}/pos/{external_pos_id}/qrs"
        )
        r = requests.delete(url, headers=_headers(), timeout=10)
        logger.info("QR order deleted from POS: HTTP %s", r.status_code)
    except Exception as exc:
        logger.warning("Could not delete QR order: %s", exc)
