import asyncio
import logging

import cv2
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import (
    CashClosingPreview,
    CashClosingCreate,
    CashClosingOut,
    StayCreate,
    StayCreateResponse,
    StayLookupRequest,
    StayLookupResponse,
    StayOut,
    TariffSettings,
    TicketOut,
)
from app.security import require_employee
from app.services import stay_manager
from app.services.vision_adapter import VisionAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/employee", tags=["employee"])
templates = Jinja2Templates(directory="templates")


# ─── HTML Pages ──────────────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse, include_in_schema=False)
async def employee_login_page(request: Request):
    return templates.TemplateResponse("employee/login.html", {"request": request})


@router.get("/panel", response_class=HTMLResponse, include_in_schema=False)
async def employee_panel_page(request: Request):
    return templates.TemplateResponse("employee/panel.html", {"request": request})


# ─── Camera MJPEG Stream ─────────────────────────────────────────────────────

async def _mjpeg_generator(request: Request):
    adapter = VisionAdapter.get_instance()
    loop = asyncio.get_event_loop()

    while True:
        if await request.is_disconnected():
            break

        frame = await loop.run_in_executor(None, adapter.get_latest_frame)

        if frame is None:
            await asyncio.sleep(0.1)
            continue

        success, jpeg = await loop.run_in_executor(
            None, lambda: cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        )

        if not success:
            await asyncio.sleep(0.1)
            continue

        data = jpeg.tobytes()
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + data + b"\r\n"
        )
        await asyncio.sleep(0.1)  # ~10 fps


@router.get("/camera/feed")
async def camera_feed(
    request: Request,
    _: User = Depends(require_employee),
):
    return StreamingResponse(
        _mjpeg_generator(request),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache"},
    )


# ─── Tariff (read-only, for client-side amount preview) ──────────────────────

@router.get("/tariff", response_model=TariffSettings)
async def get_tariff(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.database import get_setting
    return TariffSettings(
        rate_per_hour=float(get_setting(db, "rate_per_hour", "1200.0")),
        minimum_charge=float(get_setting(db, "minimum_charge", "300.0")),
        grace_period_minutes=int(get_setting(db, "grace_period_minutes", "15")),
    )


# ─── Stay API ─────────────────────────────────────────────────────────────────

@router.post("/stays/create", response_model=StayCreateResponse)
async def create_stay(
    payload: StayCreate,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    stay, ticket, barcode_svg = stay_manager.create_stay(
        db=db,
        created_by_id=current_user.id,
        notes=payload.notes,
    )
    return StayCreateResponse(
        stay=StayOut.model_validate(stay),
        ticket=TicketOut.model_validate(ticket),
        barcode_svg=barcode_svg,
    )


@router.post("/stays/lookup", response_model=StayLookupResponse)
async def lookup_stay(
    payload: StayLookupRequest,
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    stay, ticket, amount = stay_manager.lookup_stay(db, payload.query)
    return StayLookupResponse(
        stay=StayOut.model_validate(stay),
        ticket=TicketOut.model_validate(ticket),
        amount_expected=amount,
    )


@router.post("/stays/{stay_id}/close-cash", response_model=StayOut)
async def close_cash(
    stay_id: str,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    stay = stay_manager.close_cash(db, stay_id, current_user.id)
    return StayOut.model_validate(stay)


TOTAL_SPOTS = 14  # matches the parking mask


@router.post("/demo/generate-today")
async def generate_today_stays(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    adapter = VisionAdapter.get_instance()
    state = adapter.get_state()

    occupied_ids = [s["id"] for s in state["spots"] if not s["empty"]]
    occupied_count = len(occupied_ids)
    total = state.get("total", TOTAL_SPOTS)

    if total == 0:
        raise HTTPException(status_code=400, detail="No se detectan lugares en el mapa.")

    new_stays = stay_manager.generate_today_active_stays(db, occupied_ids)

    return {
        "generated": len(new_stays),
        "occupied_spots": occupied_count,
        "total_spots": total,
        "spot_ids": occupied_ids,
    }


@router.get("/stays/active")
async def active_stays(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    stays = stay_manager.get_active_stays(db)
    return [StayOut.model_validate(s) for s in stays]


# ─── Cash Closing API ─────────────────────────────────────────────────────────

@router.get("/cash-closings/preview", response_model=CashClosingPreview)
async def preview_cash_closing(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    """Calcula los totales del período sin guardar el cierre."""
    from app.services.cash_closing_service import get_closing_preview
    return get_closing_preview(db)


@router.post("/cash-closings", response_model=CashClosingOut, status_code=201)
async def create_cash_closing(
    payload: CashClosingCreate,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    """Crea un cierre de caja atómico."""
    from app.services.cash_closing_service import create_closing
    closing = create_closing(
        db, payload.employee_name, payload.actual_cash, payload.notes, current_user.id
    )
    return CashClosingOut.model_validate(closing)


@router.get("/cash-closings", response_model=list[CashClosingOut])
async def list_cash_closings(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    """Lista todos los cierres, más reciente primero."""
    from app.services.cash_closing_service import list_closings
    closings = list_closings(db)
    return [CashClosingOut.model_validate(c) for c in closings]

