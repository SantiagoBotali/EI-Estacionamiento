import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
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
