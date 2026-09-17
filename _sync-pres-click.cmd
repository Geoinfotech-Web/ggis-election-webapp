@echo off
setlocal
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
set STATUS=.docker-sync-status.txt
echo [%date% %time%] START sync-pres-click > "%STATUS%"

for /f "tokens=1 delims=|" %%A in ('docker ps --filter "name=election-dashboard-app" --format "{{.Names}}" 2^>nul') do set CNAME=%%A
if "%CNAME%"=="" for /f "tokens=1 delims=|" %%A in ('docker ps --filter "publish=3010" --format "{{.Names}}" 2^>nul') do set CNAME=%%A
echo container=%CNAME% >> "%STATUS%"
if "%CNAME%"=="" (
  echo BLOCKER: no container >> "%STATUS%"
  exit /b 2
)

docker cp "public\index.html" %CNAME%:/app/public/index.html >> "%STATUS%" 2>&1
docker cp "public\js\eid-maps.js" %CNAME%:/app/public/js/eid-maps.js >> "%STATUS%" 2>&1
docker cp "election-results-data.js" %CNAME%:/app/election-results-data.js >> "%STATUS%" 2>&1
echo cp_done >> "%STATUS%"
docker restart %CNAME% >> "%STATUS%" 2>&1
echo restart_done >> "%STATUS%"

timeout /t 4 /nobreak >nul

powershell -NoProfile -Command ^
  "$h=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010/).Content; ^
   $m=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010/js/eid-maps.js).Content; ^
   Add-Content '.docker-sync-status.txt' ('VERIFY homeLen='+$h.Length+' isGovCoverageTheme='+$h.Contains('isGovCoverageTheme')); ^
   Add-Content '.docker-sync-status.txt' ('VERIFY maps coverageTrue='+$m.Contains('theme.coverage === true')); ^
   Add-Content '.docker-sync-status.txt' ('VERIFY maps oldBug='+$m.Contains('theme.coverage)'));"

echo [%date% %time%] DONE >> "%STATUS%"
exit /b 0
