const { autoUpdater } = require("electron-updater");
const { dialog, app } = require("electron");

let started = false;

function setupAutoUpdater(options = {}) {
  const { getMainWindow, setQuitting } = options;
  if (started) return;
  if (!app.isPackaged) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("error", () => {});

  autoUpdater.on("update-downloaded", async (info) => {
    const win = typeof getMainWindow === "function" ? getMainWindow() : null;
    const version = info?.version ? ` (${info.version})` : "";
    const result = await dialog.showMessageBox(win || undefined, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "HatsApp update",
      message: `Update ready${version}`,
      detail: "A new version was downloaded. Logins stay saved after you restart.",
    });

    if (result.response === 0) {
      if (typeof setQuitting === "function") setQuitting(true);
      autoUpdater.quitAndInstall(false, true);
    }
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };

  setTimeout(check, 5000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdater };
