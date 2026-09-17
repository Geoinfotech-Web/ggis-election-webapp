@echo off
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
echo [%date% %time%] bat start > .docker-cp.log
for /f %%A in ('docker ps -q --filter publish=3010') do set CID=%%A
echo cid=%CID% >> .docker-cp.log
if "%CID%"=="" goto end
docker cp public\index.html %CID%:/app/public/index.html >> .docker-cp.log 2>&1
docker cp public\js\eid-maps.js %CID%:/app/public/js/eid-maps.js >> .docker-cp.log 2>&1
docker cp election-results-data.js %CID%:/app/election-results-data.js >> .docker-cp.log 2>&1
docker restart %CID% >> .docker-cp.log 2>&1
echo done >> .docker-cp.log
:end
