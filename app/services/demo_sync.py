"""
app/services/demo_sync.py — Singleton that tracks spot occupancy changes
and signals when stays should be auto-created or closed.

Enabled only after "generate-today" is called.
Thread-safe: accessed from the async sync loop (main thread) and the
employee API endpoint (FastAPI worker threads).
"""
import logging
from threading import Lock

logger = logging.getLogger(__name__)


class DemoSyncService:
    _instance: "DemoSyncService | None" = None
    _cls_lock = Lock()

    def __init__(self) -> None:
        self._lock = Lock()
        self._enabled = False
        self._prev_states: dict[int, bool] = {}  # vision_id → is_occupied

    @classmethod
    def get_instance(cls) -> "DemoSyncService":
        with cls._cls_lock:
            if cls._instance is None:
                cls._instance = cls()
        return cls._instance

    # ── Control ──────────────────────────────────────────────────────────────

    def enable(self, initial_states: dict[int, bool]) -> None:
        """Arm the sync service with the current spot occupancy snapshot."""
        with self._lock:
            self._enabled = True
            self._prev_states = dict(initial_states)
        logger.info("DemoSync enabled. Tracking %d spots.", len(initial_states))

    def disable(self) -> None:
        with self._lock:
            self._enabled = False
            self._prev_states.clear()
        logger.info("DemoSync disabled.")

    @property
    def enabled(self) -> bool:
        return self._enabled

    # ── Change detection ─────────────────────────────────────────────────────

    def compute_changes(
        self, current_states: dict[int, bool]
    ) -> list[tuple[int, bool]]:
        """
        Compare *current_states* to the last known states.
        Returns a list of (vision_id, became_occupied).
        Updates internal prev_states atomically.
        Returns [] when disabled.
        """
        if not self._enabled:
            return []

        changes: list[tuple[int, bool]] = []
        with self._lock:
            for vid, is_occ in current_states.items():
                was_occ = self._prev_states.get(vid, is_occ)  # assume no change on first tick
                if is_occ != was_occ:
                    changes.append((vid, is_occ))
            self._prev_states = dict(current_states)

        return changes
