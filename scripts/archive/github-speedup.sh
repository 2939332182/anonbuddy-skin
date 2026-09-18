#!/usr/bin/env bash
# =============================================================
# GitHub 下载提速修复脚本
# 作者: 小爱音 (WorkBuddy AI)
# 日期: 2026-09-11
#
# 诊断结论：
#   1. 本机网络不支持 IPv6，但 DNS 会返回 IPv6 地址，导致每次
#      连接先试 IPv6 超时再回退 IPv4 —— 这是"打开慢"的主因
#   2. hosts 里的 GitHub520 段是 2025-11-12 的，已过期，且
#      缺失 raw.githubusercontent.com 条目
#   3. objects.githubusercontent.com 被写死为单个 IP
#
# 本脚本提供 3 个等级的修复，请按需选择运行
# =============================================================

set -e

HOSTS="/c/Windows/System32/drivers/etc/hosts"
BACKUP="/c/Windows/System32/drivers/etc/hosts.bak-$(date +%Y%m%d-%H%M%S)"
MARK_START="# === WorkBuddy GitHub Fix Start ==="
MARK_END="# === WorkBuddy GitHub Fix End ==="

echo "=========================================="
echo "  GitHub 下载提速修复脚本"
echo "=========================================="
echo

# ---------- 检查管理员权限 ----------
if ! touch "$HOSTS" 2>/dev/null; then
  echo "❌ 需要管理员权限才能修改 hosts 文件"
  echo "   请右键 Git Bash -> 以管理员身份运行，然后重新执行本脚本"
  exit 1
fi

echo "✅ 权限检查通过"
echo

# ---------- 备份 ----------
cp "$HOSTS" "$BACKUP"
echo "✅ 已备份原 hosts 到："
echo "   $BACKUP"
echo

# ---------- 移除旧的 GitHub520 段（已过期）----------
if grep -q "GitHub520 Host Start" "$HOSTS"; then
  echo "🔍 发现过期的 GitHub520 段（2025-11-12），正在移除..."
  sed -i '/# GitHub520 Host Start/,/# GitHub520 Host End/d' "$HOSTS"
  echo "✅ 已移除"
  echo
fi

# ---------- 移除旧的 WorkBuddy 段（便于重复运行）----------
if grep -q "WorkBuddy GitHub Fix Start" "$HOSTS"; then
  sed -i '/# === WorkBuddy GitHub Fix Start ===/,/# === WorkBuddy GitHub Fix End ===/d' "$HOSTS"
fi

# ---------- 写入新条目 ----------
echo "✍️  正在写入优化后的 GitHub 条目..."
cat >> "$HOSTS" << 'EOF'
# === WorkBuddy GitHub Fix Start ===
# 说明: 本机网络不支持 IPv6，故仅使用经过实测的 IPv4 节点
# 实测: 185.199.109.133 平均 109ms (最优)
# 更新: 2026-09-11

# --- raw 单文件域（之前缺失，本次补上）---
185.199.109.133                 raw.githubusercontent.com
185.199.109.133                 raw.github.com

# --- objects / media / gist（统一指向最优节点）---
185.199.109.133                 objects.githubusercontent.com
185.199.109.133                 media.githubusercontent.com
185.199.109.133                 gist.githubusercontent.com
185.199.109.133                 gist.github.com
185.199.109.133                 avatars.githubusercontent.com
185.199.109.133                 avatars0.githubusercontent.com
185.199.109.133                 avatars1.githubusercontent.com
185.199.109.133                 avatars2.githubusercontent.com
185.199.109.133                 avatars3.githubusercontent.com
185.199.109.133                 avatars4.githubusercontent.com
185.199.109.133                 avatars5.githubusercontent.com
185.199.109.133                 favicons.githubusercontent.com
185.199.109.133                 camo.githubusercontent.com
185.199.109.133                 user-images.githubusercontent.com

# --- 网站与 API ---
140.82.113.4                    github.com
140.82.113.4                    www.github.com
140.82.113.4                    api.github.com
140.82.113.4                    codeload.github.com
140.82.113.4                    github.global.ssl.fastly.net

# === WorkBuddy GitHub Fix End ===
EOF

echo "✅ 写入完成"
echo

# ---------- 刷新 DNS 缓存 ----------
echo "🔄 正在刷新 DNS 缓存..."
ipconfig //flushdns > /dev/null 2>&1 || echo "   (刷新失败，可手动执行 ipconfig /flushdns)"
echo "✅ DNS 缓存已刷新"
echo

# ---------- 验证 ----------
echo "=========================================="
echo "  验证结果"
echo "=========================================="
echo
echo "▶ 当前 hosts 中的 GitHub 条目："
grep -E "github" "$HOSTS" | grep -v "^#" | head -30
echo
echo "▶ raw 域名连通测试："
curl -s -o /dev/null -w "   HTTP %{http_code}  耗时 %{time_total}s\n" --max-time 10 "https://raw.githubusercontent.com/torvalds/linux/master/README" || echo "   失败"
echo
echo "=========================================="
echo "  完成！"
echo "=========================================="
echo
echo "💡 如果效果不理想，可用以下命令还原："
echo "   cp \"$BACKUP\" \"$HOSTS\" && ipconfig //flushdns"
echo
