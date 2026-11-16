const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  Notification,
  session,
  Menu,
  dialog,
  Tray,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { setupAutoUpdater } = require("./updater");
const avatarExtract = require("./avatar-extract");
const unreadExtract = require("./unread-extract");

const WHATSAPP_URL = "https://web.whatsapp.com";
const APP_USER_MODEL_ID = "com.alex.hatsapp";
const PROTOCOL = "hatsapp";
const chromeVersion = process.versions.chrome || "131.0.0.0";
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

app.setName("HatsApp");
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow = null;
let shellView = null;
let tray = null;
let isQuitting = false;
let accounts = [];
const views = new Map();
let activeAccountId = null;
let sidebarWidth = 240;
let layoutTimer = null;
let avatarTimer = null;
let unreadTimer = null;
let pendingNotifyLaunch = null;
const unreadByAccount = new Map();
let blankCheckSeq = 0;
let paintWatchTimer = null;
let lastInputLogAt = 0;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function blankLogPath() {
  return path.join(app.getPath("userData"), "blank-screen.log");
}

function blankShotDir() {
  return path.join(app.getPath("userData"), "blank-screen");
}

function diagLog(event, data = {}) {
  const line = `${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`;
  try {
    fs.appendFileSync(blankLogPath(), line, "utf8");
  } catch {}
  try {
    console.log("[blank-diag]", event, data);
  } catch {}
}

function findAccountIdForView(view) {
  for (const [id, v] of views) {
    if (v === view) return id;
  }
  return null;
}

function snapshotView(accountId, view) {
  const account = accounts.find((a) => a.id === accountId);
  const base = {
    accountId: accountId || null,
    accountName: account?.name || null,
    activeAccountId,
    destroyed: !view || view.webContents.isDestroyed(),
  };
  if (!view || view.webContents.isDestroyed()) return base;
  const children = mainWindow?.contentView?.children || [];
  let bounds = null;
  try {
    bounds = view.getBounds();
  } catch {}
  let visible = null;
  try {
    visible = typeof view.getVisible === "function" ? view.getVisible() : null;
  } catch {}
  let url = "";
  try {
    url = view.webContents.getURL();
  } catch {}
  return {
    ...base,
    attached: children.includes(view),
    childCount: children.length,
    visible,
    bounds,
    url,
    loading: view.webContents.isLoading(),
    crashed: view.webContents.isCrashed(),
    focused: view.webContents.isFocused(),
    backgroundThrottling: null,
  };
}

function snapshotAllViews() {
  return [...views.keys()].map((id) => snapshotView(id, views.get(id)));
}

async function probeDom(view) {
  try {
    return await view.webContents.executeJavaScript(
      `(() => {
        const body = document.body;
        const app = document.querySelector('#app, .app-wrapper-web, [data-testid="chat-list"], [data-testid="intro-md-beta-logo-dark"], [data-testid="intro-md-beta-logo-light"]');
        const canvas = document.querySelector('canvas');
        return {
          readyState: document.readyState,
          hidden: document.hidden,
          visibilityState: document.visibilityState,
          bodyChildren: body ? body.children.length : -1,
          hasApp: !!app,
          hasCanvas: !!canvas,
          title: document.title || "",
          url: location.href || "",
        };
      })()`,
      true
    );
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

async function samplePaint(view) {
  try {
    const img = await view.webContents.capturePage();
    const size = img.getSize();
    if (!size.width || !size.height) {
      return { ok: false, reason: "empty-capture", size };
    }
    const bitmap = img.toBitmap();
    const points = [
      [0.2, 0.2],
      [0.5, 0.5],
      [0.8, 0.3],
      [0.35, 0.7],
    ];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    let nearBg = 0;
    for (const [px, py] of points) {
      const x = Math.min(size.width - 1, Math.max(0, Math.floor(size.width * px)));
      const y = Math.min(size.height - 1, Math.max(0, Math.floor(size.height * py)));
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const xx = Math.min(size.width - 1, Math.max(0, x + dx));
          const yy = Math.min(size.height - 1, Math.max(0, y + dy));
          const i = (yy * size.width + xx) * 4;
          const bb = bitmap[i];
          const gg = bitmap[i + 1];
          const rr = bitmap[i + 2];
          r += rr;
          g += gg;
          b += bb;
          n += 1;
          if (Math.abs(rr - 11) <= 8 && Math.abs(gg - 20) <= 8 && Math.abs(bb - 26) <= 8) nearBg += 1;
          if (rr <= 18 && gg <= 18 && bb <= 18) nearBg += 1;
        }
      }
    }
    const avg = {
      r: Math.round(r / Math.max(n, 1)),
      g: Math.round(g / Math.max(n, 1)),
      b: Math.round(b / Math.max(n, 1)),
    };
    const nearRatio = nearBg / Math.max(n, 1);
    const luma = (avg.r * 299 + avg.g * 587 + avg.b * 114) / 1000;
    const blankLike = nearRatio >= 0.85 || luma <= 22;
    return { ok: true, size, avg, luma: Math.round(luma), nearRatio: Number(nearRatio.toFixed(3)), blankLike };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

async function checkActivePaint(reason, delayMs) {
  const accountId = activeAccountId;
  const view = accountId ? views.get(accountId) : null;
  if (!view || view.webContents.isDestroyed()) {
    diagLog("paint-check-skip", { reason, delayMs, accountId, cause: "missing-view" });
    return { blank: false, skipped: true };
  }
  const snap = snapshotView(accountId, view);
  const dom = await probeDom(view);
  const paint = await samplePaint(view);
  const blank =
    paint.blankLike === true ||
    (dom && dom.hasApp === false && !dom.error && delayMs >= 900) ||
    paint.ok === false;
  const payload = {
    reason,
    delayMs,
    blank,
    windowVisible: isMainVisible(),
    snap,
    dom,
    paint,
    all: snapshotAllViews(),
  };
  diagLog(blank ? "BLANK_SCREEN" : "paint-check", payload);
  if (blank && paint.ok) {
    try {
      fs.mkdirSync(blankShotDir(), { recursive: true });
      const img = await view.webContents.capturePage();
      const file = path.join(
        blankShotDir(),
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${accountId || "unknown"}.png`
      );
      fs.writeFileSync(file, img.toPNG());
      diagLog("blank-screenshot", { file, accountId });
    } catch (err) {
      diagLog("blank-screenshot-failed", { accountId, error: String(err?.message || err) });
    }
  }
  return payload;
}

function scheduleBlankChecks(reason) {
  const seq = ++blankCheckSeq;
  for (const delayMs of [250, 900, 2200]) {
    setTimeout(() => {
      if (seq !== blankCheckSeq) return;
      checkActivePaint(reason, delayMs).catch((err) => {
        diagLog("paint-check-error", { reason, delayMs, error: String(err?.message || err) });
      });
    }, delayMs);
  }
}

function isMainVisible() {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized()
  );
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function nudgeViewBounds(view, reason) {
  if (!view || view.webContents.isDestroyed()) return;
  const bounds = activeBounds();
  if (!bounds) return;
  diagLog("nudge-bounds", { reason, accountId: findAccountIdForView(view), bounds });
  restoreBoundsTwoStep(view, bounds, reason);
}

function applyThrottlingForWindowState() {
  const visible = isMainVisible();
  for (const [id, view] of views) {
    if (!view || view.webContents.isDestroyed()) continue;
    const shouldThrottle = !visible || id !== activeAccountId;
    try {
      view.webContents.setBackgroundThrottling(shouldThrottle);
    } catch {}
  }
  diagLog("throttling-sync", { visible, activeAccountId, viewCount: views.size });
}

function wireInputDiagnostics(webContents, label) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.on("before-input-event", (_event, input) => {
    if (!input) return;
    const interesting =
      input.type === "keyDown" &&
      (input.control || input.meta || input.alt || input.key === "F5" || input.key === "F12");
    if (!interesting) return;
    const now = Date.now();
    if (now - lastInputLogAt < 40) return;
    lastInputLogAt = now;
    diagLog("key-input", {
      label,
      activeAccountId,
      type: input.type,
      key: input.key,
      code: input.code,
      control: Boolean(input.control),
      alt: Boolean(input.alt),
      shift: Boolean(input.shift),
      meta: Boolean(input.meta),
    });
  });
}

function startPaintWatch() {
  if (paintWatchTimer) return;
  paintWatchTimer = setInterval(() => {
    if (!isMainVisible()) return;
    checkActivePaint("watch", 0)
      .then(async (result) => {
        if (!result || !result.blank) return;
        diagLog("watch-blank-detected", {
          activeAccountId,
          paint: result.paint,
          dom: result.dom,
        });
        const view = activeAccountId ? views.get(activeAccountId) : null;
        if (!view) return;
        nudgeViewBounds(view, "auto-recover");
        applyThrottlingForWindowState();
        setTimeout(() => {
          checkActivePaint("after-nudge", 0).catch(() => {});
        }, 200);
      })
      .catch(() => {});
  }, 8000);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function findProtocolUrl(argv = []) {
  return (argv || []).find((arg) => typeof arg === "string" && arg.startsWith(`${PROTOCOL}://`)) || null;
}

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function openNotificationTarget(accountId, notificationId, chatTitle) {
  focusMainWindow();
  if (accountId) switchAccount(accountId);
  setTimeout(() => {
    recoverActiveView();
    const id = accountId || activeAccountId;
    const view = id ? views.get(id) : null;
    if (!view || view.webContents.isDestroyed()) return;
    try {
      view.webContents.focus();
    } catch {}
    view.webContents
      .executeJavaScript(
        `window.__hatsappHandleNotificationClick(${JSON.stringify(
          notificationId || ""
        )}, ${JSON.stringify(chatTitle || "")})`
      )
      .catch(() => {});
  }, 250);
}

function handleProtocolLaunch(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL}:`) return false;
    if (parsed.hostname === "notify" || parsed.pathname.replace(/^\//, "") === "notify") {
      const accountId = parsed.searchParams.get("account") || "";
      const notificationId = parsed.searchParams.get("nid") || "";
      const chatTitle = parsed.searchParams.get("title") || "";
      if (!mainWindow) {
        pendingNotifyLaunch = { accountId, notificationId, chatTitle };
        return true;
      }
      openNotificationTarget(accountId, notificationId, chatTitle);
      return true;
    }
  } catch {}
  focusMainWindow();
  return true;
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch(
  "disable-features",
  "CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,IntensiveWakeUpThrottling"
);

function storePath() {
  return path.join(app.getPath("userData"), "accounts.json");
}

function avatarDir() {
  return path.join(app.getPath("userData"), "avatars");
}

function avatarFile(id) {
  return path.join(avatarDir(), `${id}.jpg`);
}

function readAvatarDataUrl(id) {
  try {
    const file = avatarFile(id);
    if (!fs.existsSync(file)) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

function accountsForShell() {
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    muted: Boolean(a.muted),
    unread: unreadByAccount.get(a.id) || 0,
    avatar: readAvatarDataUrl(a.id),
  }));
}

function loadAccounts() {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const data = JSON.parse(raw);
    accounts = (Array.isArray(data.accounts) ? data.accounts : []).map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      muted: Boolean(a.muted),
    }));
    activeAccountId = data.activeAccountId || accounts[0]?.id || null;
  } catch {
    accounts = [];
    activeAccountId = null;
  }
}

function saveAccounts() {
  const persisted = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    muted: Boolean(a.muted),
  }));
  fs.writeFileSync(
    storePath(),
    JSON.stringify({ accounts: persisted, activeAccountId }, null, 2),
    "utf8"
  );
}

function setUnread(accountId, count) {
  const next = Math.max(0, Math.min(99, Number(count) || 0));
  const prev = unreadByAccount.get(accountId) || 0;
  if (prev === next) return false;
  unreadByAccount.set(accountId, next);
  return true;
}

function raiseView(view) {
  if (!mainWindow || !view) return;
  try {
    mainWindow.contentView.addChildView(view);
  } catch {}
}

function setViewAttached(view, attached) {
  if (!mainWindow || !view) return;
  const children = mainWindow.contentView.children || [];
  const isAttached = children.includes(view);
  const accountId = findAccountIdForView(view);
  if (attached && !isAttached) {
    mainWindow.contentView.addChildView(view);
    if (shellView) mainWindow.contentView.addChildView(shellView);
    diagLog("attach", { accountId, attached: true });
  } else if (!attached && isAttached) {
    mainWindow.contentView.removeChildView(view);
    diagLog("detach", { accountId, attached: false });
  }
}

function activeBounds() {
  if (!mainWindow) return null;
  const [width, height] = mainWindow.getContentSize();
  const bounds = {
    x: sidebarWidth,
    y: 0,
    width: Math.max(width - sidebarWidth, 0),
    height,
  };
  if (bounds.width < 2 || bounds.height < 2) return null;
  return bounds;
}

function parkBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const [width, height] = mainWindow.getContentSize();
  return {
    x: Math.max(0, width - 1),
    y: Math.max(0, height - 1),
    width: 1,
    height: 1,
  };
}

function isParkedBounds(bounds) {
  return Boolean(bounds && (bounds.width <= 1 || bounds.height <= 1));
}

const wakeRestoreTimers = new WeakMap();

function restoreBoundsTwoStep(view, bounds, reason) {
  if (!view || view.webContents.isDestroyed() || !bounds) return;
  const existing = wakeRestoreTimers.get(view);
  if (existing) clearTimeout(existing);
  try {
    view.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(1, bounds.height - 1),
    });
  } catch {}
  const timer = setTimeout(() => {
    wakeRestoreTimers.delete(view);
    try {
      if (!view.webContents.isDestroyed()) view.setBounds(bounds);
    } catch {}
    diagLog("bounds-restore-complete", {
      reason,
      accountId: findAccountIdForView(view),
      bounds,
    });
  }, 150);
  wakeRestoreTimers.set(view, timer);
}

function wakeView(view, bounds, options = {}) {
  if (!view || view.webContents.isDestroyed() || !bounds) return;
  const accountId = findAccountIdForView(view);
  let currentBounds = null;
  try {
    currentBounds = view.getBounds();
  } catch {}
  const windowVisible = isMainVisible();
  const wasParked = isParkedBounds(currentBounds);
  const alreadyAwake = !wasParked && sameBounds(currentBounds, bounds) && !options.force;

  setViewAttached(view, true);
  if (typeof view.setVisible === "function") view.setVisible(true);
  raiseView(view);
  try {
    view.webContents.setBackgroundThrottling(!windowVisible);
  } catch {}

  if (!alreadyAwake) {
    if (wasParked || options.force) restoreBoundsTwoStep(view, bounds, options.force ? "force-wake" : "wake-from-park");
    else {
      try {
        view.setBounds(bounds);
      } catch {}
    }
  }

  if (shellView) raiseView(shellView);

  if (options.focus && windowVisible) {
    try {
      view.webContents.focus();
    } catch {}
  }
  diagLog("wake", {
    accountId,
    focus: Boolean(options.focus),
    windowVisible,
    wasParked,
    alreadyAwake,
    snap: snapshotView(accountId, view),
  });
}

function hibernateView(view) {
  if (!view || view.webContents.isDestroyed()) return;
  const accountId = findAccountIdForView(view);
  let currentBounds = null;
  try {
    currentBounds = view.getBounds();
  } catch {}
  if (isParkedBounds(currentBounds)) {
    try {
      view.webContents.setBackgroundThrottling(true);
    } catch {}
    return;
  }
  try {
    view.webContents.setBackgroundThrottling(true);
  } catch {}
  setViewAttached(view, true);
  if (typeof view.setVisible === "function") view.setVisible(true);
  const parked = parkBounds();
  try {
    view.setBounds(parked);
  } catch {}
  diagLog("hibernate-park", { accountId, parked, snap: snapshotView(accountId, view) });
}

function layoutShell(height) {
  if (!shellView) return;
  shellView.setBounds({
    x: 0,
    y: 0,
    width: Math.max(sidebarWidth, 1),
    height,
  });
}

function layoutViews() {
  if (!mainWindow) return;
  const [, height] = mainWindow.getContentSize();
  layoutShell(height);
  const bounds = activeBounds();
  diagLog("layout", {
    activeAccountId,
    bounds,
    viewCount: views.size,
    all: snapshotAllViews(),
  });

  for (const [id, view] of views) {
    if (id === activeAccountId) continue;
    hibernateView(view);
  }
  const activeView = activeAccountId ? views.get(activeAccountId) : null;
  if (activeView && bounds) wakeView(activeView, bounds);

  if (shellView && mainWindow) {
    setViewAttached(shellView, true);
    raiseView(shellView);
    layoutShell(height);
  }
}

function scheduleLayoutViews() {
  if (layoutTimer) return;
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    layoutViews();
  }, 16);
}

function recoverActiveView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const view = activeAccountId ? views.get(activeAccountId) : null;
  const bounds = activeBounds();
  diagLog("recover", { activeAccountId, hasView: Boolean(view), bounds });
  if (!view || view.webContents.isDestroyed() || !bounds) {
    layoutViews();
    scheduleBlankChecks("recover-missing");
    return;
  }
  wakeView(view, bounds, { focus: true, force: true });
  if (shellView && mainWindow) {
    setViewAttached(shellView, true);
    raiseView(shellView);
    layoutShell(bounds.height || mainWindow.getContentSize()[1]);
  }
  scheduleBlankChecks("recover");
}

function accountColor(id) {
  const palette = ["#25D366", "#128C7E", "#34B7F1", "#F5A623", "#E74C3C", "#9B59B6"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * 17) % palette.length;
  return palette[hash];
}

function isWhatsAppUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "web.whatsapp.com" || parsed.hostname.endsWith(".web.whatsapp.com"))
    );
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    shell.openExternal(parsed.toString()).catch(() => {});
  } catch {}
}

function focusShellView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!mainWindow.isFocused()) mainWindow.focus();
  } catch {}
  if (!shellView || shellView.webContents.isDestroyed()) return;
  try {
    shellView.webContents.focus();
  } catch {}
}

function createAccountView(account) {
  if (views.has(account.id)) return views.get(account.id);

  const partition = `persist:wa-${account.id}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "notifications" || permission === "media");
  });

  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, "preload-whatsapp.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  view.setBackgroundColor("#0b141a");

  view.webContents.setUserAgent(CHROME_UA);
  view.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, url) => {
    if (isWhatsAppUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  wireInputDiagnostics(view.webContents, `wa:${account.id}`);
  try {
    view.webContents.setBackgroundThrottling(!(isMainVisible() && account.id === activeAccountId));
  } catch {}

  const hookPath = path.join(__dirname, "whatsapp-notification-hook.js");
  const installHooks = () => {
    const hookCode = fs.readFileSync(hookPath, "utf8");
    view.webContents
      .executeJavaScript(
        `${hookCode}; window.__WA_ACCOUNT__ = ${JSON.stringify({
          id: account.id,
          name: account.name,
          color: account.color,
        })}; true;`
      )
      .catch(() => {});
  };

  view.webContents.on("dom-ready", installHooks);
  view.webContents.on("did-finish-load", () => {
    installHooks();
    setTimeout(() => refreshAccountAvatar(account.id), 2500);
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    diagLog("render-process-gone", {
      accountId: account.id,
      accountName: account.name,
      details,
      wasActive: account.id === activeAccountId,
    });
    if (details?.reason === "clean-exit") return;
    setTimeout(() => {
      const current = views.get(account.id);
      if (!current || current.webContents.isDestroyed()) {
        createAccountView(account);
        layoutViews();
        if (account.id === activeAccountId) scheduleBlankChecks("after-crash-recreate");
        return;
      }
      try {
        current.webContents.reload();
        if (account.id === activeAccountId) scheduleBlankChecks("after-crash-reload");
      } catch {
        destroyAccountView(account.id);
        createAccountView(account);
        layoutViews();
        if (account.id === activeAccountId) scheduleBlankChecks("after-crash-rebuild");
      }
    }, 500);
  });
  view.webContents.on("unresponsive", () => {
    diagLog("unresponsive", { accountId: account.id, accountName: account.name });
  });
  view.webContents.on("responsive", () => {
    diagLog("responsive", { accountId: account.id, accountName: account.name });
  });

  view.webContents.loadURL(WHATSAPP_URL);
  views.set(account.id, view);
  diagLog("create-view", { accountId: account.id, accountName: account.name, activeAccountId });
  if (account.id !== activeAccountId) hibernateView(view);
  else layoutViews();
  return view;
}

async function refreshAccountAvatar(accountId) {
  const account = accounts.find((a) => a.id === accountId);
  const view = views.get(accountId);
  if (!account || !view || view.webContents.isDestroyed()) return false;
  let dataUrl = null;
  try {
    dataUrl = await view.webContents.executeJavaScript(avatarExtract, true);
  } catch {
    return false;
  }
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) return false;
  try {
    fs.mkdirSync(avatarDir(), { recursive: true });
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const nextBuf = Buffer.from(base64, "base64");
    const file = avatarFile(accountId);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(nextBuf)) return true;
    fs.writeFileSync(file, nextBuf);
    sendAccountState();
    return true;
  } catch {
    return false;
  }
}

function refreshAllAvatars() {
  for (const account of accounts) {
    refreshAccountAvatar(account.id);
  }
}

function startAvatarPolling() {
  if (avatarTimer) return;
  avatarTimer = setInterval(() => {
    const missing = accounts.some((a) => !fs.existsSync(avatarFile(a.id)));
    if (missing) refreshAllAvatars();
  }, 60000);
  setTimeout(refreshAllAvatars, 4000);
  setTimeout(refreshAllAvatars, 20000);
}

async function refreshAccountUnread(accountId) {
  const view = views.get(accountId);
  if (!view || view.webContents.isDestroyed()) return false;
  let count = 0;
  try {
    count = await view.webContents.executeJavaScript(unreadExtract, true);
  } catch {
    return false;
  }
  if (typeof count !== "number" || !Number.isFinite(count)) count = 0;
  return setUnread(accountId, count);
}

async function refreshAllUnreads() {
  let changed = false;
  for (const account of accounts) {
    const did = await refreshAccountUnread(account.id);
    if (did) changed = true;
  }
  if (changed) sendAccountState();
}

function startUnreadPolling() {
  if (unreadTimer) return;
  unreadTimer = setInterval(() => {
    refreshAllUnreads();
  }, 5000);
  setTimeout(refreshAllUnreads, 4000);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  try {
    app.focus({ steal: true });
  } catch {}
  setTimeout(() => recoverActiveView(), 0);
}

function appIconPath() {
  const png = path.join(__dirname, "assets", "icon.png");
  if (fs.existsSync(png)) return png;
  return path.join(__dirname, "assets", "tray.png");
}

function createTray() {
  if (tray) return;
  let icon = nativeImage.createFromPath(appIconPath());
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip("HatsApp");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open HatsApp",
        click: () => focusMainWindow(),
      },
      {
        label: "Log blank screen now",
        click: () => {
          diagLog("manual-blank-report", {
            activeAccountId,
            all: snapshotAllViews(),
          });
          scheduleBlankChecks("manual");
        },
      },
      {
        label: "Open blank-screen logs",
        click: () => {
          try {
            fs.mkdirSync(blankShotDir(), { recursive: true });
            if (!fs.existsSync(blankLogPath())) fs.writeFileSync(blankLogPath(), "", "utf8");
            shell.showItemInFolder(blankLogPath());
          } catch {}
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => focusMainWindow());
  tray.on("double-click", () => focusMainWindow());
}

function showUnifiedNotification(account, payload) {
  if (account.muted) return;
  if (!Notification.isSupported()) return;
  const title = `${account.name}: ${payload.title || "WhatsApp"}`;
  const body = payload.body || "";
  const notificationId = payload.id || "";
  const chatTitle = payload.title || "";
  const launch = `${PROTOCOL}://notify?account=${encodeURIComponent(
    account.id
  )}&nid=${encodeURIComponent(notificationId)}&title=${encodeURIComponent(chatTitle)}`;
  const toastXml = `<toast launch="${escapeXml(launch)}" activationType="protocol">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title)}</text>
      <text>${escapeXml(body)}</text>
    </binding>
  </visual>
</toast>`;
  const n = new Notification({
    toastXml,
    silent: false,
  });
  n.on("click", () => {
    openNotificationTarget(account.id, notificationId, chatTitle);
  });
  n.show();
}

function switchAccount(id) {
  if (!accounts.find((a) => a.id === id)) return;
  const prev = activeAccountId;
  activeAccountId = id;
  diagLog("switch", {
    from: prev,
    to: id,
    toName: accounts.find((a) => a.id === id)?.name || null,
    viewCount: views.size,
  });
  createAccountView(accounts.find((a) => a.id === id));
  layoutViews();
  const view = views.get(id);
  const bounds = activeBounds();
  if (view && bounds) wakeView(view, bounds, { focus: true, force: true });
  saveAccounts();
  sendAccountState();
  scheduleBlankChecks("switch");
  setTimeout(() => refreshAccountUnread(id).then((did) => did && sendAccountState()), 1500);
}

function reloadAccountView(id) {
  const account = accounts.find((a) => a.id === id);
  if (!account) return { ok: false };
  const view = views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    try {
      view.webContents.reload();
      return { ok: true };
    } catch {}
  }
  destroyAccountView(id);
  createAccountView(account);
  layoutViews();
  return { ok: true };
}

function sendAccountState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send("accounts-updated", {
    accounts: accountsForShell(),
    activeAccountId,
  });
}

function createWindow() {
  mainWindow = new BaseWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "HatsApp",
    backgroundColor: "#0b141a",
    icon: appIconPath(),
  });

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-shell.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  shellView.setBackgroundColor("#0b141a");

  mainWindow.contentView.addChildView(shellView);
  shellView.webContents.loadFile(path.join(__dirname, "shell.html"));
  wireInputDiagnostics(shellView.webContents, "shell");

  mainWindow.on("resize", scheduleLayoutViews);
  mainWindow.on("show", () => {
    diagLog("window-show", { activeAccountId });
    setTimeout(() => {
      applyThrottlingForWindowState();
      recoverActiveView();
      const view = activeAccountId ? views.get(activeAccountId) : null;
      if (view) nudgeViewBounds(view, "window-show");
    }, 0);
  });
  mainWindow.on("restore", () => {
    diagLog("window-restore", { activeAccountId });
    setTimeout(() => {
      applyThrottlingForWindowState();
      recoverActiveView();
      const view = activeAccountId ? views.get(activeAccountId) : null;
      if (view) nudgeViewBounds(view, "window-restore");
    }, 0);
  });
  mainWindow.on("hide", () => {
    diagLog("window-hide", { activeAccountId });
    for (const view of views.values()) {
      try {
        if (!view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(true);
      } catch {}
    }
  });
  mainWindow.on("minimize", () => {
    diagLog("window-minimize", { activeAccountId });
    for (const view of views.values()) {
      try {
        if (!view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(true);
      } catch {}
    }
  });
  mainWindow.on("focus", () => {
    diagLog("window-focus", { activeAccountId });
    applyThrottlingForWindowState();
  });
  mainWindow.on("blur", () => {
    diagLog("window-blur", { activeAccountId });
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    shellView = null;
    views.clear();
  });

  shellView.webContents.on("did-finish-load", () => {
    if (!activeAccountId && accounts[0]) activeAccountId = accounts[0].id;
    const active = accounts.find((a) => a.id === activeAccountId);
    if (active) createAccountView(active);
    layoutViews();
    sendAccountState();
    setTimeout(() => {
      for (const account of accounts) {
        if (!views.has(account.id)) createAccountView(account);
      }
      layoutViews();
    }, 8000);
  });

  layoutViews();
}

ipcMain.handle("get-accounts", () => ({
  accounts: accountsForShell(),
  activeAccountId,
}));

ipcMain.handle("add-account", (_e, name) => {
  const account = {
    id: randomUUID(),
    name: (name || "").trim() || `Account ${accounts.length + 1}`,
    color: "",
  };
  account.color = accountColor(account.id);
  account.muted = false;
  accounts.push(account);
  activeAccountId = account.id;
  createAccountView(account);
  saveAccounts();
  layoutViews();
  sendAccountState();
  return { accounts: accountsForShell(), activeAccountId };
});

ipcMain.handle("rename-account", (_e, { id, name }) => {
  const account = accounts.find((a) => a.id === id);
  if (!account) return { accounts: accountsForShell(), activeAccountId };
  account.name = (name || "").trim() || account.name;
  saveAccounts();
  sendAccountState();
  return { accounts: accountsForShell(), activeAccountId };
});

ipcMain.handle("reorder-accounts", (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) {
    return { accounts: accountsForShell(), activeAccountId };
  }
  const map = new Map(accounts.map((a) => [a.id, a]));
  const next = [];
  for (const id of orderedIds) {
    const account = map.get(id);
    if (account) {
      next.push(account);
      map.delete(id);
    }
  }
  for (const account of map.values()) next.push(account);
  accounts = next;
  saveAccounts();
  sendAccountState();
  return { accounts: accountsForShell(), activeAccountId };
});

function bringMainForward() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    app.focus({ steal: true });
  } catch {}
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false);
    } catch {}
  }, 500);
  return mainWindow;
}

function destroyAccountView(id) {
  const view = views.get(id);
  views.delete(id);
  if (!view) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const children = mainWindow.contentView.children || [];
      if (children.includes(view)) mainWindow.contentView.removeChildView(view);
    }
  } catch {}
  try {
    if (view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.removeAllListeners();
      view.webContents.destroy();
    }
  } catch {}
}

function removeAccountById(id) {
  destroyAccountView(id);
  unreadByAccount.delete(id);
  try {
    const file = avatarFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
  accounts = accounts.filter((a) => a.id !== id);
  if (activeAccountId === id) {
    activeAccountId = accounts[0]?.id || null;
  }
  try {
    if (activeAccountId) {
      const next = accounts.find((a) => a.id === activeAccountId);
      if (next) createAccountView(next);
    }
  } catch {}
  try {
    saveAccounts();
  } catch {}
  try {
    layoutViews();
  } catch {}
  try {
    sendAccountState();
  } catch {}
  return { accounts: accountsForShell(), activeAccountId };
}

ipcMain.handle("confirm-remove-account", async (_e, name) => {
  const win = bringMainForward();
  await new Promise((r) => setTimeout(r, 80));
  const result = await dialog.showMessageBox(win || undefined, {
    type: "question",
    buttons: ["Cancel", "Remove", "Force remove"],
    defaultId: 1,
    cancelId: 0,
    title: "Remove account",
    message: `Remove "${name}" from this app?`,
    detail: "Remove deletes the slot from the sidebar. Force remove does the same even if the WhatsApp view is stuck.",
    noLink: true,
  });
  if (result.response === 1) return "remove";
  if (result.response === 2) return "force";
  return false;
});

ipcMain.handle("remove-account", (_e, id) => removeAccountById(id));

ipcMain.handle("toggle-account-mute", (_e, id) => {
  const account = accounts.find((a) => a.id === id);
  if (!account) return { accounts: accountsForShell(), activeAccountId };
  account.muted = !account.muted;
  saveAccounts();
  sendAccountState();
  return { accounts: accountsForShell(), activeAccountId };
});

ipcMain.handle("reload-account", (_e, id) => {
  reloadAccountView(id);
  setTimeout(() => {
    refreshAccountAvatar(id);
    refreshAccountUnread(id).then((did) => did && sendAccountState());
  }, 4000);
  return { ok: true, accounts: accountsForShell(), activeAccountId };
});

ipcMain.handle("focus-shell", () => {
  focusShellView();
  return { ok: true };
});

ipcMain.handle("switch-account", (_e, id) => {
  switchAccount(id);
  return { accounts: accountsForShell(), activeAccountId };
});

ipcMain.handle("set-sidebar-width", (_e, width) => {
  const next = Number(width);
  if (!Number.isFinite(next) || next < 0) return sidebarWidth;
  sidebarWidth = Math.round(next);
  scheduleLayoutViews();
  return sidebarWidth;
});

ipcMain.on("wa-notification", (event, payload) => {
  const entry = [...views.entries()].find(([, v]) => v.webContents.id === event.sender.id);
  if (!entry) return;
  const account = accounts.find((a) => a.id === entry[0]);
  if (!account) return;
  const current = unreadByAccount.get(account.id) || 0;
  if (setUnread(account.id, current + 1)) sendAccountState();
  showUnifiedNotification(account, payload);
});

function setupMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Reload active account",
          accelerator: process.platform === "darwin" ? "Cmd+Alt+R" : "Ctrl+Alt+R",
          click: () => {
            if (activeAccountId) reloadAccountView(activeAccountId);
          },
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (gotSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) handleProtocolLaunch(url);
    else focusMainWindow();
  });

  app.whenReady().then(() => {
    registerProtocolClient();
    setupMenu();
    loadAccounts();
    createTray();
    createWindow();
    startAvatarPolling();
    startUnreadPolling();
    try {
      fs.mkdirSync(blankShotDir(), { recursive: true });
    } catch {}
    diagLog("app-ready", {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      activeAccountId,
      logPath: blankLogPath(),
      shotDir: blankShotDir(),
    });
    startPaintWatch();
    setupAutoUpdater({
      getMainWindow: () => mainWindow,
      focusMainWindow,
      setQuitting: (value) => {
        isQuitting = Boolean(value);
      },
      shellSender: () => (shellView && !shellView.webContents.isDestroyed() ? shellView.webContents : null),
    });
    const launchUrl = findProtocolUrl(process.argv);
    if (launchUrl) handleProtocolLaunch(launchUrl);
    if (pendingNotifyLaunch) {
      const pending = pendingNotifyLaunch;
      pendingNotifyLaunch = null;
      openNotificationTarget(pending.accountId, pending.notificationId, pending.chatTitle);
    }
    app.on("activate", () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  }
});
