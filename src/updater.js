const { autoUpdater } = require("electron-updater");
const { dialog, app, ipcMain } = require("electron");

let started = false;
let getMainWindow = () => null;
let setQuitting = () => {};
let shellSender = () => null;
let focusMainWindow = () => {};

const state = {
  status: "idle",
  version: app.getVersion(),
  availableVersion: null,
  progress: 0,
  message: "",
};

function emitUpdateState() {
  const shell = typeof shellSender === "function" ? shellSender() : null;
  if (shell && !shell.isDestroyed()) {
    shell.send("update-state", { ...state });
  }
}

function setState(patch) {
  Object.assign(state, patch);
  emitUpdateState();
}

function bringAppForward() {
  try {
    focusMainWindow();
  } catch {}
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return null;
  try {
    if (win.isMinimized()) win.restore();
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    app.focus({ steal: true });
  } catch {}
  setTimeout(() => {
    try {
      if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    } catch {}
  }, 500);
  return win;
}

async function promptInstall(info) {
  const win = bringAppForward();
  await new Promise((r) => setTimeout(r, 80));
  const result = await dialog.showMessageBox(win || undefined, {
    type: "info",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "HatsApp",
    message: "A new version is ready",
    detail: "Restart to update. Your accounts will stay signed in.",
  });

  if (result.response === 0) {
    setQuitting(true);
    autoUpdater.quitAndInstall(false, true);
  }
}

function wireEvents() {
  autoUpdater.on("checking-for-update", () => {
    setState({
      status: "checking",
      message: "Looking for updates…",
      progress: 0,
    });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      status: "available",
      availableVersion: info?.version || null,
      message: `Update found: v${info?.version || "?"}. Downloading…`,
      progress: 0,
    });
  });

  autoUpdater.on("update-not-available", async () => {
    setState({
      status: "current",
      availableVersion: null,
      message: "You're up to date.",
      progress: 0,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
    setState({
      status: "downloading",
      progress: percent,
      message: `Downloading update… ${percent}%`,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    setState({
      status: "ready",
      availableVersion: info?.version || state.availableVersion,
      message: "Update ready. Restart to finish.",
      progress: 100,
    });
    await promptInstall(info);
  });

  autoUpdater.on("error", (err) => {
    const detail = String(err?.message || err || "").trim();
    setState({
      status: "error",
      message: detail
        ? `Update check failed: ${detail.slice(0, 140)}`
        : "Couldn't check right now. Try again later.",
      progress: 0,
    });
  });
}

async function checkForUpdates() {
  try {
    setState({
      status: "checking",
      message: "Looking for updates…",
      progress: 0,
    });
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    const detail = String(err?.message || err || "").trim();
    setState({
      status: "error",
      message: detail
        ? `Update check failed: ${detail.slice(0, 140)}`
        : "Couldn't check right now. Try again later.",
      progress: 0,
    });
    return { ok: false };
  }
}

function installUpdateNow() {
  if (state.status !== "ready") return { ok: false };
  setQuitting(true);
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}

function setupAutoUpdater(options = {}) {
  getMainWindow = options.getMainWindow || getMainWindow;
  setQuitting = options.setQuitting || setQuitting;
  shellSender = options.shellSender || shellSender;
  focusMainWindow = options.focusMainWindow || focusMainWindow;

  if (!started) {
    started = true;
    setState({
      status: "idle",
      message: "",
    });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
    }
    wireEvents();
    if (app.isPackaged) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 5000);
      setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 6 * 60 * 60 * 1000);
    }
  }

  emitUpdateState();
}

ipcMain.handle("get-update-state", () => ({ ...state }));
ipcMain.handle("check-for-updates", async () => checkForUpdates());
ipcMain.handle("install-update", () => installUpdateNow());

module.exports = { setupAutoUpdater, checkForUpdates, emitUpdateState };
