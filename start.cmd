@echo off
cd /d "%~dp0"

:: 清除会影响 Electron 运行的环境变量
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=

:: 启动 Electron
"node_modules\electron\dist\electron.exe" .
