"""
app/services/vision_adapter.py — Thread-safe singleton bridge between
the CV detector thread and FastAPI async handlers.
"""
import threading
import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class VisionAdapter:
    _instance: Optional["VisionAdapter"] = None
    _lock = threading.Lock()

    def __init__(self):
        self._state_lock = threading.Lock()
        self._spots: list[dict] = []
        self._frame: Optional[np.ndarray] = None
        self._last_updated: Optional[str] = None

    @classmethod
    def get_instance(cls) -> "VisionAdapter":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def update_state(self, spots: list[dict], frame: np.ndarray):
        """Called from the detector thread with fresh vision data + annotated frame."""
        with self._state_lock:
            self._spots = spots
            self._frame = frame.copy()
            self._last_updated = datetime.now(timezone.utc).isoformat()

    def update_frame_only(self, frame: np.ndarray):
        """Update the displayed frame without changing the spot state (between classification steps)."""
        with self._state_lock:
            self._frame = frame.copy()

    def get_state(self) -> dict:
        """Returns current parking state."""
        with self._state_lock:
            spots = [s.copy() for s in self._spots]
            last_updated = self._last_updated

        free = sum(1 for s in spots if s["empty"])
        total = len(spots)
        occupancy_rate = (total - free) / total if total > 0 else 0.0

        return {
            "spots": spots,
            "free": free,
            "total": total,
            "occupancy_rate": round(occupancy_rate, 4),
            "last_updated": last_updated,
        }

    def get_latest_frame(self) -> Optional[np.ndarray]:
        """Returns a copy of the latest annotated frame (thread-safe)."""
        with self._state_lock:
            if self._frame is None:
                return None
            return self._frame.copy()

    def has_data(self) -> bool:
        with self._state_lock:
            return bool(self._spots)
