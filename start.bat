@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 首次執行，安裝套件中...
  call npm install
)
echo 啟動糖尿病互動衛教平台：http://localhost:3100   研究者後臺：http://localhost:3100/admin
start "" http://localhost:3100
node server.js
