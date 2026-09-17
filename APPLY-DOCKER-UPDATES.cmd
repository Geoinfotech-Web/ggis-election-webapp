@echo off
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
echo Recreating app container with host bind mounts...
docker compose up -d app
if errorlevel 1 (
  echo compose up failed - trying sync script...
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\sync-docker-runtime.ps1"
)
echo.
echo Open http://127.0.0.1:3010/ and hard-refresh (Ctrl+Shift+R)
pause
