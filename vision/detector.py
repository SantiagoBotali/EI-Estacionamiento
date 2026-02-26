"""
vision/detector.py — Headless background thread parking detector.

Replica exactamente la lógica de main.py (original preservado):
  - Lee cada frame del video
  - Cada `step` frames clasifica todos los spots con empty_or_not()
  - Guarda el frame LIMPIO (sin anotaciones) para el feed de cámara
  - El estado de spots se publica al VisionAdapter
  - El video se loopea al terminar
"""
import threading
import logging
import time

import cv2

from app.config import settings
from vision.utils import get_parking_spots_bboxes, empty_or_not

logger = logging.getLogger(__name__)

# Equivalente a cv2.waitKey(25) del original → ~40 fps
FRAME_DELAY = 0.025


class ParkingDetector:
    """Background thread que clasifica spots continuamente (sin GUI)."""

    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="ParkingDetector")
        self._thread.start()
        logger.info("ParkingDetector iniciado.")

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("ParkingDetector detenido.")

    def _run(self):
        from app.services.vision_adapter import VisionAdapter
        adapter = VisionAdapter.get_instance()

        # ── Cargar máscara y detectar spots (igual que main.py) ──────────────
        mask = cv2.imread(settings.mask_path, 0)
        if mask is None:
            logger.error("No se puede leer la máscara: %s", settings.mask_path)
            return

        connected_components = cv2.connectedComponentsWithStats(mask, 4, cv2.CV_32S)
        spots = get_parking_spots_bboxes(connected_components)

        if not spots:
            logger.error("No se encontraron spots en la máscara.")
            return

        logger.info("%d spots detectados en la máscara.", len(spots))

        # ── Abrir video ───────────────────────────────────────────────────────
        cap = cv2.VideoCapture(settings.video_path)
        if not cap.isOpened():
            logger.error("No se puede abrir el video: %s", settings.video_path)
            return

        step = settings.detector_step
        spots_status = [None] * len(spots)   # igual que main.py: empieza en None
        frame_nmr = 0

        while not self._stop_event.is_set():
            t0 = time.monotonic()

            ret, frame = cap.read()

            # ── Loop del video (igual que main.py: cap.set en vez de break) ──
            if not ret or frame is None:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                frame_nmr = 0
                time.sleep(FRAME_DELAY)
                continue

            # ── Clasificación cada `step` frames (igual que main.py) ─────────
            if frame_nmr % step == 0:
                for spot_indx, spot in enumerate(spots):
                    x1, y1, w, h = spot
                    spot_crop = frame[y1: y1 + h, x1: x1 + w, :]
                    # Llamada idéntica a main.py (solo spot_crop, model_path default)
                    spot_status = empty_or_not(spot_crop, settings.model_path)
                    spots_status[spot_indx] = spot_status

                # Publicar estado al adapter
                state = [
                    {
                        "id": i,
                        "x": int(x),
                        "y": int(y),
                        "w": int(w),
                        "h": int(h),
                        "empty": bool(st) if st is not None else True,
                    }
                    for i, ((x, y, w, h), st) in enumerate(zip(spots, spots_status))
                ]
                # Frame LIMPIO — sin ninguna anotación dibujada
                adapter.update_state(state, frame)

            else:
                # Entre clasificaciones: actualizar frame de cámara sin cambiar estado
                adapter.update_frame_only(frame)

            frame_nmr += 1

            # ── Timing: equivalente a cv2.waitKey(25) de main.py ─────────────
            elapsed = time.monotonic() - t0
            sleep_t = FRAME_DELAY - elapsed
            if sleep_t > 0:
                time.sleep(sleep_t)

        cap.release()
        logger.info("ParkingDetector finalizado.")
