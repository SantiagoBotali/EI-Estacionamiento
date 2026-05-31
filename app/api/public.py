import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import StayStatus
from app.services import stay_manager
from app.services.vision_adapter import VisionAdapter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["public"])
templates = Jinja2Templates(directory="templates")


@router.get("/", response_class=HTMLResponse)
async def public_map(request: Request):
    return templates.TemplateResponse("public/map.html", {"request": request})


@router.get("/kiosk", response_class=HTMLResponse)
async def kiosk_page(request: Request):
    return templates.TemplateResponse("public/kiosk.html", {"request": request})


@router.post("/api/public/entry")
async def public_entry(db: Session = Depends(get_db)):
    stay, ticket, barcode_svg = stay_manager.create_stay(db, created_by_id=None)
    return {
        "ticket_code": ticket.ticket_code,
        "entry_at": stay.entry_at.isoformat(),
        "barcode_svg": barcode_svg,
    }


@router.get("/api/public/parking/state")
async def parking_state():
    adapter = VisionAdapter.get_instance()
    state = adapter.get_state()
    return state


async def _sse_generator(request: Request) -> AsyncGenerator[str, None]:
    adapter = VisionAdapter.get_instance()
    while True:
        if await request.is_disconnected():
            break
        try:
            state = adapter.get_state()
            payload = {
                "spots": state["spots"],
                "free": state["free"],
                "total": state["total"],
                "occupancy_rate": state["occupancy_rate"],
                "last_updated": state["last_updated"],
            }
            yield f"data: {json.dumps(payload)}\n\n"
        except Exception as e:
            logger.error("SSE error: %s", e)
        await asyncio.sleep(1)


# ─── Exit kiosk endpoints ────────────────────────────────────────────────────

class ExitLookupRequest(BaseModel):
    query: str


class ExitPayRequest(BaseModel):
    stay_id: str


@router.post("/api/public/exit/lookup")
async def exit_lookup(body: ExitLookupRequest, db: Session = Depends(get_db)):
    stay, ticket, amount = stay_manager.lookup_stay(db, body.query)
    if stay.status not in (StayStatus.ACTIVE, StayStatus.PAYMENT_PENDING):
        detail_map = {
            StayStatus.CLOSED: "La estadía ya fue pagada y cerrada",
            StayStatus.CANCELLED: "La estadía está cancelada",
        }
        raise HTTPException(
            status_code=409,
            detail=detail_map.get(stay.status, f"Estado inválido: {stay.status}"),
        )
    return {
        "stay_id": stay.id,
        "ticket_code": ticket.ticket_code,
        "entry_at": stay.entry_at.isoformat(),
        "status": stay.status,
        "amount": amount,
    }


@router.post("/api/public/exit/pay/cash")
async def exit_pay_cash(body: ExitPayRequest, db: Session = Depends(get_db)):
    stay = stay_manager.close_cash(db, body.stay_id)
    return {
        "stay_id": stay.id,
        "amount_paid": float(stay.amount_paid or 0),
        "payment_method": "CASH",
        "exit_at": stay.exit_at.isoformat(),
    }


@router.post("/api/public/exit/pay/cash/request")
async def exit_pay_cash_request(body: ExitPayRequest, db: Session = Depends(get_db)):
    stay = stay_manager.request_cash(db, body.stay_id)
    return {
        "stay_id": stay.id,
        "status": stay.status,
    }


@router.post("/api/public/exit/pay/simulate")
async def exit_pay_simulate(body: ExitPayRequest, db: Session = Depends(get_db)):
    from app.services.payment_service import simulate_payment
    payment, stay = simulate_payment(db, body.stay_id)
    return {
        "stay_id": stay.id,
        "amount_paid": float(payment.amount or 0),
        "payment_method": "SIMULATED",
        "exit_at": stay.exit_at.isoformat(),
    }


@router.post("/api/public/exit/mp/create")
async def exit_mp_create(body: ExitPayRequest, db: Session = Depends(get_db)):
    """Create a MercadoPago preference and return the checkout URL + amount."""
    from app.services.payment_service import create_mp_preference
    result = create_mp_preference(db, body.stay_id)
    return result


@router.get("/api/public/exit/mp/status/{stay_id}")
async def exit_mp_status(stay_id: str, db: Session = Depends(get_db)):
    """Poll MercadoPago to check if a payment was approved for this stay."""
    from app.services.payment_service import check_mp_payment
    result = check_mp_payment(db, stay_id)
    return result


@router.get("/api/public/parking/stream")
async def parking_stream(request: Request):
    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream",
    }
    return StreamingResponse(
        _sse_generator(request),
        media_type="text/event-stream",
        headers=headers,
    )
