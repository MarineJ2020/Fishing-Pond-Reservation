@echo off
setlocal

REM Repo-local Firebase CLI launcher for machines without global npm/firebase.
REM It uses the Codex bundled Node + pnpm runtime to run Firebase Tools via npm exec.

where firebase >nul 2>nul
if not errorlevel 1 (
  firebase %*
  exit /b %errorlevel%
)

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "PNPM_CJS=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs"

if not exist "%NODE_EXE%" (
  echo Could not find bundled Node at "%NODE_EXE%".
  echo Install Node.js with npm, then run: npm install -g firebase-tools
  exit /b 1
)

if not exist "%PNPM_CJS%" (
  echo Could not find bundled pnpm at "%PNPM_CJS%".
  echo Install Node.js with npm, then run: npm install -g firebase-tools
  exit /b 1
)

"%NODE_EXE%" "%PNPM_CJS%" dlx npm@10.9.3 exec --yes --package firebase-tools@latest -- firebase %*
exit /b %errorlevel%
