"""
app/services/tariff.py — Parking fee calculation.
"""
from datetime import datetime, timezone

from app.config import settings


def calculate_price(
    entry_at: datetime,
    exit_at: datetime | None = None,
    rate_per_hour: float | None = None,
    minimum_charge: float | None = None,
    grace_period_minutes: int | None = None,
) -> float:
    """
    Calculate parking fee based on duration.

    Grace period: free up to GRACE_PERIOD_MINUTES.
    After grace period: every started hour is charged in full (rate × ceil(hours)),
    never less than the minimum charge.

    Returns:
        Amount in ARS (float).
    """
    from datetime import timedelta

    # entry_at is always stored as naive ARS (UTC-3).
    # Normalize entry_at to naive ARS.
    if entry_at.tzinfo is not None:
        # aware → convert to ARS naive
        entry_at = entry_at.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
    # else: already naive ARS, use as-is

    # Normalize exit_at to naive ARS.
    if exit_at is None:
        exit_at = datetime.utcnow() - timedelta(hours=3)
    elif exit_at.tzinfo is not None:
        exit_at = exit_at.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
    # else: already naive ARS, use as-is


    duration_seconds = max(0, (exit_at - entry_at).total_seconds())
    duration_minutes = duration_seconds / 60.0

    grace = grace_period_minutes if grace_period_minutes is not None else settings.grace_period_minutes
    rate = rate_per_hour if rate_per_hour is not None else settings.rate_per_hour
    minimum = minimum_charge if minimum_charge is not None else settings.minimum_charge

    if duration_minutes <= grace:
        return 0.0

    # Once past the grace period, every started hour of the stay is charged in
    # full ("hora o fracción"): 16 min → 1 h, 61 min → 2 h.
    import math
    billed_hours = math.ceil(duration_minutes / 60.0)

    amount = billed_hours * rate
    return float(math.ceil(max(amount, minimum)))
