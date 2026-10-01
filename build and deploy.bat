@echo off
setlocal
cd /d "%~dp0"

REM ============================================================================
REM  Kolam Keli Sayang - one-click build and deploy
REM  Double-click this file to build the site and publish it.
REM
REM  WHY HOSTING **AND** FUNCTIONS MUST DEPLOY TOGETHER
REM  --------------------------------------------------
REM  The "/", "/book", "/live" and "/confirmed" routes are rendered by the
REM  seoRender Cloud Function, which serves a BUNDLED copy of the built HTML
REM  (functions/src/template.html) that contains hashed asset names such as
REM  index-AbCd1234.js. Every `vite build` produces NEW hashes, so that
REM  template must be redeployed with hosting. If you deploy hosting alone,
REM  "/" keeps serving an HTML shell that points at a JS file hosting has
REM  already replaced, so the browser aborts with a blank page and a
REM  "MIME type text/html" module-script error. This script therefore always
REM  deploys hosting AND functions in one go.
REM ============================================================================

set "PROJECT=kolamkelisayang"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_CMD=node"
) else if exist "%NODE_EXE%" (
  set "NODE_CMD=%NODE_EXE%"
) else (
  echo Could not find node on PATH or at "%NODE_EXE%".
  goto :fail
)

echo(
echo === [1/3] Building app bundle (vite) ===
REM Mirrors `npm run build` step 1, called directly to sidestep missing npm shims.
"%NODE_CMD%" ".\node_modules\vite\bin\vite.js" build
if errorlevel 1 goto :fail

echo(
echo === [2/3] Syncing SEO template (index.html -^> app.html + functions template) ===
REM Mirrors `npm run build` step 2.
"%NODE_CMD%" ".\scripts\copy-seo-template.mjs"
if errorlevel 1 goto :fail

echo(
echo === [3/3] Deploying hosting + functions ===
call ".\scripts\firebase-cli.cmd" deploy --only "hosting,functions" --project %PROJECT%
if errorlevel 1 goto :fail

:done
echo(
echo ============================================================================
echo  DONE - live at https://kolamkelisayang.web.app
echo  ( "/" is CDN-cached ~10 min; the hosting deploy above purges it, so a
echo    hard refresh should show the new build immediately. )
echo ============================================================================
pause
exit /b 0

:fail
echo(
echo *** BUILD/DEPLOY FAILED - see the output above. ***
pause
exit /b 1
