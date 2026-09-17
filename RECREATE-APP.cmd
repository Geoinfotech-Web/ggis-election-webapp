@echo off
setlocal
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
set STATUS=.docker-sync-status.txt
echo [%date% %time%] START recreate > "%STATUS%"

where docker >nul 2>&1
if errorlevel 1 (
  echo BLOCKER: docker not in PATH >> "%STATUS%"
  exit /b 1
)

echo [%date% %time%] docker compose up -d app >> "%STATUS%"
docker compose up -d app >> "%STATUS%" 2>&1
set UP_EXIT=%ERRORLEVEL%
echo compose_exit=%UP_EXIT% >> "%STATUS%"

echo [%date% %time%] docker ps >> "%STATUS%"
docker ps --filter "name=election-dashboard" --format "{{.Names}}|{{.Status}}|{{.Ports}}" >> "%STATUS%" 2>&1

REM Identify container
for /f "tokens=1 delims=|" %%A in ('docker ps --filter "name=election-dashboard-app" --format "{{.Names}}"') do set CNAME=%%A
if "%CNAME%"=="" for /f "tokens=1 delims=|" %%A in ('docker ps --filter "publish=3010" --format "{{.Names}}"') do set CNAME=%%A
echo container=%CNAME% >> "%STATUS%"

if %UP_EXIT% NEQ 0 (
  echo FALLBACK docker cp >> "%STATUS%"
  if "%CNAME%"=="" (
    echo BLOCKER: no container for cp >> "%STATUS%"
    exit /b 2
  )
  docker cp "public\." %CNAME%:/app/public/ >> "%STATUS%" 2>&1
  docker cp "data\election-results\." %CNAME%:/app/data/election-results/ >> "%STATUS%" 2>&1
  docker cp "data\reference\." %CNAME%:/app/data/reference/ >> "%STATUS%" 2>&1
  docker cp "src\." %CNAME%:/app/src/ >> "%STATUS%" 2>&1
  docker cp "server.js" %CNAME%:/app/server.js >> "%STATUS%" 2>&1
  docker cp "election-results-data.js" %CNAME%:/app/election-results-data.js >> "%STATUS%" 2>&1
  docker cp "election-analysis.js" %CNAME%:/app/election-analysis.js >> "%STATUS%" 2>&1
  docker restart %CNAME% >> "%STATUS%" 2>&1
  echo method=docker-cp-restart >> "%STATUS%"
) else (
  echo method=compose-up-recreate >> "%STATUS%"
)

timeout /t 5 /nobreak >nul

powershell -NoProfile -Command ^
  "$js=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010/js/eid-data-explorer.js).Content; ^
   $cat=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010/api/data-catalog).Content; ^
   $home=(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010/); ^
   Add-Content '.docker-sync-status.txt' ('VERIFY jsLen='+$js.Length+' groupByCategory='+$js.Contains('groupByCategory')); ^
   Add-Content '.docker-sync-status.txt' ('VERIFY cat stears-open-data='+$cat.Contains('stears-open-data')); ^
   Add-Content '.docker-sync-status.txt' ('VERIFY home='+[int]$home.StatusCode)"

echo [%date% %time%] DONE >> "%STATUS%"
exit /b 0
