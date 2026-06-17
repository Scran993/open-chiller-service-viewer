@echo off
setlocal
cd /d "%~dp0"
echo.
echo Safe Modbus Writer - guarded RW parameter tool
echo.
echo Read-only viewer stays separate. Real writes require --enable-write.
echo.
echo Common commands:
echo.
echo 1) Inspect lv1 metadata:
echo    python tools\safe_modbus_writer.py inspect --profile user-profiles\ktk-t3c-rw-safe.json --label lv1
echo.
echo 2) Read lv1:
echo    python tools\safe_modbus_writer.py read --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --port COM7 --baud 19200 --slave 20 --offset -1
echo.
echo 3) Dry-run proposed lv1 = 1:
echo    python tools\safe_modbus_writer.py write --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --value 1 --good-value "1 - Liq" --port COM7 --baud 19200 --slave 20 --offset -1 --dry-run
echo.
echo 4) Backup RW values before changes:
echo    python tools\safe_modbus_writer.py backup --profile user-profiles\ktk-t3c-rw-safe.json --port COM7 --baud 19200 --slave 20 --offset -1
echo.
echo See SAFE-WRITES.md for the full procedure.
echo.
cmd /k
