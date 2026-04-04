import cv2
import sys

# --- CONFIGURACIÓN ---
VIDEO_PATH = 'tu_video_nuevo.mp4' 
OUTPUT_NAME = 'molde_para_dibujar.jpg'
# ---------------------

print(f"Abriendo video: {VIDEO_PATH}...")
cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("Error: No se pudo abrir el video. Verificá el nombre.")
    sys.exit()

# Leemos solo el primer cuadro
ret, frame = cap.read()

if ret:
    # Lo guardamos como JPG
    cv2.imwrite(OUTPUT_NAME, frame)
    print(f"¡Éxito! Imagen guardada como '{OUTPUT_NAME}'.")
    print(f"Dimensiones exactas: {frame.shape[1]}x{frame.shape[0]} píxeles.")
else:
    print("Error: No se pudo leer el primer cuadro del video.")

cap.release()