# Safe Writes For MCX Controllers

The live Modbus Service Viewer stays read-only. Use this separate tool only when you deliberately need to inspect, back up, or change RW parameters from a variable list.

Writing live HVAC controller parameters can cause compressor trips, valve movement, pump/fan changes, or controller reboot. Treat every write as a controlled service action.

## One-Time Setup

The writer needs Python and `pyserial` for real COM-port reads/writes. Dry-runs and imports work without serial access.

```powershell
python -m pip install pyserial
```

If you use the bundled Codex Python, replace `python` with:

```powershell
C:\Users\sam\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
```

## Import The Variable List

This creates a guarded JSON profile containing access rights, min/max, units, and enum text where available.

```powershell
python tools\safe_modbus_writer.py import --source ..\..\work\ktk-variable-list.txt --out user-profiles\ktk-t3c-rw-safe.json --name "KTK T3C guarded RW variable list"
```

The imported profile is still not a permission to write. It is only the approved metadata source.

## Inspect lv1

```powershell
python tools\safe_modbus_writer.py inspect --profile user-profiles\ktk-t3c-rw-safe.json --label lv1
```

Expected from the current T3C variable list:

```text
Label: lv1
Description: Liquid valve control type
Section: Unit Config > Liquid Level Valve
ADU/register: 7210
Access: RW
Min/max: 0 / 3
Enum: 1=Liq
```

If a machine shows `10` for `lv1`, that is outside the listed `0..3` range and should be treated as suspect before copying or writing it.

## Read lv1

Use offset `-1` for the Danfoss/KTK one-based ADU list unless proven otherwise.

```powershell
python tools\safe_modbus_writer.py read --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --port COM7 --baud 19200 --slave 20 --offset -1
```

Change `--slave` on the fly when moving machine to machine.

## Back Up RW Parameters First

This reads safe RW points and saves their current values.

```powershell
python tools\safe_modbus_writer.py backup --profile user-profiles\ktk-t3c-rw-safe.json --port COM7 --baud 19200 --slave 20 --offset -1
```

Backups are saved in:

```text
backups
```

## Dry-Run A Proposed lv1 Change

This validates the value and displays the write preview, but sends nothing.

```powershell
python tools\safe_modbus_writer.py write --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --value 1 --good-value "1 - Liq" --port COM7 --baud 19200 --slave 20 --offset -1 --dry-run
```

## Real lv1 Write

Only after reading the current value, comparing against the known-good machine, and saving a backup:

```powershell
python tools\safe_modbus_writer.py write --enable-write --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --value 1 --good-value "1 - Liq" --port COM7 --baud 19200 --slave 20 --offset -1
```

The tool will:

- read the current value first
- show label, description, register, old value, new value, range, unit, and enum text
- warn that `lv1` changes liquid valve control strategy
- require `WRITE lv1`
- require `I UNDERSTAND`
- require the proposed value again
- send Modbus function code 06
- read back the value immediately
- log the attempt in `write-logs\write-attempts.csv`

Function code 16 is available only if explicitly selected:

```powershell
python tools\safe_modbus_writer.py write --enable-write --write-function 16 --profile user-profiles\ktk-t3c-rw-safe.json --label lv1 --value 1 --port COM7 --slave 20 --offset -1
```

Use FC06 unless you have a confirmed reason to use FC16.

## Restore From Backup

Dry-run first:

```powershell
python tools\safe_modbus_writer.py restore --dry-run --profile user-profiles\ktk-t3c-rw-safe.json --backup backups\rw-backup-YYYYMMDD-HHMMSS.json --port COM7 --slave 20 --offset -1
```

Real restore requires `--enable-write` and confirmation. Batch restore requires the exact phrase `I UNDERSTAND`.

```powershell
python tools\safe_modbus_writer.py restore --enable-write --batch-confirm "I UNDERSTAND" --profile user-profiles\ktk-t3c-rw-safe.json --backup backups\rw-backup-YYYYMMDD-HHMMSS.json --port COM7 --slave 20 --offset -1
```

## What The Tool Will Not Do

- It will not write anything by default.
- It will not write points marked `Read`.
- It will not write alarm/status/live/sensor-looking points unless advanced mode is deliberately used.
- It will not accept raw register writes unless the point exists in the imported variable list.
- It will not automatically write `lv1` just because two machines differ.
