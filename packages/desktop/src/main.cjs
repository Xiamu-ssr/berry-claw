const { app, BrowserWindow, BrowserView, WebContentsView, ipcMain, shell } = require('electron');
const path = require('node:path');
const { createBrowserSurfaceManager } = require('./browser-surface.cjs');
const { resolveClientUrl } = require('./client-url.cjs');

let mainWindow;
const browserSurfaceManager = createBrowserSurfaceManager({
  BrowserView,
  WebContentsView,
  ipcMain,
  shell,
  getMainWindow: () => mainWindow,
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 700,
    title: 'Berry Claw',
    backgroundColor: '#09090b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    browserSurfaceManager.dispose();
    mainWindow = undefined;
  });

  win.loadURL(resolveClientUrl(app, __dirname));
}

app.whenReady().then(() => {
  browserSurfaceManager.installIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
