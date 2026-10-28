@echo off
rem One-command start for Windows: sets up a private Python environment on first run, then starts the desk.
cd /d "%~dp0"
if not exist .venv (
  echo First run: creating a private Python environment, this takes a minute...
  py -3 -m venv .venv || python -m venv .venv
)
if not exist .venv\.installed (
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -r requirements-docker.txt || goto :fail
  echo done> .venv\.installed
)
.venv\Scripts\python server.py
goto :eof
:fail
echo Could not install the screenshot reader. The desk will still start with the browser reader.
.venv\Scripts\python server.py
