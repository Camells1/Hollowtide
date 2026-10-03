const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    backgroundColor: '#051520', title: 'Hollowtide',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

// Fast path for WebGL; real local addresses for WebRTC so friends on the same Wi-Fi connect directly
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
ipcMain.on('quit', () => app.quit());
