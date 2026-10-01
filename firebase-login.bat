@echo off
setlocal
cd /d "%~dp0"

call ".\scripts\firebase-cli.cmd" login
if errorlevel 1 goto :fail

echo(
echo Firebase login complete.
pause
exit /b 0

:fail
echo(
echo Firebase login failed - see the output above.
pause
exit /b 1
