# -*- coding: utf-8 -*-
"""生成 MDLite 应用图标：icons/icon.ico、32x32.png、128x128.png、128x128@2x.png、icon.png、icon.icns

M 用矢量笔画绘制（不依赖系统字体），Windows / macOS / Linux 产物一致，
且与右侧箭头保持固定间距，不会因回退字体变宽而重叠。
"""
import os
from PIL import Image, ImageDraw

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


WHITE = (255, 255, 255, 255)

img, d = base_canvas()
# 白色 "M"（矢量笔画，无字体依赖）+ 下箭头（Markdown 标志性符号）
# M 外沿 x≈80..282，箭头三角最左 x≈301，留出清晰间距
d.line(
    [(107, 156), (107, 356), (181, 258), (255, 156), (255, 356)],
    fill=WHITE, width=54, joint="curve",
)
# 箭头：竖线 + 三角
ax = 365
d.line([(ax, 148), (ax, 306)], fill=WHITE, width=50)
d.polygon([(ax - 64, 292), (ax + 64, 292), (ax, 396)], fill=WHITE)

img.save(os.path.join(OUT, "icon.png"))
for size, name in ((32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
img.save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
img.save(os.path.join(OUT, "icon.icns"))
print("icons ->", OUT, os.listdir(OUT))
