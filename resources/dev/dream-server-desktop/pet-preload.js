const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dreamPet", {
  onUpdate: (listener) => {
    const handler = (_, payload) => listener(payload || {});
    ipcRenderer.on("pet:update", handler);
    return () => ipcRenderer.removeListener("pet:update", handler);
  },
  ready: () => ipcRenderer.invoke("pet:ready"),
  speak: (payload) => ipcRenderer.invoke("pet:speak", payload || {}),
  moveTo: (payload) => ipcRenderer.send("pet:move-to", payload || {}),
  persistPosition: () => ipcRenderer.invoke("pet:persist-position"),
  interact: (payload) => ipcRenderer.invoke("pet:interact", payload || {})
});
