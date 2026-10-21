@echo off
rem One-file launcher: compress photos in raw\ (work / camera profile).
rem Same layout as compress-photos.cmd - read the comments there.

setlocal
chcp 65001 >nul
set "LOG=%~dp0_run.log"
>"%LOG%" echo [start]

echo   [1] looking for the script
set "JS=%~dp0compress-photos.js"
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
echo   [4] compressing (work profile, long edge 2400)
echo.
"%NODE%" "%JS%" --work
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo [exit] %RC%
echo.
echo   [5] done, exit code %RC%
if not "%RC%"=="0" echo       something failed - read the messages above
goto :end

:nojs
echo   [x] compress-photos.js not found next to this file
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
