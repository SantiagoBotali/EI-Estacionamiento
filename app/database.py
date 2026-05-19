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


def set_setting(db: Session, key: str, value: str) -> None:
    """Upsert a SystemSetting value in the DB."""
    from app.models import SystemSetting
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
    db.commit()


def init_db():
    """Create all tables and apply lightweight migrations."""
    from app import models  # noqa: F401 — ensure models are registered
    Base.metadata.create_all(bind=engine)
    _migrate()


def _migrate():
    """Add new columns to existing tables without dropping data (SQLite safe)."""
    from sqlalchemy import text, inspect
    additions = [
        ("stays", "slot_vision_id", "INTEGER"),
        ("cash_closings", "remesa", "REAL"),
        ("cash_closings", "is_demo", "INTEGER DEFAULT 0"),
    ]
    with engine.connect() as conn:
        for table, column, col_type in additions:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                conn.commit()

        # Create cash_closings table if it doesn't exist (for existing DBs)
        inspector = inspect(engine)
        if "cash_closings" not in inspector.get_table_names():
            from app.models import CashClosing
            CashClosing.__table__.create(bind=engine)


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
            "fondo_fijo": "5000.0",
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
    """
    Generate closed stays from January 2024 to today.

    Per-month targets:
    - Base of 60+ stays with natural month-to-month variation (±30%)
    - Payment split varies each month: randomly between 40-90% cash, rest MercadoPago
    - Duration: 20–240 min, weighted toward 30–90 min
    - Entry hour: weighted toward morning (9-12) and afternoon (16-19)

    Also creates 5 active stays for the current day.
    """
    from app.models import Stay, Ticket, Payment, StayStatus, PaymentMethod, PaymentStatus
    from app.services.tariff import calculate_price

    now_utc = datetime.now(timezone.utc)

    # ── Hourly weight for entry time (peaks at 9-11h and 16-18h) ─────────────
    hour_weights = [
        0.2, 0.1, 0.1, 0.1, 0.1, 0.2,   # 0-5
        0.5, 0.9, 1.4, 2.5, 2.8, 2.2,   # 6-11
        1.6, 1.3, 1.0, 0.9, 2.6, 2.8,   # 12-17
        2.2, 1.4, 1.0, 0.7, 0.5, 0.3,   # 18-23
    ]

    # Duration distribution (minutes) — most stays between 30-90 min
    def rand_duration() -> int:
        bucket = random.choices(
            [0, 1, 2, 3],
            weights=[15, 40, 30, 15]
        )[0]
        if bucket == 0: return random.randint(15, 30)    # short (15-30 min)
        if bucket == 1: return random.randint(30, 90)    # medium (30-90 min)
        if bucket == 2: return random.randint(90, 180)   # long (90-180 min)
        return random.randint(180, 300)                  # very long (3-5 h)

    rate = 1200.0
    minimum = 300.0
    grace = 15

    # ── Iterate months from 2024-01 to current month ──────────────────────────
    seed_start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    current_month_start = now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    cursor = seed_start
    while cursor <= current_month_start:
        year  = cursor.year
        month = cursor.month

        # How many days in this month?
        if month == 12:
            next_month = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            next_month = datetime(year, month + 1, 1, tzinfo=timezone.utc)

        # For the current (incomplete) month, limit to yesterday
        month_end = min(next_month, now_utc.replace(hour=0, minute=0, second=0, microsecond=0))
        days_available = max(1, (month_end - cursor).days)

        # Natural variation: 60-100 stays/month base, scaled by available days
        scale = min(1.0, days_available / 28.0)
        base_count = random.randint(60, 100)
        count = max(10, round(base_count * scale))

        # Per-month cash ratio varies naturally (40-90%)
        cash_ratio = random.uniform(0.40, 0.90)

        for _ in range(count):
            # Random day within [cursor, month_end)
            day_offset = random.randint(0, days_available - 1)
            day_start  = cursor + timedelta(days=day_offset)

            hour   = random.choices(range(24), weights=hour_weights)[0]
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            entry_at = day_start.replace(hour=hour, minute=minute, second=second)

            # Clamp: never in the future
            if entry_at >= now_utc:
                continue

            duration = rand_duration()
            exit_at  = entry_at + timedelta(minutes=duration)
            if exit_at >= now_utc:
                exit_at = now_utc - timedelta(minutes=1)
            if exit_at <= entry_at:
                continue

            amount = calculate_price(
                entry_at, exit_at,
                rate_per_hour=rate, minimum_charge=minimum, grace_period_minutes=grace,
            )
            method = PaymentMethod.CASH if random.random() < cash_ratio else PaymentMethod.MERCADOPAGO

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

            ticket_code   = _gen_ticket_code(db, entry_at)
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

        # Advance to next month
        cursor = next_month

    # ── 5 active stays today ──────────────────────────────────────────────────
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    for _ in range(5):
        minutes_ago = random.randint(20, 180)
        entry_at    = max(now_utc - timedelta(minutes=minutes_ago), today_start)

        stay = Stay(
            id=str(uuid.uuid4()),
            entry_at=entry_at,
            status=StayStatus.ACTIVE,
        )
        db.add(stay)
        db.flush()

        ticket_code   = _gen_ticket_code(db, entry_at)
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
