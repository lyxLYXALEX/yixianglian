@echo off
rem Launcher for the writing desk (local editor for content/*.md).
rem Same layout as build-content.cmd - read the comments there.
rem IMPORTANT: keep this file ASCII-only and with CRLF line endings.

setlocal
chcp 65001 >nul
set "LOG=%~dp0..\_run.log"
>"%LOG%" echo [start] admin

echo   [1] looking for the server script
set "JS=%~dp0server.js"
if not exist "%JS%" goto :nojs
>>"%LOG%" echo [js] %JS%

echo   [2] looking for Node
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not defined NODE for %%N in (node.exe) do if not "%%~$PATH:N"=="" set "NODE=%%~$PATH:N"
if not defined NODE goto :nonode
>>"%LOG%" echo [node] %NODE%

echo   [3] using Node: %NODE%
echo   [4] starting the writing desk
echo       (a browser window should open by itself)
echo       keep this window open - closing it stops the tool
echo.
"%NODE%" "%JS%"
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo [exit] %RC%
echo.
echo   [5] server stopped, exit code %RC%
goto :end

:nojs
echo   [x] server.js not found next to this file
>>"%LOG%" echo [js] missing
goto :end

:nonode
echo   [x] Node.js not found.
echo       1^) install the LTS version from https://nodejs.org
echo       2^) double-click this file again
>>"%LOG%" echo [node] missing
goto :end

:end
echo.
echo   (this window stays open; close it when you are done)
pause >nul
