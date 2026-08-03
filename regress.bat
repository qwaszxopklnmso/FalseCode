@echo off
rem One-shot full regression (Windows equivalent of regress.sh):
rem fixtures + problems + examples + probes.
rem Usage: regress.bat   (run from the project root; node + g++ on PATH)
setlocal enabledelayedexpansion

where node >nul 2>&1
if errorlevel 1 (echo node not found - add it to PATH & exit /b 1)

rem Prefer g++ (MinGW); fall back to g++.exe.
set "CXX="
where g++ >nul 2>&1 && set "CXX=g++"
if not defined CXX (where g++.exe >nul 2>&1 && set "CXX=g++.exe")
if not defined CXX (echo g++ not found - add MinGW to PATH & exit /b 1)
echo using compiler: %CXX%

set PASS=0
set FAIL=0

echo == tests/run.js
node tests/run.js
if errorlevel 1 echo FAIL: tests/run.js

echo.
echo == problems_test/check.js
node problems_test/check.js
if errorlevel 1 echo FAIL: problems_test/check.js

echo.
echo == compile all example\*.fc
call :compile_dir example
echo.
echo == compile all problems_test\*.fc
call :compile_dir problems_test
echo.
echo == compile all tests\_probe\*.fc
call :compile_dir tests\_probe

echo.
if %FAIL%==0 (
  echo ALL COMPILED OK (%PASS% files^)
) else (
  echo %FAIL% compile failure^(s^), %PASS% ok
)
endlocal
exit /b 0

rem ---- compile every *.fc in %1 into .cpp + .exe ----
:compile_dir
for %%F in ("%~1\*.fc") do call :check_func "%%~fF"
exit /b 0

rem ---- compile one .fc (arg 1) ----
:check_func
set "FC=%~1"
set "CPP=%~dpn1.cpp"
set "EXE=%~dpn1.exe"
node src/main.js "%FC%" "%CPP%" >nul 2>&1
if errorlevel 1 (echo COMPILE FAIL: %FC% & set /a FAIL+=1 & exit /b 0)
%CXX% -std=gnu++11 -O0 -w -o "%EXE%" "%CPP%" >nul 2>&1
if errorlevel 1 (echo COMPILE FAIL: %FC% & set /a FAIL+=1 & exit /b 0)
set /a PASS+=1
exit /b 0
