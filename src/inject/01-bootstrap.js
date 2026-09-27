
  // 幂等收尾：apply 会被反复调用（启动 / 换主题 / 测试脚本），每次都 eval 一遍整段脚本。
  // 卸载上一个实例时只删 DOM 节点是不够的 —— 旧实例的 MutationObserver 和 1.5s setInterval
  // 还活着，会继续把主标题拆成逐字节点。结果就是 pause 时已经合并好的文本被旧实例
  // "拆回去"，看起来像 restore 完全失效（实测踩过：第一次 pause 有效，之后全部无效）。
  // 所以这里必须显式把上一个实例停掉，且顺序在创建新实例之前。
  try { window.__anonbuddySkin?.copy?.stop?.(); } catch {}
  try { window.__anonbuddySkin?.dispose?.(); } catch {}
  delete window.__anonbuddySkin;

  let style = document.getElementById(data.styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = data.styleId;
    document.head.appendChild(style);
  }

  document.getElementById(data.menuId)?.remove();
  const root = document.createElement("div");
  root.id = data.menuId;
  root.style.cssText = "position:fixed;z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;";

  const button = document.createElement("button");
  button.type = "button";
  button.title = "AnonBuddy Skin\uff08\u53ef\u62d6\u52a8\uff09";
  // 按钮外形统一，只有"图标来源"分两种：自定义图片 / 默认 emoji
  const buttonBase = "display:block;width:38px;height:38px;border-radius:50%;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);box-shadow:0 3px 12px rgba(0,0,0,.24);cursor:grab;line-height:1;padding:0;touch-action:none;";
  if (data.icon) {
    // 自定义图标：整图 cover 填满圆形（素材请用正方形、主体居中）
    button.style.cssText = buttonBase + "background-image:url(" + JSON.stringify(data.icon) + ");background-size:cover;background-position:center;background-repeat:no-repeat;";
  } else {
    button.textContent = "\u{1F3A8}";
    button.style.cssText = buttonBase + "backdrop-filter:blur(10px);font-size:19px;font-family:system-ui,'Segoe UI Emoji','Apple Color Emoji',sans-serif;";
  }

  const panel = document.createElement("div");
  panel.style.cssText = "display:none;position:absolute;top:46px;right:0;min-width:200px;max-height:min(72vh,560px);overflow-y:auto;overscroll-behavior:contain;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;";

  const rows = new Map();
  const paint = (id) => {
    for (const [rowId, row] of rows) {
      row.style.background = rowId === id ? "rgba(36,201,215,.16)" : "transparent";
      row.style.fontWeight = rowId === id ? "700" : "500";
    }
  };
