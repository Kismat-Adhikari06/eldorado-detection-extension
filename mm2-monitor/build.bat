@echo off
cd /d "%~dp0"
pyinstaller --noconfirm --onefile --windowed --name "MM2OrderAlert" --add-data "alarm.wav;." --collect-all playwright monitor.py
echo.
echo Done. EXE is at dist\MM2OrderAlert.exe
echo Copy settings.json next to the EXE so it can be edited.
pause
