// Netlify 建置腳本（跨平台）
// 1) Chart.js 複製到 public/vendor（研究者後臺圖表）
// 2) 用 esbuild 把整個後端（Express＋所有套件＋衛教內容）打包成單一檔案 netlify/functions/api.mjs
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const vendor = path.join(ROOT, 'public', 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), path.join(vendor, 'chart.umd.js'));
console.log('copied chart.js');

require('esbuild').buildSync({
  entryPoints: [path.join(ROOT, 'netlify', 'src', 'entry.mjs')],
  outfile: path.join(ROOT, 'netlify', 'functions', 'api.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning'
});
console.log('bundled netlify/functions/api.mjs');
