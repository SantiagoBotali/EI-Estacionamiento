import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker, DeclarativeBase
from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_setting(db: Session, key: str, default: str = "") -> str:
    """Read a SystemSetting value from the DB, or return default."""
    from app.models import SystemSetting
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
    return row.value if row else default


def init_db():
    """Create all tables and apply lightweight migrations."""
    from app import models  # noqa: F401 — ensure models are registered
    Base.metadata.create_all(bind=engine)
    _migrate()


def _migrate():
    """Add new columns to existing tables without dropping data (SQLite safe)."""
    from sqlalchemy import text
    additions = [
        ("stays", "slot_vision_id", "INTEGER"),
    ]
    with engine.connect() as conn:
        for table, column, col_type in additions:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                conn.commit()


def seed_db():
    """Seed default users, settings, and synthetic historical data."""
    from app.models import User, UserRole, SystemSetting, Stay
    from app.security import get_password_hash

    db = SessionLocal()
    try:
        # ── Users ──────────────────────────────────────────────────────────────
        existing_user = db.execute(select(User)).scalars().first()
        if not existing_user:
            users = [
                User(
                    username="admin",
                    hashed_password=get_password_hash("admin123"),
                    role=UserRole.ADMIN,
                    is_active=True,
                ),
                User(
                    username="empleado",
                    hashed_password=get_password_hash("emp123"),
                    role=UserRole.EMPLOYEE,
                    is_active=True,
                ),
            ]
            db.add_all(users)
            db.commit()

        # ── Default settings ──────────────────────────────────────────────────
        defaults = {
            "rate_per_hour": "1200.0",
            "minimum_charge": "300.0",
            "grace_period_minutes": "15",
        }
        for key, value in defaults.items():
            existing = db.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            ).scalar_one_or_none()
            if not existing:
                db.add(SystemSetting(key=key, value=value))
        db.commit()

        # ── Synthetic historical stays ─────────────────────────────────────────
        existing_stay = db.execute(select(Stay)).scalars().first()
        if not existing_stay:
            _seed_synthetic_stays(db)
    finally:
        db.close()


def _seed_synthetic_stays(db: Session):
    """Create ~80 closed stays over the last 30 days + 5 active stays today."""
    from app.models import Stay, Ticket, Payment, StayStatus, PaymentMethod, PaymentStatus
    from app.services.tariff import calculate_price

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Hourly weights — peaks at 9-11h and 17-19h
    weights = [
        0.3, 0.2, 0.1, 0.1, 0.1, 0.2,   # 0-5
        0.5, 1.0, 1.5, 2.5, 2.5, 2.0,   # 6-11
        1.8, 1.5, 1.2, 1.0, 0.8, 2.5,   # 12-17
        2.5, 1.5, 1.2, 1.0, 0.7, 0.5,   # 18-23
    ]

    rate = 1200.0

    # 80 closed stays spread over last 30 days
    for _ in range(80):
        days_ago = random.randint(0, 29)
        day = today_start - timedelta(days=days_ago)
        hour = random.choices(range(24), weights=weights)[0]
        minute = random.randint(0, 59)
        entry_at = day.replace(hour=hour, minute=minute)

        duration_minutes = random.randint(20, 180)
        exit_at = entry_at + timedelta(minutes=duration_minutes)

        amount = calculate_price(entry_at, exit_at, rate_per_hour=rate)
        method = PaymentMethod.CASH if random.random() < 0.8 else PaymentMethod.SIMULATED

        stay = Stay(
            id=str(uuid.uuid4()),
            entry_at=entry_at,
            exit_at=exit_at,
            status=StayStatus.CLOSED,
            amount_expected=amount,
            amount_paid=amount,
            payment_method=method,
        )
        db.add(stay)
        db.flush()

        ticket_code = _gen_ticket_code(db, entry_at)
        barcode_value = str(uuid.uuid4())
        db.add(Ticket(
            id=str(uuid.uuid4()),
            stay_id=stay.id,
            ticket_code=ticket_code,
            barcode_value=barcode_value,
        ))

        db.add(Payment(
            id=str(uuid.uuid4()),
            stay_id=stay.id,
            method=method,
            amount=amount,
            status=PaymentStatus.APPROVED,
            processed_at=exit_at,
        ))

    # 5 active stays — entry_at is between 20 min and 4 h ago, never before today_start
    for _ in range(5):
        minutes_ago = random.randint(20, 240)
        entry_at = max(now - timedelta(minutes=minutes_ago), today_start)

        stay = Stay(
            id=str(uuid.uuid4()),
            entry_at=entry_at,
            status=StayStatus.ACTIVE,
        )
        db.add(stay)
        db.flush()

        ticket_code = _gen_ticket_code(db, entry_at)
        barcode_value = str(uuid.uuid4())
        db.add(Ticket(
            id=str(uuid.uuid4()),
            stay_id=stay.id,
            ticket_code=ticket_code,
            barcode_value=barcode_value,
        ))

    db.commit()


def _gen_ticket_code(db: Session, dt: datetime) -> str:
    """Generate a unique ticket code EST-YYYYMMDD-NNNN for a given date."""
    from sqlalchemy import func
    from app.models import Ticket
    date_str = dt.strftime("%Y%m%d")
    pattern = f"EST-{date_str}-%"
    count = db.execute(
        select(func.count()).where(Ticket.ticket_code.like(pattern))
    ).scalar() or 0
    return f"EST-{date_str}-{count + 1:04d}"
