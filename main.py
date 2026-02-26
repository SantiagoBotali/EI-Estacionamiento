import cv2
import json
from utils import get_parking_spots_bboxes, empty_or_not

mask = './Media/mask_crop.png'
video_path = './Media/parking_crop_loop.mp4'

mask = cv2.imread(mask, 0)
cap = cv2.VideoCapture(video_path)

connected_components = cv2.connectedComponentsWithStats(mask, 4, cv2.CV_32S)
spots = get_parking_spots_bboxes(connected_components)

spots_status = [None for j in spots]
frame_nmr = 0
ret = True
step = 30

while ret:
    ret, frame = cap.read()

    if frame is None:
        break

    if frame_nmr % step == 0:
        for spot_indx, spot in enumerate(spots):
            x1, y1, w, h = spot
            spot_crop = frame[y1: y1 + h, x1:x1 + w, :]
            spot_status = empty_or_not(spot_crop)
            spots_status[spot_indx] = spot_status

        # === Guardar estado a JSON ===
        parking_state = [
            {"id": i, "x": x, "y": y, "w": w, "h": h, "empty": bool(status)}
            for i, ((x, y, w, h), status) in enumerate(zip(spots, spots_status))
        ]
        with open("parking_state.json", "w") as f:
            json.dump(parking_state, f)
        # =============================

    for spot_indx, spot in enumerate(spots):
        spot_status = spots_status[spot_indx]
        x1, y1, w, h = spots[spot_indx]

        if spot_status:
            frame = cv2.rectangle(frame, (x1, y1), (x1 + w, y1 + h), (0, 255, 0), 2)
        else:
            frame = cv2.rectangle(frame, (x1, y1), (x1 + w, y1 + h), (0, 0, 255), 2)

    cv2.imshow('frame', frame)
    if cv2.waitKey(25) & 0xFF == ord('q'):
        break

    frame_nmr += 1

cap.release()
cv2.destroyAllWindows()