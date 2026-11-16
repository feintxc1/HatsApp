from PIL import Image
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = Path(
    r"C:\Users\feint\.cursor\projects\c-Users-feint-OneDrive-Desktop-HatsApp\assets\hat-icon-source.jpg"
)
img = Image.open(src).convert("RGBA")
pixels = img.getdata()
out = []
for r, g, b, a in pixels:
    if r < 40 and g < 45 and b < 50:
        out.append((r, g, b, 0))
    elif r < 55 and g < 60 and b < 70 and (r + g + b) < 160:
        out.append((r, g, b, 0))
    else:
        out.append((r, g, b, a))
img.putdata(out)

bbox = img.getbbox()
if bbox:
    pad = 12
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    img = img.crop((l, t, r, b))

side = max(img.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)

master = square.resize((512, 512), Image.Resampling.LANCZOS)
(root / "build").mkdir(exist_ok=True)
(root / "src" / "assets").mkdir(parents=True, exist_ok=True)
master.save(root / "build" / "icon.png")
master.save(root / "src" / "assets" / "icon.png")
master.resize((32, 32), Image.Resampling.LANCZOS).save(root / "src" / "assets" / "tray.png")

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
icons = [master.resize(s, Image.Resampling.LANCZOS) for s in sizes]
icons[-1].save(root / "build" / "icon.ico", format="ICO", sizes=sizes, append_images=icons[:-1])
print("ok", master.size)
