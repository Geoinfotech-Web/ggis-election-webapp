@echo off
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
echo START %date% %time%> .docker-restart-out.txt
docker compose restart app>> .docker-restart-out.txt 2>&1
echo EXIT=%ERRORLEVEL%>> .docker-restart-out.txt
echo DONE %date% %time%>> .docker-restart-out.txt
