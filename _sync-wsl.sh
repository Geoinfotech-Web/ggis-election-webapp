#!/bin/sh
set -e
ROOT="/mnt/c/Users/Geoinfotech/Documents/GIS Team/Election Dashboard"
STATUS="$ROOT/.docker-sync-status.txt"
{
  echo "[$(date -Iseconds)] START _sync-wsl.sh"
  CNAME=$(docker ps --filter publish=3010 --format '{{.Names}}' | head -1)
  if [ -z "$CNAME" ]; then
    CNAME=$(docker ps --filter name=election-dashboard-app --format '{{.Names}}' | head -1)
  fi
  echo "container=$CNAME"
  if [ -n "$CNAME" ]; then
    docker cp "$ROOT/public/index.html" "$CNAME:/app/public/index.html"
    docker cp "$ROOT/public/js/eid-maps.js" "$CNAME:/app/public/js/eid-maps.js"
    docker cp "$ROOT/election-results-data.js" "$CNAME:/app/election-results-data.js"
    docker restart "$CNAME"
    echo "method=docker-cp-restart"
  else
    cd "$ROOT" && docker compose up -d app
    echo "method=compose-up"
  fi
  sleep 6
  HOME=$(wget -qO- http://127.0.0.1:3010/ || curl -sf http://127.0.0.1:3010/)
  MAPS=$(wget -qO- http://127.0.0.1:3010/js/eid-maps.js || curl -sf http://127.0.0.1:3010/js/eid-maps.js)
  echo "$HOME" | grep -q isGovCoverageTheme && H=1 || H=0
  echo "$MAPS" | grep -q 'theme.coverage === true' && M=1 || M=0
  echo "VERIFY isGovCoverageTheme=$H"
  echo "VERIFY coverageTrue=$M"
  if [ "$H" = 1 ] && [ "$M" = 1 ]; then echo "RESULT fix_served=true"; else echo "RESULT fix_served=false"; fi
  echo "[$(date -Iseconds)] DONE"
} > "$STATUS" 2>&1
