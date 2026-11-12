const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("waMulti", {
  getAccounts: () => ipcRenderer.invoke("get-accounts"),
  addAccount: (name) => ipcRenderer.invoke("add-account", name),
  renameAccount: (id, name) => ipcRenderer.invoke("rename-account", { id, name }),
  setAccountColor: (id, color) => ipcRenderer.invoke("set-account-color", { id, color }),
  confirmRemoveAccount: (name) => ipcRenderer.invoke("confirm-remove-account", name),
  removeAccount: (id) => ipcRenderer.invoke("remove-account", id),
  switchAccount: (id) => ipcRenderer.invoke("switch-account", id),
  setSidebarWidth: (width) => ipcRenderer.invoke("set-sidebar-width", width),
  onAccountsUpdated: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("accounts-updated", handler);
    return () => ipcRenderer.removeListener("accounts-updated", handler);
  },
});
