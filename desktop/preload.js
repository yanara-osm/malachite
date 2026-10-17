// preload：把主进程的 RH 代理桥接到 renderer（绕过 CORS）
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rhProxy", {
  request: (opts) => ipcRenderer.invoke("rh-proxy", opts),
  fetchHtml: (url) => ipcRenderer.invoke("rh-fetch", url),
});
