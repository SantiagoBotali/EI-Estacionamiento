import asyncio
import logging
from typing import Optional

import cv2
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import (
    CashClosingOpen,
    CashClosingClose,
    CashClosingOut,
    StayCreate,
    StayCreateResponse,
    StayLookupRequest,
    StayLookupResponse,
    StayOut,
    TariffSettings,
    TicketOut,
    TodaySummary,
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

# ─── Cash Closing API ──────────────────────────────────────────────────────

@router.post("/cash-closings", response_model=CashClosingOut, status_code=201)
async def open_cash_closing(
    payload: CashClosingOpen,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import open_cash_closing as svc_open
    closing = svc_open(
        db, payload.shift, payload.initial_cash, current_user.id,
        force_demo=payload.force_demo, is_demo=payload.is_demo,
    )
    return CashClosingOut.model_validate(closing)


@router.get("/cash-closings/summary/today", response_model=TodaySummary)
async def today_summary(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import get_today_summary
    summary_data = get_today_summary(db)
    return TodaySummary(
        date=summary_data["date"],
        current_shift=summary_data["current_shift"],
        closings=[CashClosingOut.model_validate(c) for c in summary_data["closings"]],
        total_expected=summary_data["total_expected"],
        total_actual=summary_data["total_actual"],
        total_remesa=summary_data["total_remesa"],
        total_difference=summary_data["total_difference"],
        open_closing=CashClosingOut.model_validate(summary_data["open_closing"]) if summary_data["open_closing"] else None,
        fondo_fijo=summary_data["fondo_fijo"],
    )


@router.delete("/cash-closings/reset-today")
async def reset_today_closings(
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import reset_today_closings as svc_reset
    deleted = svc_reset(db)
    return {"deleted": deleted, "message": f"Eliminados {deleted} cierre(s) de hoy"}


@router.get("/cash-closings/{shift}/suggested-initial")
async def get_suggested_initial(
    shift: int,
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import get_next_shift_initial_cash
    from datetime import datetime, timezone, timedelta
    today_ars = (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%Y-%m-%d")
    suggested = get_next_shift_initial_cash(db, today_ars, shift)
    return {"suggested_initial_cash": suggested}


@router.get("/cash-closings", response_model=list[CashClosingOut])
async def list_cash_closings(
    date: Optional[str] = None,
    _: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import list_closings
    closings = list_closings(db, date)
    return [CashClosingOut.model_validate(c) for c in closings]


@router.patch("/cash-closings/{closing_id}/close", response_model=CashClosingOut)
async def close_cash_closing(
    closing_id: str,
    payload: CashClosingClose,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    from app.services.cash_closing_service import close_cash_closing as svc_close
    closing = svc_close(db, closing_id, payload.actual_cash, payload.notes, current_user.id)
    return CashClosingOut.model_validate(closing)


@router.patch("/cash-closings/{closing_id}/quick-close", response_model=CashClosingOut)
async def quick_close_demo(
    closing_id: str,
    current_user: User = Depends(require_employee),
    db: Session = Depends(get_db),
):
    """Close a demo closing with actual_cash = initial_cash + expected_cash (zero difference)."""
    from sqlalchemy import select as sa_select
    from app.models import CashClosing
    from app.services.cash_closing_service import close_cash_closing as svc_close, calculate_expected_cash
    closing = db.execute(sa_select(CashClosing).where(CashClosing.id == closing_id)).scalar_one_or_none()
    if not closing or not closing.is_demo:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Quick close only available for demo closings")
    expected = calculate_expected_cash(db, closing.date, closing.shift)
    actual = closing.initial_cash + expected
    result = svc_close(db, closing_id, actual, "Cierre rápido de simulación", current_user.id)
    return CashClosingOut.model_validate(result)

