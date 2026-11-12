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
} = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { setupAutoUpdater } = require("./updater");

const WHATSAPP_URL = "https://web.whatsapp.com";
const chromeVersion = process.versions.chrome || "131.0.0.0";
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

app.setName("HatsApp");

let mainWindow = null;
let shellView = null;
let tray = null;
let isQuitting = false;
let accounts = [];
const views = new Map();
let activeAccountId = null;
let sidebarWidth = 240;
let layoutTimer = null;
let blurredAt = 0;
let recoverTimer = null;

app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("use-angle", "d3d11");
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

function loadAccounts() {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const data = JSON.parse(raw);
    accounts = Array.isArray(data.accounts) ? data.accounts : [];
    activeAccountId = data.activeAccountId || accounts[0]?.id || null;
  } catch {
    accounts = [];
    activeAccountId = null;
  }
}

function saveAccounts() {
  fs.writeFileSync(
    storePath(),
    JSON.stringify({ accounts, activeAccountId }, null, 2),
    "utf8"
  );
}

function setViewAttached(view, attached) {
  if (!mainWindow || !view) return;
  const children = mainWindow.contentView.children || [];
  const isAttached = children.includes(view);
  if (attached && !isAttached) {
    mainWindow.contentView.addChildView(view);
    if (shellView) mainWindow.contentView.addChildView(shellView);
  } else if (!attached && isAttached) {
    mainWindow.contentView.removeChildView(view);
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

function forceRepaint(view, bounds) {
  if (!view || view.webContents.isDestroyed() || !bounds) return;
  view.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width - 1, 1),
    height: bounds.height,
  });
  view.setBounds(bounds);
  try {
    view.webContents.invalidate();
  } catch {}
}

function wakeView(view, bounds) {
  if (!view || !bounds) return;
  try {
    view.webContents.setBackgroundThrottling(false);
  } catch {}
  setViewAttached(view, true);
  if (typeof view.setVisible === "function") view.setVisible(true);
  view.setBounds(bounds);
  forceRepaint(view, bounds);
  try {
    view.webContents.focus();
  } catch {}
}

function hibernateView(view) {
  if (!view || view.webContents.isDestroyed()) return;
  const [width, height] = mainWindow ? mainWindow.getContentSize() : [1280, 860];
  const widthKeep = Math.max(width - sidebarWidth, 800);
  const heightKeep = Math.max(height, 600);
  if (typeof view.setVisible === "function") view.setVisible(true);
  setViewAttached(view, true);
  view.setBounds({
    x: -16000,
    y: 0,
    width: widthKeep,
    height: heightKeep,
  });
  try {
    view.webContents.setBackgroundThrottling(true);
  } catch {}
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

  for (const [id, view] of views) {
    if (id === activeAccountId) wakeView(view, bounds);
    else hibernateView(view);
  }

  if (shellView && mainWindow) {
    setViewAttached(shellView, true);
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

function recoverActiveView(options = {}) {
  const { allowReload = true } = options;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  layoutViews();

  const view = activeAccountId ? views.get(activeAccountId) : null;
  if (!view || view.webContents.isDestroyed()) return;

  const bounds = activeBounds();
  wakeView(view, bounds);

  const awayMs = blurredAt ? Date.now() - blurredAt : 0;
  if (allowReload && awayMs >= 20000) {
    try {
      view.webContents.reload();
    } catch {}
  } else {
    view.webContents
      .executeJavaScript(
        `(() => {
          try {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
          } catch {}
          return true;
        })();`
      )
      .catch(() => {});
  }

  if (recoverTimer) clearTimeout(recoverTimer);
  recoverTimer = setTimeout(() => {
    recoverTimer = null;
    const again = activeBounds();
    const current = activeAccountId ? views.get(activeAccountId) : null;
    if (!current || current.webContents.isDestroyed()) return;
    forceRepaint(current, again);
    try {
      current.webContents.focus();
    } catch {}
  }, 120);
}

function accountColor(id) {
  const palette = ["#25D366", "#128C7E", "#34B7F1", "#F5A623", "#E74C3C", "#9B59B6"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * 17) % palette.length;
  return palette[hash];
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

  view.webContents.setUserAgent(CHROME_UA);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.setBackgroundThrottling(false);

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
  view.webContents.on("did-finish-load", installHooks);

  view.webContents.loadURL(WHATSAPP_URL);
  views.set(account.id, view);
  layoutViews();
  return view;
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
  setTimeout(() => recoverActiveView({ allowReload: false }), 0);
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, "assets", "tray.png");
  let icon = nativeImage.createFromPath(iconPath);
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
  if (!Notification.isSupported()) return;
  const title = `${account.name}: ${payload.title || "WhatsApp"}`;
  const body = payload.body || "";
  const notificationId = payload.id || "";
  const chatTitle = payload.title || "";
  const n = new Notification({
    title,
    body,
    silent: false,
  });
  n.on("click", () => {
    blurredAt = 0;
    focusMainWindow();
    switchAccount(account.id);
    setTimeout(() => {
      recoverActiveView({ allowReload: false });
      const view = views.get(account.id);
      if (!view || view.webContents.isDestroyed()) return;
      try {
        view.webContents.focus();
      } catch {}
      view.webContents
        .executeJavaScript(
          `window.__hatsappHandleNotificationClick(${JSON.stringify(
            notificationId
          )}, ${JSON.stringify(chatTitle)})`
        )
        .catch(() => {});
    }, 250);
  });
  n.show();
}

function switchAccount(id) {
  if (!accounts.find((a) => a.id === id)) return;
  activeAccountId = id;
  createAccountView(accounts.find((a) => a.id === id));
  layoutViews();
  saveAccounts();
  sendAccountState();
}

function sendAccountState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send("accounts-updated", {
    accounts,
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

  mainWindow.contentView.addChildView(shellView);
  shellView.webContents.loadFile(path.join(__dirname, "shell.html"));

  mainWindow.on("resize", scheduleLayoutViews);
  mainWindow.on("blur", () => {
    blurredAt = Date.now();
  });
  mainWindow.on("show", () => {
    setTimeout(() => recoverActiveView({ allowReload: true }), 0);
  });
  mainWindow.on("restore", () => {
    setTimeout(() => recoverActiveView({ allowReload: true }), 0);
  });
  mainWindow.on("focus", () => {
    setTimeout(() => recoverActiveView({ allowReload: true }), 0);
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
    blurredAt = 0;
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
    }, 5000);
  });

  layoutViews();
}

ipcMain.handle("get-accounts", () => ({ accounts, activeAccountId }));

ipcMain.handle("add-account", (_e, name) => {
  const account = {
    id: randomUUID(),
    name: (name || "").trim() || `Account ${accounts.length + 1}`,
    color: "",
  };
  account.color = accountColor(account.id);
  accounts.push(account);
  activeAccountId = account.id;
  createAccountView(account);
  saveAccounts();
  layoutViews();
  sendAccountState();
  return { accounts, activeAccountId };
});

ipcMain.handle("rename-account", (_e, { id, name }) => {
  const account = accounts.find((a) => a.id === id);
  if (!account) return { accounts, activeAccountId };
  account.name = (name || "").trim() || account.name;
  saveAccounts();
  sendAccountState();
  return { accounts, activeAccountId };
});

ipcMain.handle("set-account-color", (_e, { id, color }) => {
  const account = accounts.find((a) => a.id === id);
  if (!account) return { accounts, activeAccountId };
  const next = String(color || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(next)) {
    account.color = next.toUpperCase();
    saveAccounts();
    sendAccountState();
  }
  return { accounts, activeAccountId };
});

ipcMain.handle("confirm-remove-account", async (_e, name) => {
  if (!mainWindow) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Cancel", "Remove"],
    defaultId: 0,
    cancelId: 0,
    title: "Remove account",
    message: `Remove "${name}" from this app?`,
    detail: "Login data for that slot will stay on disk until you clear app data.",
    noLink: true,
  });
  return result.response === 1;
});

ipcMain.handle("remove-account", (_e, id) => {
  const view = views.get(id);
  if (view && mainWindow) {
    mainWindow.contentView.removeChildView(view);
    try {
      view.webContents.close();
    } catch {}
    views.delete(id);
  }
  accounts = accounts.filter((a) => a.id !== id);
  if (activeAccountId === id) {
    activeAccountId = accounts[0]?.id || null;
  }
  if (activeAccountId) createAccountView(accounts.find((a) => a.id === activeAccountId));
  saveAccounts();
  layoutViews();
  sendAccountState();
  return { accounts, activeAccountId };
});

ipcMain.handle("switch-account", (_e, id) => {
  switchAccount(id);
  return { accounts, activeAccountId };
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
  if (account) showUnifiedNotification(account, payload);
});

function setupMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setupMenu();
  loadAccounts();
  createTray();
  createWindow();
  setupAutoUpdater({
    getMainWindow: () => mainWindow,
    setQuitting: (value) => {
      isQuitting = Boolean(value);
    },
  });
  app.on("activate", () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });
});

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
