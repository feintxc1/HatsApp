const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("waMulti", {
  getAccounts: () => ipcRenderer.invoke("get-accounts"),
  addAccount: (name) => ipcRenderer.invoke("add-account", name),
  renameAccount: (id, name) => ipcRenderer.invoke("rename-account", { id, name }),
  reorderAccounts: (orderedIds) => ipcRenderer.invoke("reorder-accounts", orderedIds),
  confirmRemoveAccount: (name) => ipcRenderer.invoke("confirm-remove-account", name),
  removeAccount: (id) => ipcRenderer.invoke("remove-account", id),
  toggleAccountMute: (id) => ipcRenderer.invoke("toggle-account-mute", id),
  reloadAccount: (id) => ipcRenderer.invoke("reload-account", id),
  switchAccount: (id) => ipcRenderer.invoke("switch-account", id),
  setSidebarWidth: (width) => ipcRenderer.invoke("set-sidebar-width", width),
  focusShell: () => ipcRenderer.invoke("focus-shell"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onAccountsUpdated: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("accounts-updated", handler);
    return () => ipcRenderer.removeListener("accounts-updated", handler);
  },
  onUpdateState: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("update-state", handler);
    return () => ipcRenderer.removeListener("update-state", handler);
  },
});
