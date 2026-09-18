#!/usr/bin/env python3
"""预览插件图标：按按钮上的实际形态（圆形裁切 + 1px 描边）渲染几种尺寸。

用法：
  python scripts/icon-preview.py <图标.png> [输出.png] [--sizes 38,76,114] [--bg #eef1f5]

为什么用 Python：之前有个借 renderer canvas 拼图的版本（icon-sheet.mjs），
但渲染器一忙就超时，而且 CDP 超时会在页面里留下挂起的 img.decode() 把解码队列堵死。
Pillow 本地就能做，快且稳。
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("需要 Pillow：python -m pip install Pillow")

SS = 4  # 超采样倍数，让圆形边缘和描边平滑


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("icon")
    ap.add_argument("out", nargs="?", default="outputs/verify-window/icon-preview.png")
    ap.add_argument("--sizes", default="38,76,114")
    ap.add_argument("--bg", default="#eef1f5")
    args = ap.parse_args()

    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    pad = 16
    row_h = max(sizes) + pad * 2
    width = sum(s + pad * 2 for s in sizes)
    bg = args.bg.lstrip("#")
    canvas = Image.new("RGB", (width, row_h), tuple(int(bg[i:i + 2], 16) for i in (0, 2, 4)))

    with Image.open(args.icon) as src:
        icon = src.convert("RGBA")
        x = 0
        for size in sizes:
            big = size * SS
            face = icon.resize((big, big), Image.LANCZOS)
            # 圆形蒙版
            mask = Image.new("L", (big, big), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
            # 描边：画一个略小的圆做外圈
            stroke = max(SS, big // 38)
            ImageDraw.Draw(mask).ellipse((stroke, stroke, big - 1 - stroke, big - 1 - stroke), fill=255)
            ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
            ImageDraw.Draw(ring).ellipse((0, 0, big - 1, big - 1), outline=(0, 0, 0, 46), width=stroke)
            layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
            layer.paste(face, (0, 0), mask)
            layer.alpha_composite(ring)
            small = layer.resize((size, size), Image.LANCZOS)
            canvas.paste(small, (x + pad, pad), small)
            x += size + pad * 2

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.out, format="PNG", optimize=True)
    print(f"WROTE {args.out}  （从左到右 {', '.join(str(s) for s in sizes)} px）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
