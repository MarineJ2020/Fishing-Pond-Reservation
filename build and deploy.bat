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
if not errorlevel 1 goto :done

REM Recovery. Google's deploy API sometimes answers with an HTML error page
REM ("Unable to parse JSON ... <!DOCTYPE"). The CLI then stops after functions
REM and never uploads hosting, while seoRender may already point at the new
REM bundles -> blank "/". So: publish hosting at once, then retry functions
REM (unchanged functions are skipped, so a retry only redoes what failed).
echo(
echo *** Deploy did not finish (often a temporary Google error). Recovering... ***
echo(
echo === [recovery 1/2] Deploying hosting ===
call ".\scripts\firebase-cli.cmd" deploy --only hosting --project %PROJECT%
if not errorlevel 1 goto :retry_functions
echo Hosting deploy failed, trying once more...
call ".\scripts\firebase-cli.cmd" deploy --only hosting --project %PROJECT%
if errorlevel 1 goto :fail_hosting

:retry_functions
echo(
echo === [recovery 2/2] Retrying functions (attempt 1 of 2) ===
call ".\scripts\firebase-cli.cmd" deploy --only functions --project %PROJECT%
if not errorlevel 1 goto :done
echo(
echo === [recovery 2/2] Retrying functions (attempt 2 of 2) ===
call ".\scripts\firebase-cli.cmd" deploy --only functions --project %PROJECT%
if not errorlevel 1 goto :done
goto :fail_functions

:done
echo(
echo ============================================================================
echo  DONE - live at https://kolamkelisayang.web.app
echo  ( "/" is CDN-cached ~10 min; the hosting deploy above purges it, so a
echo    hard refresh should show the new build immediately. )
echo ============================================================================
pause
exit /b 0

:fail_hosting
echo(
echo *** HOSTING COULD NOT BE PUBLISHED - the home page may be blank right now. ***
echo     Run this file again as soon as possible.
pause
exit /b 1

:fail_functions
echo(
echo *** Hosting is live, but some Cloud Functions failed to update twice. ***
echo     The site keeps working on the previous code for those functions.
echo     Wait a few minutes, then run this file again.
pause
exit /b 1

:fail
echo(
echo *** BUILD/DEPLOY FAILED - see the output above. ***
pause
exit /b 1
