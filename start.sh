#!/usr/bin/env sh
# One-command start for macOS / Linux: sets up a private Python environment on first run, then starts the desk.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "First run: creating a private Python environment (this takes a minute)..."
  python3 -m venv .venv
fi
if [ ! -f .venv/.installed ] || [ requirements-docker.txt -nt .venv/.installed ]; then
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -r requirements-docker.txt
  touch .venv/.installed
fi
exec .venv/bin/python server.py
