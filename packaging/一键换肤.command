#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo ""
echo "  ============================================"
echo "    AnonBuddy Skin   WorkBuddy 换肤"
echo "  ============================================"
echo ""
echo "  接下来会重启 WorkBuddy 并注入皮肤。"
echo "  手头没保存的东西记得先存一下。"
echo ""
read -n 1 -s -r -p "  按任意键继续..."
echo ""

chmod +x scripts/apply.command 2>/dev/null
./scripts/apply.command

echo ""
echo "  如果显示成功，去 WorkBuddy 右上角找那颗浮动按钮。"
echo ""
read -n 1 -s -r -p "  按任意键关闭..."