const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('berryDesktopBrowser', {
  isAvailable() {
    return true;
  },
  navigate(url) {
    return ipcRenderer.invoke('berry-browser:navigate', url);
  },
  back() {
    return ipcRenderer.invoke('berry-browser:back');
  },
  forward() {
    return ipcRenderer.invoke('berry-browser:forward');
  },
  reload() {
    return ipcRenderer.invoke('berry-browser:reload');
  },
  setBounds(bounds) {
    return ipcRenderer.invoke('berry-browser:set-bounds', bounds);
  },
  capture() {
    return ipcRenderer.invoke('berry-browser:capture');
  },
});
