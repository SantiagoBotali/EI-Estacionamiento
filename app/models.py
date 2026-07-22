import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, String, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


# ─── Enums ──────────────────────────────────────────────────────────────────

class UserRole(str, PyEnum):
    EMPLOYEE = "EMPLOYEE"
    ADMIN = "ADMIN"


class StayStatus(str, PyEnum):
    ACTIVE = "ACTIVE"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    PAID = "PAID"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class PaymentMethod(str, PyEnum):
    CASH = "CASH"
    SIMULATED = "SIMULATED"
    MERCADOPAGO = "MERCADOPAGO"


class PaymentStatus(str, PyEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


# ─── Models ─────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=UserRole.EMPLOYEE)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    stays_created: Mapped[list["Stay"]] = relationship(
        "Stay", foreign_keys="Stay.created_by_id", back_populates="created_by"
    )
    stays_closed: Mapped[list["Stay"]] = relationship(
        "Stay", foreign_keys="Stay.closed_by_id", back_populates="closed_by"
    )


class Stay(Base):
    __tablename__ = "stays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    entry_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    exit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=StayStatus.ACTIVE)
    amount_expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    amount_paid: Mapped[float | None] = mapped_column(Float, nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    slot_vision_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    closed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )

    created_by: Mapped["User | None"] = relationship(
        "User", foreign_keys=[created_by_id], back_populates="stays_created"
    )
    closed_by: Mapped["User | None"] = relationship(
        "User", foreign_keys=[closed_by_id], back_populates="stays_closed"
    )
    ticket: Mapped["Ticket | None"] = relationship("Ticket", back_populates="stay", uselist=False)
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="stay")


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    stay_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stays.id"), unique=True, nullable=False
    )
    ticket_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    barcode_value: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    stay: Mapped["Stay"] = relationship("Stay", back_populates="ticket")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    stay_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stays.id"), nullable=False, index=True
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=PaymentStatus.PENDING)
    external_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mp_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string

    stay: Mapped["Stay"] = relationship("Stay", back_populates="payments")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500))


class CashClosing(Base):
    __tablename__ = "cash_closings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    employee_name: Mapped[str] = mapped_column(String(64), nullable=False)
    period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cash_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    digital_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    stay_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actual_cash: Mapped[float] = mapped_column(Float, nullable=False)
    difference: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    closed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )

    closed_by: Mapped["User | None"] = relationship("User", foreign_keys=[closed_by_id])
