#!/usr/bin/env python3
"""把一张图片裁成正方形并缩放到插件图标尺寸。

为什么用 Python 而不是 Node：图像编解码用 Pillow 又稳又快。
之前试过借 renderer 的 canvas 做（脚本 crop-icon.mjs），但 CDP 超时会在页面里
留下挂起的 img.decode()，把解码队列堵死 —— 后来连 1×1 的小图都要 3 秒，直接弃用。

用法：
  python scripts/crop-icon.py <源图> <输出> [选项]

选项：
  --cx N          裁剪中心 x（像素，默认图宽一半）
  --cy N          裁剪中心 y（像素，默认图高的 38%，人像脸一般在上半部分）
  --side N        裁剪边长（默认取 min(宽,高) 的 72%）
  --size N        输出边长（默认 192，即 38px 按钮的 5 倍图）
  --saturate F    饱和度增强（默认 1.0）
  --contrast F    对比度增强（默认 1.0）
  --brightness F  亮度（默认 1.0）

淡彩/水彩原图缩到 38px 容易糊成一片，建议 saturate 1.6~1.9 + contrast 1.25 左右。
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance, ImageOps
except ImportError:
    sys.exit("需要 Pillow：python -m pip install Pillow")


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--cx", type=int)
    ap.add_argument("--cy", type=int)
    ap.add_argument("--side", type=int)
    ap.add_argument("--size", type=int, default=192)
    ap.add_argument("--saturate", type=float, default=1.0)
    ap.add_argument("--contrast", type=float, default=1.0)
    ap.add_argument("--brightness", type=float, default=1.0)
    args = ap.parse_args()

    with Image.open(args.src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        side = args.side or round(min(w, h) * 0.72)
        side = max(1, min(side, min(w, h)))
        cx = args.cx if args.cx is not None else round(w / 2)
        cy = args.cy if args.cy is not None else round(h * 0.38)
        # 裁剪框夹回图内，避免出现空白边
        left = max(0, min(w - side, round(cx - side / 2)))
        top = max(0, min(h - side, round(cy - side / 2)))
        box = (left, top, left + side, top + side)
        cropped = im.crop(box)

        out = cropped.resize((args.size, args.size), Image.LANCZOS)
        if args.brightness != 1.0:
            out = ImageEnhance.Brightness(out).enhance(args.brightness)
        if args.contrast != 1.0:
            out = ImageEnhance.Contrast(out).enhance(args.contrast)
        if args.saturate != 1.0:
            out = ImageEnhance.Color(out).enhance(args.saturate)

        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        out.save(args.out, format="PNG", optimize=True)

    kb = Path(args.out).stat().st_size / 1024
    print(f"源图 {w}×{h} → 裁剪 {box} 边长 {side} → 输出 {args.size}×{args.size}")
    print(f"WROTE {args.out}  ({kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
