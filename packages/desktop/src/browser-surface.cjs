function createBrowserSurfaceManager({
  BrowserView,
  WebContentsView,
  ipcMain,
  shell,
  getMainWindow,
}) {
  let browserSurface;

  function ensureBrowserSurface() {
    const mainWindow = getMainWindow();
    if (!mainWindow) throw new Error('Main window is not ready');
    if (browserSurface) return browserSurface;

    const webPreferences = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    };

    if (typeof WebContentsView === 'function') {
      const view = new WebContentsView({ webPreferences });
      mainWindow.contentView.addChildView(view);
      installExternalWindowHandler(view.webContents, shell);
      browserSurface = {
        webContents: view.webContents,
        setBounds: (bounds) => view.setBounds(bounds),
        destroy: () => {
          try { mainWindow.contentView.removeChildView(view); } catch {}
          view.webContents.close();
        },
      };
    } else {
      const view = new BrowserView({ webPreferences });
      mainWindow.setBrowserView(view);
      installExternalWindowHandler(view.webContents, shell);
      browserSurface = {
        webContents: view.webContents,
        setBounds: (bounds) => view.setBounds(bounds),
        destroy: () => {
          try { mainWindow.removeBrowserView(view); } catch {}
        },
      };
    }

    browserSurface.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return browserSurface;
  }

  return {
    installIpc() {
      ipcMain.handle('berry-browser:is-available', () => true);

      ipcMain.handle('berry-browser:set-bounds', (_event, bounds) => {
        const surface = ensureBrowserSurface();
        surface.setBounds(normalizeBounds(bounds));
      });

      ipcMain.handle('berry-browser:navigate', async (_event, url) => {
        const surface = ensureBrowserSurface();
        await surface.webContents.loadURL(String(url));
      });

      ipcMain.handle('berry-browser:back', async () => {
        const wc = ensureBrowserSurface().webContents;
        if (wc.canGoBack()) wc.goBack();
      });

      ipcMain.handle('berry-browser:forward', async () => {
        const wc = ensureBrowserSurface().webContents;
        if (wc.canGoForward()) wc.goForward();
      });

      ipcMain.handle('berry-browser:reload', async () => {
        ensureBrowserSurface().webContents.reload();
      });

      ipcMain.handle('berry-browser:capture', async () => {
        const surface = ensureBrowserSurface();
        const image = await surface.webContents.capturePage();
        const size = image.getSize();
        return {
          data: image.toPNG().toString('base64'),
          mediaType: 'image/png',
          width: size.width,
          height: size.height,
          url: surface.webContents.getURL(),
          title: surface.webContents.getTitle(),
        };
      });
    },

    dispose() {
      if (!browserSurface) return;
      try { browserSurface.destroy(); } catch {}
      browserSurface = undefined;
    },
  };
}

function installExternalWindowHandler(webContents, shell) {
  webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function normalizeBounds(bounds) {
  const visible = !!bounds?.visible;
  return {
    x: visible ? Math.max(0, Math.round(bounds.x || 0)) : 0,
    y: visible ? Math.max(0, Math.round(bounds.y || 0)) : 0,
    width: visible ? Math.max(0, Math.round(bounds.width || 0)) : 0,
    height: visible ? Math.max(0, Math.round(bounds.height || 0)) : 0,
  };
}

module.exports = { createBrowserSurfaceManager };
