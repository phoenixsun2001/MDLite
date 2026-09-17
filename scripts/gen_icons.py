# -*- coding: utf-8 -*-
"""生成 MDLite 应用图标：icons/icon.ico、32x32.png、128x128.png、128x128@2x.png、icon.png、icon.icns"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "src-tauri", "icons"))
os.makedirs(OUT, exist_ok=True)

S = 512


def base_canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 垂直渐变圆角方块
    top, bottom = (96, 165, 250), (37, 99, 235)
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=255)
    img.paste(grad, (0, 0), mask)
    return img, ImageDraw.Draw(img)


def load_font(size):
    for name in ("arialbd.ttf", "segoeuib.ttf", "seguisb.ttf", "calibrib.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


img, d = base_canvas()
# 白色 "M" + 下箭头（Markdown 标志性符号）
f = load_font(230)
m_bbox = d.textbbox((0, 0), "M", font=f)
mh = m_bbox[3] - m_bbox[1]
d.text((120, S / 2 - mh / 2 - m_bbox[1] + 10), "M", font=f, fill=(255, 255, 255, 255))
# 箭头：竖线 + 三角
ax = 375
d.line([(ax, 145), (ax, 315)], fill=(255, 255, 255, 255), width=52)
d.polygon([(ax - 78, 300), (ax + 78, 300), (ax, 400)], fill=(255, 255, 255, 255))

img.save(os.path.join(OUT, "icon.png"))
for size, name in ((32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
img.save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
img.save(os.path.join(OUT, "icon.icns"))
print("icons ->", OUT, os.listdir(OUT))
