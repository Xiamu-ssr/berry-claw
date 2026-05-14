const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function resolveClientUrl() {
  if (process.env.BERRY_CLAW_CLIENT_URL) {
    return process.env.BERRY_CLAW_CLIENT_URL;
  }

  if (!app.isPackaged) {
    return 'http://127.0.0.1:3211';
  }

  const packagedIndex = path.join(process.resourcesPath, 'client', 'index.html');
  if (fs.existsSync(packagedIndex)) {
    return `file://${packagedIndex}`;
  }

  const devIndex = path.resolve(__dirname, '../../client/dist/index.html');
  return `file://${devIndex}`;
}

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
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(resolveClientUrl());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
