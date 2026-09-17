@echo off
setlocal
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
set STATUS=.docker-sync-status.txt
echo [%date% %time%] START _run-sync-now > "%STATUS%"

for /f "tokens=1 delims=|" %%A in ('docker ps --filter "publish=3010" --format "{{.Names}}" 2^>nul') do set CNAME=%%A
if "%CNAME%"=="" for /f "tokens=1 delims=|" %%A in ('docker ps --filter "name=election-dashboard-app" --format "{{.Names}}" 2^>nul') do set CNAME=%%A
echo container=%CNAME% >> "%STATUS%"
if "%CNAME%"=="" (
  echo compose up fallback >> "%STATUS%"
  docker compose up -d app >> "%STATUS%" 2>&1
  timeout /t 8 /nobreak >nul
  goto verify
)

echo docker cp 3 files >> "%STATUS%"
docker cp "public\index.html" %CNAME%:/app/public/index.html >> "%STATUS%" 2>&1
docker cp "public\js\eid-maps.js" %CNAME%:/app/public/js/eid-maps.js >> "%STATUS%" 2>&1
docker cp "election-results-data.js" %CNAME%:/app/election-results-data.js >> "%STATUS%" 2>&1
docker restart %CNAME% >> "%STATUS%" 2>&1
echo restart_done >> "%STATUS%"
timeout /t 6 /nobreak >nul

:verify
powershell -NoProfile -Command "$h=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 http://127.0.0.1:3010/).Content; $m=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 http://127.0.0.1:3010/js/eid-maps.js).Content; $ok=$h.Contains('isGovCoverageTheme') -and $m.Contains('theme.coverage === true'); Add-Content '.docker-sync-status.txt' ('VERIFY isGovCoverageTheme='+$h.Contains('isGovCoverageTheme')); Add-Content '.docker-sync-status.txt' ('VERIFY coverageTrue='+$m.Contains('theme.coverage === true')); Add-Content '.docker-sync-status.txt' ('RESULT fix_served='+$ok)"

echo [%date% %time%] DONE >> "%STATUS%"
exit /b 0
