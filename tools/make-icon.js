// Renders assets/logo.svg to the app icons (PNG + ICO) with an offscreen Electron window.
// Usage: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.svg'), 'utf8');
const render = size => `new Promise(res => {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size}; c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); res(c.toDataURL('image/png')); };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(${JSON.stringify(SVG)})));
})`;

// PNG-compressed ICO entries (Windows Vista+)
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = []; let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length; dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...pngs.map(p => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('about:blank');
  const png = async size => Buffer.from((await win.webContents.executeJavaScript(render(size))).split(',')[1], 'base64');
  const out = path.join(__dirname, '..', 'assets');
  fs.writeFileSync(path.join(out, 'icon.png'), await png(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(await Promise.all(sizes.map(async size => ({ size, buf: await png(size) })))));
  console.log('icons written');
  app.quit();
});
