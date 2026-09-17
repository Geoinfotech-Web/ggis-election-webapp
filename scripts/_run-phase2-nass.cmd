@echo off
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
node scripts\_run-phase2-offline.js > scripts\_phase2-log.txt 2>&1
type scripts\_phase2-log.txt
