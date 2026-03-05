import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db, seed_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info("Initializing database...")
    init_db()
    seed_db()
    logger.info("Database ready.")

    logger.info("Starting vision detector...")
    from vision.detector import ParkingDetector
    detector = ParkingDetector()
    detector.start()
    app.state.detector = detector
    logger.info("Vision detector started.")

    import asyncio
    sync_task = asyncio.create_task(_demo_sync_loop())
    app.state.sync_task = sync_task

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    if hasattr(app.state, "sync_task"):
        app.state.sync_task.cancel()
    logger.info("Stopping vision detector...")
    if hasattr(app.state, "detector"):
        app.state.detector.stop()
    logger.info("Shutdown complete.")


async def _demo_sync_loop() -> None:
    """
    Background task that runs every second.
    When DemoSync is enabled, detects spot occupancy changes and
    auto-creates or closes stays to keep a 1-to-1 mapping.
    """
    import asyncio
    from app.services.demo_sync import DemoSyncService
    from app.services.vision_adapter import VisionAdapter
    from app.services import stay_manager
    from app.database import SessionLocal

    sync = DemoSyncService.get_instance()

    def _get_overrides() -> dict[int, bool]:
        try:
            from app.models import ParkingSlot
            from sqlalchemy import select as sa_select
            db = SessionLocal()
            try:
                slots = db.execute(
                    sa_select(ParkingSlot).where(ParkingSlot.demo_override == True)  # noqa: E712
                ).scalars().all()
                return {s.vision_id: True for s in slots}
            finally:
                db.close()
        except Exception:
            return {}

    def _handle_changes(changes: list[tuple[int, bool]]) -> None:
        if not changes:
            return
        db = SessionLocal()
        try:
            for vision_id, became_occupied in changes:
                if became_occupied:
                    result = stay_manager.create_stay_for_spot(db, vision_id)
                    if result:
                        logger.info("DemoSync: spot %d occupied → stay created.", vision_id)
                # Spot freed: no auto-close — payment is handled manually via ticket scan or cash
        except Exception as e:
            logger.error("DemoSync DB error: %s", e)
        finally:
            db.close()

    adapter = VisionAdapter.get_instance()

    while True:
        try:
            await asyncio.sleep(1)
            if not sync.enabled:
                continue
            state = adapter.get_state(_get_overrides())
            current = {s["id"]: not s["empty"] for s in state["spots"]}
            changes = sync.compute_changes(current)
            if changes:
                await asyncio.to_thread(_handle_changes, changes)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("DemoSync loop error: %s", e)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Static files (CSS, images)
    app.mount("/static", StaticFiles(directory="static"), name="static")
    # Serve Media folder for car.png etc.
    app.mount("/Media", StaticFiles(directory="Media"), name="media")

    # ── Routers ──────────────────────────────────────────────────────────────
    from app.api.auth import router as auth_router
    from app.api.public import router as public_router
    from app.api.employee import router as employee_router
    from app.api.admin import router as admin_router
    from app.api.payments import router as payments_router
    from app.api.camera import router as camera_router

    app.include_router(auth_router)
    app.include_router(public_router)
    app.include_router(employee_router)
    app.include_router(admin_router)
    app.include_router(payments_router)
    app.include_router(camera_router)

    # ── Redirect shortcuts ────────────────────────────────────────────────────
    from fastapi.responses import RedirectResponse

    @app.get("/employee/login", include_in_schema=False)
    async def employee_login_redirect():
        return RedirectResponse(url="/api/employee/login")

    @app.get("/employee/panel", include_in_schema=False)
    async def employee_panel_redirect():
        return RedirectResponse(url="/api/employee/panel")

    @app.get("/admin/login", include_in_schema=False)
    async def admin_login_redirect():
        return RedirectResponse(url="/api/admin/login")

    @app.get("/admin/dashboard", include_in_schema=False)
    async def admin_dashboard_redirect():
        return RedirectResponse(url="/api/admin/dashboard")

    # ── React SPA (new interface at /react/*) ─────────────────────────────────
    _REACT_DIST = "frontend/dist"

    if os.path.exists(_REACT_DIST):
        # Serve compiled assets (JS/CSS chunks)
        app.mount(
            "/react/assets",
            StaticFiles(directory=f"{_REACT_DIST}/assets"),
            name="react-assets",
        )

        @app.get("/react", include_in_schema=False)
        async def react_root():
            return FileResponse(f"{_REACT_DIST}/index.html")

        @app.get("/react/{path:path}", include_in_schema=False)
        async def react_spa(path: str):  # noqa: ARG001
            return FileResponse(f"{_REACT_DIST}/index.html")
    else:
        logger.warning(
            "React build not found at '%s'. "
            "Run: cd frontend && npm install && npm run build",
            _REACT_DIST,
        )

    return app


app = create_app()
