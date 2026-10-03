// Copies the three.js add-ons the game uses into vendor/three-addons
// (electron-builder leaves out node_modules "examples" folders, where they live).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm');
const dst = path.join(__dirname, '..', 'vendor', 'three-addons');
fs.rmSync(dst, { recursive: true, force: true });
for (const d of ['postprocessing', 'shaders', 'utils']) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true });
for (const f of ['GLTFLoader.js', 'RGBELoader.js']) { fs.mkdirSync(path.join(dst, 'loaders'), { recursive: true }); fs.copyFileSync(path.join(src, 'loaders', f), path.join(dst, 'loaders', f)); }
console.log('vendored three add-ons');
