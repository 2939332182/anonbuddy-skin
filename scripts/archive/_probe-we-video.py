import json, os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
LIB = r"D:/steam/steamapps/workshop/content/431960"
for d in sorted(os.listdir(LIB)):
    p = os.path.join(LIB, d, "project.json")
    if not os.path.exists(p):
        continue
    j = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            j = json.load(open(p, encoding=enc)); break
        except Exception: pass
    if not j or str(j.get("type", "")).lower() != "video":
        continue
    root = os.path.join(LIB, d)
    print(f'--- {d}  {j.get("title","")!r}  file={j.get("file")!r}')
    for cur, dirs, fs in os.walk(root):
        for f in fs:
            fp = os.path.join(cur, f)
            sz = os.path.getsize(fp)
            rel = os.path.relpath(fp, root)
            if rel.startswith("preview"):
                continue
            print(f'      {rel}  {sz/1048576:.2f} MB')
