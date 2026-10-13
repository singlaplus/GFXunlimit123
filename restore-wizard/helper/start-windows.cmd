@echo off
setlocal
pushd "%~dp0"
node server.js
set "result=%ERRORLEVEL%"
popd
exit /b %result%
