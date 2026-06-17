# Disclaimer

Open Chiller Service Viewer is an independent field service tool. It is not affiliated with, endorsed by, or supported by any HVAC, controls, compressor, or chiller manufacturer.

Manufacturer names, controller names, and machine names are used only to describe compatibility with publicly available or user-supplied register maps.

## Field Safety

Use this software only if you are competent to work on the connected equipment.

Modbus access can expose live controller values and, in some tools, writable parameters. Incorrect settings can cause:

- compressor trips
- valve movement
- pump or fan changes
- nuisance alarms
- controller reboot
- unsafe or unstable plant operation

The browser viewer is read-only by design. The separate safe write tool must only be used with known RW parameters, backups, and deliberate confirmation.

## No Warranty

This software is provided as-is. It may contain incorrect profiles, scaling, register offsets, or interpretation rules. Always confirm critical values against the controller display, manufacturer documentation, and normal engineering checks.

Do not rely on this tool as the only basis for safety-critical decisions.
