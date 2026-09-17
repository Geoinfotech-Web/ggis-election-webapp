@echo off
cd /d "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
node scripts\_offline-write-pres-lga.js > scripts\_wiki_raw\_offline-run.log 2>&1
echo EXIT:%ERRORLEVEL%>> scripts\_wiki_raw\_offline-run.log
