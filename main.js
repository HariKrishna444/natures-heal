const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'icon_512.png')
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);