@echo off
rem Creates (or updates) the "Jax Coach" shortcut on your desktop and in the Start menu.
rem Run it again if you move the Jax Coach folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\create-shortcut.ps1"
pause
