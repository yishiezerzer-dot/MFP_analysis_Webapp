"""Frames from record.mjs → captioned GIF with click markers: python make_gif.py <out dir> <name>..."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 960
BAR = 46
HERE = Path(__file__).parent
try:
    font = ImageFont.truetype("segoeui.ttf", 19)
except OSError:
    font = ImageFont.truetype("DejaVuSans.ttf", 18)

def frame(f, scale):
    im = Image.open(f["file"]).convert("RGB")
    d = ImageDraw.Draw(im)
    if f.get("click"):
        x, y = f["click"]
        for r, w in ((22, 4), (30, 2)):
            d.ellipse((x - r, y - r, x + r, y + r), outline=(234, 88, 12), width=w)
    im = im.resize((WIDTH, round(im.height * scale)), Image.LANCZOS)
    out = Image.new("RGB", (WIDTH, im.height + BAR), (17, 24, 39))
    out.paste(im, (0, 0))
    ImageDraw.Draw(out).text((16, im.height + BAR // 2), f["caption"], font=font, fill=(255, 255, 255), anchor="lm")
    return out

def build(name, dest):
    frames = json.load(open(HERE / "frames" / name / "frames.json", encoding="utf-8"))
    first = Image.open(frames[0]["file"])
    scale = WIDTH / first.width
    images = [frame(f, scale).quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    images[0].save(dest, save_all=True, append_images=images[1:], duration=[f["ms"] for f in frames], loop=0, optimize=True)
    print(name, len(frames), "frames", round(Path(dest).stat().st_size / 1024), "KB")

for name in sys.argv[2:]:
    build(name, Path(sys.argv[1]) / f"workflow-{name}.gif")
