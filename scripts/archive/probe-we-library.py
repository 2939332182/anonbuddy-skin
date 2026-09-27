# 探查本机 Wallpaper Engine 壁纸库，为「WE 壁纸当皮肤」的可行性分析取证。
# 用法：python scripts/archive/probe-we-library.py
import collections
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LIB = r"D:\steam\steamapps\workshop\content\431960"
VIDEO_EXT = (".mp4", ".webm", ".mov", ".avi", ".mkv")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")

if not os.path.isdir(LIB):
    print("NOT_FOUND", LIB)
    sys.exit(0)

dirs = sorted(d for d in os.listdir(LIB) if os.path.isdir(os.path.join(LIB, d)))
print("条目目录数:", len(dirs))

types = collections.Counter()
videos = []
scenes = []
with_preview = 0
for d in dirs:
    root = os.path.join(LIB, d)
    p = os.path.join(root, "project.json")
    if not os.path.exists(p):
        types["<无 project.json>"] += 1
        continue
    j = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            j = json.load(open(p, encoding=enc))
            break
        except Exception:
            pass
    if j is None:
        types["<解析失败>"] += 1
        continue

    t = j.get("type") or ("preset" if j.get("preset") is not None else "?")
    t = str(t).lower()
    types[t] += 1

    if os.path.exists(os.path.join(root, "preview.jpg")):
        with_preview += 1

    files = os.path.join(root, "files")
    vids = []
    if os.path.isdir(files):
        for cur, _, fs in os.walk(files):
            for f in fs:
                if f.lower().endswith(VIDEO_EXT):
                    fp = os.path.join(cur, f)
                    vids.append((os.path.relpath(fp, files), os.path.getsize(fp)))

    if t == "video" and vids:
        vids.sort(key=lambda x: -x[1])
        videos.append({"id": d, "title": j.get("title", ""), "files": vids,
                       "total": sum(v[1] for v in vids)})
    if t == "scene":
        pkg = os.path.join(root, "scene.pkg")
        scenes.append({"id": d, "title": j.get("title", ""),
                       "pkg": os.path.getsize(pkg) if os.path.exists(pkg) else 0})

print("类型分布:", dict(types))
print("带 preview.jpg 的条目:", with_preview)

videos.sort(key=lambda v: -v["total"])
print("\n=== 视频壁纸条目:", len(videos), "===")
for v in videos[:15]:
    top = v["files"][0]
    print(f'  {v["id"]}  {v["total"] / 1048576:7.1f} MB  {v["title"][:38]!r}  -> {top[0]} ({top[1] / 1048576:.1f} MB)')

if videos:
    tot = sum(v["total"] for v in videos)
    print(f"\n视频壁纸总体积: {tot / 1048576:.1f} MB")
    print("视频容器分布:", dict(collections.Counter(os.path.splitext(f[0])[1].lower() for v in videos for f in v["files"])))
    sizes = sorted(f[1] for v in videos for f in v["files"])
    print(f"单个视频体积: 最小 {sizes[0] / 1048576:.1f} MB / 中位 {sizes[len(sizes) // 2] / 1048576:.1f} MB / 最大 {sizes[-1] / 1048576:.1f} MB")

print("\n=== 场景壁纸条目:", len(scenes), "===")
for s in scenes[:8]:
    print(f'  {s["id"]}  scene.pkg {s["pkg"] / 1048576:7.1f} MB  {s["title"][:38]!r}')
if scenes:
    print(f"场景 pkg 总体积: {sum(s['pkg'] for s in scenes) / 1048576:.1f} MB")

# 抽几个条目看 files/ 里到底有什么，判断可用性
print("\n=== 抽样：files/ 目录内容 ===")
for d in dirs[:4]:
    root = os.path.join(LIB, d, "files")
    if not os.path.isdir(root):
        print(f"  {d}: 无 files/")
        continue
    items = []
    for cur, _, fs in os.walk(root):
        for f in fs:
            items.append((os.path.relpath(os.path.join(cur, f), root), os.path.getsize(os.path.join(cur, f))))
    items.sort(key=lambda x: -x[1])
    print(f"  {d}: {len(items)} 个文件，最大 3 个 -> " +
          ", ".join(f"{n}({s / 1048576:.1f}MB)" for n, s in items[:3]))
