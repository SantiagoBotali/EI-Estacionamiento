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
        }
        for key, value in defaults.items():
            existing = db.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            ).scalar_one_or_none()
            if not existing:
                db.add(SystemSetting(key=key, value=value))
        db.commit()

        # ── Synthetic data ─────────────────────────────────────────────────────
        existing_stay = db.execute(select(Stay)).scalars().first()
        if not existing_stay:
            _seed_synthetic_stays(db)
        else:
            _top_up_synthetic_data(db)
    finally:
        db.close()


# Business timezone offset. Stays are stored as naive Argentina wall-clock time
# (see stay_manager / tariff), while payments and cash closings are stored in UTC.
ARS_OFFSET = timedelta(hours=3)


def _now_ars() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - ARS_OFFSET


def _seed_synthetic_stays(db: Session):
    """
    Generate closed stays from January 2024 up to now (today included, at
    random times before the current hour), one daily cash closing per past
    day and 5 active stays.
    """
    now_ars = _now_ars()
    _seed_closed_stays(db, datetime(2024, 1, 1), now_ars)
    db.flush()
    _seed_cash_closings(db)
    _seed_active_stays(db, now_ars)
    db.commit()


def _top_up_synthetic_data(db: Session):
    """
    On startup with an existing DB: fill the days since the last stay up to now
    (so "today" always has data) and the missing daily cash closings.
    """
    from sqlalchemy import func
    from app.models import Stay

    last_entry = db.execute(select(func.max(Stay.entry_at))).scalar()
    now_ars = _now_ars()
    today = now_ars.replace(hour=0, minute=0, second=0, microsecond=0)
    if last_entry is not None:
        last_day = last_entry.replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0)
        if last_day < today:
            _seed_closed_stays(db, last_day + timedelta(days=1), now_ars)
            db.flush()
    _seed_cash_closings(db)
    db.commit()


def _seed_closed_stays(db: Session, first_day: datetime, now_ars: datetime):
    """
    Generate closed + paid stays for every day from first_day to now_ars (naive ARS).

    Per-day targets:
    - Weekdays (Mon–Fri): 30–60 stays/day
    - Weekends (Sat–Sun): 15–35 stays/day
    - Payment split varies each month: randomly between 40-90% cash, rest MercadoPago
    - Duration: 15–300 min, weighted toward 30–90 min
    - Entry hour: weighted toward morning (9-12) and afternoon (16-19)
    Stays that would still be in progress at now_ars are skipped.
    """
    from app.models import Stay, Ticket, Payment, StayStatus, PaymentMethod, PaymentStatus
    from app.services.tariff import calculate_price

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

    # Tariff configured in the admin panel (Operaciones), stored in system_settings
    rate = float(get_setting(db, "rate_per_hour", "1200.0"))
    minimum = float(get_setting(db, "minimum_charge", "300.0"))
    grace = int(get_setting(db, "grace_period_minutes", "15"))

    # Cash ratio varies monthly (recalculated at the start of each new month)
    current_seed_month = None
    cash_ratio = 0.65

    day_cursor = first_day
    while day_cursor <= now_ars:
        if day_cursor.month != current_seed_month:
            current_seed_month = day_cursor.month
            cash_ratio = random.uniform(0.40, 0.90)

        weekday = day_cursor.weekday()  # 0=Monday, 6=Sunday
        count = random.randint(30, 60) if weekday < 5 else random.randint(15, 35)

        for _ in range(count):
            hour   = random.choices(range(24), weights=hour_weights)[0]
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            entry_at = day_cursor.replace(hour=hour, minute=minute, second=second)

            duration = rand_duration()
            exit_at  = entry_at + timedelta(minutes=duration)
            # Never in the future; stays still in progress are not seeded as closed
            if exit_at >= now_ars:
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

            db.add(Ticket(
                id=str(uuid.uuid4()),
                stay_id=stay.id,
                ticket_code=_gen_ticket_code(db, entry_at),
                barcode_value=str(uuid.uuid4()),
            ))
            db.add(Payment(
                id=str(uuid.uuid4()),
                stay_id=stay.id,
                method=method,
                amount=amount,
                status=PaymentStatus.APPROVED,
                processed_at=exit_at + ARS_OFFSET,  # payments are stored in UTC
            ))

        day_cursor += timedelta(days=1)


def _seed_active_stays(db: Session, now_ars: datetime, count: int = 5):
    """Create `count` ACTIVE stays that entered earlier today (naive ARS)."""
    from app.models import Stay, Ticket, StayStatus

    today_start = now_ars.replace(hour=0, minute=0, second=0, microsecond=0)
    for _ in range(count):
        entry_at = max(now_ars - timedelta(minutes=random.randint(20, 180)), today_start)
        stay = Stay(
            id=str(uuid.uuid4()),
            entry_at=entry_at,
            status=StayStatus.ACTIVE,
        )
        db.add(stay)
        db.flush()
        db.add(Ticket(
            id=str(uuid.uuid4()),
            stay_id=stay.id,
            ticket_code=_gen_ticket_code(db, entry_at),
            barcode_value=str(uuid.uuid4()),
        ))


def _seed_cash_closings(db: Session):
    """
    Create the missing daily cash closings, one per business day at ~21:30 ARS
    (00:30 UTC), from the last existing closing (or the first payment) up to now.

    Each closing's totals come from the approved payments in
    [previous closing, this closing), exactly like cash_closing_service does, so
    the history is consistent and the currently open period only covers today.
    """
    from app.models import CashClosing, Payment, PaymentMethod, PaymentStatus
    from app.services.cash_closing_service import VALID_EMPLOYEES

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    last = db.execute(select(CashClosing).order_by(CashClosing.closed_at.desc())).scalars().first()
    if last:
        period_from = last.closed_at.replace(tzinfo=None)
        day = (period_from - ARS_OFFSET).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    else:
        first_payment = db.execute(
            select(Payment.processed_at).where(Payment.processed_at.is_not(None))
            .order_by(Payment.processed_at.asc())
        ).scalars().first()
        if first_payment is None:
            return
        day = (first_payment.replace(tzinfo=None) - ARS_OFFSET).replace(hour=0, minute=0, second=0, microsecond=0)
        period_from = day + ARS_OFFSET

    payments = db.execute(
        select(Payment.processed_at, Payment.method, Payment.amount)
        .where(
            Payment.status == PaymentStatus.APPROVED,
            Payment.processed_at >= period_from,
            Payment.processed_at < now_utc,
        )
        .order_by(Payment.processed_at.asc())
    ).all()

    shortage_notes = [
        "Faltante en caja, se informa al encargado.",
        "Error en vuelto a un cliente.",
        "Diferencia sin identificar, se revisa mañana.",
    ]
    surplus_notes = [
        "Sobrante en caja, cliente no esperó el vuelto.",
        "Sobrante sin identificar.",
    ]

    closings: list[CashClosing] = []
    idx = 0
    while True:
        # Day D (ARS) closes at D 21:30–21:55 ARS = D+1 00:30–00:55 UTC
        closed_at = day + timedelta(days=1, minutes=random.randint(30, 55), seconds=random.randint(0, 59))
        if closed_at >= now_utc:
            break

        cash = digital = 0.0
        count = 0
        while idx < len(payments) and payments[idx].processed_at.replace(tzinfo=None) < closed_at:
            p = payments[idx]
            if p.method == PaymentMethod.CASH:
                cash += p.amount
            else:
                digital += p.amount
            count += 1
            idx += 1
        cash = round(cash, 2)
        digital = round(digital, 2)

        # Most closings match; some have a small shortage/surplus
        notes = None
        difference = 0.0
        roll = random.random()
        if roll < 0.15:
            difference = -float(random.choice([100, 200, 300, 500, 1000]))
            notes = random.choice(shortage_notes)
        elif roll < 0.22:
            difference = float(random.choice([100, 200, 300, 500]))
            notes = random.choice(surplus_notes)
        actual_cash = max(0.0, round(cash + difference, 2))

        closings.append(CashClosing(
            id=str(uuid.uuid4()),
            employee_name=random.choice(VALID_EMPLOYEES),
            period_from=period_from,
            period_to=closed_at,
            cash_amount=cash,
            digital_amount=digital,
            total_amount=round(cash + digital, 2),
            stay_count=count,
            actual_cash=actual_cash,
            difference=round(actual_cash - cash, 2),
            notes=notes,
            closed_at=closed_at,
        ))

        period_from = closed_at
        day += timedelta(days=1)

    db.add_all(closings)


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
