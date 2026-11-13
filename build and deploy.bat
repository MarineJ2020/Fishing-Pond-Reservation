@echo off
setlocal
cd /d "%~dp0"

REM ============================================================================
REM  Kolam Keli Sayang - one-click build and deploy
REM  Double-click this file to build the site and publish it.
REM
REM  WHY HOSTING **AND** FUNCTIONS MUST BOTH DEPLOY (HOSTING FIRST)
REM  --------------------------------------------------
REM  The "/", "/book", "/live" and "/confirmed" routes are rendered by the
REM  seoRender Cloud Function, which serves a BUNDLED copy of the built HTML
REM  (functions/src/template.html) that contains hashed asset names such as
REM  index-AbCd1234.js. Every `vite build` produces NEW hashes, so that
REM  template must be redeployed with hosting. If you deploy hosting alone,
REM  "/" keeps serving an HTML shell that points at a JS file hosting has
REM  already replaced, so the browser aborts with a blank page and a
REM  "MIME type text/html" module-script error. This script therefore always
REM  deploys hosting and then functions (see step 3 for why that order).
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
echo === [1/5] Building app bundle (vite) ===
REM Mirrors `npm run build` step 1, called directly to sidestep missing npm shims.
"%NODE_CMD%" ".\node_modules\vite\bin\vite.js" build
if errorlevel 1 goto :fail

echo(
echo === [2/5] Syncing SEO template (index.html -^> app.html + functions template) ===
REM Mirrors `npm run build` step 2.
"%NODE_CMD%" ".\scripts\copy-seo-template.mjs"
if errorlevel 1 goto :fail

echo(
echo === [3/5] Deploying hosting (new + recent old JS files) ===
REM Hosting goes FIRST. Since keep-previous-assets.mjs re-uploads recent
REM builds' JS, the old seoRender HTML still finds its files, and the new JS
REM is online before the new seoRender HTML starts pointing at it. Deploying
REM functions first (or both at once) leaves a gap where the new HTML asks
REM for JS hosting doesn't have yet; hosting answers with app.html and
REM Cloudflare caches that as the JS file -> blank site.
call ".\scripts\firebase-cli.cmd" deploy --only hosting --project %PROJECT%
if not errorlevel 1 goto :functions
echo Hosting deploy failed (often a temporary Google error), trying once more...
call ".\scripts\firebase-cli.cmd" deploy --only hosting --project %PROJECT%
if errorlevel 1 goto :fail_hosting

:functions
echo(
echo === [4/5] Deploying functions (attempt 1 of 3) ===
call ".\scripts\firebase-cli.cmd" deploy --only functions --project %PROJECT%
if not errorlevel 1 goto :refresh
echo(
echo === [4/5] Retrying functions (attempt 2 of 3) ===
call ".\scripts\firebase-cli.cmd" deploy --only functions --project %PROJECT%
if not errorlevel 1 goto :refresh
echo(
echo === [4/5] Retrying functions (attempt 3 of 3) ===
call ".\scripts\firebase-cli.cmd" deploy --only functions --project %PROJECT%
if not errorlevel 1 goto :refresh
goto :fail_functions

:refresh
echo(
echo === [5/5] Re-releasing hosting (clears cached pages made by the old seoRender) ===
REM Firebase clears its CDN cache only on a hosting release, and step 3 ran
REM before the new seoRender existed. Old pages still work (their JS is kept),
REM this just makes the new version show at once. Failure here is harmless.
call ".\scripts\firebase-cli.cmd" deploy --only hosting --project %PROJECT%

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
echo *** HOSTING COULD NOT BE PUBLISHED. Functions were NOT touched, so the ***
echo     site keeps running the previous version. Run this file again later.
pause
exit /b 1

:fail_functions
echo(
echo *** Hosting is live, but some Cloud Functions failed to update three times. ***
echo     The site keeps working on the previous code for those functions.
echo     Wait a few minutes, then run this file again.
pause
exit /b 1

:fail
echo(
echo *** BUILD/DEPLOY FAILED - see the output above. ***
pause
exit /b 1
