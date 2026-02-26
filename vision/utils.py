"""
vision/utils.py — CV utilities for parking spot detection.

Implements the missing module required by main.py (preserved original).
"""
import warnings
import pickle
import numpy as np
import cv2


_model_cache: dict = {}


def get_parking_spots_bboxes(connected_components) -> list[tuple[int, int, int, int]]:
    """
    Extract bounding boxes from cv2.connectedComponentsWithStats output.

    Args:
        connected_components: tuple returned by cv2.connectedComponentsWithStats

    Returns:
        List of (x, y, w, h) tuples, one per spot (label 0 = background, skipped).
    """
    (totalLabels, label_ids, values, centroid) = connected_components
    spots = []
    for i in range(1, totalLabels):
        x = int(values[i, cv2.CC_STAT_LEFT])
        y = int(values[i, cv2.CC_STAT_TOP])
        w = int(values[i, cv2.CC_STAT_WIDTH])
        h = int(values[i, cv2.CC_STAT_HEIGHT])
        spots.append((x, y, w, h))
    return spots


def empty_or_not(spot_bgr: np.ndarray, model_path: str = "./model.p") -> bool:
    """
    Classify a parking spot crop as empty or occupied.

    Args:
        spot_bgr: BGR image crop of the spot (any size).
        model_path: Path to the pickled scikit-learn SVC model.

    Returns:
        True if the spot is empty, False if occupied.
    """
    global _model_cache

    if model_path not in _model_cache:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore")
            with open(model_path, "rb") as f:
                _model_cache[model_path] = pickle.load(f)

    model = _model_cache[model_path]

    # Resize to 15×15, normalize to [0,1], flatten to 675 features (15*15*3)
    # NOTE: model was trained on normalized float32 features (pixel / 255.0)
    resized = cv2.resize(spot_bgr, (15, 15))
    flat = resized.flatten().astype(np.float32) / 255.0
    flat = flat.reshape(1, -1)

    prediction = model.predict(flat)
    # clase 0 = vacío (empty=True), clase 1 = ocupado (empty=False)
    return int(prediction[0]) == 0
