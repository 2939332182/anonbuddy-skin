// 常驻皮肤守护 —— 用 CDP 事件代替轮询来补注入新窗口。
//
// 为什么要有它：皮肤活在渲染进程里，而注入发生在启动那一刻 —— 那一刻只有主窗口。
// 此后 WorkBuddy 再开的窗口（最典型的是 5.6.x 的「设置」独立窗口）是全新的
// renderer，不在任何注入名单里。旧的解法是 scripts/watch-targets.mjs：每 2 秒
// 拉一次 /json/list，发现新 target 就 spawn 一个 cli apply 子进程。
//
// 这里的做法换了根子：
//   连 browser 级端点 → Target.setAutoAttach({waitForDebuggerOnStart:true}) →
//   每个渲染进程**一出生就被暂停** → 趁暂停期 Page.addScriptToEvaluateOnNewDocument
//   把脚本装进"文档创建时先跑"的位置 → Runtime.runIfWaitingForDebugger 放行。
//
// 换来三件事：
//   1. 新窗口首屏就是皮肤，不再等最多 2 秒、也不再有"先裸奔再换脸"的一闪；
//   2. 不需要 40 MB 的常驻轮询进程，也不需要每次重开窗口都 spawn 子进程；
//   3. 刷新、导航、iframe 全都自动带上（脚本挂在文档创建点，而不是某个已存在的文档上）。
//
// ⚠️ 最危险的一点：waitForDebuggerOnStart 是货真价实的"暂停"。注入流程无论成功、
//    失败还是超时，都必须走到 Runtime.runIfWaitingForDebugger —— 否则那个渲染进程
//    会永久停在出生状态，用户看到的就是白屏。所以 resume 放在 finally 里，并且
//    加了一道超时上限。
//
// ⚠️ 第二点：CDP 断开连接时 Chromium 会自行 resume 被暂停的 target，这是我们的
//    最后一道保险 —— 但不要依赖它，见上一条。

import { CdpSession, waitForBrowserEndpoint } from "./cdp-client.mjs";
import { RENDERER_URL_HINT, REPORT_BINDING } from "./constants.mjs";
import { rememberActiveId } from "./active-state.mjs";

const DEFAULT_ATTACH_TIMEOUT_MS = 4000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_FAILURES = 6;
const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shortId(value) {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : String(value ?? "?");
}

export class SkinGuard {
  constructor({
    port,
    expression,
    urlHint = RENDERER_URL_HINT,
    log = () => {},
    attachTimeoutMs = DEFAULT_ATTACH_TIMEOUT_MS,
    reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
    maxReconnectFailures = DEFAULT_MAX_RECONNECT_FAILURES,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    deps = {},
  } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new TypeError("port must be an integer from 1024 through 65535");
    }
    if (typeof expression !== "string" || expression.length === 0) {
      throw new TypeError("expression must be a non-empty string");
    }
    if (typeof log !== "function") {
      throw new TypeError("log must be a function");
    }

    this.port = port;
    this.expression = expression;
    this.urlHint = urlHint;
    this.log = log;
    this.attachTimeoutMs = attachTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.maxReconnectFailures = maxReconnectFailures;
    this.connectTimeoutMs = connectTimeoutMs;
    this.waitForBrowser = deps.waitForBrowserEndpoint ?? waitForBrowserEndpoint;
    this.Session = deps.Session ?? CdpSession;
    this.rememberActive = deps.rememberActiveId ?? rememberActiveId;

    this.session = null;
    this.stopped = false;
    this.reconnectFailures = 0;
    // 按 sessionId 去重：同一会话的事件不会处理两遍
    this.handledSessions = new Set();
    // 按 targetId 去重：一个窗口可能有多个会话，但只注入一次（targetId 是 UUID，不复用，不需要清理）
    this.handledTargets = new Set();
    this.injectedTargets = new Set();
    this.stats = { attached: 0, injected: 0, resumed: 0, errors: 0 };
  }

  /** 连上 browser 端点并开始自动附加。返回时已经挂好，后续由事件驱动。 */
  async start() {
    if (this.stopped) throw new Error("skin guard has been stopped");
    await this.connect();
  }

  async connect() {
    const endpoint = await this.waitForBrowser(this.port, {
      timeoutMs: this.connectTimeoutMs,
      pollMs: 250,
    });
    if (this.stopped) return;

    const session = new this.Session(endpoint.webSocketDebuggerUrl, {
      // browser 级会话没有 Runtime/Page 域，一个都不能开
      domains: [],
    });
    this.session = session;

    session.on("Target.attachedToTarget", (params) => {
      void this.handleAttached(params).catch((error) => this.reportError("附加处理", error));
    });
    session.on("Target.detachedFromTarget", ({ sessionId, targetId }) => {
      if (typeof sessionId === "string") this.handledSessions.delete(sessionId);
      if (typeof targetId === "string") this.injectedTargets.delete(targetId);
    });
    // 渲染进程里切换皮肤时，注入脚本调用我们挂上去的绑定函数，这里收到就落盘。
    // sessionId 在消息顶层（flatten 模式），不在 params 里。
    session.on("Runtime.bindingCalled", (params, message) => {
      this.handleBindingCalled(params, message?.sessionId);
    });
    session.onClose((error) => {
      if (this.stopped) return;
      this.log(`CDP 连接断开（${error?.message ?? "unknown"}），准备重连`);
      void this.scheduleReconnect();
    });

    await session.open();
    if (this.stopped) return;

    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      // 关键：新 target 出生即暂停，我们才有机会在它的文档创建前插手
      waitForDebuggerOnStart: true,
      // 扁平化：子会话命令直接带 sessionId 发，不用嵌一层 sendMessageToTarget
      flatten: true,
    });

    this.reconnectFailures = 0;
    this.log(`已挂上 browser 端点（${endpoint.browser ?? "unknown"}），等待渲染进程`);

    // setAutoAttach 只管"之后新出现的" target —— 已经在跑的主窗口不会触发事件，
    // 必须主动把它捞出来 attach，否则启动时就漏掉主窗口（只剩新窗口有皮肤）。
    await this.attachExistingTargets();
  }

  async attachExistingTargets() {
    // setAutoAttach 会把它启动时"已经在跑"的 target 一并附加上（实测会），
    // 而那种自动附加出来的会话才是能活过页面重载的一种。先给它一点时间把事件
    // 送过来，免得同一个窗口又被我们手动 attach 一次、平白多出一个短命会话。
    await sleep(300);
    const { targetInfos } = await this.session.send("Target.getTargets");
    let attached = 0;
    for (const info of targetInfos ?? []) {
      if (info?.type !== "page" || typeof info?.targetId !== "string") continue;
      if (this.handledTargets.has(info.targetId)) continue; // 自动附加已经接管了
      try {
        const result = await this.session.send("Target.attachToTarget", {
          targetId: info.targetId,
          flatten: true,
        });
        attached += 1;
        // 正常情况下 attachedToTarget 事件会带着同一个 sessionId 到达并由它处理；
        // 这里补一道：万一该 build 不发事件，也不会漏掉这个窗口。
        if (typeof result?.sessionId === "string" && !this.handledSessions.has(result.sessionId)) {
          await this.handleAttached({
            sessionId: result.sessionId,
            targetInfo: info,
            waitingForDebugger: false,
          });
        }
      } catch (error) {
        this.reportError(`附加已有窗口 ${shortId(info.targetId)}`, error);
      }
    }
    if (attached > 0) this.log(`补齐了 ${attached} 个已在运行的窗口`);
  }

  /**
   * 一个 target 被附加上了。
   *
   * 三种情况要分清：
   *   - 还没导航（about:blank / 空 url）：靠 addScriptToEvaluateOnNewDocument 等着它加载；
   *   - 已经是渲染页（我们的脚本注入晚了）：立刻 evaluate 补一次；
   *   - 别的页面（设置窗口之外的其它 webContents）：只装脚本，不立刻注入。
   */
  async handleAttached({ sessionId, targetInfo, waitingForDebugger }) {
    if (this.stopped) return;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (this.handledSessions.has(sessionId)) return;
    this.handledSessions.add(sessionId);

    // 非页面 target（worker / service worker …）不注入，但**必须放行** ——
    // 它同样被 waitForDebuggerOnStart 暂停着，卡住它一样会让应用出问题。
    if (targetInfo?.type !== "page") {
      await this.resumeIfWaiting(sessionId, waitingForDebugger);
      return;
    }

    this.stats.attached += 1;
    const url = typeof targetInfo?.url === "string" ? targetInfo.url : "";
    const isRendererPage = url.includes(this.urlHint);
    const targetId = typeof targetInfo?.targetId === "string" ? targetInfo.targetId : null;

    // 同一个窗口会拿到**两个会话**：setAutoAttach 自动附加一个，attachExistingTargets
    // 又显式附加了一个。首屏脚本必须**每个会话都注册**（原因见 inject 里的长注释）——
    // 这两种会话的寿命不一样，只挑一个注册就会栽在短命的那个上。
    // 即时注入与状态同步则只做一次，否则同一窗口会被注入两遍。
    const targetKey = targetId ?? sessionId;
    const firstSessionForTarget = !this.handledTargets.has(targetKey);
    if (firstSessionForTarget) this.handledTargets.add(targetKey);

    const injection = this.inject(sessionId, targetId, { isRendererPage, url, firstSessionForTarget });

    if (waitingForDebugger) {
      // 暂停态最多占用这么久，超时就放行 —— 白屏比"没皮肤"严重得多
      await Promise.race([injection, sleep(this.attachTimeoutMs)]);
      await this.resumeIfWaiting(sessionId, waitingForDebugger);
    } else {
      await injection;
    }
  }

  async inject(sessionId, targetId, { isRendererPage, url, firstSessionForTarget }) {
    const label = shortId(targetId ?? sessionId);

    // ① 上报通道：注入脚本一启动就会调用一次 writeLastTheme（把当前主题记进
    //    localStorage），那一刻 binding 必须已经存在，否则第一次变更会丢。
    //    Runtime.enable 是为了收 Runtime.bindingCalled —— 该事件走 Runtime 域。
    //    binding 和下面的首屏脚本一样是**会话级**的，所以每个会话都要挂一遍。
    if (isRendererPage) {
      try {
        await this.session.send("Runtime.enable", {}, { sessionId });
        await this.session.send("Runtime.addBinding", { name: REPORT_BINDING }, { sessionId });
      } catch (error) {
        this.reportError(`挂载上报通道 ${label}`, error);
      }
    }

    // ② 首屏脚本：注册在**会话**上，而会话有两种来源、寿命不一样 ——
    //    - setAutoAttach 自动附加出来的：实测能活过页面重载；
    //    - Target.attachToTarget 显式附加出来的：实测**活不过重载**，注册的脚本随之失效
    //      （两个会话各注册一份探针，重载后只有前者还活着）。
    //    既然分不清谁先到，就每个会话都注册一份。重复注册的代价是脚本在新文档里多跑
    //    一次，而注入脚本本身幂等（旧实例会先被 dispose），这个代价可以接受。
    try {
      await this.session.send("Page.enable", {}, { sessionId });
      await this.session.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: this.expression },
        { sessionId },
      );
    } catch (error) {
      this.reportError(`挂载首屏脚本 ${label}`, error);
    }

    // ②.5 复检一次：target 从 about:blank 走到真实渲染页，可能就发生在我们注册
    //      首屏脚本的这几毫秒里。而 addScriptToEvaluateOnNewDocument 只对**之后**
    //      创建的文档生效 —— 已经建好的那个文档吃不到它，窗口会一直裸着。
    //      实测（2026-09-29）：国内版设置窗口的日志停在「已预置首屏脚本 10970EF6
    //      （等待导航）」，之后杳无音信，设置里也就看不到插件入口；手动 reload 一次
    //      皮肤立刻全好 —— 典型的"错过首次导航"。
    //      所以这里重新问一次当前 URL：窗口若仍被 waitForDebuggerOnStart 暂停着，
    //      Runtime.evaluate 会因没有执行上下文而失败，那就确实是"还没导航"，
    //      照旧等首屏脚本生效即可。
    let ready = isRendererPage;
    if (!ready) {
      try {
        const current = await this.session.send(
          "Runtime.evaluate",
          { expression: "location.href", returnByValue: true },
          { sessionId },
        );
        ready = String(current?.result?.value ?? "").includes(this.urlHint);
      } catch {
        /* 还没有执行上下文 = 真的还没导航 */
      }
    }

    if (!ready) {
      this.log(`已预置首屏脚本 ${label}（等待导航）`);
      return;
    }

    // ③ 即时注入只做一次：文档已经加载完了（attach 迟到的场合）补一次，
    //    同一窗口的第二个会话再注入一遍只会让界面白白重建一次。
    if (!firstSessionForTarget) return;
    if (!isRendererPage) this.log(`补注入 ${label}（注册期间已完成导航）`);

    try {
      // 文档已经加载完了（attach 迟到的场合），补一次即时注入
      const response = await this.session.send(
        "Runtime.evaluate",
        { expression: this.expression, awaitPromise: true, returnByValue: true },
        { sessionId },
      );
      // send 不检查业务层异常（那是 evaluate() 的职责），这里手动兜一道：
      // 注入脚本抛错必须可见，否则表现只是"没皮肤"，排查会很痛苦。
      if (response?.exceptionDetails) {
        const detail =
          response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "unknown JavaScript exception";
        throw new Error(detail);
      }
      this.stats.injected += 1;
      if (targetId) this.injectedTargets.add(targetId);
      this.log(`已注入 ${label}（${url.slice(0, 60)}${url.length > 60 ? "…" : ""}）`);
      await this.syncActiveFromRenderer(sessionId, label);
    } catch (error) {
      this.reportError(`即时注入 ${label}`, error);
    }
  }

  /**
   * 把渲染进程里已经生效的那套皮肤补记进状态文档。
   *
   * 守护启动时状态文档可能落后于现实（比如上个会话是 cli apply 注入的、
   * 没走过上报通道）。以页面上的 data-* 为准补一次，文档才不会指着一套旧皮肤。
   */
  async syncActiveFromRenderer(sessionId, label) {
    const { result } = await this.session.send(
      "Runtime.evaluate",
      {
        expression: "document.documentElement.dataset.anonbuddySkin ?? null",
        returnByValue: true,
      },
      { sessionId },
    );
    const current = result?.value;
    if (typeof current !== "string" || current.length === 0) return;
    try {
      this.rememberActive(current, { source: "sync" });
      this.log(`状态已对齐：${current}`);
    } catch (error) {
      this.reportError(`同步状态文档 ${label}`, error);
    }
  }

  /** 渲染进程上报"现在用的是哪套皮肤"→ 写状态文档。 */
  handleBindingCalled(params, sessionId) {
    if (params?.name !== REPORT_BINDING) return;
    if (typeof params?.payload !== "string") return;
    let parsed;
    try {
      parsed = JSON.parse(params.payload);
    } catch {
      return;
    }
    if (parsed?.type !== "active") return;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) return;
    try {
      const written = this.rememberActive(parsed.id, { source: "renderer" });
      if (written) this.log(`状态已记录：${parsed.id}（${shortId(sessionId)}）`);
    } catch (error) {
      this.reportError("写状态文档", error);
    }
  }

  async resumeIfWaiting(sessionId, waitingForDebugger) {
    if (!waitingForDebugger) return;
    try {
      await this.session.send(
        "Runtime.runIfWaitingForDebugger",
        {},
        { sessionId, timeoutMs: 3000 },
      );
      this.stats.resumed += 1;
    } catch (error) {
      // 放行失败 = 那个窗口会一直白屏。这条必须响。
      this.reportError(`放行 ${shortId(sessionId)}`, error);
    }
  }

  async scheduleReconnect() {
    if (this.stopped) return;
    // 只清会话级记录：targetId 记录要留着 —— target 还在，重连后不该再注入一遍
    this.handledSessions.clear();
    this.reconnectFailures += 1;
    if (this.reconnectFailures > this.maxReconnectFailures) {
      this.log(`连续 ${this.reconnectFailures} 次连接失败，守护退出（应用大概已经关了）`);
      this.stopped = true;
      return;
    }
    await sleep(this.reconnectDelayMs * this.reconnectFailures);
    if (this.stopped) return;
    try {
      await this.connect();
    } catch (error) {
      this.reportError("重连", error);
      await this.scheduleReconnect();
    }
  }

  reportError(what, error) {
    this.stats.errors += 1;
    this.log(`${what}失败：${error instanceof Error ? error.message : String(error)}`);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.handledSessions.clear();
    try {
      this.session?.close();
    } catch {
      /* 关闭本身失败没有补救手段 */
    }
    this.session = null;
  }
}

export function createSkinGuard(options) {
  return new SkinGuard(options);
}
