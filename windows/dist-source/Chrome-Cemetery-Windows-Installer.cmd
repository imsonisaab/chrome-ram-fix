@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "NAME=Chrome Cemetery"
set "MARK=BASE64PAYLOADSTART"
set "OUT=%TEMP%\BraveRAMEdition"

echo ============================================================
echo   %NAME% - Windows installer
echo   unpacking payload...
echo ============================================================

set "SELF=%~f0"
if not exist "%OUT%" mkdir "%OUT%"
if exist "%OUT%\extension" rmdir /s /q "%OUT%\extension"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$self = $env:SELF;" ^
  "if (-not $env:SELF) { $self = '%SELF%' };" ^
  "$lines = [IO.File]::ReadAllText($self);" ^
  "$mark = '%MARK%';" ^
  "$i = $lines.LastIndexOf($mark);" ^
  "if ($i -lt 0) { Write-Host '[FAIL] payload marker not found'; exit 2 };" ^
  "$b64 = ($lines.Substring($i + $mark.Length) -replace '\s','');" ^
  "if ($b64.Length -lt 100) { Write-Host '[FAIL] payload empty'; exit 2 };" ^
  "$zip = Join-Path $env:TEMP ('brave-ram-' + [Guid]::NewGuid().ToString('N') + '.zip');" ^
  "[IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($b64));" ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "[IO.Compression.ZipFile]::ExtractToDirectory($zip, $env:OUT);" ^
  "Remove-Item $zip -Force;" ^
  "Write-Host 'payload unpacked'"
if errorlevel 1 ( echo [FAIL] unpack failed & pause & exit /b 1 )

cd /d "%OUT%"
if not exist "Chrome-Cemetery-Windows-Installer.bat" (
  echo [FAIL] installer missing from payload & pause & exit /b 1
)
call "Chrome-Cemetery-Windows-Installer.bat"
exit /b %ERRORLEVEL%
