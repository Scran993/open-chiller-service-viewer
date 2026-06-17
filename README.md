# Open Chiller Service Viewer

Offline-first Modbus service dashboard for HVAC engineers.

This project turns a laptop, browser, and USB-RS485 adaptor into a practical live-view tool for chillers and HVAC controllers. It is intended for service visits where you have a manufacturer Modbus register list and want a clear dashboard, snapshots, logging, and reusable machine profiles.

The viewer is read-only by default.

## What It Does

- Reads Modbus RTU values through the browser Web Serial API.
- Supports holding registers, coils, input statuses, packed bits, signed values, invalid raw values, and simple scaling.
- Uses machine profiles so each chiller/controller can have its own register list.
- Lets you tick only the points you want to poll on a service visit.
- Shows likely service values near the top: temperatures, pressures, demand, power, alarms, and status.
- Saves snapshots and running logs as CSV.
- Includes a profile builder for converting CSV/register lists into viewer profiles.
- Includes an optional guarded write tool for controlled RW parameter work outside the browser viewer.

## Safety

This tool is for competent service/controls engineers.

Writing to live HVAC controller parameters can cause compressor trips, valve movement, fan/pump changes, nuisance alarms, or controller reboot. The browser viewer remains read-only. Any write work must be done deliberately with the guarded write tool, backups, and confirmation prompts.

This project is not affiliated with Danfoss, KTK, Geoclima, MEHITS, Daikin, Carrier, or any other manufacturer. Manufacturer names are used only to identify compatible field profiles and register-map formats.

See [DISCLAIMER.md](DISCLAIMER.md) and [SAFE-WRITES.md](SAFE-WRITES.md).

## Quick Start

On Windows, double-click:

```text
Start Viewer.bat
```

It starts a local web server and opens:

```text
http://localhost:8765/
```

Keep the launcher window open while using the viewer. Close it when finished.

Chrome, Edge, or Brave are recommended because Web Serial support is needed for direct USB-RS485 access.

## Typical Field Workflow

1. Plug in an isolated USB-RS485 adaptor.
2. Open `Start Viewer.bat`.
3. Choose the machine profile.
4. Set baud, serial format, slave ID, poll rate, and register offset.
5. Click `Connect`.
6. Click `Start`.
7. Use `Service view`, `Pressures / Temps`, or tick your own points.
8. Use `Snapshot` or `Start log` when you want evidence for a job report.

For many Danfoss/KTK MCX lists, the ADU/register list is one-based, so offset `-1` is often correct. For other controllers, offset `0` may be correct. Confirm by comparing a known display value.

## Included Tools

### Viewer

```text
index.html
app.js
styles.css
```

Live read-only service dashboard.

### Profile Builder

```text
Profile Builder.bat
profile-builder.html
profile-builder.js
```

Converts CSV/register lists into reusable profiles. It can save directly to the current browser viewer or export JSON for sharing.

### Register Explorer

```text
Register Explorer.bat
register-explorer.html
register-explorer.js
```

Useful when you need to inspect raw register ranges before creating a cleaner service profile.

### Safe Write Tool

```text
Safe Write Tool.bat
tools/safe_modbus_writer.py
```

Command-line guarded writer for RW parameters. It validates access rights, min/max, enums, backups, and confirmations. The browser viewer stays read-only.

## Creating Profiles

Open:

```text
Profile Builder.bat
```

Then:

1. Enter a profile name.
2. Set default baud, serial format, slave, and offset.
3. Import or paste a CSV.
4. Check the import report.
5. Click `Save to this viewer` for local use, or `Download JSON profile` for sharing.

The builder recognises common column names such as:

```text
group, section, name, label, description, register, address, ADU, function,
scale, gain, unit, access, RW, min, max, enum, notes
```

Simple CSV example:

```csv
group,name,register,function,scale,unit,notes
Compressor 1,Suction pressure,8855,03,0.1,barA,Divide by 10
```

Packed bit example:

```csv
group,name,register,bit,function,scale,unit,notes
Alarms,General alarm,20481,8,03,1,,From ADU 20481.08
```

RW metadata example:

```csv
group,name,register,function,scale,unit,access,min,max,enum,notes
Config,Liquid valve control type,7210,03,1,,RW,0,10,0=Off|1=Liq|10=Other,Confirm against controller display
```

## Sharing Profiles

Put shared profile JSON files into:

```text
user-profiles
```

Then restart the viewer. The launcher rebuilds:

```text
profile-manifest.json
```

Local browser-saved profiles are convenient for one laptop. JSON files are better for sharing with colleagues.

## Folder Layout

```text
.
|-- index.html
|-- app.js
|-- styles.css
|-- profiles/              Built-in example profiles
|-- user-profiles/         Local/shared profiles, ignored by git except README
|-- write-logs/            Write audit logs, ignored by git
|-- tools/                 Launcher and safe writer scripts
|-- profile-builder.html
|-- register-explorer.html
|-- SAFE-WRITES.md
|-- DISCLAIMER.md
```

## Development Notes

The main viewer is a static browser app. The Windows launcher serves it locally because Web Serial requires a secure/local origin.

No cloud service is required. Profiles, visible point selections, and theme preferences are stored locally in the browser.

## Contributing

Contributions are welcome, especially:

- New machine profiles from publicly shareable register maps.
- Better profile import mapping.
- Safer handling of 32-bit values and word order.
- Clearer service dashboard layouts.
- Field-tested documentation.

Please avoid submitting customer/site-specific data, passwords, private OEM tools, or proprietary manuals.

See [CONTRIBUTING.md](CONTRIBUTING.md).
