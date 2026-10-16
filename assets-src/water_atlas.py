# Macht aus der Wasser-Animation (GIF) eine kleine Bildtafel für den Wasser-Shader:
#   python3 water_atlas.py wasser.gif ../src/assets/water_atlas.jpg
# 16 der Einzelbilder (jedes zweite) in einem 4x4-Raster, je 512x288 Pixel. Der Shader blendet zwischen
# ihnen über und kachelt sie gespiegelt über den Fluss (siehe terrain.ts, uWaterTex).
import sys

from PIL import Image, ImageSequence

SRC, OUT = sys.argv[1], sys.argv[2]
COLS, ROWS, W, H = 4, 4, 512, 288
frames = [f.convert("RGB") for f in ImageSequence.Iterator(Image.open(SRC))]
pick = frames[:: max(1, len(frames) // (COLS * ROWS))][: COLS * ROWS]
atlas = Image.new("RGB", (COLS * W, ROWS * H))
for i, f in enumerate(pick):
    atlas.paste(f.resize((W, H), Image.LANCZOS), ((i % COLS) * W, (i // COLS) * H))
atlas.save(OUT, "JPEG", quality=85)
print(len(frames), "Bilder ->", len(pick), "in", OUT)
