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
    After grace period: minimum charge applies, then rate per started hour.

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

    billable_minutes = duration_minutes - grace
    billable_hours = billable_minutes / 60.0

    # Round up to nearest quarter-hour for billing
    import math
    billable_hours_rounded = math.ceil(billable_hours * 4) / 4

    amount = billable_hours_rounded * rate
    return float(math.ceil(max(amount, minimum)))
