"""
app/api/camera.py — Shared MJPEG camera feed endpoint.

Uses a query-param token so it works from <img src="...?token=xxx"> tags
(browser img/video elements can't send Authorization headers).
Accepted by EMPLOYEE or ADMIN roles.
"""
import asyncio
import logging

import cv2
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt

from app.config import settings
from app.services.vision_adapter import VisionAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/camera", tags=["camera"])


def _validate_token(token: str) -> dict:
    """Validate a JWT token string and return payload. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        role = payload.get("role", "")
        if role not in ("EMPLOYEE", "ADMIN"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permisos")
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")


async def _mjpeg_generator(request: Request):
    adapter = VisionAdapter.get_instance()
    loop = asyncio.get_event_loop()

    while True:
        if await request.is_disconnected():
            break

        frame = await loop.run_in_executor(None, adapter.get_latest_frame)

        if frame is None:
            await asyncio.sleep(0.05)
            continue

        # Encode in executor so we don't block the event loop
        f = frame  # capture for lambda
        success, jpeg = await loop.run_in_executor(
            None, lambda: cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])
        )

        if not success:
            await asyncio.sleep(0.05)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + jpeg.tobytes() + b"\r\n"
        )

        # ~25 fps cap for the stream
        await asyncio.sleep(0.04)


@router.get("/feed")
async def camera_feed(
    request: Request,
    token: str = Query(..., description="JWT access token"),
):
    _validate_token(token)
    return StreamingResponse(
        _mjpeg_generator(request),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
