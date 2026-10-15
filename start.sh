#!/usr/bin/env bash
# Rasid AI — Linux / macOS launcher
set -e
cd "$(dirname "$0")/server"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
source .venv/bin/activate
if [ ! -f .venv/installed.ok ]; then
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  touch .venv/installed.ok
fi
[ -f .env ] || cp .env.example .env
echo "Rasid on http://localhost:8010"
exec python -m uvicorn main:app --host 0.0.0.0 --port 8010
