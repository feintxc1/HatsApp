const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__hatsappBridge", {
  sendNotification: (payload) => {
    try {
      ipcRenderer.send("wa-notification", payload);
    } catch {}
  },
});
