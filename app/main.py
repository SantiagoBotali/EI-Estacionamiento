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

    # ── APScheduler: cron de cancelación de estadías PAYMENT_PENDING ─────────
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.database import SessionLocal
    from app.services.mercadopago_service import cancelar_estadias_timeout

    scheduler = BackgroundScheduler(timezone="UTC", job_defaults={"misfire_grace_time": 60})
    scheduler.add_job(
        cancelar_estadias_timeout,
        trigger="interval",
        minutes=5,
        id="mp_timeout_cron",
        args=[SessionLocal],
    )
    scheduler.start()
    app.state.scheduler = scheduler
    logger.info("APScheduler started — MP timeout cron running every 5 min.")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Stopping vision detector...")
    if hasattr(app.state, "detector"):
        app.state.detector.stop()

    logger.info("Stopping APScheduler...")
    if hasattr(app.state, "scheduler"):
        app.state.scheduler.shutdown(wait=False)

    logger.info("Shutdown complete.")


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
