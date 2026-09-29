@echo off
rem Sets up the local voice (Kokoro) in voice\: downloads about 420 MB. Safe to run again.
title Jax Coach - local voice setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0voice\setup-voice.ps1"
pause
