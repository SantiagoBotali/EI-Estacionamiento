"""
app/services/ticketing.py — Ticket code generation and barcode SVG.
"""
import io
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models import Ticket


def _next_sequence(db: Session, date_str: str) -> int:
    """Return the next ticket sequence number for a given date."""
    pattern = f"EST-{date_str}-%"
    stmt = select(func.count()).where(Ticket.ticket_code.like(pattern))
    count = db.execute(stmt).scalar() or 0
    return count + 1


def generate_ticket_code(db: Session) -> str:
    """Generate a human-readable ticket code: EST-YYYYMMDD-NNNN."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    seq = _next_sequence(db, today)
    return f"EST-{today}-{seq:04d}"


def generate_barcode_svg(barcode_value: str) -> str:
    """
    Generate a Code128 barcode as an SVG string.

    Args:
        barcode_value: UUID string to encode.

    Returns:
        SVG markup as a string.
    """
    try:
        import barcode
        from barcode.writer import SVGWriter

        code128 = barcode.get("code128", barcode_value, writer=SVGWriter())
        buffer = io.BytesIO()
        code128.write(buffer)
        svg_bytes = buffer.getvalue()
        return svg_bytes.decode("utf-8")
    except Exception:
        # Fallback: simple text representation
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="40" font-size="12">{barcode_value}</text></svg>'


def create_ticket_in_db(db: Session, stay_id: str) -> tuple["Ticket", str]:
    """
    Create a Ticket record in the DB for the given stay.

    Returns:
        (ticket_orm_object, barcode_svg_string)
    """
    from app.models import Ticket

    ticket_code = generate_ticket_code(db)
    barcode_value = str(uuid.uuid4())
    barcode_svg = generate_barcode_svg(barcode_value)

    ticket = Ticket(
        stay_id=stay_id,
        ticket_code=ticket_code,
        barcode_value=barcode_value,
    )
    db.add(ticket)
    return ticket, barcode_svg
