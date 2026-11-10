@echo off
setlocal EnableDelayedExpansion
set "NAME=Brave RAM Edition"
set "INSTROOT=%LOCALAPPDATA%\BraveCemetery"
set "STORE=%LOCALAPPDATA%\BraveCemetery\store"
set "TASKNAME=BraveCemeteryGovernor"
set "BRIDGE=com.brave_cemetery.bridge"
set "EXTID=inmeejlkgbkicdbmolcofpafekejaick"

echo ============================================================
echo   %NAME% - Windows installer
echo   target: %INSTROOT%
echo ============================================================

where node >nul 2>&1 || (
  echo [FAIL] Node.js not found. Install LTS from https://nodejs.org first.
  pause & exit /b 1
)
where powershell >nul 2>&1 || ( echo [FAIL] powershell not found. & pause & exit /b 1 )
echo [1/5] node + powershell OK

if not exist "%INSTROOT%" mkdir "%INSTROOT%"
if not exist "%STORE%"    mkdir "%STORE%"
xcopy /E /I /Y /Q "%~dp0extension"    "%INSTROOT%\extension"    >nul
xcopy /E /I /Y /Q "%~dp0windows-host" "%INSTROOT%\windows-host" >nul
if exist "%~dp0README-WINDOWS.md" xcopy /Y /Q "%~dp0README-WINDOWS.md" "%INSTROOT%\" >nul
echo [2/5] engine copied

set "HOSTDIR=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\NativeMessagingHosts"
if not exist "!HOSTDIR!" mkdir "!HOSTDIR!"
set "HOSTJSON=!HOSTDIR!\%BRIDGE%.json"
powershell -NoProfile -Command ^
  "$p = @{ name='%BRIDGE%'; description='Brave RAM Edition - governor bridge (Windows)'; path='%INSTROOT:\=\\%\\windows-host\\native-host.cmd'; type='stdio'; allowed_origins=@('chrome-extension://%EXTID%/') } | ConvertTo-Json; Set-Content -LiteralPath '!HOSTJSON!' -Value $p -Encoding ASCII"
echo [3/5] native host registered at !HOSTJSON!

set "POLROOT=HKCU\SOFTWARE\Policies\BraveSoftware\Brave-Browser"
set "FORCE=%EXTID%;file:///%INSTROOT:\=\\%\\extension"
reg add "%POLROOT%" /v "ExtensionInstallForcelist" /t REG_SZ /f /d "%FORCE%" >nul 2>&1
reg add "%POLROOT%\ExtensionSettings\%EXTID%" /v "installation_mode" /t REG_SZ /f /d "force_installed" >nul 2>&1
echo [4/5] forcelist + allowlist written

schtasks /Create /TN "%TASKNAME%" /SC ONLOGON /RL LIMITED /F /TR ^
  "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%INSTROOT:\=\\%\\windows-host\\governor-ps.ps1\"" >nul 2>&1
schtasks /Run /TN "%TASKNAME%" >nul 2>&1
echo [5/5] governor task "%TASKNAME%" scheduled + started

echo.
echo DONE - engine installed.
echo   native host : %HOSTJSON%
echo   policy      : %POLROOT%\ExtensionInstallForcelist
echo   governor    : http://127.0.0.1:8795/pressure
echo   undo        : uninstall-windows.bat
echo.
echo Restart Brave to load the extension.
pause
