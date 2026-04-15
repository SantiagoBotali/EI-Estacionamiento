from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        protected_namespaces=(),
    )

    # App
    app_title: str = "Sistema de Estacionamiento Inteligente"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    database_url: str = f"sqlite:///{BASE_DIR}/parking.db"

    # Security
    secret_key: str = "changeme-super-secret-key-for-jwt-signing"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours

    # Vision
    video_path: str = str(BASE_DIR / "Media" / "parking_crop_loop.mp4")
    mask_path: str = str(BASE_DIR / "Media" / "mask_crop.png")
    model_path: str = str(BASE_DIR / "model.p")
    detector_step: int = 30  # process every N frames

    # Tariff
    grace_period_minutes: int = 15
    rate_per_hour: float = 800.0  # ARS
    minimum_charge: float = 300.0  # ARS after grace period

    # Media
    car_icon_path: str = "Media/car.png"

    # ── MercadoPago ───────────────────────────────────────────────────────────
    # Access Token de producción/sandbox (panel de MP → Credenciales)
    mp_access_token: str = ""

    # Clave secreta generada al registrar el Webhook en el panel de MP
    mp_webhook_secret: str = ""

    # URL HTTPS pública del backend donde MP envía notificaciones.
    # En desarrollo: usar ngrok → ej. https://abc123.ngrok.io/api/payments/mp/webhook
    mp_url_backend: str = ""

    # URL a la que MP redirige al usuario tras un pago APROBADO.
    # El backend concatena /{stay_id} al final.
    mp_url_frontend_success: str = "http://localhost:5173/pago/exito"

    # URL a la que MP redirige si el pago FALLA o está PENDIENTE.
    mp_url_frontend_failure: str = "http://localhost:5173/pago/error"

    # Minutos antes de que el cron cancele estadías PAYMENT_PENDING sin pago.
    mp_time: int = 30


settings = Settings()
