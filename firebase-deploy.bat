@echo off
setlocal
cd /d "%~dp0"

set "PROJECT=kolamkelisayang"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_CMD=node"
) else if exist "%NODE_EXE%" (
  set "NODE_CMD=%NODE_EXE%"
) else (
  echo Could not find node on PATH or at "%NODE_EXE%".
  exit /b 1
)

echo(
echo === [1/3] Building app bundle (vite) ===
"%NODE_CMD%" ".\node_modules\vite\bin\vite.js" build
if errorlevel 1 goto :fail

echo(
echo === [2/3] Syncing SEO template (index.html -^> app.html + functions template) ===
"%NODE_CMD%" ".\scripts\copy-seo-template.mjs"
if errorlevel 1 goto :fail

echo(
echo === [3/3] Deploying hosting + functions ===
call ".\scripts\firebase-cli.cmd" deploy --only "hosting,functions" --project %PROJECT%
if errorlevel 1 goto :fail

echo(
echo ============================================================================
echo  DONE - live at https://kolamkelisayang.web.app
echo ============================================================================
pause
exit /b 0

:fail
echo(
echo *** BUILD/DEPLOY FAILED - see the output above. ***
pause
exit /b 1
