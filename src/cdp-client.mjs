import { RENDERER_URL_HINT } from "./constants.mjs";

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_COMMAND_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;

// 连到 page target 时要打开的域；连到 browser target 时一个都不能开
// （browser 端点没有 Runtime/Page 域，发过去会被协议拒绝）。
const PAGE_DOMAINS = ["Runtime", "Page"];

function validatePort(port) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new TypeError(
      `port must be an integer from ${MIN_PORT} through ${MAX_PORT}`,
    );
  }
  return port;
}

function validateDuration(value, name, { allowZero }) {
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (!Number.isFinite(value) || value < minimum) {
    const qualifier = allowZero ? "non-negative" : "positive";
    throw new TypeError(`${name} must be a finite ${qualifier} number`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseLoopbackWebSocketUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError("webSocketDebuggerUrl must be a non-empty URL string");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`webSocketDebuggerUrl is invalid: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  if (
    parsed.protocol !== "ws:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.port
  ) {
    throw new TypeError(
      "webSocketDebuggerUrl must use ws://127.0.0.1 with an explicit port",
    );
  }

  validatePort(Number(parsed.port));
  return parsed;
}

// WorkBuddy 的 renderer: file:///.../app.asar/renderer/index.html
function isRendererTarget(target) {
  if (
    target === null ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    target.type !== "page" ||
    typeof target.url !== "string" ||
    !target.url.includes(RENDERER_URL_HINT)
  ) {
    return false;
  }

  try {
    parseLoopbackWebSocketUrl(target.webSocketDebuggerUrl);
    return true;
  } catch {
    return false;
  }
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareTargets(left, right) {
  const leftKeys = [
    String(left.id ?? ""),
    left.url,
    left.webSocketDebuggerUrl,
  ];
  const rightKeys = [
    String(right.id ?? ""),
    right.url,
    right.webSocketDebuggerUrl,
  ];

  for (let index = 0; index < leftKeys.length; index += 1) {
    const comparison = compareText(leftKeys[index], rightKeys[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function sleepWithTimer(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function awaitBeforeDeadline(
  promise,
  { deadline, timeoutMs, label, onTimeout },
) {
  const remainingMs = Math.max(0, deadline - Date.now());
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function buildHttpError(response) {
  const status = Number.isInteger(response?.status)
    ? String(response.status)
    : "unknown status";
  const statusText =
    typeof response?.statusText === "string" && response.statusText.length > 0
      ? ` ${response.statusText}`
      : "";
  return new Error(`renderer target discovery failed with HTTP ${status}${statusText}`);
}

function buildCdpError(method, payload) {
  const code = payload && Object.hasOwn(payload, "code") ? payload.code : undefined;
  const message =
    typeof payload?.message === "string" ? payload.message : "unknown CDP error";
  const codeText = code === undefined ? "" : ` (${code})`;
  const error = new Error(`CDP ${method} failed${codeText}: ${message}`);
  error.name = "CdpProtocolError";
  if (code !== undefined) error.code = code;
  if (payload && Object.hasOwn(payload, "data")) error.data = payload.data;
  return error;
}

function buildEvaluationError(exceptionDetails) {
  const description = exceptionDetails?.exception?.description;
  const text = exceptionDetails?.text;
  const detail =
    typeof description === "string" && description.length > 0
      ? description
      : typeof text === "string" && text.length > 0
        ? text
        : "unknown JavaScript exception";
  const error = new Error(`Runtime.evaluate failed: ${detail}`);
  error.name = "CdpEvaluationError";
  error.exceptionDetails = exceptionDetails;
  return error;
}

export function filterRendererTargets(targets) {
  if (!Array.isArray(targets)) {
    throw new TypeError("renderer targets must be an array");
  }
  return targets.filter(isRendererTarget).sort(compareTargets);
}

export async function fetchRendererTargets(
  port,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  } = {},
) {
  validatePort(port);
  validateDuration(timeoutMs, "timeoutMs", { allowZero: false });
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const endpoint = `http://127.0.0.1:${port}/json/list`;
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let response;
  try {
    response = await awaitBeforeDeadline(
      Promise.resolve(
        fetchImpl(endpoint, { redirect: "error", signal: controller.signal }),
      ),
      {
        deadline,
        timeoutMs,
        label: "renderer target discovery",
        onTimeout: () => controller.abort(),
      },
    );
  } catch (error) {
    throw new Error(
      `failed to fetch renderer targets from ${endpoint}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (response === null || typeof response !== "object" || response.ok !== true) {
    throw buildHttpError(response);
  }
  if (typeof response.json !== "function") {
    throw new Error("malformed renderer target response: missing JSON body reader");
  }

  let targets;
  try {
    targets = await awaitBeforeDeadline(Promise.resolve(response.json()), {
      deadline,
      timeoutMs,
      label: "renderer target discovery JSON",
      onTimeout: () => controller.abort(),
    });
  } catch (error) {
    throw new Error(
      `malformed renderer target JSON from ${endpoint}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(targets)) {
    throw new Error("malformed renderer target JSON: expected an array");
  }

  return filterRendererTargets(targets);
}

/**
 * 取 browser 级调试端点（不是某个页面，而是整个浏览器实例）。
 *
 * 只有走这个端点才能用 Target.setAutoAttach —— 那需要在渲染进程**诞生之前**
 * 就挂上去，page 级会话做不到（连上时页面早跑起来了）。
 */
export async function fetchBrowserEndpoint(
  port,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  } = {},
) {
  validatePort(port);
  validateDuration(timeoutMs, "timeoutMs", { allowZero: false });
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let response;
  try {
    response = await awaitBeforeDeadline(
      Promise.resolve(
        fetchImpl(endpoint, { redirect: "error", signal: controller.signal }),
      ),
      {
        deadline,
        timeoutMs,
        label: "browser endpoint discovery",
        onTimeout: () => controller.abort(),
      },
    );
  } catch (error) {
    throw new Error(
      `failed to fetch browser endpoint from ${endpoint}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (response === null || typeof response !== "object" || response.ok !== true) {
    throw buildHttpError(response);
  }
  if (typeof response.json !== "function") {
    throw new Error("malformed browser endpoint response: missing JSON body reader");
  }

  let payload;
  try {
    payload = await awaitBeforeDeadline(Promise.resolve(response.json()), {
      deadline,
      timeoutMs,
      label: "browser endpoint discovery JSON",
      onTimeout: () => controller.abort(),
    });
  } catch (error) {
    throw new Error(
      `malformed browser endpoint JSON from ${endpoint}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const wsUrl = payload?.webSocketDebuggerUrl;
  let parsed;
  try {
    parsed = parseLoopbackWebSocketUrl(wsUrl);
  } catch (error) {
    throw new Error(
      `browser endpoint did not advertise a usable webSocketDebuggerUrl: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  return {
    webSocketDebuggerUrl: wsUrl,
    browser: typeof payload?.Browser === "string" ? payload.Browser : null,
    protocolVersion:
      typeof payload?.["Protocol-Version"] === "string"
        ? payload["Protocol-Version"]
        : null,
    port: Number(parsed.port),
  };
}

export async function waitForBrowserEndpoint(
  port,
  {
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    fetchImpl = globalThis.fetch,
    sleep = sleepWithTimer,
  } = {},
) {
  validatePort(port);
  validateDuration(timeoutMs, "timeoutMs", { allowZero: true });
  validateDuration(pollMs, "pollMs", { allowZero: false });

  const deadline = Date.now() + timeoutMs;
  let lastError = new Error("no browser endpoint attempt completed");

  while (true) {
    try {
      return await fetchBrowserEndpoint(port, {
        fetchImpl,
        timeoutMs: Math.max(1, Math.min(2000, deadline - Date.now() || 1)),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for the browser endpoint on 127.0.0.1:${port}: ${lastError.message}`,
        { cause: lastError },
      );
    }
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

export async function waitForRendererTargets(
  port,
  {
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    fetchImpl = globalThis.fetch,
    sleep = sleepWithTimer,
  } = {},
) {
  validatePort(port);
  validateDuration(timeoutMs, "timeoutMs", { allowZero: true });
  validateDuration(pollMs, "pollMs", { allowZero: false });
  if (typeof sleep !== "function") {
    throw new TypeError("sleep must be a function");
  }

  let elapsedMs = 0;
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error("no renderer discovery attempt completed");

  while (true) {
    try {
      const remainingBudgetMs = Math.max(
        1,
        Math.min(timeoutMs - elapsedMs, deadline - Date.now()),
      );
      const targets = await fetchRendererTargets(port, {
        fetchImpl,
        timeoutMs: remainingBudgetMs,
      });
      if (targets.length > 0) return targets;
      lastError = new Error("no matching renderer/index.html page targets");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (elapsedMs >= timeoutMs || Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for renderer targets on 127.0.0.1:${port}: ${lastError.message}`,
        { cause: lastError },
      );
    }

    const delayMs = Math.min(pollMs, timeoutMs - elapsedMs);
    await sleep(delayMs);
    elapsedMs += delayMs;
  }
}

export class CdpSession {
  constructor(
    webSocketDebuggerUrl,
    {
      WebSocketImpl = globalThis.WebSocket,
      commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
      connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
      // 连上后自动开启的协议域。browser 级会话传 [] —— browser target 没有
      // Runtime/Page 域，照 page 那样 enable 会被协议直接拒绝。
      domains = PAGE_DOMAINS,
    } = {},
  ) {
    parseLoopbackWebSocketUrl(webSocketDebuggerUrl);
    if (typeof WebSocketImpl !== "function") {
      throw new TypeError("WebSocketImpl must be a WebSocket constructor");
    }
    validateDuration(commandTimeoutMs, "commandTimeoutMs", { allowZero: false });
    validateDuration(connectTimeoutMs, "connectTimeoutMs", { allowZero: false });
    if (
      !Array.isArray(domains) ||
      domains.some((domain) => typeof domain !== "string" || domain.length === 0)
    ) {
      throw new TypeError("domains must be an array of non-empty strings");
    }

    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.WebSocketImpl = WebSocketImpl;
    this.commandTimeoutMs = commandTimeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.domains = [...domains];
    this.eventListeners = new Map();
    this.closeHandlers = new Set();
    this.socket = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.socketOpen = false;
    this.opened = false;
    this.closed = false;
    this.closeStarted = false;
    this.terminalError = null;
    this.openPromise = null;
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.connectTimer = null;
  }

  open() {
    if (this.closed) {
      return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    }
    if (this.opened) return Promise.resolve(this);
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    this.connectTimer = setTimeout(() => {
      this.terminate(
        new Error(
          `CDP WebSocket connect timed out after ${this.connectTimeoutMs}ms`,
        ),
      );
      this.closeSocket();
    }, this.connectTimeoutMs);

    try {
      this.socket = new this.WebSocketImpl(this.webSocketDebuggerUrl);
    } catch (error) {
      this.terminate(
        new Error(`failed to open CDP WebSocket: ${errorMessage(error)}`, {
          cause: error,
        }),
      );
      return this.openPromise;
    }

    this.socket.onopen = () => {
      if (this.closed || this.socketOpen) return;
      this.clearConnectTimer();
      this.socketOpen = true;
      Promise.all(this.domains.map((domain) => this.send(`${domain}.enable`)))
        .then(() => {
          if (this.closed) return;
          this.opened = true;
          const resolve = this.resolveOpen;
          this.resolveOpen = null;
          this.rejectOpen = null;
          resolve?.(this);
        })
        .catch((error) => {
          this.terminate(error);
          this.closeSocket();
        });
    };
    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onerror = (event) => {
      const source = event?.error;
      const detail =
        source instanceof Error
          ? source.message
          : typeof event?.message === "string" && event.message.length > 0
            ? event.message
            : "unknown socket error";
      this.terminate(
        new Error(`CDP WebSocket error: ${detail}`, {
          cause: source instanceof Error ? source : undefined,
        }),
      );
      this.closeSocket();
    };
    this.socket.onclose = (event) => {
      this.closeStarted = true;
      const code = Number.isInteger(event?.code) ? event.code : "unknown";
      const reason =
        typeof event?.reason === "string" && event.reason.length > 0
          ? `, reason: ${event.reason}`
          : "";
      this.terminate(new Error(`CDP WebSocket closed (code: ${code}${reason})`));
    };

    return this.openPromise;
  }

  send(method, params = {}, { timeoutMs = this.commandTimeoutMs, sessionId = null } = {}) {
    if (this.closed) {
      return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    }
    if (!this.socketOpen || !this.socket) {
      return Promise.reject(new Error("CDP session is not open"));
    }
    if (typeof method !== "string" || method.length === 0) {
      return Promise.reject(new TypeError("CDP method must be a non-empty string"));
    }

    try {
      validateDuration(timeoutMs, "timeoutMs", { allowZero: false });
    } catch (error) {
      return Promise.reject(error);
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });

      try {
        const message = { id, method, params };
        // flatten 模式下，带 sessionId 的消息会被路由到对应子会话
        if (typeof sessionId === "string" && sessionId.length > 0) {
          message.sessionId = sessionId;
        }
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new Error(`failed to send CDP ${method}: ${errorMessage(error)}`, {
            cause: error,
          }),
        );
      }
    });
  }

  async evaluate(expression, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (typeof expression !== "string") {
      throw new TypeError("Runtime.evaluate expression must be a string");
    }

    const response = await this.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      { timeoutMs },
    );

    if (response?.exceptionDetails) {
      throw buildEvaluationError(response.exceptionDetails);
    }
    if (response?.result?.type === "undefined") return undefined;
    return response?.result?.value;
  }

  /**
   * 订阅 CDP 事件（服务端主动推的消息，没有 id）。
   *
   * 之前这里对无 id 的消息直接丢弃 —— 那时没人需要事件，而现在 auto-attach
   * 完全靠 Target.attachedToTarget 驱动，必须能收到。
   * 返回值是退订函数：调用它比在闭包里打标记可靠，避免 handler 堆积。
   */
  on(eventName, handler) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("eventName must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }
    let handlers = this.eventListeners.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this.eventListeners.set(eventName, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = this.eventListeners.get(eventName);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.eventListeners.delete(eventName);
    };
  }

  /** 事件分发给监听器。单个 handler 抛错不影响其它 handler，也不该毒死连接。 */
  dispatchEvent(message) {
    const handlers = this.eventListeners.get(message?.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.params ?? {}, message);
      } catch (error) {
        process.stderr.write(
          `AnonBuddy Skin：CDP 事件处理器抛错（${message.method}）：${errorMessage(error)}\n`,
        );
      }
    }
  }

  /**
   * 连接终止时回调（正常 close 或异常断开都会走）。常驻守护靠它决定何时重连。
   * 和 on() 不同：这个只会触发一次，触发后即被清空。
   */
  onClose(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }
    if (this.terminalError) {
      // 已经断了：异步补一次，别让调用方卡在"注册了却永远等不到"
      const error = this.terminalError;
      queueMicrotask(() => handler(error));
      return () => {};
    }
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close() {
    if (this.closeStarted) return;
    this.terminate(new Error("CDP session closed by client"));
    this.closeSocket();
  }

  handleMessage(event) {
    if (typeof event?.data !== "string") {
      this.terminate(new Error("received a non-text CDP WebSocket message"));
      this.closeSocket();
      return;
    }

    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      this.terminate(
        new Error(`received malformed CDP JSON: ${errorMessage(error)}`, {
          cause: error,
        }),
      );
      this.closeSocket();
      return;
    }

    if (!Number.isInteger(message?.id)) {
      // 没有 id：服务端事件（Target.attachedToTarget 等），交给订阅者
      this.dispatchEvent(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(buildCdpError(pending.method, message.error));
      return;
    }
    pending.resolve(message.result);
  }

  terminate(error) {
    if (this.terminalError) return;
    this.clearConnectTimer();
    this.terminalError = error;
    this.closed = true;
    this.socketOpen = false;

    if (this.closeHandlers.size > 0) {
      const handlers = [...this.closeHandlers];
      this.closeHandlers.clear();
      for (const handler of handlers) {
        try {
          handler(error);
        } catch (handlerError) {
          process.stderr.write(
            `AnonBuddy Skin：CDP 关闭回调抛错：${errorMessage(handlerError)}\n`,
          );
        }
      }
    }

    const rejectOpen = this.rejectOpen;
    this.resolveOpen = null;
    this.rejectOpen = null;
    rejectOpen?.(error);

    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  clearConnectTimer() {
    if (this.connectTimer === null) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  closeSocket() {
    if (this.closeStarted) return;
    this.closeStarted = true;
    if (!this.socket || typeof this.socket.close !== "function") return;

    const closing = this.WebSocketImpl.CLOSING ?? 2;
    const closed = this.WebSocketImpl.CLOSED ?? 3;
    if (this.socket.readyState === closing || this.socket.readyState === closed) return;
    this.socket.close();
  }
}
