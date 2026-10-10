# -*- coding: utf-8 -*-
"""捕获（可能被遮挡的）MDLite 窗口内容并分析欢迎页布局：logo 居中 + 无滚动条"""
import ctypes
import subprocess
from ctypes import wintypes as wt
from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()

# 1) 找 mdlite.exe 的可见窗口
out = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq mdlite.exe", "/FO", "CSV"]).decode("gbk", "ignore")
pids = [int(line.split('","')[1]) for line in out.splitlines() if line.startswith('"mdlite.exe"')]
print("pids:", pids)
if not pids:
    raise SystemExit("mdlite.exe 未运行")

wins = []


@ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
def enum_cb(h, _):
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
    if pid.value in pids and user32.IsWindowVisible(h):
        n = user32.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(h, buf, n + 1)
        if buf.value:
            wins.append((h, buf.value))
    return True


user32.EnumWindows(enum_cb, 0)
print("候选窗口:", [(hex(h), t) for h, t in wins])
main = [(h, t) for h, t in wins if "siw" not in t]
if not main:
    raise SystemExit("未找到主窗口")
hwnd = main[0][0]
print("主窗口:", hex(hwnd), main[0][1])

# 最小化窗口客户区为 0：无激活恢复（不抢焦点）→ 捕获后再最小化回去
import time
was_min = user32.IsIconic(hwnd)
if was_min:
    user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
    time.sleep(2.0)  # 等待恢复动画与合成完成，避免标题栏残影进入捕获

# 2) PrintWindow 捕获（PW_RENDERFULLCONTENT=2，兼容 DirectComposition/WebView2）
rect = wt.RECT()
user32.GetClientRect(hwnd, ctypes.byref(rect))
w, h = rect.right - rect.left, rect.bottom - rect.top
print("客户区:", w, "x", h)

hdc = user32.GetDC(hwnd)
memdc = gdi32.CreateCompatibleDC(hdc)
bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
old = gdi32.SelectObject(memdc, bmp)
ok = user32.PrintWindow(hwnd, memdc, 2)
print("PrintWindow:", ok)


class BMIH(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]


class BMI(ctypes.Structure):
    _fields_ = [("bmiHeader", BMIH), ("colors", wt.DWORD * 3)]


bmi = BMI()
bmi.bmiHeader.biSize = ctypes.sizeof(BMIH)
bmi.bmiHeader.biWidth = w
bmi.bmiHeader.biHeight = -h  # 自上而下
bmi.bmiHeader.biPlanes = 1
bmi.bmiHeader.biBitCount = 32
bmi.bmiHeader.biCompression = 0
buf = ctypes.create_string_buffer(w * h * 4)
gdi32.SelectObject(memdc, old)
gdi32.GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bmi), 0)
gdi32.DeleteObject(bmp)
gdi32.DeleteDC(memdc)
user32.ReleaseDC(hwnd, hdc)

img = Image.frombytes("RGBA", (w, h), buf.raw).convert("RGB")
if was_min:
    user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE 还原用户之前的最小化状态
out_path = r"C:\Users\phoen\Documents\mdlite-window.png"
img.save(out_path)
print("已保存:", out_path)

# 3) 分析：欢迎卡居中 + 无滚动条
#    动态定位顶栏底边：内容区列(x=600)自上而下首次出现背景色 #f6f6f4 的行
px = img.load()
BG = (246, 246, 244)


def near_bg(p):
    return abs(p[0] - BG[0]) <= 3 and abs(p[1] - BG[1]) <= 3 and abs(p[2] - BG[2]) <= 3


TOP = next((y for y in range(0, 120) if near_bg(px[600, y])), 48)
print(f"顶栏底边: y{TOP}")


def is_content(p):
    r, g, b = p
    return (max(r, g, b) - min(r, g, b) > 25) or (r + g + b < 450)


x_lo, x_hi = 280, w - 30
content_rows = [y for y in range(TOP + 4, h - 4)
                if sum(1 for x in range(x_lo, x_hi, 4) if is_content(px[x, y])) >= 3]
if content_rows:
    top, bottom = content_rows[0], content_rows[-1]
    center = (top + bottom) / 2
    region_center = (TOP + h) / 2
    print(f"内容卡 y:{top}-{bottom} 高{bottom-top}px 中心{center:.0f} | 区域中心{region_center:.0f} | 偏差{center - region_center:+.0f}px")
else:
    print("WARN: 未检出内容卡（窗口可能是文档模式而非欢迎页）")

# 滚动条：右缘列带
bar_rows = []
for y in range(TOP + 4, h - 4):
    for x in range(w - 12, w - 3):
        r, g, b = px[x, y]
        if abs(r - BG[0]) > 5 or abs(g - BG[1]) > 5 or abs(b - BG[2]) > 5:
            bar_rows.append(y)
            break
if bar_rows:
    runs, cur = [], [bar_rows[0]]
    for y in bar_rows[1:]:
        if y - cur[-1] <= 3:
            cur.append(y)
        else:
            runs.append(cur)
            cur = [y]
    runs.append(cur)
    longest = max(runs, key=lambda r: r[-1] - r[0])
    print(f"右缘非背景: 最长连续带 {longest[0]}-{longest[-1]} ({longest[-1]-longest[0]}px)")
    print("滚动条:", "存在" if longest[-1] - longest[0] > 40 else "无")
else:
    print("滚动条: 无")
